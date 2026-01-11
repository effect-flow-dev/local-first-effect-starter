// File: src/features/note/note.schemas.ts
import { Schema } from "effect";
import {
  NoteIdSchema,
  UserIdSchema,
  BlockIdSchema,
  TiptapDocSchema,
  NotebookIdSchema,
  LatitudeSchema,
  LongitudeSchema,
  HlcMetadataSchema, 
} from "../../lib/shared/schemas";

export { CreateBlockArgsSchema } from "../../lib/shared/schemas";

export const TemplateItemSchema = Schema.Struct({
  type: Schema.Union(
      Schema.Literal("tiptap_text"),
      Schema.Literal("form_checklist"),
      Schema.Literal("form_meter"),
      Schema.Literal("map_block"),
      Schema.Literal("task"),  
      Schema.Literal("image")  
  ),
  fields: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  content: Schema.optional(Schema.String)
});

export const CreateNoteArgsSchema = Schema.Struct({
  id: NoteIdSchema,
  userID: UserIdSchema,
  title: Schema.String,
  initialBlockId: Schema.optional(Schema.String),
  notebookId: Schema.optional(NotebookIdSchema),
  template: Schema.optional(Schema.Array(TemplateItemSchema)),
  latitude: Schema.optional(LatitudeSchema),
  longitude: Schema.optional(LongitudeSchema),
  ...HlcMetadataSchema, 
});

export const UpdateNoteArgsSchema = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.optional(Schema.String),
  content: Schema.optional(TiptapDocSchema),
  notebookId: Schema.optional(Schema.Union(NotebookIdSchema, Schema.Null)),
  ...HlcMetadataSchema, 
});

export const DeleteNoteArgsSchema = Schema.Struct({
  id: NoteIdSchema,
  ...HlcMetadataSchema, 
});

export const UpdateTaskArgsSchema = Schema.Struct({
  blockId: BlockIdSchema,
  isComplete: Schema.Boolean,
  version: Schema.Number,
  ...HlcMetadataSchema, 
});

export const UpdateBlockArgsSchema = Schema.Struct({
  blockId: BlockIdSchema,
  fields: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  version: Schema.Number,
  ...HlcMetadataSchema, 
});

export const IncrementCounterArgsSchema = Schema.Struct({
  blockId: BlockIdSchema,
  key: Schema.String, 
  delta: Schema.Number,
  version: Schema.Number,
  ...HlcMetadataSchema, 
});

export const RevertBlockArgsSchema = Schema.Struct({
  blockId: BlockIdSchema,
  historyId: Schema.String,
  targetSnapshot: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ...HlcMetadataSchema,
});

export const RevertNoteArgsSchema = Schema.Struct({
  noteId: NoteIdSchema,
  historyId: Schema.String,
  targetSnapshot: Schema.Struct({
    title: Schema.String,
    content: TiptapDocSchema,
    notebookId: Schema.optional(Schema.Union(NotebookIdSchema, Schema.Null)),
  }),
  ...HlcMetadataSchema,
});
