import { describe, expect, it } from "vitest";
import { compileWorkflowRecipe } from "../../../src/recipe/compile/workflow";
import { compileWebhookAuthorizationRecipe } from "../../../src/recipe/compile/webhook-authorization";
import {
  webhookAuthorizationId,
  workflowCommandId,
  workflowCommandValidationId,
  workflowGroupFolderId,
  workflowId,
  workflowStateActionId,
  workflowStateId,
} from "../../../src/recipe/guids";
import type { CreateItemOp, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  WebhookAuthorizationRecipeSchema,
  WorkflowRecipeSchema,
  type WebhookAuthorizationRecipe,
  type WorkflowRecipe,
} from "../../../src/recipe/schema/recipe";

const baseContext = {} as never;

const minimalWorkflow = (overrides?: Partial<WorkflowRecipe>): WorkflowRecipe => {
  const recipe = {
    kind: "workflow",
    schemaVersion: "1",
    handle: "test-wf@1",
    name: "TestWorkflow",
    displayName: "Test Workflow",
    initialState: "draft",
    states: [
      {
        key: "draft",
        name: "Draft",
        displayName: "Draft",
        actions: [],
        commands: [
          {
            key: "submit",
            name: "Submit",
            displayName: "Submit",
            nextState: "approved",
            autoPublish: false,
            suppressComment: false,
            appearanceEvaluator: "default" as const,
            secured: false,
            validations: [],
          },
        ],
      },
      {
        key: "approved",
        name: "Approved",
        displayName: "Approved",
        final: true,
        preview: false,
        actions: [],
        commands: [],
      },
    ],
    bindings: { templates: [] },
    ...overrides,
  };
  return WorkflowRecipeSchema.parse(recipe);
};

