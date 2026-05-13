const replaceAll = (value: string, pattern: RegExp, replacement: string): string =>
  value.replace(pattern, replacement);

export const redactSecrets = (value: string): string => {
  let output = value;
  output = replaceAll(output, /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer <redacted>");
  // Match both snake_case (access_token) and camelCase (accessToken) via
  // optional underscore. Case-insensitive flag covers PascalCase/UPPER.
  output = replaceAll(
    output,
    /(\b(access_?token|refresh_?token|client_?secret|client_?id|deploy_?token|password|token|secret)\b\s*[=:]\s*)([^&\s"]+)/gi,
    "$1<redacted>"
  );
  output = replaceAll(
    output,
    /("(?:access_?token|refresh_?token|client_?secret|client_?id|deploy_?token|password|token|secret)"\s*:\s*")([^"]+)/gi,
    "$1<redacted>"
  );
  return output;
};

const defaultSensitiveFlags = new Set([
  "--client-secret",
  "--password",
  "--deploy-token",
  "--access-token",
  "--refresh-token",
  "--token",
  "--body",
  "--body-file",
  "--username",
  "--client-id",
]);

export const redactArgs = (args: string[], sensitiveFlags = defaultSensitiveFlags): string[] => {
  const redacted = [...args];
  for (let index = 0; index < redacted.length; index += 1) {
    const entry = redacted[index];
    if (!entry.startsWith("--")) {
      continue;
    }
    const [flag, inlineValue] = entry.split("=", 2);
    if (!sensitiveFlags.has(flag)) {
      continue;
    }

    if (inlineValue !== undefined) {
      redacted[index] = `${flag}=<redacted>`;
      continue;
    }

    if (index + 1 < redacted.length) {
      redacted[index + 1] = "<redacted>";
      index += 1;
    }
  }

  return redacted;
};
