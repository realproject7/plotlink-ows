import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { walletRoutes } from "./wallet";

function makeApp() {
  const app = new Hono();
  app.route("/api/wallet", walletRoutes);
  return app;
}

describe("POST /api/wallet/send validation", () => {
  it("rejects invalid recipients before resolving the active wallet", async () => {
    const res = await makeApp().request("/api/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ETH", to: "not-an-address", amount: "0.1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("recipient");
  });

  it("rejects zero amounts before resolving the active wallet", async () => {
    const res = await makeApp().request("/api/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "PLOT",
        to: "0x2222222222222222222222222222222222222222",
        amount: "0",
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Positive amount");
  });
});
