import { createScaiError } from "../../shared/errors";
import {
  webhookAuthorizationId,
  workflowCommandId,
  workflowCommandValidationId,
  workflowGroupFolderId,
  workflowId,
  workflowStateActionId,
  workflowStateId,
} from "../guids";
import {
  type CreateItemOp,
  type FieldValue,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { defaultPolicyForRecipe } from "../policy";
import {
  WorkflowRecipeSchema,
  type WorkflowRecipe,
} from "../schema/recipe";
import { joinPath, sharedField, versionedField, type CompileContext } from "./shared";
import { v5 as uuidv5 } from "uuid";

/**
 * Compile a `WorkflowRecipe` to an Operation IR.
 *
 * Emits, in execution order:
 *
 *   1. Optional `Workflow Folder` group folder under
 *      `/sitecore/system/Workflows/<group>` (when `meta.tax.group` is set).
 *   2. The workflow item itself, conforming to Sitecore's `Workflow`
 *      template (path-resolved at apply time via `templateOf: ref-path`).
 *   3. One state item per `recipe.states[]`, conforming to the
 *      `State` template; carries `Final` and `Preview` fields.
 *   4. A `SetField` on the workflow item setting `__Initial state` to
 *      a recipe-ref pointing at the initial state.
 *   5. One command item per `state.commands[]`, conforming to the
 *      `Command` template; carries `Next state`, `__Auto Publish`,
 *      `Suppress comment`, `Appearance Evaluator Type`.
 *   6. One action item per `state.actions[]`, conforming to either
 *      `Webhook Submit Action` or `Webhook Validation Action`.
 *   7. One validation item per `command.validations[]` (Webhook
 *      Validation Action).
 *
 * Bindings (`recipe.bindings.templates`) are accepted by the schema but
 * NOT emitted by this compiler yet — they require a cross-recipe seed
 * for the bound template's `__Standard Values` item path. Surface an
 * `INPUT_INVALID` error when non-empty so authors don't silently lose
 * the binding intent.
 *
 * Workflow-specific field GUIDs are not published as a public contract
 * by Sitecore. The executor's `FieldValueInput.name` fallback resolves
 * each field by name against the target item's template at apply time,
 * so the IR carries arbitrary stable refKey GUIDs for `fieldId` plus
 * the canonical `fieldName`. Same pattern as recipe-created fields on
 * registry templates (see `FieldValueSchema.fieldName` comment).
 *
 * @throws `INPUT_INVALID` when initialState references an undeclared
 *   state, when a command's nextState doesn't resolve, when no state is
 *   final, or when an action declares both authorizationRef and
 *   authorizationPath.
 */
export function compileWorkflowRecipe(
  input: WorkflowRecipe,
  context: CompileContext,
  emittedFolders: Set<string> = new Set()
): OperationIr {
  void context;
  const recipe = WorkflowRecipeSchema.parse(input);

  validateWorkflowRecipe(recipe);

  if (recipe.bindings.templates.length > 0) {
    throw createScaiError(
      `Workflow recipe '${recipe.handle}' declares bindings.templates but the binding compiler is not yet implemented.`,
      "INPUT_INVALID",
      {
        hint: "Drop bindings.templates from the recipe for now and set __Default workflow on each template's Standard Values manually. Binding support is tracked as a follow-up.",
      }
    );
  }

  const policy = defaultPolicyForRecipe(recipe.kind);
  const operations: Operation[] = [];

  // 1. Optional group folder.
  const group = recipe.meta?.tax?.group;
  const workflowsRoot = "/sitecore/system/Workflows";
  let parentPath = workflowsRoot;
  let parentRef: CreateItemOp["parent"] = { kind: "ref-path", value: workflowsRoot };
  if (group) {
    const groupRefKey = workflowGroupFolderId(group);
    const groupPath = joinPath(workflowsRoot, group);
    if (!emittedFolders.has(groupRefKey)) {
      emittedFolders.add(groupRefKey);
      operations.push({
        op: "CreateItem",
        policy: "CreateOnly",
        label: `workflow-group:${group}`,
        id: groupRefKey,
        path: groupPath,
        parent: parentRef,
        templateOf: SITECORE_TEMPLATES.FOLDER,
        name: group,
        fields: [],
      } satisfies CreateItemOp);
    }
    parentPath = groupPath;
    parentRef = { kind: "ref-recipe", refKey: groupRefKey };
  }

  // 2. Workflow item.
  const workflowRefKey = workflowId(recipe.handle);
  const workflowPath = joinPath(parentPath, recipe.name);
  operations.push({
    op: "CreateItem",
    policy,
    label: `workflow:${recipe.handle}`,
    id: workflowRefKey,
    path: workflowPath,
    parent: parentRef,
    templateOf: { kind: "ref-path", value: TEMPLATE_PATHS.workflow },
    name: recipe.name,
    fields: [
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: recipe.displayName }),
    ],
  } satisfies CreateItemOp);

  // 3. State items.
  for (const state of recipe.states) {
    const stateRefKey = workflowStateId(recipe.handle, state.key);
    const statePath = joinPath(workflowPath, state.name);
    const fields: FieldValue[] = [
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: state.displayName }),
    ];
    if (state.final) {
      fields.push({
        ...sharedField(deriveFieldId(workflowRefKey, "Final"), { kind: "bool", value: true }),
        fieldName: "Final",
      });
    }
    if (state.preview) {
      fields.push({
        ...sharedField(deriveFieldId(workflowRefKey, "Preview"), { kind: "bool", value: true }),
        fieldName: "Preview",
      });
    }
    operations.push({
      op: "CreateItem",
      policy,
      label: `workflow-state:${recipe.handle}:${state.key}`,
      id: stateRefKey,
      path: statePath,
      parent: { kind: "ref-recipe", refKey: workflowRefKey },
      templateOf: { kind: "ref-path", value: TEMPLATE_PATHS.state },
      name: state.name,
      fields,
    } satisfies CreateItemOp);
  }

  // 4. Initial state — set on the workflow item.
  const initialStateRefKey = workflowStateId(recipe.handle, recipe.initialState);
  operations.push({
    op: "SetField",
    policy,
    label: `workflow:${recipe.handle}:initial-state`,
    itemRefKey: workflowRefKey,
    fieldId: deriveFieldId(workflowRefKey, "__Initial state"),
    fieldName: "__Initial state",
    value: { kind: "ref-recipe", refKey: initialStateRefKey },
  } satisfies SetFieldOp);

  // 5. Command items + their setting fields. Command items live as
  //    direct children of their state (not nested under an `Actions`
  //    subfolder); validations live as direct children of the command.
  for (const state of recipe.states) {
    const stateRefKey = workflowStateId(recipe.handle, state.key);
    const statePath = joinPath(workflowPath, state.name);

    for (const command of state.commands) {
      const commandRefKey = workflowCommandId(recipe.handle, state.key, command.key);
      const commandPath = joinPath(statePath, command.name);
      const nextStateRefKey = workflowStateId(recipe.handle, command.nextState);
      operations.push({
        op: "CreateItem",
        policy,
        label: `workflow-command:${recipe.handle}:${state.key}:${command.key}`,
        id: commandRefKey,
        path: commandPath,
        parent: { kind: "ref-recipe", refKey: stateRefKey },
        templateOf: { kind: "ref-path", value: TEMPLATE_PATHS.command },
        name: command.name,
        fields: [
          versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
            kind: "string",
            value: command.displayName,
          }),
          {
            ...sharedField(deriveFieldId(commandRefKey, "Next state"), {
              kind: "ref-recipe",
              refKey: nextStateRefKey,
            }),
            fieldName: "Next state",
          },
          {
            ...sharedField(deriveFieldId(commandRefKey, "__Auto Publish"), {
              kind: "bool",
              value: command.autoPublish,
            }),
            fieldName: "__Auto Publish",
          },
          {
            ...sharedField(deriveFieldId(commandRefKey, "Suppress comment"), {
              kind: "bool",
              value: command.suppressComment,
            }),
            fieldName: "Suppress comment",
          },
          {
            ...sharedField(deriveFieldId(commandRefKey, "Appearance Evaluator Type"), {
              kind: "string",
              value: command.appearanceEvaluator,
            }),
            fieldName: "Appearance Evaluator Type",
          },
        ],
      } satisfies CreateItemOp);

      for (let idx = 0; idx < command.validations.length; idx += 1) {
        const validation = command.validations[idx]!;
        const validationRefKey = workflowCommandValidationId(
          recipe.handle,
          state.key,
          command.key,
          idx
        );
        const validationPath = joinPath(commandPath, validation.key);
        operations.push({
          op: "CreateItem",
          policy,
          label: `workflow-validation:${recipe.handle}:${state.key}:${command.key}:${validation.key}`,
          id: validationRefKey,
          path: validationPath,
          parent: { kind: "ref-recipe", refKey: commandRefKey },
          templateOf: { kind: "ref-path", value: TEMPLATE_PATHS.validationAction },
          name: validation.key,
          fields: buildActionFields(validationRefKey, validation),
        } satisfies CreateItemOp);
      }
    }

    // 6. State-level actions (submit or validation).
    for (let idx = 0; idx < state.actions.length; idx += 1) {
      const action = state.actions[idx]!;
      const actionRefKey = workflowStateActionId(recipe.handle, state.key, idx);
      const actionPath = joinPath(statePath, action.key);
      const templatePath =
        action.kind === "webhook-submit"
          ? TEMPLATE_PATHS.submitAction
          : TEMPLATE_PATHS.validationAction;
      operations.push({
        op: "CreateItem",
        policy,
        label: `workflow-action:${recipe.handle}:${state.key}:${action.key}`,
        id: actionRefKey,
        path: actionPath,
        parent: { kind: "ref-recipe", refKey: stateRefKey },
        templateOf: { kind: "ref-path", value: templatePath },
        name: action.key,
        fields: buildActionFields(actionRefKey, action),
      } satisfies CreateItemOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Cross-field validations that can't live on the schema (Zod's
 * `discriminatedUnion` rejects `ZodEffects` members). Mirror of
 * `compileEnumerationRecipe`'s `default ∈ values` check.
 */
function validateWorkflowRecipe(recipe: WorkflowRecipe): void {
  const stateKeys = new Set(recipe.states.map((s) => s.key));
  if (!stateKeys.has(recipe.initialState)) {
    throw createScaiError(
      `Workflow '${recipe.handle}' initialState='${recipe.initialState}' is not declared in states.`,
      "INPUT_INVALID"
    );
  }
  for (const state of recipe.states) {
    for (const command of state.commands) {
      if (!stateKeys.has(command.nextState)) {
        throw createScaiError(
          `Workflow '${recipe.handle}' state '${state.key}' command '${command.key}' references unknown nextState '${command.nextState}'.`,
          "INPUT_INVALID"
        );
      }
    }
  }
  if (!recipe.states.some((s) => s.final)) {
    throw createScaiError(
      `Workflow '${recipe.handle}' must declare at least one state with final=true.`,
      "INPUT_INVALID"
    );
  }
  const checkAction = (action: { authorizationRef?: string; authorizationPath?: string }, where: string) => {
    if (action.authorizationRef && action.authorizationPath) {
      throw createScaiError(
        `Workflow '${recipe.handle}' ${where}: use either authorizationRef OR authorizationPath, not both.`,
        "INPUT_INVALID"
      );
    }
  };
  for (const state of recipe.states) {
    state.actions.forEach((a) =>
      checkAction(a, `state '${state.key}' action '${a.key}'`)
    );
    for (const command of state.commands) {
      command.validations.forEach((v) =>
        checkAction(v, `state '${state.key}' command '${command.key}' validation '${v.key}'`)
      );
    }
  }
}

const TEMPLATE_PATHS = {
  workflow: "/sitecore/templates/System/Workflow/Workflow",
  state: "/sitecore/templates/System/Workflow/State",
  command: "/sitecore/templates/System/Workflow/Command",
  submitAction: "/sitecore/templates/System/Workflow/Webhook Submit Action",
  validationAction: "/sitecore/templates/System/Workflow/Webhook Validation Action",
} as const;

/**
 * Derive a stable refKey for a field on a workflow/state/command item.
 * The executor's apply path uses `fieldName` for the actual mutation
 * (system fields like `Final` and `Next state` have established tenant
 * GUIDs we don't know); `fieldId` here is a per-(item, field) refKey
 * that the executor's `capturedItemIds` map ignores because the field
 * isn't itself an item.
 */
const FIELD_REFKEY_NAMESPACE = uuidv5(
  "workflow-field",
  "d6c28e9f-21f3-56ee-ada3-f2a947c3d475" // NAMESPACE_ROOT
);
function deriveFieldId(parentRefKey: string, fieldName: string): string {
  return uuidv5(`${parentRefKey}:${fieldName}`, FIELD_REFKEY_NAMESPACE);
}

function buildActionFields(
  actionRefKey: string,
  action: {
    url: string;
    description?: string;
    enabled: boolean;
    serializationType: "JSON" | "XML";
    displayName?: string;
    authorizationRef?: string;
    authorizationPath?: string;
  }
): FieldValue[] {
  const fields: FieldValue[] = [
    {
      ...sharedField(deriveFieldId(actionRefKey, "Url"), {
        kind: "string",
        value: action.url,
      }),
      fieldName: "Url",
    },
    {
      ...sharedField(deriveFieldId(actionRefKey, "Enabled"), {
        kind: "bool",
        value: action.enabled,
      }),
      fieldName: "Enabled",
    },
    {
      ...sharedField(deriveFieldId(actionRefKey, "Serialization Type"), {
        kind: "string",
        value: action.serializationType,
      }),
      fieldName: "Serialization Type",
    },
  ];
  if (action.description !== undefined) {
    fields.push({
      ...sharedField(deriveFieldId(actionRefKey, "Description"), {
        kind: "string",
        value: action.description,
      }),
      fieldName: "Description",
    });
  }
  if (action.displayName !== undefined) {
    fields.push(
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, { kind: "string", value: action.displayName })
    );
  }
  if (action.authorizationRef) {
    fields.push({
      ...sharedField(deriveFieldId(actionRefKey, "Authorization"), {
        kind: "ref-recipe",
        refKey: webhookAuthorizationId(action.authorizationRef),
      }),
      fieldName: "Authorization",
    });
  } else if (action.authorizationPath) {
    fields.push({
      ...sharedField(deriveFieldId(actionRefKey, "Authorization"), {
        kind: "ref-path",
        value: action.authorizationPath,
      }),
      fieldName: "Authorization",
    });
  }
  return fields;
}
