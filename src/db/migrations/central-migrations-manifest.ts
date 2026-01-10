// FILE: src/db/migrations/central-migrations-manifest.ts
    import type { Migration } from "kysely";
    import * as m00 from "../../migrations/central/00_init_central";
    import * as m01 from "../../migrations/central/01_add_platform_admins";

    /**
     * The central migration manifest tracks all migrations for the Central/Identity database.
     * New central migrations must be registered here to be picked up by the migrator.
     */
    export const centralMigrationObjects: Record<string, Migration> = {
      "00_init_central": { up: m00.up, down: m00.down },
      "01_add_platform_admins": { up: m01.up, down: m01.down },
    };
