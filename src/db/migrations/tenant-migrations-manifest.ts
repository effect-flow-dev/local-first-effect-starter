// FILE: src/db/migrations/tenant-migrations-manifest.ts
import type { Migration } from "kysely";
import * as m00 from "../../migrations/tenant/00_init_tenant";

export const tenantMigrationObjects: Record<string, Migration> = {
  "00_init_tenant": { up: m00.up, down: m00.down },
};
