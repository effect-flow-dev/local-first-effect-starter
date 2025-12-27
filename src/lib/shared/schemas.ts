// FILE: src/lib/shared/schemas.ts
import { Schema } from "effect";

import type { NoteId, Note } from "../../types/generated/tenant/tenant_template/Note";
import type { UserId, User } from "../../types/generated/central/public/User";
import type { BlockId, Block } from "../../types/generated/tenant/tenant_template/Block";
import type { NotebookId, Notebook } from "../../types/generated/tenant/tenant_template/Notebook";
import type { BlockHistoryId, BlockHistory } from "../../types/generated/tenant/tenant_template/BlockHistory";

export type { User, Note, Block, Notebook, BlockHistory, UserId, NoteId, BlockId, NotebookId, BlockHistoryId };

const uuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
const UUIDSchemaBase = Schema.String.pipe(
  Schema.pattern(uuidRegex, {
    identifier: "UUID",
    description: "a Universally Unique Identifier",
  }),
);

export const NoteIdSchema: Schema.Schema<NoteId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<NoteId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid Note ID format." }));

export const UserIdSchema: Schema.Schema<UserId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<UserId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid User ID format." }));

export const BlockIdSchema: Schema.Schema<BlockId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<BlockId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid Block ID format." }));

export const NotebookIdSchema: Schema.Schema<NotebookId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<NotebookId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid Notebook ID format." }));

export const BlockHistoryIdSchema: Schema.Schema<BlockHistoryId, string, never> = (
  UUIDSchemaBase as unknown as Schema.Schema<BlockHistoryId, string, never>
).pipe(Schema.annotations({ message: () => "Invalid History ID format." }));

export const ConsultancyIdSchema = UUIDSchemaBase.pipe(Schema.annotations({ identifier: "ConsultancyId" }));
export const TenantIdSchema = UUIDSchemaBase.pipe(Schema.annotations({ identifier: "TenantId" }));

// ... Tiptap Schema Definitions ...
const TagMarkSchema = Schema.Struct({
  type: Schema.Literal("tagMark"),
  attrs: Schema.Struct({ tagName: Schema.String }),
});

const LinkMarkSchema = Schema.Struct({
  type: Schema.Literal("linkMark"),
  attrs: Schema.Struct({ linkTarget: Schema.String }),
});

const MetadataMarkSchema = Schema.Struct({
  type: Schema.Literal("metadataMark"),
  attrs: Schema.Struct({ 
    key: Schema.String,
    value: Schema.String
  }),
});

const MarkSchema = Schema.Union(TagMarkSchema, LinkMarkSchema, MetadataMarkSchema);

export const TiptapTextNodeSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  marks: Schema.optional(Schema.Array(MarkSchema)),
});

export type TiptapTextNode = Schema.Schema.Type<typeof TiptapTextNodeSchema>;

const StableBlockAttrs = Schema.Struct({
  blockId: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number), 
});

export const TiptapParagraphNodeSchema = Schema.Struct({
  type: Schema.Literal("paragraph"),
  attrs: Schema.optional(StableBlockAttrs),
  content: Schema.optional(Schema.Array(TiptapTextNodeSchema)),
});
export type TiptapParagraphNode = Schema.Schema.Type<
  typeof TiptapParagraphNodeSchema
>;

export const TiptapHeadingNodeSchema = Schema.Struct({
  type: Schema.Literal("heading"),
  attrs: Schema.Struct({
    level: Schema.Number,
    blockId: Schema.optional(Schema.String),
    version: Schema.optional(Schema.Number), 
  }),
  content: Schema.optional(Schema.Array(TiptapTextNodeSchema)),
});
export type TiptapHeadingNode = Schema.Schema.Type<
  typeof TiptapHeadingNodeSchema
>;

