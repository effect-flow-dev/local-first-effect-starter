// File: src/db/seed.ts
import { PERMISSIONS } from '../lib/shared/permissions';
import type { UserId } from '../types/generated/tenant/tenant_template/User';
import type { ConsultancyId } from '../types/generated/central/public/Consultancy';
import type { TenantId } from '../types/generated/central/public/Tenant';
import type { PlatformAdminId } from '../types/generated/central/public/PlatformAdmin';
import { Argon2id } from 'oslo/password';
import { Effect, Cause, Exit, Data } from 'effect';
import { centralDb, getUserDb, type TenantConfig } from './client';
import { provisionTenant } from '../features/auth/auth.service';
import { v4 as uuidv4 } from 'uuid';
import type { NoteId, BlockId } from '../lib/shared/schemas';
// ✅ NEW: Import HLC utilities
import { initHlc, packHlc } from '../lib/shared/hlc';

class SeedingError extends Data.TaggedError('SeedingError')<{
    readonly cause: unknown;
}> {}

class PasswordHashingError extends Data.TaggedError('PasswordHashingError')<{
    readonly cause: unknown;
}> {}

const PASSWORD = 'password123';

// ✅ Initialize a standard SYSTEM clock for seeding
const SYSTEM_HLC = packHlc(initHlc("SYSTEM"));

const seedPlatformAdmin = (email: string, password: string) =>
    Effect.gen(function* () {
        yield* Effect.logInfo('[Seed] Starting Platform Admin seed for: ' + email);

        const argon2id = new Argon2id();
        const hashedPassword = yield* Effect.tryPromise({
            try: () => argon2id.hash(password),
            catch: (cause) => new PasswordHashingError({ cause }),
        });

        yield* Effect.tryPromise({
            try: () =>
                centralDb
                    .insertInto('platform_admin')
                    .values({
                        id: uuidv4() as PlatformAdminId,
                        email: email,
                        password_hash: hashedPassword,
                        created_at: new Date(),
                    })
                    .onConflict((oc) => oc.column('email').doNothing())
                    .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });
        
        yield* Effect.logInfo('[Seed] Platform Admin ' + email + ' seeded successfully.');
    });

