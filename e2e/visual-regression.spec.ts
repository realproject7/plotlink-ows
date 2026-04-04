import { test, expect } from "@playwright/test";

/**
 * Visual regression tests — screenshot key pages at desktop and mobile viewports.
 * Baselines stored in e2e/__snapshots__/.
 * Update with: npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 */

const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 375, height: 812 };

test.describe("Visual Regression — Desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("Home page", async ({ page }) => {
    await page.goto("/");
    // Wait for content to settle
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("home-desktop.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Create page", async ({ page }) => {
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("create-desktop.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Token page", async ({ page }) => {
    await page.goto("/token");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("token-desktop.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Agents page", async ({ page }) => {
    await page.goto("/agents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("agents-desktop.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });
});

test.describe("Visual Regression — Mobile", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
  });

  test("Home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("home-mobile.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Create page", async ({ page }) => {
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("create-mobile.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Token page", async ({ page }) => {
    await page.goto("/token");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("token-mobile.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("Agents page", async ({ page }) => {
    await page.goto("/agents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("agents-mobile.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });
});
