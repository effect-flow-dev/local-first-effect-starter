// File: src/migrations/tenant/02_convert_versions_to_hlc.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

/**
 * Migration to convert all global_version columns from bigint to text.
 * This enables the storage of sortable HLC strings and resolves
 * type collision errors in mutations.
 */
export async function up(db: Kysely<Database>) {
    // 1. Drop the legacy sequence since HLC provides causal ordering
    await sql`DROP SEQUENCE IF EXISTS global_version_seq`.execute(db);

    // 2. Convert core entity version columns to text
    const tablesToAlter = ["note", "block", "task", "notebook"];

    for (const table of tablesToAlter) {
        await sql`
            ALTER TABLE ${sql.table(table)} 
            ALTER COLUMN global_version TYPE text 
            USING global_version::text
        `.execute(db);
    }

    // 3. Convert tombstone deleted_at_version to text
    await sql`
        ALTER TABLE tombstone 
        ALTER COLUMN deleted_at_version TYPE text 
        USING deleted_at_version::text
    `.execute(db);
    
}

export async function down(db: Kysely<Database>) {
    // Reverse conversion: This is technically data-lossy if HLC strings contain non-numeric data,
    // but for development safety we try to cast back to bigint.
    
    const tablesToAlter = ["note", "block", "task", "notebook"];

    for (const table of tablesToAlter) {
        await sql`
            ALTER TABLE ${sql.table(table)} 
            ALTER COLUMN global_version TYPE bigint 
            USING (split_part(global_version, ':', 1))::bigint
        `.execute(db);
    }

    await sql`
        ALTER TABLE tombstone 
        ALTER COLUMN deleted_at_version TYPE bigint 
        USING (split_part(deleted_at_version, ':', 1))::bigint
    `.execute(db);

    // Recreate the sequence
    await sql`CREATE SEQUENCE IF NOT EXISTS global_version_seq`.execute(db);
}
