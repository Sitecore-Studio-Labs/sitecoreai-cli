import fs from "node:fs/promises";
import YAML from "yaml";
import { ItemPath } from "./item-path";
import {
  ItemData,
  ItemFieldValue,
  ItemLanguage,
  ItemVersion,
  RoleData,
  UserData,
  ProfileProperty,
} from "./types";
import { createDataSignatureBase, createSignature } from "./signature";

class YamlWriter {
  private static indentSpaces = 2;
  private indent = 0;
  private readonly chunks: string[] = [];

  writeBeginNewDocument(): void {
    this.chunks.push("---\n");
  }

  increaseIndent(): void {
    this.indent += YamlWriter.indentSpaces;
  }

  decreaseIndent(): void {
    this.indent = Math.max(0, this.indent - YamlWriter.indentSpaces);
  }

  writeMap(key: string, value?: string): void {
    const prefix = " ".repeat(this.indent);
    if (value === undefined) {
      this.chunks.push(`${prefix}${key}:\n`);
      return;
    }

    if (
      value.includes("\n") ||
      value.includes("\r") ||
      value.includes('"') ||
      value.includes("\\")
    ) {
      this.chunks.push(`${prefix}${key}: |\n`);
      const indented = value
        .split(/\r\n|\r|\n/)
        .map((line) => " ".repeat(this.indent + YamlWriter.indentSpaces) + line)
        .join("\n");
      this.chunks.push(indented + "\n");
      return;
    }

    const specialChars = ['"', ":", "[", "]", "{", "}", "!", "?", "-", "\\"];
    const encoded = specialChars.some((char) => value.includes(char))
      ? `"${value.replace(/"/g, '\\"')}"`
      : value;
    this.chunks.push(`${prefix}${key}: ${encoded}\n`);
  }

  writeBeginListItem(key: string, value: string): void {
    if (this.indent < YamlWriter.indentSpaces) {
      throw new Error("Indent is at minimum. You must indent to support a list.");
    }
    const prefix = " ".repeat(this.indent - YamlWriter.indentSpaces);
    this.chunks.push(`${prefix}- ${key}: ${value}\n`);
  }

  toString(): string {
    return this.chunks.join("");
  }
}

const normalizeField = (field: Partial<ItemFieldValue>): ItemFieldValue => ({
  fieldId: field.fieldId ?? "",
  nameHint: field.nameHint,
  value: field.value ?? "",
  blobId: field.blobId ?? null,
});

const parseItemFields = (fields: unknown): ItemFieldValue[] => {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map((entry) =>
    normalizeField({
      fieldId: String((entry as Record<string, unknown>)["ID"] ?? ""),
      nameHint: (entry as Record<string, unknown>)["Hint"] as string | undefined,
      value: String((entry as Record<string, unknown>)["Value"] ?? ""),
      blobId: (entry as Record<string, unknown>)["BlobID"] as string | undefined,
    })
  );
};

const parseLanguages = (
  languages: unknown
): { unversioned: ItemLanguage[]; versions: ItemVersion[] } => {
  if (!Array.isArray(languages)) {
    return { unversioned: [], versions: [] };
  }

  const unversioned: ItemLanguage[] = [];
  const versions: ItemVersion[] = [];

  for (const entry of languages) {
    const language = String((entry as Record<string, unknown>)["Language"] ?? "");
    const fields = parseItemFields((entry as Record<string, unknown>)["Fields"]);
    if (fields.length > 0) {
      unversioned.push({ language, fields });
    }

    const versionEntries = (entry as Record<string, unknown>)["Versions"];
    if (Array.isArray(versionEntries)) {
      for (const versionEntry of versionEntries) {
        const versionNumber = Number((versionEntry as Record<string, unknown>)["Version"] ?? 0);
        const versionFields = parseItemFields((versionEntry as Record<string, unknown>)["Fields"]);
        versions.push({ language, version: versionNumber, fields: versionFields });
      }
    }
  }

  return { unversioned, versions };
};

