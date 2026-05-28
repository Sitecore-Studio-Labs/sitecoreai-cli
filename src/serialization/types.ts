import { ItemPath } from "./item-path";

/**
 * Field filter on a serialization module's `items.excludedFields`. The
 * canonical wire shape is camelCase `fieldId`; legacy / hand-edited
 * configs sometimes use the PascalCase `FieldId` alias. Declaring
 * both here formalizes what `normalizeFieldFilters()` already had to
 * do with an inline cast, and lets the normalizer read the alias
 * without `as unknown as`.
 */
export type FieldFilter = {
  fieldId?: string;
  /** Legacy PascalCase alias for `fieldId`. Normalized at load time. */
  FieldId?: string;
  description?: string;
};

export type ItemFieldValue = {
  fieldId: string;
  nameHint?: string;
  value: string;
  blobId?: string | null;
};

export type ItemLanguage = {
  language: string;
  fields: ItemFieldValue[];
};

export type ItemVersion = {
  language: string;
  version: number;
  fields: ItemFieldValue[];
};

export type ItemMetadata = {
  id: string;
  parentId: string;
  templateId: string;
  path: ItemPath;
  dataSignature?: string;
  hasChildren?: boolean;
  database?: string;
};

export type ItemData = ItemMetadata & {
  name: string;
  branchId?: string | null;
  sharedFields: ItemFieldValue[];
  unversionedFields: ItemLanguage[];
  versions: ItemVersion[];
};

export type RolePredicateItem = {
  domain: string;
  pattern: string;
  moduleSourceIdentifier?: string;
};

export type UserPredicateItem = {
  domain: string;
  pattern: string;
  moduleSourceIdentifier?: string;
};

export type RoleData = {
  roleName: string;
  memberOfRoles: string[];
  serializedItemId?: string;
};

export type ProfileProperty = {
  name: string;
  content: string;
  contentType: string;
  isCustomProperty: boolean;
};

export type UserData = {
  userName: string;
  email?: string;
  comment?: string;
  creationDate: string;
  isApproved: boolean;
  roles: string[];
  profileProperties: ProfileProperty[];
  serializedItemId?: string;
};

export type HistoryEntry = {
  id: string;
  path: string;
  database: string;
  oldPath?: string | null;
  changeType: "Create" | "UpdateOrRename" | "Move" | "Recycle";
};
