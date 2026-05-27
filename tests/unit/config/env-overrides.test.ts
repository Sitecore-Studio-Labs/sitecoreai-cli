import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEnvOverrides,
  stripAuthenticationTokensFromConfig,
} from "../../../src/config/env-overrides";
import type { EnvironmentConfiguration, RootConfigurationFile } from "../../../src/config/types";

/**
 * Branch-focused tests for `applyEnvOverrides` and
 * `stripAuthenticationTokensFromConfig`.
 *
 * Covers: the `toBoolean` truthy/falsy/invalid forks, scoped-vs-global
 * precedence, the `includeGlobal=false` gate, whitespace-only values
 * being treated as absent, env-name normalization into the scope key,
 * comma-list parsing, the `environmentType` validation fork, and the
 * token-stripping path including the no-profiles short-circuit.
 *
 * Every `SITECOREAI_*` var touched is snapshotted and restored so the
 * suite leaves `process.env` untouched.
 */

const TOUCHED_KEYS = [
  "SITECOREAI_ENV_DEV_ALLOW_WRITE",
  "SITECOREAI_ENV_DEV_USE_CLIENT_CREDENTIALS",
  "SITECOREAI_ENV_DEV_CM_HOST",
  "SITECOREAI_ENV_DEV_AUTHORITY",
  "SITECOREAI_ENV_DEV_AUDIENCE",
  "SITECOREAI_ENV_DEV_CLIENT_ID",
  "SITECOREAI_ENV_DEV_DEPLOY_TOKEN",
  "SITECOREAI_ENV_DEV_ACCESS_TOKEN",
  "SITECOREAI_ENV_DEV_ENVIRONMENT_TYPE",
  "SITECOREAI_ENV_DEV_PLACEHOLDER_SETTINGS_ROOTS",
  "SITECOREAI_ENV_DEV_ORGANIZATION_ID",
  "SITECOREAI_ENV_DEV_TENANT_ID",
  "SITECOREAI_ENV_DEV_PROJECT_ID",
  "SITECOREAI_ENV_DEV_ENVIRONMENT_ID",
  "SITECOREAI_ENV_DEV_TEMPLATES_ROOT",
  "SITECOREAI_ENV_DEV_RENDERINGS_ROOT",
  "SITECOREAI_ENV_DEV_HEADLESS_VARIANTS_ROOT",
  "SITECOREAI_ENV_DEV_AVAILABLE_RENDERINGS_ROOT",
  "SITECOREAI_ENV_DEV_CONTENT_ITEMS_ROOT",
  "SITECOREAI_ENV_DEV_PRESENTATION_STYLES_ROOT",
  "SITECOREAI_ENV_QA_2_ALLOW_WRITE",
  "SITECOREAI_ALLOW_WRITE",
  "SITECOREAI_CM_HOST",
  "SITECOREAI_CLIENT_ID",
  "SITECOREAI_AUTHORITY",
  "SITECOREAI_AUDIENCE",
  "SITECOREAI_DEPLOY_TOKEN",
  "SITECOREAI_ACCESS_TOKEN",
];

const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TOUCHED_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
});

const base: EnvironmentConfiguration = {};

describe("applyEnvOverrides — toBoolean coercion", () => {
  it("maps every truthy spelling to true", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE ", "On"]) {
      process.env.SITECOREAI_ENV_DEV_ALLOW_WRITE = value;
      expect(applyEnvOverrides("dev", base, true).allowWrite).toBe(true);
    }
  });

  it("maps every falsy spelling to false", () => {
    for (const value of ["0", "false", "no", "off", " FALSE ", "Off"]) {
      process.env.SITECOREAI_ENV_DEV_ALLOW_WRITE = value;
      expect(applyEnvOverrides("dev", base, true).allowWrite).toBe(false);
    }
  });

  it("leaves the field unset for an unrecognized boolean spelling", () => {
    process.env.SITECOREAI_ENV_DEV_ALLOW_WRITE = "maybe";
    expect(applyEnvOverrides("dev", base, true).allowWrite).toBeUndefined();
  });

  it("treats a whitespace-only value as absent", () => {
    process.env.SITECOREAI_ENV_DEV_ALLOW_WRITE = "   ";
    expect(applyEnvOverrides("dev", base, true).allowWrite).toBeUndefined();
  });

  it("coerces useClientCredentials independently of allowWrite", () => {
    process.env.SITECOREAI_ENV_DEV_USE_CLIENT_CREDENTIALS = "yes";
    expect(applyEnvOverrides("dev", base, true).useClientCredentials).toBe(true);
  });
});

