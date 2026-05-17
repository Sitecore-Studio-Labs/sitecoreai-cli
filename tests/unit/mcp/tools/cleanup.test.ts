import { describe, expect, it, vi } from "vitest";
import type { z, ZodEnum } from "zod";
import type { McpContext } from "../../../../src/mcp/auth";

const hygieneMocks = vi.hoisted(() => ({
  runCleanupArchivePurge: vi.fn().mockResolvedValue([]),
  runCleanupDeadTemplates: vi.fn().mockResolvedValue([]),
  runCleanupDuplicates: vi.fn().mockResolvedValue([]),
  runCleanupEmptyFolders: vi.fn().mockResolvedValue([]),
  runCleanupFieldSet: vi.fn().mockResolvedValue([]),
  runCleanupFindReplace: vi.fn().mockResolvedValue([]),
  runCleanupLanguageVersionAdd: vi.fn().mockResolvedValue([]),
  runCleanupRename: vi.fn().mockResolvedValue([]),
  runCleanupRoles: vi.fn().mockResolvedValue([]),
  runCleanupSiteResidue: vi.fn().mockResolvedValue([]),
  runCleanupUsers: vi.fn().mockResolvedValue([]),
  runCleanupVersionsArchive: vi.fn().mockResolvedValue([]),
  runCleanupVersionsPrune: vi.fn().mockResolvedValue([]),
  runCleanupWorkflowAdvance: vi.fn().mockResolvedValue([]),
  runCleanupWorkflowApply: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../src/hygiene/tasks/cleanup/archive-purge", () => ({
  runCleanupArchivePurge: hygieneMocks.runCleanupArchivePurge,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/dead-templates", () => ({
  runCleanupDeadTemplates: hygieneMocks.runCleanupDeadTemplates,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/duplicates", () => ({
  runCleanupDuplicates: hygieneMocks.runCleanupDuplicates,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/empty-folders", () => ({
  runCleanupEmptyFolders: hygieneMocks.runCleanupEmptyFolders,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/field-set", () => ({
  runCleanupFieldSet: hygieneMocks.runCleanupFieldSet,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/find-replace", () => ({
  runCleanupFindReplace: hygieneMocks.runCleanupFindReplace,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/language-version-add", () => ({
  runCleanupLanguageVersionAdd: hygieneMocks.runCleanupLanguageVersionAdd,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/rename", () => ({
  runCleanupRename: hygieneMocks.runCleanupRename,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/roles", () => ({
  runCleanupRoles: hygieneMocks.runCleanupRoles,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/site-residue", () => ({
  runCleanupSiteResidue: hygieneMocks.runCleanupSiteResidue,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/users", () => ({
  runCleanupUsers: hygieneMocks.runCleanupUsers,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/versions-archive", () => ({
  runCleanupVersionsArchive: hygieneMocks.runCleanupVersionsArchive,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/versions-prune", () => ({
  runCleanupVersionsPrune: hygieneMocks.runCleanupVersionsPrune,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-advance", () => ({
  runCleanupWorkflowAdvance: hygieneMocks.runCleanupWorkflowAdvance,
}));
vi.mock("../../../../src/hygiene/tasks/cleanup/workflow-apply", () => ({
  runCleanupWorkflowApply: hygieneMocks.runCleanupWorkflowApply,
}));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp/sitecoreai.cli.json",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: async () => undefined,
  sendNotification: async () => undefined,
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

const getVerbEnum = async (toolName: "cleanup_preview" | "cleanup_execute"): Promise<string[]> => {
  const reg = await setup();
  const tool = reg.getTool(toolName)!;
  const verbField = (tool.inputSchema as { verb: z.ZodType }).verb;
  // ZodEnum exposes its options as the `options` array on the def.
  const options = (verbField as unknown as ZodEnum<[string, ...string[]]>).options;
  return [...options];
};

