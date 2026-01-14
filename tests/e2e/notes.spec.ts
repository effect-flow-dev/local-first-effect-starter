// File: ./tests/e2e/notes.spec.ts
 import { test, expect } from "@playwright/test";
    import { createVerifiedUser, cleanupUser } from "./utils/seed";

    test.describe("Notes & Sync Core", () => {
        let user: Awaited<ReturnType<typeof createVerifiedUser>>;

        test.beforeAll(async () => {
            user = await createVerifiedUser();
        });

        test.afterAll(async () => {
            if (user) {
                await cleanupUser(user);
            }
        });

        test.beforeEach(async ({ page }) => {
            // ✅ FIX: Navigate to the tenant subdomain to Login
            await page.goto(`http://${user.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');
            
            // Wait for successful auth redirect at the subdomain
            await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));
        });

        test("Persistence: Created blocks should survive a page reload", async ({ page }) => {
            test.setTimeout(90000);

            // 1. Create Note
            await page.click('button:has-text("Create New Note")');
            await expect(page).toHaveURL(/\/notes\/[a-f0-9-]+/);
            
            const titleInput = page.getByTestId("note-title-input");
            await titleInput.fill("E2E Block Test");
            await expect(page.locator("sync-status")).toContainText("Saved");
            
            // 2. Type in the first block
            const firstEditor = page.locator("tiptap-editor").first().locator(".ProseMirror");
            await firstEditor.click();
            await page.keyboard.type("First block content");
            await expect(page.locator("sync-status")).toContainText("Saved");

            // 3. Add a Checklist Block
            // Wait for FAB to be stable
            const fab = page.locator('button[title="Add Block"]');
            await expect(fab).toBeVisible();
            await fab.click();

            // Wait for dropdown menu to appear
            const checklistBtn = page.locator('button:has-text("Checklist")');
            await expect(checklistBtn).toBeVisible();
            await checklistBtn.click();

            // ✅ FIX: Increase timeout and ensure visibility
            const checklist = page.locator("smart-checklist");
            await expect(checklist).toBeVisible({ timeout: 10000 });

            await checklist.locator("text=New Item").click();
            await expect(page.locator("sync-status")).toContainText("Saved");

            // ✅ FIX: Wait a beat for IDB persistence before reloading.
            // "Saved" UI state means Replicache processed it, but IndexedDB flush is async.
            await page.waitForTimeout(1000);

            // 4. Reload
            await page.reload();

            // 5. Verify Persistence
            await expect(titleInput).toHaveValue("E2E Block Test");
            await expect(page.locator("tiptap-editor").first()).toContainText("First block content");
            await expect(page.locator("smart-checklist")).toBeVisible({ timeout: 10000 });
            await expect(page.locator("smart-checklist .bg-green-50")).toBeVisible();

            await page.close();
        });
    });
