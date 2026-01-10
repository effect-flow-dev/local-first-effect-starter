import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Real-Time Sync (Multi-Client)", () => {
    let user: Awaited<ReturnType<typeof createVerifiedUser>>;

    test.beforeAll(async () => {
        user = await createVerifiedUser();
    });

    test.afterAll(async () => {
        if (user) await cleanupUser(user);
    });

    test("Should sync changes between two browser windows on the same tenant", async ({ browser }) => {
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        const login = async (page: Page) => {
            // ✅ Phase 3 Fix: Navigate to subdomain
            await page.goto(`http://${user.subdomain}.localhost:3000/login`);
            await page.fill('input[id="email"]', user.email);
            await page.fill('input[id="password"]', user.password);
            await page.click('button[type="submit"]');
            await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));
        };

        await test.step("Login Clients", async () => {
            await Promise.all([login(page1), login(page2)]);
        });

        await test.step("Client A creates note", async () => {
            await page1.click('button:has-text("Create New Note")');
            const titleInput = page1.getByTestId("note-title-input");
            await titleInput.fill("Sync Note");
            await expect(page1.locator("sync-status")).toContainText("Saved");
        });

        await test.step("Client B sees note in sidebar", async () => {
            await expect(page2.locator("side-bar").locator("text=Sync Note")).toBeVisible({ timeout: 15000 });
        });

        await context1.close();
        await context2.close();
    });
});
