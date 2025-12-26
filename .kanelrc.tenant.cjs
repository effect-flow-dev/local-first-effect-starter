// FILE: .kanelrc.tenant.js
/* eslint-disable @typescript-eslint/no-var-requires */
const { makeKyselyHook } = require("kanel-kysely");
const { defaultGenerateIdentifierType } = require("kanel");

// --- Argument Parsing (Matches Next.js reference) ---
const dbFlagIndex = process.argv.findIndex((arg) => arg === "--database");
const connectionString =
  dbFlagIndex > -1 ? process.argv[dbFlagIndex + 1] : undefined;

if (!connectionString) {
  throw new Error(
    "Could not find database connection string. Please provide it using the --database flag."
  );
}

const url = new URL(connectionString);
const schemaName = url.searchParams.get("search_path");

if (!schemaName) {
  throw new Error(
    "Could not determine schema from --database connection string (expected ?search_path=...)"
  );
}
// --- End Argument Parsing ---

/** @type {import('kanel').Config} */
module.exports = {
  // Kanel will use the connection string passed via CLI, so we don't need 'connection' here.
  schemas: [schemaName],

  outputPath: "./src/types/generated/tenant",

  typeOverrides: {
    bytea: "Buffer",
  },

  preRenderHooks: [
    // Hook 1: Swap the specific schema name for 'public' in the internal config
    (output, instantiatedConfig) => {
      const dynamicSchemaDetails = instantiatedConfig.schemas[schemaName];

      if (dynamicSchemaDetails) {
        instantiatedConfig.schemas = {
          public: dynamicSchemaDetails,
        };
      }
      return output;
    },
    // Hook 2: Kysely hook
    makeKyselyHook(),
  ],

  // Override ID branding to ensure types are generic (e.g. __brand: 'public.note')
  generateIdentifierType: (column, details, config) => {
    const publicDetails = { ...details, schemaName: "public" };
    return defaultGenerateIdentifierType(column, publicDetails, config);
  },
};
