/**
 * `scai hygiene audit baseline accept --audit X --from-stdin` reads a
 * ScaiEnvelope and adds its findings to the per-env baseline. These
 * tests pin the input-validation and idempotency contract.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn().mockReturnValue({
    envName: "sandbox",
    environment: {},
    root: {},
    timeoutMs: undefined,
  }),
}));

import { runBaselineAccept } from "../../../../src/hygiene/tasks/audit/baseline";
import { openBaseline } from "../../../../src/hygiene/baseline";

const replaceStdin = (text: string) => {
  const stream = Readable.from([Buffer.from(text)]) as unknown as typeof process.stdin;
  Object.defineProperty(process, "stdin", { value: stream, configurable: true });
};

let configDir: string;
let originalStdin: typeof process.stdin;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-baseline-accept-"));
  originalStdin = process.stdin;
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

describe("runBaselineAccept", () => {
  it("rejects when --audit is missing", async () => {
    replaceStdin(JSON.stringify({ command: "audit.broken-links.list", data: [] }));
    await expect(
      runBaselineAccept({ fromStdin: true, config: configDir } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects when --from-stdin is missing", async () => {
    await expect(
      runBaselineAccept({ audit: "broken-links", config: configDir } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects when envelope.data is not an array", async () => {
    replaceStdin(JSON.stringify({ command: "audit.x.list", data: { not: "array" } }));
    await expect(
      runBaselineAccept({
        audit: "broken-links",
        fromStdin: true,
        config: configDir,
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("adds each finding to the baseline", async () => {
    replaceStdin(
      JSON.stringify({
        command: "audit.broken-links.list",
        data: [
          {
            itemId: "abc",
            brokenRefs: [{ fieldName: "Body", refItemId: "def" }],
          },
          {
            itemId: "xyz",
            brokenRefs: [{ fieldName: "Title", refItemId: "uvw" }],
          },
        ],
      })
    );
    await runBaselineAccept({
      audit: "broken-links",
      fromStdin: true,
      config: configDir,
      json: true,
    } as never);

    const baseline = openBaseline({ envName: "sandbox", configDir });
    const snap = baseline.snapshot();
    expect(snap.ignored["broken-links"]).toHaveLength(2);
  });

  it("is idempotent: re-running adds nothing new", async () => {
    const envelope = JSON.stringify({
      command: "audit.broken-links.list",
      data: [
        {
          itemId: "abc",
          brokenRefs: [{ fieldName: "Body", refItemId: "def" }],
        },
      ],
    });
    replaceStdin(envelope);
    await runBaselineAccept({
      audit: "broken-links",
      fromStdin: true,
      config: configDir,
      json: true,
    } as never);
    replaceStdin(envelope);
    await runBaselineAccept({
      audit: "broken-links",
      fromStdin: true,
      config: configDir,
      json: true,
    } as never);

    const baseline = openBaseline({ envName: "sandbox", configDir });
    const snap = baseline.snapshot();
    expect(snap.ignored["broken-links"]).toHaveLength(1);
  });

  it("records --note on every accepted entry", async () => {
    replaceStdin(
      JSON.stringify({
        command: "audit.broken-links.list",
        data: [{ itemId: "abc", brokenRefs: [{ fieldName: "Body", refItemId: "def" }] }],
      })
    );
    await runBaselineAccept({
      audit: "broken-links",
      fromStdin: true,
      note: "known debt",
      config: configDir,
      json: true,
    } as never);

    const baseline = openBaseline({ envName: "sandbox", configDir });
    const snap = baseline.snapshot();
    expect(snap.ignored["broken-links"][0].note).toBe("known debt");
  });
});
