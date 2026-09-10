import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "shared/**/*.test.ts",
      // scripts/ holds the ingest and reporting tools. Their pure functions
      // decide how sources are grouped and how rights are described, which is
      // exactly the kind of logic that should not go untested because of where
      // the file happens to live.
      "scripts/**/*.test.ts",
    ],
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    }
  },
});
