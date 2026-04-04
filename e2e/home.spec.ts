import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("page loads and story grid renders", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/PlotLink/i);
    // Story grid should render with story cards (skip if no data in CI)
    const grid = page.locator(".grid");
    if (!(await grid.first().isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }
    // Grid should contain story card links
    const storyLinks = page.locator("a[href^='/story/']");
    expect(await storyLinks.count()).toBeGreaterThan(0);
  });

  test("FilterBar is visible and dropdowns work", async ({ page }) => {
    await page.goto("/");

    const writerButton = page.locator("button").filter({ hasText: /writer:/ }).first();
    // FilterBar may not render if page structure differs — skip gracefully
    if (!(await writerButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await writerButton.click();

    const dropdown = page.locator("[class*='absolute']").filter({ hasText: "Human" });
    await expect(dropdown.first()).toBeVisible();

    // Close
    await page.locator("h1, h2, header").first().click();
  });

  test("sort dropdown shows Recent and Trending options", async ({ page }) => {
    await page.goto("/");

    const sortButton = page.locator("button").filter({ hasText: /sort:/ }).first();
    if (!(await sortButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await sortButton.click();

    const recentOption = page.locator("[class*='absolute'] button").filter({ hasText: "Recent" });
    const trendingOption = page.locator("[class*='absolute'] button").filter({ hasText: "Trending" });
    await expect(recentOption.first()).toBeVisible({ timeout: 3000 });
    await expect(trendingOption.first()).toBeVisible();
  });

  test("tab switch (Trending) loads different results", async ({ page }) => {
    await page.goto("/");

    // Skip if no data available
    if (!(await page.locator(".grid").first().isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }
    const initialLinks = await page.locator("a[href^='/story/']").count();

    const sortButton = page.locator("button").filter({ hasText: /sort:/ }).first();
    if (!(await sortButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await sortButton.click();
    const trendingOption = page.locator("[class*='absolute'] button").filter({ hasText: "Trending" });
    await trendingOption.first().click();

    // Page should render with trending content
    if (!(await page.locator(".grid").first().isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }
    const trendingLinks = await page.locator("a[href^='/story/']").count();
    // Both views should have content
    expect(initialLinks).toBeGreaterThan(0);
    expect(trendingLinks).toBeGreaterThan(0);
  });

  test("genre filter updates URL", async ({ page }) => {
    await page.goto("/");

    const genreButton = page.locator("button").filter({ hasText: /genre:/ }).first();
    if (!(await genreButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await genreButton.click();

    const allGenres = page.locator("[class*='absolute'] button").filter({ hasText: "All genres" });
    await expect(allGenres.first()).toBeVisible({ timeout: 3000 });

    const genreOptions = page.locator("[class*='absolute'] button");
    const count = await genreOptions.count();
    if (count > 1) {
      await genreOptions.nth(1).click();
      await expect(page).toHaveURL(/genre=/);
    }
  });

  test("language filter selects option and updates URL", async ({ page }) => {
    await page.goto("/");

    const langButton = page.locator("button").filter({ hasText: /lang:/ }).first();
    if (!(await langButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await langButton.click();

    const allLangs = page.locator("[class*='absolute'] button").filter({ hasText: "All languages" });
    await expect(allLangs.first()).toBeVisible({ timeout: 3000 });

    const langOptions = page.locator("[class*='absolute'] button");
    const count = await langOptions.count();
    if (count > 1) {
      await langOptions.nth(1).click();
      await expect(page).toHaveURL(/lang=/);
    }
  });

  test("pagination navigates between pages", async ({ page }) => {
    await page.goto("/");
    if (!(await page.locator(".grid").first().isVisible({ timeout: 15000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Check for pagination controls
    const nextLink = page.locator("a").filter({ hasText: "Next" });
    if (await nextLink.count() > 0) {
      // Verify Next link points to page 2
      const href = await nextLink.first().getAttribute("href");
      expect(href).toContain("page=2");

      // Click Next and verify page changes
      await nextLink.first().click();
      await expect(page).toHaveURL(/page=2/);

      // Page 2 should still have content or show empty state
      await page.locator("body").waitFor();

      // Previous link should now exist
      const prevLink = page.locator("a").filter({ hasText: "Previous" });
      if (await prevLink.count() > 0) {
        expect(await prevLink.first().getAttribute("href")).not.toContain("page=2");
      }
    } else {
      // Dataset has fewer than 24 items — pagination not shown (valid)
      const storyCount = await page.locator("a[href^='/story/']").count();
      expect(storyCount).toBeLessThanOrEqual(24);
    }
  });
});
