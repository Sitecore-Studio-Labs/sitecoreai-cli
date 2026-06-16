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
      // They flag a defensive `let x = <init>` idiom (initialise, then reassign
      // inside a try/if) and re-throws that don't attach the caught error as
      // `cause`. Kept at "warn" so the eslint-10 bump doesn't block on a
      // control-flow refactor across ~10 sites — promote to "error" and fix in a
      // dedicated cleanup PR.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
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
