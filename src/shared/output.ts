export type OutputOptions = {
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

const readFlagValue = (argv: string[], name: string): string | undefined => {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const index = argv.findIndex((arg) => arg === name);
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return undefined;
};

export const resolveOutputOptionsFromArgs = (argv: string[]): OutputOptions => {
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet") || argv.includes("-q");
  const logFile = readFlagValue(argv, "--log-file");
  return { json, quiet, logFile };
};
