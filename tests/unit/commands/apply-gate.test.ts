/**
 * `withApplyGate` is the CLI-layer wrapper that enforces the
 * agent-first rule: destructive scai commands dry-run by default and
 * only mutate when `--apply` is set. These tests lock the gating
 * behavior so a regression can't quietly let mutations through.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { withApplyGate } from "../../../src/commands/shared";

describe("withApplyGate", () => {
  const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  afterEach(() => {
    stderrWrite.mockClear();
  });

  it("coerces whatIf=true when neither apply nor whatIf is set", async () => {
    const runner = vi.fn(async () => undefined);
    const gated = withApplyGate(runner);
    await gated({ foo: "bar" } as unknown as { apply?: boolean; whatIf?: boolean });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ foo: "bar", whatIf: true }));
  });

  it("emits a stderr hint when the gate engages", async () => {
    const runner = vi.fn(async () => undefined);
    const gated = withApplyGate(runner);
    await gated({} as { apply?: boolean; whatIf?: boolean });
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0][0]).toMatch(/Dry run.*--apply/);
  });

  it("passes through unchanged when --apply is set", async () => {
    const runner = vi.fn(async () => undefined);
    const gated = withApplyGate(runner);
    const options = { apply: true, foo: "bar" };
    await gated(options as { apply?: boolean; whatIf?: boolean });
    expect(runner).toHaveBeenCalledWith({ apply: true, foo: "bar" });
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("passes through unchanged when --what-if is explicitly set", async () => {
    const runner = vi.fn(async () => undefined);
    const gated = withApplyGate(runner);
    await gated({ whatIf: true } as { apply?: boolean; whatIf?: boolean });
    expect(runner).toHaveBeenCalledWith({ whatIf: true });
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("does not mutate the caller's options object on coercion", async () => {
    const runner = vi.fn(async () => undefined);
    const gated = withApplyGate(runner);
    const original = { foo: 1 } as { foo: number; apply?: boolean; whatIf?: boolean };
    await gated(original);
    expect(original).toEqual({ foo: 1 });
    expect("whatIf" in original).toBe(false);
  });

  it("awaits the wrapped runner", async () => {
    let resolved = false;
    const runner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    });
    const gated = withApplyGate(runner);
    await gated({ apply: true } as { apply?: boolean; whatIf?: boolean });
    expect(resolved).toBe(true);
  });
});
