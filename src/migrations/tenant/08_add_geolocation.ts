// File: ./src/migrations/tenant/08_add_geolocation.ts
import { Kysely } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  await db.schema
    .alterTable("block")
    .addColumn("latitude", "double precision")
    .addColumn("longitude", "double precision")
    .execute();
}

export async function down(db: Kysely<Database>) {
  await db.schema
    .alterTable("block")
    .dropColumn("longitude")
    .dropColumn("latitude")
    .execute();
}
