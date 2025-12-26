// FILE: src/features/auth/auth.service.ts
import { Effect } from "effect";
import { createDate, TimeSpan } from "oslo";
import { Migrator, sql, CompiledQuery } from "kysely";
import { centralDb } from "../../db/client"; 
import { getTenantConnection } from "../../db/connection-manager";
import { generateId } from "../../lib/server/utils";
import type { UserId } from "../../lib/shared/schemas";
import type { EmailVerificationTokenId } from "../../types/generated/public/EmailVerificationToken";
import type { PasswordResetTokenId } from "../../types/generated/public/PasswordResetToken";
import { tenantMigrationObjects } from "../../db/migrations/tenant-migrations-manifest";
import {
  TokenCreationError,
  AuthDatabaseError,
  UserProvisioningError,
} from "./Errors";
import { config } from "../../lib/server/Config"; 
import { v4 as uuidv4 } from "uuid";

const getBaseUrl = () => {
  if (config.app.nodeEnv === "development") {
    return "http://localhost:3000";
  }
  return `https://${config.app.rootDomain}`;
};

export const sendVerificationEmail = (email: string, token: string) =>
  Effect.gen(function* () {
    const baseUrl = getBaseUrl();
    const link = `${baseUrl}/verify-email/${token}`;
    yield* Effect.logWarning(`[EmailService] VERIFICATION LINK for ${email}: ${link}`);
  });

export const sendPasswordResetEmail = (email: string, token: string) =>
  Effect.gen(function* () {
    const baseUrl = getBaseUrl();
    const link = `${baseUrl}/reset-password/${token}`;
    yield* Effect.logWarning(`[EmailService] RESET LINK for ${email}: ${link}`);
  });

export const createVerificationToken = (userId: UserId, email: string) =>
  Effect.gen(function* () {
    const verificationToken = yield* generateId(40);
    yield* Effect.tryPromise({
      try: () =>
        centralDb
          .withSchema("public") // ✅ FIX: Explicit schema
          .insertInto("email_verification_token")
          .values({
            id: verificationToken as EmailVerificationTokenId,
            user_id: userId,
            email: email,
            expires_at: createDate(new TimeSpan(2, "h")),
          })
          .execute(),
      catch: (cause) => new TokenCreationError({ cause }),
    });
    return verificationToken;
  });

export const createPasswordResetToken = (userId: UserId) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        centralDb
          .withSchema("public") // ✅ FIX: Explicit schema
          .deleteFrom("password_reset_token")
          .where("user_id", "=", userId)
          .execute(),
      catch: (cause) => new AuthDatabaseError({ cause }),
    });
    const tokenId = yield* generateId(40);
    yield* Effect.tryPromise({
      try: () =>
        centralDb
          .withSchema("public") // ✅ FIX: Explicit schema
          .insertInto("password_reset_token")
          .values({
            id: tokenId as PasswordResetTokenId,
            user_id: userId,
            expires_at: createDate(new TimeSpan(2, "h")),
          })
          .execute(),
      catch: (cause) => new TokenCreationError({ cause }),
    });
    return tokenId;
  });

/**
 * Low-level helper: Provisions the actual Postgres Schema or Database
 */
