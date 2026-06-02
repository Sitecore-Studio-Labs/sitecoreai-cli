import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * Coverage for the thin audit-command wrappers — each defers all heavy
 * lifting to a `runAudit*` task and registers a `list` subcommand. The
 * tests check the command shape, optional/argparser-decorated flags,
 * and the action wiring. Bundled so the per-command scaffolding cost
 * stays low.
 */

const taskMocks = vi.hoisted(() => ({
  runAuditBrokenLinks: vi.fn(),
  runAuditDeadTemplates: vi.fn(),
  runAuditRoleBloat: vi.fn(),
  runAuditEmptyRoles: vi.fn(),
  runAuditHeavyTemplates: vi.fn(),
  runAuditEmptyLinks: vi.fn(),
  runAuditEmptyItems: vi.fn(),
  runAuditStaleWorkflow: vi.fn(),
  runAuditMissingMeta: vi.fn(),
  runAuditPageDesignOrphans: vi.fn(),
  runAuditBrokenImages: vi.fn(),
  runAuditDataSourceMissing: vi.fn(),
  runAuditAltTextMissing: vi.fn(),
  runAuditDuplicates: vi.fn(),
  runAuditLanguageData: vi.fn(),
  runAuditLargeFields: vi.fn(),
  runAuditOrphans: vi.fn(),
  runAuditPresentationBroken: vi.fn(),
  runAuditReferences: vi.fn(),
  runAuditSiteResidue: vi.fn(),
  runAuditStandardValuesConflicts: vi.fn(),
  runAuditStaleContent: vi.fn(),
  runAuditStaleUsers: vi.fn(),
  runAuditTemplateInheritanceDependencies: vi.fn(),
  runAuditTranslationCoverage: vi.fn(),
  runAuditUnusedMedia: vi.fn(),
}));

vi.mock("../../../../src/hygiene/tasks/audit/broken-links", () => ({
  runAuditBrokenLinks: taskMocks.runAuditBrokenLinks,
}));
vi.mock("../../../../src/hygiene/tasks/audit/dead-templates", () => ({
  runAuditDeadTemplates: taskMocks.runAuditDeadTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/audit/role-bloat", () => ({
  runAuditRoleBloat: taskMocks.runAuditRoleBloat,
}));
vi.mock("../../../../src/hygiene/tasks/audit/empty-roles", () => ({
  runAuditEmptyRoles: taskMocks.runAuditEmptyRoles,
}));
vi.mock("../../../../src/hygiene/tasks/audit/heavy-templates", () => ({
  runAuditHeavyTemplates: taskMocks.runAuditHeavyTemplates,
}));

import { createAuditBrokenLinksCommand } from "../../../../src/commands/audit/broken-links";
import { createAuditDeadTemplatesCommand } from "../../../../src/commands/audit/dead-templates";
import { createAuditRoleBloatCommand } from "../../../../src/commands/audit/role-bloat";
import { createAuditEmptyRolesCommand } from "../../../../src/commands/audit/empty-roles";
import { createAuditHeavyTemplatesCommand } from "../../../../src/commands/audit/heavy-templates";

const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runListSubcommand = async (
  builder: () => Command,
  extraArgs: string[] = []
): Promise<Command> => {
  const command = builder();
  command.exitOverride();
  await command.parseAsync(["node", "scai", "list", "--quiet", ...extraArgs]);
  return command;
};

beforeEach(() => {
  for (const mock of Object.values(taskMocks)) mock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit broken-links", () => {
  it("registers the list subcommand with a --root option", () => {
    const command = createAuditBrokenLinksCommand();
    const list = sub(command, "list");
    expect(list).toBeDefined();
    expect(list!.options.find((o) => o.long === "--root")).toBeDefined();
  });

  it("threads --root through to runAuditBrokenLinks", async () => {
    await runListSubcommand(createAuditBrokenLinksCommand, ["--root", "/sitecore/content/Demo"]);
    expect(taskMocks.runAuditBrokenLinks).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/content/Demo" })
    );
  });

  it("delegates with no --root when omitted (the task picks its own default)", async () => {
    await runListSubcommand(createAuditBrokenLinksCommand);
    const call = taskMocks.runAuditBrokenLinks.mock.calls[0][0];
    expect(call.root).toBeUndefined();
  });
});

describe("audit dead-templates", () => {
  it("registers list + --root", () => {
    const command = createAuditDeadTemplatesCommand();
    const list = sub(command, "list");
    expect(list).toBeDefined();
    expect(list!.options.find((o) => o.long === "--root")).toBeDefined();
  });

  it("threads --root pointing at the templates tree", async () => {
    await runListSubcommand(createAuditDeadTemplatesCommand, ["--root", "/sitecore/templates/Foo"]);
    expect(taskMocks.runAuditDeadTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/sitecore/templates/Foo" })
    );
  });
});

describe("audit role-bloat", () => {
  it("registers list + --threshold (coerced to int) + --include-admins", () => {
    const command = createAuditRoleBloatCommand();
    const list = sub(command, "list")!;
    const longs = new Set(list.options.map((o) => o.long).filter((v): v is string => Boolean(v)));
    expect(longs.has("--threshold")).toBe(true);
    expect(longs.has("--include-admins")).toBe(true);
  });

  it("coerces --threshold to a number and threads --include-admins", async () => {
    await runListSubcommand(createAuditRoleBloatCommand, ["--threshold", "20", "--include-admins"]);
    expect(taskMocks.runAuditRoleBloat).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 20, includeAdmins: true })
    );
  });

  it("delegates with default threshold (undefined) when omitted — task picks 10", async () => {
    await runListSubcommand(createAuditRoleBloatCommand);
    const call = taskMocks.runAuditRoleBloat.mock.calls[0][0];
    expect(call.threshold).toBeUndefined();
    expect(call.includeAdmins).toBeUndefined();
  });
});

describe("audit empty-roles", () => {
  it("registers list + --domain", () => {
    const command = createAuditEmptyRolesCommand();
    const list = sub(command, "list")!;
    expect(list.options.find((o) => o.long === "--domain")).toBeDefined();
  });

  it("threads --domain through", async () => {
    await runListSubcommand(createAuditEmptyRolesCommand, ["--domain", "sitecore"]);
    expect(taskMocks.runAuditEmptyRoles).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "sitecore" })
    );
  });
});

describe("audit heavy-templates", () => {
  it("registers list and delegates with no required args", async () => {
    const command = createAuditHeavyTemplatesCommand();
    expect(sub(command, "list")).toBeDefined();
    await runListSubcommand(createAuditHeavyTemplatesCommand);
    expect(taskMocks.runAuditHeavyTemplates).toHaveBeenCalledOnce();
  });
});
