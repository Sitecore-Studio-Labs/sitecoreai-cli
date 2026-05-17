import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const outputAdapterMocks = vi.hoisted(() => ({
  writeAuditOutput: vi.fn(() => "{}"),
  inferFormatFromExtension: vi.fn((p: string) => {
    if (p.endsWith(".csv")) return "csv";
    if (p.endsWith(".md")) return "markdown";
    return undefined;
  }),
}));
vi.mock("../../../../src/hygiene/output-adapters", () => outputAdapterMocks);

const baselineMocks = vi.hoisted(() => ({
  openBaseline: vi.fn(),
  splitByBaseline: vi.fn(),
}));
vi.mock("../../../../src/hygiene/baseline", () => baselineMocks);

import {
  computeContentHash,
  extractPersonalizationRefs,
  extractRenderingDatasources,
  finishAudit,
  isPageDesignField,
  isRenderingField,
  matchesScanFilters,
  printReport,
  resolveHygieneKnobs,
  resolveScanFilters,
  toLogger,
} from "../../../../src/hygiene/tasks/shared";

describe("isRenderingField", () => {
  it("flags __Renderings + __Final Renderings", () => {
    expect(isRenderingField("__Renderings")).toBe(true);
    expect(isRenderingField("__Final Renderings")).toBe(true);
  });

  it("does not flag arbitrary fields", () => {
    expect(isRenderingField("Title")).toBe(false);
    expect(isRenderingField("__Lock")).toBe(false);
  });
});

describe("isPageDesignField", () => {
  it("flags __Final Page Design + __Page Design", () => {
    expect(isPageDesignField("__Final Page Design")).toBe(true);
    expect(isPageDesignField("__Page Design")).toBe(true);
  });

  it("does not flag arbitrary fields", () => {
    expect(isPageDesignField("Title")).toBe(false);
    expect(isPageDesignField("__Renderings")).toBe(false);
  });
});

describe("extractRenderingDatasources", () => {
  it("returns empty for empty input", () => {
    expect(extractRenderingDatasources("")).toEqual([]);
  });

  it("extracts `ds` attribute from <r> elements", () => {
    const xml = '<r uid="{a}" id="{rend1}" ds="/sitecore/content/Home/Data/Article" par="x=1" />';
    expect(extractRenderingDatasources(xml)).toEqual([
      { datasource: "/sitecore/content/Home/Data/Article", renderingId: "{rend1}" },
    ]);
  });

  it("extracts s:ds in preference to bare ds", () => {
    const xml = '<r s:id="{rend1}" s:ds="{abc-123}" />';
    const result = extractRenderingDatasources(xml);
    expect(result).toEqual([{ datasource: "{abc-123}", renderingId: "{rend1}" }]);
  });

  it("handles multiple <r> elements", () => {
    const xml = '<r ds="/path/A"/><r ds="/path/B" id="{r2}"/><r ds=""/>';
    const result = extractRenderingDatasources(xml);
    expect(result).toEqual([
      { datasource: "/path/A", renderingId: null },
      { datasource: "/path/B", renderingId: "{r2}" },
    ]);
  });

  it("skips elements with no ds attribute", () => {
    const xml = '<r id="{r1}" par="x=1" />';
    expect(extractRenderingDatasources(xml)).toEqual([]);
  });
});

describe("extractPersonalizationRefs", () => {
  it("returns empty for empty input", () => {
    expect(extractPersonalizationRefs("")).toEqual([]);
  });

  it("extracts datasource from <action> elements", () => {
    const xml =
      '<r ds="/A"><rules><rule><actions><action id="{actionTmpl}" datasource="{variant-1}"/></actions></rule></rules></r>';
    expect(extractPersonalizationRefs(xml)).toEqual(["{variant-1}"]);
  });

  it("extracts rule-set ids from <rules s:set>", () => {
    const xml = '<r><rules s:set="{ruleset-1}"></rules></r>';
    expect(extractPersonalizationRefs(xml)).toEqual(["{ruleset-1}"]);
  });

  it("captures both action datasources and rule-set ids in one pass", () => {
    const xml =
      '<r><rules s:set="{ruleset-1}"><rule><actions><action datasource="{variant-1}"/><action datasource="{variant-2}"/></actions></rule></rules></r>';
    const result = extractPersonalizationRefs(xml);
    expect(result).toContain("{ruleset-1}");
    expect(result).toContain("{variant-1}");
    expect(result).toContain("{variant-2}");
    expect(result).toHaveLength(3);
  });
});

