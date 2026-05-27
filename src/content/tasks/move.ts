/**
 * `scai content move` — relocate a Sitecore item to a new parent.
 *
 * Uses the Authoring GraphQL `moveItem` mutation, which preserves the
 * item's `itemId`, name, and every inbound reference. The alternative
 * (delete + recreate) assigns a new itemId, breaking every link, and
 * is the only path scai had before this verb landed.
 *
 * Honours `--what-if` (preview without writing) and `--allow-write`
 * (the standard env-level gate). The mutation itself isn't
 * classified `destructive` in `policy/operations.ts` — moves are
 * recoverable (move back to the original parent) and preserve
 * inbound refs by design.
 */

import { createAuthoringClient } from "@/authoring";
import type { Logger } from "@/shared/logger";
import { Logger as LoggerClass } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import { ensureAllowWrite } from "@/policy/allow-write";
import { resolveEnvironment } from "@/policy/environment";

export interface RunContentMoveOptions {
  config?: string;
  environmentName?: string;
  /** Source selector — pass exactly one of itemId / path. */
  itemId?: string;
  path?: string;
  /** Destination parent — pass exactly one of toItemId / toPath. */
  toItemId?: string;
  toPath?: string;

  whatIf?: boolean;
  allowWrite?: boolean;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

export interface ContentMoveResult {
  itemId?: string;
  path?: string;
  targetParent: { itemId?: string; path?: string };
  status: "would-move" | "moved";
}

const buildLogger = (options: RunContentMoveOptions): Logger =>
  new LoggerClass(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const requireExactlyOne = (
  a: string | undefined,
  b: string | undefined,
  label: string,
  flags: [string, string]
): void => {
  if (a && b) {
    throw createScaiError(
      `${label}: pass exactly one of ${flags[0]} / ${flags[1]}.`,
      "INPUT_INVALID"
    );
  }
  if (!a && !b) {
    throw createScaiError(`${label}: pass one of ${flags[0]} / ${flags[1]}.`, "INPUT_INVALID");
  }
};

export const runContentMove = async (
  options: RunContentMoveOptions
): Promise<ContentMoveResult> => {
  const logger = buildLogger(options);
  requireExactlyOne(options.itemId, options.path, "source", ["--item-id", "--path"]);
  requireExactlyOne(options.toItemId, options.toPath, "target", ["--to-item-id", "--to-path"]);

  const { environment, root, envName } = resolveEnvironment(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  }

  const client = createAuthoringClient({ environment });
  const sourceSelector = options.itemId ? { itemId: options.itemId } : { path: options.path! };
  const targetParent = options.toItemId ? { itemId: options.toItemId } : { path: options.toPath! };

  // Pre-flight: confirm both refs resolve. The Authoring API would
  // also refuse on a missing ref, but its error is a generic GraphQL
  // failure — a typed INPUT_INVALID up front gives the operator a
  // clearer "you mistyped X" without a wire round trip.
  const [sourceItem, targetItem] = await Promise.all([
    client.getItem(sourceSelector),
    client.getItem(targetParent),
  ]);
  if (!sourceItem) {
    throw createScaiError(
      `Source item '${options.itemId ?? options.path}' not found.`,
      "INPUT_INVALID"
    );
  }
  if (!targetItem) {
    throw createScaiError(
      `Target parent '${options.toItemId ?? options.toPath}' not found.`,
      "INPUT_INVALID"
    );
  }

  const summary: ContentMoveResult = {
    itemId: sourceItem.itemId,
    path: sourceItem.path,
    targetParent: { itemId: targetItem.itemId, path: targetItem.path },
    status: options.whatIf ? "would-move" : "moved",
  };

  const writeEnvelope = (): void => {
    const envelope = buildScaiEnvelope({
      command: "content.move",
      environment: envName,
      data: summary,
      extra: options.whatIf ? { whatIf: true } : undefined,
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  };

  if (options.whatIf) {
    if (logger.isJson()) {
      writeEnvelope();
    } else {
      logger.info(
        `Would move ${sourceItem.path ?? sourceItem.itemId} → child of ${targetItem.path ?? targetItem.itemId}.`,
        "yellow"
      );
    }
    return summary;
  }

  await client.moveItem({ selector: sourceSelector, targetParent });

  if (logger.isJson()) {
    writeEnvelope();
  } else {
    logger.info(
      `Moved ${sourceItem.path ?? sourceItem.itemId} → child of ${targetItem.path ?? targetItem.itemId}.`,
      "green"
    );
  }
  return summary;
};
