   import { test, expect } from "@playwright/test";
    import { createVerifiedUser, cleanupUser } from "./utils/seed";

    test.describe("Offline Map Capabilities", () => {
        let user: Awaited<ReturnType<typeof createVerifiedUser>>;

        test.beforeAll(async () => {
            user = await createVerifiedUser();
        });

        test.afterAll(async () => {
            if (user) {
                await cleanupUser(user);
            }
        });

        test("Should cache map tiles and display them when offline", async ({ page, context }) => {
            // Increase timeout for map loading and cache wait
            test.setTimeout(90000);

            // 1. Login at Subdomain (Root login is now rejected by server)
            await page.goto(`http://${user.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');

            // Verify redirection to root of subdomain
            await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));

            // 2. Create Note
            await page.click('button:has-text("Create New Note")');
            await expect(page.locator(".ProseMirror")).toBeVisible();

            // 3. Add Map Block
            await page.locator('button[title="Add Block"]').click();
            await page.click('button:has-text("Map")');

            // 4. Verify Map Rendered
            const mapContainer = page.locator(".leaflet-container");
            await expect(mapContainer).toBeVisible();

            // 5. Wait for Cache Service to Pre-fetch
            await mapContainer.click(); 
            await page.mouse.wheel(0, 100);

            // We poll the cache API to verify tiles are stored
            await page.waitForFunction(async () => {
                const cache = await caches.open("map-tiles");
                const keys = await cache.keys();
                // Expect at least 9 tiles (3x3 grid)
                return keys.length >= 9;
            }, null, { timeout: 30000 });

            // Ensure app shell is cached for reload
            const currentUrl = page.url();
            await page.goto(currentUrl, { waitUntil: 'networkidle' }); 
            await expect(page.locator(".leaflet-container")).toBeVisible();

            // 6. Go Offline
            await context.setOffline(true);

            // 7. Reload Page (Offline Mode)
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });

            // 8. Verify Map is still visible
            await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15000 });

            // 9. Verify Tiles are Loaded
            const tiles = page.locator(".leaflet-tile-loaded");
            await expect(tiles.first()).toBeVisible({ timeout: 10000 });
            
            const loadedTileCount = await tiles.count();
            expect(loadedTileCount).toBeGreaterThan(0);

            await page.close();
        });
    });
