    import { Fiber, Effect, Schema, Duration, Exit, Cause, Option } from "effect";
    import { runClientUnscoped } from "../../lib/client/runtime";
    import { ReplicacheService } from "../../lib/client/replicache";
    import {
      NoteNotFoundError,
      NoteParseError,
      NoteSaveError,
      NotePageError
    } from "../../lib/client/errors";
    import { NoteTitleExistsError } from "../../lib/shared/errors";
    import {
      NoteSchema,
      NoteMetadataSchema,
      BlockSchema,
      type AppNote,
      type AppBlock,
      type NoteId,
      type TiptapDoc,
      type BlockId,
    } from "../../lib/shared/schemas";
    import type { NotePage } from "./note-page";
    import { TiptapEditor } from "../editor/tiptap-editor";
    import { convertTiptapToMarkdown } from "../../lib/client/logic/markdown-transformer";
    import { clientLog } from "../../lib/client/clientLog";

    export const handleTitleKeyDown = (component: NotePage, e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const editorElement =
          component.querySelector<TiptapEditor>("tiptap-editor");
        editorElement?.focusEditor();
      }
    };

    export const handleTaskUpdate = (
      component: NotePage,
      e: CustomEvent<{ blockId: BlockId; isComplete: boolean }>,
    ) => {
      component.dispatch({ type: "UPDATE_TASK_START", payload: e.detail });
    };

    export const handleEditorClick = (component: NotePage, event: MouseEvent) => {
      const linkElement = (event.target as HTMLElement).closest(
        "a[data-link-target]",
      );

      if (linkElement) {
        event.preventDefault();
        const linkTarget = linkElement.getAttribute("data-link-target");
        if (linkTarget) {
          component.dispatch({
            type: "NAVIGATE_TO_NOTE_BY_TITLE",
            payload: { title: linkTarget },
          });
        }
      }
    };

    let previewDebounceFiber: Fiber.RuntimeFiber<void, unknown> | undefined;

    export const handleLinkHover = (
      component: NotePage,
      e: CustomEvent<{ target: string; x: number; y: number }>
    ) => {
      const { target: title, x, y } = e.detail;
      component.dispatch({ type: "PREVIEW_HOVER_START", payload: { title, x, y } });

      if (previewDebounceFiber) {
        runClientUnscoped(Fiber.interrupt(previewDebounceFiber));
      }

      previewDebounceFiber = runClientUnscoped(
        Effect.sleep(Duration.millis(200)).pipe(
          Effect.andThen(Effect.gen(function* () {
            const replicache = yield* ReplicacheService;
            const notes = yield* Effect.promise(() => 
                replicache.client.query(tx => tx.scan({ prefix: "note/" }).values().toArray())
            );

            let snippet = "Note not found.";
            
            for (const json of notes) {
                const noteOpt = Schema.decodeUnknownOption(NoteSchema)(json);
                if (Option.isSome(noteOpt)) {
                    const note = noteOpt.value;
                    if (note.title.toLowerCase() === title.toLowerCase()) {
                        const md = convertTiptapToMarkdown(note.content);
                        snippet = md.replace(/[#*`]/g, "").slice(0, 200);
                        if (md.length > 200) snippet += "...";
                        break;
                    }
                }
            }

            yield* Effect.sync(() => {
                component.dispatch({ type: "PREVIEW_DATA_LOADED", payload: { snippet }});
            });
          }))
        )
      );
    };

    export const handleLinkHoverEnd = (component: NotePage) => {
      if (previewDebounceFiber) {
        runClientUnscoped(Fiber.interrupt(previewDebounceFiber));
      }
      component.dispatch({ type: "PREVIEW_HOVER_END" });
    };

    interface ContentNode {
        type: string;
        attrs?: Record<string, unknown>;
        content?: ContentNode[];
    }

    export const initializeState = (component: NotePage) => {
      component["_replicacheUnsubscribe"]?.();
      component.dispatch({ type: "INITIALIZE_START" });

      const setupEffect = Effect.gen(function* () {
        if (!component.id) {
          return yield* Effect.fail(new NoteNotFoundError());
        }

        const replicache = yield* ReplicacheService;
        const noteKey = `note/${component.id}`;

        yield* clientLog("info", `[note-page] Subscribing to ${noteKey} and blocks...`);

        component["_replicacheUnsubscribe"] = replicache.client.subscribe(
          async (tx) => {
            const [note, allNotes, blocks] = await Promise.all([
              tx.get(noteKey),
              tx.scan({ prefix: "note/" }).values().toArray(),
              tx.scan({ indexName: "blocksByNoteId", prefix: component.id }).values().toArray(),
            ]);
            return { note, allNotes, blocks };
          },
          (result) => {
            if (component.state.value.status === "loading" && !result.note) {
              component.dispatch({
                type: "INITIALIZE_ERROR",
                payload: new NoteNotFoundError(),
              });
              return;
            }
            
            if (!result.note) {
              if (component.state.value.status !== "loading") {
                 component.dispatch({
                  type: "INITIALIZE_ERROR",
                  payload: new NoteNotFoundError(),
                });
              }
              return;
            }

            const resilientParseEffect = Effect.gen(function* () {
              const note = yield* Schema.decodeUnknown(NoteSchema)(
                result.note,
              ).pipe(Effect.mapError((cause) => new NoteParseError({ cause })));

              const allNotes: AppNote[] = [];
              for (const noteJson of result.allNotes) {
                const noteOption =
                  Schema.decodeUnknownOption(NoteMetadataSchema)(noteJson);
                if (Option.isSome(noteOption)) {
                  allNotes.push(noteOption.value as unknown as AppNote);
                }
              }

              const blocks: AppBlock[] = [];
              for (const blockJson of result.blocks) {
                 const blockOpt = Schema.decodeUnknownOption(BlockSchema)(blockJson);
                 if (Option.isSome(blockOpt)) {
                     blocks.push(blockOpt.value);
                 }
              }
              blocks.sort((a, b) => a.order - b.order);

              const content = note.content as unknown as ContentNode;
              
              if (content && content.content) {
                  const traverse = (nodes: ContentNode[]) => {
                      for (let i = 0; i < nodes.length; i++) {
                          const node = nodes[i];
                          
                          if (node?.type === "alertBlock") {
                              const prevNode = nodes[i - 1];
                              let insertIndex = -1;
                              
                              if (prevNode && prevNode.attrs?.blockId) {
                                  const prevId = prevNode.attrs.blockId as string;
                                  const foundIdx = blocks.findIndex(b => b.id === prevId);
                                  if (foundIdx !== -1) insertIndex = foundIdx + 1;
                              }
                              
                              const alertBlock: AppBlock = {
                                  id: `alert-${Date.now()}-${i}` as BlockId,
                                  note_id: note.id,
                                  user_id: note.user_id,
                                  type: "alert",
                                  content: (node.attrs?.message as string) || "Alert",
                                  fields: { level: node.attrs?.level },
                                  tags: [], links: [], transclusions: [], file_path: "", 
                                  parent_id: null, depth: 0, order: 0, version: 0, 
                                  created_at: new Date(), updated_at: new Date()
                              };

                              if (insertIndex !== -1) {
                                  blocks.splice(insertIndex, 0, alertBlock);
                              } else {
                                  blocks.unshift(alertBlock);
                              }
                          }
                          
                          if (node?.content) traverse(node.content);
                      }
                  };
                  traverse(content.content);
              }

              return { note, allNotes, blocks };
            });

            Effect.runCallback(resilientParseEffect, {
              onExit: (exit) => {
                if (Exit.isSuccess(exit)) {
                  const { note, allNotes, blocks } = exit.value;
                  component.dispatch({
                    type: "DATA_UPDATED",
                    payload: { note, allNotes, blocks },
                  });
                } else {
                  runClientUnscoped(clientLog(
                    "error",
                    "[note-page subscribe callback] Data parse failed.",
                    Cause.pretty(exit.cause),
                  ));
                  component.dispatch({
                    type: "INITIALIZE_ERROR",
                    payload: Cause.squash(exit.cause) as NotePageError,
                  });
                }
              },
            });
          },
        );
      });

      runClientUnscoped(
        setupEffect.pipe(
          Effect.catchAll((error) =>
            Effect.sync(() =>
              component.dispatch({ type: "INITIALIZE_ERROR", payload: error }),
            ),
          ),
        ),
      );
    };

    export const flushChangesEffect = (component: NotePage) =>
      Effect.gen(function* () {
        const state = component.state.value;
        if (state.status !== "ready") return;

        const noteToSave = state.note;
        if (!noteToSave) return;

        const replicache = yield* ReplicacheService;

        // ✅ FIXED: We MUST send 'content' here.
        // If we don't, the server's updateNote mutation never sees the new image block in the JSON,
        // and therefore never creates the corresponding row in the 'block' table.
        yield* Effect.tryPromise({
          try: () => {
            return replicache.client.mutate.updateNote({
              id: component.id as NoteId,
              title: noteToSave.title,
              content: noteToSave.content, 
              notebookId: noteToSave.notebook_id, 
            });
          },
          catch: (cause) => new NoteSaveError({ cause }),
        });
      });

    export const handleForceSave = (component: NotePage) => {
      runClientUnscoped(clientLog("info", "[note-page] Force save triggered."));
      
      if (component._saveFiber) {
        runClientUnscoped(Fiber.interrupt(component._saveFiber));
      }

      runClientUnscoped(
        flushChangesEffect(component).pipe(
          Effect.tap(() => Effect.sync(() => component.dispatch({ type: "SAVE_SUCCESS" }))),
          Effect.catchTag("NoteSaveError", (error) =>
            Effect.sync(() =>
              component.dispatch({ type: "SAVE_ERROR", payload: error }),
            ),
          ),
        ),
      );
    };

    export const handlePageHide = (component: NotePage) => {
      const state = component.state.value;
      if (state.status !== "ready" || !state.isSaving) {
        return;
      }
      if (component["_saveFiber"]) {
        runClientUnscoped(Fiber.interrupt(component["_saveFiber"]));
      }

      runClientUnscoped(
        flushChangesEffect(component).pipe(
          Effect.catchTag("NoteSaveError", (error) =>
            Effect.sync(() =>
              component.dispatch({ type: "SAVE_ERROR", payload: error }),
            ),
          ),
        ),
      );
    };

    export const handleInput = (
      component: NotePage,
      updateField: Partial<AppNote>,
    ) => {
      component.dispatch({ type: "UPDATE_FIELD", payload: updateField });
      scheduleSave(component);
    };

    export const handleEditorUpdate = (
      component: NotePage,
      e: CustomEvent<{ content: TiptapDoc }>,
    ) => {
      component.dispatch({
        type: "UPDATE_FIELD",
        payload: { content: e.detail.content },
      });
      scheduleSave(component);
    };

    export const scheduleSave = (component: NotePage) => {
      if (component["_saveFiber"]) {
        runClientUnscoped(Fiber.interrupt(component["_saveFiber"]));
      }

      const debouncedSaveWithCheck = Effect.gen(function* () {
        const state = component.state.value;
        if (state.status !== "ready") return;
        
        const noteToSave = state.note;
        const replicache = yield* ReplicacheService;

        const allNotesJson = yield* Effect.promise(() =>
          replicache.client.query((tx) =>
            tx.scan({ prefix: "note/" }).values().toArray(),
          ),
        );
        const allNotes = allNotesJson.flatMap((json) =>
          Schema.decodeUnknownOption(NoteMetadataSchema)(json).pipe(Option.toArray),
        );

        const isDuplicate = allNotes.some(
          (note) =>
            note.id !== noteToSave.id &&
            note.title.toLowerCase().trim() ===
              noteToSave.title.toLowerCase().trim(),
        );

        if (isDuplicate) {
          return yield* Effect.fail(new NoteTitleExistsError());
        }

        yield* flushChangesEffect(component);
      });

      const finalEffect = Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(debouncedSaveWithCheck),
        Effect.match({
          onFailure: (error) =>
            component.dispatch({ type: "SAVE_ERROR", payload: error }),
          onSuccess: () => component.dispatch({ type: "SAVE_SUCCESS" }),
        }),
      );
      component["_saveFiber"] = runClientUnscoped(finalEffect);
    };
