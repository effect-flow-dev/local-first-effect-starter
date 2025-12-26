// FILE: .kanelrc.central.js
/* eslint-disable @typescript-eslint/no-var-requires */
require("dotenv").config();
const { makeKyselyHook } = require("kanel-kysely");

// --- Connection Config Logic (Matches Reference) ---
const useLocalProxy = process.env.USE_LOCAL_NEON_PROXY === "true";
let connectionConfig;

if (useLocalProxy) {
  const localDbUrl = new URL(
    process.env.DATABASE_URL_LOCAL ||
      "postgres://postgres:postgres@db.localtest.me:5432/main"
  );
  connectionConfig = {
    host: localDbUrl.hostname,
    port: parseInt(localDbUrl.port, 10),
    user: localDbUrl.username,
    password: localDbUrl.password,
    database: localDbUrl.pathname.slice(1),
  };
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[.kanelrc.central.js] DATABASE_URL is not defined for cloud mode. Kanel cannot connect."
    );
  }
  const cloudDbUrl = new URL(process.env.DATABASE_URL);
  connectionConfig = {
    host: cloudDbUrl.hostname,
    port: cloudDbUrl.port ? parseInt(cloudDbUrl.port, 10) : 5432,
    user: cloudDbUrl.username,
    password: cloudDbUrl.password,
    database: cloudDbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  };
}
// ---------------------------------------------------

/** @type {import('kanel').Config} */
module.exports = {
  connection: connectionConfig,

  // Explicitly tell Kanel to only process the 'public' schema for Central types
  schemas: ["public"],

  // Matches reference: Only exclude internal migration tables.
  // We trust that the 'public' schema ONLY contains the tables defined in our central migrations.
  typeFilter: (pgType) => {
    const lowerName = pgType.name.toLowerCase();
    return (
      lowerName !== "kysely_migration_lock" && lowerName !== "kysely_migration"
    );
  },

  outputPath: "./src/types/generated/central",

  preDeleteOutputFolder: true,
  preRenderHooks: [makeKyselyHook()],
};
