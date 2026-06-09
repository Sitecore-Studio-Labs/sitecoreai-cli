/**
 * Shared `--json` emission for the recipe sync verbs (`scai brand sync`,
 * `scai ops brief sync`, `scai ops campaign sync`).
 *
 * Under `--json` the Logger suppresses every text level and only
 * `logger.json()` reaches stdout — so the entire stdout of a sync
 * command becomes a single {@link ScaiEnvelope} the orchestrator can
 * `JSON.parse` wholesale, instead of regexing human prose. The envelope
 * `data` is a {@link SyncResult} (the typed contract). Guard every call
 * with `logger.isJson()` — `json()` writes to stdout unconditionally and
 * would corrupt normal text output otherwise.
 */
import { buildScaiEnvelope } from "@/shared/envelope";
import type { Logger } from "@/shared/logger";
import {
  buildPullResult,
  buildSyncResult,
  type KindRef,
  type PushOutcome,
  type ResolvedIdentity,
  type SyncMode,
} from "@/sync";

/** Emit the `SyncResult` envelope for a push or diff. No-op unless `--json`. */
export const emitPushResultJson = (params: {
  logger: Logger;
  command: string;
  environment: string | null | undefined;
  operation: "push" | "diff";
  kind: string;
  ref: KindRef;
  mode: SyncMode;
  outcome: PushOutcome;
}): void => {
  if (!params.logger.isJson()) return;
  const result = buildSyncResult({
    operation: params.operation,
    kind: params.kind,
    ref: params.ref,
    mode: params.mode,
    outcome: params.outcome,
  });
  const { create, update, delete: del, noop } = result.summary;
  params.logger.json(
    buildScaiEnvelope({
      command: params.command,
      environment: params.environment,
      data: result,
      extra: {
        ...(params.mode === "what-if" ? { whatIf: true } : {}),
        summary: `${create} create, ${update} update, ${del} delete, ${noop} unchanged`,
      },
    })
  );
};

/** Emit the `SyncResult` envelope for a pull. No-op unless `--json`. */
export const emitPullResultJson = (params: {
  logger: Logger;
  command: string;
  environment: string | null | undefined;
  kind: string;
  ref: KindRef;
  found: boolean;
  identities?: ResolvedIdentity[];
}): void => {
  if (!params.logger.isJson()) return;
  const result = buildPullResult({
    kind: params.kind,
    ref: params.ref,
    identities: params.identities,
  });
  params.logger.json(
    buildScaiEnvelope({
      command: params.command,
      environment: params.environment,
      data: result,
      // `found` distinguishes "pulled an existing instance" from "nothing
      // on the tenant" so the consumer reads it off the envelope rather
      // than inferring it from an empty recipe.
      extra: { found: params.found },
    })
  );
};
