// FILE: tests/e2e/global-setup.ts
import { Kysely, PostgresDialect, Migrator } from "kysely";
import { Pool } from "pg";
import { config } from "dotenv";
import { centralMigrationObjects } from "../../src/db/migrations/central-migrations-manifest";
import type { Database } from "../../src/types";

config(); // Load env vars

async function globalSetup() {
  console.warn("Global Setup: Ensuring Database Migrations...");

  const connectionString =
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL_LOCAL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("No database connection string found.");
  }

  const pool = new Pool({
    connectionString,
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: () => Promise.resolve(centralMigrationObjects),
    },
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      console.warn(`migration "${it.migrationName}" was executed successfully`);
    } else if (it.status === "Error") {
      console.error(`failed to execute migration "${it.migrationName}"`);
    }
  });

  if (error) {
    console.error("failed to migrate");
    console.error(error);
    // ✅ FIX: Ensure we throw an Error instance
    if (error instanceof Error) throw error;
    throw new Error(JSON.stringify(error));
  }

  await db.destroy();
  console.warn("Global Setup: Migrations Complete.");
}

export default globalSetup;
