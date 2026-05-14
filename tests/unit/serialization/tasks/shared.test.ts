import { describe, expect, it, vi } from "vitest";
import {
  applyIfDefined,
  inputError,
  selectMatch,
  resolveApiTimeoutMs,
} from "../../../../src/shared/cli-tasks";
import {
  printDeployResultWithContext,
  printDeployWhatIf,
  resolveTenantTypeValue,
  resolveProjectIdValue,
  resolveEnvironmentType,
  getEnvironmentType,
  filterEnvironmentsByType,
  extractDeployEnvironmentList,
} from "../../../../src/deploy/tasks/shared";

describe("serialization task helpers", () => {
  it("applyIfDefined updates only when value is provided", () => {
    const target = { name: "alpha" };
    applyIfDefined(target, "name", "beta");
    expect(target.name).toBe("beta");
    applyIfDefined(target, "name", undefined);
    expect(target.name).toBe("beta");
  });

  it("selectMatch resolves by id or name", () => {
    const list = [
      { id: "id-1", name: "Alpha" },
      { id: "id-2", name: "Beta" },
    ];
    expect(selectMatch(list, "Item", "id-2").id).toBe("id-2");
    expect(selectMatch(list, "Item", "alpha").id).toBe("id-1");
  });

  it("selectMatch throws when ambiguous or missing", () => {
    const list = [{ id: "id-1", name: "Alpha" }];
    expect(selectMatch(list, "Item")).toEqual(list[0]);
    expect(() => selectMatch([{ id: "id-1" }, { id: "id-2" }], "Item")).toThrow();
    expect(() => selectMatch(list, "Item", "missing")).toThrow();
  });

  it("resolves tenant type values", () => {
    expect(resolveTenantTypeValue(1)).toBe(1);
    expect(resolveTenantTypeValue(0)).toBe(0);
    expect(resolveTenantTypeValue("prod")).toBe(1);
    expect(resolveTenantTypeValue("production")).toBe(1);
    expect(resolveTenantTypeValue("nonprod")).toBe(0);
    expect(resolveTenantTypeValue("non-production")).toBe(0);
    expect(resolveTenantTypeValue("nonproduction")).toBe(0);
    expect(resolveTenantTypeValue("other")).toBeUndefined();
  });

  it("resolves project id values", () => {
    expect(resolveProjectIdValue("proj-1")).toBe("proj-1");
    expect(resolveProjectIdValue("  proj-2 ")).toBe("  proj-2 ");
    expect(resolveProjectIdValue("   ")).toBeUndefined();
    expect(resolveProjectIdValue(undefined)).toBeUndefined();
  });

  it("resolves environment types", () => {
    expect(resolveEnvironmentType({ type: "CM" })).toBe("cm");
    expect(resolveEnvironmentType({ environmentType: "xm" })).toBe("xm");
    expect(resolveEnvironmentType({ envType: "eh" })).toBe("eh");
    expect(resolveEnvironmentType("nope")).toBeUndefined();
  });

  it("filters environments by type", () => {
    const list = [
      { id: "env-1", type: "cm" },
      { id: "env-2", type: "xm" },
    ];
    expect(getEnvironmentType(list[0])).toBe("cm");
    expect(filterEnvironmentsByType(list, "xm")).toEqual([list[1]]);
    expect(filterEnvironmentsByType(list)).toEqual(list);
  });

  it("extracts environment list from API results", () => {
    const list = [{ id: "env-1" }];
    expect(extractDeployEnvironmentList(list)).toEqual(list);
    expect(extractDeployEnvironmentList({ items: list })).toEqual(list);
    expect(extractDeployEnvironmentList({ data: list })).toEqual(list);
    expect(extractDeployEnvironmentList({})).toEqual([]);
  });

  it("resolves API timeout values", () => {
    const root = { settings: { apiClientTimeoutInMinutes: 5 } } as {
      settings: { apiClientTimeoutInMinutes: number };
    };
    expect(resolveApiTimeoutMs(root)).toBe(5 * 60 * 1000);
    expect(
      resolveApiTimeoutMs({ settings: { apiClientTimeoutInMinutes: 0 } } as typeof root)
    ).toBeUndefined();
    expect(
      resolveApiTimeoutMs({ settings: { apiClientTimeoutInMinutes: -1 } } as typeof root)
    ).toBeUndefined();
  });

  it("wraps input errors with ScaiError code", () => {
    const error = inputError("Bad input");
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("INPUT_INVALID");
  });

  it("prints deploy results with context as a canonical ScaiEnvelope in JSON mode", () => {
    const jsonSpy = vi.fn();
    const logger = { isJson: () => true, json: jsonSpy } as {
      isJson: () => boolean;
      json: typeof jsonSpy;
    };
    printDeployResultWithContext(
      logger,
      { envName: "demo" },
      "deploy.test",
      { ok: true },
      {
        extra: 1,
      }
    );
    // `data` (not `result`) is the canonical envelope key; non-canonical
    // extras collect under `meta` to keep top-level slots reserved for
    // structured envelope fields (count, totalCount, pageSize, etc.).
    expect(jsonSpy).toHaveBeenCalledWith({
      command: "deploy.test",
      environment: "demo",
      data: { ok: true },
      meta: { extra: 1 },
    });
  });

  it("hoists canonical envelope keys from `extra` to envelope-level", () => {
    const jsonSpy = vi.fn();
    const logger = { isJson: () => true, json: jsonSpy } as {
      isJson: () => boolean;
      json: typeof jsonSpy;
    };
    printDeployResultWithContext(
      logger,
      { envName: "demo" },
      "deploy.test",
      [{ id: 1 }, { id: 2 }],
      {
        totalCount: 100,
        pageSize: 50,
        root: "/sitecore/content",
      }
    );
    expect(jsonSpy).toHaveBeenCalledWith({
      command: "deploy.test",
      environment: "demo",
      data: [{ id: 1 }, { id: 2 }],
      count: 2,
      totalCount: 100,
      pageSize: 50,
      meta: { root: "/sitecore/content" },
    });
  });

  it("prints deploy what-if payloads as a canonical envelope in JSON mode", () => {
    const jsonSpy = vi.fn();
    const logger = { isJson: () => true, json: jsonSpy } as {
      isJson: () => boolean;
      json: typeof jsonSpy;
    };
    printDeployWhatIf(logger, { envName: "demo" }, "deploy.test", { method: "POST" });
    expect(jsonSpy).toHaveBeenCalledWith({
      command: "deploy.test",
      environment: "demo",
      data: { method: "POST" },
      whatIf: true,
    });
  });
});
