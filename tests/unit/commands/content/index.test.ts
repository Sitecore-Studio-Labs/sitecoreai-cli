import { describe, expect, it } from "vitest";
import { createContentCommand } from "../../../../src/commands/content";
import { createContentVersionCommand } from "../../../../src/commands/content/version";

/**
 * Smoke tests for the `content` and `content version` command-tree
 * assemblers. Verifies the subcommand wiring (each `createX()` factory
 * produces a Command whose children match the documented surface) so
 * a stale registration doesn't ship undetected.
 */

describe("createContentCommand — assembly", () => {
  it("registers the documented top-level subcommands", () => {
    const command = createContentCommand();
    const names = command.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["move", "version"]);
  });

  it("describes the content-state-controls scope", () => {
    expect(createContentCommand().description()).toContain("Content-state controls");
  });
});

describe("createContentVersionCommand — assembly", () => {
  it("registers the per-version verb set", () => {
    const command = createContentVersionCommand();
    const names = command.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["get", "set-never-publish", "set-validity"]);
  });

  it("calls out that the verbs do NOT auto-publish", () => {
    expect(createContentVersionCommand().description()).toContain("NOT auto-publish");
  });
});
