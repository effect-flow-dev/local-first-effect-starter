// FILE: tests/e2e/sync.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Real-Time Sync (Multi-Client)", () => {
  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    await cleanupUser(user.userId);
  });

  test("Should sync changes between two browser windows in real-time", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const login = async (page: Page) => {
      await page.goto("/login");
      await page.fill('input[id="email"]', user.email);
      await page.fill('input[id="password"]', user.password);
      await page.click('button[type="submit"]');
      
      // ✅ FIX: Allow redirect to tenant subdomain
      await expect(page).toHaveURL(/.*\/$/);
      
      await expect(page.locator('button:has-text("Create New Note")')).toBeVisible();
    };

    // 1. Login both clients
    await test.step("Login Client A", async () => await login(page1));
    await test.step("Login Client B", async () => await login(page2));

    // 2. Client A creates a note
    await test.step("Client A creates note", async () => {
      await page1.click('button:has-text("Create New Note")');
      await expect(page1).toHaveURL(/\/notes\/[a-f0-9-]+/);
      
      const titleInput = page1.getByTestId("note-title-input");
      await titleInput.fill("Sync Note");
      // ✅ FIX: Use global sync status
      await expect(page1.locator("sync-status")).toContainText("Saved");
    });

    // 3. Client B sees note appear in sidebar
    await test.step("Client B sees note in sidebar", async () => {
      await expect(page2.locator("side-bar").locator("text=Sync Note")).toBeVisible({ timeout: 15000 });
    });

    // 4. Client B opens note and edits content
    await test.step("Client B edits content", async () => {
        await page2.locator("side-bar").locator("text=Sync Note").click();
        
        const editor = page2.locator(".ProseMirror");
        await expect(editor).toBeVisible();
        await editor.click();
        
        await page2.keyboard.type("Hello from Client B");
        // ✅ FIX: Use global sync status
        await expect(page2.locator("sync-status")).toContainText("Saved");
    });

    // 5. Client A sees content update
    await test.step("Client A sees content update", async () => {
        const editor = page1.locator(".ProseMirror");
        await expect(editor).toContainText("Hello from Client B", { timeout: 15000 });
    });

    await context1.close();
    await context2.close();
  });
});
