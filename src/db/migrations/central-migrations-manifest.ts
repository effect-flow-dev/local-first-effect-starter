// FILE: src/db/migrations/central-migrations-manifest.ts
import type { Migration } from "kysely";
import * as m00 from "../../migrations/central/00_init_central";
import * as m01 from "../../migrations/central/01_add_tenant_strategy";
import * as m02 from "../../migrations/central/02_add_subdomain";
import * as m03 from "../../migrations/central/03_hierarchy_pivot";
import * as m04 from "../../migrations/central/04_add_schema_name_to_tenant";

export const centralMigrationObjects: Record<string, Migration> = {
  "00_init_central": { up: m00.up, down: m00.down },
  "01_add_tenant_strategy": { up: m01.up, down: m01.down },
  "02_add_subdomain": { up: m02.up, down: m02.down },
  "03_hierarchy_pivot": { up: m03.up, down: m03.down },
  "04_add_schema_name_to_tenant": { up: m04.up, down: m04.down },
};