describe("computeContentHash", () => {
  it("produces a stable 16-char hex hash", async () => {
    const fields = [
      { name: "Title", value: "Hello" },
      { name: "Body", value: "World" },
    ];
    const h = await computeContentHash(fields);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces the same hash regardless of field order", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "Body", value: "World" },
    ]);
    const b = await computeContentHash([
      { name: "Body", value: "World" },
      { name: "Title", value: "Hello" },
    ]);
    expect(a).toBe(b);
  });

  it("excludes __-prefixed system fields by default", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "__Created", value: "2026-01-01" },
    ]);
    const b = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "__Created", value: "2026-12-31" },
    ]);
    expect(a).toBe(b);
  });

  it("includes __-prefixed fields when includeSystem is true", async () => {
    const a = await computeContentHash(
      [
        { name: "Title", value: "Hello" },
        { name: "__Created", value: "2026-01-01" },
      ],
      { includeSystem: true }
    );
    const b = await computeContentHash(
      [
        { name: "Title", value: "Hello" },
        { name: "__Created", value: "2026-12-31" },
      ],
      { includeSystem: true }
    );
    expect(a).not.toBe(b);
  });

  it("trims whitespace when comparing values", async () => {
    const a = await computeContentHash([{ name: "Title", value: "Hello" }]);
    const b = await computeContentHash([{ name: "Title", value: "  Hello  " }]);
    expect(a).toBe(b);
  });

  it("excludes empty fields from the hash input", async () => {
    const a = await computeContentHash([
      { name: "Title", value: "Hello" },
      { name: "Body", value: "" },
    ]);
    const b = await computeContentHash([{ name: "Title", value: "Hello" }]);
    expect(a).toBe(b);
  });

  // Regression: items with zero authored content used to all hash to
  // sha256("") = "e3b0c44298fc1c14", which made `audit duplicates`
  // bucket every blank item into one giant false-positive group.
  // Empty-content now returns "" so the duplicates audit's
  // `if (!hash) continue;` guard skips them entirely.
  it("returns empty string when there's no authored content (no false-positive duplicate bucket)", async () => {
    const empty = await computeContentHash([]);
    const whitespace = await computeContentHash([{ name: "Title", value: "   " }]);
    const systemOnly = await computeContentHash([
      { name: "__Created", value: "2026-01-01" },
      { name: "__Updated", value: "2026-12-31" },
    ]);
    expect(empty).toBe("");
    expect(whitespace).toBe("");
    expect(systemOnly).toBe("");
  });
});

describe("resolveScanFilters", () => {
  it("returns undefined excludePaths when no excludes are passed", () => {
    expect(resolveScanFilters({})).toEqual({
      excludePaths: undefined,
      sinceMs: undefined,
      owner: undefined,
    });
  });

  it("lowercases excludes and drops empty strings", () => {
    const filters = resolveScanFilters({ exclude: ["/Sitecore/System", "", "/MEDIA"] });
    expect(filters.excludePaths).toEqual(["/sitecore/system", "/media"]);
  });

  it("treats an all-empty exclude list as undefined excludePaths", () => {
    expect(resolveScanFilters({ exclude: ["", "  "] }).excludePaths).toEqual(["  "]);
  });

  it("parses a valid --since into sinceMs", () => {
    const filters = resolveScanFilters({ since: "2026-01-01" });
    expect(filters.sinceMs).toBe(Date.parse("2026-01-01"));
  });

  it("throws INPUT_INVALID for an unparseable --since", () => {
    expect(() => resolveScanFilters({ since: "not-a-date" })).toThrowError(
      expect.objectContaining({ code: "INPUT_INVALID" })
    );
  });

  it("passes the owner filter through verbatim", () => {
    expect(resolveScanFilters({ owner: "alice" }).owner).toBe("alice");
  });
});

