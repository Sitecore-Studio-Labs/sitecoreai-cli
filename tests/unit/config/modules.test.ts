import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  normalizeModuleConfiguration,
  readSerializationModules,
} from "../../../src/config/modules";
import {
  AllowedPushOperations,
  TreeRuleScope,
  TreeScope,
} from "../../../src/serialization/tree-spec";
import type { RootConfiguration } from "../../../src/config/types";

const createRootConfig = (rootDir: string, modules: string[]): RootConfiguration => ({
  modules,
  serialization: {
    defaultMaxRelativeItemPathLength: 120,
    defaultModuleRelativeSerializationPath: "serialization",
    removeOrphansForRoles: true,
    removeOrphansForUsers: true,
    continueOnItemFailure: false,
    excludedFields: [],
  },
  settings: {
    telemetryEnabled: false,
    cacheAuthenticationToken: true,
    versionComparisonEnabled: true,
    apiClientTimeoutInMinutes: 5,
  },
  environments: {},
  physicalPath: path.join(rootDir, "sitecoreai.cli.json"),
  defaultEnvironment: "default",
});

describe("normalizeModuleConfiguration", () => {
  it("normalizes includes, rules, and module paths", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-modules-"));
    const rootConfig = createRootConfig(rootDir, []);
    const moduleFile = path.join(rootDir, "demo.module.json");
    const raw = {
      namespace: "demo",
      items: {
        path: "~/items/$(module)",
        excludedFields: [{ FieldId: "field-1", description: "test" }],
        includes: [
          {
            name: "content",
            path: "/sitecore/content",
            scope: "descendantsOnly",
            allowedPushOperations: "createAndUpdate",
            maxRelativePathLength: 80,
            rules: [
              {
                path: "/sitecore/content/*",
                scope: "ignored",
                allowedPushOperations: "createOnly",
                alias: "content",
              },
              {
                path: "/sitecore/content/invalid",
                scope: "unknown",
              },
            ],
          },
          {
            name: "skip-missing-path",
          },
        ],
      },
      roles: [{ domain: "sitecore", pattern: "*" }],
      users: [{ domain: "sitecore", pattern: "*" }],
      tags: ["tag-1"],
    };

    const normalized = normalizeModuleConfiguration(raw, moduleFile, rootConfig);

    expect(normalized.items.excludedFields).toEqual([{ fieldId: "field-1", description: "test" }]);
    expect(normalized.items.includes).toHaveLength(1);
    const subtree = normalized.items.includes[0];
    expect(subtree.scope).toBe(TreeScope.DescendantsOnly);
    expect(subtree.allowedPushOperations).toBe(AllowedPushOperations.CreateAndUpdate);
    expect(subtree.maxRelativePathLength).toBe(80);
    expect(subtree.physicalPath).toBe(path.join(rootDir, "items", "demo", "content"));
    expect(subtree.rules).toHaveLength(2);
    expect(subtree.rules[0].scope).toBe(TreeRuleScope.Ignored);
    expect(subtree.rules[0].allowedPushOperations).toBe(AllowedPushOperations.CreateOnly);
    expect(subtree.rules[0].alias).toBe("content");
    expect(subtree.rules[1].scope).toBeUndefined();

    await fs.rm(rootDir, { recursive: true, force: true });
  });
});

describe("readSerializationModules", () => {
  it("filters modules by include/exclude patterns", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-module-read-"));
    const moduleA = path.join(rootDir, "alpha.module.json");
    const moduleB = path.join(rootDir, "beta.module.json");
    await fs.writeFile(moduleA, JSON.stringify({ namespace: "alpha" }, null, 2), "utf8");
    await fs.writeFile(moduleB, JSON.stringify({ namespace: "beta" }, null, 2), "utf8");

    const rootConfig = createRootConfig(rootDir, ["*.module.json"]);
    const included = await readSerializationModules(rootConfig, ["alp"]);
    const excluded = await readSerializationModules(rootConfig, undefined, ["bet"]);

    expect(included).toHaveLength(1);
    expect(included[0].namespace).toBe("alpha");
    expect(excluded).toHaveLength(1);
    expect(excluded[0].namespace).toBe("alpha");

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("throws when module configuration is invalid", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-module-invalid-"));
    const moduleFile = path.join(rootDir, "broken.module.json");
    await fs.writeFile(moduleFile, JSON.stringify({ namespace: 123 }, null, 2), "utf8");

    const rootConfig = createRootConfig(rootDir, ["*.module.json"]);

    await expect(readSerializationModules(rootConfig)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("throws when no module paths are configured", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-module-empty-"));
    const rootConfig = createRootConfig(rootDir, []);
    await expect(readSerializationModules(rootConfig)).rejects.toThrow(
      "Root configuration does not contain any module path definitions."
    );
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
