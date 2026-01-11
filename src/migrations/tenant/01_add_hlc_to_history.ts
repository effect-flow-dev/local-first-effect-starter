// File: ./src/migrations/tenant/01_add_hlc_to_history.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
    // 1. Rename the existing column first. 
    // PostgreSQL requires RENAME COLUMN to be a standalone operation 
    // within an ALTER TABLE block.
    await db.schema
        .alterTable("block_history")
        .renameColumn("timestamp", "device_timestamp")
        .execute();

    // 2. Add the new columns in a second step.
    await db.schema
        .alterTable("block_history")
        .addColumn("hlc_timestamp", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("server_received_at", "timestamp", (c) => 
            c.notNull().defaultTo(sql`now()`)
        )
        .execute();

    // 3. Add the index for the HLC timestamp.
    await db.schema
        .createIndex("block_history_hlc_timestamp_idx")
        .on("block_history")
        .column("hlc_timestamp")
        .execute();
        
    // 4. Remove the temporary default for hlc_timestamp
    await sql`ALTER TABLE block_history ALTER COLUMN hlc_timestamp DROP DEFAULT`.execute(db);
}

export async function down(db: Kysely<Database>) {
    await db.schema
        .alterTable("block_history")
        .dropIndex("block_history_hlc_timestamp_idx")
        .execute();

    // Reverse additions
    await db.schema
        .alterTable("block_history")
        .dropColumn("hlc_timestamp")
        .dropColumn("server_received_at")
        .execute();

    // Reverse rename
    await db.schema
        .alterTable("block_history")
        .renameColumn("device_timestamp", "timestamp")
        .execute();
}
