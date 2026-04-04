import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("NavBar logo links to home", async ({ page }) => {
    await page.goto("/create");
    const logo = page.getByText("PlotLink").first();
    await expect(logo).toBeVisible({ timeout: 10000 });
    await logo.click();
    await expect(page).toHaveURL("/");
  });

  test("NavBar Create link navigates to /create", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const createLink = page.locator("a[href='/create']").first();
    await expect(createLink).toBeVisible({ timeout: 10000 });
    await createLink.click();
    await expect(page).toHaveURL("/create");
  });

  test("Footer renders with version and credits", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible({ timeout: 10000 });
    // Verify footer has version and credits content
    await expect(footer.getByText(/Base Mainnet/)).toBeVisible();
    await expect(footer.getByText(/@project7/)).toBeVisible();
  });

  test("no console errors on navigation", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/");
    // Skip if no data renders (Supabase may be unreachable in CI)
    await page.locator(".grid").first().waitFor({ timeout: 15000 }).catch(() => {});

    // Navigate to create
    await page.goto("/create");
    await page.locator("body").waitFor();

    // Filter browser-level network errors (not app-level JS errors).
    // "Failed to load resource" is emitted by the browser for HTTP 4xx/5xx
    // on external fetches (e.g. WalletConnect/RainbowKit metadata).
    const realErrors = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("Failed to load resource") &&
        !e.includes("net::ERR") &&
        !e.includes("Hydration") &&
        !e.includes("RPC") &&
        !e.includes("favicon"),
    );

    expect(realErrors).toEqual([]);
  });
});
