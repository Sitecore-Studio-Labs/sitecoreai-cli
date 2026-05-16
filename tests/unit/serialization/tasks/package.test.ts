import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  isJson: vi.fn(),
  json: vi.fn(),
  info: vi.fn(),
};

const sharedMocks = vi.hoisted(() => ({
  toLogger: () => logger,
  loadConfigAndModules: vi.fn(),
  ensureAllowWrite: vi.fn(),
  groupSubtreesByDatabase: vi.fn(),
  resolveApiTimeoutMs: vi.fn(),
  inputError: (message: string) => new Error(message),
}));

vi.mock("../../../../src/serialization/tasks/shared", () => sharedMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  normalizeModuleConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));
vi.mock("../../../../src/config/modules", () => ({
  normalizeModuleConfiguration: configMocks.normalizeModuleConfiguration,
}));

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  rm: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

const fgMocks = vi.hoisted(() => ({
  default: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: (...args: unknown[]) => fgMocks.default(...args),
}));

const yamlMocks = vi.hoisted(() => ({
  writeRoleYaml: vi.fn(),
  writeUserYaml: vi.fn(),
  readItemYamlFromString: vi.fn(),
}));

vi.mock("../../../../src/serialization/yaml", () => ({
  writeRoleYaml: (...args: unknown[]) => yamlMocks.writeRoleYaml(...args),
  writeUserYaml: (...args: unknown[]) => yamlMocks.writeUserYaml(...args),
  readItemYamlFromString: (...args: unknown[]) => yamlMocks.readItemYamlFromString(...args),
}));

const storeMocks = vi.hoisted(() => ({
  readRolesFromFilesystem: vi.fn(),
  readUsersFromFilesystem: vi.fn(),
}));

vi.mock("../../../../src/serialization/filesystem-store/roles", () => ({
  readRolesFromFilesystem: (...args: unknown[]) => storeMocks.readRolesFromFilesystem(...args),
}));
vi.mock("../../../../src/serialization/filesystem-store/users", () => ({
  readUsersFromFilesystem: (...args: unknown[]) => storeMocks.readUsersFromFilesystem(...args),
}));

const apiMocks = vi.hoisted(() => ({
  fetchItemMetadata: vi.fn(),
}));

vi.mock("../../../../src/serialization/api/items", () => ({
  fetchItemMetadata: (...args: unknown[]) => apiMocks.fetchItemMetadata(...args),
}));

const fieldFilterMocks = vi.hoisted(() => ({
  createFieldFilterSet: vi.fn(),
}));

vi.mock("../../../../src/serialization/field-filter", () => ({
  createFieldFilterSet: (...args: unknown[]) => fieldFilterMocks.createFieldFilterSet(...args),
}));

const helperMocks = vi.hoisted(() => ({
  applySitecoreCommands: vi.fn(),
  buildCommandsForDatabase: vi.fn(),
  buildItemDataMap: vi.fn(),
  collectItemData: vi.fn(),
}));

vi.mock("../../../../src/serialization/tasks/helpers/sitecore", () => ({
  applySitecoreCommands: (...args: unknown[]) => helperMocks.applySitecoreCommands(...args),
}));
vi.mock("../../../../src/serialization/tasks/helpers/commands", () => ({
  buildCommandsForDatabase: (...args: unknown[]) => helperMocks.buildCommandsForDatabase(...args),
}));
vi.mock("../../../../src/serialization/tasks/helpers/items", () => ({
  buildItemDataMap: (...args: unknown[]) => helperMocks.buildItemDataMap(...args),
}));
vi.mock("../../../../src/serialization/tasks/helpers/collect", () => ({
  collectItemData: (...args: unknown[]) => helperMocks.collectItemData(...args),
}));

const commandMocks = vi.hoisted(() => ({
  enrichCreateCommands: vi.fn(),
  enrichUpdateCommands: vi.fn(),
}));

vi.mock("../../../../src/serialization/commands", () => ({
  enrichCreateCommands: (...args: unknown[]) => commandMocks.enrichCreateCommands(...args),
  enrichUpdateCommands: (...args: unknown[]) => commandMocks.enrichUpdateCommands(...args),
}));

