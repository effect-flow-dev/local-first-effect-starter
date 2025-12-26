import { Kysely } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("user")
    .addColumn("tenant_strategy", "text", (c) =>
      c.notNull().defaultTo("schema"),
    )
    .addColumn("database_name", "text")
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema
    .alterTable("user")
    .dropColumn("database_name")
    .dropColumn("tenant_strategy")
    .execute();
}