export const readItemYamlFromString = (content: string): ItemData => {
  const doc = YAML.parse(content) as Record<string, unknown>;
  const id = String(doc["ID"] ?? "");
  const parentId = String(doc["Parent"] ?? "");
  const templateId = String(doc["Template"] ?? "");
  const pathValue = String(doc["Path"] ?? "");
  const branchId = doc["BranchID"] ? String(doc["BranchID"]) : null;
  const sharedFields = parseItemFields(doc["SharedFields"]);
  const { unversioned, versions } = parseLanguages(doc["Languages"]);
  const database = doc["DB"] ? String(doc["DB"]) : undefined;

  const itemPath = ItemPath.fromPathString(pathValue);
  const item: ItemData = {
    id,
    parentId,
    templateId,
    path: itemPath,
    dataSignature: "",
    name: itemPath.itemName ?? "",
    database,
    branchId,
    sharedFields,
    unversionedFields: unversioned,
    versions,
  };

  const signatureBase = createDataSignatureBase(item);
  item.dataSignature = createSignature(signatureBase) ?? "";

  return item;
};

export const readItemYaml = async (filePath: string): Promise<ItemData> => {
  const content = await fs.readFile(filePath, "utf8");
  return readItemYamlFromString(content);
};

export const writeItemYaml = (item: ItemData): string => {
  const writer = new YamlWriter();
  writer.writeBeginNewDocument();
  writer.writeMap("ID", item.id);
  writer.writeMap("Parent", item.parentId);
  writer.writeMap("Template", item.templateId);
  writer.writeMap("Path", item.path.toPathString());

  if (item.branchId) {
    writer.writeMap("BranchID", item.branchId);
  }

  if (item.sharedFields.length > 0) {
    writer.writeMap("SharedFields");
    writer.increaseIndent();
    const fields = [...item.sharedFields].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
    for (const field of fields) {
      writer.writeBeginListItem("ID", field.fieldId);
      writer.writeMap("Hint", field.nameHint ?? undefined);
      if (field.blobId) {
        writer.writeMap("BlobID", field.blobId);
      }
      writer.writeMap("Value", field.value ?? "");
    }
    writer.decreaseIndent();
  }

  if (item.unversionedFields.length > 0 || item.versions.length > 0) {
    writer.writeMap("Languages");
    writer.increaseIndent();
    const languages = [...item.unversionedFields].map((language) => language.language);
    for (const version of item.versions) {
      if (!languages.includes(version.language)) {
        languages.push(version.language);
      }
    }
    languages.sort((a, b) => a.localeCompare(b));

    for (const language of languages) {
      const unversioned = item.unversionedFields.find((entry) => entry.language === language);
      const languageVersions = item.versions
        .filter((entry) => entry.language === language)
        .sort((a, b) => a.version - b.version);

      writer.writeBeginListItem("Language", language);

      if (unversioned && unversioned.fields.length > 0) {
        writer.writeMap("Fields");
        writer.increaseIndent();
        for (const field of unversioned.fields.sort((a, b) => a.fieldId.localeCompare(b.fieldId))) {
          writer.writeBeginListItem("ID", field.fieldId);
          if (field.nameHint) {
            writer.writeMap("Hint", field.nameHint);
          }
          if (field.blobId) {
            writer.writeMap("BlobID", field.blobId);
          }
          writer.writeMap("Value", field.value ?? "");
        }
        writer.decreaseIndent();
      }

      writer.writeMap("Versions");
      writer.increaseIndent();
      for (const version of languageVersions) {
        writer.writeBeginListItem("Version", version.version.toString());
        if (version.fields.length > 0) {
          writer.writeMap("Fields");
          writer.increaseIndent();
          for (const field of version.fields.sort((a, b) => a.fieldId.localeCompare(b.fieldId))) {
            writer.writeBeginListItem("ID", field.fieldId);
            if (field.nameHint) {
              writer.writeMap("Hint", field.nameHint);
            }
            if (field.blobId) {
              writer.writeMap("BlobID", field.blobId);
            }
            writer.writeMap("Value", field.value ?? "");
          }
          writer.decreaseIndent();
        }
      }
      writer.decreaseIndent();
    }
    writer.decreaseIndent();
  }

  if (item.database) {
    writer.writeMap("DB", item.database);
  }

  return writer.toString();
};