describe("applyEnvOverrides — scoped vs global precedence", () => {
  it("the scoped key wins over the global key", () => {
    process.env.SITECOREAI_ENV_DEV_CM_HOST = "https://scoped.host";
    process.env.SITECOREAI_CM_HOST = "https://global.host";
    expect(applyEnvOverrides("dev", base, true).host).toBe("https://scoped.host");
  });

  it("falls through to the global key when no scoped key is set", () => {
    process.env.SITECOREAI_CM_HOST = "https://global.host";
    expect(applyEnvOverrides("dev", base, true).host).toBe("https://global.host");
  });

  it("ignores the global key when includeGlobal is false", () => {
    process.env.SITECOREAI_CM_HOST = "https://global.host";
    expect(applyEnvOverrides("dev", base, false).host).toBeUndefined();
  });

  it("still honors the scoped key when includeGlobal is false", () => {
    process.env.SITECOREAI_ENV_DEV_CLIENT_ID = "scoped-client";
    expect(applyEnvOverrides("dev", base, false).clientId).toBe("scoped-client");
  });

  it("treats a whitespace-only scoped value as absent and falls through to global", () => {
    process.env.SITECOREAI_ENV_DEV_CLIENT_ID = "   ";
    process.env.SITECOREAI_CLIENT_ID = "global-client";
    expect(applyEnvOverrides("dev", base, true).clientId).toBe("global-client");
  });

  it("trims the resolved value", () => {
    process.env.SITECOREAI_ENV_DEV_AUTHORITY = "  https://auth.example  ";
    expect(applyEnvOverrides("dev", base, true).authority).toBe("https://auth.example");
  });
});

describe("applyEnvOverrides — env-name normalization", () => {
  it("normalizes dashes and other punctuation into underscores in the scope key", () => {
    process.env.SITECOREAI_ENV_QA_2_ALLOW_WRITE = "true";
    // "qa.2" → "QA_2"
    expect(applyEnvOverrides("qa.2", base, true).allowWrite).toBe(true);
  });
});

describe("applyEnvOverrides — list and enum parsing", () => {
  it("parses placeholder settings roots as a trimmed comma list dropping empties", () => {
    process.env.SITECOREAI_ENV_DEV_PLACEHOLDER_SETTINGS_ROOTS = " a , , b ,c, ";
    expect(applyEnvOverrides("dev", base, true).placeholderSettingsRoots).toEqual(["a", "b", "c"]);
  });

  it("accepts a valid environmentType (cm)", () => {
    process.env.SITECOREAI_ENV_DEV_ENVIRONMENT_TYPE = "CM";
    expect(applyEnvOverrides("dev", base, true).environmentType).toBe("cm");
  });

  it("accepts a valid environmentType (eh)", () => {
    process.env.SITECOREAI_ENV_DEV_ENVIRONMENT_TYPE = "eh";
    expect(applyEnvOverrides("dev", base, true).environmentType).toBe("eh");
  });

  it("rejects an invalid environmentType, leaving the field unset", () => {
    process.env.SITECOREAI_ENV_DEV_ENVIRONMENT_TYPE = "combined";
    expect(applyEnvOverrides("dev", base, true).environmentType).toBeUndefined();
  });
});

