// FILE: src/types.ts
// We combine the generated types from both Central (User, Auth) and Tenant (Notes, Blocks)
// so that the application has visibility of the entire schema structure.

import type CentralDatabase from "./types/generated/central/Database";
import type TenantDatabase from "./types/generated/tenant/Database";

// Intersection type gives us { user: ... } & { note: ... }
export type Database = CentralDatabase & TenantDatabase;
