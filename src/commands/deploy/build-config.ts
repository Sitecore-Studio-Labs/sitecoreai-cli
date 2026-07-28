import { Command, Option } from "commander";
import { addConfigOption, addVerbosityOptions, addWhatIfOption } from "../shared";
import {
  DEFAULT_NODE_VERSION,
  DEFAULT_RENDERING_HOST_NAME,
  runDeployBuildConfig,
} from "@/deploy/tasks/build-config";

/**
 * `scai provision deploy build-config` — write/update `xmcloud.build.json`, the
 * XM Cloud Deploy build manifest. Pure file op (no API call): adds or updates a
 * rendering-host entry and merges into any existing file.
 */
export const createDeployBuildConfigCommand = (): Command => {
  const command = new Command("build-config").description(
    "Create or update xmcloud.build.json — the XM Cloud Deploy build manifest. Adds/updates a rendering-host entry; merges with an existing file."
  );

  command
    .addOption(
      new Option("--rendering-host <name>", "Rendering-host key to add/update.").default(
        DEFAULT_RENDERING_HOST_NAME
      )
    )
    .addOption(new Option("--secret <token>", "JSS deployment secret for the rendering host."))
    .addOption(new Option("--no-enabled", "Mark the rendering host disabled (default: enabled)."))
    .addOption(
      new Option("--node-version <version>", "Node version for the build host.").default(
        DEFAULT_NODE_VERSION
      )
    )
    .addOption(
      new Option("--host-path <path>", "Rendering-host path within the repo.").default("./")
    )
    .addOption(new Option("--type <type>", "Rendering-host type.").default("sxa"))
    .addOption(new Option("--install-command <cmd>", "Install command.").default("npm install"))
    .addOption(new Option("--build-command <cmd>", "Build command.").default("npm run build"))
    .addOption(new Option("--run-command <cmd>", "Run command.").default("next:start"))
    .addOption(
      new Option(
        "--remove-default",
        `Drop the OOTB '${DEFAULT_RENDERING_HOST_NAME}' host when adding a renamed one.`
      )
    )
    .addOption(
      new Option("-o, --output <path>", "Path to write. Defaults to ./xmcloud.build.json.")
    );

  addWhatIfOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  # Stub a manifest (fill the secret later from Cloud Portal)",
      "  $ scai provision deploy build-config --rendering-host my-host --enabled",
      "",
      "  # Full entry, replacing the OOTB default host",
      "  $ scai provision deploy build-config --rendering-host my-host \\",
      "      --secret <jss-secret> --remove-default",
      "",
      "  # Preview without writing",
      "  $ scai provision deploy build-config --rendering-host my-host --what-if",
      "",
    ].join("\n")
  );

  command.action(async (options) => {
    await runDeployBuildConfig(options);
  });
  return command;
};
