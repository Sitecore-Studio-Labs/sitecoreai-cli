import { describe, expect, it } from "vitest";
import { createDeployCommand } from "../../../src/commands/deploy";

const getCommand = (root: ReturnType<typeof createDeployCommand>, path: string[]) => {
  let current = root;
  for (const segment of path) {
    const next = current.commands.find((cmd) => cmd.name() === segment);
    if (!next) {
      throw new Error(`Command not found: ${path.join(" ")}`);
    }
    current = next;
  }
  return current;
};

const getOptionLongs = (cmd: ReturnType<typeof createDeployCommand>): Set<string> => {
  const longs = cmd.options
    .map((opt) => opt.long)
    .filter((value): value is string => Boolean(value));
  return new Set(longs);
};

const baseOptions = [
  "--environment-name",
  "--config",
  "--verbose",
  "--trace",
  "--quiet",
  "--json",
  "--log-file",
  "--non-interactive",
  "--what-if",
];

const withBase = (options: string[]): string[] => [...baseOptions, ...options];

describe("deploy commands", () => {
  const deploy = createDeployCommand();

  const specs: Array<{ path: string[]; expected: string[] }> = [
    { path: ["organizations", "get"], expected: withBase([]) },
    { path: ["organizations", "health"], expected: withBase([]) },
    { path: ["organizations", "license"], expected: withBase([]) },
    { path: ["organizations", "launch-demo"], expected: withBase([]) },
    { path: ["projects", "list"], expected: withBase([]) },
    { path: ["projects", "limitation"], expected: withBase([]) },
    { path: ["projects", "validate-name"], expected: withBase(["--name"]) },
    { path: ["projects", "get"], expected: withBase(["--id", "--name"]) },
    {
      path: ["projects", "create"],
      expected: withBase([
        "--name",
        "--repository-name",
        "--repository-id",
        "--source-control-integration-id",
      ]),
    },
    {
      path: ["projects", "update"],
      expected: withBase([
        "--id",
        "--name",
        "--new-name",
        "--repository-name",
        "--repository-id",
        "--source-control-integration-id",
      ]),
    },
    {
      path: ["projects", "link-repository"],
      expected: withBase([
        "--id",
        "--repository-name",
        "--repository-id",
        "--integration-id",
        "--repository-relative-path",
      ]),
    },
    { path: ["projects", "unlink-repository"], expected: withBase(["--id"]) },
    { path: ["projects", "delete"], expected: withBase(["--id", "--name", "--force"]) },
    {
      path: ["environments", "list"],
      expected: withBase(["--project", "--type"]),
    },
    { path: ["environments", "limitation"], expected: withBase([]) },
    {
      path: ["environments", "get"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "create"],
      expected: withBase(["--project", "--name", "--tenant-type", "--cm-only"]),
    },
    {
      path: ["environments", "get-edge-token"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "get-editing-secret"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "variables", "list"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "variables", "create"],
      expected: withBase([
        "--id",
        "--name",
        "--project",
        "--variable",
        "--value",
        "--target",
        "--secret",
      ]),
    },
    {
      path: ["environments", "variables", "delete"],
      expected: withBase(["--id", "--name", "--project", "--variable"]),
    },
    {
      path: ["environments", "deployments", "list"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "deployments", "create"],
      expected: withBase(["--id", "--name", "--project", "--redeploy"]),
    },
    {
      path: ["environments", "regenerate-context"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "promote"],
      expected: withBase([
        "--id",
        "--name",
        "--project",
        "--source-id",
        "--no-start",
        "--no-watch",
        "--wait-for-post-actions",
        "--timeout",
      ]),
    },
    {
      path: ["environments", "restart"],
      expected: withBase(["--id", "--name", "--project", "--force", "--status"]),
    },
    {
      path: ["environments", "link-repository"],
      expected: withBase([
        "--id",
        "--name",
        "--project",
        "--repository-name",
        "--repository-id",
        "--integration-id",
        "--repository-relative-path",
        "--repository-branch",
      ]),
    },
    {
      path: ["environments", "unlink-repository"],
      expected: withBase(["--id", "--name", "--project"]),
    },
    {
      path: ["environments", "delete"],
      expected: withBase(["--id", "--name", "--project", "--force"]),
    },
    { path: ["source-control", "list"], expected: withBase([]) },
    { path: ["source-control", "state"], expected: withBase([]) },
    { path: ["source-control", "access-token"], expected: withBase(["--id"]) },
    {
      path: ["source-control", "validate"],
      expected: withBase(["--id"]),
    },
    {
      path: ["source-control", "repository", "get"],
      expected: withBase(["--integration-id", "--repository-id"]),
    },
    {
      path: ["source-control", "repository", "branches"],
      expected: withBase(["--repository-name", "--integration-id"]),
    },
    {
      path: ["source-control", "repository", "validate"],
      expected: withBase(["--integration-id", "--repository-name"]),
    },
    {
      path: ["source-control", "repository", "create-from-template"],
      expected: withBase([
        "--provider",
        "--template-repository",
        "--template-owner",
        "--repository-name",
        "--owner",
        "--integration-id",
        "--description",
        "--private-repository",
        "--no-private-repository",
        "--include-all-branches",
        "--no-include-all-branches",
      ]),
    },
    { path: ["source-control", "providers"], expected: withBase([]) },
    { path: ["source-control", "templates"], expected: withBase(["--provider"]) },
    { path: ["source-control", "get"], expected: withBase(["--id"]) },
    { path: ["source-control", "delete"], expected: withBase(["--id"]) },
    {
      path: ["deployments", "list"],
      expected: withBase(["--status"]),
    },
    { path: ["deployments", "get"], expected: withBase(["--id"]) },
    { path: ["deployments", "status"], expected: withBase([]) },
    { path: ["deployments", "deploy"], expected: withBase(["--id"]) },
    { path: ["deployments", "cancel"], expected: withBase(["--id"]) },
    {
      path: ["deployments", "source"],
      expected: withBase(["--id", "--file", "--directory"]),
    },
    {
      path: ["deployments", "watch"],
      expected: withBase(["--id", "--wait-for-post-actions", "--timeout"]),
    },
    {
      path: ["deployments", "logs"],
      expected: withBase(["--id", "--output"]),
    },
    {
      path: ["logs", "list"],
      expected: withBase(["--id", "--name", "--project", "--latest"]),
    },
    {
      path: ["logs", "view"],
      expected: withBase(["--id", "--name", "--project", "--log"]),
    },
    {
      path: ["logs", "data"],
      expected: withBase(["--id", "--name", "--project", "--log", "--output"]),
    },
    {
      path: ["editing-host", "list"],
      expected: withBase(["--project"]),
    },
    {
      path: ["editing-host", "create"],
      expected: withBase(["--cm-environment-id", "--name"]),
    },
    {
      path: ["editing-host", "update"],
      expected: withBase(["--id", "--name"]),
    },
    {
      path: ["editing-host", "delete"],
      expected: withBase(["--id", "--force"]),
    },
    {
      path: ["editing-host", "deploy"],
      expected: withBase([
        "--id",
        "--redeploy",
        "--no-watch",
        "--wait-for-post-actions",
        "--timeout",
      ]),
    },
  ];

  it("registers all deploy subcommands with expected options", () => {
    for (const spec of specs) {
      const cmd = getCommand(deploy, spec.path);
      const options = getOptionLongs(cmd);
      for (const expected of spec.expected) {
        expect(options.has(expected)).toBe(true);
      }
    }
  });
});
