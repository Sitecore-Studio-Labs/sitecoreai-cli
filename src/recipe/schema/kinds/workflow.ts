import { z } from "zod";
import { HANDLE_PATTERN, RecipeMetaSchema } from "../shared";

// ─────────────────────────────────────────────────────────────────────
// Workflow + webhook recipes
//
// Full reference (behavior, payload, endpoint contract, auth types,
// failure modes, troubleshooting): docs/recipes/workflow.md
// ─────────────────────────────────────────────────────────────────────

/**
 * Stable, kebab-case key for a workflow state or command. Used as part
 * of the deterministic GUID seed — renaming a key creates a different
 * item (and orphans transitions that pointed at the old key). Format
 * is restricted to lowercase letters, digits, and hyphens so the
 * generated content-tree paths stay URL-safe across all Sitecore
 * tenants without re-quoting.
 */
const WorkflowKeyPattern = /^[a-z][a-z0-9-]*$/;
const WorkflowKey = z.string().regex(WorkflowKeyPattern, {
  message: "key must match `^[a-z][a-z0-9-]*$` (lowercase, kebab)",
});

/** `$ENV:VAR_NAME` reference — secrets never inline in the recipe file. */
const SecretRef = z.string().regex(/^\$ENV:[A-Z_][A-Z0-9_]*$/, {
  message: "use $ENV:NAME for secret values; never inline plaintext credentials",
});

/**
 * Webhook authorization recipe — declares a reusable `Webhook
 * Authorization` item under `/sitecore/system/Settings/Webhooks/Authorizations`.
 * Workflow webhook actions and event handlers reference one of these
 * via `authorizationRef: <handle>`.
 *
 * The authorization templates live under
 * `/sitecore/templates/System/Webhooks/Authorizations/...`. The
 * compiler emits `templateOf: { kind: "ref-path", value: ... }` so the
 * push pipeline resolves the template GUID at apply time — these
 * GUIDs aren't published as a public contract.
 *
 * Secrets are always by `$ENV:VAR_NAME` reference; the apply step
 * resolves the env var at push time. Missing env vars surface as a
 * plan-phase error before any item write.
 */
const WebhookAuthorizationApiKeySchema = z.object({
  type: z.literal("ApiKey"),
  /** Header name to attach (e.g. `X-Api-Key`, `Authorization`). */
  headerName: z.string().min(1),
  /** `$ENV:VAR_NAME` reference to the key/token. */
  key: SecretRef,
});

const WebhookAuthorizationBasicSchema = z.object({
  type: z.literal("Basic"),
  username: z.string().min(1),
  password: SecretRef,
});

const WebhookAuthorizationOAuth2Schema = z.object({
  type: z.literal("OAuth2ClientCredentialsGrant"),
  tokenEndpoint: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: SecretRef,
  scope: z.string().optional(),
  audience: z.string().optional(),
});

