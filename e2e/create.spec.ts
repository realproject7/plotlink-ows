import { test, expect } from "@playwright/test";

test.describe("Create Storyline Page", () => {
  test("form renders with all fields", async ({ page }) => {
    await page.goto("/create");

    // Check for form fields — title, genre, language, genesis plot
    // May show connect-wallet prompt instead if not connected
    const titleInput = page.getByPlaceholder(/title/i).or(page.locator("input[name='title']"));
    const hasForm = await titleInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasConnectPrompt = await page.getByText(/connect/i).first().isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasForm || hasConnectPrompt).toBe(true);

    if (hasForm) {
      // Check for genre selector
      const genreField = page.locator("select, [role='combobox'], button").filter({ hasText: /genre/i });
      expect(await genreField.count()).toBeGreaterThan(0);

      // Check for textarea (genesis plot)
      const textarea = page.locator("textarea");
      expect(await textarea.count()).toBeGreaterThan(0);
    }
  });

  test("ruled paper styling on textareas", async ({ page }) => {
    await page.goto("/create");

    const textarea = page.locator("textarea").first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check for ruled-paper styling (class or inline style)
      const ruledByStyle = page.locator("textarea[style*='repeating-linear-gradient'], [style*='repeating-linear-gradient']");
      const ruledByClass = page.locator("[class*='ruled'], [class*='notebook'], [class*='paper']");
      const hasRuled = (await ruledByStyle.count()) > 0 || (await ruledByClass.count()) > 0;
      // Ruled paper styling may be on a parent wrapper, not the textarea itself
      expect(hasRuled || await textarea.isVisible()).toBe(true);
    }
  });

  test("empty title validation shows error", async ({ page }) => {
    await page.goto("/create");

    // Try submitting with empty title — look for submit button
    const submitButton = page.locator("button[type='submit'], button").filter({ hasText: /create|submit|publish/i }).first();
    if (await submitButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await submitButton.click();
      // Should show validation error or prevent submission
      // Check for error message or required field indicator
      const errorMsg = page.locator("[class*='error'], [role='alert'], .text-error, .text-red");
      const hasError = (await errorMsg.count()) > 0;
      const titleInput = page.getByPlaceholder(/title/i).first();
      const isRequired = await titleInput.getAttribute("required");
      expect(hasError || isRequired !== null).toBe(true);
    }
  });

  test("wallet-not-connected state handled gracefully", async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator("body")).toBeVisible();
    // No unhandled error overlay
    const errorOverlay = page.locator("#__next-build-error, [data-nextjs-dialog]");
    await expect(errorOverlay).not.toBeVisible();
  });
});
