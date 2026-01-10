// FILE: scripts/test-provisioning.ts
import { Effect, Exit } from "effect";
import { sql } from "kysely";
import { centralDb, getUserDb, type TenantConfig } from "../src/db/client";
import { provisionTenant } from "../src/features/auth/auth.service";
import { closeAllConnections } from "../src/db/connection-manager";
import { v4 as uuidv4 } from "uuid";
import type { UserId } from "../src/lib/shared/schemas";
import type { ConsultancyId } from "../src/types/generated/central/public/Consultancy";
import type { TenantId } from "../src/types/generated/central/public/Tenant";
import { PERMISSIONS } from "../src/lib/shared/permissions";

const args = Bun.argv.slice(2);
const strategy = args.includes("--database") ? "database" : "schema";

const testProvisioning = Effect.gen(function* () {
  yield* Effect.logInfo(`🚀 Starting Provisioning Test (${strategy})...`);

  // 1. Create IDs
  const userId = uuidv4() as UserId;
  const consultancyId = uuidv4() as ConsultancyId;
  const tenantId = uuidv4() as TenantId;
  
  const email = `test.prov.${Date.now()}@example.com`;
  const subdomain = `prov-${Date.now()}`; 
  
  let databaseName: string | null = null;
  let schemaName: string | null = null;

  if (strategy === "database") {
      databaseName = `test_db_${tenantId.replace(/-/g, "")}`;
  } else {
      schemaName = `test_schema_${tenantId.replace(/-/g, "")}`;
  }

  yield* Effect.logInfo(`1. Creating Routing Entry for: ${subdomain}`);

  // 2. Insert Central Routing Data (Only Tenant & Consultancy)
  yield* Effect.tryPromise(() =>
    centralDb
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insertInto("consultancy" as any)
      .values({
          id: consultancyId,
          name: "Test Consultancy",
          created_at: new Date()
      })
      .execute()
  );

  yield* Effect.tryPromise(() =>
    centralDb
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insertInto("tenant" as any)
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

  yield* Effect.logInfo("2. Routing ready. Starting Infrastructure Provisioning...");

  // 3. Run the Provisioning Logic (Physical Resource Creation)
  const resourceName = strategy === 'database' ? databaseName : schemaName;
  yield* provisionTenant(userId, strategy, resourceName!);

  // 4. Verification & User Insertion
  const tenantConfig: TenantConfig = {
      id: tenantId,
      tenant_strategy: strategy,
      database_name: databaseName,
      schema_name: schemaName
  };

  const tenantDb = getUserDb(tenantConfig);

  yield* Effect.logInfo("3. Connecting to Tenant DB to insert Admin User...");

  // Insert User into Tenant DB
  yield* Effect.tryPromise(() => 
      tenantDb.insertInto("user")
        .values({
            id: userId,
            email: email,
            password_hash: "hash",
            email_verified: true,
            permissions: Object.values(PERMISSIONS),
            created_at: new Date()
        })
        .execute()
  );

  // Verify User Exists
  const user = yield* Effect.tryPromise(() => 
      tenantDb.selectFrom("user").selectAll().where("id", "=", userId).executeTakeFirst()
  );

  if (!user) {
      yield* Effect.fail(new Error("❌ Failed to verify user in tenant DB"));
  }
  yield* Effect.logInfo(`✅ User verified in ${strategy === 'database' ? databaseName : schemaName}`);

  // 5. Cleanup
  yield* Effect.logInfo("4. Cleaning up...");

  if (strategy === "database" && databaseName) {
      yield* Effect.promise(() => tenantDb.destroy());
      yield* Effect.promise(() => sql.raw(`DROP DATABASE "${databaseName}"`).execute(centralDb));
  } else if (schemaName) {
      yield* Effect.promise(() => sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(centralDb));
  }

  yield* Effect.tryPromise(() => centralDb.deleteFrom("tenant").where("id", "=", tenantId).execute());
  yield* Effect.tryPromise(() => centralDb.deleteFrom("consultancy").where("id", "=", consultancyId).execute());

  yield* Effect.logInfo("✅ SUCCESS: Provisioning test passed!");
});

// Run it
void Effect.runPromiseExit(testProvisioning).then((exit) => {
  // Ensure connections close so script exits
  void closeAllConnections().then(() => {
    if (Exit.isFailure(exit)) {
        console.error(exit);
        process.exit(1);
    }
    process.exit(0);
  });
});
