//  src/migrations/central/01_add_platform_admins.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
    await db.schema
        .createTable("platform_admin")
        .ifNotExists()
        .addColumn("id", "uuid", (c) =>
            c.primaryKey().defaultTo(sql`gen_random_uuid()`),
        )
        .addColumn("email", "text", (c) => c.notNull().unique())
        .addColumn("password_hash", "text", (c) => c.notNull())
        .addColumn("created_at", "timestamp", (c) =>
            c.notNull().defaultTo(sql`now()`),
        )
        .execute();
        
    // Optional: Seed yourself immediately via SQL if you have a hash ready
}

export async function down(db: Kysely<Database>) {
    await db.schema.dropTable("platform_admin").ifExists().execute();
}
