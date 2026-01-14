 // File: src/db/migrations/tenant-migrations-manifest.ts
    import type { Migration } from "kysely";
    import * as m00 from "../../migrations/tenant/00_init_tenant";
    import * as m01 from "../../migrations/tenant/01_add_hlc_to_history";
    import * as m02 from "../../migrations/tenant/02_convert_versions_to_hlc";
    import * as m03 from "../../migrations/tenant/03_add_entities_and_location_context"; // ✅ NEW

    export const tenantMigrationObjects: Record<string, Migration> = {
      "00_init_tenant": { up: m00.up, down: m00.down },
      "01_add_hlc_to_history": { up: m01.up, down: m01.down },
      "02_convert_versions_to_hlc": { up: m02.up, down: m02.down },
      "03_add_entities_and_location_context": { up: m03.up, down: m03.down }, // ✅ Registered
    };
