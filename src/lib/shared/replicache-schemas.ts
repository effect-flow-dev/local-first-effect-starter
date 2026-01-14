// File: src/lib/shared/replicache-schemas.ts
import { Schema } from "effect";
import {
  NoteIdSchema,
  UserIdSchema,
  BlockIdSchema,
  TiptapDocSchema,
  NotebookIdSchema,
  EntityIdSchema,
} from "./schemas";

// --- CVR (Client View Record) ---
export const CvrDataSchema = Schema.Struct({
  notes: Schema.Array(NoteIdSchema),
  blocks: Schema.Array(BlockIdSchema),
  notebooks: Schema.optional(Schema.Array(NotebookIdSchema)),
  entities: Schema.optional(Schema.Array(EntityIdSchema)),
});

export type CvrData = Schema.Schema.Type<typeof CvrDataSchema>;

// --- FILTER SCHEMA (The Lens) ---
export const SyncFilterSchema = Schema.Struct({
  tags: Schema.optional(Schema.Array(Schema.String)),
  notebookId: Schema.optional(Schema.String),
});
export type SyncFilter = Schema.Schema.Type<typeof SyncFilterSchema>;

// --- PULL ---
export const PullRequestSchema = Schema.Struct({
  clientGroupID: Schema.String,
  cookie: Schema.Union(Schema.Number, Schema.String, Schema.Null),
  filter: Schema.optional(SyncFilterSchema),
});
export type PullRequest = Schema.Schema.Type<typeof PullRequestSchema>;

const SerializedNoteSchema = Schema.Struct({
  _tag: Schema.Literal("note"),
  id: NoteIdSchema,
  user_id: UserIdSchema,
  title: Schema.String,
  content: TiptapDocSchema,
  version: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  global_version: Schema.optional(Schema.String),
  notebook_id: Schema.optional(Schema.Union(NotebookIdSchema, Schema.Null)),
});

const SerializedBlockSchema = Schema.Struct({
  _tag: Schema.Literal("block"),
  id: BlockIdSchema,
  user_id: UserIdSchema,
  note_id: Schema.Union(NoteIdSchema, Schema.Null),
  type: Schema.String,
  content: Schema.String,
  fields: Schema.Any,
  tags: Schema.mutable(Schema.Array(Schema.String)),
  links: Schema.mutable(Schema.Array(Schema.String)),
  file_path: Schema.String,
  parent_id: Schema.Union(BlockIdSchema, Schema.Null),
  depth: Schema.Number,
  order: Schema.Number,
  transclusions: Schema.mutable(Schema.Array(Schema.String)),
  version: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  global_version: Schema.optional(Schema.String),
  // ✅ NEW: Location Context Fields (Fixing TS2353)
  latitude: Schema.optional(Schema.Number),
  longitude: Schema.optional(Schema.Number),
  device_created_at: Schema.optional(Schema.String),
  entity_id: Schema.optional(Schema.Union(EntityIdSchema, Schema.Null)),
  location_source: Schema.optional(Schema.String),
  location_accuracy: Schema.optional(Schema.Number)
});

const SerializedNotebookSchema = Schema.Struct({
  _tag: Schema.Literal("notebook"),
  id: NotebookIdSchema,
  user_id: UserIdSchema,
  name: Schema.String,
  created_at: Schema.String,
  global_version: Schema.optional(Schema.String),
});

const SerializedEntitySchema = Schema.Struct({
  _tag: Schema.Literal("entity"),
  id: EntityIdSchema,
  name: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
  description: Schema.Union(Schema.String, Schema.Null),
  created_at: Schema.String,
  updated_at: Schema.String,
});

const PatchOperationSchema = Schema.Union(
  Schema.Struct({ op: Schema.Literal("clear") }),
  Schema.Struct({
    op: Schema.Literal("put"),
    key: Schema.String,
    value: Schema.Union(
      SerializedNoteSchema,
      SerializedBlockSchema,
      SerializedNotebookSchema,
      SerializedEntitySchema
    ),
  }),
  Schema.Struct({ op: Schema.Literal("del"), key: Schema.String }),
);

export const PullResponseSchema = Schema.Struct({
  cookie: Schema.Union(Schema.Number, Schema.String),
  lastMutationIDChanges: Schema.Record({
    key: Schema.String,
    value: Schema.Number,
  }),
  patch: Schema.mutable(Schema.Array(PatchOperationSchema)),
});
export type PullResponse = Schema.Schema.Type<typeof PullResponseSchema>;

const MutationSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  args: Schema.Unknown,
  clientID: Schema.String,
});

export const PushRequestSchema = Schema.Struct({
  clientGroupID: Schema.String,
  mutations: Schema.Array(MutationSchema),
});

export type PushRequest = Schema.Schema.Type<typeof PushRequestSchema>;
