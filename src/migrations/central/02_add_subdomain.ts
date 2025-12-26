// FILE: src/migrations/central/02_add_subdomain.ts
import { Kysely, sql } from "kysely";
import type { Database } from "../../types";

export async function up(db: Kysely<Database>) {
  // 1. Add column as nullable first
  await db.schema.alterTable("user").addColumn("subdomain", "text").execute();

  // 2. Backfill existing users
  const users = await db
    .selectFrom("user")
    .select(["id", "email"])
    .execute();

  for (const user of users) {
    const namePart = user.email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const generatedSubdomain = `${namePart}-${randomSuffix}`;

    await db
      .updateTable("user")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      .set({ subdomain: generatedSubdomain } as any) 
      .where("id", "=", user.id)
      .execute();
  }

  // 3. Add constraints
  await db.schema
    .alterTable("user")
    .alterColumn("subdomain", (col) => col.setNotNull())
    .execute();

  await db.schema
    .alterTable("user")
    .addUniqueConstraint("user_subdomain_key", ["subdomain"])
    .execute();
    
  // 4. Add validation constraint
  await sql`
    ALTER TABLE "user" 
    ADD CONSTRAINT check_subdomain_format 
    CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
  `.execute(db);
}

export async function down(db: Kysely<Database>) {
  await db.schema.alterTable("user").dropConstraint("check_subdomain_format").execute();
  await db.schema.alterTable("user").dropColumn("subdomain").execute();
}
