// FILE: tests/e2e/sync-indicator.spec.ts
import { test, expect } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Sync Status Indicator", () => {
  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    if (user) {
      await cleanupUser(user.userId);
    }
  });

  test("Should update status based on Network Connectivity and Pending Mutations", async ({ page, context }) => {
    // Increase timeout for this specific test as it involves network toggling and waiting for sync cycles
    test.setTimeout(90000);

    // 1. Login
    await page.goto("/login");
    await page.fill('input[id="email"]', user.email);
    await page.fill('input[id="password"]', user.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/$/);

    // 2. Initial State: Should be "Saved" (Green)
    // Wait slightly for initial sync to settle
    await page.waitForTimeout(1000);
    const syncStatus = page.locator("sync-status");
    await expect(syncStatus).toContainText("Saved");
    await expect(syncStatus.locator(".bg-green-50")).toBeVisible();

    // 3. Go OFFLINE
    await context.setOffline(true);
    
    // ✅ FIX: Explicitly abort push requests to force pending state.
    // context.setOffline(true) is often leaky for localhost loopback traffic.
    await page.route("**/api/replicache/push", route => route.abort());

    // Expect "Offline" badge (Grey)
    await expect(syncStatus).toContainText("Offline");
    await expect(syncStatus.locator(".bg-zinc-100")).toBeVisible();

    // 4. Create Pending Mutations (Create a new note)
    await page.click('button:has-text("Create New Note")');
    
    // Explicitly wait for navigation to confirm the action was processed by the UI
    await page.waitForURL(/\/notes\/[a-f0-9-]+/);
    
    const editor = page.locator(".ProseMirror");
    // Give more time for the editor to render from local cache (offline creation)
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Type something to trigger more mutations
    await editor.click();
    await page.keyboard.type("Offline changes...");

    // 5. Verify Pending Count
    // Expect "Offline (N)" - the parenthesis indicates count is present
    await expect(syncStatus).toContainText("Offline ("); 
    
    // 6. Go ONLINE
    await page.unroute("**/api/replicache/push"); // Unblock network
    await context.setOffline(false);

    // 7. Verify Return to "Saved"
    // It might briefly show "Syncing...", but ultimately must settle on "Saved"
    // This confirms the mutations were flushed and the queue cleared.
    await expect(syncStatus).toContainText("Saved", { timeout: 15000 });
    await expect(syncStatus.locator(".bg-green-50")).toBeVisible();
    
    // Verify count is gone
    await expect(syncStatus).not.toContainText("(");
  });
});
