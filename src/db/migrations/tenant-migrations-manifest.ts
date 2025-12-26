// FILE: src/db/migrations/tenant-migrations-manifest.ts
import type { Migration } from "kysely";
import * as m00 from "../../migrations/tenant/00_init_tenant";
import * as m01 from "../../migrations/tenant/01_add_versioning_and_history";
import * as m02 from "../../migrations/tenant/02_add_global_version_and_tombstones";
import * as m03 from "../../migrations/tenant/03_backfill_global_versions";
import * as m04 from "../../migrations/tenant/04_add_notebooks";
import * as m05 from "../../migrations/tenant/05_shred_legacy_content"; // ✅ Added
import * as m06 from "../../migrations/tenant/06_optimize_link_indexing";

export const tenantMigrationObjects: Record<string, Migration> = {
  "00_init_tenant": { up: m00.up, down: m00.down },
  "01_add_versioning_and_history": { up: m01.up, down: m01.down },
  "02_add_global_version_and_tombstones": { up: m02.up, down: m02.down },
  "03_backfill_global_versions": { up: m03.up, down: m03.down },
  "04_add_notebooks": { up: m04.up, down: m04.down },
  "05_shred_legacy_content": { up: m05.up, down: m05.down }, // ✅ Registered
  "06_optimize_link_indexing": { up: m06.up, down: m06.down }, // ✅ Registered
};
