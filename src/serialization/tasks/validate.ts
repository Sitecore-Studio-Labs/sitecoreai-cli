import { loadFilesystemItems } from "../filesystem-store/items";
import { inputError, loadConfigAndModules, toLogger } from "./shared";
import type { CommonOptions } from "./types";

export const runValidate = async (options: CommonOptions & { fix?: boolean }): Promise<void> => {
  const logger = toLogger(options);
  const { modules } = await loadConfigAndModules(options);
  const subtrees = modules.flatMap((module) => module.items.includes);
  const { metadata } = await loadFilesystemItems(subtrees);
  const seenIds = new Set<string>();
  let hasErrors = false;
  let duplicateCount = 0;

  for (const item of metadata) {
    const id = item.id.toLowerCase();
    if (seenIds.has(id)) {
      logger.error(`Duplicate serialized item id detected: ${item.id}`);
      hasErrors = true;
      duplicateCount += 1;
      if (!options.fix) {
        continue;
      }
    }
    seenIds.add(id);
  }

  if (hasErrors) {
    if (logger.isJson()) {
      logger.json({
        command: "serialization.validate",
        duplicates: duplicateCount,
        fixed: Boolean(options.fix),
        hasErrors: true,
      });
    }
    throw inputError(
      options.fix
        ? "Unresolvable errors were detected. Review logs for details."
        : "Errors were detected, but no attempt was made to fix them. Pass --fix to attempt fixing."
    );
  }

  if (logger.isJson()) {
    logger.json({
      command: "serialization.validate",
      duplicates: 0,
      fixed: Boolean(options.fix),
      hasErrors: false,
    });
    return;
  }
  logger.info("No errors were detected.", "green");
};
