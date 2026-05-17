import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consola } from "consola";

/**
 * `scai agents space …` runner coverage. `prepare` (env + session),
 * `loadRecipe` (patch file IO), and the `api/spaces` client are mocked
 * so each test exercises only the runner's branches: JSON vs human
 * rendering, the `--what-if` plan path, and the shallow-merge applied
 * to `updateSpaceConfig`. No network.
 */
vi.mock("../../../../src/agents/tasks/shared", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/tasks/shared")>(
    "../../../../src/agents/tasks/shared"
  );
  return { ...actual, prepare: vi.fn() };
});
// `vi.mock` factories use RELATIVE paths — the `@/` alias is not resolved
// inside the factory. `space.ts` imports `loadRecipe` from `@/sync`.
vi.mock("../../../../src/sync/index", () => ({ loadRecipe: vi.fn() }));
vi.mock("../../../../src/agents/api/spaces", () => ({
  getSpaceArtifacts: vi.fn(),
  getSpaceConfig: vi.fn(),
  updateSpaceConfig: vi.fn(),
}));

import { runSpaceArtifacts, runSpaceGet, runSpaceUpdate } from "../../../../src/agents/tasks/space";
import { prepare } from "../../../../src/agents/tasks/shared";
import { loadRecipe } from "../../../../src/sync/index";
import {
  getSpaceArtifacts,
  getSpaceConfig,
  updateSpaceConfig,
} from "../../../../src/agents/api/spaces";
import { Logger } from "../../../../src/shared/logger";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

let stdout: ReturnType<typeof vi.spyOn>;
let consolaInfo: ReturnType<typeof vi.spyOn>;

/** json mode → quiet logger; human mode → consola-visible logger. */
const usePrepare = (json: boolean): void => {
  vi.mocked(prepare).mockResolvedValue({
    logger: new Logger(false, false, json, false),
    session: SESSION,
    envName: "test",
  } as never);
};

/** Last JSON document written to stdout. */
const jsonOut = (): unknown => JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));

/** Every human line routed through consola.info. */
const humanLines = (): string[] => consolaInfo.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  consolaInfo = vi.spyOn(consola, "info").mockReturnValue(undefined as never);
});

afterEach(() => {
  stdout.mockRestore();
  consolaInfo.mockRestore();
});

describe("runSpaceGet", () => {
  it("renders the fetched config as a key/value list in human mode", async () => {
    usePrepare(false);
    vi.mocked(getSpaceConfig).mockResolvedValue({ spaceName: "Research" } as never);

    await runSpaceGet({ spaceId: "space-1" } as never);

    expect(getSpaceConfig).toHaveBeenCalledWith(SESSION, "space-1");
    const lines = humanLines();
    expect(lines.some((l) => l.includes("space space-1"))).toBe(true);
    expect(lines.some((l) => l.includes("spaceName: Research"))).toBe(true);
  });

  it("writes the config as JSON in --json mode", async () => {
    usePrepare(true);
    vi.mocked(getSpaceConfig).mockResolvedValue({ spaceName: "Research" } as never);

    await runSpaceGet({ spaceId: "space-1" } as never);

    expect(jsonOut()).toMatchObject({ spaceName: "Research" });
  });
});

describe("runSpaceArtifacts", () => {
  it("renders the artifacts as a key/value list in human mode", async () => {
    usePrepare(false);
    vi.mocked(getSpaceArtifacts).mockResolvedValue({ ok: true, data: { result: "x" } } as never);

    await runSpaceArtifacts({ spaceId: "space-7" } as never);

    expect(getSpaceArtifacts).toHaveBeenCalledWith(SESSION, "space-7");
    const lines = humanLines();
    expect(lines.some((l) => l.includes("space space-7 artifacts"))).toBe(true);
    expect(lines.some((l) => l.includes("ok: true"))).toBe(true);
  });

  it("writes the artifacts as JSON in --json mode", async () => {
    usePrepare(true);
    vi.mocked(getSpaceArtifacts).mockResolvedValue({ ok: true, data: { result: "x" } } as never);

    await runSpaceArtifacts({ spaceId: "space-7" } as never);

    expect(jsonOut()).toMatchObject({ ok: true, data: { result: "x" } });
  });
});

describe("runSpaceUpdate", () => {
  it("shallow-merges the patch onto the live config and PUTs the result", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ spaceName: "Renamed" } as never);
    vi.mocked(getSpaceConfig).mockResolvedValue({
      spaceName: "Old",
      agentExecutionMode: "sequential",
    } as never);
    vi.mocked(updateSpaceConfig).mockResolvedValue(undefined as never);

    await runSpaceUpdate({ spaceId: "space-2", file: "patch.json" } as never);

    expect(updateSpaceConfig).toHaveBeenCalledWith(SESSION, "space-2", {
      spaceName: "Renamed",
      agentExecutionMode: "sequential",
    });
    expect(jsonOut()).toMatchObject({ ok: true, updated: "space-2" });
  });

  it("plans without calling updateSpaceConfig in --what-if mode", async () => {
    usePrepare(true);
    vi.mocked(loadRecipe).mockReturnValue({ spaceName: "Renamed", globalContext: {} } as never);
    vi.mocked(getSpaceConfig).mockResolvedValue({ spaceName: "Old" } as never);

    await runSpaceUpdate({ spaceId: "space-2", file: "patch.json", whatIf: true } as never);

    expect(updateSpaceConfig).not.toHaveBeenCalled();
    expect(jsonOut()).toMatchObject({
      plan: { update: "space-2", fields: ["spaceName", "globalContext"] },
    });
  });

  it("reports a human what-if line listing the patched fields", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue({ spaceName: "Renamed" } as never);
    vi.mocked(getSpaceConfig).mockResolvedValue({ spaceName: "Old" } as never);

    await runSpaceUpdate({ spaceId: "space-2", file: "patch.json", whatIf: true } as never);

    const lines = humanLines();
    expect(
      lines.some((l) => l.includes("Would update space space-2") && l.includes("spaceName"))
    ).toBe(true);
    expect(updateSpaceConfig).not.toHaveBeenCalled();
  });

  it("renders (none) in the what-if line when the patch is empty", async () => {
    usePrepare(false);
    vi.mocked(loadRecipe).mockReturnValue({} as never);
    vi.mocked(getSpaceConfig).mockResolvedValue({ spaceName: "Old" } as never);

    await runSpaceUpdate({ spaceId: "space-3", file: "empty.json", whatIf: true } as never);

    const lines = humanLines();
    expect(lines.some((l) => l.includes("(none)"))).toBe(true);
  });
});
