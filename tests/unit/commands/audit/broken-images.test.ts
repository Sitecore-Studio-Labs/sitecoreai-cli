import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai hygiene audit broken-images …` command wiring. The
 * broken-images task runner is mocked; tests walk the command tree,
 * then parse it the way the CLI does to assert option threading,
 * numeric coercion on the timeout / url-limit flags, and the
 * `collectList` accumulator on `--exclude-domains`.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditBrokenImages: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/broken-images", () => taskMocks);

import { createAuditBrokenImagesCommand } from "../../../../src/commands/audit/broken-images";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

/** Render full help (including `addHelpText` after-blocks) to a string. */
const helpText = (command: Command): string => {
  let out = "";
  command.configureOutput({ writeOut: (s) => (out += s) });
  command.outputHelp();
  return out;
};

const runBrokenImages = async (args: string[]): Promise<void> => {
  const command = createAuditBrokenImagesCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAuditBrokenImagesCommand — command tree", () => {
  const brokenImages = createAuditBrokenImagesCommand();

  it("registers a list subcommand", () => {
    expect(sub(brokenImages, "list")).toBeDefined();
  });

  it("declares the broken-images-specific flags on list", () => {
    const list = sub(brokenImages, "list")!;
    const opts = new Set(list.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    for (const long of [
      "--root",
      "--language",
      "--request-timeout-ms",
      "--url-limit",
      "--exclude-domains",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });

  it("appends an external-HTTP note to the list help text", () => {
    const list = sub(brokenImages, "list")!;
    expect(helpText(list)).toContain("external HTTP requests");
  });
});

describe("broken-images list", () => {
  it("delegates to runAuditBrokenImages with the parsed option bag", async () => {
    await runBrokenImages(["list", "--quiet"]);
    expect(taskMocks.runAuditBrokenImages).toHaveBeenCalledOnce();
    expect(taskMocks.runAuditBrokenImages.mock.calls[0][0]).toMatchObject({ quiet: true });
  });

  it("threads --root and --language through", async () => {
    await runBrokenImages([
      "list",
      "--quiet",
      "--root",
      "/sitecore/content/Site",
      "--language",
      "en-US",
    ]);
    expect(taskMocks.runAuditBrokenImages).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/content/Site", language: "en-US" })
    );
  });

  it("coerces --request-timeout-ms and --url-limit to numbers", async () => {
    await runBrokenImages([
      "list",
      "--quiet",
      "--request-timeout-ms",
      "8000",
      "--url-limit",
      "120",
    ]);
    expect(taskMocks.runAuditBrokenImages).toHaveBeenCalledWith(
      expect.objectContaining({ requestTimeoutMs: 8000, urlLimit: 120 })
    );
  });

  it("defaults --exclude-domains to an empty array when omitted", async () => {
    await runBrokenImages(["list", "--quiet"]);
    expect(taskMocks.runAuditBrokenImages.mock.calls[0][0].excludeDomains).toEqual([]);
  });

  it("splits a comma-separated --exclude-domains value and accumulates repeats", async () => {
    await runBrokenImages([
      "list",
      "--quiet",
      "--exclude-domains",
      "cdn.example.com, img.example.com",
      "--exclude-domains",
      "third-party.net",
    ]);
    expect(taskMocks.runAuditBrokenImages).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeDomains: ["cdn.example.com", "img.example.com", "third-party.net"],
      })
    );
  });
});
