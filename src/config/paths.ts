import path from "node:path";
import fs from "node:fs";
import { createCliError } from "../shared/errors";

export const resolveRootConfigurationPath = (currentPath: string): string => {
  const stat = fs.existsSync(currentPath) ? fs.statSync(currentPath) : null;
  const startDir = stat?.isFile() ? path.dirname(currentPath) : currentPath;

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
      hint: "Run 'scai init' to create a configuration file, or pass --config <path> (e.g. --config /path/to/project).",
    }
  );
};
