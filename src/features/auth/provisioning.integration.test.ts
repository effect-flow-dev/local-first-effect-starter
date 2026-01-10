// FILE: src/features/auth/provisioning.integration.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { Effect } from "effect";
import { sql } from "kysely";
import { centralDb } from "../../db/client";
import { provisionTenant } from "./auth.service";
import { v4 as uuidv4 } from "uuid";
import type { UserId } from "../../lib/shared/schemas";
import { getTenantConnection, closeAllConnections } from "../../db/connection-manager";

describe("Provisioning Service (Integration)", () => {
  
  afterAll(async () => {
    await closeAllConnections();
    await centralDb.destroy();
  });

  const generateHierarchy = (strategy: "schema" | "database") => {
    const userId = uuidv4() as UserId;
    const consultancyId = uuidv4();
    const tenantId = uuidv4();
    const email = `test.${userId}@example.com`;
    const subdomain = `test-${userId}`;
    const schemaName = strategy === 'schema' ? `user_${userId}` : null;
    const dbName = strategy === 'database' ? `test_db_${userId.replace(/-/g, "")}` : null;
    
    return { userId, consultancyId, tenantId, email, subdomain, schemaName, dbName };
  };

  it("should provision a Schema-based tenant", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { userId, consultancyId, tenantId, email, subdomain, schemaName } = generateHierarchy("schema");

        // 1. Setup Hierarchy
        // Note: Central User table no longer exists, skipping user insert in Central.
        
        yield* Effect.promise(() => 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            centralDb.insertInto("consultancy" as any).values({ id: consultancyId, name: "C1", created_at: new Date() }).execute()
        );
        
        yield* Effect.promise(() => 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            centralDb.insertInto("tenant" as any).values({ 
            id: tenantId, 
            consultancy_id: consultancyId, 
            name: "T1", 
            subdomain, 
            tenant_strategy: "schema", 
            schema_name: schemaName, 
            created_at: new Date() 
        }).execute());
        
        // Removed tenant_membership insert

        // 2. Provision
        // Use ! assertion
        yield* provisionTenant(userId, "schema", schemaName!);

        // 3. Verify Schema Exists
        const result = yield* Effect.promise(() => 
            sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schemaName}`.execute(centralDb)
        );
        expect(result.rows.length).toBe(1);

        // 4. Verify Tables in Schema
        const tables = yield* Effect.promise(() => 
            sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${schemaName}`.execute(centralDb)
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableNames = tables.rows.map((r: any) => r.table_name);
        expect(tableNames).toContain("note");
        expect(tableNames).toContain("block");
        expect(tableNames).toContain("user"); // User table should be here now

        // Cleanup
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        yield* Effect.promise(() => sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName!)} CASCADE`.execute(centralDb));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield* Effect.promise(() => centralDb.deleteFrom("tenant" as any).where("id", "=", tenantId).execute());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield* Effect.promise(() => centralDb.deleteFrom("consultancy" as any).where("id", "=", consultancyId).execute());
      })
    );
  });

  it("should provision a Database-based tenant", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { userId, consultancyId, tenantId, email, subdomain, dbName } = generateHierarchy("database");

        // 1. Setup Hierarchy
        yield* Effect.promise(() => 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            centralDb.insertInto("consultancy" as any).values({ id: consultancyId, name: "C2", created_at: new Date() }).execute()
        );
        
        yield* Effect.promise(() => 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            centralDb.insertInto("tenant" as any).values({ 
            id: tenantId, 
            consultancy_id: consultancyId, 
            name: "T2", 
            subdomain, 
            tenant_strategy: "database", 
            database_name: dbName, 
            created_at: new Date() 
        }).execute());

        // 2. Provision
        // Use ! assertion
        yield* provisionTenant(userId, "database", dbName!);

        // 3. Verify Connection & Tables
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const tenantDb = getTenantConnection(dbName!);
        
        const result = yield* Effect.promise(() => 
            tenantDb.selectFrom("note").selectAll().execute()
        );
        
        expect(Array.isArray(result)).toBe(true);

        // Cleanup
        yield* Effect.promise(() => tenantDb.destroy());
        yield* Effect.promise(() => sql.raw(`DROP DATABASE IF EXISTS "${dbName}"`).execute(centralDb));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield* Effect.promise(() => centralDb.deleteFrom("tenant" as any).where("id", "=", tenantId).execute());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        yield* Effect.promise(() => centralDb.deleteFrom("consultancy" as any).where("id", "=", consultancyId).execute());
      })
    );
  });
});
