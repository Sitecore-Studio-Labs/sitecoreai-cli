import fs from "node:fs";
import { Command, Option } from "commander";
import { assertCreateBriefInput } from "@/brief";
import { runBriefCreate } from "@/brief/tasks";
import { inputError } from "@/shared/cli-tasks";
import {
  addApplyOption,
  addConfigOption,
  addOrgScopeOptions,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

/**
 * `scai ops brief create` — create a brief instance from a JSON
 * document matching `CreateBriefInput`. Mirrors `brief types create`:
 * imperative one-shot, dry-runs by default, --apply to write.
 *
 * The JSON body matches the raw API shape:
 *   {
 *     "name":        "Q3 Launch Brief",
 *     "briefTypeId": "<uuid-from `brief types list`>",
 *     "locale":      "en-us",        // optional
 *     "fields":      { ... },        // optional, per-field shapes vary by brief type
 *     "isTemplate":  false           // optional
 *   }
 *
 * For a declarative (codename-based, idempotent) push, use
 * `scai ops brief sync push --kind brief --file <recipe>` instead.
 */
const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw inputError(
      `Could not read JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "Pass --file <path> pointing at a valid CreateBriefInput JSON document."
    );
  }
};

export const createBriefCreateCommand = (): Command => {
  const command = new Command("create")
    .description(
      "Create a brief instance from a CreateBriefInput JSON document. For declarative + idempotent pushes, use `brief sync push --kind brief`."
    )
    .addOption(
      new Option(
        "-f, --file <path>",
        "Path to a JSON file matching CreateBriefInput (name + briefTypeId, plus optional locale/fields/isTemplate)."
      ).makeOptionMandatory(true)
    );
  addOrgScopeOptions(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(
    withApplyGate(async (options: { file: string; apply?: boolean; whatIf?: boolean }) => {
      const input = assertCreateBriefInput(readJsonFile(options.file));
      await runBriefCreate({ ...options, input });
    })
  );
  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief create -f ./brief.json -n agents --apply\n" +
      "  $ scai ops brief create -f ./brief.json -n agents             # dry run\n"
  );
  return command;
};
