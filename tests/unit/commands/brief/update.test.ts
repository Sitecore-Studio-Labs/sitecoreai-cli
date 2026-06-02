import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const taskMocks = vi.hoisted(() => ({
  runBriefUpdate: vi.fn(),
}));

vi.mock("../../../../src/brief/tasks", () => taskMocks);

import { createBriefUpdateCommand } from "../../../../src/commands/brief/update";

const tmpFile = (content: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-brief-update-test-"));
  const file = path.join(dir, "patch.json");
  fs.writeFileSync(file, content);
  return file;
};

const tmpFiles: string[] = [];
const stage = (content: string): string => {
  const f = tmpFile(content);
  tmpFiles.push(f);
  return f;
};

const runUpdate = async (args: string[]): Promise<void> => {
  const command = createBriefUpdateCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
      fs.rmdirSync(path.dirname(f));
    } catch {
      // ignore
    }
  }
  tmpFiles.length = 0;
});

describe("createBriefUpdateCommand — wiring", () => {
  // Smoke: factory returns a valid Commander command with the
  // expected name + arg.
  it("returns a command named 'update' with a <briefId> positional", () => {
    const command = createBriefUpdateCommand();
    expect(command.name()).toBe("update");
    // The first positional arg is required.
    expect(command.registeredArguments[0]?.required).toBe(true);
    expect(command.registeredArguments[0]?.name()).toBe("briefId");
  });

  // Smoke: --status accepts only KNOWN_STATUSES (Draft/InReview/etc).
  // An invalid status should fail validation.
  it("rejects an unknown --status value", async () => {
    await expect(
      runUpdate(["b1", "--status", "BogusStatus", "-n", "agents", "--apply"])
    ).rejects.toThrow();
  });
});

describe("createBriefUpdateCommand — input validation", () => {
  it("fails when neither --file nor --status is passed", async () => {
    await expect(runUpdate(["b1", "-n", "agents", "--apply"])).rejects.toThrow(/--file.*--status/i);
  });

  // --file path that doesn't exist → readJsonFile catches the
  // fs error and re-throws an inputError.
  it("fails with a clear message when the --file path is unreadable", async () => {
    await expect(
      runUpdate(["b1", "-f", "/nonexistent-scai-test-path.json", "-n", "agents", "--apply"])
    ).rejects.toThrow(/Could not read JSON/i);
  });

  it("fails when the JSON body is not an object", async () => {
    const f = stage('["array", "not", "object"]');
    await expect(runUpdate(["b1", "-f", f, "-n", "agents", "--apply"])).rejects.toThrow(
      /must be a JSON object/i
    );
  });

  it("fails when the JSON body has an unknown 'status' field", async () => {
    const f = stage(JSON.stringify({ status: "Bogus" }));
    await expect(runUpdate(["b1", "-f", f, "-n", "agents", "--apply"])).rejects.toThrow(
      /Invalid 'status'/i
    );
  });

  it("fails when the JSON body has a 'fields' field that is not an object", async () => {
    const f = stage(JSON.stringify({ fields: ["not", "an", "object"] }));
    await expect(runUpdate(["b1", "-f", f, "-n", "agents", "--apply"])).rejects.toThrow(
      /'fields' must be an object/i
    );
  });

  it("fails when fields is a primitive (not an object)", async () => {
    const f = stage(JSON.stringify({ fields: "string" }));
    await expect(runUpdate(["b1", "-f", f, "-n", "agents", "--apply"])).rejects.toThrow(
      /'fields' must be an object/i
    );
  });
});

describe("createBriefUpdateCommand — happy path", () => {
  // --status only → no file read; runBriefUpdate called with
  // { briefId, patch: { status }, ... }.
  it("--status shortcut routes through runBriefUpdate with the status patch", async () => {
    await runUpdate(["b1", "--status", "Approved", "-n", "agents", "--apply"]);
    expect(taskMocks.runBriefUpdate).toHaveBeenCalledOnce();
    const call = taskMocks.runBriefUpdate.mock.calls[0][0];
    expect(call.briefId).toBe("b1");
    expect(call.patch).toEqual({ status: "Approved" });
  });

  // --file with valid body → patch built from file contents.
  it("--file path threads the JSON body into the patch", async () => {
    const f = stage(JSON.stringify({ locale: "en-us", fields: { audience: "Devs" } }));
    await runUpdate(["b1", "-f", f, "-n", "agents", "--apply"]);
    expect(taskMocks.runBriefUpdate).toHaveBeenCalledOnce();
    const call = taskMocks.runBriefUpdate.mock.calls[0][0];
    expect(call.patch.locale).toBe("en-us");
    expect(call.patch.fields).toEqual({ audience: "Devs" });
  });

  // --file + --status combo → status overrides any status in the
  // file (later spread wins).
  it("--status overrides the file's status field (spread-order semantics)", async () => {
    const f = stage(JSON.stringify({ status: "Draft", locale: "en-us" }));
    await runUpdate(["b1", "-f", f, "--status", "Approved", "-n", "agents", "--apply"]);
    expect(taskMocks.runBriefUpdate).toHaveBeenCalledOnce();
    const call = taskMocks.runBriefUpdate.mock.calls[0][0];
    expect(call.patch.status).toBe("Approved"); // --status overrides
    expect(call.patch.locale).toBe("en-us");
  });

  // Without --apply, the apply gate forces whatIf: true.
  it("without --apply, the apply gate forces whatIf:true", async () => {
    await runUpdate(["b1", "--status", "Approved", "-n", "agents"]);
    const call = taskMocks.runBriefUpdate.mock.calls[0][0];
    expect(call.whatIf).toBe(true);
  });
});

describe("createBriefUpdateCommand — help text", () => {
  // The addHelpText 'after' block carries usage examples; render the
  // help and assert the examples are present (regression guard
  // against an accidental removal).
  it("includes usage examples in the after-help block", () => {
    const command = createBriefUpdateCommand();
    let out = "";
    command.configureOutput({ writeOut: (s) => (out += s) });
    command.outputHelp();
    expect(out).toContain("scai ops brief update");
    expect(out).toContain("--status Approved");
    expect(out).toContain("patch.json");
  });
});
