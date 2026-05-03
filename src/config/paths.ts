import path from "node:path";
import fs from "node:fs";
import { createCliError } from "../shared/errors";

export const resolveRootConfigurationPath = (currentPath: string): string => {
  const stat = fs.existsSync(currentPath) ? fs.statSync(currentPath) : null;

  // `--config <file>`: use the file directly. Lets users keep multiple
  // configs side-by-side (sitecoreai.dev.json, sitecoreai.staging.json)
  // and pick one per invocation. The file doesn't need to be named
  // `sitecoreai.cli.json` — the schema is what matters, not the name.
  if (stat?.isFile()) {
    return path.resolve(currentPath);
  }

  // `--config <dir>` (or no flag): walk upward looking for the
  // standard `sitecoreai.cli.json` filename.
  const startDir = currentPath;

  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "sitecoreai.cli.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  const cwd = process.cwd();
  throw createCliError(
    `Couldn't resolve a root configuration file (sitecoreai.cli.json) from ${cwd} or any parent directory.`,
    "CONFIG_NOT_FOUND",
    {
      hint: "Run 'scai init' to create a configuration file, or pass --config <path> to a directory or a config file.",
    }
  );
};
