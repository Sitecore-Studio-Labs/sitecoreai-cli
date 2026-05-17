import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "dist/**",
        "tests/**",
        "**/types.ts",
        "src/commands/deploy.ts",
        "src/deploy/api.ts",
        "src/deploy/api/index.ts",
        "src/serialization/tasks.ts",
      ],
      // Ratchet floor, enforced by CI via `pnpm test:coverage`. Raise as
      // coverage improves, never lower. The 90/80/90/90 long-term target
      // is now met on every metric; these floors sit just under current
      // and hold it. NOTE: vitest 4 reads these keys directly under
      // `thresholds`; a `global:` wrapper is silently treated as an
      // unmatched glob and enforces nothing.
      thresholds: {
        statements: 92,
        branches: 81,
        functions: 90,
        lines: 93,
      },
    },
  },
});
