import { describe, expect, it } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config";
import { isProductionTier } from "../../../src/publishing/env-tier";

const env = (overrides: Partial<EnvironmentConfiguration>): EnvironmentConfiguration =>
  ({ name: "sandbox", ...overrides }) as EnvironmentConfiguration;

describe("isProductionTier", () => {
  it("returns true when production: true is set explicitly", () => {
    expect(isProductionTier(env({ name: "anything", production: true }))).toBe(true);
  });

  it("returns false when production: false is set, even on prod-named envs", () => {
    expect(isProductionTier(env({ name: "prod-test", production: false }))).toBe(false);
    expect(isProductionTier(env({ name: "live-canary", production: false }))).toBe(false);
  });

  it("auto-flags names matching /prod/i", () => {
    expect(isProductionTier(env({ name: "prod" }))).toBe(true);
    expect(isProductionTier(env({ name: "production" }))).toBe(true);
    expect(isProductionTier(env({ name: "us-prod-east" }))).toBe(true);
    expect(isProductionTier(env({ name: "PROD" }))).toBe(true);
  });

  it("auto-flags names matching /^live/i (but not 'live' as a substring)", () => {
    expect(isProductionTier(env({ name: "live" }))).toBe(true);
    expect(isProductionTier(env({ name: "Live-EU" }))).toBe(true);
    expect(isProductionTier(env({ name: "preview-live" }))).toBe(false);
  });

  it("returns false for sandbox-style names", () => {
    expect(isProductionTier(env({ name: "sandbox" }))).toBe(false);
    expect(isProductionTier(env({ name: "dev" }))).toBe(false);
    expect(isProductionTier(env({ name: "staging" }))).toBe(false);
    expect(isProductionTier(env({ name: "preview" }))).toBe(false);
  });

  it("returns false when name is missing", () => {
    expect(isProductionTier(env({ name: undefined }))).toBe(false);
  });
});
