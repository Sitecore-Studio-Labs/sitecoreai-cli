import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootConfiguration, RootConfigurationFile } from "../../../../../src/config/types";
import { ScaiError } from "../../../../../src/shared/errors";

/**
 * Unit tests for `runSetupOrgClient` — `scai setup client create --org`.
 *
 * The config IO, OS keychain, Deploy clients API, and the policy mint
 * gate are mocked; the real `Logger` is used so `--json` envelopes can
 * be asserted by spying on `process.stdout.write`. No client is minted
 * against a real API and no secret is written to a real keychain.
 *
 * Env resolution itself lives in `resolveActiveEnvironment` (covered in
 * tests/unit/config/resolve-active-environment.test.ts); here it is
 * mocked, and we only assert that `runSetupOrgClient` surfaces its
 * failures. Branches covered: env-resolution failure propagation,
 * missing organizationId, missing deploy token (AUTH_REQUIRED), the
 * list-clients failure (DEPLOY_FAILED), already-provisioned no-op,
 * `--what-if` plan output (mint vs replace), the orphaned-client
 * re-mint, `--rotate`, and the JSON-vs-human envelopes.
 */

const h = vi.hoisted(() => ({
  resolveActiveEnvironment: vi.fn(),
  readRootConfigurationFile: vi.fn(),
  writeRootConfigurationFile: vi.fn(),
  getDeployToken: vi.fn(),
  getOrgClientSecret: vi.fn(),
  setOrgClientSecret: vi.fn(),
  listOrganizationClients: vi.fn(),
  mintDeployClient: vi.fn(),
  deleteClient: vi.fn(),
  authorizeOperation: vi.fn(),
}));

const {
  resolveActiveEnvironment,
  readRootConfigurationFile,
  writeRootConfigurationFile,
  getDeployToken,
  getOrgClientSecret,
  setOrgClientSecret,
  listOrganizationClients,
  mintDeployClient,
  deleteClient,
  authorizeOperation,
} = h;

vi.mock("../../../../../src/config/root-config", () => ({
  resolveActiveEnvironment: h.resolveActiveEnvironment,
  readRootConfigurationFile: h.readRootConfigurationFile,
  writeRootConfigurationFile: h.writeRootConfigurationFile,
}));

vi.mock("../../../../../src/shared/keychain", () => ({
  getDeployToken: h.getDeployToken,
  getOrgClientSecret: h.getOrgClientSecret,
  setOrgClientSecret: h.setOrgClientSecret,
}));

vi.mock("../../../../../src/deploy/api", () => ({
  listOrganizationClients: h.listOrganizationClients,
  mintDeployClient: h.mintDeployClient,
  deleteClient: h.deleteClient,
  buildScaiClientName: () => "scai-deploy",
  buildScaiClientDescription: () => "Managed by scai CLI.",
}));

vi.mock("../../../../../src/policy", () => ({ authorizeOperation: h.authorizeOperation }));

import { runSetupOrgClient } from "../../../../../src/serialization/tasks/env/setup-org-client";

/**
 * A resolved-environment result as `resolveActiveEnvironment` returns it.
 * `org === undefined` models an env profile with no `organizationId`.
 */
const activeEnv = (
  org: string | undefined
): { envName: string; env: { organizationId?: string }; root: RootConfiguration } => ({
  envName: "prod",
  env: org === undefined ? {} : { organizationId: org },
  root: { physicalPath: "/proj/sitecoreai.cli.json" } as unknown as RootConfiguration,
});

const rootFile = (overrides: Record<string, unknown> = {}): RootConfigurationFile =>
  ({
    config: { envProfiles: { prod: {} }, defaultEnvProfile: "prod", ...overrides },
  }) as RootConfigurationFile;

let stdout: ReturnType<typeof vi.spyOn>;

/** Last JSON document written to stdout by the runner in --json mode. */
const jsonOut = (): unknown => JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null"));

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  resolveActiveEnvironment.mockReturnValue(activeEnv("org-1"));
  readRootConfigurationFile.mockReturnValue(rootFile());
  getDeployToken.mockResolvedValue("deploy-token");
  getOrgClientSecret.mockResolvedValue(undefined);
  setOrgClientSecret.mockResolvedValue(true);
  listOrganizationClients.mockResolvedValue({ items: [] });
  mintDeployClient.mockResolvedValue({ clientId: "minted-id", clientSecret: "minted-secret" });
  deleteClient.mockResolvedValue(undefined);
  authorizeOperation.mockReturnValue(undefined);
});

afterEach(() => {
  stdout.mockRestore();
});

