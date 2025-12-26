// src/components/editor/extensions/BrokenLinkHighlighter.ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProsemirrorNode, Mark } from "@tiptap/pm/model";
import { LinkMark } from "./LinkMark";

export interface BrokenLinkHighlighterOptions {
  allNoteTitles: Set<string>;
}

export const brokenLinkPluginKey = new PluginKey<DecorationSet>(
  "brokenLinkHighlighter",
);

function findBrokenLinks(
  doc: ProsemirrorNode,
  allNoteTitles: Set<string>,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: ProsemirrorNode, pos: number) => {
    if (node.marks.length > 0) {
      const linkMark = node.marks.find(
        (mark: Mark) => mark.type.name === LinkMark.name,
      );

      if (linkMark) {
        const linkTarget = (linkMark.attrs as { linkTarget: string | null })
          .linkTarget;

        if (linkTarget && !allNoteTitles.has(linkTarget)) {
          decorations.push(
            Decoration.inline(pos, pos + node.nodeSize, {
              class: "broken-link",
              title: `Note '${linkTarget}' does not exist. Click to create it.`,
            }),
          );
        }
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const BrokenLinkHighlighter =
  Extension.create<BrokenLinkHighlighterOptions>({
    name: "brokenLinkHighlighter",

    addOptions() {
      return {
        allNoteTitles: new Set(),
      };
    },

    addProseMirrorPlugins() {
      // ✅ FIX: Disable the lint rule for this specific, necessary use case.
      // This is required because inside the Plugin's state methods, `this`
      // refers to the state field, not the extension instance.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const extension = this;

      return [
        new Plugin({
          key: brokenLinkPluginKey,
          state: {
            init(_, { doc }) {
              // Use the captured `extension` variable to access options.
              const titles = extension.options.allNoteTitles;
              return findBrokenLinks(doc, titles);
            },
            apply(tr, oldState) {
              const newTitles = tr.getMeta(brokenLinkPluginKey) as
                | Set<string>
                | undefined;

              if (newTitles) {
                return findBrokenLinks(tr.doc, newTitles);
              }

              if (tr.docChanged) {
                // When the document changes, we need to remap the existing decorations
                // to their new positions.
                return oldState.map(tr.mapping, tr.doc);
              }

              return oldState;
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });
