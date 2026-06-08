import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  addAllowFileChangesOption,
  addAllowWriteOption,
  addApplyOption,
  addConfigOption,
  addDiffOptions,
  addEnvironmentOption,
  addExplainOptions,
  addForceOption,
  addIncludeExcludeOptions,
  addOrgScopeOptions,
  addPackageCreateOptions,
  addPackageInstallOptions,
  addPublishOptions,
  addSkipPullOption,
  addSkipValidationOption,
  addUseDebugSignaturesOption,
  addValidateOptions,
  addVerbosityOptions,
  addWhatIfOption,
  collectList,
  markUnstable,
  normalizeArgs,
  withApplyGate,
} from "../../../src/commands/shared";

/** Long names declared on a command, with undefineds filtered out. */
const longs = (command: Command): Set<string> =>
  new Set(command.options.map((o) => o.long).filter((v): v is string => Boolean(v)));

/** Render full help (including `addHelpText` after-blocks) to a string. */
const helpText = (command: Command): string => {
  let out = "";
  command.configureOutput({ writeOut: (s) => (out += s) });
  command.outputHelp();
  return out;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeArgs", () => {
  it("expands -fr to --force", () => {
    expect(normalizeArgs(["-fr", "--other"])).toEqual(["--force", "--other"]);
  });

  it("expands -e and --env to --environment-name", () => {
    expect(normalizeArgs(["-e", "demo"])).toEqual(["-e", "demo"]);
    expect(normalizeArgs(["--env", "demo"])).toEqual(["--environment-name", "demo"]);
  });

  it("expands --env-name to --environment-name", () => {
    expect(normalizeArgs(["--env-name", "prod"])).toEqual(["--environment-name", "prod"]);
  });

  it("expands -q to --quiet", () => {
    expect(normalizeArgs(["-q"])).toEqual(["--quiet"]);
  });

  it("expands --source-env / --target-env to --source / --destination", () => {
    expect(normalizeArgs(["--source-env", "a", "--target-env", "b"])).toEqual([
      "--source",
      "a",
      "--destination",
      "b",
    ]);
  });

  it("drops a leading `--` at position 2 (the `pnpm dev --` separator)", () => {
    expect(normalizeArgs(["node", "scai", "--", "ser", "diff", "--what-if"])).toEqual([
      "node",
      "scai",
      "ser",
      "diff",
      "--what-if",
    ]);
  });

  it("preserves a `--` that is not at position 2", () => {
    // The drop only fires when argv[2] is exactly `--`; here argv[2] is
    // `sync`, so the later `--` is left intact.
    expect(normalizeArgs(["node", "scai", "sync", "--", "passthrough"])).toEqual([
      "node",
      "scai",
      "sync",
      "--",
      "passthrough",
    ]);
  });

  it("leaves other args unchanged", () => {
    expect(normalizeArgs(["-f", "-r"])).toEqual(["-f", "-r"]);
  });
});

describe("collectList", () => {
  it("splits comma-separated values and appends", () => {
    expect(collectList("a,b", ["c"])).toEqual(["c", "a", "b"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(collectList(" a, ,b ", [])).toEqual(["a", "b"]);
  });

  it("defaults the accumulator to an empty array", () => {
    expect(collectList("x,y")).toEqual(["x", "y"]);
  });
});

describe("addConfigOption", () => {
  it("adds -c/--config with a help-labeled cwd default", () => {
    const command = addConfigOption(new Command("demo"));
    const option = command.options.find((o) => o.long === "--config");
    expect(option).toBeDefined();
    expect(option?.short).toBe("-c");
    expect(option?.defaultValue).toBe(process.cwd());
    expect(option?.defaultValueDescription).toBe("current directory");
  });

  it("returns the same command for chaining", () => {
    const command = new Command("demo");
    expect(addConfigOption(command)).toBe(command);
  });
});

describe("addEnvironmentOption", () => {
  it("adds -n/--environment-name", () => {
    const command = addEnvironmentOption(new Command("demo"));
    const option = command.options.find((o) => o.long === "--environment-name");
    expect(option).toBeDefined();
    expect(option?.short).toBe("-n");
  });
});

describe("addOrgScopeOptions", () => {
  it("adds both --environment-name and --org-id", () => {
    const command = addOrgScopeOptions(new Command("demo"));
    expect(longs(command).has("--environment-name")).toBe(true);
    expect(longs(command).has("--org-id")).toBe(true);
  });

  it("parses --org-id into the option bag", () => {
    const command = addOrgScopeOptions(new Command("demo")).exitOverride();
    command.parse(["node", "scai", "--org-id", "org_ABC"]);
    expect(command.opts().orgId).toBe("org_ABC");
  });
});

describe("addVerbosityOptions", () => {
  it("adds verbose/trace/quiet/json/log-file and --non-interactive by default", () => {
    const command = addVerbosityOptions(new Command("demo"));
    for (const long of [
      "--verbose",
      "--trace",
      "--quiet",
      "--json",
      "--log-file",
      "--non-interactive",
    ]) {
      expect(longs(command).has(long), long).toBe(true);
    }
  });

  it("omits --non-interactive when nonInteractive: false is passed", () => {
    const command = addVerbosityOptions(new Command("demo"), { nonInteractive: false });
    expect(longs(command).has("--non-interactive")).toBe(false);
    // The rest of the verbosity flags are still present.
    expect(longs(command).has("--json")).toBe(true);
  });
});

describe("addAllowWriteOption / addApplyOption / addWhatIfOption", () => {
  it("addAllowWriteOption adds --allow-write", () => {
    expect(longs(addAllowWriteOption(new Command("demo"))).has("--allow-write")).toBe(true);
  });

  it("addApplyOption adds --apply", () => {
    expect(longs(addApplyOption(new Command("demo"))).has("--apply")).toBe(true);
  });

  it("addWhatIfOption adds -w/--what-if", () => {
    const command = addWhatIfOption(new Command("demo"));
    const option = command.options.find((o) => o.long === "--what-if");
    expect(option?.short).toBe("-w");
  });
});

describe("withApplyGate", () => {
  it("coerces whatIf: true and emits a stderr hint when neither --apply nor --what-if is set", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const runner = vi.fn().mockResolvedValue(undefined);
    await withApplyGate(runner)({ briefId: "b-1" } as never);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ briefId: "b-1", whatIf: true }));
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toContain("Dry run");
  });

  it("passes options through untouched and writes no hint when --apply is set", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const runner = vi.fn().mockResolvedValue(undefined);
    const options = { apply: true };
    await withApplyGate(runner)(options);
    expect(runner).toHaveBeenCalledWith(options);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("passes options through untouched when --what-if is explicitly set", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const runner = vi.fn().mockResolvedValue(undefined);
    const options = { whatIf: true };
    await withApplyGate(runner)(options);
    expect(runner).toHaveBeenCalledWith(options);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("awaits an async runner and propagates its rejection", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const runner = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withApplyGate(runner)({ apply: true })).rejects.toThrow("boom");
  });
});

describe("single-flag option adders", () => {
  it("addSkipValidationOption adds -s/--skip-validation", () => {
    const command = addSkipValidationOption(new Command("demo"));
    expect(command.options.find((o) => o.long === "--skip-validation")?.short).toBe("-s");
  });

  it("addForceOption adds --force", () => {
    expect(longs(addForceOption(new Command("demo"))).has("--force")).toBe(true);
  });

  it("addUseDebugSignaturesOption adds --use-debug-signatures", () => {
    expect(
      longs(addUseDebugSignaturesOption(new Command("demo"))).has("--use-debug-signatures")
    ).toBe(true);
  });

  it("addSkipPullOption adds -s/--skip-pull", () => {
    const command = addSkipPullOption(new Command("demo"));
    expect(command.options.find((o) => o.long === "--skip-pull")?.short).toBe("-s");
  });

  it("addAllowFileChangesOption adds --allow-file-changes", () => {
    expect(longs(addAllowFileChangesOption(new Command("demo"))).has("--allow-file-changes")).toBe(
      true
    );
  });
});

describe("addIncludeExcludeOptions", () => {
  it("adds -i/--include and -e/--exclude with collectList accumulators", () => {
    const command = addIncludeExcludeOptions(new Command("demo")).exitOverride();
    command.parse(["node", "scai", "-i", "a,b", "--include", "c", "-e", "x"]);
    const opts = command.opts();
    expect(opts.include).toEqual(["a", "b", "c"]);
    expect(opts.exclude).toEqual(["x"]);
  });

  it("defaults --include / --exclude to empty arrays", () => {
    const command = addIncludeExcludeOptions(new Command("demo")).exitOverride();
    command.parse(["node", "scai"]);
    expect(command.opts().include).toEqual([]);
    expect(command.opts().exclude).toEqual([]);
  });
});

