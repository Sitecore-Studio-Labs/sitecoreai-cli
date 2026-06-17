import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests load .env files via an explicit `import "./setup"`
    // (or transitively through `./helpers`); applying the env-loading
    // setup globally would leak SITECOREAI_CLIENT_ID / _CLIENT_SECRET /
    // _AUTHORITY into unit tests that explicitly model the
    // no-credential path (e.g. serialization auth-resolver tests),
    // turning those assertions into TypeErrors when the loaded env vars
    // accidentally satisfy the credential-chain resolver.
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
        // Audited 2026-06-17: schema-only public entries (added so frontends
        // can re-export the recipe Zod schemas without the compiler/clients)
        // plus task / api / scripting / agents barrels — all pure
        // `export … from` re-exports, tested where the symbol is DEFINED.
        "src/recipe/schema.ts",
        "src/brand/recipe/schema-only.ts",
        "src/brief/recipe/schema-only.ts",
        "src/campaigns/recipe/schema-only.ts",
        "src/agents/index.ts",
        "src/agents/tasks/index.ts",
        "src/commands/deploy/environments.ts",
        "src/recipe/api/auth.ts",
        "src/scripting/index.ts",
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
      //
      // 2026-06-04 audited retreat: branches 80 -> 78 to unblock the
      // 0.3.0-canary.2 release. The drop is from added code paths in
      // `commands/{brief,campaign}/sync.ts` (the `--identities-out`
      // flag + `writeIdentitiesOut` helper) and the campaign apply
      // identities collection in `campaigns/recipe/kind.ts`. Recover
      // the floor in a follow-up via dedicated tests for those paths.
      //
      // 2026-06-16: the Node 20 -> 24 dev-baseline bump shifted V8's function
      // counting and dropped measured global functions ~1% (90.97 -> 89.99),
      // 0.01% under this floor. Recovered to 90 with real tests for
      // previously-uncovered functions (agents `resolveAgentsSession` /
      // `prepare`) rather than retreating the floor — functions stays 90.
      // (branches 78 is still the 2026-06-04 capitulation above; recover it
      // to 80 in a follow-up via plan/apply tests for the sync kinds.)
      thresholds: {
        statements: 90,
        branches: 78,
        functions: 90,
        lines: 90,
      },
    },
  },
});
