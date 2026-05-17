import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

/**
 * `scai setup client …` command wiring. The env / org-client / clients
 * setup task runners and the brand-login runner are mocked; tests walk
 * the command tree, assert the `create` verb's `--org` fork (org-client
 * vs env-client), the positional `[env]` / `<id>` threading on
 * list/delete, the `register-brand` credential flags, and the
 * deprecated `createLoginBrandCommand` alias.
 */

const taskMocks = vi.hoisted(() => ({
  runSetupEnv: vi.fn(),
  runSetupOrgClient: vi.fn(),
  runSetupClients: vi.fn(),
  runBrandLogin: vi.fn(),
}));

vi.mock("../../../src/serialization/tasks/env/setup-env", () => ({
  runSetupEnv: taskMocks.runSetupEnv,
}));
vi.mock("../../../src/serialization/tasks/env/setup-org-client", () => ({
  runSetupOrgClient: taskMocks.runSetupOrgClient,
}));
vi.mock("../../../src/serialization/tasks/env/setup-clients", () => ({
  runSetupClients: taskMocks.runSetupClients,
}));
vi.mock("../../../src/brand/tasks/login", () => ({
  runBrandLogin: taskMocks.runBrandLogin,
}));

import {
  createSetupClientCommand,
  createLoginBrandCommand,
} from "../../../src/commands/setup-client";

/** Find a direct subcommand by name. */
const sub = (command: Command, name: string): Command | undefined =>
  command.commands.find((child) => child.name() === name);

const runClient = async (args: string[]): Promise<void> => {
  const command = createSetupClientCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

const runLoginBrand = async (args: string[]): Promise<void> => {
  const command = createLoginBrandCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSetupClientCommand — command tree", () => {
  const client = createSetupClientCommand();

  it("registers create / list / delete / register-brand", () => {
    for (const name of ["create", "list", "delete", "register-brand"]) {
      expect(sub(client, name), name).toBeDefined();
    }
  });

  it("exposes 'brand' as an alias of register-brand", () => {
    const registerBrand = sub(client, "register-brand")!;
    expect(registerBrand.aliases()).toContain("brand");
  });

  it("declares --org / --rotate / --what-if on create", () => {
    const create = sub(client, "create")!;
    const longs = new Set(create.options.map((o) => o.long));
    for (const long of ["--org", "--rotate", "--what-if"]) {
      expect(longs.has(long), long).toBe(true);
    }
  });

  it("declares the brand credential flags on register-brand", () => {
    const registerBrand = sub(client, "register-brand")!;
    const longs = new Set(registerBrand.options.map((o) => o.long));
    for (const long of [
      "--org-id",
      "--client-id",
      "--client-secret",
      "--authority",
      "--audience",
      "--force",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("setup client create — --org fork", () => {
  it("delegates to runSetupEnv (env-scoped) without --org", async () => {
    await runClient(["create", "sandbox", "--quiet"]);
    expect(taskMocks.runSetupEnv).toHaveBeenCalledOnce();
    expect(taskMocks.runSetupOrgClient).not.toHaveBeenCalled();
    expect(taskMocks.runSetupEnv).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "sandbox" })
    );
  });

  it("delegates to runSetupOrgClient (org-scoped) with --org", async () => {
    await runClient(["create", "production", "--org", "--quiet"]);
    expect(taskMocks.runSetupOrgClient).toHaveBeenCalledOnce();
    expect(taskMocks.runSetupEnv).not.toHaveBeenCalled();
    expect(taskMocks.runSetupOrgClient).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "production", org: true })
    );
  });

  it("threads --rotate / --what-if through to runSetupEnv", async () => {
    await runClient(["create", "--rotate", "--what-if", "--quiet"]);
    expect(taskMocks.runSetupEnv).toHaveBeenCalledWith(
      expect.objectContaining({ rotate: true, whatIf: true, environmentName: undefined })
    );
  });
});

describe("setup client list / delete", () => {
  it("list threads the [env] positional through to runSetupClients", async () => {
    await runClient(["list", "production", "--quiet"]);
    expect(taskMocks.runSetupClients).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "production" })
    );
  });

  it("delete threads the <id> positional as the delete target", async () => {
    await runClient(["delete", "client-xyz", "sandbox", "--quiet"]);
    expect(taskMocks.runSetupClients).toHaveBeenCalledWith(
      expect.objectContaining({ environmentName: "sandbox", delete: "client-xyz" })
    );
  });

  it("delete rejects a missing required <id> argument", async () => {
    await expect(runClient(["delete", "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runSetupClients).not.toHaveBeenCalled();
  });

  it("delete threads --force through", async () => {
    await runClient(["delete", "client-xyz", "--force", "--quiet"]);
    expect(taskMocks.runSetupClients).toHaveBeenCalledWith(
      expect.objectContaining({ delete: "client-xyz", force: true })
    );
  });
});

describe("setup client register-brand", () => {
  it("delegates to runBrandLogin with the parsed credential flags", async () => {
    await runClient([
      "register-brand",
      "--org-id",
      "org_ABC",
      "--client-id",
      "cid-1",
      "--client-secret",
      "secret-1",
      "--quiet",
    ]);
    expect(taskMocks.runBrandLogin).toHaveBeenCalledOnce();
    expect(taskMocks.runBrandLogin).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_ABC", clientId: "cid-1", clientSecret: "secret-1" })
    );
  });

  it("threads --authority / --audience / --force overrides", async () => {
    await runClient([
      "register-brand",
      "--authority",
      "https://auth.example.com",
      "--audience",
      "https://api.example.com",
      "--force",
      "--quiet",
    ]);
    expect(taskMocks.runBrandLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: "https://auth.example.com",
        audience: "https://api.example.com",
        force: true,
      })
    );
  });
});

describe("createLoginBrandCommand — deprecated alias", () => {
  const loginBrand = createLoginBrandCommand();

  it("is named 'brand' with the ai-skills aliases", () => {
    expect(loginBrand.name()).toBe("brand");
    expect(loginBrand.aliases()).toEqual(
      expect.arrayContaining(["ai-skills", "ai-skill", "aiskills", "aiskill"])
    );
  });

  it("delegates to runBrandLogin (identical behavior to register-brand)", async () => {
    await runLoginBrand(["--org-id", "org_DEF", "--quiet"]);
    expect(taskMocks.runBrandLogin).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_DEF" })
    );
  });
});
