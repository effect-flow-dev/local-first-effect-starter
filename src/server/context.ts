   // FILE: src/server/context.ts
    import { Elysia } from 'elysia';
    import { Effect, Schema } from 'effect';
    import { validateToken } from '../lib/server/JwtService';
    import { getTenantDb, centralDb } from '../db/client';
    import { config } from '../lib/server/Config';
    import type { Tenant } from '../types/generated/central/public/Tenant';
    import type { PlatformAdminId } from '../types/generated/central/public/PlatformAdmin';
    import { PublicUserSchema, type PublicUser } from '../lib/shared/schemas';

    export const getRequestedSubdomain = (host: string | null): string | null => {
        if (!host) return null;
        const rootDomain = config.app.rootDomain;
        const hostname = host.split(':')[0] || '';

        if (hostname === rootDomain || hostname === '127.0.0.1') return null;
        if (hostname.endsWith('.' + rootDomain)) {
            return hostname.replace('.' + rootDomain, '');
        }
        return null;
    };

    export const userContext = (app: Elysia) => app.derive(
        { as: 'global' },
        async ({ request }) => {
            const host = request.headers.get('host');
            const headerSubdomain = request.headers.get('x-life-io-subdomain');
            const requestedSubdomain = headerSubdomain || getRequestedSubdomain(host);

            let tenant: Tenant | undefined;
            let userDb = null;

            if (requestedSubdomain) {
                tenant = await centralDb
                    .withSchema('public')
                    .selectFrom('tenant')
                    .selectAll()
                    .where('subdomain', '=', requestedSubdomain)
                    .executeTakeFirst();

                if (tenant) {
                    userDb = getTenantDb({
                        id: tenant.id,
                        tenant_strategy: (tenant.tenant_strategy || 'schema') as 'schema' | 'database',
                        database_name: tenant.database_name,
                        schema_name: tenant.schema_name
                    });
                }
            }

            const authHeader = request.headers.get('authorization');
            let user: PublicUser | null = null;
            let currentRole: string | null = null;
            let isPlatformAdmin = false;

            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const result = await Effect.runPromise(Effect.either(validateToken(token)));
                
                if (result._tag === 'Right') {
                    const tokenUser = result.right;

                    const adminRecord = await centralDb
                        .selectFrom('platform_admin')
                        .select('id')
                        .where('id', '=', tokenUser.id as unknown as PlatformAdminId)
                        .executeTakeFirst();

                    if (adminRecord) {
                        isPlatformAdmin = true;
                        user = tokenUser;
                        currentRole = 'PLATFORM_OWNER';
                    }

                    if (!isPlatformAdmin && userDb) {
                        try {
                            const localUser = await userDb
                                .selectFrom('user')
                                .selectAll()
                                .where('id', '=', tokenUser.id)
                                .executeTakeFirst();

                            if (localUser) {
                                user = Schema.decodeUnknownSync(PublicUserSchema)({
                                    ...localUser,
                                    created_at: localUser.created_at,
                                });
                                currentRole = 'OWNER'; 
                            }
                        } catch (e) {
                            const err = e as { code?: string };
                            if (err.code !== '42P01') {
                                console.error('[Context] Local DB query failed:', e);
                            }
                        }
                    } else if (!isPlatformAdmin) {
                        user = tokenUser;
                    }
                }
            }

            return { 
                user, 
                userDb, 
                tenant: tenant || null,
                requestedSubdomain,
                currentRole,
                isPlatformAdmin
            };
        },
    );