export interface TiptapListItemNode {
  readonly type: "listItem";
  readonly attrs?: { readonly blockId?: string; readonly version?: number };
  readonly content: ReadonlyArray<
    TiptapParagraphNode | TiptapBulletListNode | TiptapHeadingNode
  >;
}

export interface TiptapBulletListNode {
  readonly type: "bulletList";
  readonly attrs?: { readonly blockId?: string; readonly version?: number };
  readonly content: ReadonlyArray<TiptapListItemNode>;
}

const TiptapListItemNodeSchema: Schema.Schema<TiptapListItemNode> =
  Schema.suspend(() =>
    Schema.Struct({
      type: Schema.Literal("listItem"),
      attrs: Schema.optional(StableBlockAttrs),
      content: Schema.Array(
        Schema.Union(
          TiptapParagraphNodeSchema,
          TiptapBulletListNodeSchema,
          TiptapHeadingNodeSchema,
        ),
      ),
    }),
  );

const TiptapBulletListNodeSchema: Schema.Schema<TiptapBulletListNode> =
  Schema.suspend(() =>
    Schema.Struct({
      type: Schema.Literal("bulletList"),
      attrs: Schema.optional(StableBlockAttrs),
      content: Schema.Array(TiptapListItemNodeSchema),
    }),
  );

const BlockIdTransformSchema = Schema.transform(Schema.String, BlockIdSchema, {
  decode: (s) => s as BlockId,
  encode: (id) => id,
});

export const TaskStatusSchema = Schema.Union(
  Schema.Literal("todo"),
  Schema.Literal("in_progress"),
  Schema.Literal("done"),
  Schema.Literal("blocked"),
);
export type TaskStatus = Schema.Schema.Type<typeof TaskStatusSchema>;

const InteractiveBlockSchema = Schema.Struct({
  type: Schema.Literal("interactiveBlock"),
  attrs: Schema.Struct({
    blockId: Schema.NullOr(BlockIdTransformSchema),
    version: Schema.optional(Schema.Number),
    blockType: Schema.Union(
        Schema.Literal("task"), 
        Schema.Literal("image"), 
        Schema.Literal("form_checklist"), 
        Schema.Literal("form_meter"),
        Schema.Literal("map_block"),
        Schema.Literal("tiptap_text")
    ),
    fields: Schema.Struct({
      is_complete: Schema.optional(Schema.Boolean), 
      status: Schema.optional(TaskStatusSchema), 
      // ✅ NEW: Add due_at field for alerts
      due_at: Schema.optional(Schema.String),
      url: Schema.optional(Schema.NullOr(Schema.String)),
      uploadId: Schema.optional(Schema.NullOr(Schema.String)),
      width: Schema.optional(Schema.Number),
      caption: Schema.optional(Schema.String),
      items: Schema.optional(Schema.Unknown),
      value: Schema.optional(Schema.Number),
      min: Schema.optional(Schema.Number),
      max: Schema.optional(Schema.Number),
      unit: Schema.optional(Schema.String),
      label: Schema.optional(Schema.String),
      zoom: Schema.optional(Schema.Number),
      style: Schema.optional(Schema.String),
    }),
  }),
  content: Schema.optional(Schema.Array(TiptapTextNodeSchema)),
});
export type InteractiveBlock = Schema.Schema.Type<
  typeof InteractiveBlockSchema
>;

export const AlertBlockSchema = Schema.Struct({
  type: Schema.Literal("alertBlock"),
  attrs: Schema.Struct({
    blockId: Schema.optional(BlockIdTransformSchema),
    level: Schema.Union(
      Schema.Literal("info"),
      Schema.Literal("warning"),
      Schema.Literal("error"),
    ),
    message: Schema.String,
  }),
});
export type AlertBlock = Schema.Schema.Type<typeof AlertBlockSchema>;

export type TiptapNode =
  | TiptapParagraphNode
  | TiptapBulletListNode
  | TiptapListItemNode
  | TiptapTextNode
  | TiptapHeadingNode
  | InteractiveBlock
  | AlertBlock; 

