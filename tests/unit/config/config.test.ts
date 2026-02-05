import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readRootConfiguration,
  readSerializationModules,
  resolveRootConfigurationPath,
} from "../../../src/config";

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
