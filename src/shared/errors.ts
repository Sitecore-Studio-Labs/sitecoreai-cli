export type CliErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "INPUT_INVALID"
  | "AUTH_REQUIRED"
  | "NETWORK"
  | "ENV_NOT_FOUND"
  | "DEPLOY_FAILED"
  | "SITES_API_FAILED"
  | "UNKNOWN";

export class CliError extends Error {
  code: CliErrorCode;
  exitCode: number;
  hint?: string;
  details?: string[];

  constructor(
    message: string,
    options: {
      code?: CliErrorCode;
      exitCode?: number;
      hint?: string;
      details?: string[];
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? "UNKNOWN";
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const exitCodeFor = (code: CliErrorCode): number => {
  switch (code) {
    case "CONFIG_NOT_FOUND":
    case "CONFIG_INVALID":
    case "INPUT_INVALID":
      return 2;
    case "AUTH_REQUIRED":
      return 3;
    case "NETWORK":
      return 4;
    case "ENV_NOT_FOUND":
      return 5;
    case "DEPLOY_FAILED":
      return 6;
    case "SITES_API_FAILED":
      return 7;
    default:
      return 1;
  }
};

export const toCliError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError(message, { code: "UNKNOWN", exitCode: exitCodeFor("UNKNOWN") });
};

export const withHint = (error: CliError, hint: string): CliError =>
  new CliError(error.message, {
    code: error.code,
    exitCode: error.exitCode,
    hint,
    details: error.details,
  });

export const createCliError = (
  message: string,
  code: CliErrorCode,
  options: { hint?: string; details?: string[] } = {}
): CliError =>
  new CliError(message, {
    code,
    exitCode: exitCodeFor(code),
    hint: options.hint,
    details: options.details,
  });