describe("compileWorkflowRecipe — IR shape", () => {
  it("emits workflow, state, command, and __Initial state SetField ops with stable refKeys", () => {
    const ir = compileWorkflowRecipe(minimalWorkflow(), baseContext);

    const ops = ir.operations;
    const creates = ops.filter((o): o is CreateItemOp => o.op === "CreateItem");
    const sets = ops.filter((o): o is SetFieldOp => o.op === "SetField");

    // workflow + 2 states + 1 command = 4 CreateItem ops
    expect(creates).toHaveLength(4);
    expect(sets).toHaveLength(1);

    const wfOp = creates[0]!;
    expect(wfOp.id).toBe(workflowId("test-wf@1"));
    expect(wfOp.path).toBe("/sitecore/system/Workflows/TestWorkflow");
    expect(wfOp.templateOf).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/System/Workflow/Workflow",
    });

    const draftOp = creates[1]!;
    expect(draftOp.id).toBe(workflowStateId("test-wf@1", "draft"));
    expect(draftOp.parent).toEqual({ kind: "ref-recipe", refKey: workflowId("test-wf@1") });

    const approvedOp = creates[2]!;
    expect(approvedOp.id).toBe(workflowStateId("test-wf@1", "approved"));

    const submitCmd = creates[3]!;
    expect(submitCmd.id).toBe(workflowCommandId("test-wf@1", "draft", "submit"));

    const initialStateOp = sets[0]!;
    expect(initialStateOp.itemRefKey).toBe(workflowId("test-wf@1"));
    expect(initialStateOp.fieldName).toBe("__Initial state");
    expect(initialStateOp.value).toEqual({
      kind: "ref-recipe",
      refKey: workflowStateId("test-wf@1", "draft"),
    });
  });

  it("nests under a Workflow Folder when meta.tax.group is set", () => {
    const ir = compileWorkflowRecipe(
      minimalWorkflow({ meta: { tax: { group: "Editorial" } } }),
      baseContext
    );

    const creates = ir.operations.filter((o): o is CreateItemOp => o.op === "CreateItem");
    const folderOp = creates[0]!;
    expect(folderOp.id).toBe(workflowGroupFolderId("Editorial"));
    expect(folderOp.path).toBe("/sitecore/system/Workflows/Editorial");
    expect(folderOp.policy).toBe("CreateOnly");

    const wfOp = creates[1]!;
    expect(wfOp.path).toBe("/sitecore/system/Workflows/Editorial/TestWorkflow");
    expect(wfOp.parent).toEqual({
      kind: "ref-recipe",
      refKey: workflowGroupFolderId("Editorial"),
    });
  });

  it("emits Final and Preview fields only when non-default", () => {
    const ir = compileWorkflowRecipe(minimalWorkflow(), baseContext);
    const states = ir.operations
      .filter((o): o is CreateItemOp => o.op === "CreateItem")
      .filter((o) => o.label.startsWith("workflow-state:"));
    const draft = states.find((s) => s.label.endsWith(":draft"))!;
    const approved = states.find((s) => s.label.endsWith(":approved"))!;
    expect(draft.fields.find((f) => f.fieldName === "Final")).toBeUndefined();
    expect(draft.fields.find((f) => f.fieldName === "Preview")).toBeUndefined();
    expect(approved.fields.find((f) => f.fieldName === "Final")).toEqual(
      expect.objectContaining({ value: { kind: "bool", value: true } })
    );
  });

  it("wires command Next state as a ref-recipe to the target state", () => {
    const ir = compileWorkflowRecipe(minimalWorkflow(), baseContext);
    const command = ir.operations
      .filter((o): o is CreateItemOp => o.op === "CreateItem")
      .find((o) => o.label.includes("workflow-command:"))!;
    expect(command.id).toBe(workflowCommandId("test-wf@1", "draft", "submit"));
    const nextStateField = command.fields.find((f) => f.fieldName === "Next state")!;
    expect(nextStateField.value).toEqual({
      kind: "ref-recipe",
      refKey: workflowStateId("test-wf@1", "approved"),
    });
  });

  it("emits state-level submit + validation actions with the right templates", () => {
    const ir = compileWorkflowRecipe(
      minimalWorkflow({
        states: [
          {
            key: "draft",
            name: "Draft",
            displayName: "Draft",
            actions: [
              {
                kind: "webhook-submit",
                key: "notify",
                url: "https://x.example.com",
                authorizationRef: "ci@1",
                serializationType: "JSON",
                enabled: true,
              },
            ],
            commands: [
              {
                key: "approve",
                name: "Approve",
                displayName: "Approve",
                nextState: "approved",
                autoPublish: false,
                suppressComment: false,
                appearanceEvaluator: "default",
                secured: false,
                validations: [
                  {
                    kind: "webhook-validation",
                    key: "lint",
                    url: "https://x.example.com/lint",
                    authorizationPath: "/sitecore/system/Settings/Webhooks/Authorizations/CI",
                    serializationType: "JSON",
                    enabled: true,
                  },
                ],
              },
            ],
          },
          { key: "approved", name: "Approved", displayName: "Approved", final: true, preview: false, actions: [], commands: [] },
        ],
      }),
      baseContext
    );

    const creates = ir.operations.filter((o): o is CreateItemOp => o.op === "CreateItem");
    const action = creates.find((o) => o.label.includes("workflow-action:"))!;
    expect(action.id).toBe(workflowStateActionId("test-wf@1", "draft", 0));
    expect(action.templateOf).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/System/Workflow/Webhook Submit Action",
    });
    const authField = action.fields.find((f) => f.fieldName === "Authorization")!;
    expect(authField.value).toEqual({
      kind: "ref-recipe",
      refKey: webhookAuthorizationId("ci@1"),
    });

    const validation = creates.find((o) => o.label.includes("workflow-validation:"))!;
    expect(validation.id).toBe(
      workflowCommandValidationId("test-wf@1", "draft", "approve", 0)
    );
    expect(validation.templateOf).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/System/Workflow/Webhook Validation Action",
    });
    const valAuth = validation.fields.find((f) => f.fieldName === "Authorization")!;
    expect(valAuth.value).toEqual({
      kind: "ref-path",
      value: "/sitecore/system/Settings/Webhooks/Authorizations/CI",
    });
  });
});

