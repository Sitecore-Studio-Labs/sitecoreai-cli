/* eslint-disable @typescript-eslint/no-require-imports */
const js = require("@eslint/js");
const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "*.tgz", ".tmp-*"],
  },
  {
    files: ["**/*.{ts,tsx,js,cjs,mjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          // Match `argsIgnorePattern`: a `_`-prefixed name is an explicit
          // "intentionally unused" marker for variables too — notably the
          // discarded sibling in a destructure-to-omit (`const { x: _x, ...rest }`).
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // eslint 10 promoted these two into `js.configs.recommended` as errors.
      // `no-useless-assignment` flags a defensive `let x = <init>` idiom where
      // the initialiser is always overwritten before use; `preserve-caught-error`
      // flags re-throws that don't attach the caught error as `cause`. The ~10
      // sites were cleaned up 2026-06-17 (dead initialisers dropped — TS's
      // definite-assignment analysis confirms they were unreachable — and a
      // `{ cause }` added to the one re-throw), so both run at "error".
      "no-useless-assignment": "error",
      "preserve-caught-error": "error",
      // Complexity guardrails (eslint built-ins, no extra dep) — a two-tier
      // ratchet. Introduced 2026-06-17 at "warn" 40; after the big refactor
      // pass cleared every function past those numbers, promoted to ERROR.
      //
      // These ERROR ceilings are the hard, no-backsliding gate: `pnpm lint`
      // (CI + the lint-staged pre-commit hook) FAILS on anything worse than
      // today's worst, so the numbers can only ever be ratcheted DOWN.
      //
      // The 2026-06-17 god-file decomposition pass cleared every function
      // over cyclomatic complexity 30 (the worst were `compileRecipeSet` at
      // 38 and several MCP/cli-task handlers at 33-40), then a follow-up pass
      // cleared the max-params (6) and max-depth (5) debt too — internal
      // high-arity functions became options objects and deep blocks were
      // extracted into named helpers. So all three ceilings are now at the
      // debt-warn thresholds (complexity 30 / depth 4 / params 5); every
      // worklist is empty. The public, contract-stable `fetchItemMetadata`
      // and `fetchItemData` keep their >5-arg signatures via inline
      // `eslint-disable-next-line max-params` (an options object would break
      // SDK consumers); those are the only exemptions.
      //
      // The lower WARNING tier — the chip-away worklist — lives in the
      // `pnpm lint:complexity-debt` script (src-only, non-blocking) at
      // complexity 30 / depth 4 / params 5. Workflow to chip away over time:
      // run lint:complexity-debt, refactor what it surfaces, then lower the
      // matching ceiling here by the same step. eslint can't evaluate one
      // rule at two severities in a single pass, which is why the warn tier
      // is a separate script rather than a second threshold here. (Cyclomatic
      // only; cognitive-complexity via eslint-plugin-sonarjs is a later
      // upgrade.)
      complexity: ["error", 30],
      "max-depth": ["error", 4],
      "max-nested-callbacks": ["error", 4],
      "max-params": ["error", 5],
    },
  },
  {
    // Complexity guardrails target the shipped product surface (`src/`).
    // `scripts/` are one-shot probe/recon/smoke tools that intentionally
    // inline their logic top-to-bottom, and `tests/` are fixtures — neither
    // is the maintainability surface those rules protect, and neither has a
    // safety net that would make a behaviour-preserving rewrite verifiable.
    // Turn the four complexity rules off there (the rest of the config,
    // incl. the error-level correctness rules, still applies).
    files: ["scripts/**", "tests/**"],
    rules: {
      complexity: "off",
      "max-depth": "off",
      "max-nested-callbacks": "off",
      "max-params": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
  },
];
