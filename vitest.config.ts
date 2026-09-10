import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**", "src/index.ts", "src/main.ts"],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
      // Ratchet: set from the real standalone run (statements 87.13%, branches 81.96%,
      // functions 83.54%, lines 87.6%), a few points under so a single skipped case doesn't
      // trip it. Raise as coverage climbs; never lower to make a change pass.
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 82,
        lines: 86,
      },
    },
  },
});
