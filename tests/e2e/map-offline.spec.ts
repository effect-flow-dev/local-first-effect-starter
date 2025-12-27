// FILE: tests/e2e/map-offline.spec.ts
import { test, expect } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Offline Map Capabilities", () => {
  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    await cleanupUser(user.userId);
  });

  test("Should cache map tiles and display them when offline", async ({ page, context }) => {
    // Increase timeout for map loading and cache wait
    test.setTimeout(90000);

    // 1. Login
    await page.goto("/login");
    await page.fill('input[id="email"]', user.email);
    await page.fill('input[id="password"]', user.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/$/);

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
    // The MapCacheService subscribes to Replicache. When the block is created,
    // it calculates tiles and fetches them.
    await mapContainer.click(); 
    await page.mouse.wheel(0, 100);

    console.info("[Test] Waiting for Map Cache Service to populate...");
    
    // We poll the cache API to verify tiles are stored
    await page.waitForFunction(async () => {
      const cache = await caches.open("map-tiles");
      const keys = await cache.keys();
      // Expect at least 9 tiles (3x3 grid)
      return keys.length >= 9;
    }, null, { timeout: 30000 });

    console.info("[Test] Tiles cached. Ensuring SW has cached the app shell...");

    // --- 5.5 Prime the Navigation Cache ---
    // Critical Step: We must ensure the Service Worker has cached '/index.html'
    // in the 'pages' runtime cache. Since this is the first time we visited this tenant
    // (after redirect), the initial navigation might have been network-only (SW installing).
    // A reload while ONLINE forces the active SW to handle the navigation and populate the cache.
    const currentUrl = page.url();
    await page.goto(currentUrl, { waitUntil: 'networkidle' }); 
    await expect(page.locator(".leaflet-container")).toBeVisible();

    console.info("[Test] App shell primed. Going Offline...");

    // 6. Go Offline
    await context.setOffline(true);

    // 7. Reload Page (Offline Mode)
    // We navigate to the same URL to force a reload from Service Worker
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });

    // 8. Verify Map is still visible
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15000 });

    // 9. Verify Tiles are Loaded (Not Broken)
    // We inspect the Leaflet tile images.
    const tiles = page.locator(".leaflet-tile-loaded");
    
    // Wait for at least one loaded tile
    await expect(tiles.first()).toBeVisible({ timeout: 10000 });
    
    const loadedTileCount = await tiles.count();
    console.info(`[Test] Verified ${loadedTileCount} loaded tiles while offline.`);
    
    expect(loadedTileCount).toBeGreaterThan(0);
  });
});
