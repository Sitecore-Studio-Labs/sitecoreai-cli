import { describe, expect, it } from "vitest";
import { ItemPath } from "../../../src/serialization/item-path";
import {
  readItemYamlFromString,
  writeItemYaml,
  writeRoleYaml,
  readRoleYamlFromString,
  writeUserYaml,
  readUserYamlFromString,
} from "../../../src/serialization/yaml";
import { ItemData, RoleData, UserData } from "../../../src/serialization/types";

describe("yaml serialization", () => {
  it("round-trips item yaml", () => {
    const item: ItemData = {
      id: "id-1",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      dataSignature: "",
      name: "home",
      database: "master",
      branchId: null,
      sharedFields: [{ fieldId: "f1", value: "shared" }],
      unversionedFields: [{ language: "en", fields: [{ fieldId: "f2", value: "u1" }] }],
      versions: [{ language: "en", version: 1, fields: [{ fieldId: "f3", value: "v1" }] }],
    };
    const yaml = writeItemYaml(item);
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.id).toBe(item.id);
    expect(parsed.path.toPathString()).toBe(item.path.toPathString());
  });

  it("round-trips role yaml", () => {
    const role: RoleData = {
      roleName: "sitecore\\author",
      memberOfRoles: ["sitecore\\editor"],
      serializedItemId: "role-id",
    };
    const yaml = writeRoleYaml(role);
    const parsed = readRoleYamlFromString(yaml);
    expect(parsed.roleName.trim()).toBe(role.roleName);
    expect(parsed.memberOfRoles).toContain("sitecore\\editor");
  });

  it("round-trips user yaml", () => {
    const user: UserData = {
      userName: "sitecore\\jdoe",
      email: "jdoe@example.com",
      comment: "hello",
      creationDate: new Date().toISOString(),
      isApproved: true,
      roles: ["sitecore\\author"],
      profileProperties: [
        {
          name: "FullName",
          content: "Jane Doe",
          contentType: "text/plain",
          isCustomProperty: true,
        },
      ],
      serializedItemId: "user-id",
    };
    const yaml = writeUserYaml(user);
    const parsed = readUserYamlFromString(yaml);
    expect(parsed.userName.trim()).toBe(user.userName);
    expect(parsed.roles).toContain("sitecore\\author");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// writeItemYaml — value-encoding branches in YamlWriter.writeMap
// ─────────────────────────────────────────────────────────────────────────

const baseItem = (overrides: Partial<ItemData> = {}): ItemData => ({
  id: "id-1",
  parentId: "parent-1",
  templateId: "template-1",
  path: ItemPath.fromPathString("/sitecore/content/home"),
  dataSignature: "",
  name: "home",
  branchId: null,
  sharedFields: [],
  unversionedFields: [],
  versions: [],
  ...overrides,
});

describe("writeItemYaml — value encoding", () => {
  it("emits a block scalar (`|`) for a multi-line field value", () => {
    const item = baseItem({
      sharedFields: [{ fieldId: "f1", value: "line one\nline two\nline three" }],
    });
    const yaml = writeItemYaml(item);
    // A newline-bearing value becomes a literal block scalar.
    expect(yaml).toContain("Value: |");
    // Each source line is indented under the block scalar header.
    expect(yaml).toContain("    line one");
    expect(yaml).toContain("    line three");
    // Round-trips back to the original multi-line value (the literal block
    // scalar preserves the trailing newline the writer appends).
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.sharedFields[0].value.replace(/\n$/, "")).toBe("line one\nline two\nline three");
  });

  it("emits a block scalar for a value containing a carriage return", () => {
    const item = baseItem({ sharedFields: [{ fieldId: "f1", value: "a\rb" }] });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Value: |");
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.sharedFields[0].value.replace(/\n$/, "")).toBe("a\nb");
  });

  it("emits a block scalar for a value containing a double-quote", () => {
    const item = baseItem({ sharedFields: [{ fieldId: "f1", value: 'has " quote' }] });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Value: |");
  });

  it("emits a block scalar for a value containing a backslash", () => {
    const item = baseItem({ sharedFields: [{ fieldId: "f1", value: "back\\slash" }] });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Value: |");
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.sharedFields[0].value.replace(/\n$/, "")).toBe("back\\slash");
  });

  it("double-quotes a single-line value containing a special character", () => {
    // A colon triggers the specialChars quoting branch (no block scalar).
    const item = baseItem({ sharedFields: [{ fieldId: "f1", value: "key: value" }] });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain('Value: "key: value"');
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.sharedFields[0].value).toBe("key: value");
  });

  it("leaves a plain single-line value unquoted", () => {
    const item = baseItem({ sharedFields: [{ fieldId: "f1", value: "plainvalue" }] });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Value: plainvalue");
  });

  it("writes BranchID only when the item carries one", () => {
    const withBranch = writeItemYaml(baseItem({ branchId: "branch99" }));
    expect(withBranch).toContain("BranchID: branch99");
    const withoutBranch = writeItemYaml(baseItem({ branchId: null }));
    expect(withoutBranch).not.toContain("BranchID");
  });

  it("writes the DB key only when the item has a database", () => {
    const withDb = writeItemYaml(baseItem({ database: "master" }));
    expect(withDb).toContain("DB: master");
    const withoutDb = writeItemYaml(baseItem({ database: undefined }));
    expect(withoutDb).not.toContain("DB:");
  });

  it("emits BlobID for a shared field that carries a blob", () => {
    const item = baseItem({
      sharedFields: [{ fieldId: "f1", value: "v", blobId: "blob99" }],
    });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("BlobID: blob99");
  });

  it("sorts shared fields by field id", () => {
    const item = baseItem({
      sharedFields: [
        { fieldId: "zzz", value: "last" },
        { fieldId: "aaa", value: "first" },
      ],
    });
    const yaml = writeItemYaml(item);
    expect(yaml.indexOf("aaa")).toBeLessThan(yaml.indexOf("zzz"));
  });
});