const provisionPhysicalInfrastructure = (
  strategy: "schema" | "database",
  resourceName: string, // db name or schema name
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `[Provisioning] Creating physical resource '${resourceName}' (Strategy: ${strategy})`,
    );

    if (strategy === "database") {
      yield* Effect.tryPromise({
        try: () =>
          sql.raw(`CREATE DATABASE "${resourceName}"`).execute(centralDb),
        catch: (e) => new UserProvisioningError({ cause: e }),
      }).pipe(
        Effect.catchAll((error) => {
          const cause = error.cause as { code?: string } | undefined;
          if (cause?.code === "42P04") {
            return Effect.logInfo(`Database ${resourceName} already exists.`);
          }
          return Effect.fail(error);
        }),
      );

      const tenantDb = getTenantConnection(resourceName);
      yield* Effect.logInfo(`Running migrations on database: ${resourceName}`);
      
      const migrationResult = yield* Effect.promise(() => {
        const migrator = new Migrator({
          db: tenantDb,
          provider: {
            getMigrations: () => Promise.resolve(tenantMigrationObjects),
          },
        });
        return migrator.migrateToLatest();
      });

      if (migrationResult.error) {
        return yield* Effect.fail(new UserProvisioningError({ cause: migrationResult.error }));
      }

    } else {
      // Strategy: Schema
      yield* Effect.tryPromise({
        try: async () => {
          // We must use a raw connection to set search_path safely
          await centralDb.connection().execute(async (conn) => {
             try {
                 // A. Create Schema
                 await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(resourceName)}`.execute(conn);

                 // B. Set search path for this migration session
                 await conn.executeQuery(
                   CompiledQuery.raw(`SET search_path TO "${resourceName}", public`)
                 );

                 // C. Run Migrations
                 const migrator = new Migrator({
                   db: conn,
                   provider: {
                     getMigrations: () => Promise.resolve(tenantMigrationObjects),
                   },
                   migrationTableSchema: resourceName,
                 });

                 const { error } = await migrator.migrateToLatest();
                 if (error) {
                     throw error instanceof Error 
                        ? error 
                        : new Error(typeof error === "string" ? error : JSON.stringify(error));
                 }
             } finally {
                 // ✅ FIX: Reset search path to avoid polluting the connection pool
                 await conn.executeQuery(CompiledQuery.raw(`SET search_path TO public`));
             }
          });
        },
        catch: (cause) => new UserProvisioningError({ cause }),
      });
    }
  });

/**
 * Orchestrates the creation of Consultancy, Tenant, Membership, and Infrastructure.
 */
export const createOrganizationHierarchy = (
  userId: UserId,
  email: string,
  consultancyName: string,
  tenantName: string,
  subdomain: string,
  strategy: "schema" | "database"
) => Effect.gen(function* () {
    const consultancyId = uuidv4();
    const tenantId = uuidv4();

    // 1. Create Consultancy
    yield* Effect.tryPromise({
        try: () => centralDb
            .withSchema("public") // ✅ FIX
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insertInto("consultancy" as any)
            .values({
                id: consultancyId,
                name: consultancyName,
                created_at: new Date(),
            })
            .execute(),
        catch: (cause) => new AuthDatabaseError({ cause }),
    });

    // 2. Determine Resource Names
    const schemaName = strategy === 'schema' ? `tenant_${tenantId.replace(/-/g, "")}` : null;
    const dbName = strategy === 'database' ? `tenant_db_${tenantId.replace(/-/g, "")}` : null;

    // 3. Create Tenant Record
    yield* Effect.tryPromise({
        try: () => centralDb
            .withSchema("public") // ✅ FIX
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insertInto("tenant" as any)
            .values({
                id: tenantId,
                consultancy_id: consultancyId,
                name: tenantName,
                subdomain,
                tenant_strategy: strategy,
                database_name: dbName,
                schema_name: schemaName,
                created_at: new Date(),
            })
            .execute(),
        catch: (cause) => new AuthDatabaseError({ cause }),
    });

    // 4. Create Membership (OWNER)
    yield* Effect.tryPromise({
        try: () => centralDb
            .withSchema("public") // ✅ FIX
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insertInto("tenant_membership" as any)
            .values({
                user_id: userId,
                tenant_id: tenantId,
                role: "OWNER",
                joined_at: new Date(),
            })
            .execute(),
        catch: (cause) => new AuthDatabaseError({ cause }),
    });

    // 5. Provision Infrastructure
    yield* provisionPhysicalInfrastructure(strategy, (dbName || schemaName)!);

    return { consultancyId, tenantId };
});

export const provisionTenant = (
    _userId: UserId,
    strategy: "schema" | "database",
    resourceNameOverride?: string
) => Effect.gen(function*(){
    let resourceName = "";
    if (strategy === 'database') {
        if (!resourceNameOverride) throw new Error("DB Name required for database strategy");
        resourceName = resourceNameOverride;
    } else {
        resourceName = resourceNameOverride || `user_${_userId}`;
    }
    yield* provisionPhysicalInfrastructure(strategy, resourceName);
});
