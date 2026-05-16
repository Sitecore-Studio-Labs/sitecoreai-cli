import { describe, expect, it } from "vitest";
import {
  extractFailureDiagnostics,
  formatFailureDiagnostics,
} from "../../../src/publishing/job-diagnostics";
import type { PublishJob } from "../../../src/publishing/api/types";

const baseJob = (overrides: Partial<PublishJob["raw"]>): PublishJob => ({
  id: "job_test",
  state: "failed",
  canCancel: false,
  raw: {
    id: "job_test",
    name: null,
    description: null,
    source: null,
    options: {},
    statistics: null,
    system: {
      tenantId: "tenant_test",
      status: "Failed",
      createdBy: {},
    },
    permissions: { canViewDetails: true, canCancel: false },
    ...overrides,
  },
});

describe("extractFailureDiagnostics", () => {
  it("returns all-undefined when the raw payload carries no failure info", () => {
    const diag = extractFailureDiagnostics(baseJob({}));
    expect(diag.reason).toBeUndefined();
    expect(diag.failedItemCount).toBeUndefined();
    expect(diag.itemFailures).toBeUndefined();
  });

  it("extracts a top-level failureReason from system", () => {
    const diag = extractFailureDiagnostics(
      baseJob({
        system: {
          tenantId: "tenant_test",
          status: "Failed",
          createdBy: {},
          failureReason: "Item lookup failed",
        } as unknown as PublishJob["raw"]["system"],
      })
    );
    expect(diag.reason).toBe("Item lookup failed");
  });

  it("counts failed items from statistics.itemsFailed", () => {
    const diag = extractFailureDiagnostics(
      baseJob({
        statistics: {
          itemsFailed: 3,
          lastReportTime: "2026-05-14T22:00:00Z",
        } as unknown as Record<string, unknown>,
      })
    );
    expect(diag.failedItemCount).toBe(3);
    expect(diag.lastReportTime).toBe("2026-05-14T22:00:00Z");
  });

  it("parses per-item errors from statistics.xmc.errors", () => {
    const diag = extractFailureDiagnostics(
      baseJob({
        statistics: {
          itemsFailed: 2,
          xmc: {
            errors: [
              { itemId: "abc-123", locale: "en", message: "Missing field" },
              { itemId: "def-456", message: "Conflict" },
            ],
          },
        } as unknown as Record<string, unknown>,
      })
    );
    expect(diag.itemFailures).toEqual([
      { itemId: "abc-123", locale: "en", message: "Missing field" },
      { itemId: "def-456", message: "Conflict" },
    ]);
  });

  it("ignores malformed entries in the errors array", () => {
    const diag = extractFailureDiagnostics(
      baseJob({
        statistics: {
          xmc: {
            errors: [
              { itemId: "abc", message: "real failure" },
              "string-not-record",
              { itemId: "no-message-field" },
              null,
            ],
          },
        } as unknown as Record<string, unknown>,
      })
    );
    expect(diag.itemFailures).toEqual([{ itemId: "abc", message: "real failure" }]);
  });
});

describe("formatFailureDiagnostics", () => {
  it("returns [] when nothing useful can be said", () => {
    expect(formatFailureDiagnostics({})).toEqual([]);
  });

  it("renders reason + counts + per-item failures + last report", () => {
    const lines = formatFailureDiagnostics({
      reason: "Bad request",
      failedItemCount: 2,
      itemFailures: [
        { itemId: "abc", locale: "en", message: "Missing field" },
        { itemId: "def", message: "Conflict" },
      ],
      lastReportTime: "2026-05-14T22:00:00Z",
    });
    expect(lines).toEqual([
      "Reason: Bad request",
      "Failed items: 2",
      "  abc (en): Missing field",
      "  def: Conflict",
      "Last statistics update: 2026-05-14T22:00:00Z",
    ]);
  });

  it("truncates large failure lists to 10 + count", () => {
    const itemFailures = Array.from({ length: 15 }, (_, i) => ({
      itemId: `item-${i}`,
      message: "boom",
    }));
    const lines = formatFailureDiagnostics({ itemFailures });
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("  (and 5 more)");
  });
});
