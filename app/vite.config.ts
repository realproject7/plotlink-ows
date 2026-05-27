import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  root: "app/web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@app-lib": path.resolve(__dirname, "lib"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7777",
      "/ws": { target: "ws://localhost:7777", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
