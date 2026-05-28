import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      // server-only throws in test environments — replace with a no-op module
      "server-only": path.resolve(import.meta.dirname, "tests/__mocks__/server-only.ts"),
    },
  },
});
