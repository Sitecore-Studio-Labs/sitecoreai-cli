import { createCliError } from "@/shared/errors";

export const isWildcard = (candidate: string): boolean => {
  if (candidate == null) {
    throw createCliError("Wildcard candidate is null or undefined.", "INPUT_INVALID");
  }

  return candidate.includes("*") || candidate.includes("?");
};

export const isWildcardMatch = (
  input: string,
  wildcards: string,
  caseSensitive = false
): boolean => {
  if (input == null) {
    throw createCliError("Input is null or undefined.", "INPUT_INVALID");
  }

  if (isWildcard(wildcards)) {
    const escaped = wildcards.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = "^" + escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$";
    const flags = caseSensitive ? "" : "i";
    return new RegExp(regex, flags).test(input);
  }

  return caseSensitive ? input === wildcards : input.toLowerCase() === wildcards.toLowerCase();
};
