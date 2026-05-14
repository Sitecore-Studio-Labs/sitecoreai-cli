import { describe, expect, it } from "vitest";
import { normalizePublishJob } from "../../../src/publishing/sitecore-api/normalize";

describe("normalizePublishJob", () => {
  it("maps the canonical GraphQL fields through", () => {
    const job = normalizePublishJob({
      id: "abc-123",
      processedCount: 42,
      stateCode: 2,
      stateName: "Running",
    });
    expect(job).toEqual({
      id: "abc-123",
      state: "running",
      processedCount: 42,
      stateCode: 2,
    });
  });

  it("normalizes Completed / Done / Finished to completed", () => {
    for (const name of ["Completed", "DONE", "finished"]) {
      expect(normalizePublishJob({ id: "j", stateName: name }).state).toBe("completed");
    }
  });

  it("normalizes 'In Progress' / 'in-progress' to running", () => {
    expect(normalizePublishJob({ id: "j", stateName: "In Progress" }).state).toBe("running");
    expect(normalizePublishJob({ id: "j", stateName: "in-progress" }).state).toBe("running");
  });

  it("normalizes US 'canceled' to UK 'cancelled'", () => {
    expect(normalizePublishJob({ id: "j", stateName: "Canceled" }).state).toBe("cancelled");
    expect(normalizePublishJob({ id: "j", stateName: "cancelled" }).state).toBe("cancelled");
  });

  it("falls back to queued on unrecognized stateName", () => {
    expect(normalizePublishJob({ id: "j", stateName: "mystery" }).state).toBe("queued");
    expect(normalizePublishJob({ id: "j" }).state).toBe("queued");
  });

  it("leaves processedCount and stateCode undefined when absent", () => {
    const job = normalizePublishJob({ id: "j", stateName: "Queued" });
    expect(job.processedCount).toBeUndefined();
    expect(job.stateCode).toBeUndefined();
  });

  it("ignores non-numeric processedCount / stateCode", () => {
    const job = normalizePublishJob({
      id: "j",
      stateName: "Running",
      processedCount: "12" as unknown as number,
      stateCode: "2" as unknown as number,
    });
    expect(job.processedCount).toBeUndefined();
    expect(job.stateCode).toBeUndefined();
  });
});
