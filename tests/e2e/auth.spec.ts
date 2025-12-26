// FILE: tests/e2e/auth.spec.ts
import { test, expect } from "@playwright/test";
import { createVerifiedUser, cleanupUser } from "./utils/seed";

test.describe("Authentication Flows", () => {
  
  test("Signup: should allow a user to register and see the verify email screen", async ({ page }) => {
    const timestamp = Date.now();
    const email = `newuser-${timestamp}@test.com`;
    const subdomain = `test-e2e-${timestamp}`; 
    
    await page.goto("/signup");
    
    await page.fill('input[id="email"]', email);
    await page.fill('input[id="organizationName"]', "Test Organization");
    await page.fill('input[id="workspaceName"]', "Engineering Team");
    await page.fill('input[id="subdomain"]', subdomain);
    
    await page.fill('input[id="password"]', "Password123!");
    await page.fill('input[id="confirmPassword"]', "Password123!");
    
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/check-email/, { timeout: 25000 });
    await expect(page.locator("text=Check Your Email")).toBeVisible();
  });

  test("Login: should allow a verified user to login and redirect to home", async ({ page }) => {
    // 1. Seed a verified user directly into DB
    const { email, password, userId } = await createVerifiedUser();

    try {
      await page.goto("/login");

      await page.fill('input[id="email"]', email);
      await page.fill('input[id="password"]', password);
      
      await page.click('button[type="submit"]');

      // 2. Expect redirection to Home (Notes List)
      // ✅ FIX: Allow redirect to tenant subdomain (e.g. test-e2e-123.localhost:3000/)
      // We check that the path is just "/" regardless of the domain.
      await expect(page).toHaveURL(/.*\/$/);
      
      // 3. Verify logged in UI elements
      await expect(page.locator("text=Profile")).toBeVisible();
      await expect(page.locator("text=Logout")).toBeVisible();

    } finally {
      await page.close(); 
      await cleanupUser(userId);
    }
  });
});
