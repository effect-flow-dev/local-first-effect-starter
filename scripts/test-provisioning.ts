// FILE: scripts/test-provisioning.ts
import { Effect, Exit } from "effect";
import { sql } from "kysely";
import { centralDb } from "../src/db/client";
import { provisionTenant } from "../src/features/auth/auth.service";
import { getTenantConnection } from "../src/db/connection-manager";
import { v4 as uuidv4 } from "uuid";
import type { UserId } from "../src/lib/shared/schemas";

const args = Bun.argv.slice(2);
const strategy = args.includes("--database") ? "database" : "schema";

const testProvisioning = Effect.gen(function* () {
  yield* Effect.logInfo(`🚀 Starting Provisioning Test (${strategy})...`);

  // 1. Create IDs
  const userId = uuidv4() as UserId;
  const consultancyId = uuidv4();
  const tenantId = uuidv4();
  
  const email = `test.prov.${Date.now()}@example.com`;
  const subdomain = `prov-${Date.now()}`; 
  
  let databaseName: string | null = null;
  let schemaName: string | null = null;

  if (strategy === "database") {
      databaseName = `user_${userId.replace(/-/g, "")}`;
  } else {
      schemaName = `user_${userId}`;
  }

  yield* Effect.logInfo(`1. Creating Hierarchy for: ${email}`);

  // 2. Insert Hierarchy
  // User (Global Identity)
  yield* Effect.tryPromise(() =>
    centralDb
      .insertInto("user")
      .values({
        id: userId,
        email: email,
        password_hash: "placeholder_hash",
        email_verified: true,
        permissions: [],
        created_at: new Date()
      })
      .execute()
  );

  // Consultancy
  yield* Effect.tryPromise(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centralDb.insertInto("consultancy" as any)
      .values({
          id: consultancyId,
          name: "Test Consultancy",
          created_at: new Date()
      })
      .execute()
  );

  // Tenant (Configuration lives here now)
  yield* Effect.tryPromise(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centralDb.insertInto("tenant" as any)
      .values({
          id: tenantId,
          consultancy_id: consultancyId,
          name: "Test Tenant",
          subdomain: subdomain,
          tenant_strategy: strategy,
          database_name: databaseName,
          schema_name: schemaName,
          created_at: new Date()
      })
      .execute()
  );

  // Membership
  yield* Effect.tryPromise(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centralDb.insertInto("tenant_membership" as any)
      .values({
          user_id: userId,
          tenant_id: tenantId,
          role: "OWNER",
          joined_at: new Date()
      })
      .execute()
  );

  yield* Effect.logInfo("2. Hierarchy inserted. Starting Provisioning...");

  // 3. Run the Provisioning Logic (Physical Resource Creation)
  // We pass the resource name explicitly now
  const resourceName = strategy === 'database' ? databaseName : schemaName;
   
  yield* provisionTenant(userId, strategy, resourceName!);

  // 4. Verification
  if (strategy === "database" && databaseName) {
      yield* Effect.logInfo(`3. Verifying Database "${databaseName}"...`);
      const tenantDb = getTenantConnection(databaseName);
      try {
          const tables = yield* Effect.promise(() => 
            sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(tenantDb)
          );
          const tableNames = tables.rows.map((r) => r.table_name);
          yield* Effect.logInfo(`   Found tables: ${tableNames.join(", ")}`);
          
          if (!tableNames.includes("note")) throw new Error("Missing 'note' table");
          yield* Effect.logInfo("✅ Database verification successful.");
      } finally {
          yield* Effect.promise(() => tenantDb.destroy());
      }
      
      // Cleanup DB
      yield* Effect.logInfo("   Cleaning up database...");
      yield* Effect.promise(() => sql.raw(`DROP DATABASE "${databaseName}"`).execute(centralDb));

  } else if (schemaName) {
      yield* Effect.logInfo(`3. Verifying schema "${schemaName}"...`);

      const tables = yield* Effect.tryPromise(() =>
        sql<{ table_name: string }>`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = ${schemaName}
          ORDER BY table_name;
        `.execute(centralDb)
      );

      const tableNames = tables.rows.map((r) => r.table_name);
      
      yield* Effect.logInfo(`   Found tables: ${tableNames.join(", ")}`);

      const expectedTables = ["note", "block", "task", "replicache_client"];
      const missing = expectedTables.filter((t) => !tableNames.includes(t));

      if (missing.length > 0) {
        yield* Effect.fail(new Error(`❌ Missing expected tables in tenant schema: ${missing.join(", ")}`));
      }
      
      // Cleanup Schema
      yield* Effect.logInfo("   Cleaning up schema...");
      yield* Effect.promise(() => sql`DROP SCHEMA ${sql.ref(schemaName)} CASCADE`.execute(centralDb));
  }

  // Cleanup Records
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yield* Effect.promise(() => centralDb.deleteFrom("tenant_membership" as any).where("user_id", "=", userId).execute());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yield* Effect.promise(() => centralDb.deleteFrom("tenant" as any).where("id", "=", tenantId).execute());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yield* Effect.promise(() => centralDb.deleteFrom("consultancy" as any).where("id", "=", consultancyId).execute());
  yield* Effect.promise(() => centralDb.deleteFrom("user").where("id", "=", userId).execute());

  yield* Effect.logInfo("✅ SUCCESS: Provisioning test passed!");
});

// Run it
void Effect.runPromiseExit(testProvisioning).then((exit) => {
  if (Exit.isFailure(exit)) {
    console.error(exit);
    process.exit(1);
  }
  process.exit(0);
});
