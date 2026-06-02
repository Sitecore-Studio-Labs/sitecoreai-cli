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
        // Pure re-export shims — each file is one or more `export ...
        // from ...` lines, no executable logic. Coverage would be 100%
        // trivially or undefined depending on the runtime, so excluding
        // them from the threshold computation keeps the gate honest.
        // Any file added to one of these barrels must be tested in the
        // file that DEFINES the symbol; the barrel itself is not the
        // unit under test. Audited 2026-05-21 (deploy) + 2026-06-02
        // (zero-coverage barrels: sites / sync / webhooks / workflow /
        // authoring / content).
        "src/commands/deploy.ts",
        "src/deploy/api.ts",
        "src/deploy/api/index.ts",
        "src/sites/index.ts",
        "src/sync/index.ts",
        "src/webhooks/index.ts",
        "src/workflow/index.ts",
        "src/authoring/index.ts",
        "src/content/index.ts",
      ],
      // Ratchet floor, enforced by CI via `pnpm test:coverage`. Raise as
      // coverage improves, never lower (except as part of a deliberate,
      // documented retreat — see below). NOTE: vitest 4 reads these keys
      // directly under `thresholds`; a `global:` wrapper is silently
      // treated as an unmatched glob and enforces nothing.
      //
      // Ahead of 0.3 stable: targeted shared.ts + sites.ts + io.ts
      // additions brought branches from 79.95 back over 80, so the four
      // floors are restored to the round-number 90/80/90/90 target.
      // Actuals at restore: 91.81 / 80.00 / 90.97 / 92.68 — statements
      // and lines carry headroom; branches has none, treat 0.3-stable
      // adds as needing matching tests.
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