describe("addPublishOptions", () => {
  it("adds -p/--publish and a collectList-backed --targets/--pt", () => {
    const command = addPublishOptions(new Command("demo")).exitOverride();
    command.parse(["node", "scai", "--publish", "--targets", "web,pub"]);
    const opts = command.opts();
    expect(opts.publish).toBe(true);
    expect(opts.pt).toEqual(["web", "pub"]);
  });
});

describe("addExplainOptions", () => {
  it("adds -p/--path and -d/--database", () => {
    const command = addExplainOptions(new Command("demo"));
    expect(longs(command).has("--path")).toBe(true);
    expect(longs(command).has("--database")).toBe(true);
  });
});

describe("addDiffOptions", () => {
  it("adds the source/destination/path/push diff flag set", () => {
    const command = addDiffOptions(new Command("demo"));
    for (const long of [
      "--source",
      "--destination",
      "--path",
      "--source-database",
      "--destination-database",
      "--push",
      "--what-if",
      "--allow-write",
      "--force",
    ]) {
      expect(longs(command).has(long), long).toBe(true);
    }
  });
});

describe("addValidateOptions", () => {
  it("adds -f/--fix", () => {
    const command = addValidateOptions(new Command("demo"));
    expect(command.options.find((o) => o.long === "--fix")?.short).toBe("-f");
  });
});

describe("addPackageCreateOptions / addPackageInstallOptions", () => {
  it("addPackageCreateOptions adds --output and --overwrite", () => {
    const command = addPackageCreateOptions(new Command("demo"));
    expect(longs(command).has("--output")).toBe(true);
    expect(longs(command).has("--overwrite")).toBe(true);
  });

  it("addPackageInstallOptions adds the package/authority/cm/client-id/client-secret flags", () => {
    const command = addPackageInstallOptions(new Command("demo"));
    // The authority flag is declared `--authority, --auth`; commander
    // keeps `--auth` as the canonical long and `--authority` as an alias.
    for (const long of ["--package", "--auth", "--cm", "--client-id", "--client-secret"]) {
      expect(longs(command).has(long), long).toBe(true);
    }
    expect(command.options.some((o) => o.short === "--authority")).toBe(true);
  });
});

describe("markUnstable", () => {
  it("prefixes the description with [unstable]", () => {
    const command = new Command("brief").description("Brief operations.");
    markUnstable(command, "scai ops brief");
    expect(command.description()).toBe("[unstable] Brief operations.");
  });

  it("appends a stability note to the help text naming the surface", () => {
    const command = new Command("brief").description("Brief operations.");
    markUnstable(command, "scai ops brief");
    const help = helpText(command);
    expect(help).toContain("Stability: unstable");
    expect(help).toContain("scai ops brief");
  });

  it("writes a stderr warning before a non-quiet action runs", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const action = vi.fn();
    const command = new Command("brief").description("Brief operations.");
    markUnstable(command, "scai ops brief");
    const list = new Command("list").action(action);
    addVerbosityOptions(list);
    command.addCommand(list);
    command.exitOverride();
    await command.parseAsync(["node", "scai", "list"]);
    expect(action).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalled();
    expect(String(stderr.mock.calls[0][0])).toContain("unstable surface");
  });

  it("suppresses the stderr warning when --quiet is passed", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const action = vi.fn();
    const command = new Command("brief").description("Brief operations.");
    markUnstable(command, "scai ops brief");
    const list = new Command("list").action(action);
    addVerbosityOptions(list);
    command.addCommand(list);
    command.exitOverride();
    await command.parseAsync(["node", "scai", "list", "--quiet"]);
    expect(action).toHaveBeenCalledOnce();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("suppresses the stderr warning for machine-readable output (--json)", async () => {
    // A --json consumer often captures merged stdout+stderr (e.g. the
    // orchestrator's spawn), where the banner would corrupt the parse.
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const action = vi.fn();
    const command = new Command("brief").description("Brief operations.");
    markUnstable(command, "scai ops brief");
    const list = new Command("list").action(action);
    addVerbosityOptions(list); // provides --json
    command.addCommand(list);
    command.exitOverride();
    await command.parseAsync(["node", "scai", "list", "--json"]);
    expect(action).toHaveBeenCalledOnce();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("returns the same command for chaining", () => {
    const command = new Command("brief").description("Brief operations.");
    expect(markUnstable(command, "scai ops brief")).toBe(command);
  });
});
