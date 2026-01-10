// File: src/features/auth/auth.service.ts
import { Effect } from "effect";
import { createDate, TimeSpan } from "oslo";
import {
    Migrator,
    sql,
    CompiledQuery,
    type Kysely,
    type Transaction,
} from "kysely";
import { centralDb, getUserDb, type TenantConfig } from "../../db/client";
import { getTenantConnection } from "../../db/connection-manager";
import { generateId } from "../../lib/server/utils";
import type { UserId } from "../../lib/shared/schemas";
import type { EmailVerificationTokenId } from "../../types/generated/tenant/tenant_template/EmailVerificationToken";
import type { PasswordResetTokenId } from "../../types/generated/tenant/tenant_template/PasswordResetToken";
import type { ConsultancyId } from "../../types/generated/central/public/Consultancy";
import type { TenantId } from "../../types/generated/central/public/Tenant";
import { tenantMigrationObjects } from "../../db/migrations/tenant-migrations-manifest";
import {
    TokenCreationError,
    AuthDatabaseError,
    UserProvisioningError,
} from "./Errors";
import { config } from "../../lib/server/Config";
import { v4 as uuidv4 } from "uuid";
import { PERMISSIONS } from "../../lib/shared/permissions";
import type { Database } from "../../types";

const getBaseUrl = () => {
    if (config.app.nodeEnv === "development") {
        return "http://localhost:3000";
    }
    return "https://" + config.app.rootDomain;
};

export const sendVerificationEmail = (email: string, token: string) =>
    Effect.gen(function* () {
        const baseUrl = getBaseUrl();
        const link = baseUrl + "/verify-email/" + token;
        yield* Effect.logWarning(
            "[EmailService] VERIFICATION LINK for " + email + ": " + link,
        );
    });

export const sendPasswordResetEmail = (email: string, token: string) =>
    Effect.gen(function* () {
        const baseUrl = getBaseUrl();
        const link = baseUrl + "/reset-password/" + token;
        yield* Effect.logWarning(
            "[EmailService] RESET LINK for " + email + ": " + link,
        );
    });

