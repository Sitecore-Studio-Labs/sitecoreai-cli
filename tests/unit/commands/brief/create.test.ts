import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai ops brief create` command wiring. Covers:
 *  - the readJsonFile helper (success + the inputError wrap on parse failure)
 *  - createBriefCreateCommand option declarations (--file required, apply/whatIf gates)
 *  - the action handler: forced whatIf when --apply absent, --apply path
 *  - assertCreateBriefInput rejection propagating up from the action
 */

const taskMocks = vi.hoisted(() => ({
  runBriefCreate: vi.fn(),
  assertCreateBriefInput: vi.fn(),
}));

vi.mock("../../../../src/brief/tasks", () => ({
  runBriefCreate: taskMocks.runBriefCreate,
}));
vi.mock("../../../../src/brief", () => ({
  assertCreateBriefInput: taskMocks.assertCreateBriefInput,
}));

import { createBriefCreateCommand } from "../../../../src/commands/brief/create";

const runCmd = async (args: string[], jsonFile?: string): Promise<void> => {
  const command = createBriefCreateCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args, "--file", jsonFile ?? "/tmp/none.json"]);
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scai-brief-create-test-"));
  taskMocks.runBriefCreate.mockReset().mockResolvedValue(undefined);
  taskMocks.assertCreateBriefInput.mockReset().mockImplementation((v: unknown) => v);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("createBriefCreateCommand — command shape", () => {
  const command = createBriefCreateCommand();

  it("declares --file as a mandatory option", () => {
    const required = command.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(["--file"]);
  });

  it("declares --apply + --what-if + --config + --environment-name options", () => {
    const longs = new Set(
      command.options.map((o) => o.long).filter((v): v is string => Boolean(v))
    );
    for (const long of ["--apply", "--what-if", "--config", "--environment-name", "--org-id"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("appends usage examples to the help text", () => {
    let out = "";
    command.configureOutput({ writeOut: (s) => (out += s) });
    command.outputHelp();
    expect(out).toContain("Examples:");
  });
});

describe("createBriefCreateCommand — readJsonFile + action", () => {
  it("reads + parses a valid JSON file, then delegates to runBriefCreate (whatIf forced without --apply)", async () => {
    const file = path.join(tmpDir, "brief.json");
    await fs.promises.writeFile(file, JSON.stringify({ name: "Q3", briefTypeId: "bt-1" }));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runCmd(["--quiet"], file);
    expect(taskMocks.assertCreateBriefInput).toHaveBeenCalledWith({
      name: "Q3",
      briefTypeId: "bt-1",
    });
    expect(taskMocks.runBriefCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input: { name: "Q3", briefTypeId: "bt-1" }, whatIf: true })
    );
    stderr.mockRestore();
  });

  it("threads --apply through (no whatIf forcing)", async () => {
    const file = path.join(tmpDir, "brief.json");
    await fs.promises.writeFile(file, JSON.stringify({ name: "Q3", briefTypeId: "bt-1" }));
    await runCmd(["--quiet", "--apply"], file);
    const call = taskMocks.runBriefCreate.mock.calls[0][0];
    expect(call).toMatchObject({ apply: true });
    expect(call.whatIf).toBeUndefined();
  });

  it("readJsonFile wraps a missing/malformed file in an INPUT_INVALID ScaiError", async () => {
    const file = path.join(tmpDir, "does-not-exist.json");
    await expect(runCmd(["--quiet"], file)).rejects.toThrow(/Could not read JSON/);
    expect(taskMocks.runBriefCreate).not.toHaveBeenCalled();
  });

  it("readJsonFile wraps invalid JSON in an INPUT_INVALID ScaiError with the path", async () => {
    const file = path.join(tmpDir, "broken.json");
    await fs.promises.writeFile(file, "{not valid json");
    await expect(runCmd(["--quiet"], file)).rejects.toThrow(/Could not read JSON.*broken\.json/);
    expect(taskMocks.runBriefCreate).not.toHaveBeenCalled();
  });

  it("assertCreateBriefInput rejection propagates up unchanged", async () => {
    const file = path.join(tmpDir, "brief.json");
    await fs.promises.writeFile(file, JSON.stringify({ wrong: "shape" }));
    taskMocks.assertCreateBriefInput.mockImplementation(() => {
      throw new Error("Missing required briefTypeId");
    });
    await expect(runCmd(["--quiet"], file)).rejects.toThrow(/briefTypeId/);
    expect(taskMocks.runBriefCreate).not.toHaveBeenCalled();
  });
});
