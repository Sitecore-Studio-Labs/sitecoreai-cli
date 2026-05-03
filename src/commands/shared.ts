import { Command, Option } from "commander";

const splitComma = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const collectList = (value: string, previous: string[] = []): string[] =>
  previous.concat(splitComma(value));

export const normalizeArgs = (argv: string[]): string[] =>
  argv.map((arg) => {
    if (arg === "-fr") {
      return "--force";
    }
    if (arg === "--env" || arg === "--env-name") {
      return "--environment-name";
    }
    if (arg === "-q") {
      return "--quiet";
    }
    return arg;
  });

export const addConfigOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "-c, --config <path>",
      "Path to a sitecoreai.cli.json file, or a directory containing one (walks up if not in the dir itself)."
    ).default(process.cwd())
  );

export const addEnvironmentOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "-n, --environment-name <name>",
      "Config environment name from sitecoreai.cli.json (alias: --env-name)"
    )
  );

export const addVerbosityOptions = (command: Command): Command =>
  command
    .addOption(new Option("-v, --verbose", "Write some additional diagnostic and performance data"))
    .addOption(new Option("-t, --trace", "Write more additional diagnostic and performance data"))
    .addOption(new Option("-q, --quiet", "Suppress non-error output"))
    .addOption(new Option("--json", "Output machine-readable JSON"))
    .addOption(new Option("--log-file <path>", "Write logs to a file"))
    .addOption(new Option("--non-interactive", "Disable prompts and require explicit input"));

export const addAllowWriteOption = (command: Command): Command =>
  command.option(
    "--allow-write",
    "Allow write operations for this command without updating config"
  );

export const addIncludeExcludeOptions = (command: Command): Command =>
  command
    .option(
      "-i, --include <value>",
      "Module configurations to include. Wildcards and multiple values are allowed",
      collectList,
      []
    )
    .option(
      "-e, --exclude <value>",
      "Module configurations to explicitly exclude. Wildcards and multiple values are allowed",
      collectList,
      []
    );

export const addWhatIfOption = (command: Command): Command =>
  command.option("-w, --what-if", "Lists commands that would be executed, without executing them");

export const addSkipValidationOption = (command: Command): Command =>
  command.option("-s, --skip-validation", "Skips filesystem integrity validation prior to syncing");

export const addForceOption = (command: Command): Command =>
  command.option("--force", "Perform force sync. In case you have invalid includes");

export const addUseDebugSignaturesOption = (command: Command): Command =>
  command.option(
    "--use-debug-signatures",
    "Use debug (un-hashed) item signatures to diagnose hash mismatches. Much slower"
  );

export const addPublishOptions = (command: Command): Command =>
  command
    .option(
      "-p, --publish",
      "Publish synced items. Not recommended to use with Publishing Service due to performance drop"
    )
    .option(
      "--targets, --pt <value>",
      "Comma separated list of targets database to publish. Blank publishes to the default publishing target (first one in the list)",
      collectList,
      []
    );

export const addSkipPullOption = (command: Command): Command =>
  command.option("-s, --skip-pull", "Skips pulling data from Sitecore before starting the watcher");

export const addAllowFileChangesOption = (command: Command): Command =>
  command.option(
    "--allow-file-changes",
    "Don't stop watch if files change. May result in tree corruption if underlying state is changed; use only if some other program is touching serialized files that are not changing"
  );

export const addExplainOptions = (command: Command): Command =>
  command
    .option("-p, --path <path>", "Item path to explain")
    .option("-d, --database <database>", "Database of the item path to explain (default: master)");

export const addDiffOptions = (command: Command): Command =>
  command
    .option("-s, --source <name>", "Named Sitecore endpoint to use as a source for comparison")
    .option(
      "-d, --destination <name>",
      "Named Sitecore endpoint to use as a destination for comparison"
    )
    .option("-p, --path <path>", "Item path to compare (instead of include/exclude)")
    .option("--source-database <database>", "Source database (when used with --path)")
    .option("--destination-database <database>", "Destination database (when used with --path)")
    .option("--push", "Applies the differences detected to the destination (diff + push)");

export const addValidateOptions = (command: Command): Command =>
  command.option(
    "-f, --fix",
    "Execute possible fix operations when validating the serialized items"
  );

export const addPackageCreateOptions = (command: Command): Command =>
  command
    .option(
      "-o, --output <path>",
      "Package path to output (will have extension added if not provided)"
    )
    .option("--overwrite", "Allow overwriting an existing package");

export const addPackageInstallOptions = (command: Command): Command =>
  command
    .option("-f, --package <path>", "Package path to install from")
    .option(
      "--authority, --auth <url>",
      "Identity authority for the environment, i.e. identity server or AAD tenant URL"
    )
    .option("--cm <url>", "Sitecore content management hostname to connect to")
    .option(
      "--client-id <id>",
      "The OAuth ClientID to send. Defaults to 'Device' for device auth, and 'SitecoreCLIServer' for client credentials"
    )
    .option(
      "--client-secret <secret>",
      "The OAuth client secret to send. Only used for client credentials authentication"
    );
