import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/recipe/tasks/shared", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/recipe/tasks/shared")>(
    "../../../../src/recipe/tasks/shared"
  );
  return {
    ...actual,
    toLogger: vi.fn(),
    resolveTenant: vi.fn(),
    ensureAllowWrite: vi.fn(),
  };
});

import {
  pruneDefaultsAgainstClient,
  runRecipePruneDefaults,
  type PruneAction,
} from "../../../../src/recipe/tasks/prune-defaults";
import * as shared from "../../../../src/recipe/tasks/shared";
import type {
  AuthoringApiClient,
  ItemSelector,
  RemoteItem,
} from "../../../../src/recipe/api/client";

const ROOTS = {
  availableRenderingsRoot:
    "/sitecore/content/sandbox-collection/sandbox/Presentation/Available Renderings",
  headlessVariantsRoot:
    "/sitecore/content/sandbox-collection/sandbox/Presentation/Headless Variants",
  contentItemsRoot: "/sitecore/content/sandbox-collection/sandbox/Data",
};

const fakeRemoteItem = (path: string, itemId: string): RemoteItem => ({
  itemId,
  templateId: "00000000-0000-0000-0000-000000000000",
  parentId: "00000000-0000-0000-0000-000000000001",
  name: path.split("/").pop()!,
  path,
  fields: [],
});

/**
 * Build a fake AuthoringApiClient that resolves the named paths to
 * remote items and reports everything else as missing. Captures every
 * delete call so the test can assert exactly which items the prune
 * loop touched.
 */
const makeClient = (
  presentPaths: string[]
): AuthoringApiClient & {
  deletes: ItemSelector[];
} => {
  const presentMap = new Map<string, RemoteItem>(
    presentPaths.map((p, idx) => [
      p,
      fakeRemoteItem(p, `aaaaaaaa-aaaa-aaaa-aaaa-${String(idx).padStart(12, "0")}`),
    ])
  );
  const deletes: ItemSelector[] = [];
  return {
    deletes,
    getItem: async (selector) => {
      if (selector.path && presentMap.has(selector.path)) {
        return presentMap.get(selector.path)!;
      }
      return null;
    },
    getItemsByPaths: async (paths) => {
      const result = new Map<string, RemoteItem | null>();
      for (const p of paths) {
        result.set(p, presentMap.get(p) ?? null);
      }
      return result;
    },
    getChildren: async () => [],
    createItem: vi.fn(async () => ({ itemId: "unused" })),
    updateItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async (selector: ItemSelector) => {
      deletes.push(selector);
    }),
  };
};

