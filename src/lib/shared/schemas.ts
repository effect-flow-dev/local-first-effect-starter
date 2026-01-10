// FILE: src/lib/shared/schemas.ts
import { Schema } from "effect";

// ✅ CHANGE: Import User types from Tenant schema instead of Central
import type { UserId, User } from "../../types/generated/tenant/tenant_template/User";
import type { NoteId, Note } from "../../types/generated/tenant/tenant_template/Note";
import type { BlockId, Block } from "../../types/generated/tenant/tenant_template/Block";
import type { NotebookId, Notebook } from "../../types/generated/tenant/tenant_template/Notebook";
import type { BlockHistoryId, BlockHistory } from "../../types/generated/tenant/tenant_template/BlockHistory";

export type { User, Note, Block, Notebook, BlockHistory, UserId, NoteId, BlockId, NotebookId, BlockHistoryId };

// ... (Rest of the file remains unchanged)
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

// --- Precise Domain Schemas ---

export const LatitudeSchema = Schema.Number.pipe(
  Schema.between(-90, 90),
  Schema.annotations({ 
    identifier: "Latitude", 
    message: () => "Invalid Latitude: must be between -90 and 90." 
  })
);

export const LongitudeSchema = Schema.Number.pipe(
  Schema.between(-180, 180),
  Schema.annotations({ 
    identifier: "Longitude", 
    message: () => "Invalid Longitude: must be between -180 and 180." 
  })
);

export const GeoLocationSchema = Schema.Struct({
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
});

export const LenientDateSchema = Schema.Union(
  Schema.DateFromSelf,
  Schema.DateFromString,
);

export const DeviceAuditSchema = Schema.Struct({
  device_created_at: LenientDateSchema,
});

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

// Forward declaration needed for recursive types
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
      validation_status: Schema.optional(Schema.String), 
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

// Fix ListItem Schema to include Interactive/Alert blocks (nested structure support)
export interface TiptapListItemNode {
  readonly type: "listItem";
  readonly attrs?: { readonly blockId?: string; readonly version?: number };
  readonly content: ReadonlyArray<
    TiptapParagraphNode | TiptapBulletListNode | TiptapHeadingNode | InteractiveBlock | AlertBlock
  >;
}

export interface TiptapBulletListNode {
  readonly type: "bulletList";
  readonly attrs?: { readonly blockId?: string; readonly version?: number };
  readonly content: ReadonlyArray<TiptapListItemNode>;
}

// ✅ FIX: Use 'any' for the Encoded type parameter to avoid Invariance check failures on recursive types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TiptapListItemNodeSchema: Schema.Schema<TiptapListItemNode, any> =
  Schema.suspend(() =>
    Schema.Struct({
      type: Schema.Literal("listItem"),
      attrs: Schema.optional(StableBlockAttrs),
      content: Schema.Array(
        Schema.Union(
          TiptapParagraphNodeSchema,
          TiptapBulletListNodeSchema, // References the other recursive schema
          TiptapHeadingNodeSchema,
          InteractiveBlockSchema,
          AlertBlockSchema
        ),
      ),
    }),
  );

// ✅ FIX: Use 'any' for the Encoded type parameter here as well
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TiptapBulletListNodeSchema: Schema.Schema<TiptapBulletListNode, any> =
  Schema.suspend(() =>
    Schema.Struct({
      type: Schema.Literal("bulletList"),
      attrs: Schema.optional(StableBlockAttrs),
      content: Schema.Array(TiptapListItemNodeSchema),
    }),
  );

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
  // Removed tenant-related fields from User as they belong to Tenant/Auth context now
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

// TenantMembershipSchema removed or deprecated as membership is now implicit by being in the DB

// ... (Rest of Block Schemas remain unchanged)
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
  latitude: Schema.optional(LatitudeSchema),
  longitude: Schema.optional(LongitudeSchema),
  device_created_at: Schema.optional(LenientDateSchema),
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

const CreateBlockBase = {
  noteId: NoteIdSchema,
  blockId: BlockIdSchema,
  deviceCreatedAt: Schema.optional(LenientDateSchema),
  latitude: Schema.optional(LatitudeSchema),
  longitude: Schema.optional(LongitudeSchema),
  content: Schema.optional(Schema.String),
};

const CreateChecklistBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("form_checklist"),
  fields: ChecklistFieldsSchema,
});

const CreateMeterBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("form_meter"),
  fields: MeterFieldsSchema,
});

const CreateMapBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("map_block"),
  fields: MapBlockFieldsSchema,
});

const CreateTaskBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("task"),
  fields: Schema.Struct({
    is_complete: Schema.optional(Schema.Boolean),
    status: Schema.optional(TaskStatusSchema),
    due_at: Schema.optional(Schema.String),
  }),
});

const CreateImageBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("image"),
  fields: Schema.Struct({
    url: Schema.optional(Schema.NullOr(Schema.String)),
    uploadId: Schema.optional(Schema.NullOr(Schema.String)),
    width: Schema.optional(Schema.Number),
    caption: Schema.optional(Schema.String),
  }),
});

const CreateTiptapTextBlockArgs = Schema.Struct({
  ...CreateBlockBase,
  type: Schema.Literal("tiptap_text"),
  fields: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export const CreateBlockArgsSchema = Schema.Union(
  CreateChecklistBlockArgs,
  CreateMeterBlockArgs,
  CreateMapBlockArgs,
  CreateTaskBlockArgs,
  CreateImageBlockArgs,
  CreateTiptapTextBlockArgs
);
