// FILE: src/db/seed.ts
import { PERMISSIONS } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/tenant/tenant_template/User";
import type { ConsultancyId } from "../types/generated/central/public/Consultancy";
import type { TenantId } from "../types/generated/central/public/Tenant";
import { Argon2id } from "oslo/password";
import { Effect, Cause, Exit, Data } from "effect";
import { centralDb, getUserDb, type TenantConfig } from "./client";
import { provisionTenant } from "../features/auth/auth.service";
import { v4 as uuidv4 } from "uuid";
import type { NoteId, BlockId } from "../lib/shared/schemas";

class SeedingError extends Data.TaggedError("SeedingError")<{
  readonly cause: unknown;
}> {}

class PasswordHashingError extends Data.TaggedError("PasswordHashingError")<{
  readonly cause: unknown;
}> {}

const PASSWORD = "password123";

const seedHierarchy = (
  email: string,
  strategy: "schema" | "database",
  preferredUserId?: string,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo({ email, strategy }, "Seeding Hierarchy...");

    const userId = (preferredUserId || uuidv4()) as UserId;
    const consultancyId = uuidv4() as ConsultancyId;
    const tenantId = uuidv4() as TenantId;
    
    // 1. Prepare User Data (for Tenant DB)
    const argon2id = new Argon2id();
    const hashedPassword = yield* Effect.tryPromise({
      try: () => argon2id.hash(PASSWORD),
      catch: (cause) => new PasswordHashingError({ cause }),
    });

    const defaultPerms = [
        PERMISSIONS.NOTE_CREATE, 
        PERMISSIONS.NOTE_EDIT, 
        PERMISSIONS.NOTE_DELETE, 
        PERMISSIONS.BLOCK_EDIT, 
        PERMISSIONS.TASK_UPDATE,
        PERMISSIONS.NOTEBOOK_CREATE,
        PERMISSIONS.NOTEBOOK_DELETE
    ];

    // 2. Create Consultancy (Central DB)
    yield* Effect.tryPromise({
        try: () => centralDb
            .insertInto("consultancy")
            .values({
                id: consultancyId,
                name: `${email.split('@')[0]} Global`,
            })
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
    });

    // 3. Create Tenant (Central DB)
    const emailLocalPart = email.split("@")[0] ?? "user";
    const subdomain = emailLocalPart.toLowerCase().replace(/[^a-z0-9]/g, "-");
    
    // Naming convention for resources
    const schemaName = strategy === 'schema' ? `tenant_${tenantId.replace(/-/g, "")}` : null;
    const dbName = strategy === 'database' ? `tenant_db_${tenantId.replace(/-/g, "")}` : null;

    yield* Effect.tryPromise({
        try: () => centralDb
            .insertInto("tenant")
            .values({
                id: tenantId,
                consultancy_id: consultancyId,
                name: `${emailLocalPart} ${strategy === 'database' ? 'DB' : 'Schema'} Site`,
                subdomain: subdomain,
                tenant_strategy: strategy,
                database_name: dbName,
                schema_name: schemaName,
                created_at: new Date(),
            })
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
    });

    // 4. Provision Infrastructure (Schema/DB creation)
    yield* provisionTenant(userId, strategy, (strategy === 'database' ? dbName : schemaName)!);

    // 5. Connect to Tenant DB
    const userConfig: TenantConfig = {
      id: tenantId, // Important: Use Tenant ID for config lookup if needed, though here we use explicit names
      tenant_strategy: strategy,
      database_name: dbName || null,
      schema_name: schemaName,
    };

    const tenantDb = getUserDb(userConfig);

    // 6. Insert User (Tenant DB)
    yield* Effect.logInfo("Seeding User into Tenant DB...");
    yield* Effect.tryPromise({
        try: () => tenantDb
            .insertInto("user")
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

    // 7. Seed Sample Note (Tenant DB)
    const noteId = uuidv4() as NoteId;
    const blockId = uuidv4() as BlockId;

    yield* Effect.tryPromise({
      try: async () => {
        await tenantDb
          .insertInto("note")
          .values({
            id: noteId,
            user_id: userId,
            title: `Welcome to ${strategy.toUpperCase()} Mode`,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: `This note is stored in a ${strategy}-isolated tenant.`,
                    },
                  ],
                },
              ],
            },
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();

        await tenantDb
          .insertInto("block")
          .values({
            id: blockId,
            user_id: userId,
            note_id: noteId,
            type: "paragraph",
            content: `This note is stored in a ${strategy}-isolated tenant.`,
            file_path: "",
            depth: 0,
            order: 0,
            fields: {},
            tags: [],
            links: [],
            transclusions: [],
          })
          .execute();
      },
      catch: (cause) => new SeedingError({ cause }),
    });

    if (strategy === "database") {
      yield* Effect.promise(() => tenantDb.destroy());
    }
  });

const seedProgram = Effect.gen(function* () {
  // Clear central tables first
  try {
    // Note: We no longer delete 'user' or 'tenant_membership' from central
    // because they don't exist there anymore.
    yield* Effect.tryPromise(() => centralDb.deleteFrom("tenant").execute());
    yield* Effect.tryPromise(() => centralDb.deleteFrom("consultancy").execute());
  } catch (e) {
    yield* Effect.logWarning(`Cleanup warning: ${e}`);
  }

  // 1. Schema User (Default)
  yield* seedHierarchy(
    "effect-flow-dev@proton.me",
    "schema",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  );

  // 2. Database User
  yield* seedHierarchy("effect-flow-dev.database@gmail.com", "database");

  yield* Effect.logInfo("✅ All seed operations completed.");
});

void Effect.runPromiseExit(seedProgram).then((exit) => {
  if (Exit.isSuccess(exit)) {
    process.exit(0);
  } else {
    console.error("\n❌ Seeding script failed. Details below:\n");
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