export const createVerificationToken = (
    db: Kysely<Database> | Transaction<Database>,
    userId: UserId,
    email: string,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(
            "[AuthService] Creating verification token for " + email,
        );
        const verificationToken = yield* generateId(40);
        yield* Effect.tryPromise({
            try: () =>
                db
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

export const createPasswordResetToken = (
    db: Kysely<Database> | Transaction<Database>,
    userId: UserId,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(
            "[AuthService] Creating password reset token for " + userId,
        );
        yield* Effect.tryPromise({
            try: () =>
                db
                    .deleteFrom("password_reset_token")
                    .where("user_id", "=", userId)
                    .execute(),
            catch: (cause) => new AuthDatabaseError({ cause }),
        });
        const tokenId = yield* generateId(40);
        yield* Effect.tryPromise({
            try: () =>
                db
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

const provisionPhysicalInfrastructure = (
    strategy: "schema" | "database",
    resourceName: string,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(
            "[Provisioning] Creating physical resource " +
                resourceName +
                " (Strategy: " +
                strategy +
                ")",
        );

        if (strategy === "database") {
            yield* Effect.logInfo(
                "[Provisioning] Strategy is database. Executing CREATE DATABASE.",
            );
            yield* Effect.tryPromise({
                try: () =>
                    sql.raw('CREATE DATABASE "' + resourceName + '"').execute(centralDb),
                catch: (e) => new UserProvisioningError({ cause: e }),
            }).pipe(
                Effect.catchAll((error) => {
                    const cause = error.cause as { code?: string } | undefined;
                    if (cause?.code === "42P04") {
                        return Effect.logInfo("Database " + resourceName + " already exists.");
                    }
                    return Effect.fail(error);
                }),
            );

            const tenantDb = getTenantConnection(resourceName);
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
                yield* Effect.logError(
                    "[Provisioning] Database migrations failed",
                    migrationResult.error,
                );
                return yield* Effect.fail(
                    new UserProvisioningError({ cause: migrationResult.error }),
                );
            }
        } else {
            yield* Effect.logInfo(
                "[Provisioning] Strategy is schema. Executing CREATE SCHEMA.",
            );
            yield* Effect.tryPromise({
                try: async () => {
                    await centralDb.connection().execute(async (conn) => {
                        try {
                            // ✅ Tagged template usage
                            await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(resourceName)}`.execute(
                                conn,
                            );


                            await conn.executeQuery(
                                CompiledQuery.raw(
                                    `SET search_path TO "${resourceName}", public`,
                                ),
                            );

                            const migrator = new Migrator({
                                db: conn,
                                provider: {
                                    getMigrations: () => Promise.resolve(tenantMigrationObjects),
                                },
                                migrationTableSchema: resourceName,
                            });

                            const { error, results } = await migrator.migrateToLatest();

                            if (results) {
                                results.forEach((r) =>
                                    console.info(
                                        `[Provisioning] Migration ${r.migrationName}: ${r.status}`,
                                    ),
                                );
                            }

                            if (error) {
                                const message =
                                    typeof error === "string"
                                        ? error
                                        : JSON.stringify(error);
                                throw error instanceof Error ? error : new Error(message);
                            }
                        } finally {
                            await conn.executeQuery(
                                CompiledQuery.raw("SET search_path TO public"),
                            );
                        }
                    });
                },
                catch: (cause) => new UserProvisioningError({ cause }),
            });
        }
    });

export const createOrganizationHierarchy = (
    userId: UserId,
    email: string,
    passwordHash: string,
    consultancyName: string,
    tenantName: string,
    subdomain: string,
    strategy: "schema" | "database",
) =>
    Effect.gen(function* () {
        const consultancyId = uuidv4() as ConsultancyId;
        const tenantId = uuidv4() as TenantId;

        yield* Effect.logInfo("[Provisioning] Creating hierarchy for " + email);

        yield* Effect.tryPromise({
            try: () =>
                centralDb
                    .insertInto("consultancy")
                    .values({
                        id: consultancyId,
                        name: consultancyName,
                        created_at: new Date(),
                    })
                    .execute(),
            catch: (cause) => new AuthDatabaseError({ cause }),
        });

        const schemaName =
            strategy === "schema"
                ? "tenant_" + tenantId.replace(/-/g, "")
                : null;
        const dbName =
            strategy === "database"
                ? "tenant_db_" + tenantId.replace(/-/g, "")
                : null;

        yield* Effect.logInfo("[Provisioning] Creating tenant record: " + subdomain);
        yield* Effect.tryPromise({
            try: () =>
                centralDb
                    .insertInto("tenant")
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

        yield* provisionPhysicalInfrastructure(strategy, (dbName || schemaName)!);

        const tenantConfig: TenantConfig = {
            id: tenantId,
            tenant_strategy: strategy,
            database_name: dbName,
            schema_name: schemaName,
        };
        const userDb = getUserDb(tenantConfig);

        yield* Effect.logInfo(
            "[Provisioning] Creating local user account in tenant store.",
        );

        const permissions = Object.values(PERMISSIONS);

        yield* Effect.tryPromise({
            try: () =>
                userDb
                    .insertInto("user")
                    .values({
                        id: userId,
                        email,
                        password_hash: passwordHash,
                        email_verified: false,
                        permissions,
                        created_at: new Date(),
                    })
                    .execute(),
            catch: (cause) => new AuthDatabaseError({ cause }),
        });

        const token = yield* createVerificationToken(userDb, userId, email);
        yield* sendVerificationEmail(email, token);

        yield* Effect.logInfo("[Provisioning] Hierarchy completed for " + email);

        return { consultancyId, tenantId };
    });

export const provisionTenant = (
    _userId: UserId,
    strategy: "schema" | "database",
    resourceNameOverride: string,
) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(
            "[Provisioning] Starting manual provision for: " + resourceNameOverride,
        );
        yield* provisionPhysicalInfrastructure(strategy, resourceNameOverride);
    });
