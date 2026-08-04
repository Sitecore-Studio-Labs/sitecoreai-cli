import fs from "node:fs";
import AjvDraft4 from "ajv-draft-04";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import schema from "./schema.json" with { type: "json" };
import serializationModuleSchema from "./serialization-module.schema.json" with { type: "json" };

const ajv = new AjvDraft4({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addFormat("uri", {
  validate: (value: string): boolean => {
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
    if (value.startsWith("http://") || value.startsWith("https://")) {
      try {
        const parsed = new URL(value);
        return Boolean(parsed.protocol && parsed.hostname);
      } catch {
        return false;
      }
    }
    return /^[a-z0-9.-]+$/i.test(value);
  },
});

export const validateRootConfig = ajv.compile(schema);
export const validateModuleConfig = ajv.compile(serializationModuleSchema);

export const formatValidationErrors = (errors: ErrorObject[]): string[] =>
  errors.map((error) => {
    const path = error.instancePath ? error.instancePath : "(root)";
    const suffix = error.message ? `: ${error.message}` : "";
    return `${path}${suffix}`;
  });

export const readJsonFile = <T>(filePath: string): T => {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as T;
};
