import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showBanner } from "../../../src/shared/style";

describe("style helpers", () => {
  const CI_ENV_KEYS = [
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "CIRCLECI",
    "TRAVIS",
    "BUILDKITE",
    "JENKINS_URL",
    "TEAMCITY_VERSION",
    "SITECOREAI_QUIET",
    "SITECOREAI_JSON",
    "SITECOREAI_BANNER",
  ];
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot = {};
    for (const key of CI_ENV_KEYS) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CI_ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("prints banner when allowed", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.SITECOREAI_BANNER = "1";

    showBanner("1.0.0");
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });

  it("suppresses banner when disabled or quiet", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    process.env.SITECOREAI_BANNER = "0";
    showBanner("1.0.0");
    process.env.SITECOREAI_BANNER = "1";
    process.env.SITECOREAI_QUIET = "1";
    showBanner("1.0.0");

    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });

  it("suppresses banner in CI or non-tty", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.env.CI = "1";

    showBanner("1.0.0");
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  });
});