describe("compileWorkflowRecipe — validation", () => {
  it("throws when initialState references an undeclared state", () => {
    expect(() =>
      compileWorkflowRecipe(
        minimalWorkflow({ initialState: "made-up" }),
        baseContext
      )
    ).toThrowError(/initialState='made-up'/);
  });

  it("throws when a command's nextState doesn't resolve", () => {
    expect(() =>
      compileWorkflowRecipe(
        minimalWorkflow({
          states: [
            {
              key: "draft",
              name: "Draft",
              displayName: "Draft",
              actions: [],
              commands: [
                {
                  key: "submit",
                  name: "Submit",
                  displayName: "Submit",
                  nextState: "ghost-state",
                  autoPublish: false,
                  suppressComment: false,
                  appearanceEvaluator: "default",
                  secured: false,
                  validations: [],
                },
              ],
            },
            { key: "approved", name: "Approved", displayName: "Approved", final: true, preview: false, actions: [], commands: [] },
          ],
        }),
        baseContext
      )
    ).toThrowError(/unknown nextState 'ghost-state'/);
  });

  it("throws when no state is marked final", () => {
    expect(() =>
      compileWorkflowRecipe(
        minimalWorkflow({
          states: [
            { key: "draft", name: "Draft", displayName: "Draft", final: false, preview: false, actions: [], commands: [] },
            { key: "approved", name: "Approved", displayName: "Approved", final: false, preview: false, actions: [], commands: [] },
          ],
        }),
        baseContext
      )
    ).toThrowError(/at least one state with final=true/);
  });

  it("throws when bindings.templates is non-empty (deferred feature)", () => {
    expect(() =>
      compileWorkflowRecipe(
        minimalWorkflow({ bindings: { templates: ["blog-article@1"] } }),
        baseContext
      )
    ).toThrowError(/bindings.templates/);
  });
});

describe("compileWebhookAuthorizationRecipe", () => {
  const apiKeyRecipe: WebhookAuthorizationRecipe = WebhookAuthorizationRecipeSchema.parse({
    kind: "webhook-authorization",
    schemaVersion: "1",
    handle: "ci-bearer@1",
    name: "CI Bearer",
    displayName: "CI Bearer Token",
    auth: {
      type: "ApiKey",
      headerName: "Authorization",
      key: "$ENV:CI_WEBHOOK_TOKEN",
    },
  });

  it("emits one CreateItem under /sitecore/system/Settings/Webhooks/Authorizations", () => {
    const ir = compileWebhookAuthorizationRecipe(apiKeyRecipe, baseContext);
    const op = ir.operations[0] as CreateItemOp;

    expect(ir.operations).toHaveLength(1);
    expect(op.op).toBe("CreateItem");
    expect(op.id).toBe(webhookAuthorizationId("ci-bearer@1"));
    expect(op.path).toBe("/sitecore/system/Settings/Webhooks/Authorizations/CI Bearer");
    expect(op.templateOf).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/System/Webhooks/Authorizations/Api Key",
    });
  });

  it("writes auth-type-specific fields", () => {
    const ir = compileWebhookAuthorizationRecipe(apiKeyRecipe, baseContext);
    const op = ir.operations[0] as CreateItemOp;

    const headerField = op.fields.find((f) => f.fieldName === "Header Name")!;
    expect(headerField.value).toEqual({ kind: "string", value: "Authorization" });
    const keyField = op.fields.find((f) => f.fieldName === "Key")!;
    expect(keyField.value).toEqual({ kind: "string", value: "$ENV:CI_WEBHOOK_TOKEN" });
  });

  it("routes Basic and OAuth2 auth types to distinct templates", () => {
    const basicRecipe = WebhookAuthorizationRecipeSchema.parse({
      kind: "webhook-authorization",
      schemaVersion: "1",
      handle: "basic@1",
      name: "Basic",
      displayName: "Basic",
      auth: { type: "Basic", username: "ci", password: "$ENV:CI_PASS" },
    });
    const oauthRecipe = WebhookAuthorizationRecipeSchema.parse({
      kind: "webhook-authorization",
      schemaVersion: "1",
      handle: "oauth@1",
      name: "OAuth",
      displayName: "OAuth",
      auth: {
        type: "OAuth2ClientCredentialsGrant",
        tokenEndpoint: "https://auth.example.com/token",
        clientId: "ci",
        clientSecret: "$ENV:CI_SECRET",
        scope: "webhook:write",
      },
    });

    const basicIr = compileWebhookAuthorizationRecipe(basicRecipe, baseContext);
    const oauthIr = compileWebhookAuthorizationRecipe(oauthRecipe, baseContext);
    const basicOp = basicIr.operations[0] as CreateItemOp;
    const oauthOp = oauthIr.operations[0] as CreateItemOp;

    expect(basicOp.templateOf).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/System/Webhooks/Authorizations/Basic",
    });
    expect(oauthOp.templateOf).toEqual({
      kind: "ref-path",
      value:
        "/sitecore/templates/System/Webhooks/Authorizations/OAuth2 Client Credentials Grant",
    });
    expect(oauthOp.fields.find((f) => f.fieldName === "Scope")?.value).toEqual({
      kind: "string",
      value: "webhook:write",
    });
  });
});