describe("pruneDefaultsAgainstClient", () => {
  it("deletes the SXA OOTB Available Renderings + Headless Variants + Data children that exist", async () => {
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.availableRenderingsRoot}/Page Content`,
      `${ROOTS.headlessVariantsRoot}/Image`,
      `${ROOTS.headlessVariantsRoot}/Title`,
      `${ROOTS.contentItemsRoot}/Promos`,
      `${ROOTS.contentItemsRoot}/Texts`,
    ];
    const client = makeClient(presentPaths);

    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });

    // 4 SXA AR children + 7 SXA HV children + 5 Data children = 16 targets.
    expect(actions).toHaveLength(16);
    const deleted = actions.filter((a: PruneAction) => a.status === "deleted");
    expect(deleted.map((a) => a.path).sort()).toEqual(presentPaths.sort());
    const missing = actions.filter((a) => a.status === "missing");
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.availableRenderingsRoot}/Navigation`);
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.headlessVariantsRoot}/LinkList`);
    expect(missing.map((a) => a.path)).toContain(`${ROOTS.contentItemsRoot}/Images`);
    expect(client.deletes).toHaveLength(presentPaths.length);
    // Deletes go by itemId so we don't re-resolve the path inside the
    // mutation.
    expect(client.deletes.every((d) => Boolean(d.itemId) && !d.path)).toBe(true);
  });

  it("preserves the parent folders (no delete call hits Available Renderings, Headless Variants, or Data)", async () => {
    // Even if the parents *did* somehow show up as targets, the test
    // would fail — but more importantly, this asserts the build list
    // never mints the parent paths themselves.
    const client = makeClient([
      ROOTS.availableRenderingsRoot,
      ROOTS.headlessVariantsRoot,
      ROOTS.contentItemsRoot,
    ]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    expect(actions.every((a) => a.path !== ROOTS.availableRenderingsRoot)).toBe(true);
    expect(actions.every((a) => a.path !== ROOTS.headlessVariantsRoot)).toBe(true);
    expect(actions.every((a) => a.path !== ROOTS.contentItemsRoot)).toBe(true);
    expect(client.deletes).toHaveLength(0);
  });

  it("preserves Tags under Data (never lists it as a target)", async () => {
    const client = makeClient([`${ROOTS.contentItemsRoot}/Tags`]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    const targetedNames = actions
      .filter((a) => a.group === "contentItems")
      .map((a) => a.path.split("/").pop()!);
    expect(targetedNames).not.toContain("Tags");
    expect(client.deletes).toHaveLength(0);
  });

  it("keeps FEaaS and Forms in Available Renderings (never lists them as targets)", async () => {
    const client = makeClient([
      `${ROOTS.availableRenderingsRoot}/FEaaS`,
      `${ROOTS.availableRenderingsRoot}/Forms`,
    ]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    const targetedNames = actions
      .filter((a) => a.group === "availableRenderings")
      .map((a) => a.path.split("/").pop()!);
    expect(targetedNames).not.toContain("FEaaS");
    expect(targetedNames).not.toContain("Forms");
    expect(client.deletes).toHaveLength(0);
  });

  it("is idempotent — every target reports as missing on a clean tenant", async () => {
    const client = makeClient([]);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });
    expect(actions.every((a) => a.status === "missing")).toBe(true);
    expect(client.deletes).toHaveLength(0);
  });

  it("treats a between-getItem-and-deleteItem race as missing (concurrent prune / author cleanup)", async () => {
    // Simulate the TOCTOU window: getItem resolves the item, but by the
    // time deleteItem hits the Authoring API the item is gone (another
    // prune ran in parallel, or an author deleted it). The Authoring
    // GraphQL response carries the canonical "was not found ... may have
    // been deleted by another user" message, wrapped by graphql.ts as a
    // NETWORK ScaiError. The prune loop should report this as `missing`
    // and continue rather than abort the whole task.
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.headlessVariantsRoot}/Image`,
    ];
    const client = makeClient(presentPaths);
    const racedPath = `${ROOTS.availableRenderingsRoot}/Media`;
    const racedItemId = (await client.getItem({ path: racedPath }))!.itemId;
    const realDelete = client.deleteItem;
    client.deleteItem = vi.fn(async (selector: ItemSelector) => {
      if (selector.itemId === racedItemId) {
        throw new Error(
          `Authoring GraphQL errors: The item "${selector.itemId}" was not found.\n\nIt may have been deleted by another user.`
        );
      }
      return realDelete(selector);
    });

    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: false,
    });

    const racedAction = actions.find((a: PruneAction) => a.path === racedPath)!;
    expect(racedAction.status).toBe("missing");
    expect(racedAction.itemId).toBeDefined();
    const otherDeleted = actions.find(
      (a: PruneAction) => a.path === `${ROOTS.headlessVariantsRoot}/Image`
    )!;
    expect(otherDeleted.status).toBe("deleted");
  });

  it("re-throws non-not-found delete errors", async () => {
    const client = makeClient([`${ROOTS.availableRenderingsRoot}/Media`]);
    client.deleteItem = vi.fn(async () => {
      throw new Error("Authoring GraphQL errors: Internal server error");
    });
    await expect(pruneDefaultsAgainstClient({ client, ...ROOTS, whatIf: false })).rejects.toThrow(
      /Internal server error/
    );
  });

  it("dry-run reports would-delete actions and skips deleteItem", async () => {
    const presentPaths = [
      `${ROOTS.availableRenderingsRoot}/Media`,
      `${ROOTS.headlessVariantsRoot}/Image`,
    ];
    const client = makeClient(presentPaths);
    const actions = await pruneDefaultsAgainstClient({
      client,
      ...ROOTS,
      whatIf: true,
    });
    const wouldDelete = actions.filter((a) => a.status === "would-delete");
    expect(wouldDelete.map((a) => a.path).sort()).toEqual(presentPaths.sort());
    expect(client.deletes).toHaveLength(0);
    // dry-run still captures the resolved itemIds so a follow-up apply
    // doesn't have to re-resolve them.
    expect(wouldDelete.every((a) => Boolean(a.itemId))).toBe(true);
  });

  it("strips trailing slashes from root paths", async () => {
    const trailingClient = makeClient([`${ROOTS.availableRenderingsRoot}/Media`]);
    const actions = await pruneDefaultsAgainstClient({
      client: trailingClient,
      availableRenderingsRoot: `${ROOTS.availableRenderingsRoot}/`,
      headlessVariantsRoot: `${ROOTS.headlessVariantsRoot}/`,
      contentItemsRoot: `${ROOTS.contentItemsRoot}/`,
      whatIf: false,
    });
    // First targeted AR path should be `<root>/Media` (no double slash).
    const firstAr = actions.find((a) => a.group === "availableRenderings")!;
    expect(firstAr.path).toBe(`${ROOTS.availableRenderingsRoot}/Media`);
    expect(actions.find((a) => a.path.includes("//"))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// runRecipePruneDefaults — the task runner (tenant resolution, root
// resolution, allow-write gate, JSON envelope, human summary).
// ─────────────────────────────────────────────────────────────────────────

interface FakeLogger {
  isJson: () => boolean;
  info: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

let logger: FakeLogger;
let jsonMode: boolean;

const makeTenant = (overrides: Record<string, unknown> = {}) => ({
  envName: "sandbox",
  root: { physicalPath: "/tmp/proj/sitecoreai.cli.json" },
  environment: {
    headlessVariantsRoot: ROOTS.headlessVariantsRoot,
    availableRenderingsRoot: ROOTS.availableRenderingsRoot,
    contentItemsRoot: ROOTS.contentItemsRoot,
  },
  client: makeClient([]),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  jsonMode = false;
  logger = {
    isJson: () => jsonMode,
    info: vi.fn(),
    json: vi.fn(),
  };
  vi.mocked(shared.toLogger).mockReturnValue(logger as never);
  vi.mocked(shared.resolveTenant).mockReturnValue(makeTenant() as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runRecipePruneDefaults", () => {
  it("enforces the allow-write gate in apply mode and returns a deleted summary", async () => {
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        client: makeClient([`${ROOTS.availableRenderingsRoot}/Media`]),
      }) as never
    );

    const result = await runRecipePruneDefaults({ allowWrite: true } as never);

    expect(shared.ensureAllowWrite).toHaveBeenCalledWith(expect.anything(), "sandbox", true);
    expect(result.environment).toBe("sandbox");
    expect(result.whatIf).toBe(false);
    expect(result.summary.deleted).toBe(1);
    expect(result.summary.missing).toBe(15);
    expect(result.summary.wouldDelete).toBe(0);
  });

  it("skips the allow-write gate in --what-if mode and reports would-delete", async () => {
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        client: makeClient([`${ROOTS.headlessVariantsRoot}/Image`]),
      }) as never
    );

    const result = await runRecipePruneDefaults({ whatIf: true } as never);

    expect(shared.ensureAllowWrite).not.toHaveBeenCalled();
    expect(result.whatIf).toBe(true);
    expect(result.summary.wouldDelete).toBe(1);
    expect(result.summary.deleted).toBe(0);
  });

  it("throws INPUT_INVALID when a required root path is not configured", async () => {
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        environment: {
          headlessVariantsRoot: ROOTS.headlessVariantsRoot,
          // availableRenderingsRoot + contentItemsRoot missing.
        },
      }) as never
    );

    await expect(runRecipePruneDefaults({ whatIf: true } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("names every missing root in the INPUT_INVALID message", async () => {
    vi.mocked(shared.resolveTenant).mockReturnValue(makeTenant({ environment: {} }) as never);

    await expect(runRecipePruneDefaults({ whatIf: true } as never)).rejects.toThrow(
      /headlessVariantsRoot, availableRenderingsRoot, contentItemsRoot/
    );
  });

  it("honors per-call root overrides over the env-profile values", async () => {
    const overrideAr = "/sitecore/content/x/Presentation/Available Renderings";
    const overrideHv = "/sitecore/content/x/Presentation/Headless Variants";
    const overrideCi = "/sitecore/content/x/Data";
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        environment: {}, // no roots in the profile — overrides must fill them
        client: makeClient([`${overrideAr}/Media`]),
      }) as never
    );

    const result = await runRecipePruneDefaults({
      whatIf: true,
      availableRenderingsRoot: overrideAr,
      headlessVariantsRoot: overrideHv,
      contentItemsRoot: overrideCi,
    } as never);

    expect(result.actions.some((a) => a.path === `${overrideAr}/Media`)).toBe(true);
    expect(result.summary.wouldDelete).toBe(1);
  });

  it("emits a recipe.prune-defaults JSON envelope in --json mode", async () => {
    jsonMode = true;
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        client: makeClient([`${ROOTS.contentItemsRoot}/Promos`]),
      }) as never
    );

    await runRecipePruneDefaults({ allowWrite: true } as never);

    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as Record<string, unknown>;
    expect(envelope).toMatchObject({
      command: "recipe.prune-defaults",
      environment: "sandbox",
      whatIf: false,
    });
    expect((envelope.actions as unknown[]).length).toBe(16);
  });

  it("writes a human summary line in non-JSON mode", async () => {
    vi.mocked(shared.resolveTenant).mockReturnValue(
      makeTenant({
        client: makeClient([`${ROOTS.contentItemsRoot}/Texts`]),
      }) as never
    );

    await runRecipePruneDefaults({ allowWrite: true } as never);

    expect(logger.json).not.toHaveBeenCalled();
    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("Summary: 1 deleted"))).toBe(true);
    expect(lines.some((l) => l.includes("Pruning SXA defaults"))).toBe(true);
  });

  it("labels the human header as a dry-run in --what-if mode", async () => {
    await runRecipePruneDefaults({ whatIf: true } as never);

    const lines = logger.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("Dry-run prune-defaults"))).toBe(true);
  });
});
