import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHygieneKnobs } from "../../../src/hygiene/tasks/shared";

beforeEach(() => {
  delete process.env.SITECOREAI_HYGIENE_CONCURRENCY;
  delete process.env.SITECOREAI_HYGIENE_BATCH_SIZE;
  delete process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM;
});

afterEach(() => {
  delete process.env.SITECOREAI_HYGIENE_CONCURRENCY;
  delete process.env.SITECOREAI_HYGIENE_BATCH_SIZE;
  delete process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM;
});

describe("resolveHygieneKnobs", () => {
  it("returns defaults when no overrides are provided", () => {
    expect(resolveHygieneKnobs({})).toEqual({
      concurrency: 8,
      batchSize: 50,
      pageParallelism: 4,
    });
  });

  it("explicit option overrides env + default", () => {
    process.env.SITECOREAI_HYGIENE_CONCURRENCY = "2";
    expect(resolveHygieneKnobs({ concurrency: 16, batchSize: 100, pageParallelism: 8 })).toEqual({
      concurrency: 16,
      batchSize: 100,
      pageParallelism: 8,
    });
  });

  it("env vars override defaults when no explicit options are given", () => {
    process.env.SITECOREAI_HYGIENE_CONCURRENCY = "12";
    process.env.SITECOREAI_HYGIENE_BATCH_SIZE = "75";
    process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM = "6";
    expect(resolveHygieneKnobs({})).toEqual({
      concurrency: 12,
      batchSize: 75,
      pageParallelism: 6,
    });
  });

  it("rejects non-positive env values by falling back to default", () => {
    process.env.SITECOREAI_HYGIENE_CONCURRENCY = "0";
    process.env.SITECOREAI_HYGIENE_BATCH_SIZE = "-5";
    process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM = "notanumber";
    expect(resolveHygieneKnobs({})).toEqual({
      concurrency: 8,
      batchSize: 50,
      pageParallelism: 4,
    });
  });
});