describe("cleanup_execute — verb routing", () => {
  it("verb='workflow-advance' requires commandName (regression: verb was missing pre-fix)", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("cleanup_execute")!.handler(
        {
          verb: "workflow-advance",
          allowWrite: true,
        },
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='workflow-advance' dispatches when commandName is provided", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "workflow-advance",
        commandName: "Submit",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupWorkflowAdvance.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.commandName).toBe("Submit");
    expect(call.allowWrite).toBe(true);
    expect(call.whatIf).toBe(false);
  });

  it("verb='workflow-apply' requires workflow", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("cleanup_execute")!.handler(
        {
          verb: "workflow-apply",
          allowWrite: true,
        },
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("verb='workflow-apply' forwards workflow + template + reattach + maxApplies to the runner", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "workflow-apply",
        workflow: "Article Workflow",
        template: "/sitecore/templates/Foundation/Article",
        reattach: true,
        maxApplies: 50,
        root: "/sitecore/content/MySite",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupWorkflowApply.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.workflow).toBe("Article Workflow");
    expect(call.template).toBe("/sitecore/templates/Foundation/Article");
    expect(call.reattach).toBe(true);
    expect(call.maxApplies).toBe(50);
    expect(call.root).toBe("/sitecore/content/MySite");
    expect(call.allowWrite).toBe(true);
    expect(call.whatIf).toBe(false);
  });

  it("verb='site-residue' translates `extraRoots` into the library's `root: string[]` option", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "site-residue",
        extraRoots: ["/sitecore/templates/Project/Custom"],
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupSiteResidue.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.root).toEqual(["/sitecore/templates/Project/Custom"]);
  });

  it("verb='site-residue' drops the top-level `root` (string) so it doesn't corrupt the array shape", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "site-residue",
        // A caller might pass `root` out of habit. The runner expects
        // `root: string[]` — forwarding the string would crash the spread
        // in the library. The MCP layer must drop it for this verb.
        root: "/sitecore/content/MySite",
        extraRoots: ["/sitecore/templates/Project/Extra"],
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupSiteResidue.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.root).toEqual(["/sitecore/templates/Project/Extra"]);
    expect(typeof call.root).not.toBe("string");
  });

  it("cleanup_preview always forces whatIf=true regardless of input", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_preview")!.handler(
      {
        verb: "workflow-advance",
        commandName: "Submit",
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupWorkflowAdvance.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.whatIf).toBe(true);
  });

  it("cleanup_execute with whatIf=true sets allowWrite=false even on auth=write call", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "workflow-advance",
        commandName: "Submit",
        whatIf: true,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupWorkflowAdvance.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.whatIf).toBe(true);
    expect(call.allowWrite).toBe(false);
  });
});

describe("cleanup_execute — denyMcpElevation gate", () => {
  const denyContext: McpContext = {
    envName: "prod",
    configPath: "/tmp/sitecoreai.cli.json",
    resolved: {
      envName: "prod",
      environment: {} as never,
      root: {
        environments: {
          prod: { name: "prod", host: "h", denyMcpElevation: true },
        },
      } as never,
      timeoutMs: undefined,
    },
    allowWriteEnabled: false,
    deployToken: "tok",
  };

  it("refuses to mutate when env.denyMcpElevation is true", async () => {
    hygieneMocks.runCleanupWorkflowAdvance.mockClear();
    const reg = await setup();
    await expect(
      reg.getTool("cleanup_execute")!.handler(
        {
          verb: "workflow-advance",
          commandName: "Submit",
          allowWrite: true,
        },
        denyContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(hygieneMocks.runCleanupWorkflowAdvance).not.toHaveBeenCalled();
  });

  it("still permits whatIf preview when env.denyMcpElevation is true", async () => {
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "workflow-advance",
        commandName: "Submit",
        whatIf: true,
      },
      denyContext,
      fakeExtra
    );
    // The gate fires only on mutating calls — what-if previews are read-only.
    expect(hygieneMocks.runCleanupWorkflowAdvance).toHaveBeenCalled();
  });
});

