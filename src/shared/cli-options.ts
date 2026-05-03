/**
 * Neutral CLI option types shared across every command family
 * (serialization, deploy, recipe, env). Family-specific option
 * shapes live next to their tasks (`src/deploy/tasks/types.ts`,
 * `src/serialization/tasks/types.ts`, etc.) and extend `CommonOptions`.
 */

export type CommonOptions = {
  config?: string;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};