const seedHierarchy = (
    email: string,
    strategy: 'schema' | 'database',
    preferredUserId?: string,
) =>
    Effect.gen(function* () {
        const userId = (preferredUserId || uuidv4()) as UserId;
        const consultancyId = uuidv4() as ConsultancyId;
        const tenantId = uuidv4() as TenantId;
        
        yield* Effect.logInfo('[Seed] Starting Hierarchy seed for ' + email + ' with strategy ' + strategy);

        const argon2id = new Argon2id();
        const hashedPassword = yield* Effect.tryPromise({
            try: () => argon2id.hash(PASSWORD),
            catch: (cause) => new PasswordHashingError({ cause }),
        });

        const defaultPerms = Object.values(PERMISSIONS);

        yield* Effect.logInfo('[Seed] Creating consultancy: ' + consultancyId);
        yield* Effect.tryPromise({
            try: () => centralDb
                .insertInto('consultancy')
                .values({
                    id: consultancyId,
                    name: email.split('@')[0] + ' Global',
                })
                .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });

        const emailLocalPart = email.split('@')[0] ?? 'user';
        const subdomain = emailLocalPart.toLowerCase().replace(/[^a-z0-9]/g, '-');
        
        const schemaName = strategy === 'schema' ? 'tenant_' + tenantId.replace(/-/g, '') : null;
        const dbName = strategy === 'database' ? 'tenant_db_' + tenantId.replace(/-/g, '') : null;

        yield* Effect.logInfo('[Seed] Creating tenant ' + tenantId + ' at subdomain ' + subdomain);
        yield* Effect.tryPromise({
            try: () => centralDb
                .insertInto('tenant')
                .values({
                    id: tenantId,
                    consultancy_id: consultancyId,
                    name: emailLocalPart + ' ' + strategy.toUpperCase() + ' Site',
                    subdomain: subdomain,
                    tenant_strategy: strategy,
                    database_name: dbName,
                    schema_name: schemaName,
                    created_at: new Date(),
                })
                .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });

        yield* Effect.logWarning('[Seed] PROVISIONING WORKSPACE: http://' + subdomain + '.localhost:3000');

        yield* Effect.logInfo('[Seed] Running infrastructure provisioning for ' + strategy);
        yield* provisionTenant(userId, strategy, (strategy === 'database' ? dbName : schemaName)!);

        const userConfig: TenantConfig = {
            id: tenantId,
            tenant_strategy: strategy,
            database_name: dbName || null,
            schema_name: schemaName,
        };

        const tenantDb = getUserDb(userConfig);

        yield* Effect.logInfo('[Seed] Inserting user ' + userId + ' into tenant database');
        yield* Effect.tryPromise({
            try: () => tenantDb
                .insertInto('user')
                .values({
                    id: userId,
                    email: email,
                    password_hash: hashedPassword,
                    permissions: defaultPerms,
                    email_verified: true,
                    created_at: new Date(),
                })
                .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });

        const noteId = uuidv4() as NoteId;
        const blockId = uuidv4() as BlockId;

        yield* Effect.logInfo('[Seed] Creating initial note ' + noteId + ' for user');
        yield* Effect.tryPromise({
            try: async () => {
                await tenantDb
                    .insertInto('note')
                    .values({
                        id: noteId,
                        user_id: userId,
                        title: 'Welcome to ' + strategy.toUpperCase() + ' Mode',
                        content: {
                            type: 'doc',
                            content: [
                                {
                                    type: 'paragraph',
                                    attrs: { blockId },
                                    content: [
                                        {
                                            type: 'text',
                                            text: 'This note is stored in a ' + strategy + '-isolated tenant.',
                                        },
                                    ],
                                },
                            ],
                        },
                        version: 1,
                        created_at: new Date(),
                        updated_at: new Date(),
                        // ✅ NEW: Provide HLC Version
                        global_version: SYSTEM_HLC
                    })
                    .execute();

                await tenantDb
                    .insertInto('block')
                    .values({
                        id: blockId,
                        user_id: userId,
                        note_id: noteId,
                        type: 'paragraph',
                        content: 'This note is stored in a ' + strategy + '-isolated tenant.',
                        file_path: '',
                        depth: 0,
                        order: 0,
                        fields: {},
                        tags: [],
                        links: [],
                        transclusions: [],
                        version: 1,
                        created_at: new Date(),
                        updated_at: new Date(),
                        // ✅ NEW: Provide HLC Version
                        global_version: SYSTEM_HLC
                    })
                    .execute();
            },
            catch: (cause) => new SeedingError({ cause }),
        });

        if (strategy === 'database') {
            yield* Effect.logInfo('[Seed] Destroying dedicated tenant pool for ' + dbName);
            yield* Effect.promise(() => tenantDb.destroy());
        }
    });

const seedProgram = Effect.gen(function* () {
    yield* Effect.logInfo('[Seed] STARTING GLOBAL SEED PROGRAM');
    try {
        yield* Effect.logInfo('[Seed] Cleaning up central tables...');
        yield* Effect.tryPromise({
            try: () => centralDb.deleteFrom('tenant').execute(),
            catch: (e) => e
        });
        yield* Effect.tryPromise({
            try: () => centralDb.deleteFrom('consultancy').execute(),
            catch: (e) => e
        });
        yield* Effect.tryPromise({
            try: () => centralDb.deleteFrom('platform_admin').execute(),
            catch: (e) => e
        });
    } catch (e) {
        yield* Effect.logWarning('[Seed] Cleanup warning (non-fatal): ' + String(e));
    }

    yield* seedPlatformAdmin('super-admin@bedrock.com', 'password123');

    yield* seedHierarchy(
        'effect-flow-dev@proton.me',
        'schema',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    );

    yield* Effect.logInfo('[Seed] COMPLETED ALL SEED OPERATIONS');
});

void Effect.runPromiseExit(seedProgram).then((exit) => {
    if (Exit.isSuccess(exit)) {
        process.exit(0);
    } else {
        console.error('\n❌ Seeding script failed:\n');
        const errorMsg = Cause.pretty(exit.cause);
        console.error(errorMsg);
        process.exit(1);
    }
});