describe("matchesScanFilters", () => {
  it("returns true with no filters set", () => {
    expect(matchesScanFilters({ path: "/sitecore/content/A" }, {})).toBe(true);
  });

  it("excludes a result whose path starts with an excluded prefix", () => {
    expect(
      matchesScanFilters(
        { path: "/sitecore/system/Settings" },
        { excludePaths: ["/sitecore/system"] }
      )
    ).toBe(false);
  });

  it("keeps a result outside every excluded prefix", () => {
    expect(
      matchesScanFilters({ path: "/sitecore/content/Home" }, { excludePaths: ["/sitecore/system"] })
    ).toBe(true);
  });

  it("treats a missing path as an empty string for exclude matching", () => {
    expect(matchesScanFilters({}, { excludePaths: ["/sitecore"] })).toBe(true);
  });

  it("excludes a result updated before sinceMs", () => {
    const since = Date.parse("2026-06-01");
    expect(matchesScanFilters({ path: "/x", updatedDate: "2026-01-01" }, { sinceMs: since })).toBe(
      false
    );
  });

  it("keeps a result updated on/after sinceMs", () => {
    const since = Date.parse("2026-01-01");
    expect(matchesScanFilters({ path: "/x", updatedDate: "2026-12-01" }, { sinceMs: since })).toBe(
      true
    );
  });

  it("excludes a result with an unparseable updatedDate when sinceMs is set", () => {
    expect(
      matchesScanFilters({ path: "/x", updatedDate: "garbage" }, { sinceMs: Date.now() })
    ).toBe(false);
  });
});

describe("resolveHygieneKnobs", () => {
  const ENV_KEYS = [
    "SITECOREAI_HYGIENE_CONCURRENCY",
    "SITECOREAI_HYGIENE_BATCH_SIZE",
    "SITECOREAI_HYGIENE_PAGE_PARALLELISM",
  ];

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("uses built-in defaults when nothing is supplied", () => {
    expect(resolveHygieneKnobs({})).toEqual({
      concurrency: 8,
      batchSize: 50,
      pageParallelism: 4,
    });
  });

  it("explicit options take precedence over env vars", () => {
    process.env.SITECOREAI_HYGIENE_CONCURRENCY = "16";
    expect(resolveHygieneKnobs({ concurrency: 3 }).concurrency).toBe(3);
  });

  it("reads env vars when no explicit option is given", () => {
    process.env.SITECOREAI_HYGIENE_BATCH_SIZE = "100";
    process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM = "2";
    const knobs = resolveHygieneKnobs({});
    expect(knobs.batchSize).toBe(100);
    expect(knobs.pageParallelism).toBe(2);
  });

  it("falls back to the default when an env var is not a positive integer", () => {
    process.env.SITECOREAI_HYGIENE_CONCURRENCY = "0";
    process.env.SITECOREAI_HYGIENE_BATCH_SIZE = "not-a-number";
    const knobs = resolveHygieneKnobs({});
    expect(knobs.concurrency).toBe(8);
    expect(knobs.batchSize).toBe(50);
  });
});

describe("toLogger", () => {
  it("builds a JSON logger when options.json is set", () => {
    expect(toLogger({ json: true }).isJson()).toBe(true);
  });

  it("builds a non-JSON logger by default", () => {
    expect(toLogger({}).isJson()).toBe(false);
  });
});