type ZipEntry = { entryName: string; getData: () => Buffer };

const zipMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    files: Array<{ path: string; data: Buffer }>;
    entries: ZipEntry[];
    writeZip: () => void;
  }>,
  nextEntries: [] as ZipEntry[],
}));

class MockZip {
  files: Array<{ path: string; data: Buffer }> = [];
  entries: ZipEntry[];
  writeZip = vi.fn();

  constructor(_path?: string) {
    this.entries = zipMocks.nextEntries;
    zipMocks.nextEntries = [];
    zipMocks.instances.push(this);
  }

  addFile(path: string, data: Buffer) {
    this.files.push({ path, data });
  }

  getEntry(name: string) {
    return this.entries.find((entry) => entry.entryName === name);
  }

  getEntries() {
    return this.entries;
  }
}

vi.mock("adm-zip", () => ({
  default: MockZip,
}));

const makeEntry = (entryName: string, content: string) => ({
  entryName,
  getData: () => Buffer.from(content, "utf8"),
});

describe("serialization package tasks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    zipMocks.instances.length = 0;
    zipMocks.nextEntries = [];
    logger.isJson.mockReturnValue(false);
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(1000);
    fieldFilterMocks.createFieldFilterSet.mockReturnValue("filter");
    helperMocks.buildItemDataMap.mockReturnValue(new Map());
    helperMocks.collectItemData.mockResolvedValue({ items: [] });
  });

  it("throws when output exists and overwrite is false", async () => {
    const { runPackageCreate } = await import("../../../../src/serialization/tasks/package");
    const root = { serialization: { excludedFields: [] } };
    const modules = [];
    sharedMocks.loadConfigAndModules.mockResolvedValue({ root, modules });
    fsMocks.access.mockResolvedValue(undefined);

    await expect(
      runPackageCreate({ config: "/tmp", output: "sitecore.package", overwrite: false })
    ).rejects.toThrow("already exists");

    expect(fsMocks.rm).not.toHaveBeenCalled();
  });

  it("creates a package and logs JSON output", async () => {
    const { runPackageCreate } = await import("../../../../src/serialization/tasks/package");
    logger.isJson.mockReturnValue(true);
    const root = {
      serialization: { excludedFields: [{ fieldId: "field-1", description: "desc" }] },
    };
    const modules = [
      {
        namespace: "demo",
        sourceIdentifier: "/root/demo.module.json",
        items: { includes: [{ physicalPath: "/root/serialization" }] },
      },
    ];
    sharedMocks.loadConfigAndModules.mockResolvedValue({ root, modules });
    fsMocks.access.mockResolvedValue(undefined);
    fgMocks.default.mockResolvedValue(["/root/serialization/item.yml"]);
    fsMocks.readFile.mockResolvedValue(Buffer.from("file", "utf8"));
    storeMocks.readRolesFromFilesystem.mockResolvedValue([
      { serializedItemId: "/root/roles/role.yml" },
    ]);
    storeMocks.readUsersFromFilesystem.mockResolvedValue([
      { serializedItemId: "/root/users/user.yml" },
    ]);
    yamlMocks.writeRoleYaml.mockReturnValue("role-data");
    yamlMocks.writeUserYaml.mockReturnValue("user-data");

    await runPackageCreate({ config: "/tmp", output: "package", overwrite: true, json: true });

    const zip = zipMocks.instances[0];
    expect(fsMocks.rm).toHaveBeenCalled();
    expect(zip.files.some((file) => file.path === "sitecoreai.cli.json")).toBe(true);
    expect(zip.files.some((file) => file.path.endsWith("demo.module.json"))).toBe(true);
    expect(zip.files.some((file) => file.path.endsWith("item.yml"))).toBe(true);
    expect(zip.files.some((file) => file.path.endsWith("role.yml"))).toBe(true);
    expect(zip.files.some((file) => file.path.endsWith("user.yml"))).toBe(true);
    expect(zip.writeZip).toHaveBeenCalledWith(expect.stringMatching(/\.zip$/));
    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "serialization.package.create",
        modules: 1,
      })
    );
  });

  it("throws when package index is missing", async () => {
    const { runPackageInstall } = await import("../../../../src/serialization/tasks/package");
    zipMocks.nextEntries = [];
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "demo",
      environments: { demo: {} },
    });

    await expect(
      runPackageInstall({ config: "/tmp", environmentName: "demo", package: "/tmp/pkg.zip" })
    ).rejects.toThrow("sitecoreai.cli.json");
  });

  it("logs what-if message and skips allow-write enforcement", async () => {
    const { runPackageInstall } = await import("../../../../src/serialization/tasks/package");
    logger.isJson.mockReturnValue(false);
    zipMocks.nextEntries = [makeEntry("sitecoreai.cli.json", JSON.stringify({ modules: [] }))];
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "demo",
      environments: { demo: {} },
    });
    sharedMocks.groupSubtreesByDatabase.mockReturnValue(new Map());

    await runPackageInstall({
      config: "/tmp",
      environmentName: "demo",
      package: "/tmp/pkg.zip",
      whatIf: true,
    });

    expect(sharedMocks.ensureAllowWrite).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "What if mode is active. No changes will be made.",
      "yellow"
    );
  });

  it("installs package content and summarizes changes", async () => {
    const { runPackageInstall } = await import("../../../../src/serialization/tasks/package");
    logger.isJson.mockReturnValue(true);
    const root = {
      defaultEnvironment: "demo",
      environments: { demo: {} },
      serialization: { excludedFields: [] },
    };
    configMocks.readRootConfiguration.mockReturnValue(root);
    configMocks.normalizeModuleConfiguration.mockReturnValue({
      namespace: "demo",
      items: {
        includes: [
          {
            database: "master",
            scope: "DescendantsOnly",
            path: { toPathString: () => "/sitecore/content" },
            includesPath: (itemPath: { toPathString?: () => string } | string) => {
              const value =
                typeof itemPath === "string" ? itemPath : (itemPath?.toPathString?.() ?? "");
              return value.startsWith("/sitecore/content");
            },
          },
        ],
      },
    });
    zipMocks.nextEntries = [
      makeEntry(
        "sitecoreai.cli.json",
        JSON.stringify({ modules: ["missing.module.json", "demo.module.json"] })
      ),
      makeEntry("demo.module.json", JSON.stringify({ namespace: "demo" })),
      makeEntry("content/item.yml", "item"),
      makeEntry("other/skip.yml", "item"),
    ];
    yamlMocks.readItemYamlFromString
      .mockReturnValueOnce({
        id: "item-1",
        parentId: "parent-1",
        templateId: "template-1",
        path: { toPathString: () => "/sitecore/content/home" },
        dataSignature: "sig",
      })
      .mockReturnValueOnce({
        id: "item-2",
        parentId: "parent-1",
        templateId: "template-1",
        path: { toPathString: () => "/sitecore/other" },
        dataSignature: "sig",
      });
    sharedMocks.groupSubtreesByDatabase.mockReturnValue(
      new Map([
        [
          "master",
          [
            {
              database: "master",
              scope: "DescendantsOnly",
              path: { toPathString: () => "/sitecore/content" },
              includesPath: () => true,
            },
          ],
        ],
      ])
    );
    apiMocks.fetchItemMetadata.mockResolvedValue([]);
    helperMocks.buildCommandsForDatabase.mockReturnValue([{ id: "cmd-1" }]);

    await runPackageInstall({
      config: "/tmp",
      environmentName: "demo",
      package: "/tmp/pkg.zip",
      whatIf: false,
    });

    expect(sharedMocks.ensureAllowWrite).toHaveBeenCalledWith(root, "demo");
    expect(commandMocks.enrichCreateCommands).toHaveBeenCalled();
    expect(commandMocks.enrichUpdateCommands).toHaveBeenCalled();
    expect(helperMocks.applySitecoreCommands).toHaveBeenCalledWith(
      root,
      "demo",
      "master",
      [{ id: "cmd-1" }],
      logger,
      false
    );
    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "serialization.package.install",
        environment: "demo",
        totalChanges: 1,
      })
    );
  });
});