export const writeRoleYaml = (role: RoleData): string => {
  const writer = new YamlWriter();
  writer.writeBeginNewDocument();
  writer.writeMap("Role", role.roleName);

  if (role.memberOfRoles.length > 0) {
    writer.writeMap("MemberOf");
    writer.increaseIndent();
    for (const member of role.memberOfRoles) {
      writer.writeBeginListItem("Role", member);
    }
    writer.decreaseIndent();
  }

  return writer.toString();
};

export const readRoleYamlFromString = (content: string, serializedItemId?: string): RoleData => {
  const doc = YAML.parse(content) as Record<string, unknown>;
  const roleName = String(doc["Role"] ?? "");
  const memberOf = Array.isArray(doc["MemberOf"])
    ? doc["MemberOf"].map((entry) =>
        String((entry as Record<string, unknown>)["Role"] ?? entry ?? "")
      )
    : [];

  return { roleName, memberOfRoles: memberOf, serializedItemId };
};

export const readUserYamlFromString = (content: string, serializedItemId?: string): UserData => {
  const doc = YAML.parse(content) as Record<string, unknown>;
  const roles = Array.isArray(doc["Roles"])
    ? doc["Roles"].map((entry) =>
        String((entry as Record<string, unknown>)["MemberOf"] ?? entry ?? "")
      )
    : [];

  const properties: ProfileProperty[] = [];
  if (Array.isArray(doc["Properties"])) {
    for (const entry of doc["Properties"]) {
      const record = entry as Record<string, unknown>;
      properties.push({
        name: String(record["Key"] ?? ""),
        content: String(record["Value"] ?? ""),
        contentType: String(record["ValueType"] ?? ""),
        isCustomProperty: Boolean(record["IsCustomProperty"]),
      });
    }
  }

  return {
    userName: String(doc["UserName"] ?? ""),
    email: doc["Email"] ? String(doc["Email"]) : undefined,
    comment: doc["Comment"] ? String(doc["Comment"]) : undefined,
    creationDate: String(doc["Created"] ?? ""),
    isApproved: String(doc["IsApproved"] ?? "false").toLowerCase() === "true",
    roles,
    profileProperties: properties,
    serializedItemId,
  };
};

export const writeUserYaml = (user: UserData): string => {
  const writer = new YamlWriter();
  writer.writeBeginNewDocument();
  writer.writeMap("UserName", user.userName);
  if (user.email) {
    writer.writeMap("Email", user.email);
  }
  if (user.comment) {
    writer.writeMap("Comment", user.comment);
  }
  writer.writeMap("Created", user.creationDate);
  writer.writeMap("IsApproved", user.isApproved ? "true" : "false");

  if (user.profileProperties.length > 0) {
    writer.writeMap("Properties");
    writer.increaseIndent();
    for (const property of user.profileProperties) {
      writer.writeBeginListItem("Key", property.name);
      writer.writeMap("Value", property.content);
      writer.writeMap("ValueType", property.contentType);
      writer.writeMap("IsCustomProperty", property.isCustomProperty ? "true" : "false");
    }
    writer.decreaseIndent();
  }

  if (user.roles.length > 0) {
    writer.writeMap("Roles");
    writer.increaseIndent();
    for (const role of user.roles) {
      writer.writeBeginListItem("MemberOf", role);
    }
    writer.decreaseIndent();
  }

  return writer.toString();
};
