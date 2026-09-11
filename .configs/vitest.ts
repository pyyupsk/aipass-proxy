import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(import.meta.dirname, ".."),
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
