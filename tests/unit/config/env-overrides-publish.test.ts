import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEnvOverrides } from "../../../src/config/env-overrides";
import type { EnvironmentConfiguration } from "../../../src/config";

const PUBLISHING_KEYS = [
  "SITECOREAI_ENV_PROD_PRODUCTION",
  "SITECOREAI_ENV_PROD_ALLOW_FULL_REPUBLISH",
  "SITECOREAI_ENV_PROD_ALLOWED_CI_PIPELINES",
  "SITECOREAI_PRODUCTION",
  "SITECOREAI_ALLOW_FULL_REPUBLISH",
  "SITECOREAI_ALLOWED_CI_PIPELINES",
];

const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of PUBLISHING_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PUBLISHING_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
});

const base: EnvironmentConfiguration = {};

describe("applyEnvOverrides — publishing safety flags", () => {
  it("applies production from a scoped env var", () => {
    process.env.SITECOREAI_ENV_PROD_PRODUCTION = "true";
    const result = applyEnvOverrides("prod", base, true);
    expect(result.production).toBe(true);
  });

  it("applies production=false explicitly", () => {
    process.env.SITECOREAI_ENV_PROD_PRODUCTION = "0";
    const result = applyEnvOverrides("prod", base, true);
    expect(result.production).toBe(false);
  });

  it("falls back to the global env var when includeGlobal is true", () => {
    process.env.SITECOREAI_PRODUCTION = "yes";
    const result = applyEnvOverrides("prod", base, true);
    expect(result.production).toBe(true);
  });

  it("ignores the global env var when includeGlobal is false", () => {
    process.env.SITECOREAI_PRODUCTION = "yes";
    const result = applyEnvOverrides("prod", base, false);
    expect(result.production).toBeUndefined();
  });

  it("applies allowFullRepublish from the scoped env var", () => {
    process.env.SITECOREAI_ENV_PROD_ALLOW_FULL_REPUBLISH = "true";
    const result = applyEnvOverrides("prod", base, true);
    expect(result.allowFullRepublish).toBe(true);
  });

  it("parses allowedCiPipelines as a comma-separated list, trimming whitespace", () => {
    process.env.SITECOREAI_ENV_PROD_ALLOWED_CI_PIPELINES =
      "release-train,  github-actions ,, gitlab ";
    const result = applyEnvOverrides("prod", base, true);
    expect(result.allowedCiPipelines).toEqual(["release-train", "github-actions", "gitlab"]);
  });

  it("does not set publishing fields when no env var is present", () => {
    const result = applyEnvOverrides("prod", base, true);
    expect(result.production).toBeUndefined();
    expect(result.allowFullRepublish).toBeUndefined();
    expect(result.allowedCiPipelines).toBeUndefined();
  });

  it("normalizes env names containing dashes into the scope key", () => {
    process.env.SITECOREAI_ENV_US_PROD_PRODUCTION = "true";
    const result = applyEnvOverrides("us-prod", base, true);
    expect(result.production).toBe(true);
  });
});
