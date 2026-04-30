import fs from "node:fs";
import path from "node:path";

export const SCHEMA_BASE_URL = "https://schemas.sitecoreai.dev/v1";

export const DEFAULT_CONFIG = {
  $schema: `${SCHEMA_BASE_URL}/sitecoreai.cli.json`,
  modules: ["./**/*.module.json"],
  recipes: ["recipes/**/*.recipe.ts"],
  serialization: {
    defaultMaxRelativeItemPathLength: 120,
    defaultModuleRelativeSerializationPath: "serialization",
    removeOrphansForRoles: true,
    removeOrphansForUsers: true,
    continueOnItemFailure: false,
    excludedFields: [],
  },
  settings: {
    cacheAuthenticationToken: true,
    versionComparisonEnabled: true,
    apiClientTimeoutInMinutes: 5,
  },
  envProfiles: {},
};

export const resolveTargetPath = (value?: string): string => {
  const target = value ? path.resolve(value) : process.cwd();
  return path.extname(target) === ".json" ? target : path.join(target, "sitecoreai.cli.json");
};

export const writeConfigTemplate = (targetPath: string): void => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
};
