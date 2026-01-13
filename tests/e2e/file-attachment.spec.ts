// FILE: tests/e2e/file-attachment.spec.ts
import { test, expect } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("File Attachment & Offline Support", () => {
  let user: Awaited<ReturnType<typeof createVerifiedUser>>;

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    if (user) await cleanupUser(user);
  });

  test("Should upload a generic file via the UI, display progress, and persist as a download card", async ({ page }) => {
    test.setTimeout(90000);

    // DEBUG: Listen to console logs
    page.on('console', msg => {
        const text = msg.text();
        const type = msg.type();
        if (text.includes("[MediaSync]") || text.includes("[FileAttachment]") || text.includes("[MediaStore]") || type === 'error') {
            console.warn(`[Browser Console] ${type}: ${text}`);
        }
    });

    // 1. Login
    await page.goto(`http://${user.subdomain}.localhost:3000/login`);
    await page.fill('input[id="email"]', user.email);
    await page.fill('input[id="password"]', user.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));

    // Wait for initial sync to complete (pull)
    await page.waitForResponse(resp => resp.url().includes('/api/replicache/pull') && resp.status() === 200);

    // 2. Create Note
    await page.click('button:has-text("Create New Note")');
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();

    // 3. Mock Upload API
    const MOCK_FILE_URL = "https://pub-test.r2.dev/test-document.pdf";
    let uploadCalled = false;
    
    await page.route("**/api/media/upload", async (route) => {
      console.warn("[Test] Upload API called");
      uploadCalled = true;
      // Delay to allow asserting "Uploading..." state if needed
      await new Promise(r => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ 
            url: MOCK_FILE_URL,
            filename: "test-document.pdf",
            size: 1024,
            mimeType: "application/pdf"
        }),
      });
    });

    // 4. Trigger Upload via UI (FAB -> Upload File)
    await page.locator('button[title="Add Block"]').click();
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Upload File').click();
    const fileChooser = await fileChooserPromise;
    
    await fileChooser.setFiles({
        name: 'test-document.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 ...dummy content...')
    });

    // REMOVED: await page.evaluate(...) for 'force-save'. 
    // The manual button flow uses mutate.createBlock directly, so no force-save event is emitted.
    
    // Short wait to ensure DOM processing
    await page.waitForTimeout(500);

    // 5. Verify Uploading State
    const fileCard = page.locator("file-attachment-node-view");
    await expect(fileCard).toBeVisible({ timeout: 20000 });
    await expect(fileCard).toContainText("test-document.pdf");

    // Wait for the upload call to happen
    await expect.poll(() => uploadCalled, { timeout: 15000 }).toBe(true);

    // 6. Verify Success State
    const downloadBtn = fileCard.locator('a[title="Download"]');
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
    
    // Explicitly wait for the attribute to update from blob: to https:
    await expect(downloadBtn).toHaveAttribute("href", MOCK_FILE_URL, { timeout: 20000 });

    // 7. Reload to verify persistence
    await page.reload();
    
    // Check JWT persistence
    const token = await page.evaluate(() => localStorage.getItem("jwt"));
    expect(token).toBeTruthy();

    // Wait for sync after reload
    await page.waitForResponse(resp => resp.url().includes('/api/replicache/pull') && resp.status() === 200);

    await expect(editor).toBeVisible();
    const persistedCard = page.locator("file-attachment-node-view");
    await expect(persistedCard).toBeVisible({ timeout: 10000 });
    await expect(persistedCard).toContainText("test-document.pdf");
    await expect(persistedCard.locator('a[title="Download"]')).toHaveAttribute("href", MOCK_FILE_URL);
  });
});
