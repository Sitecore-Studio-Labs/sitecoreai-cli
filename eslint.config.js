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
      // Complexity guardrails (eslint built-ins, no extra dep). Introduced
      // 2026-06-17 at "warn". Thresholds are deliberately set ABOVE the
      // moderately-branchy tail this sync/compile CLI naturally carries and
      // tuned to surface only the genuine outliers — at the eslint defaults
      // (complexity 20 / max-depth 4) ~250 functions trip, which is debt
      // wallpaper nobody reads. These numbers yield a short, actionable
      // worklist (~30 hits) dominated by the high-complexity sync kinds
      // (campaigns/recipe/kind.ts @175, brief/recipe/instance-kind.ts @108,
      // recipe/tasks/pull.ts @103, ...) — the SAME functions whose untested
      // branches block coverage at 80. Ratchet the numbers DOWN (and promote
      // to "error") as those get refactored for testability. Cyclomatic only;
      // cognitive-complexity (sonarjs) is a deliberate later upgrade.
      complexity: ["warn", 40],
      "max-depth": ["warn", 5],
      "max-nested-callbacks": ["warn", 4],
      "max-params": ["warn", 6],
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
