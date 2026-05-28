import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readRootConfiguration } from "../../../src/config/root-config";
import { readSerializationModules } from "../../../src/config/modules";
import { resolveRootConfigurationPath } from "../../../src/config/paths";

const writeConfig = async (dir: string, config: Record<string, unknown>): Promise<string> => {
  const filePath = path.join(dir, "sitecoreai.cli.json");
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
  return filePath;
};

const baseConfig = { modules: ["./example/items/**/*.module.json"] };

describe("resolveRootConfigurationPath", () => {
  it("resolves from a child directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    const child = path.join(root, "nested");
    await fs.mkdir(child, { recursive: true });
    const configPath = await writeConfig(root, { ...baseConfig, envProfiles: {} });

    try {
      const resolved = resolveRootConfigurationPath(child);
      expect(resolved).toBe(configPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an explicit file path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    const customName = path.join(root, "sitecoreai.dev.json");
    await fs.writeFile(customName, JSON.stringify({ ...baseConfig, envProfiles: {} }, null, 2));

    try {
      const resolved = resolveRootConfigurationPath(customName);
      expect(resolved).toBe(path.resolve(customName));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolved config path announcement", () => {
  it("writes the resolved path to stderr under --verbose, deduped per path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, { ...baseConfig, envProfiles: {} });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const prev = process.env.SITECOREAI_VERBOSE;
    process.env.SITECOREAI_VERBOSE = "1";

    try {
      readRootConfiguration(root);
      readRootConfiguration(root);
      const announcements = spy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("Resolved configuration:"));
      expect(announcements).toHaveLength(1);
      expect(announcements[0]).toContain(path.join(root, "sitecoreai.cli.json"));
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.SITECOREAI_VERBOSE;
      else process.env.SITECOREAI_VERBOSE = prev;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("stays silent without --verbose", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, { ...baseConfig, envProfiles: {} });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const prev = process.env.SITECOREAI_VERBOSE;
    delete process.env.SITECOREAI_VERBOSE;

    try {
      readRootConfiguration(root);
      const announced = spy.mock.calls
        .map((call) => String(call[0]))
        .some((line) => line.startsWith("Resolved configuration:"));
      expect(announced).toBe(false);
    } finally {
      spy.mockRestore();
      if (prev !== undefined) process.env.SITECOREAI_VERBOSE = prev;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("readRootConfiguration", () => {
  it("resolves referenced environments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, {
      ...baseConfig,
      envProfiles: {
        base: { host: "base.host", authority: "https://auth" },
        child: { ref: "base", host: "child.host" },
      },
      defaultEnvProfile: "child",
    });

    try {
      const config = readRootConfiguration(root);
      expect(config.environments.child.host).toBe("child.host");
      expect(config.environments.child.authority).toBe("https://auth");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("flattens recipeRoots into the matching flat *Root fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, {
      ...baseConfig,
      envProfiles: {
        demo: {
          recipeRoots: {
            templates: "/sitecore/templates/Project/demo",
            renderings: "/sitecore/layout/Renderings/Project/demo",
            presentationStyles: "/sitecore/content/demo/Presentation/Styles",
            placeholderSettings: ["/sitecore/content/demo/Presentation/Placeholder Settings"],
          },
        },
      },
      defaultEnvProfile: "demo",
    });

    try {
      const config = readRootConfiguration(root);
      expect(config.environments.demo.templatesRoot).toBe("/sitecore/templates/Project/demo");
      expect(config.environments.demo.renderingsRoot).toBe(
        "/sitecore/layout/Renderings/Project/demo"
      );
      expect(config.environments.demo.presentationStylesRoot).toBe(
        "/sitecore/content/demo/Presentation/Styles"
      );
      expect(config.environments.demo.placeholderSettingsRoots).toEqual([
        "/sitecore/content/demo/Presentation/Placeholder Settings",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recipeRoots wins when the same field is set both flat and nested", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, {
      ...baseConfig,
      envProfiles: {
        demo: {
          templatesRoot: "/sitecore/templates/flat",
          recipeRoots: { templates: "/sitecore/templates/nested" },
        },
      },
      defaultEnvProfile: "demo",
    });

    try {
      const config = readRootConfiguration(root);
      expect(config.environments.demo.templatesRoot).toBe("/sitecore/templates/nested");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("throws on circular environment references", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, {
      ...baseConfig,
      envProfiles: {
        a: { ref: "b" },
        b: { ref: "a" },
      },
    });

    try {
      expect(() => readRootConfiguration(root)).toThrow("circular");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applies environment variable overrides", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-config-"));
    await writeConfig(root, {
      ...baseConfig,
      envProfiles: {
        demo: { host: "original.host", deployToken: "token" },
      },
      defaultEnvProfile: "demo",
    });

    process.env.SITECOREAI_ENV_DEMO_CM_HOST = "env.host";
    process.env.SITECOREAI_DEPLOY_TOKEN = "env-token";
    process.env.SITECOREAI_ENV_DEMO_ENVIRONMENT_TYPE = "eh";

    try {
      const config = readRootConfiguration(root);
      expect(config.environments.demo.host).toBe("env.host");
      expect(config.environments.demo.deployToken).toBe("token");
      expect(config.environments.demo.environmentType).toBe("eh");

      const active = readRootConfiguration(root, "demo");
      expect(active.environments.demo.host).toBe("env.host");
      expect(active.environments.demo.deployToken).toBe("env-token");
      expect(active.environments.demo.environmentType).toBe("eh");
    } finally {
      delete process.env.SITECOREAI_ENV_DEMO_CM_HOST;
      delete process.env.SITECOREAI_DEPLOY_TOKEN;
      delete process.env.SITECOREAI_ENV_DEMO_ENVIRONMENT_TYPE;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("throws on invalid module configurations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-modules-"));
    const modulesDir = path.join(root, "modules");
    await fs.mkdir(modulesDir, { recursive: true });
    await writeConfig(root, {
      modules: ["./modules/*.module.json"],
      envProfiles: {},
    });
    await fs.writeFile(path.join(modulesDir, "bad.module.json"), JSON.stringify({}), "utf8");

    try {
      const config = readRootConfiguration(root);
      await expect(readSerializationModules(config)).rejects.toThrow(
        "Invalid module configuration"
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
