   // FILE: src/server/routes/auth/login.ts
    import { Elysia, t } from 'elysia';
    import { Effect } from 'effect';
    import { Argon2id } from 'oslo/password';
    import { generateToken } from '../../../lib/server/JwtService';
    import { effectPlugin } from '../../middleware/effect-plugin';
    import { userContext } from '../../context'; 
    import { handleAuthResult } from './utils';
    import { centralDb } from '../../../db/client';
    import {
        AuthDatabaseError,
        InvalidCredentialsError,
        PasswordHashingError,
    } from '../../../features/auth/Errors';
    import type { PublicUser, UserId } from '../../../lib/shared/schemas';

    export const loginRoute = new Elysia()
        .use(userContext) 
        .use(effectPlugin)
        .post(
            '/login',
            async ({ body, userDb, tenant, set, runEffect }) => {
                const loginEffect = Effect.gen(function* () {
                    const { email, password } = body;
                    const argon = new Argon2id();

                    if (!tenant) {
                        yield* Effect.logInfo('[Login] Platform Admin attempt: ' + email);
                        
                        const admin = yield* Effect.tryPromise({
                            try: () => centralDb
                                .selectFrom('platform_admin')
                                .selectAll()
                                .where('email', '=', email)
                                .executeTakeFirst(),
                            catch: (cause) => new AuthDatabaseError({ cause }),
                        });

                        if (!admin) {
                            yield* Effect.logInfo('[Login] Admin account not found: ' + email);
                            return yield* Effect.fail(new InvalidCredentialsError());
                        }

                        const isValid = yield* Effect.tryPromise({
                            try: () => argon.verify(admin.password_hash, password),
                            catch: (cause) => new PasswordHashingError({ cause })
                        });

                        if (!isValid) {
                            yield* Effect.logInfo('[Login] Invalid admin password for: ' + email);
                            return yield* Effect.fail(new InvalidCredentialsError());
                        }

                        const adminUser: PublicUser = {
                            id: admin.id as unknown as UserId,
                            email: admin.email,
                            email_verified: true,
                            permissions: ['*'],
                            created_at: admin.created_at,
                            avatar_url: null
                        };

                        const token = yield* generateToken(adminUser);

                        return { 
                            user: { email: admin.email, id: admin.id, isPlatformAdmin: true }, 
                            token 
                        };
                    }

                    yield* Effect.logInfo('[Login] Tenant User attempt: ' + email + ' @ ' + tenant.subdomain);

                    const userRow = yield* Effect.tryPromise({
                        try: () => userDb!
                            .selectFrom('user')
                            .selectAll()
                            .where('email', '=', email)
                            .executeTakeFirst(),
                        catch: (cause) => new AuthDatabaseError({ cause }),
                    });

                    if (!userRow) {
                        yield* Effect.logInfo('[Login] User not found in tenant store: ' + email);
                        return yield* Effect.fail(new InvalidCredentialsError());
                    }

                    const isValidUserPassword = yield* Effect.tryPromise({
                        try: () => argon.verify(userRow.password_hash, password),
                        catch: (cause) => new PasswordHashingError({ cause })
                    });

                    if (!isValidUserPassword) {
                        yield* Effect.logInfo('[Login] Invalid user password for: ' + email);
                        return yield* Effect.fail(new InvalidCredentialsError());
                    }

                    const publicUser: PublicUser = {
                        id: userRow.id,
                        email: userRow.email,
                        permissions: userRow.permissions,
                        avatar_url: userRow.avatar_url,
                        email_verified: userRow.email_verified,
                        created_at: userRow.created_at
                    };

                    const token = yield* generateToken(publicUser);

                    yield* Effect.logInfo('[Login] Successful login: ' + email);
                    return { user: publicUser, token };
                });

                const result = await runEffect(Effect.either(loginEffect));
                return handleAuthResult(result, set);
            },
            {
                body: t.Object({
                    email: t.String(),
                    password: t.String(),
                }),
            },
        );