export const WebhookAuthorizationRecipeSchema = z.object({
  kind: z.literal("webhook-authorization"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. ci-bearer@1",
  }),
  /** Sitecore item name. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  auth: z.discriminatedUnion("type", [
    WebhookAuthorizationApiKeySchema,
    WebhookAuthorizationBasicSchema,
    WebhookAuthorizationOAuth2Schema,
  ]),
});

export type WebhookAuthorizationRecipe = z.infer<typeof WebhookAuthorizationRecipeSchema>;

/**
 * Either an intra-recipe reference to a `webhook-authorization` recipe
 * (`authorizationRef: <handle>`) or an absolute content-tree path
 * (`authorizationPath: /sitecore/system/Settings/Webhooks/Authorizations/...`)
 * to an existing tenant-side Authorization item. Exactly one of the two
 * (enforced via superRefine on the workflow recipe).
 */
const WebhookActionAuthRefSchema = z.object({
  authorizationRef: z.string().regex(HANDLE_PATTERN).optional(),
  authorizationPath: z.string().startsWith("/sitecore/").optional(),
});

const WebhookActionBaseSchema = WebhookActionAuthRefSchema.extend({
  /**
   * Sitecore item name for the action item. Derived from the action's
   * key within its state/command (e.g. `notify-reviewer`) — must be
   * unique among siblings under that state or command.
   */
  key: WorkflowKey,
  url: z.string().url(),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  serializationType: z.enum(["JSON", "XML"]).default("JSON"),
  enabled: z.boolean().default(true),
});

const WebhookSubmitActionSchema = WebhookActionBaseSchema.extend({
  kind: z.literal("webhook-submit"),
});

const WebhookValidationActionSchema = WebhookActionBaseSchema.extend({
  kind: z.literal("webhook-validation"),
});

const WorkflowActionSchema = z.discriminatedUnion("kind", [
  WebhookSubmitActionSchema,
  WebhookValidationActionSchema,
]);

const AppearanceEvaluatorSchema = z.enum(["default", "lock", "unlock"]);

const WorkflowCommandSchema = z.object({
  key: WorkflowKey,
  name: z.string().min(1),
  displayName: z.string().min(1),
  nextState: WorkflowKey,
  /** Maps to the standard `__Auto Publish` field on a workflow Command. */
  autoPublish: z.boolean().default(false),
  /** Maps to the standard `Suppress comment` field — silences the comment prompt. */
  suppressComment: z.boolean().default(false),
  /** Maps to `Appearance Evaluator Type`. */
  appearanceEvaluator: AppearanceEvaluatorSchema.default("default"),
  /**
   * When true, the compiler emits a `SetField` to restrict the command
   * to administrators (sets the standard `__Security` field with a
   * deny-everyone ACL plus an allow-admin ACL). Suitable for sensitive
   * commands like "Publish to Production" that shouldn't be available
   * to all reviewers.
   */
  secured: z.boolean().default(false),
  /** Validation actions attached to this command (synchronous gates). */
  validations: z.array(WebhookValidationActionSchema).default([]),
});

const WorkflowStateSchema = z.object({
  key: WorkflowKey,
  name: z.string().min(1),
  displayName: z.string().min(1),
  /** Maps to the standard `Final` checkbox on the State item. */
  final: z.boolean().default(false),
  /** Maps to `Preview` — items in this state appear in the preview database. */
  preview: z.boolean().default(false),
  /** Submit or validation actions that fire on entry into this state. */
  actions: z.array(WorkflowActionSchema).default([]),
  commands: z.array(WorkflowCommandSchema).default([]),
});

const WorkflowBindingsSchema = z
  .object({
    /**
     * Templates to bind this workflow to. Each entry is either an
     * intra-recipe content-template handle (resolves via refKey) or an
     * absolute path to a tenant-existing template (resolves via
     * `crossRecipeRefs`). The compiler emits a `SetField` op against
     * each template's `__Standard Values` item setting the
     * `__Default workflow` field.
     */
    templates: z
      .array(
        z.union([z.string().regex(HANDLE_PATTERN), z.string().startsWith("/sitecore/templates/")])
      )
      .default([]),
  })
  .default({ templates: [] });

/**
 * Cross-field validations (`initialState` must match a declared state,
 * `nextState` refs must resolve, at least one final state, action auth
 * is `Ref` XOR `Path`) live in `compileWorkflowRecipe` — not on the
 * schema — because Zod's `discriminatedUnion` rejects `ZodEffects`
 * members and we need this schema in `RecipeSchema`. Same pattern
 * `EnumerationRecipeSchema` uses for its `default ∈ values` check.
 */
export const WorkflowRecipeSchema = z.object({
  kind: z.literal("workflow"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. blog-article-approval@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  /**
   * Optional taxonomy metadata. `meta.tax.group` is the only field
   * the compiler currently consumes — it drives a one-level Workflow
   * Folder under `/sitecore/system/Workflows/<group>/<name>`. Other
   * fields are accepted for registry → recipe pipeline compatibility
   * but aren't load-bearing.
   */
  meta: RecipeMetaSchema,
  /** State key of the workflow's initial state (must match one of `states`). */
  initialState: WorkflowKey,
  states: z.array(WorkflowStateSchema).min(1),
  bindings: WorkflowBindingsSchema,
});

export type WorkflowRecipe = z.infer<typeof WorkflowRecipeSchema>;
