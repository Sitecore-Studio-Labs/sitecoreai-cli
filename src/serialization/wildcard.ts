export const isWildcard = (candidate: string): boolean => {
  if (candidate == null) {
    throw new Error("Wildcard candidate is null or undefined.");
  }

  return candidate.includes("*") || candidate.includes("?");
};

export const isWildcardMatch = (
  input: string,
  wildcards: string,
  caseSensitive = false
): boolean => {
  if (input == null) {
    throw new Error("Input is null or undefined.");
  }

  if (isWildcard(wildcards)) {
    const escaped = wildcards.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = "^" + escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$";
    const flags = caseSensitive ? "" : "i";
    return new RegExp(regex, flags).test(input);
  }

  return caseSensitive ? input === wildcards : input.toLowerCase() === wildcards.toLowerCase();
};
