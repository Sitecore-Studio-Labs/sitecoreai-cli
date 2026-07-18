import { afterEach, describe, expect, it } from "vitest";

import { resolveRecipePushMode, resolveRecipePushOnError } from "../../../src/recipe/push-mode";

describe("resolveRecipePushMode", () => {
  const original = process.env.SITECOREAI_RECIPE_PUSH_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.SITECOREAI_RECIPE_PUSH_MODE;
    else process.env.SITECOREAI_RECIPE_PUSH_MODE = original;
  });

  it("defaults to strict when the env var is unset", () => {
    delete process.env.SITECOREAI_RECIPE_PUSH_MODE;
    expect(resolveRecipePushMode()).toBe("strict");
    expect(resolveRecipePushOnError()).toBe("abort");
  });

  it("is tolerant when the env var is 'tolerant' (case/space-insensitive)", () => {
    process.env.SITECOREAI_RECIPE_PUSH_MODE = "  Tolerant ";
    expect(resolveRecipePushMode()).toBe("tolerant");
    expect(resolveRecipePushOnError()).toBe("continue");
  });

  it("treats any other value as strict", () => {
    process.env.SITECOREAI_RECIPE_PUSH_MODE = "loose";
    expect(resolveRecipePushMode()).toBe("strict");
    expect(resolveRecipePushOnError()).toBe("abort");
  });
});