describe("cleanup_execute — per-verb required-input validation", () => {
  const expectInvalid = async (input: Record<string, unknown>): Promise<void> => {
    const reg = await setup();
    await expect(
      reg
        .getTool("cleanup_execute")!
        .handler({ allowWrite: true, ...input } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  };

  it("versions-prune without `keep` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "versions-prune", root: "/sitecore/content" }));

  it("versions-prune without `root` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "versions-prune", keep: 5 }));

  it("versions-archive without `keep` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "versions-archive", root: "/sitecore/content" }));

  it("empty-folders without `root` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "empty-folders" }));

  it("find-replace without `pattern` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "find-replace", replacement: "x" }));

  it("find-replace without `replacement` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "find-replace", pattern: "foo" }));

  it("field-set without `field` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "field-set", value: "x" }));

  it("field-set in a non-clear mode without `value` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "field-set", field: "Title" }));

  it("rename without `pattern` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "rename", replacement: "x" }));

  it("language-versions-add without `languages` throws INPUT_INVALID", () =>
    expectInvalid({ verb: "language-versions-add" }));
});

describe("cleanup_execute — valid required-input paths", () => {
  it("versions-prune with keep + root dispatches to the runner", async () => {
    hygieneMocks.runCleanupVersionsPrune.mockClear();
    const reg = await setup();
    await reg
      .getTool("cleanup_execute")!
      .handler(
        { verb: "versions-prune", keep: 3, root: "/sitecore/content", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    const call = hygieneMocks.runCleanupVersionsPrune.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.keep).toBe(3);
    expect(call.root).toBe("/sitecore/content");
    expect(call.allowWrite).toBe(true);
  });

  it("field-set mode='clear' is permitted without a `value`", async () => {
    hygieneMocks.runCleanupFieldSet.mockClear();
    const reg = await setup();
    await reg
      .getTool("cleanup_execute")!
      .handler(
        { verb: "field-set", field: "Description", mode: "clear", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    const call = hygieneMocks.runCleanupFieldSet.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call.field).toBe("Description");
    expect(call.mode).toBe("clear");
  });

  it("find-replace forwards pattern + replacement + literal", async () => {
    hygieneMocks.runCleanupFindReplace.mockClear();
    const reg = await setup();
    await reg.getTool("cleanup_execute")!.handler(
      {
        verb: "find-replace",
        pattern: "old",
        replacement: "new",
        literal: true,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call = hygieneMocks.runCleanupFindReplace.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.pattern).toBe("old");
    expect(call.replacement).toBe("new");
    expect(call.literal).toBe(true);
  });

  it("language-versions-add forwards the languages array", async () => {
    hygieneMocks.runCleanupLanguageVersionAdd.mockClear();
    const reg = await setup();
    await reg
      .getTool("cleanup_execute")!
      .handler(
        { verb: "language-versions-add", languages: ["fr", "de"], allowWrite: true },
        fakeContext,
        fakeExtra
      );
    const call = hygieneMocks.runCleanupLanguageVersionAdd.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(call.languages).toEqual(["fr", "de"]);
  });
});

describe("cleanup — result envelope", () => {
  it("reports count=0 + a '0 actions' summary on an empty result", async () => {
    hygieneMocks.runCleanupRoles.mockResolvedValueOnce([]);
    const reg = await setup();
    const result = await reg
      .getTool("cleanup_execute")!
      .handler({ verb: "roles", allowWrite: true }, fakeContext, fakeExtra);
    expect((result.structuredContent as { count: number }).count).toBe(0);
    expect(result.content[0]!.text).toContain("0 action");
  });

  it("summarizes a non-empty result by per-action status", async () => {
    hygieneMocks.runCleanupRoles.mockResolvedValueOnce([
      { status: "deleted" },
      { status: "deleted" },
      { status: "skipped" },
    ] as never);
    const reg = await setup();
    const result = await reg
      .getTool("cleanup_execute")!
      .handler({ verb: "roles", allowWrite: true }, fakeContext, fakeExtra);
    const structured = result.structuredContent as { count: number; actions: unknown[] };
    expect(structured.count).toBe(3);
    expect(structured.actions).toHaveLength(3);
    // summary string aggregates the status tally.
    expect(result.content[0]!.text).toMatch(/deleted=2/);
    expect(result.content[0]!.text).toMatch(/skipped=1/);
  });

  it("dead-templates flattens the {templates, folders} envelope into a flat action list", async () => {
    hygieneMocks.runCleanupDeadTemplates.mockResolvedValueOnce({
      templates: [{ status: "deleted" }],
      folders: [{ status: "deleted" }, { status: "deleted" }],
    } as never);
    const reg = await setup();
    const result = await reg
      .getTool("cleanup_execute")!
      .handler({ verb: "dead-templates", allowWrite: true }, fakeContext, fakeExtra);
    // 1 template + 2 folders flattened to 3 actions.
    expect((result.structuredContent as { count: number }).count).toBe(3);
  });
});

describe("cleanup_preview — validation runs before the runner", () => {
  it("cleanup_preview also enforces per-verb required inputs", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("cleanup_preview")!
        .handler({ verb: "versions-prune" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("cleanup_preview structuredContent always reports whatIf=true", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("cleanup_preview")!
      .handler({ verb: "roles" }, fakeContext, fakeExtra);
    expect((result.structuredContent as { whatIf: boolean }).whatIf).toBe(true);
  });
});

describe("cleanup_execute — CLI/MCP parity", () => {
  it("every CLI cleanup group has at least one corresponding MCP verb", async () => {
    // Authoritative CLI surface: the commander tree built by
    // createCleanupCommand. Walk its subcommand names — that's the live
    // list of CLI groups regardless of file organization.
    const { createCleanupCommand } = await import("../../../../src/commands/cleanup");
    const cmd = createCleanupCommand();
    const cliGroups = cmd.commands.map((c) => c.name());

    const mcpVerbs = await getVerbEnum("cleanup_execute");

    // The MCP verb for a CLI group is either `<group>` itself or
    // `<group>-<leaf>`. Both shapes are in use today (e.g.  `roles` vs
    // `versions-prune`). A group with no matching verb is a routing gap
    // — that was the bug for workflow + site-residue before this fix.
    for (const group of cliGroups) {
      const matched = mcpVerbs.some((v) => v === group || v.startsWith(`${group}-`));
      expect(matched, `CLI cleanup group '${group}' has no MCP verb in cleanup_execute`).toBe(true);
    }
  });

  it("cleanup_preview enum matches cleanup_execute enum (shared verb surface)", async () => {
    const preview = await getVerbEnum("cleanup_preview");
    const execute = await getVerbEnum("cleanup_execute");
    expect(new Set(preview)).toEqual(new Set(execute));
  });
});