describe("writeItemYaml — Languages block", () => {
  it("merges a language that appears only in versions into the Languages list", () => {
    // `fr` has versions but no unversioned fields — the writer must still
    // emit a Language entry for it (the `!languages.includes` branch).
    const item = baseItem({
      unversionedFields: [{ language: "en", fields: [{ fieldId: "f1", value: "u" }] }],
      versions: [{ language: "fr", version: 1, fields: [{ fieldId: "f2", value: "v" }] }],
    });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Language: en");
    expect(yaml).toContain("Language: fr");
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.versions.some((v) => v.language === "fr")).toBe(true);
  });

  it("emits sorted language entries", () => {
    const item = baseItem({
      versions: [
        { language: "fr", version: 1, fields: [{ fieldId: "f1", value: "x" }] },
        { language: "de", version: 1, fields: [{ fieldId: "f1", value: "y" }] },
      ],
    });
    const yaml = writeItemYaml(item);
    expect(yaml.indexOf("Language: de")).toBeLessThan(yaml.indexOf("Language: fr"));
  });

  it("emits unversioned Fields with a Hint and a BlobID", () => {
    const item = baseItem({
      unversionedFields: [
        {
          language: "en",
          fields: [{ fieldId: "f1", value: "v", nameHint: "Title", blobId: "b1" }],
        },
      ],
    });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Hint: Title");
    expect(yaml).toContain("BlobID: b1");
  });

  it("emits version Fields with a Hint and a BlobID, sorted by version", () => {
    const item = baseItem({
      versions: [
        { language: "en", version: 2, fields: [{ fieldId: "f1", value: "second" }] },
        {
          language: "en",
          version: 1,
          fields: [{ fieldId: "f1", value: "first", nameHint: "Body", blobId: "vb1" }],
        },
      ],
    });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Version: 1");
    expect(yaml).toContain("Version: 2");
    expect(yaml).toContain("Hint: Body");
    expect(yaml).toContain("BlobID: vb1");
    // Version 1 emits before version 2.
    expect(yaml.indexOf("Version: 1")).toBeLessThan(yaml.indexOf("Version: 2"));
  });

  it("omits the Fields sub-block for a version with no fields", () => {
    const item = baseItem({
      versions: [{ language: "en", version: 1, fields: [] }],
    });
    const yaml = writeItemYaml(item);
    expect(yaml).toContain("Version: 1");
    // The empty version still emits its Version line but no Fields block.
    const parsed = readItemYamlFromString(yaml);
    expect(parsed.versions[0].fields).toEqual([]);
  });

  it("does not emit a Languages block when there are no languages", () => {
    const yaml = writeItemYaml(baseItem());
    expect(yaml).not.toContain("Languages:");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// readItemYamlFromString — parse-side branches
// ─────────────────────────────────────────────────────────────────────────

describe("readItemYamlFromString — parsing", () => {
  it("defaults missing top-level keys to empty strings", () => {
    const parsed = readItemYamlFromString("ID: only-id\nPath: /sitecore/content/x\n");
    expect(parsed.id).toBe("only-id");
    expect(parsed.parentId).toBe("");
    expect(parsed.templateId).toBe("");
    expect(parsed.branchId).toBeNull();
  });

  it("recovers BranchID and DB when present", () => {
    const parsed = readItemYamlFromString(
      "ID: i\nParent: p\nTemplate: t\nPath: /sitecore/content/x\nBranchID: br\nDB: web\n"
    );
    expect(parsed.branchId).toBe("br");
    expect(parsed.database).toBe("web");
  });

  it("returns empty field/language lists when SharedFields and Languages are absent", () => {
    const parsed = readItemYamlFromString("ID: i\nPath: /sitecore/content/x\n");
    expect(parsed.sharedFields).toEqual([]);
    expect(parsed.unversionedFields).toEqual([]);
    expect(parsed.versions).toEqual([]);
  });

  it("ignores a non-array Languages value", () => {
    const parsed = readItemYamlFromString(
      "ID: i\nPath: /sitecore/content/x\nLanguages: notalist\n"
    );
    expect(parsed.unversionedFields).toEqual([]);
    expect(parsed.versions).toEqual([]);
  });

  it("drops a language whose Fields list is empty from unversionedFields", () => {
    const yaml = [
      "ID: i",
      "Path: /sitecore/content/x",
      "Languages:",
      "- Language: en",
      "  Versions:",
      "  - Version: 1",
      "    Fields:",
      "    - ID: f1",
      "      Value: v",
      "",
    ].join("\n");
    const parsed = readItemYamlFromString(yaml);
    // `en` has no unversioned fields — only a version — so it does not land
    // in unversionedFields.
    expect(parsed.unversionedFields).toEqual([]);
    expect(parsed.versions).toHaveLength(1);
    expect(parsed.versions[0].version).toBe(1);
  });

  it("computes a non-empty dataSignature off the parsed item", () => {
    const parsed = readItemYamlFromString(
      "ID: i\nParent: p\nTemplate: t\nPath: /sitecore/content/x\n"
    );
    expect(parsed.dataSignature).not.toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// roles
// ─────────────────────────────────────────────────────────────────────────

describe("writeRoleYaml / readRoleYamlFromString", () => {
  it("omits the MemberOf block for a role with no parent roles", () => {
    const yaml = writeRoleYaml({ roleName: "sitecore\\reader", memberOfRoles: [] });
    expect(yaml).not.toContain("MemberOf");
    const parsed = readRoleYamlFromString(yaml);
    expect(parsed.memberOfRoles).toEqual([]);
  });

  it("threads serializedItemId through readRoleYamlFromString", () => {
    const yaml = writeRoleYaml({ roleName: "sitecore\\author", memberOfRoles: [] });
    const parsed = readRoleYamlFromString(yaml, "role-guid");
    expect(parsed.serializedItemId).toBe("role-guid");
  });

  it("defaults a missing Role key to an empty string", () => {
    const parsed = readRoleYamlFromString("MemberOf:\n- Role: sitecore\\x\n");
    expect(parsed.roleName).toBe("");
  });

  it("reads MemberOf entries given as bare strings", () => {
    // The reader accepts either `{ Role: x }` maps or bare string entries.
    const parsed = readRoleYamlFromString("Role: r\nMemberOf:\n- sitecore\\plain\n");
    expect(parsed.memberOfRoles).toContain("sitecore\\plain");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// users
// ─────────────────────────────────────────────────────────────────────────

describe("writeUserYaml / readUserYamlFromString", () => {
  it("omits Email, Comment, Properties, and Roles when empty", () => {
    const yaml = writeUserYaml({
      userName: "sitecore\\min",
      creationDate: "2026-01-01T00:00:00Z",
      isApproved: false,
      roles: [],
      profileProperties: [],
    });
    expect(yaml).not.toContain("Email:");
    expect(yaml).not.toContain("Comment:");
    expect(yaml).not.toContain("Properties:");
    expect(yaml).not.toContain("Roles:");
    expect(yaml).toContain("IsApproved: false");
  });

  it("round-trips a non-custom profile property", () => {
    const yaml = writeUserYaml({
      userName: "sitecore\\u",
      creationDate: "2026-01-01T00:00:00Z",
      isApproved: true,
      roles: [],
      profileProperties: [
        { name: "Phone", content: "555", contentType: "text/plain", isCustomProperty: false },
      ],
    });
    expect(yaml).toContain("IsCustomProperty: false");
    const parsed = readUserYamlFromString(yaml);
    expect(parsed.profileProperties[0].isCustomProperty).toBe(false);
  });

  it("parses IsApproved case-insensitively and defaults to false when absent", () => {
    expect(readUserYamlFromString("UserName: a\nIsApproved: TRUE\n").isApproved).toBe(true);
    expect(readUserYamlFromString("UserName: a\n").isApproved).toBe(false);
  });

  it("leaves Email and Comment undefined when absent", () => {
    const parsed = readUserYamlFromString("UserName: a\nCreated: 2026-01-01\n");
    expect(parsed.email).toBeUndefined();
    expect(parsed.comment).toBeUndefined();
  });

  it("reads Roles entries given as bare strings", () => {
    const parsed = readUserYamlFromString("UserName: a\nRoles:\n- sitecore\\plain-role\n");
    expect(parsed.roles).toContain("sitecore\\plain-role");
  });

  it("returns empty Properties/Roles when those keys are not arrays", () => {
    const parsed = readUserYamlFromString("UserName: a\nProperties: nope\nRoles: nope\n");
    expect(parsed.profileProperties).toEqual([]);
    expect(parsed.roles).toEqual([]);
  });

  it("threads serializedItemId through readUserYamlFromString", () => {
    const parsed = readUserYamlFromString("UserName: a\n", "user-guid");
    expect(parsed.serializedItemId).toBe("user-guid");
  });
});
