/**
 * `scai capabilities` — the contract handshake.
 *
 * The orchestrator spawns this ONCE at startup, validates
 * `contractVersion`, and gates behaviour on the advertised `features`
 * set — replacing the scatter of `SCAI_HAS_*` env booleans it used to
 * probe (each a guess about which scai build it was talking to). A
 * version it doesn't recognize is a loud, fail-fast error on its side,
 * never a silent degrade.
 *
 * Read-only, credential-free, fast: it answers from compiled-in
 * constants, makes no network or auth calls, and is on the auto-wizard
 * skip list so it never triggers setup/login.
 */
import packageJson from "../../package.json";

import { Command } from "commander";
import { addVerbosityOptions } from "./shared";
import { toLogger } from "@/shared/cli-tasks";
import { buildScaiEnvelope } from "@/shared/envelope";
import {
  SYNC_CONFLICT_POLICIES,
  SYNC_CONTRACT_KINDS,
  SYNC_CONTRACT_VERSION,
  SYNC_FEATURES,
  type SyncCapabilities,
} from "@/sync";

const buildCapabilities = (): SyncCapabilities => ({
  contractVersion: SYNC_CONTRACT_VERSION,
  scaiVersion: packageJson.version,
  features: [...SYNC_FEATURES],
  kinds: [...SYNC_CONTRACT_KINDS],
  conflictPolicies: {
    push: [...SYNC_CONFLICT_POLICIES.push],
    pull: [...SYNC_CONFLICT_POLICIES.pull],
  },
});

export const createCapabilitiesCommand = (): Command => {
  const command = new Command("capabilities").description(
    "Print the scai ↔ orchestrator sync contract version, features, and supported kinds (handshake)."
  );
  addVerbosityOptions(command);
  command.action((options: { json?: boolean; quiet?: boolean; logFile?: string }) => {
    const logger = toLogger(options);
    const capabilities = buildCapabilities();
    if (logger.isJson()) {
      logger.json(
        buildScaiEnvelope({
          command: "capabilities",
          environment: null,
          data: capabilities,
          extra: { summary: `sync contract v${capabilities.contractVersion}` },
        })
      );
      return;
    }
    logger.info(`scai ${capabilities.scaiVersion}`, "cyan");
    logger.info(`Sync contract version: ${capabilities.contractVersion}`);
    logger.info(`Features: ${capabilities.features.join(", ")}`);
    logger.info(`Kinds: ${capabilities.kinds.join(", ")}`);
    logger.info(`Push policies: ${capabilities.conflictPolicies.push.join(", ")}`);
    logger.info(`Pull policies: ${capabilities.conflictPolicies.pull.join(", ")}`);
  });
  return command;
};