describe("applyEnvOverrides — identity/token/root fields", () => {
  it("merges deployToken, accessToken, and identity ids from scoped vars", () => {
    process.env.SITECOREAI_ENV_DEV_DEPLOY_TOKEN = "deploy-tok";
    process.env.SITECOREAI_ENV_DEV_ACCESS_TOKEN = "access-tok";
    process.env.SITECOREAI_ENV_DEV_ORGANIZATION_ID = "org-1";
    process.env.SITECOREAI_ENV_DEV_TENANT_ID = "tenant-1";
    process.env.SITECOREAI_ENV_DEV_PROJECT_ID = "proj-1";
    process.env.SITECOREAI_ENV_DEV_ENVIRONMENT_ID = "env-1";
    const result = applyEnvOverrides("dev", base, true);
    expect(result).toMatchObject({
      deployToken: "deploy-tok",
      accessToken: "access-tok",
      organizationId: "org-1",
      tenantId: "tenant-1",
      projectId: "proj-1",
      environmentId: "env-1",
    });
  });

  it("merges recipe root paths from scoped vars", () => {
    process.env.SITECOREAI_ENV_DEV_TEMPLATES_ROOT = "/sitecore/templates/X";
    process.env.SITECOREAI_ENV_DEV_RENDERINGS_ROOT = "/sitecore/layout/X";
    const result = applyEnvOverrides("dev", base, true);
    expect(result.templatesRoot).toBe("/sitecore/templates/X");
    expect(result.renderingsRoot).toBe("/sitecore/layout/X");
  });

  it("merges the per-site prune-defaults roots from scoped vars", () => {
    process.env.SITECOREAI_ENV_DEV_HEADLESS_VARIANTS_ROOT = "/X/HV";
    process.env.SITECOREAI_ENV_DEV_AVAILABLE_RENDERINGS_ROOT = "/X/AR";
    process.env.SITECOREAI_ENV_DEV_CONTENT_ITEMS_ROOT = "/X/Data";
    process.env.SITECOREAI_ENV_DEV_PRESENTATION_STYLES_ROOT = "/X/Styles";
    const result = applyEnvOverrides("dev", base, true);
    expect(result).toMatchObject({
      headlessVariantsRoot: "/X/HV",
      availableRenderingsRoot: "/X/AR",
      contentItemsRoot: "/X/Data",
      presentationStylesRoot: "/X/Styles",
    });
  });

  it("preserves the existing env fields and only layers overrides on top", () => {
    process.env.SITECOREAI_ENV_DEV_CM_HOST = "https://override.host";
    const existing: EnvironmentConfiguration = {
      host: "https://original.host",
      authority: "https://keep.authority",
    };
    const result = applyEnvOverrides("dev", existing, true);
    expect(result.host).toBe("https://override.host");
    expect(result.authority).toBe("https://keep.authority");
  });

  it("returns a copy of the env unchanged when no env vars are set", () => {
    const existing: EnvironmentConfiguration = { host: "https://h", clientId: "c" };
    const result = applyEnvOverrides("dev", existing, true);
    expect(result).toEqual(existing);
    expect(result).not.toBe(existing);
  });
});

describe("stripAuthenticationTokensFromConfig", () => {
  it("returns the config untouched when there are no env profiles", () => {
    const config = { defaultEnvProfile: "dev" } as RootConfigurationFile;
    expect(stripAuthenticationTokensFromConfig(config)).toBe(config);
  });

  it("removes every credential field from each env profile", () => {
    const config = {
      defaultEnvProfile: "dev",
      envProfiles: {
        dev: {
          host: "https://h",
          accessToken: "a",
          refreshToken: "r",
          refreshTokenParameters: { scope: "x" },
          expiresIn: 3600,
          lastUpdated: "2026-01-01",
          deployToken: "d",
          clientSecret: "secret",
        },
      },
    } as unknown as RootConfigurationFile;

    const sanitized = stripAuthenticationTokensFromConfig(config);
    const dev = sanitized.envProfiles?.dev as Record<string, unknown>;
    expect(dev.host).toBe("https://h");
    for (const field of [
      "accessToken",
      "refreshToken",
      "refreshTokenParameters",
      "expiresIn",
      "lastUpdated",
      "deployToken",
      "clientSecret",
    ]) {
      expect(dev[field]).toBeUndefined();
    }
  });

  it("does not mutate the input config", () => {
    const config = {
      envProfiles: { dev: { host: "https://h", deployToken: "d" } },
    } as unknown as RootConfigurationFile;
    stripAuthenticationTokensFromConfig(config);
    expect((config.envProfiles?.dev as Record<string, unknown>).deployToken).toBe("d");
  });
});
