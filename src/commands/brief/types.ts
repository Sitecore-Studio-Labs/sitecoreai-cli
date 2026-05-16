import fs from "node:fs";
import { Command, Option } from "commander";
import {
  runBriefTypeCreate,
  runBriefTypeDelete,
  runBriefTypeGet,
  runBriefTypeUpdate,
  runBriefTypes,
} from "@/brief/tasks";
import type { CreateBriefTypeInput } from "@/brief/api/brief-types";
import { confirmDestructive, inputError } from "@/shared/cli-tasks";
import {
  addApplyOption,
  addConfigOption,
  addEnvironmentOption,
  addVerbosityOptions,
  addWhatIfOption,
  withApplyGate,
} from "../shared";

const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw inputError(
      `Could not read JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "Pass --file <path> pointing at a valid CreateBriefTypeInput JSON document."
    );
  }
};

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const validateInput = (value: unknown): CreateBriefTypeInput => {
  if (!value || typeof value !== "object") {
    throw inputError("Brief type body must be a JSON object.");
  }
  const obj = value as Record<string, unknown>;
  const missing: string[] = [];
  for (const key of ["name", "label", "description", "icon", "iconColor", "fields"] as const) {
    if (obj[key] === undefined) missing.push(key);
  }
  if (missing.length > 0) {
    throw inputError(
      `Brief type body is missing required fields: ${missing.join(", ")}.`,
      "Required: name, label, description, icon, iconColor, fields."
    );
  }
  if (typeof obj.name !== "string" || !NAME_PATTERN.test(obj.name)) {
    throw inputError(
      `Invalid 'name': ${JSON.stringify(obj.name)}.`,
      "Server requires name to match /^[A-Za-z][A-Za-z0-9_]*$/."
    );
  }
  if (!Array.isArray(obj.fields)) {
    throw inputError("'fields' must be an array (use [] for none).");
  }
  return obj as unknown as CreateBriefTypeInput;
};

const createListCommand = (): Command => {
  const command = new Command("list").description(
    "List brief types — the schema templates that briefs are built against."
  );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options) => {
    await runBriefTypes(options);
  });
  return command;
};

const createGetCommand = (): Command => {
  const command = new Command("get")
    .description("Read a single brief type by id.")
    .argument("<briefTypeId>", "Brief type UUID");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (briefTypeId, options) => {
    await runBriefTypeGet({ ...options, briefTypeId });
  });
  return command;
};

const createCreateCommand = (): Command => {
  const command = new Command("create")
    .description("Create a new brief type from a JSON document.")
    .addOption(
      new Option("-f, --file <path>", "Path to a JSON file matching CreateBriefTypeInput").makeOptionMandatory(true)
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(
    withApplyGate(async (options: { file: string; apply?: boolean; whatIf?: boolean }) => {
      const input = validateInput(readJsonFile(options.file));
      await runBriefTypeCreate({ ...options, input });
    })
  );
  return command;
};

const createUpdateCommand = (): Command => {
  const command = new Command("update")
    .description(
      "Replace a brief type via PUT (full-replacement). Read first if you only want to change one field."
    )
    .argument("<briefTypeId>", "Brief type UUID")
    .addOption(
      new Option("-f, --file <path>", "Path to a JSON file matching CreateBriefTypeInput").makeOptionMandatory(true)
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefTypeId, options) => {
    await withApplyGate(
      async (opts: { file: string; apply?: boolean; whatIf?: boolean }) => {
        const input = validateInput(readJsonFile(opts.file));
        await runBriefTypeUpdate({ ...opts, briefTypeId, input });
      }
    )(options);
  });
  return command;
};

const createDeleteCommand = (): Command => {
  const command = new Command("delete")
    .description("Delete a brief type. Requires --apply; non-TTY callers must also pass --force.")
    .argument("<briefTypeId>", "Brief type UUID")
    .addOption(new Option("--force", "Skip TTY confirmation prompt (required for non-TTY agents)."));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  addApplyOption(command);
  addWhatIfOption(command);
  command.action(async (briefTypeId, options) => {
    await withApplyGate(
      async (opts: { force?: boolean; apply?: boolean; whatIf?: boolean }) => {
        if (!opts.whatIf) {
          const confirmed = await confirmDestructive(
            `Delete brief type ${briefTypeId}? This cannot be undone.`,
            opts.force
          );
          if (!confirmed) {
            process.stderr.write("Aborted.\n");
            return;
          }
        }
        await runBriefTypeDelete({ ...opts, briefTypeId });
      }
    )(options);
  });
  return command;
};

/**
 * `scai ops brief types …` — full CRUD over Sitecore Content Operations
 * Brief types (the schema templates briefs are built against).
 *
 * v1 surface (verified 2026-05-15):
 *   - list                     — list types in the tenant
 *   - get <briefTypeId>        — read one type
 *   - create -f <file>         — POST new type (requires --apply)
 *   - update <id> -f <file>    — PUT-replace type (requires --apply)
 *   - delete <id>              — DELETE type (requires --apply; --force for non-TTY)
 *
 * Backward compat: `scai ops brief types` with no subcommand still lists,
 * matching the pre-CRUD behaviour.
 */
export const createBriefTypesCommand = (): Command => {
  const command = new Command("types").description(
    "Brief type operations (list, get, create, update, delete)."
  );

  command.addCommand(createListCommand(), { isDefault: true });
  command.addCommand(createGetCommand());
  command.addCommand(createCreateCommand());
  command.addCommand(createUpdateCommand());
  command.addCommand(createDeleteCommand());

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai ops brief types list -n agents\n" +
      "  $ scai ops brief types get <id> -n agents\n" +
      "  $ scai ops brief types create -f ./new-type.json -n agents --apply\n" +
      "  $ scai ops brief types update <id> -f ./type.json -n agents --apply\n" +
      "  $ scai ops brief types delete <id> -n agents --apply --force\n"
  );

  return command;
};
