import { Command } from "commander";
import { runDoctor } from "@/doctor";
import { addConfigOption, addVerbosityOptions } from "./shared";

export const createDoctorCommand = (): Command => {
  const command = new Command("doctor")
    .description(
      "Diagnose local config + credentials. Walks sitecoreai.cli.json, the OS keychain, and the Node runtime to surface what needs fixing before remote calls will work. Different from `scai cli health`, which probes the live tenant."
    )
    .option(
      "--strict",
      "Exit non-zero on any warning (not just failures). Useful in CI to enforce a clean baseline."
    );
  addConfigOption(command);
  addVerbosityOptions(command);

  command.action(async (options) => {
    await runDoctor(options);
  });

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai doctor                  # human-readable diagnostic table\n" +
      "  $ scai doctor --json           # machine-parseable envelope\n" +
      "  $ scai doctor --strict         # CI gate: fail on any warning\n"
  );

  return command;
};
