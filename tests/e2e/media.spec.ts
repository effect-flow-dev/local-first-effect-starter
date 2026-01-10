    import { test, expect } from "@playwright/test";
    import { createVerifiedUser, cleanupUser } from "./utils/seed";

    test.describe("Media Upload & Offline Caching", () => {
      let user: Awaited<ReturnType<typeof createVerifiedUser>>;

      test.beforeAll(async () => {
        user = await createVerifiedUser();
      });

      test.afterAll(async () => {
        if (user) {
          await cleanupUser(user);
        }
      });

      test.fixme("Should upload image, cache it via SW, and load it while Offline", async ({ page, context }) => {
        test.setTimeout(90000); 

        // --- 1. Login at Subdomain ---
        await page.goto(`http://${user.subdomain}.localhost:3000/login`);
        await page.fill('input[id="email"]', user.email);
        await page.fill('input[id="password"]', user.password);
        await page.click('button[type="submit"]');
        
        // Wait for redirect to root
        await expect(page).toHaveURL(new RegExp(`http://${user.subdomain}\.localhost:3000/`));

        // --- 2. Create Note ---
        await page.click('button:has-text("Create New Note")');
        const editor = page.locator(".ProseMirror");
        await expect(editor).toBeVisible();
        await editor.click();

        // --- 3. Setup Network Mock for Upload (Online Phase) ---
        const MOCK_REMOTE_URL = "https://pub-test.r2.dev/test-image.png";
        const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const imageBuffer = Buffer.from(base64Png, 'base64');

        // Mock the upload API
        await page.route("**/api/media/upload", async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ url: MOCK_REMOTE_URL }),
            });
          } else {
            await route.continue();
          }
        });

        // Mock the actual image asset
        await page.route(MOCK_REMOTE_URL, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: imageBuffer,
            headers: { 
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=31536000' 
            }
          });
        });

        // --- 4. Simulate Drop (Upload) ---
        await page.evaluate((b64) => {
          const byteCharacters = atob(b64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const file = new File([byteArray], "test.png", { type: "image/png" });

          const dt = new DataTransfer();
          dt.items.add(file);
          Object.defineProperty(dt, 'files', { value: [file] });

          const editorEl = document.querySelector(".ProseMirror");
          if(editorEl) {
              const rect = editorEl.getBoundingClientRect();
              const clientX = rect.left + (rect.width / 2);
              const clientY = rect.top + (rect.height / 2);
              const event = new DragEvent("drop", { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dt });
              editorEl.dispatchEvent(event);
          }
        }, base64Png);

        // --- 5. Wait for Sync & Cache ---
        const imageComponent = page.locator("image-block-node-view");
        const img = imageComponent.locator("img");
        await expect(img).toHaveAttribute("src", MOCK_REMOTE_URL, { timeout: 30000 });

        // --- 6. Force Service Worker Control & Verify Cache ---
        // This ensures the SW is active before we pull the plug on the network
        await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
        });

        const currentUrl = page.url();
        await page.goto(currentUrl, { waitUntil: 'networkidle' }); 
        await expect(editor).toBeVisible();

        // Wait for Media Cache to populate
        await page.waitForFunction(async (url) => {
            const cache = await caches.open("media-cache");
            const match = await cache.match(url);
            return !!match;
        }, MOCK_REMOTE_URL, { timeout: 15000 });
        
        console.info("[Test] Cache verified. Going Offline...");

        // --- 7. Go OFFLINE ---
        await context.setOffline(true);

        // --- 8. Reload Page (Offline) ---
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });

        // --- 9. Verify Image Loads from Cache ---
        await expect(editor).toBeVisible({ timeout: 15000 });
        await expect(img).toHaveAttribute("src", MOCK_REMOTE_URL);

        // Confirm the image actually rendered (naturalWidth > 0)
        await expect.poll(async () => {
            return await img.evaluate((element: HTMLImageElement) => {
                return element.complete && element.naturalWidth > 0;
            });
        }, {
            message: 'Image should load from cache',
            timeout: 10000,
            intervals: [500]
        }).toBe(true);

        await page.close();
      });
    });
