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
      thresholds: {
        global: {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
