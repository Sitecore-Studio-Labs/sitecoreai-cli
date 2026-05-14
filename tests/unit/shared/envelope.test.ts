/**
 * `buildScaiEnvelope` is the canonical builder for scai's CLI output
 * envelope. These tests pin the shape contract that downstream agents
 * and automation depend on.
 */
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildScaiEnvelope, readScaiEnvelopeFromStdin } from "../../../src/shared/envelope";

describe("buildScaiEnvelope", () => {
  it("emits the minimum shape (command, environment, data)", () => {
    const env = buildScaiEnvelope({
      command: "deploy.test",
      environment: "demo",
      data: { ok: true },
    });
    expect(env).toEqual({
      command: "deploy.test",
      environment: "demo",
      data: { ok: true },
    });
  });

  it("auto-counts when data is an array", () => {
    const env = buildScaiEnvelope({
      command: "audit.broken-links.list",
      environment: "demo",
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(env.count).toBe(3);
  });

  it("does not set count when data is not an array", () => {
    const env = buildScaiEnvelope({
      command: "deploy.test",
      environment: "demo",
      data: { id: "scalar" },
    });
    expect("count" in env).toBe(false);
  });

  it("hoists canonical envelope keys from `extra` to envelope-level", () => {
    const env = buildScaiEnvelope({
      command: "deploy.test",
      environment: "demo",
      data: [{ id: 1 }],
      extra: {
        totalCount: 100,
        pageSize: 50,
        whatIf: true,
        ignoredCount: 5,
        summary: "headline",
      },
    });
    expect(env.totalCount).toBe(100);
    expect(env.pageSize).toBe(50);
    expect(env.whatIf).toBe(true);
    expect(env.ignoredCount).toBe(5);
    expect(env.summary).toBe("headline");
    expect("meta" in env).toBe(false);
  });

  it("collects non-canonical `extra` keys under `meta`", () => {
    const env = buildScaiEnvelope({
      command: "deploy.test",
      environment: "demo",
      data: null,
      extra: { root: "/sitecore/content", customField: 42 },
    });
    expect(env.meta).toEqual({ root: "/sitecore/content", customField: 42 });
  });

  it("mixes canonical hoisting and meta collection cleanly", () => {
    const env = buildScaiEnvelope({
      command: "audit.x.list",
      environment: "demo",
      data: [],
      extra: {
        totalCount: 0,
        root: "/sitecore/content",
        scannedCount: 5000,
      },
    });
    expect(env.totalCount).toBe(0);
    expect(env.count).toBe(0);
    expect(env.meta).toEqual({ root: "/sitecore/content", scannedCount: 5000 });
  });

  it("treats undefined/null environment as null in the envelope", () => {
    const env = buildScaiEnvelope({
      command: "deploy.test",
      environment: undefined,
      data: null,
    });
    expect(env.environment).toBeNull();
  });

  it("allows extra to override the auto-computed count", () => {
    const env = buildScaiEnvelope({
      command: "audit.x.list",
      environment: "demo",
      data: [1, 2, 3, 4, 5],
      extra: { count: 100 },
    });
    expect(env.count).toBe(100);
  });
});

describe("readScaiEnvelopeFromStdin", () => {
  let originalStdin: typeof process.stdin;

  const replaceStdin = (text: string) => {
    const stream = Readable.from([Buffer.from(text)]) as unknown as typeof process.stdin;
    Object.defineProperty(process, "stdin", {
      value: stream,
      configurable: true,
    });
  };

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      configurable: true,
    });
  });

  it("parses a valid envelope from stdin", async () => {
    replaceStdin(
      JSON.stringify({
        command: "audit.duplicates.list",
        environment: "demo",
        data: [{ contentHash: "abc", members: [], count: 0 }],
      })
    );
    const envelope = await readScaiEnvelopeFromStdin();
    expect(envelope.command).toBe("audit.duplicates.list");
    expect(envelope.data).toBeInstanceOf(Array);
  });

  it("rejects empty stdin with a helpful error", async () => {
    replaceStdin("");
    await expect(readScaiEnvelopeFromStdin()).rejects.toThrow(/empty/i);
  });

  it("rejects non-JSON input", async () => {
    replaceStdin("not json at all");
    await expect(readScaiEnvelopeFromStdin()).rejects.toThrow(/valid JSON/);
  });

  it("rejects JSON that isn't an object", async () => {
    replaceStdin(JSON.stringify(["array", "instead"]));
    await expect(readScaiEnvelopeFromStdin()).rejects.toThrow(/object/);
  });

  it("rejects an envelope missing `command`", async () => {
    replaceStdin(JSON.stringify({ data: [] }));
    await expect(readScaiEnvelopeFromStdin()).rejects.toThrow(/command/);
  });

  it("rejects an envelope missing `data`", async () => {
    replaceStdin(JSON.stringify({ command: "audit.x.list" }));
    await expect(readScaiEnvelopeFromStdin()).rejects.toThrow(/data/);
  });

  it("tolerates an envelope with `data: null`", async () => {
    replaceStdin(JSON.stringify({ command: "audit.x.list", data: null }));
    const envelope = await readScaiEnvelopeFromStdin();
    expect(envelope.data).toBeNull();
  });
});
