import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { addAuditBaseOptions } from "../../../../src/commands/audit/shared";

/**
 * `addAuditBaseOptions` decorates a command with the shared
 * `scai hygiene audit *` flag set. The tests assert the full option
 * surface, the numeric coercion on the perf knobs, the boolean shape
 * of `--cache` / `--include-system` / `--baseline`, and the
 * comma-aware accumulator on `--exclude`.
 */

/** All `--long` names declared on a command. */
const longs = (command: Command): Set<string> =>
  new Set(command.options.map((opt) => opt.long).filter((v): v is string => Boolean(v)));

/** Parse a fresh decorated command and return the resolved option bag. */
const parse = (args: string[]): Record<string, unknown> => {
  const command = addAuditBaseOptions(new Command("audit-test"));
  command.exitOverride();
  command.action(() => undefined);
  command.parse(["node", "scai", ...args]);
  return command.opts();
};

describe("addAuditBaseOptions — option surface", () => {
  it("returns the same command instance it was given (chainable)", () => {
    const command = new Command("x");
    expect(addAuditBaseOptions(command)).toBe(command);
  });

  it("declares every audit base + perf-knob option", () => {
    const opts = longs(addAuditBaseOptions(new Command("x")));
    for (const long of [
      "--environment-name",
      "--config",
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
      "--index",
      "--include-system",
      "--limit",
      "--concurrency",
      "--batch-size",
      "--page-parallelism",
      "--cache",
      "--exclude",
      "--since",
      "--owner",
      "--baseline",
      "--output",
      "--format",
    ]) {
      expect(opts.has(long), long).toBe(true);
    }
  });
});

describe("addAuditBaseOptions — numeric coercion", () => {
  it("parses --limit / --concurrency / --batch-size / --page-parallelism as integers", () => {
    const opts = parse([
      "--limit",
      "100",
      "--concurrency",
      "16",
      "--batch-size",
      "75",
      "--page-parallelism",
      "8",
    ]);
    expect(opts.limit).toBe(100);
    expect(opts.concurrency).toBe(16);
    expect(opts.batchSize).toBe(75);
    expect(opts.pageParallelism).toBe(8);
  });

  it("leaves perf knobs undefined when their flags are omitted", () => {
    const opts = parse([]);
    expect(opts.limit).toBeUndefined();
    expect(opts.concurrency).toBeUndefined();
    expect(opts.batchSize).toBeUndefined();
    expect(opts.pageParallelism).toBeUndefined();
  });
});

describe("addAuditBaseOptions — boolean flags", () => {
  it("sets --cache / --include-system / --baseline to true when present", () => {
    const opts = parse(["--cache", "--include-system", "--baseline"]);
    expect(opts.cache).toBe(true);
    expect(opts.includeSystem).toBe(true);
    expect(opts.baseline).toBe(true);
  });

  it("leaves boolean flags undefined when absent", () => {
    const opts = parse([]);
    expect(opts.cache).toBeUndefined();
    expect(opts.includeSystem).toBeUndefined();
    expect(opts.baseline).toBeUndefined();
  });
});

describe("addAuditBaseOptions — --exclude accumulator", () => {
  it("defaults --exclude to an empty array", () => {
    expect(parse([]).exclude).toEqual([]);
  });

  it("splits a single comma-separated --exclude value, trimming whitespace", () => {
    const opts = parse(["--exclude", "/sitecore/system, /sitecore/media library "]);
    expect(opts.exclude).toEqual(["/sitecore/system", "/sitecore/media library"]);
  });

  it("accumulates repeated --exclude flags into one array", () => {
    const opts = parse(["--exclude", "/a", "--exclude", "/b,/c"]);
    expect(opts.exclude).toEqual(["/a", "/b", "/c"]);
  });

  it("drops empty segments produced by trailing or doubled commas", () => {
    const opts = parse(["--exclude", "/a,,  ,/b,"]);
    expect(opts.exclude).toEqual(["/a", "/b"]);
  });
});

describe("addAuditBaseOptions — string-valued flags", () => {
  it("threads --index / --since / --owner / --output / --format through verbatim", () => {
    const opts = parse([
      "--index",
      "custom_index",
      "--since",
      "2026-01-01",
      "--owner",
      "sitecore\\admin",
      "--output",
      "report.csv",
      "--format",
      "csv",
    ]);
    expect(opts.index).toBe("custom_index");
    expect(opts.since).toBe("2026-01-01");
    expect(opts.owner).toBe("sitecore\\admin");
    expect(opts.output).toBe("report.csv");
    expect(opts.format).toBe("csv");
  });
});
