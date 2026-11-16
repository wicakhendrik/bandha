import { defineConfig } from "vitest/config";

// Only the source-scanning guard tests run here; the app itself is checked by typecheck and the native bundles.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
