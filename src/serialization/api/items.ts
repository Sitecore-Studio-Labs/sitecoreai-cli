import { ItemData, ItemMetadata } from "../types";
import { ItemPath } from "../item-path";
import { createDataSignatureBase, createSignature } from "../signature";
import type { SitecoreApiClientOptions } from "./types";
import { createScaiError } from "@/shared/errors";
import { FieldFilterSet } from "../field-filter";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";

const serializeMetadataFragment = `
  serialize(path: $path, database: $database, scope: $scope, excludedFieldIds: $excludedFieldIds) {
    id
    parentId
    templateId
    path
    hasChildren
    dataSignature
  }
`;

const serializeMetadataDebugFragment = serializeMetadataFragment.replace(
  "dataSignature",
  "dataSignature(debug: true)"
);

const serializeDataFragment = `
  serialize(path: $path, database: $database, scope: $scope, excludedFieldIds: $excludedFieldIds) {
    data
  }
`;

const executeSerializationCommandsMutation = `
mutation($commands: [ItemCommand], $minimumLogLevel: LogLevel) {
  executeSerializationCommands(commands: $commands, minimumLogLevel: $minimumLogLevel) {
    success
    name
    messages {
      logLevel
      eventID { id name }
      message
    }
  }
}`;

const mapScope = (scope: string): string => {
  if (scope.toLowerCase() === "singleitem") {
    return "SingleItem";
  }
  if (scope.toLowerCase() === "itemandchildren") {
    return "ItemAndChildren";
  }
  if (scope.toLowerCase() === "descendantsonly") {
    return "DescendantsOnly";
  }
  return "ItemAndDescendants";
};

const parseItemData = (data: unknown, database?: string): ItemData => {
  if (!data || typeof data !== "string") {
    throw createScaiError("GraphQL response did not contain serialized item data.", "UNKNOWN");
  }
  const parsed = JSON.parse(data) as ItemData;
  const versions =
    parsed.versions?.map((version) => ({
      language: version.language,
      version: version.version,
      fields: version.fields.map((field) => ({
        fieldId: field.fieldId,
        nameHint: field.nameHint,
        value: field.value ?? "",
        blobId: field.blobId ?? null,
      })),
    })) ?? [];
  const item: ItemData = {
    id: parsed.id,
    parentId: parsed.parentId,
    templateId: parsed.templateId,
    path: ItemPath.fromPathString(parsed.path.toString()),
    name: parsed.name,
    branchId: parsed.branchId,
    database,
    sharedFields: parsed.sharedFields.map((field) => ({
      fieldId: field.fieldId,
      nameHint: field.nameHint,
      value: field.value ?? "",
      blobId: field.blobId ?? null,
    })),
    unversionedFields: parsed.unversionedFields.map((language) => ({
      language: language.language,
      fields: language.fields.map((field) => ({
        fieldId: field.fieldId,
        nameHint: field.nameHint,
        value: field.value ?? "",
        blobId: field.blobId ?? null,
      })),
    })),
    versions,
    dataSignature: parsed.dataSignature,
  };

  if (!item.dataSignature) {
    const base = createDataSignatureBase(item);
    item.dataSignature = createSignature(base) ?? "";
  }

  return item;
};

// Public contract-stable API (re-exported from serialization/api/index);
// an options-object signature would be a breaking change for SDK consumers,
// so this stays positional and the max-params rule is suppressed for it.
export const fetchItemMetadata = async (
  environment: SitecoreApiClientOptions,
  database: string,
  pathOrId: string,
  scope: string,
  fieldFilter: FieldFilterSet,
  useDebugSignatures: boolean,
  options?: GraphQLRequestOptions
  // eslint-disable-next-line max-params -- see note above (public stable API)
): Promise<ItemMetadata[]> => {
  const query = `query($path: String!, $database: String!, $scope: TreeScope!, $excludedFieldIds: [String]) { ${
    useDebugSignatures ? serializeMetadataDebugFragment : serializeMetadataFragment
  } }`;

  const data = await runGraphQL<{
    serialize: Array<{
      id: string;
      parentId: string;
      templateId: string;
      path: string;
      hasChildren: boolean;
      dataSignature: string;
    }>;
  }>(
    environment,
    query,
    {
      path: pathOrId,
      database,
      scope: mapScope(scope),
      excludedFieldIds: Array.from(fieldFilter.excludes),
    },
    options
  );

  return data.serialize.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    templateId: item.templateId,
    path: ItemPath.fromPathString(item.path),
    hasChildren: item.hasChildren,
    dataSignature: item.dataSignature,
    database,
  }));
};

export const fetchItemData = async (
  environment: SitecoreApiClientOptions,
  database: string,
  pathOrId: string,
  scope: string,
  fieldFilter: FieldFilterSet,
  options?: GraphQLRequestOptions
): Promise<ItemData[]> => {
  const query = `query($path: String!, $database: String!, $scope: TreeScope!, $excludedFieldIds: [String]) { ${serializeDataFragment} }`;

  const data = await runGraphQL<{ serialize: Array<{ data: string }> }>(
    environment,
    query,
    {
      path: pathOrId,
      database,
      scope: mapScope(scope),
      excludedFieldIds: Array.from(fieldFilter.excludes),
    },
    options
  );

  return data.serialize.map((entry) => parseItemData(entry.data, database));
};

export const executeSerializationCommands = async (
  environment: SitecoreApiClientOptions,
  commands: unknown[],
  minimumLogLevel: string,
  options?: GraphQLRequestOptions
): Promise<unknown[]> => {
  const data = await runGraphQL<{ executeSerializationCommands: unknown[] }>(
    environment,
    executeSerializationCommandsMutation,
    {
      commands,
      minimumLogLevel,
    },
    options
  );
  return data.executeSerializationCommands;
};
