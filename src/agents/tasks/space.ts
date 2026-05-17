/**
 * `scai agents space …` — read and update Agentic Studio spaces (the
 * container a run executes in).
 *
 * A space has no list or delete endpoint, but its config and run
 * artifacts are readable and its config is writable — see `api/spaces.ts`.
 * `update` shallow-merges a patch file into the live config, so renaming
 * (`spaceName`) or changing agents / `globalContext` only needs the
 * changed keys.
 */
import { z } from "zod";
import { loadRecipe } from "@/sync";
import { getSpaceArtifacts, getSpaceConfig, updateSpaceConfig } from "../api/spaces";
import type { SpaceConfig } from "../api/schema";
import { prepare, renderItem, writeJson, type RunAgentsBaseOptions } from "./shared";

/** A space-config patch file — any object; merged onto the live config. */
const SpaceConfigPatchSchema = z.record(z.string(), z.unknown());

export const runSpaceGet = async (
  options: RunAgentsBaseOptions & { spaceId: string }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const config = await getSpaceConfig(session, options.spaceId);
  renderItem(logger, `space ${options.spaceId}`, config as unknown as Record<string, unknown>);
};

export const runSpaceArtifacts = async (
  options: RunAgentsBaseOptions & { spaceId: string }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const artifacts = await getSpaceArtifacts(session, options.spaceId);
  if (logger.isJson()) {
    writeJson(artifacts);
    return;
  }
  renderItem(logger, `space ${options.spaceId} artifacts`, artifacts);
};

export const runSpaceUpdate = async (
  options: RunAgentsBaseOptions & { spaceId: string; file: string; whatIf?: boolean }
): Promise<void> => {
  const { logger, session } = await prepare(options);
  const patch = loadRecipe(options.file, SpaceConfigPatchSchema);
  const current = await getSpaceConfig(session, options.spaceId);
  const merged = { ...current, ...patch } as SpaceConfig;
  if (options.whatIf) {
    const fields = Object.keys(patch).join(", ") || "(none)";
    if (logger.isJson())
      writeJson({ plan: { update: options.spaceId, fields: Object.keys(patch) } });
    else logger.info(`Would update space ${options.spaceId} — fields: ${fields}.`, "yellow");
    return;
  }
  await updateSpaceConfig(session, options.spaceId, merged);
  if (logger.isJson()) writeJson({ ok: true, updated: options.spaceId });
  else logger.info(`Updated space ${options.spaceId}.`, "green");
};
