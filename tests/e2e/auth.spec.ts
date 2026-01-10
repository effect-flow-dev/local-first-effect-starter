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

  test("Login: should allow a verified user to login at their subdomain", async ({ page }) => {
    const userData = await createVerifiedUser();

    try {
      await page.goto(`http://${userData.subdomain}.localhost:3000/login`);

      await page.fill('input[id="email"]', userData.email);
      await page.fill('input[id="password"]', userData.password);
      await page.click('button[type="submit"]');

      await expect(page).toHaveURL(new RegExp(`http://${userData.subdomain}\.localhost:3000/`));
      
      await expect(page.locator("text=Profile")).toBeVisible();
      await expect(page.locator("text=Logout")).toBeVisible();

    } finally {
      await page.close(); 
      // ✅ FIX: Pass the full data object for isolated cleanup
      await cleanupUser(userData);
    }
  });
});
