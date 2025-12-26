// FILE: tests/e2e/multi-tenant.spec.ts
import { test, expect } from "@playwright/test";
import { createMultiTenantUser, cleanupUser } from "./utils/seed";

// Define the expected shape of the /api/auth/me response
interface AuthMeResponse {
  user: {
    id: string;
    email: string;
  };
  tenant: {
    id: string;
    name: string;
    subdomain: string;
  } | null;
  role: string | null;
}

test.describe("Multi-Tenancy & Access Control", () => {
  let user: Awaited<ReturnType<typeof createMultiTenantUser>>;

  test.beforeAll(async () => {
    user = await createMultiTenantUser();
  });

  test.afterAll(async () => {
    await cleanupUser(user.userId);
  });

  test("Should enforce isolation between Site A, Site B, and block Site C", async ({ page }) => {
    // 1. Login
    await page.goto("/login");
    await page.fill('input[id="email"]', user.email);
    await page.fill('input[id="password"]', user.password);
    await page.click('button[type="submit"]');

    // 2. Expect redirection to Workspace Selection (since >1 membership)
    await expect(page).toHaveURL("/select-workspace");
    await expect(page.locator("text=Select Workspace")).toBeVisible();
    
    // Verify both valid sites are listed
    await expect(page.locator(`text=${user.sites.a.subdomain}`)).toBeVisible();
    await expect(page.locator(`text=${user.sites.b.subdomain}`)).toBeVisible();
    // Site C should NOT be listed
    await expect(page.locator(`text=${user.sites.c.subdomain}`)).not.toBeVisible();

    // --- TEST SITE A ACCESS ---
    await page.click(`text=${user.sites.a.subdomain}`);
    
    await expect(page).not.toHaveURL("/select-workspace");

    // Wait for token hydration on the new domain.
    await page.waitForFunction(() => !!localStorage.getItem("jwt"), null, { timeout: 10000 });

    const token = await page.evaluate(() => localStorage.getItem("jwt"));
    expect(token).toBeTruthy();

    // --- TEST SITE C (UNAUTHORIZED) ACCESS via API ---

    // 1. Verify API Access to Site A (Allowed)
    const resA = await page.request.get(`http://127.0.0.1:42069/api/auth/me`, {
        headers: { 
            Authorization: `Bearer ${token}`,
            'X-Life-IO-Subdomain': user.sites.a.subdomain 
        }
    });
    expect(resA.status()).toBe(200);
    const jsonA = (await resA.json()) as AuthMeResponse;
    
    // Explicit null check for linter safety
    expect(jsonA.tenant).not.toBeNull();
    expect(jsonA.tenant?.id).toBe(user.sites.a.id);

    // 2. Verify API Access to Site B (Allowed, Different Tenant)
    const resB = await page.request.get(`http://127.0.0.1:42069/api/auth/me`, {
        headers: { 
            Authorization: `Bearer ${token}`,
            'X-Life-IO-Subdomain': user.sites.b.subdomain
        }
    });
    expect(resB.status()).toBe(200);
    const jsonB = (await resB.json()) as AuthMeResponse;
    
    expect(jsonB.tenant).not.toBeNull();
    expect(jsonB.tenant?.id).toBe(user.sites.b.id);
    expect(jsonB.tenant?.id).not.toBe(jsonA.tenant?.id);

    // 3. Verify API Access to Site C (Forbidden)
    const resC = await page.request.get(`http://127.0.0.1:42069/api/auth/me`, {
        headers: { 
            Authorization: `Bearer ${token}`,
            'X-Life-IO-Subdomain': user.sites.c.subdomain
        }
    });
    // Should be 403 Forbidden because user is not a member of Site C
    expect(resC.status()).toBe(403);
  });
});
