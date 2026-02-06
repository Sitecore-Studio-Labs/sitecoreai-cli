import readline from "node:readline";
import { Command } from "commander";
import { assertInteractive } from "../shared/prompt";
import { normalizeArgs } from "./shared";

type ShellEnvSnapshot = Record<string, string | undefined>;

type RunCli = (
  argv: string[],
  options?: { baseEnv?: ShellEnvSnapshot; skipBanner?: boolean; shellMode?: boolean }
) => Promise<void>;

const parseShellArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
};

const snapshotShellEnv = (): ShellEnvSnapshot => ({
  SITECOREAI_NON_INTERACTIVE: process.env.SITECOREAI_NON_INTERACTIVE,
  SITECOREAI_JSON: process.env.SITECOREAI_JSON,
  SITECOREAI_QUIET: process.env.SITECOREAI_QUIET,
  SITECOREAI_TRACE_HTTP: process.env.SITECOREAI_TRACE_HTTP,
});

const restoreShellEnv = (snapshot: ShellEnvSnapshot): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const shellHelp = (): void => {
  console.log("Interactive shell commands:");
  console.log("  exit | quit    Exit the shell");
  console.log("  help | ?       Show this help");
  console.log("  <command>      Run any scai command");
  console.log("");
  console.log("Examples:");
  console.log("  status");
  console.log("  init --environment-name demo --cm https://cm.example");
  console.log("  deploy projects list");
};

export const createShellCommand = (runCli: RunCli): Command => {
  const command = new Command("shell")
    .description("Start an interactive shell")
    .action(async () => {
      assertInteractive("Shell mode requires a TTY.", "Run without --non-interactive.");
      const envSnapshot = snapshotShellEnv();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "scai> ",
      });
      const closeShell = () => {
        rl.close();
      };
      rl.on("SIGINT", () => {
        rl.write("\n");
        closeShell();
      });
      rl.on("close", () => {
        console.log("Shell closed.");
      });

      rl.prompt();
      rl.on("line", (line) => {
        void (async () => {
          rl.pause();
          const trimmed = line.trim();
          if (!trimmed) {
            rl.resume();
            rl.prompt();
            return;
          }
          if (trimmed === "exit" || trimmed === "quit") {
            closeShell();
            return;
          }
          if (trimmed === "help" || trimmed === "?") {
            shellHelp();
            rl.resume();
            rl.prompt();
            return;
          }
          const inputArgs = parseShellArgs(trimmed);
          if (inputArgs.length === 0) {
            rl.resume();
            rl.prompt();
            return;
          }
          const [firstArg] = inputArgs;
          if (firstArg === "scai" || firstArg === "sitecoreai-deploy-sync") {
            inputArgs.shift();
          }
          if (inputArgs[0] === "shell") {
            console.log("Already in shell. Type 'exit' to leave.");
            rl.resume();
            rl.prompt();
            return;
          }
          restoreShellEnv(envSnapshot);
          await runCli(normalizeArgs(["node", "scai", ...inputArgs]), {
            baseEnv: envSnapshot,
            skipBanner: true,
            shellMode: true,
          });
          rl.resume();
          rl.prompt();
        })();
      });

      await new Promise<void>((resolve) => {
        rl.on("close", resolve);
      });
    });

  command.addHelpText("after", "\nExample:\n  $ scai shell\n  scai> status\n  scai> exit\n");
  return command;
};
