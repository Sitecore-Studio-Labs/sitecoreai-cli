import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootConfigurationFile } from "../../../../../src/config/types";

/**
 * Unit tests for `runInit` — the `scai setup init` task runner.
 *
 * The filesystem, config IO, OS keychain, prompts, and the Deploy
 * lookup/auth helpers are all mocked; `applyIfDefined` and `inputError`
 * are the real implementations so thrown errors carry the correct
 * `.code`. No config file is written and no keychain entry is touched.
 *
 * The tests drive `runInit` through its main branches: missing env name,
 * the non-interactive guard, the explicit-flags path, deploy-token
 * persistence, host validation, `--set-default`, and `--ref` validation.
 */

const h = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
  existsSync: vi.fn(),
  renameSync: vi.fn(),
  assertValidHost: vi.fn(),
  resolveTargetPath: vi.fn(),
  writeConfigTemplate: vi.fn(),
  setDeployToken: vi.fn(),
  assertInteractive: vi.fn(),
  promptConfirm: vi.fn(),
  promptText: vi.fn(),
  resolveDeployAuth: vi.fn(),
  resolveDeployLookup: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
  existsSync,
  assertValidHost,
  resolveTargetPath,
  writeConfigTemplate,
  setDeployToken,
  assertInteractive,
  resolveDeployAuth,
  resolveDeployLookup,
  logger,
} = h;

vi.mock("../../../../../src/config/root-config", () => ({
  readRootConfiguration: h.readRootConfiguration,
  readRootConfigurationFile: h.readRootConfigurationFile,
  writeRootConfigurationFile: h.writeRootConfigurationFile,
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...a: unknown[]) => h.existsSync(...a),
    renameSync: (...a: unknown[]) => h.renameSync(...a),
  },
}));

vi.mock("../../../../../src/shared/validate", () => ({ assertValidHost: h.assertValidHost }));

vi.mock("../../../../../src/shared/config-template", () => ({
  resolveTargetPath: h.resolveTargetPath,
  writeConfigTemplate: h.writeConfigTemplate,
}));

vi.mock("../../../../../src/shared/keychain", () => ({ setDeployToken: h.setDeployToken }));

vi.mock("../../../../../src/shared/prompt", () => ({
  assertInteractive: h.assertInteractive,
  promptConfirm: h.promptConfirm,
  promptText: h.promptText,
}));

vi.mock("../../../../../src/serialization/tasks/shared", async () => {
  // Real applyIfDefined / inputError so thrown errors keep their `.code`;
  // a fake logger so output assertions are cheap.
  const cliTasks = await vi.importActual<typeof import("../../../../../src/shared/cli-tasks")>(
    "../../../../../src/shared/cli-tasks"
  );
  return {
    applyIfDefined: cliTasks.applyIfDefined,
    inputError: cliTasks.inputError,
    toLogger: () => h.logger,
  };
});

vi.mock("../../../../../src/serialization/tasks/env/init/auth", () => ({
  resolveDeployAuth: h.resolveDeployAuth,
}));

vi.mock("../../../../../src/serialization/tasks/env/init/deploy-lookup", () => ({
  resolveDeployLookup: h.resolveDeployLookup,
}));

import { runInit } from "../../../../../src/serialization/tasks/env/init";

const configFile = (config: Record<string, unknown> = {}): RootConfigurationFile =>
  ({ config: { envProfiles: {}, ...config } }) as RootConfigurationFile;

