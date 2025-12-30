// FILE: tests/e2e/notes.spec.ts
import { test, expect } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Notes & Sync Core", () => {
  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    // ✅ FIX: Check if user exists before cleanup
    if (user) {
      await cleanupUser(user.userId);
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="email"]', user.email);
    await page.fill('input[id="password"]', user.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/$/);
  });

  test("Persistence: Created blocks should survive a page reload", async ({ page }) => {
    test.setTimeout(90000);

    // 1. Create Note
    await page.click('button:has-text("Create New Note")');
    await expect(page).toHaveURL(/\/notes\/[a-f0-9-]+/);
    
    const titleInput = page.getByTestId("note-title-input");
    await titleInput.fill("E2E Block Test");
    await expect(page.locator("text=Saved")).toBeVisible();
    
    // 2. Type in the first block (Default Text Block)
    // In new architecture, we have multiple editors. We target the first one.
    const firstEditor = page.locator("tiptap-editor").first().locator(".ProseMirror");
    await firstEditor.click();
    await page.keyboard.type("First block content");
    await expect(page.locator("text=Saved")).toBeVisible();

    // 3. Add a Checklist Block using the FAB
    // Open FAB menu
    await page.locator('button[title="Add Block"]').click();
    // Click 'Checklist' option
    await page.locator('button:has-text("Checklist")').click();

    // Verify Checklist appears
    const checklist = page.locator("smart-checklist");
    await expect(checklist).toBeVisible();

    // Interact with Checklist (Toggle item)
    // The default checklist item is "New Item"
    await checklist.locator("text=New Item").click();
    // Wait for save
    await expect(page.locator("text=Saved")).toBeVisible();

    // 4. Reload
    await page.reload();

    // 5. Verify Persistence
    // Title
    await expect(titleInput).toHaveValue("E2E Block Test");
    
    // First Block Text
    await expect(page.locator("tiptap-editor").first()).toContainText("First block content");
    
    // Checklist Block Existence
    await expect(page.locator("smart-checklist")).toBeVisible();
    
    // Checklist State (Should still be green/checked if persistence worked)
    // We check for the class 'bg-green-50' which indicates checked state in our component
    await expect(page.locator("smart-checklist .bg-green-50")).toBeVisible();
  });
});
