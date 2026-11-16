import { defineConfig } from "vitest/config";

// Default `pnpm test` runs unit tests only; integration tests need Postgres (pnpm test:integration).
export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/*.int.test.ts"] },
});
