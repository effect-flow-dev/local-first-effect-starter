// FILE: tests/e2e/conflict.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Conflict Resolution & Offline Sync", () => {
  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    user = await createVerifiedUser();
  });

  test.afterAll(async () => {
    if (user) {
      await cleanupUser(user.userId);
    }
  });

  test("Should detect stale writes, inject conflict alert, and allow restoration", async ({ browser }) => {
    // Increased timeout for robust CI execution
    test.setTimeout(90000);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const login = async (page: Page) => {
      await page.goto("/login");
      await page.fill('input[id="email"]', user.email);
      await page.fill('input[id="password"]', user.password);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*\/$/);
    };

    // 1. Login both clients
    await test.step("Login Clients", async () => {
        await Promise.all([login(pageA), login(pageB)]);
    });

    // 2. Setup Data (Client A creates Note + Task)
    await test.step("Setup Note with Task", async () => {
        await pageA.click('button:has-text("Create New Note")');
        await expect(pageA).toHaveURL(/\/notes\//);
        
        await pageA.locator('button[title="Add Block"]').click();
        await pageA.click('button:has-text("Checklist")');
        
        await expect(pageA.locator("smart-checklist")).toBeVisible();
        // ✅ FIX: Target the global sync status to resolve ambiguity with NotePage local status
        await expect(pageA.locator("sync-status")).toContainText("Saved");
    });

    // 3. Sync to Client B
    await test.step("Sync to Client B", async () => {
        await expect(pageB.locator("side-bar a").first()).toBeVisible({ timeout: 15000 });
        await pageB.locator("side-bar a").first().click();
        await expect(pageB.locator("smart-checklist")).toBeVisible();
    });

    // 4. Create Conflict
    await test.step("Create Conflict (Offline A vs Online B)", async () => {
        await contextA.setOffline(true);
        
        const itemA = pageA.locator("smart-checklist .cursor-pointer").first();
        await itemA.waitFor({ state: "visible" });
        await itemA.click({ force: true }); 
        await expect(itemA).toHaveClass(/bg-green-50/); 

        const itemB = pageB.locator("smart-checklist .cursor-pointer").first();
        await itemB.click();
        // ✅ FIX: Target global sync status
        await expect(pageB.locator("sync-status")).toContainText("Saved");
        
        await pageB.waitForTimeout(2000); 
    });

    // 5. Client A comes Online -> Push -> Conflict
    await test.step("Client A Reconnects & Conflicts", async () => {
        await contextA.setOffline(false);
        
        await pageA.reload({ waitUntil: "networkidle" });
        
        await expect(pageA.locator(".alert-block")).toBeVisible({ timeout: 30000 });

        const alert = pageA.locator(".alert-block").first();
        await expect(alert).toContainText("Sync Conflict");
        await expect(alert.locator("button")).toHaveText("View Version History");
    });

    // 6. Resolution Flow
    await test.step("Resolve Conflict via History", async () => {
        await pageA.locator(".alert-block button:has-text('View Version History')").click();
        
        // Target the fixed drawer inside the component
        const sidebarContent = pageA.locator("history-sidebar .fixed.right-0");
        await expect(sidebarContent).toBeVisible();
        
        await expect(sidebarContent.locator(".group.relative").first()).toBeVisible();

        // Conflict is a Block update. The sidebar renders a "Restore" button on hover for block updates.
        // We target the 2nd entry (index 1) to restore the previous state.
        // ✅ NOTE: With history merging disabled, we are guaranteed to see:
        // 1. Client A's Rejected Update (Newest)
        // 2. Client B's Accepted Update (Target)
        // 3. Creation Event
        const entry = sidebarContent.locator(".group.relative").nth(1);
        await expect(entry).toBeVisible();
        
        // Hover to reveal button, but also use force click if hover is flaky
        await entry.hover();
        
        const restoreBtn = entry.locator("button:has-text('Restore')");
        // Use force: true to bypass opacity check if transition is slow
        await restoreBtn.click({ force: true });
        
        await expect(pageA.locator(".alert-block")).not.toBeVisible();
    });

    await contextA.close();
    await contextB.close();
  });
});
