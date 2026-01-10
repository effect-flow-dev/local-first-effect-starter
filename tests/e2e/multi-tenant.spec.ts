    import { test, expect } from "@playwright/test";
    import { createMultiTenantUser, cleanupUser } from "./utils/seed";

    test.describe("Multi-Tenancy Isolation", () => {
        let user: Awaited<ReturnType<typeof createMultiTenantUser>>;

        test.beforeAll(async () => {
            user = await createMultiTenantUser();
        });

        test.afterAll(async () => {
            await cleanupUser({ 
                consultancyId: user.consultancyId, 
                sites: user.sites 
            });
        });

        test("Should enforce isolation and allow independent logins at Site A and Site B", async ({ page }) => {
            // 1. TEST SITE A LOGIN
            await page.goto(`http://${user.sites.a.subdomain}.localhost:3000/login`);
            
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');

            await expect(page).toHaveURL(new RegExp(`${user.sites.a.subdomain}\.localhost:3000/`));
            await expect(page.locator("text=Profile")).toBeVisible();

            // 2. VERIFY SITE B ACCESS
            await page.evaluate(() => localStorage.clear());
            
            await page.goto(`http://${user.sites.b.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');

            await expect(page).toHaveURL(new RegExp(`${user.sites.b.subdomain}\.localhost:3000/`));

            // 3. TEST SITE C (UNAUTHORIZED)
            await page.evaluate(() => localStorage.clear());
            await page.goto(`http://${user.sites.c.subdomain}.localhost:3000/login`);
            
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');

            await expect(page.locator("text=Invalid credentials")).toBeVisible();
            await page.close();
        });

        test("Should ensure API tokens are restricted to the tenant that issued them", async ({ page }) => {
            // 1. Login to Site A
            await page.goto(`http://${user.sites.a.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');
            
            // 2. ✅ FIX: Polling for Token hydration
            // Login is async; we must wait for the JWT to be stored before checking it.
            await expect.poll(async () => {
                return await page.evaluate(() => localStorage.getItem("jwt"));
            }, {
                message: "Wait for JWT to be stored in localStorage after login",
                timeout: 10000
            }).toBeTruthy();

            const token = await page.evaluate(() => localStorage.getItem("jwt"));

            // 3. Attempt cross-tenant access via API
            // Direct request using Site A token against Site B context
            const res = await page.request.get(`http://127.0.0.1:42069/api/auth/me`, {
                headers: { 
                    Authorization: `Bearer ${token}`,
                    'X-Life-IO-Subdomain': user.sites.b.subdomain 
                }
            });
            
            // Response should be 401 because user ID from Site A doesn't exist in Site B's isolated DB
            expect(res.status()).toBe(401);
            await page.close();
        });
    });