describe("runInit", () => {
  const originalIn = process.stdin.isTTY;
  const originalOut = process.stdout.isTTY;
  const originalSkip = process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;
  const originalNonInteractive = process.env.SITECOREAI_NON_INTERACTIVE;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: non-interactive (no TTY) so the wizard never engages.
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP = "1";
    delete process.env.SITECOREAI_NON_INTERACTIVE;

    existsSync.mockReturnValue(true);
    resolveTargetPath.mockReturnValue("/proj/sitecoreai.cli.json");
    readRootConfigurationFile.mockReturnValue(configFile());
    readRootConfiguration.mockReturnValue({ environments: {} });
    setDeployToken.mockResolvedValue(true);
    assertValidHost.mockReturnValue(undefined);
    resolveDeployAuth.mockResolvedValue({
      deployToken: undefined,
      loginAuthority: undefined,
      loginClientId: undefined,
      wantsClientCredentials: false,
      shouldPersistClientId: false,
    });
    resolveDeployLookup.mockResolvedValue({ host: "https://cm.example.com" });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIn, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalOut, configurable: true });
    if (originalSkip === undefined) delete process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;
    else process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP = originalSkip;
    if (originalNonInteractive === undefined) delete process.env.SITECOREAI_NON_INTERACTIVE;
    else process.env.SITECOREAI_NON_INTERACTIVE = originalNonInteractive;
  });

  it("throws INPUT_INVALID when no env name and no flags are given (non-interactive)", async () => {
    // No explicit input → wizard mode; no TTY → assertInteractive must fire.
    // The test fakes assertInteractive as a no-op, so execution continues
    // to the explicit "environment name required" guard.
    await expect(runInit({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires a TTY for wizard mode", async () => {
    await runInit({}).catch(() => undefined);
    expect(assertInteractive).toHaveBeenCalledWith(
      expect.stringContaining("Wizard mode requires a TTY"),
      expect.any(String)
    );
  });

  it("creates the config template when the target file is absent", async () => {
    existsSync.mockReturnValue(false);

    await runInit({ environmentName: "demo", host: "https://cm.example.com" });

    expect(writeConfigTemplate).toHaveBeenCalledWith("/proj/sitecoreai.cli.json");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Created /proj/sitecoreai.cli.json"),
      "green"
    );
  });

  it("persists a new env profile with the provided host", async () => {
    await runInit({ environmentName: "demo", host: "https://cm.example.com" });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: { demo: expect.objectContaining({ host: "https://cm.example.com" }) },
      })
    );
    expect(assertValidHost).toHaveBeenCalledWith("https://cm.example.com", "CM host");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Initialized environment 'demo'"),
      "green"
    );
  });

  it("throws INPUT_INVALID when no host can be resolved", async () => {
    await expect(runInit({ environmentName: "demo", allowWrite: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("stores the deploy token in the keychain when one is resolved", async () => {
    resolveDeployAuth.mockResolvedValue({
      deployToken: "deploy-abc",
      loginAuthority: "https://auth.example",
      loginClientId: undefined,
      wantsClientCredentials: false,
      shouldPersistClientId: false,
      deployTokenMeta: { expiresIn: 3600, lastUpdated: "2026-01-01" },
    });

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      deployToken: "deploy-abc",
    });

    expect(setDeployToken).toHaveBeenCalledWith("demo", "deploy-abc");
    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: {
          demo: expect.objectContaining({
            deployTokenExpiresIn: 3600,
            deployTokenLastUpdated: "2026-01-01",
          }),
        },
      })
    );
  });

  it("warns when the deploy token cannot be stored", async () => {
    resolveDeployAuth.mockResolvedValue({
      deployToken: "deploy-abc",
      loginAuthority: undefined,
      loginClientId: undefined,
      wantsClientCredentials: false,
      shouldPersistClientId: false,
    });
    setDeployToken.mockResolvedValue(false);

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      deployToken: "deploy-abc",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unable to store the Deploy token")
    );
  });

  it("persists the env-scoped clientId when client credentials are requested", async () => {
    resolveDeployAuth.mockResolvedValue({
      deployToken: "deploy-abc",
      loginAuthority: undefined,
      loginClientId: "minted-client",
      wantsClientCredentials: true,
      shouldPersistClientId: true,
    });

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      useClientCredentials: true,
    });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: {
          demo: expect.objectContaining({
            clientId: "minted-client",
            useClientCredentials: true,
          }),
        },
      })
    );
  });

  it("--set-default with no other changes flips defaultEnvProfile", async () => {
    readRootConfigurationFile.mockReturnValue(configFile({ envProfiles: { demo: { host: "h" } } }));

    await runInit({ environmentName: "demo", setDefault: true });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultEnvProfile: "demo" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Default environment set to 'demo'"),
      "green"
    );
  });

  it("--set-default throws ENV_NOT_FOUND for an unknown environment", async () => {
    await expect(runInit({ environmentName: "ghost", setDefault: true })).rejects.toMatchObject({
      code: "ENV_NOT_FOUND",
    });
  });

  it("--ref throws ENV_NOT_FOUND when the referenced env is missing", async () => {
    await expect(
      runInit({ environmentName: "demo", host: "https://cm.example.com", ref: "missing" })
    ).rejects.toMatchObject({ code: "ENV_NOT_FOUND" });
  });

  it("--ref throws INPUT_INVALID when the referenced env is itself a ref", async () => {
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { base: { ref: "other" } } })
    );

    await expect(
      runInit({ environmentName: "demo", host: "https://cm.example.com", ref: "base" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("performs the deploy lookup when an organization is supplied", async () => {
    delete process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;
    resolveDeployLookup.mockResolvedValue({ host: "https://looked-up.example" });

    await runInit({ environmentName: "demo", organization: "Acme Org" });

    expect(resolveDeployLookup).toHaveBeenCalled();
    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: { demo: expect.objectContaining({ host: "https://looked-up.example" }) },
      })
    );
  });

  it("warns when overwriting an existing env profile via flags", async () => {
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { demo: { host: "old" } } })
    );

    await runInit({ environmentName: "demo", host: "https://new.example.com" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Environment 'demo' already exists and will be updated.")
    );
  });

  it("does not warn when overwriting an existing profile with --set-default only", async () => {
    // --set-default with no other changes follows the early-return branch
    // before the overwrite warning would fire.
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { demo: { host: "old" } } })
    );

    await runInit({ environmentName: "demo", setDefault: true });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("sets defaultEnvProfile on the first non-wizard init when none exists", async () => {
    // No defaultEnvProfile in config + non-wizard → the new env becomes
    // the default automatically.
    await runInit({ environmentName: "demo", host: "https://cm.example.com" });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultEnvProfile: "demo" })
    );
  });

  it("does not steal the default when one is already configured (non-wizard)", async () => {
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { other: { host: "h" } }, defaultEnvProfile: "other" })
    );

    await runInit({ environmentName: "demo", host: "https://cm.example.com" });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultEnvProfile: "other" })
    );
  });

  it("applies the --ref pointer onto the new env profile", async () => {
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { base: { host: "https://base.host" } } })
    );

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      ref: "base",
    });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: expect.objectContaining({
          demo: expect.objectContaining({ ref: "base" }),
        }),
      })
    );
  });

  it("persists allowWrite=false when explicitly disabled via flag", async () => {
    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      allowWrite: false,
    });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: { demo: expect.objectContaining({ allowWrite: false }) },
      })
    );
  });

  it("persists organizationId and tenantId when provided as flags", async () => {
    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      organizationId: "org-99",
      tenantId: "tenant-99",
    });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: {
          demo: expect.objectContaining({ organizationId: "org-99", tenantId: "tenant-99" }),
        },
      })
    );
  });

  it("skips the deploy lookup when SITECOREAI_SKIP_DEPLOY_LOOKUP=1 even with an organization flag", async () => {
    // Default beforeEach already sets the env var to "1".
    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      organization: "Acme",
    });

    expect(resolveDeployLookup).not.toHaveBeenCalled();
  });

  it("skips the deploy lookup when --skip-deploy-lookup is passed", async () => {
    delete process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      organization: "Acme",
      skipDeployLookup: true,
    });

    expect(resolveDeployLookup).not.toHaveBeenCalled();
  });

  it("requests a deploy token when a clientId is supplied", async () => {
    delete process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;
    resolveDeployAuth.mockResolvedValue({
      deployToken: "tok",
      loginAuthority: "https://auth",
      loginClientId: "cid",
      wantsClientCredentials: false,
      shouldPersistClientId: false,
    });

    await runInit({
      environmentName: "demo",
      host: "https://cm.example.com",
      clientId: "cid",
    });

    expect(resolveDeployAuth).toHaveBeenCalledWith(
      expect.objectContaining({ needsDeployToken: true })
    );
  });

  it("preserves an existing clientId rather than overwriting it on a re-init", async () => {
    readRootConfigurationFile.mockReturnValue(
      configFile({ envProfiles: { demo: { host: "old", clientId: "kept-client" } } })
    );
    resolveDeployAuth.mockResolvedValue({
      deployToken: undefined,
      loginAuthority: undefined,
      loginClientId: "minted",
      wantsClientCredentials: false,
      shouldPersistClientId: true,
    });

    await runInit({ environmentName: "demo", host: "https://cm.example.com" });

    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        envProfiles: { demo: expect.objectContaining({ clientId: "kept-client" }) },
      })
    );
  });

  describe("wizard mode (interactive)", () => {
    beforeEach(() => {
      // A TTY makes the wizard interactive.
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      // The outer beforeEach uses `vi.clearAllMocks()`, which clears call
      // history but NOT queued `mockResolvedValueOnce` values. A test that
      // throws before consuming a queued prompt value would otherwise leak
      // it into the next test — `mockReset()` empties the queue.
      h.promptText.mockReset();
      h.promptConfirm.mockReset();
    });

    it("prompts for the environment name when none is supplied", async () => {
      h.promptText.mockResolvedValueOnce("wiz-env"); // env name
      h.promptText.mockResolvedValueOnce("https://wiz.host"); // CM host
      h.promptConfirm.mockResolvedValue(false); // allowWrite + set-default
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({});

      expect(h.promptText).toHaveBeenCalledWith(expect.stringContaining("Environment name"));
      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          envProfiles: { "wiz-env": expect.objectContaining({ host: "https://wiz.host" }) },
        })
      );
    });

    it("throws INPUT_INVALID when the wizard env-name prompt comes back empty", async () => {
      h.promptText.mockResolvedValueOnce("");

      await expect(runInit({})).rejects.toMatchObject({ code: "INPUT_INVALID" });
    });

    it("clears a reserved 'default' env name passed via flag in wizard mode", async () => {
      // `--environment-name default` in wizard mode is blanked at the top
      // of runInit; with no existing 'default' profile the rename loop is
      // never entered, so the wizard prompts for the CM host against a
      // blank label and writes the empty-named profile.
      h.promptText.mockResolvedValueOnce("https://host"); // CM host
      h.promptConfirm.mockResolvedValue(false);
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ environmentName: "default", wizard: true });

      const written = writeRootConfigurationFile.mock.calls.at(-1)?.[1] as {
        envProfiles: Record<string, unknown>;
      };
      // The reserved name was blanked — no profile literally named "default".
      expect(Object.keys(written.envProfiles)).not.toContain("default");
    });

    it("re-prompts when the wizard rename loop is given the reserved name 'default'", async () => {
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { demo: { host: "old" } } })
      );
      h.promptConfirm
        .mockResolvedValueOnce(false) // overwrite 'demo'? no
        .mockResolvedValue(false); // allowWrite + set-default
      h.promptText
        .mockResolvedValueOnce("default") // new name -> reserved, re-prompt
        .mockResolvedValueOnce("safe-env") // reserved re-prompt -> accepted
        .mockResolvedValueOnce("https://host"); // CM host
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ environmentName: "demo", wizard: true });

      expect(h.promptText).toHaveBeenCalledWith(
        expect.stringContaining("Environment name cannot be 'default'")
      );
      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          envProfiles: expect.objectContaining({
            "safe-env": expect.objectContaining({ host: "https://host" }),
          }),
        })
      );
    });

    it("overwrites an existing env when the wizard confirms", async () => {
      // The existing profile has no host, forcing the CM-host prompt so we
      // can observe the wizard proceeding past the overwrite confirmation.
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { demo: { allowWrite: true } } })
      );
      h.promptConfirm
        .mockResolvedValueOnce(true) // overwrite? yes
        .mockResolvedValue(false); // allowWrite + set-default
      h.promptText.mockResolvedValueOnce("https://new.host"); // CM host
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ environmentName: "demo", wizard: true });

      expect(h.promptConfirm).toHaveBeenCalledWith(
        expect.stringContaining("already exists. Overwrite?"),
        false
      );
      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          envProfiles: { demo: expect.objectContaining({ host: "https://new.host" }) },
        })
      );
    });

    it("renames to a fresh env when the wizard declines the overwrite", async () => {
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { demo: { host: "old" } } })
      );
      h.promptConfirm
        .mockResolvedValueOnce(false) // overwrite? no
        .mockResolvedValue(false); // allowWrite + set-default
      h.promptText
        .mockResolvedValueOnce("renamed-env") // new name
        .mockResolvedValueOnce("https://renamed.host"); // CM host
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ environmentName: "demo", wizard: true });

      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          envProfiles: expect.objectContaining({
            "renamed-env": expect.objectContaining({ host: "https://renamed.host" }),
          }),
        })
      );
    });

    it("cancels cleanly when the overwrite-rename prompt is left empty", async () => {
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { demo: { host: "old" } } })
      );
      h.promptConfirm.mockResolvedValueOnce(false); // overwrite? no
      h.promptText.mockResolvedValueOnce(""); // new name -> cancel

      await runInit({ environmentName: "demo", wizard: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Init cancelled. No changes were made.")
      );
      expect(writeRootConfigurationFile).not.toHaveBeenCalled();
    });

    it("cancels cleanly when the reserved-name re-prompt is left empty", async () => {
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { demo: { host: "old" } } })
      );
      h.promptConfirm.mockResolvedValueOnce(false); // overwrite 'demo'? no
      h.promptText
        .mockResolvedValueOnce("default") // new name -> reserved
        .mockResolvedValueOnce(""); // reserved re-prompt -> empty -> cancel

      await runInit({ environmentName: "demo", wizard: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Init cancelled. No changes were made.")
      );
      expect(writeRootConfigurationFile).not.toHaveBeenCalled();
    });

    it("recreates an invalid config file when the wizard confirms", async () => {
      const { createScaiError } = await import("../../../../../src/shared/errors");
      let firstRead = true;
      readRootConfigurationFile.mockImplementation(() => {
        if (firstRead) {
          firstRead = false;
          throw createScaiError("bad config", "CONFIG_INVALID");
        }
        return configFile();
      });
      h.promptConfirm.mockResolvedValueOnce(true).mockResolvedValue(false); // recreate? yes
      h.promptText
        .mockResolvedValueOnce("wiz-env") // env name
        .mockResolvedValueOnce("https://host"); // CM host
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ wizard: true });

      expect(writeConfigTemplate).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Backed up invalid config"));
    });

    it("cancels when the wizard declines to recreate an invalid config", async () => {
      const { createScaiError } = await import("../../../../../src/shared/errors");
      readRootConfigurationFile.mockImplementation(() => {
        throw createScaiError("bad config", "CONFIG_INVALID");
      });
      h.promptText.mockResolvedValueOnce("wiz-env"); // env name
      h.promptConfirm.mockResolvedValueOnce(false); // recreate? no

      await runInit({ wizard: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Init cancelled. No changes were made.")
      );
      expect(writeRootConfigurationFile).not.toHaveBeenCalled();
    });

    it("rethrows a non-CONFIG_INVALID read error rather than recreating", async () => {
      const { createScaiError } = await import("../../../../../src/shared/errors");
      readRootConfigurationFile.mockImplementation(() => {
        throw createScaiError("file vanished", "CONFIG_NOT_FOUND");
      });
      h.promptText.mockResolvedValueOnce("wiz-env");

      await expect(runInit({ wizard: true })).rejects.toMatchObject({
        code: "CONFIG_NOT_FOUND",
      });
    });

    it("prompts for allowWrite and the default flag in the wizard", async () => {
      h.promptText
        .mockResolvedValueOnce("wiz-env") // env name
        .mockResolvedValueOnce("https://host"); // CM host
      h.promptConfirm
        .mockResolvedValueOnce(true) // allow write? yes
        .mockResolvedValueOnce(true); // set as default? yes
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ wizard: true });

      expect(h.promptConfirm).toHaveBeenCalledWith("Allow write operations?", false);
      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          defaultEnvProfile: "wiz-env",
          envProfiles: { "wiz-env": expect.objectContaining({ allowWrite: true }) },
        })
      );
    });

    it("respects a declined 'set as default' wizard prompt", async () => {
      readRootConfigurationFile.mockReturnValue(
        configFile({ envProfiles: { existing: {} }, defaultEnvProfile: "existing" })
      );
      h.promptText.mockResolvedValueOnce("wiz-env").mockResolvedValueOnce("https://host");
      h.promptConfirm
        .mockResolvedValueOnce(false) // allow write? no
        .mockResolvedValueOnce(false); // set as default? no
      resolveDeployLookup.mockResolvedValue({ host: undefined });

      await runInit({ wizard: true });

      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ defaultEnvProfile: "existing" })
      );
    });

    it("always runs the deploy lookup in wizard mode", async () => {
      delete process.env.SITECOREAI_SKIP_DEPLOY_LOOKUP;
      h.promptText.mockResolvedValueOnce("wiz-env");
      h.promptConfirm.mockResolvedValue(false);
      resolveDeployLookup.mockResolvedValue({ host: "https://looked-up.host" });

      await runInit({ wizard: true });

      expect(resolveDeployLookup).toHaveBeenCalled();
      expect(writeRootConfigurationFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          envProfiles: {
            "wiz-env": expect.objectContaining({ host: "https://looked-up.host" }),
          },
        })
      );
    });
  });
});
