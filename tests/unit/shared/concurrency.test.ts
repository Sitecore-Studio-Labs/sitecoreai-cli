import { describe, expect, it } from "vitest";
import {
  mapWithConcurrency,
  resolveDefaultConcurrency,
  DEFAULT_CONCURRENCY,
} from "../../../src/shared/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in results", async () => {
    const inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // Reverse the wall-clock completion order vs input order to prove
    // ordering is by input index, not completion.
    const result = await mapWithConcurrency(
      inputs,
      async (n) => {
        await new Promise((r) => setTimeout(r, (10 - n) * 2));
        return n * 2;
      },
      { concurrency: 4 }
    );
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it("returns empty array for empty input", async () => {
    const result = await mapWithConcurrency<number, number>([], async (n) => n);
    expect(result).toEqual([]);
  });

  it("respects concurrency limit (never more than N in-flight)", async () => {
    let active = 0;
    let peak = 0;
    const inputs = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(
      inputs,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return null;
      },
      { concurrency: 3 }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates the first error and stops scheduling new work", async () => {
    let started = 0;
    await expect(
      mapWithConcurrency(
        [1, 2, 3, 4, 5, 6, 7, 8],
        async (n) => {
          started++;
          if (n === 2) throw new Error("boom");
          await new Promise((r) => setTimeout(r, 5));
          return n;
        },
        { concurrency: 2 }
      )
    ).rejects.toThrow("boom");
    // In-flight tasks at the time of failure get to finish; we should
    // not have started all 8 since cancellation happens after a peer fails.
    expect(started).toBeLessThan(8);
  });

  it("collapses to Promise.all when concurrency >= input length", async () => {
    const result = await mapWithConcurrency([1, 2, 3], async (n) => n * 10, { concurrency: 100 });
    expect(result).toEqual([10, 20, 30]);
  });

  it("clamps concurrency to >= 1", async () => {
    const result = await mapWithConcurrency([1, 2, 3], async (n) => n, { concurrency: 0 });
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("resolveDefaultConcurrency", () => {
  it("returns the default when env var unset", () => {
    const previous = process.env.SITECOREAI_HTTP_CONCURRENCY;
    delete process.env.SITECOREAI_HTTP_CONCURRENCY;
    try {
      expect(resolveDefaultConcurrency()).toBe(DEFAULT_CONCURRENCY);
    } finally {
      if (previous !== undefined) process.env.SITECOREAI_HTTP_CONCURRENCY = previous;
    }
  });

  it("honors SITECOREAI_HTTP_CONCURRENCY when set to a positive integer", () => {
    const previous = process.env.SITECOREAI_HTTP_CONCURRENCY;
    process.env.SITECOREAI_HTTP_CONCURRENCY = "16";
    try {
      expect(resolveDefaultConcurrency()).toBe(16);
    } finally {
      if (previous === undefined) delete process.env.SITECOREAI_HTTP_CONCURRENCY;
      else process.env.SITECOREAI_HTTP_CONCURRENCY = previous;
    }
  });

  it("falls back to default on garbage or non-positive values", () => {
    const previous = process.env.SITECOREAI_HTTP_CONCURRENCY;
    try {
      process.env.SITECOREAI_HTTP_CONCURRENCY = "not-a-number";
      expect(resolveDefaultConcurrency()).toBe(DEFAULT_CONCURRENCY);
      process.env.SITECOREAI_HTTP_CONCURRENCY = "0";
      expect(resolveDefaultConcurrency()).toBe(DEFAULT_CONCURRENCY);
      process.env.SITECOREAI_HTTP_CONCURRENCY = "-3";
      expect(resolveDefaultConcurrency()).toBe(DEFAULT_CONCURRENCY);
    } finally {
      if (previous === undefined) delete process.env.SITECOREAI_HTTP_CONCURRENCY;
      else process.env.SITECOREAI_HTTP_CONCURRENCY = previous;
    }
  });
});
