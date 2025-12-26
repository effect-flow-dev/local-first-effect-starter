// FILE: src/migrations/tenant/05_shred_legacy_content.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";
import { parseContentToBlocks } from "../../lib/shared/content-parser";
import type { TiptapDoc } from "../../lib/shared/schemas";

export async function up(db: Kysely<Database>) {
  // 1. Find all notes that do NOT have any blocks yet
  // We join block table to check for existence
  // ✅ FIX: Use explicit builder 'eb' to avoid unbound method access on destructuring
  const notesToMigrate = await db
    .selectFrom("note")
    .selectAll()
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom("block")
            .select("id")
            .whereRef("block.note_id", "=", "note.id")
        )
      )
    )
    .execute();

  if (notesToMigrate.length === 0) {
    console.info("No legacy notes found to migrate.");
    return;
  }

  console.info(`Found ${notesToMigrate.length} legacy notes to shred into blocks.`);

  for (const note of notesToMigrate) {
    try {
      // Cast content to TiptapDoc (assuming legacy content matches schema)
      const content = note.content as TiptapDoc;
      
      // Use shared logic to generate block structures
      // We pass the note's existing user_id and ID
      // The parser generates new UUIDs for the blocks
      const blocks = parseContentToBlocks(note.id, note.user_id, content);

      if (blocks.length > 0) {
        // Insert blocks
        await db
          .insertInto("block")
          .values(
            blocks.map((b) => ({
              id: b.id,
              note_id: b.note_id,
              user_id: b.user_id,
              type: b.type,
              content: b.content,
              fields: JSON.stringify(b.fields), // Ensure JSONB compatibility
              tags: b.tags,
              links: b.links,
              transclusions: b.transclusions,
              file_path: b.file_path,
              parent_id: b.parent_id,
              depth: b.depth,
              order: b.order,
              version: 1, // Initialize at version 1
              created_at: note.created_at, // Preserve note's timestamp approximation
              updated_at: new Date(),
              global_version: sql`nextval('global_version_seq')`, // Assign new sync tick
            }))
          )
          .execute();
          
        console.info(`Migrated note ${note.id}: Created ${blocks.length} blocks.`);
      }
    } catch (e) {
      console.error(`Failed to migrate note ${note.id}`, e);
      // We continue to the next note to avoid blocking the whole migration for one bad record
    }
  }
}

// ✅ FIX: Prefix unused var with _ and ensure it returns Promise (async) to satisfy linter
export async function down(_db: Kysely<Database>) {
  // Safe rollback: Do nothing. The existence of blocks doesn't break the old logic 
  // if the 'note' table still has content (which it does).
  console.info("05_shred_legacy_content: Down migration is a no-op to prevent data loss.");
  // ✅ FIX: satisfy require-await
  await Promise.resolve();
}
