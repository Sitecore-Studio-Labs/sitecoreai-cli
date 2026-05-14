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
  runCleanupPublish: vi.fn().mockResolvedValue([]),
  runCleanupRename: vi.fn().mockResolvedValue([]),
  runCleanupRoles: vi.fn().mockResolvedValue([]),
  runCleanupSiteResidue: vi.fn().mockResolvedValue([]),
  runCleanupUsers: vi.fn().mockResolvedValue([]),
  runCleanupVersionsArchive: vi.fn().mockResolvedValue([]),
  runCleanupVersionsPrune: vi.fn().mockResolvedValue([]),
  runCleanupWorkflowAdvance: vi.fn().mockResolvedValue([]),
  runCleanupWorkflowApply: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../src/hygiene/tasks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/hygiene/tasks")>();
  return { ...actual, ...hygieneMocks };
});

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
      expect(matched, `CLI cleanup group '${group}' has no MCP verb in cleanup_execute`).toBe(
        true
      );
    }
  });

  it("cleanup_preview enum matches cleanup_execute enum (shared verb surface)", async () => {
    const preview = await getVerbEnum("cleanup_preview");
    const execute = await getVerbEnum("cleanup_execute");
    expect(new Set(preview)).toEqual(new Set(execute));
  });
});
