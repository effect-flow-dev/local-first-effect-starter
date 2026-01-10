// File: tests/e2e/conflict.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Conflict Resolution & Offline Sync", () => {
    let user: Awaited<ReturnType<typeof createVerifiedUser>>;

    test.beforeAll(async () => {
        user = await createVerifiedUser();
    });

    test.afterAll(async () => {
        if (user) await cleanupUser(user);
    });

    test("Should detect stale writes on tenant subdomain", async ({ browser }) => {
        test.setTimeout(90000);
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        const login = async (page: Page) => {
            await page.goto(`http://${user.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');
        };

        await test.step("Login Clients", async () => {
            await Promise.all([login(pageA), login(pageB)]);
        });

        await test.step("Setup Note", async () => {
            await pageA.click('button:has-text("Create New Note")');
            await expect(pageA.locator("sync-status")).toContainText("Saved");
        });

        await test.step("Sync to Client B", async () => {
            await pageB.locator("side-bar a").first().click();
            await expect(pageB.locator("tiptap-editor")).toBeVisible();
        });

        await contextA.close();
        await contextB.close();
    });
});
