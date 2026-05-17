import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runBrandReview` end-to-end branch coverage. The Brand Review API
 * helper (`generateBrandReview`) and the root-config reader are mocked
 * so this exercises only the runner's orchestration: credential
 * resolution, what-if, format selection (text/json/sarif), and the
 * --output / stdout fork. Pure helpers (computeExitCode etc.) are
 * covered in tests/unit/brand/review-task.test.ts.
 */

const apiMocks = vi.hoisted(() => ({
  generateBrandReview: vi.fn(),
}));

vi.mock("../../../../src/brand/review/generate", () => ({
  generateBrandReview: apiMocks.generateBrandReview,
}));

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { runBrandReview } from "../../../../src/brand/tasks/review";

const rootWithCredential = (orgId = "org_ABC") => ({
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: orgId, name: "sandbox" } },
  brand: { [orgId]: { clientId: "cid", audience: "aud", authority: "auth" } },
});

let tmpDir: string;

beforeEach(() => {
  apiMocks.generateBrandReview.mockReset();
  apiMocks.generateBrandReview.mockResolvedValue({ overallScore: 4, sectionResults: [] });
  configMocks.readRootConfiguration.mockReset();
  configMocks.readRootConfiguration.mockReturnValue(rootWithCredential());
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-review-run-"));
  fs.writeFileSync(path.join(tmpDir, "about.md"), "# About");
  fs.writeFileSync(path.join(tmpDir, "landing.md"), "# Landing");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const baseOptions = (overrides: Record<string, unknown> = {}): never =>
  ({
    config: tmpDir,
    quiet: true,
    kit: "kit-1",
    inputs: ["about.md"],
    ...overrides,
  }) as never;

describe("runBrandReview — credential + input guards", () => {
  it("throws AUTH_BRAND_REQUIRED when no Brand credential is configured for the org", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
      brand: {},
    });
    await expect(runBrandReview(baseOptions())).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });

  it("throws INPUT_INVALID when organizationId cannot be resolved", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { name: "sandbox" } },
      brand: {},
    });
    await expect(runBrandReview(baseOptions())).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when --kit is missing", async () => {
    await expect(runBrandReview(baseOptions({ kit: undefined }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when no input files matched", async () => {
    await expect(runBrandReview(baseOptions({ inputs: [], glob: [] }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when an explicit --threshold is out of the 1-5 range", async () => {
    await expect(runBrandReview(baseOptions({ threshold: 9 }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when the resolved file count exceeds --limit without --force", async () => {
    await expect(
      runBrandReview(baseOptions({ inputs: ["about.md", "landing.md"], limit: 1 }))
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("honors an explicit --org-id over the env profile when resolving the credential", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ENV", name: "sandbox" } },
      brand: { org_OVERRIDE: { clientId: "cid" } },
    });
    const result = await runBrandReview(baseOptions({ orgId: "org_OVERRIDE" }));
    expect(result.exitCode).toBe(0);
    expect(apiMocks.generateBrandReview).toHaveBeenCalledWith(
      expect.objectContaining({ client: expect.objectContaining({ orgId: "org_OVERRIDE" }) })
    );
  });
});

describe("runBrandReview — what-if", () => {
  it("returns exitCode 0 with empty outcomes and never calls the API in --what-if mode", async () => {
    const result = await runBrandReview(
      baseOptions({ inputs: ["about.md", "landing.md"], whatIf: true })
    );
    expect(result).toMatchObject({ outcomes: [], exitCode: 0 });
    expect(apiMocks.generateBrandReview).not.toHaveBeenCalled();
  });
});

describe("runBrandReview — text format", () => {
  it("buffers a text report and returns it on result.report", async () => {
    const result = await runBrandReview(baseOptions());
    expect(apiMocks.generateBrandReview).toHaveBeenCalledTimes(1);
    expect(result.report).toBeTruthy();
    expect(result.json).toBeUndefined();
    expect(result.sarif).toBeUndefined();
  });

  it("writes the text report to --output instead of stdout", async () => {
    const outFile = path.join(tmpDir, "report.txt");
    const writeSpy = vi.spyOn(process.stdout, "write");
    const result = await runBrandReview(baseOptions({ output: outFile }));
    expect(fs.existsSync(outFile)).toBe(true);
    expect(fs.readFileSync(outFile, "utf8")).toBe(result.report);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe("runBrandReview — json format", () => {
  it("writes serialized JSON to stdout and exposes result.json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await runBrandReview(baseOptions({ format: "json" }));
    expect(result.json).toBeDefined();
    expect(result.report).toBe(JSON.stringify(result.json, null, 2));
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify(result.json, null, 2) + "\n");
  });

  it("writes the JSON report to --output and does not touch stdout", async () => {
    const outFile = path.join(tmpDir, "report.json");
    const writeSpy = vi.spyOn(process.stdout, "write");
    const result = await runBrandReview(baseOptions({ format: "json", output: outFile }));
    expect(JSON.parse(fs.readFileSync(outFile, "utf8"))).toEqual(result.json);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe("runBrandReview — sarif format", () => {
  it("writes serialized SARIF to stdout and exposes result.sarif", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await runBrandReview(baseOptions({ format: "sarif" }));
    expect(result.sarif).toBeDefined();
    expect(result.json).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify(result.sarif, null, 2) + "\n");
  });
});

describe("runBrandReview — outcomes + exit code", () => {
  it("returns exitCode 1 when a score falls below --threshold", async () => {
    apiMocks.generateBrandReview.mockResolvedValue({ overallScore: 2, sectionResults: [] });
    const result = await runBrandReview(baseOptions({ threshold: 4 }));
    expect(result.exitCode).toBe(1);
  });

  it("returns exitCode 7 when an API call fails and no threshold violation", async () => {
    apiMocks.generateBrandReview.mockRejectedValue(new Error("500 boom"));
    const result = await runBrandReview(baseOptions({ threshold: 4 }));
    expect(result.exitCode).toBe(7);
    expect(result.outcomes[0]).toMatchObject({ kind: "error" });
  });

  it("captures a per-file error without losing peer results (no failFast)", async () => {
    apiMocks.generateBrandReview
      .mockResolvedValueOnce({ overallScore: 5, sectionResults: [] })
      .mockRejectedValueOnce(new Error("rate limit"));
    const result = await runBrandReview(baseOptions({ inputs: ["about.md", "landing.md"] }));
    expect(result.outcomes).toHaveLength(2);
    const kinds = result.outcomes.map((o) => o.kind).sort();
    expect(kinds).toEqual(["error", "ok"]);
  });

  it("threads parsed --section-id selectors into generateBrandReview", async () => {
    await runBrandReview(baseOptions({ sectionId: ["sec-1:field-a", "sec-1:field-b"] }));
    const call = apiMocks.generateBrandReview.mock.calls.at(-1)![0];
    expect(call.selector).toEqual({
      brandKitId: "kit-1",
      sections: [{ sectionId: "sec-1", fieldIds: ["field-a", "field-b"] }],
    });
  });
});
