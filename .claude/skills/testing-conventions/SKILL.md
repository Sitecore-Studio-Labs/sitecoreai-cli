---
name: testing-conventions
description: Project-specific testing patterns for scai — Vitest tiers, mocking conventions, integration gating, and where tests live. Trigger when writing tests, debugging test failures, or asking about how to test something.
---

# Testing Conventions — scai

Vitest, two test tiers, integration gated by env var.

## Test tiers

| Tier        | Location             | Runs via                | What it tests                             | Config                         |
| ----------- | -------------------- | ----------------------- | ----------------------------------------- | ------------------------------ |
| Unit        | `tests/unit/`        | `pnpm test`             | Pure logic, mocked APIs/keychain          | `vitest.config.ts`             |
| Integration | `tests/integration/` | `pnpm test:integration` | Real Sitecore API + Deploy API + keychain | `vitest.integration.config.ts` |

**Rule:** if the test makes a real network call (Sitecore CM, Deploy API,
OAuth) or touches the OS keychain, it goes in `tests/integration/`. Unit
tests mock those boundaries.

## Integration test gating

Integration tests are skipped unless **all** of these are set:

```
SITECOREAI_RUN_INTEGRATION=1
SITECOREAI_DEPLOY_TOKEN=<a real token>
SITECOREAI_CLIENT_ID=<env-specific>
SITECOREAI_CLIENT_SECRET=<env-specific>
DEPLOY_BASE_URL=<the env's API base>
DEPLOY_ORG_ID=<...>
DEPLOY_PROJECT_ID=<...>
DEPLOY_ENVIRONMENT_ID=<...>
```

See `.env.example` (the "Integration test envs" section) for the full
list. Most integration tests have a guard at the top:

```ts
const skipIfNoIntegration = process.env.SITECOREAI_RUN_INTEGRATION !== "1" ? it.skip : it;
```

CI runs integration only on tagged jobs with secrets injected.

## Mocking the keychain

Tests must never write real tokens. scai uses `@napi-rs/keyring` (the
former `keytar` dependency was swapped out for a pure-Rust binding
with prebuilt binaries). The mock is constructed per-test against the
factory pattern in `tests/unit/shared/keychain.test.ts`:

```ts
import { vi } from "vitest";

const spies = {
  getPassword: vi.fn().mockResolvedValue("fake-token"),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deleteCredential: vi.fn().mockResolvedValue(true),
};

vi.doMock("@napi-rs/keyring", () => ({
  Entry: class {
    constructor(_service: string, _account: string) {}
    getPassword = spies.getPassword;
    setPassword = spies.setPassword;
    deleteCredential = spies.deleteCredential;
  },
}));
```

The `Entry` class is what `src/shared/keychain.ts` constructs. To
assert what was stored, capture against `spies.setPassword` — the
service/account values are private to each `Entry` instance, so the
test must spy at the instance method, not via a global registry.

For tests that need a fail-closed keyring (native module missing),
have the factory throw — `keychain.ts` catches the import error and
treats every operation as a no-op.

## Mocking HTTP

For Authoring GraphQL or Deploy API calls, mock the API client module
rather than `fetch`. The clients live in
`src/serialization/api/` and `src/deploy/api/` — mocking those
gives you a typed seam.

```ts
vi.mock("../../src/deploy/api/environments", () => ({
  listEnvironments: vi.fn().mockResolvedValue([{ id: "env-1", name: "Sandbox" }]),
}));
```

For tests that exercise the HTTP layer itself (request shaping, headers,
error mapping), use `undici`'s `MockAgent` or `nock`-style interceptors —
not real network calls.

## Telemetry must be disabled in tests

Otherwise tests can fire real telemetry events. Set in test setup or per
test:

```ts
process.env.SITECOREAI_TELEMETRY = "false";
```

The test runner's `setupFiles` is the right place for global suppression.

## Spawning the CLI in tests

If a test needs to invoke the built CLI (rare — usually mock at the task
level instead), use `child_process.spawn`/`spawnSync` with explicit env:

```ts
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["dist/cli.js", "telemetry", "status", "--json"], {
  env: {
    ...process.env,
    SITECOREAI_TELEMETRY: "false",
    SITECOREAI_AUTO_WIZARD: "0",
    HOME: tmpHome, // isolate keychain + history
  },
  encoding: "utf8",
});
expect(result.status).toBe(0);
```

Always set `SITECOREAI_AUTO_WIZARD=0` in spawn-based tests — otherwise the
CLI tries to start the init wizard and hangs.

## Fixture data

Module configs and tenant configs for tests live as JSON files under
`tests/unit/_fixtures/` (create if not present). Don't inline large config
documents in test files.

## Where tests live

| Source path                       | Test path                                    |
| --------------------------------- | -------------------------------------------- |
| `src/commands/<group>/<name>.ts`  | `tests/unit/commands/<group>/<name>.test.ts` |
| `src/<group>/tasks/<name>.ts`     | `tests/unit/<group>/tasks/<name>.test.ts`    |
| `src/config/<file>.ts`            | `tests/unit/config/<file>.test.ts`           |
| `src/serialization/api/<file>.ts` | `tests/unit/serialization/<file>.test.ts`    |
| Real-API end-to-end               | `tests/integration/<scenario>.test.ts`       |

## Anti-patterns

- **Real tokens in unit tests.** Use the keytar mock; never put a real
  token in fixture data.
- **Network calls in unit tests.** Mock the API client module.
- **Skipping the integration gate.** If a test needs `SITECOREAI_RUN_INTEGRATION=1`,
  put it in `tests/integration/` — don't run it unconditionally.
- **Hardcoding `process.env` mutations across test files.** Use Vitest's
  per-file env helpers or `setupFiles`. Mutating env in one file leaks
  into others.
- **Asserting on color codes or spinner output.** Use `--json` mode in
  tests when asserting on output content.