export const TiptapDocSchema = Schema.Struct({
  type: Schema.Literal("doc"),
  content: Schema.optional(
    Schema.Array(
      Schema.Union(
        TiptapParagraphNodeSchema,
        TiptapBulletListNodeSchema,
        TiptapHeadingNodeSchema,
        InteractiveBlockSchema,
        AlertBlockSchema, 
      ),
    ),
  ),
});
export type TiptapDoc = Schema.Schema.Type<typeof TiptapDocSchema>;

const ContentSchema = Schema.transform(Schema.Unknown, TiptapDocSchema, {
  strict: true,
  decode: (u) => Schema.decodeUnknownSync(TiptapDocSchema)(u),
  encode: (t) => t,
});

export const LenientDateSchema = Schema.Union(
  Schema.DateFromSelf,
  Schema.DateFromString,
);

export const NotebookSchema = Schema.Struct({
  id: NotebookIdSchema,
  user_id: UserIdSchema,
  name: Schema.String,
  created_at: LenientDateSchema,
  global_version: Schema.optional(Schema.String),
});
export type AppNotebook = Schema.Schema.Type<typeof NotebookSchema>;

export const NoteSchema = Schema.Struct({
  id: NoteIdSchema,
  user_id: UserIdSchema,
  title: Schema.String,
  content: ContentSchema,
  created_at: LenientDateSchema,
  updated_at: LenientDateSchema,
  version: Schema.Number,
  global_version: Schema.optional(Schema.String),
  notebook_id: Schema.optional(Schema.Union(NotebookIdSchema, Schema.Null)),
});

export type AppNote = Schema.Schema.Type<typeof NoteSchema>;

export const NoteMetadataSchema = Schema.Struct({
  id: NoteIdSchema,
  user_id: UserIdSchema,
  title: Schema.String,
  updated_at: LenientDateSchema,
  global_version: Schema.optional(Schema.String),
  notebook_id: Schema.optional(Schema.Union(NotebookIdSchema, Schema.Null)),
});

export type AppNoteMetadata = Schema.Schema.Type<typeof NoteMetadataSchema>;

export const HistoryEntrySchema = Schema.Struct({
  id: BlockHistoryIdSchema,
  user_id: UserIdSchema,
  block_id: BlockIdSchema,
  note_id: NoteIdSchema,
  mutation_type: Schema.String,
  timestamp: LenientDateSchema,
  change_delta: Schema.Unknown,
  content_snapshot: Schema.optional(Schema.Unknown),
  was_rejected: Schema.Boolean,
});

export type HistoryEntry = Schema.Schema.Type<typeof HistoryEntrySchema>;

export const NotesSchema = Schema.Array(NoteSchema);

export const TenantStrategySchema = Schema.Union(
  Schema.Literal("schema"),
  Schema.Literal("database"),
);
export type TenantStrategy = Schema.Schema.Type<typeof TenantStrategySchema>;

export const SubdomainSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: () => "Subdomain must be lowercase alphanumeric, dashes allowed, 3-63 chars.",
  }),
  Schema.minLength(3),
  Schema.maxLength(63)
);

export const UserSchema = Schema.Struct({
  id: UserIdSchema,
  email: Schema.String.pipe(
    Schema.pattern(
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    ),
  ),
  password_hash: Schema.String,
  created_at: LenientDateSchema,
  permissions: Schema.Union(
    Schema.mutable(Schema.Array(Schema.String)),
    Schema.Null,
  ),
  avatar_url: Schema.Union(Schema.String, Schema.Null),
  email_verified: Schema.Boolean,
  tenant_strategy: Schema.optional(TenantStrategySchema),
  database_name: Schema.optional(Schema.Union(Schema.String, Schema.Null)),
  subdomain: Schema.optional(SubdomainSchema)
});

