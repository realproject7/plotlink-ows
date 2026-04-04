import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "../../lib": path.resolve(__dirname, "lib"),
    },
  },
});
