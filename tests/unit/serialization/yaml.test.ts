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
