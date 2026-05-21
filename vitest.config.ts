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
        // The three deploy paths below are pure re-export shims (each
        // file is a single `export ... from ...` line; either a 1-line
        // forwarder or a curated barrel of explicit re-exports). They
        // have no executable logic — coverage would be 100% trivially
        // or undefined depending on the runtime — so excluding them
        // from the threshold computation keeps the gate honest. Any
        // file added to one of these barrels must be tested in the
        // file that DEFINES the symbol; the barrel itself is not the
        // unit under test. Audited 2026-05-21.
        "src/commands/deploy.ts",
        "src/deploy/api.ts",
        "src/deploy/api/index.ts",
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
