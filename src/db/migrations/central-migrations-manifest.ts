// FILE: src/db/migrations/central-migrations-manifest.ts
import type { Migration } from "kysely";
import * as m00 from "../../migrations/central/00_init_central";

export const centralMigrationObjects: Record<string, Migration> = {
  "00_init_central": { up: m00.up, down: m00.down },
};