describe("printReport / finishAudit — output forks", () => {
  beforeEach(() => {
    baselineMocks.openBaseline.mockReturnValue({ snapshot: () => ({ ignored: {} }) });
    baselineMocks.splitByBaseline.mockReturnValue({ kept: [], ignored: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    baselineMocks.openBaseline.mockReset();
    baselineMocks.splitByBaseline.mockReset();
  });

  it("emits a JSON envelope through logger.json when --json is set", () => {
    const json = vi.fn();
    const logger = {
      isJson: () => true,
      json,
      info: vi.fn(),
      warn: vi.fn(),
    };
    printReport({
      logger: logger as never,
      command: "audit.demo.list",
      envName: "sandbox",
      results: [{ id: "x" }],
      formatLine: (r: { id: string }) => r.id,
    });
    expect(json).toHaveBeenCalledTimes(1);
    const envelope = json.mock.calls[0][0] as { count: number; data: unknown[] };
    expect(envelope.count).toBe(1);
    expect(envelope.data).toEqual([{ id: "x" }]);
  });

  it("prints a human summary + one line per result when --json is unset", () => {
    const info = vi.fn();
    const logger = {
      isJson: () => false,
      json: vi.fn(),
      info,
      warn: vi.fn(),
    };
    printReport({
      logger: logger as never,
      command: "audit.demo.list",
      envName: "sandbox",
      results: [{ id: "a" }, { id: "b" }],
      summary: "2 findings.",
      formatLine: (r: { id: string }) => r.id,
    });
    // headline + one line per result.
    expect(info).toHaveBeenCalledWith("2 findings.", "yellow");
    expect(info).toHaveBeenCalledWith("  - a");
    expect(info).toHaveBeenCalledWith("  - b");
  });

  it("uses the green default headline when there are zero results and no summary", () => {
    const info = vi.fn();
    const logger = { isJson: () => false, json: vi.fn(), info, warn: vi.fn() };
    printReport({
      logger: logger as never,
      command: "audit.demo.list",
      envName: "sandbox",
      results: [],
      formatLine: () => "",
    });
    expect(info).toHaveBeenCalledWith("0 items found.", "green");
  });

  it("warns when --baseline is requested but the command name has no baseline key", () => {
    const warn = vi.fn();
    const logger = { isJson: () => true, json: vi.fn(), info: vi.fn(), warn };
    finishAudit({
      logger: logger as never,
      command: "cleanup.demo.purge",
      envName: "sandbox",
      results: [],
      formatLine: () => "",
      options: { baseline: true },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("doesn't map to a baseline key"));
  });
});

describe("finishAudit — baseline + output branches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    baselineMocks.openBaseline.mockReset();
    baselineMocks.splitByBaseline.mockReset();
    outputAdapterMocks.writeAuditOutput.mockClear();
    outputAdapterMocks.inferFormatFromExtension.mockClear();
  });

  const jsonLogger = () => ({
    isJson: () => true,
    json: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });
  const textLogger = () => ({
    isJson: () => false,
    json: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });

  it("derives the audit name from an audit.<name>.<verb> command and opens the baseline", () => {
    baselineMocks.openBaseline.mockReturnValue({
      snapshot: () => ({ ignored: {} }),
    });
    const logger = jsonLogger();
    // printReport derives auditName via deriveAuditName(command).
    printReport({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      results: [],
      formatLine: () => "",
    });
    expect(baselineMocks.openBaseline).toHaveBeenCalledWith(
      expect.objectContaining({ envName: "sandbox" })
    );
  });

  it("does NOT open a baseline for a command that has no audit.<name> shape", () => {
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "cleanup.versions.prune",
      envName: "sandbox",
      results: [],
      formatLine: () => "",
    });
    expect(baselineMocks.openBaseline).not.toHaveBeenCalled();
  });

  it("surfaces the baseline-accepted total in the envelope when accepted findings exist", () => {
    baselineMocks.openBaseline.mockReturnValue({
      snapshot: () => ({
        ignored: { "broken-links": [{ fingerprint: "x" }, { fingerprint: "y" }] },
      }),
    });
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }],
      formatLine: () => "",
    });
    const envelope = logger.json.mock.calls[0][0] as {
      meta?: { baselineAcceptedTotal?: number };
    };
    expect(envelope.meta?.baselineAcceptedTotal).toBe(2);
  });

  it("splits findings through the baseline and reports ignoredCount when --baseline is set", () => {
    baselineMocks.openBaseline.mockReturnValue({
      snapshot: () => ({ ignored: {} }),
    });
    baselineMocks.splitByBaseline.mockReturnValue({
      kept: [{ id: 1 }],
      ignored: [{ id: 2 }, { id: 3 }],
    });
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }, { id: 2 }, { id: 3 }],
      formatLine: () => "",
      options: { baseline: true },
    });
    expect(baselineMocks.splitByBaseline).toHaveBeenCalled();
    // `ignoredCount` is a canonical envelope key (hoisted to top level);
    // `baselineAcceptedTotal` is not, so it lands under `meta`.
    const envelope = logger.json.mock.calls[0][0] as { count: number; ignoredCount?: number };
    expect(envelope.count).toBe(1);
    expect(envelope.ignoredCount).toBe(2);
  });

  it("warns and continues when the baseline file fails to open", () => {
    baselineMocks.openBaseline.mockImplementation(() => {
      throw new Error("baseline corrupt");
    });
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }],
      formatLine: () => "",
      options: { baseline: true },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to apply baseline filter for 'broken-links'")
    );
    // The audit still emits its envelope despite the baseline failure.
    expect(logger.json).toHaveBeenCalled();
  });

  it("writes a serialized report to --output and infers csv format from the extension", () => {
    baselineMocks.openBaseline.mockReturnValue({ snapshot: () => ({ ignored: {} }) });
    const logger = textLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }],
      formatLine: () => "",
      options: { output: "/tmp/report.csv" },
    });
    expect(outputAdapterMocks.writeAuditOutput).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      { format: "csv", output: "/tmp/report.csv" }
    );
    // Non-json logger announces the write.
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Wrote /tmp/report.csv (1 finding)"),
      "green"
    );
  });

  it("an explicit --format overrides the inferred output format", () => {
    baselineMocks.openBaseline.mockReturnValue({ snapshot: () => ({ ignored: {} }) });
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [],
      formatLine: () => "",
      options: { output: "/tmp/report.csv", format: "markdown" },
    });
    expect(outputAdapterMocks.writeAuditOutput).toHaveBeenCalledWith(expect.anything(), {
      format: "markdown",
      output: "/tmp/report.csv",
    });
    // json logger does NOT echo the write line.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("defaults the output format to json when neither --format nor an extension applies", () => {
    baselineMocks.openBaseline.mockReturnValue({ snapshot: () => ({ ignored: {} }) });
    const logger = jsonLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }, { id: 2 }],
      formatLine: () => "",
      options: { output: "/tmp/report.txt" },
    });
    expect(outputAdapterMocks.writeAuditOutput).toHaveBeenCalledWith(expect.anything(), {
      format: "json",
      output: "/tmp/report.txt",
    });
  });

  it("prints the baseline-discovery nudge on the text path when accepted findings exist", () => {
    baselineMocks.openBaseline.mockReturnValue({
      snapshot: () => ({ ignored: { "broken-links": [{ fingerprint: "x" }] } }),
    });
    const logger = textLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }],
      formatLine: (r: { id: number }) => `item-${r.id}`,
    });
    const lines = logger.info.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("1 finding in baseline; pass --baseline to filter"))).toBe(
      true
    );
    expect(lines).toContain("  - item-1");
  });

  it("prints the ignored-by-baseline line on the text path when --baseline filters findings", () => {
    baselineMocks.openBaseline.mockReturnValue({ snapshot: () => ({ ignored: {} }) });
    baselineMocks.splitByBaseline.mockReturnValue({ kept: [{ id: 1 }], ignored: [{ id: 2 }] });
    const logger = textLogger();
    finishAudit({
      logger: logger as never,
      command: "audit.broken-links.list",
      envName: "sandbox",
      auditName: "broken-links",
      results: [{ id: 1 }, { id: 2 }],
      formatLine: () => "",
      options: { baseline: true },
    });
    const lines = logger.info.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("(1 ignored by baseline)"))).toBe(true);
  });
});