export const PublicUserSchema = UserSchema.pipe(Schema.omit("password_hash"));
export type PublicUser = typeof PublicUserSchema.Type;

export const ConsultancySchema = Schema.Struct({
  id: ConsultancyIdSchema,
  name: Schema.String,
  created_at: LenientDateSchema,
});

export const TenantSchema = Schema.Struct({
  id: TenantIdSchema,
  consultancy_id: ConsultancyIdSchema,
  name: Schema.String,
  subdomain: SubdomainSchema,
  tenant_strategy: TenantStrategySchema,
  database_name: Schema.Union(Schema.String, Schema.Null),
  schema_name: Schema.optional(Schema.Union(Schema.String, Schema.Null)),
  created_at: LenientDateSchema,
});

export const TenantMembershipSchema = Schema.Struct({
  user_id: UserIdSchema,
  tenant_id: TenantIdSchema,
  role: Schema.Literal('OWNER', 'ADMIN', 'MEMBER', 'GUEST'),
  joined_at: LenientDateSchema,
});


// --- Phase 2: Hybrid Architecture Schemas ---

export const ChecklistItemSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  checked: Schema.Boolean,
});

export const ChecklistFieldsSchema = Schema.Struct({
  items: Schema.Array(ChecklistItemSchema),
});

export const MeterFieldsSchema = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
  min: Schema.Number,
  max: Schema.Number,
  unit: Schema.String,
});

export const MapBlockFieldsSchema = Schema.Struct({
  zoom: Schema.optional(Schema.Number),
  style: Schema.optional(Schema.String),
});

// Base structure for all blocks
const BlockBase = {
  id: BlockIdSchema,
  user_id: UserIdSchema,
  note_id: Schema.Union(NoteIdSchema, Schema.Null),
  content: Schema.String,
  tags: Schema.mutable(Schema.Array(Schema.String)),
  links: Schema.mutable(Schema.Array(Schema.String)),
  file_path: Schema.String,
  parent_id: Schema.Union(BlockIdSchema, Schema.Null),
  depth: Schema.Number,
  order: Schema.Number,
  transclusions: Schema.mutable(Schema.Array(Schema.String)),
  version: Schema.Number,
  created_at: LenientDateSchema,
  updated_at: LenientDateSchema,
  global_version: Schema.optional(Schema.String),
  latitude: Schema.optional(Schema.Number),
  longitude: Schema.optional(Schema.Number),
};

export const TiptapTextBlockSchema = Schema.Struct({
  ...BlockBase,
  type: Schema.Literal("tiptap_text"),
  fields: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export const FormChecklistBlockSchema = Schema.Struct({
  ...BlockBase,
  type: Schema.Literal("form_checklist"),
  fields: ChecklistFieldsSchema,
});

export const FormMeterBlockSchema = Schema.Struct({
  ...BlockBase,
  type: Schema.Literal("form_meter"),
  fields: MeterFieldsSchema,
});

export const MapBlockSchema = Schema.Struct({
  ...BlockBase,
  type: Schema.Literal("map_block"),
  fields: MapBlockFieldsSchema,
});

// Legacy / Generic support
export const GenericBlockSchema = Schema.Struct({
  ...BlockBase,
  type: Schema.String,
  fields: Schema.Unknown,
});

export const BlockSchema = Schema.Union(
  TiptapTextBlockSchema,
  FormChecklistBlockSchema,
  FormMeterBlockSchema,
  MapBlockSchema,
  GenericBlockSchema
);

export type AppBlock = Schema.Schema.Type<typeof BlockSchema>;
export type TiptapTextBlock = Schema.Schema.Type<typeof TiptapTextBlockSchema>;
export type FormChecklistBlock = Schema.Schema.Type<typeof FormChecklistBlockSchema>;
export type FormMeterBlock = Schema.Schema.Type<typeof FormMeterBlockSchema>;
export type MapBlock = Schema.Schema.Type<typeof MapBlockSchema>;
