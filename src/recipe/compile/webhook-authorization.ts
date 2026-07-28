import { v5 as uuidv5 } from "@/shared/uuid";
import { createScaiError } from "@/shared/errors";
import { webhookAuthorizationId } from "../items/guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
} from "../ir/operations";
import { SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  WebhookAuthorizationRecipeSchema,
  type WebhookAuthorizationRecipe,
} from "../schema/recipe";
import { joinPath, sharedField, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `WebhookAuthorizationRecipe` to an Operation IR.
 *
 * Emits one CreateItem op for the authorization at
 * `/sitecore/system/Settings/Webhooks/Authorizations/<name>`. The
 * authorization template depends on the auth type — each conforms to
 * a distinct system template under
 * `/sitecore/templates/System/Webhooks/Authorizations/`. The compiler
 * emits `templateOf: { kind: "ref-path", value: ... }` so the push
 * pipeline resolves the template GUID at apply time.
 *
 * Secrets in the recipe are `$ENV:VAR_NAME` references. They are NOT
 * resolved at compile time — the IR carries the reference verbatim,
 * and the executor's apply path expands them at push time (so
 * compile-only flows like `recipe diff` don't require the env vars to
 * be present).
 *
 * @throws `INPUT_INVALID` if any required env var reference is malformed.
 */
export function compileWebhookAuthorizationRecipe(
  input: WebhookAuthorizationRecipe,
  context: CompileContext,
  _emittedFolders: Set<string> = new Set()
): OperationIr {
  void context;
  const recipe = WebhookAuthorizationRecipeSchema.parse(input);

  const policy = defaultPolicyForRecipe(recipe.kind);
  const authorizationsRoot = "/sitecore/system/Settings/Webhooks/Authorizations";
  const itemRefKey = webhookAuthorizationId(recipe.handle);
  const itemPath = joinPath(authorizationsRoot, recipe.name);

  const fields: FieldValue[] = [
    versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
      kind: "string",
      value: recipe.displayName,
    }),
  ];
  if (recipe.description !== undefined) {
    fields.push({
      ...sharedField(deriveFieldId(itemRefKey, "Description"), {
        kind: "string",
        value: recipe.description,
      }),
      fieldName: "Description",
    });
  }

  let templatePath: string;
  switch (recipe.auth.type) {
    case "ApiKey":
      templatePath = "/sitecore/templates/System/Webhooks/Authorizations/Api Key";
      fields.push(
        actionField(itemRefKey, "Header Name", { kind: "string", value: recipe.auth.headerName }),
        actionField(itemRefKey, "Key", { kind: "string", value: recipe.auth.key })
      );
      break;
    case "Basic":
      templatePath = "/sitecore/templates/System/Webhooks/Authorizations/Basic";
      fields.push(
        actionField(itemRefKey, "User Name", { kind: "string", value: recipe.auth.username }),
        actionField(itemRefKey, "Password", { kind: "string", value: recipe.auth.password })
      );
      break;
    case "OAuth2ClientCredentialsGrant":
      templatePath =
        "/sitecore/templates/System/Webhooks/Authorizations/OAuth2 Client Credentials Grant";
      fields.push(
        actionField(itemRefKey, "Token Endpoint", {
          kind: "string",
          value: recipe.auth.tokenEndpoint,
        }),
        actionField(itemRefKey, "Client Id", {
          kind: "string",
          value: recipe.auth.clientId,
        }),
        actionField(itemRefKey, "Client Secret", {
          kind: "string",
          value: recipe.auth.clientSecret,
        })
      );
      if (recipe.auth.scope !== undefined) {
        fields.push(actionField(itemRefKey, "Scope", { kind: "string", value: recipe.auth.scope }));
      }
      if (recipe.auth.audience !== undefined) {
        fields.push(
          actionField(itemRefKey, "Audience", { kind: "string", value: recipe.auth.audience })
        );
      }
      break;
    default:
      // Discriminated union exhaustiveness — unreachable at runtime.
      throw createScaiError(`Unsupported auth type on '${recipe.handle}'.`, "INPUT_INVALID");
  }

  const operations: Operation[] = [
    {
      op: "CreateItem",
      policy,
      label: `webhook-authorization:${recipe.handle}`,
      id: itemRefKey,
      path: itemPath,
      parent: { kind: "ref-path", value: authorizationsRoot },
      templateOf: { kind: "ref-path", value: templatePath },
      name: recipe.name,
      fields,
    } satisfies CreateItemOp,
  ];

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

const FIELD_REFKEY_NAMESPACE = uuidv5(
  "webhook-authorization-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
function deriveFieldId(parentRefKey: string, fieldName: string): string {
  return uuidv5(`${parentRefKey}:${fieldName}`, FIELD_REFKEY_NAMESPACE);
}

function actionField(parentRefKey: string, name: string, value: FieldValue["value"]): FieldValue {
  return {
    ...sharedField(deriveFieldId(parentRefKey, name), value),
    fieldName: name,
  };
}