describe("runSetupOrgClient — preconditions", () => {
  it("propagates env-resolution failures from resolveActiveEnvironment", async () => {
    resolveActiveEnvironment.mockImplementation(() => {
      throw new ScaiError("No environment specified and no defaultEnvProfile is set.", {
        code: "INPUT_INVALID",
      });
    });

    await expect(runSetupOrgClient({ quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when the environment has no organizationId", async () => {
    resolveActiveEnvironment.mockReturnValue(activeEnv(undefined));

    await expect(runSetupOrgClient({ quiet: true, environmentName: "prod" })).rejects.toMatchObject(
      { code: "INPUT_INVALID" }
    );
  });

  it("throws AUTH_REQUIRED when no deploy token is available", async () => {
    getDeployToken.mockResolvedValue(undefined);
    const originalEnvToken = process.env.SITECOREAI_DEPLOY_TOKEN;
    delete process.env.SITECOREAI_DEPLOY_TOKEN;

    await expect(runSetupOrgClient({ quiet: true, environmentName: "prod" })).rejects.toMatchObject(
      { code: "AUTH_REQUIRED" }
    );

    if (originalEnvToken !== undefined) process.env.SITECOREAI_DEPLOY_TOKEN = originalEnvToken;
  });

  it("invokes the policy mint gate before doing any work", async () => {
    await runSetupOrgClient({ quiet: true, environmentName: "prod" });

    expect(authorizeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ envName: "prod", tier: "mint" })
    );
  });

  it("throws DEPLOY_FAILED when listing organization clients fails", async () => {
    listOrganizationClients.mockRejectedValue(new Error("403 forbidden"));

    await expect(runSetupOrgClient({ quiet: true, environmentName: "prod" })).rejects.toMatchObject(
      { code: "DEPLOY_FAILED" }
    );
  });
});

describe("runSetupOrgClient — already provisioned", () => {
  it("is a no-op when both halves of the credential are present (human)", async () => {
    readRootConfigurationFile.mockReturnValue(
      rootFile({ orgClients: { "org-1": { clientId: "existing-id", name: "scai-deploy" } } })
    );
    getOrgClientSecret.mockResolvedValue("existing-secret");
    listOrganizationClients.mockResolvedValue({ items: [{ id: "srv-id", name: "scai-deploy" }] });

    await runSetupOrgClient({ quiet: true, environmentName: "prod" });

    expect(mintDeployClient).not.toHaveBeenCalled();
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it("reports the no-op as a JSON envelope in --json mode", async () => {
    readRootConfigurationFile.mockReturnValue(
      rootFile({ orgClients: { "org-1": { clientId: "existing-id", name: "scai-deploy" } } })
    );
    getOrgClientSecret.mockResolvedValue("existing-secret");
    listOrganizationClients.mockResolvedValue({ items: [{ id: "srv-id", name: "scai-deploy" }] });

    await runSetupOrgClient({ json: true, environmentName: "prod" });

    expect(jsonOut()).toMatchObject({
      organization: "org-1",
      action: "none",
      provisioned: true,
    });
    expect(mintDeployClient).not.toHaveBeenCalled();
  });
});

describe("runSetupOrgClient — what-if", () => {
  it("plans a mint without mutating anything (human mode)", async () => {
    await runSetupOrgClient({ quiet: true, environmentName: "prod", whatIf: true });

    expect(mintDeployClient).not.toHaveBeenCalled();
    expect(deleteClient).not.toHaveBeenCalled();
    expect(writeRootConfigurationFile).not.toHaveBeenCalled();
  });

  it("plans a mint as a JSON envelope", async () => {
    await runSetupOrgClient({ json: true, environmentName: "prod", whatIf: true });

    expect(jsonOut()).toMatchObject({ action: "mint", whatIf: true });
    expect(mintDeployClient).not.toHaveBeenCalled();
  });

  it("plans a replace when a server client exists with no keychain secret", async () => {
    listOrganizationClients.mockResolvedValue({ items: [{ id: "srv-id", name: "scai-deploy" }] });

    await runSetupOrgClient({ json: true, environmentName: "prod", whatIf: true });

    expect(jsonOut()).toMatchObject({ action: "replace", whatIf: true });
  });
});

describe("runSetupOrgClient — mint and persist", () => {
  it("mints a fresh client, persists the secret, and writes the config metadata", async () => {
    await runSetupOrgClient({ json: true, environmentName: "prod" });

    expect(mintDeployClient).toHaveBeenCalledTimes(1);
    expect(setOrgClientSecret).toHaveBeenCalledWith("org-1", "minted-secret");
    expect(writeRootConfigurationFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgClients: {
          "org-1": expect.objectContaining({ clientId: "minted-id", name: "scai-deploy" }),
        },
      })
    );
    expect(jsonOut()).toMatchObject({
      action: "mint",
      clientId: "minted-id",
      persisted: true,
    });
  });

  it("deletes the orphaned server client before re-minting", async () => {
    // A server client exists but the keychain has no secret → orphan.
    listOrganizationClients.mockResolvedValue({
      items: [{ id: "orphan-id", name: "scai-deploy" }],
    });

    await runSetupOrgClient({ json: true, environmentName: "prod" });

    expect(deleteClient).toHaveBeenCalledWith(
      { accessToken: "deploy-token" },
      "orphan-id",
      "org-1"
    );
    expect(mintDeployClient).toHaveBeenCalledTimes(1);
    expect(jsonOut()).toMatchObject({ action: "replace" });
  });

  it("--rotate deletes and re-mints even when fully provisioned", async () => {
    readRootConfigurationFile.mockReturnValue(
      rootFile({ orgClients: { "org-1": { clientId: "existing-id", name: "scai-deploy" } } })
    );
    getOrgClientSecret.mockResolvedValue("existing-secret");
    listOrganizationClients.mockResolvedValue({ items: [{ id: "srv-id", name: "scai-deploy" }] });

    await runSetupOrgClient({ json: true, environmentName: "prod", rotate: true });

    expect(deleteClient).toHaveBeenCalledWith({ accessToken: "deploy-token" }, "srv-id", "org-1");
    expect(mintDeployClient).toHaveBeenCalledTimes(1);
  });

  it("throws DEPLOY_FAILED when the clients API omits the clientId/secret", async () => {
    mintDeployClient.mockResolvedValue({ clientId: "", clientSecret: "" });

    await expect(runSetupOrgClient({ quiet: true, environmentName: "prod" })).rejects.toMatchObject(
      { code: "DEPLOY_FAILED" }
    );
  });

  it("reports persisted=false in JSON when the keychain write fails", async () => {
    setOrgClientSecret.mockResolvedValue(false);

    await runSetupOrgClient({ json: true, environmentName: "prod" });

    expect(jsonOut()).toMatchObject({ persisted: false });
    // The config metadata is still written even though the secret was not.
    expect(writeRootConfigurationFile).toHaveBeenCalled();
  });
});
