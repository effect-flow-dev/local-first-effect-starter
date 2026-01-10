   import { test, expect } from "@playwright/test";
    import { createVerifiedUser, cleanupUser } from "./utils/seed";

    test.describe("Sync Status Indicator", () => {
        let user: Awaited<ReturnType<typeof createVerifiedUser>>;

        test.beforeAll(async () => {
            user = await createVerifiedUser();
        });

        test.afterAll(async () => {
            if (user) {
                await cleanupUser(user);
            }
        });

        test("Should update status based on Network Connectivity and Pending Mutations", async ({ page, context }) => {
            test.setTimeout(90000);

            // 1. Login at Subdomain
            await page.goto(`http://${user.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');
            await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));

            // 2. Initial State: Should be "Saved" (Green)
            await page.waitForTimeout(1000);
            const syncStatus = page.locator("sync-status");
            await expect(syncStatus).toContainText("Saved");
            await expect(syncStatus.locator(".bg-green-50")).toBeVisible();

            // 3. Go OFFLINE
            await context.setOffline(true);
            await page.route("**/api/replicache/push", route => route.abort());

            await expect(syncStatus).toContainText("Offline");
            await expect(syncStatus.locator(".bg-zinc-100")).toBeVisible();

            // 4. Create Pending Mutations
            await page.click('button:has-text("Create New Note")');
            await page.waitForURL(/\/notes\/[a-f0-9-]+/);
            
            const editor = page.locator(".ProseMirror");
            await expect(editor).toBeVisible({ timeout: 15000 });

            await editor.click();
            await page.keyboard.type("Offline changes...");

            // 5. Verify Pending Count
            await expect(syncStatus).toContainText("Offline ("); 
            
            // 6. Go ONLINE
            await page.unroute("**/api/replicache/push");
            await context.setOffline(false);

            // 7. Verify Return to "Saved"
            await expect(syncStatus).toContainText("Saved", { timeout: 15000 });
            await expect(syncStatus.locator(".bg-green-50")).toBeVisible();
            await expect(syncStatus).not.toContainText("(");

            await page.close();
        });
    });
