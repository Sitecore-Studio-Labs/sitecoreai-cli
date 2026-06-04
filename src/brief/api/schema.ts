/**
 * Brief API response schema — hand-written from observed payloads.
 *
 * The API has no published OpenAPI spec at time of writing, so these
 * types reflect what `scripts/_smoke-brief-shapes.ts` captured against
 * the Agents env on 2026-05-14. Re-run that probe and diff this file
 * if the API surface changes.
 *
 * Conventions observed across the API:
 *  - List endpoints return a paged envelope: `{ totalCount, next, data }`
 *  - References use a discriminated union (`Link` vs `ExternalLink`)
 *  - Internal IDs are GUIDs; external IDs carry their provenance
 *    (`auth0|...`, `<clientId>@clients`)
 *  - Localized strings are keyed by BCP-47-ish locale (`{ "en-us": "..." }`)
 *  - Timestamps are ISO-8601 with sub-second precision
 */

/** Paged list envelope returned by every Brief list endpoint. */
export type PagedResult<T> = {
  totalCount: number;
  /** Cursor for the next page, or null at end of stream. Shape TBD — pass through verbatim. */
  next: string | null;
  data: T[];
};

/** Localized label: BCP-47-ish locale (e.g. `en-us`) → string. */
export type LocalizedString = Record<string, string>;

/** Reference to another resource inside the Brief API itself. */
export type Link = {
  type: "Link";
  /** The resource kind the link points at, e.g. `BriefType`. */
  relatedType: string;
  /** GUID of the related resource. */
  id: string;
  /** Absolute URI you can GET to dereference. */
  uri: string;
};

/** Reference to a resource owned by a sibling Sitecore Cloud service. */
export type ExternalLink = {
  type: "ExternalLink";
  /** Source system slug, e.g. `xmcloud`, `co`. */
  relatedSystem: string;
  relatedType: string | null;
  /** Foreign identifier — Auth0 subject, client-credentials principal, etc. */
  id: string;
};

export type Reference = Link | ExternalLink;

/**
 * BriefType field definition — discriminated on `type`. The Brief API
 * uses these to drive UI form generation and feed `aiIntent` hints to
 * downstream AI assistants editing the brief's content.
 */
export type BriefFieldBase = {
  name: string;
  label: LocalizedString;
  helpText?: LocalizedString;
  required: boolean;
  /** Whether AI assistants may write this field. Read for `aiIntent` either way. */
  aiEditable: boolean;
  /** Free-form prompt the API ships to AI clients describing how to fill the field. */
  aiIntent?: string;
};

export type RichTextField = BriefFieldBase & { type: "RichText" };
export type DateTimeField = BriefFieldBase & { type: "DateTime" };
export type TimelineField = BriefFieldBase & {
  type: "Timeline";
  /** Schedule calculation strategy enum — observed values include `0`. Semantics TBD. */
  calculation: number;
  skipHolidays: boolean;
  skipWeekend: boolean;
  /** IANA tz string, may be empty. */
  timezone: string;
};
export type BudgetField = BriefFieldBase & {
  type: "Budget";
  /** ISO-4217 currency codes the field accepts. */
  currencies: string[];
};

/** Union of every observed field kind. New kinds will widen this union. */
export type BriefField = RichTextField | DateTimeField | TimelineField | BudgetField;

/** BriefType — the schema template a brief instance is built against. */
export type BriefType = {
  id: string;
  /** Stable codename, e.g. `Creative`. */
  name: string;
  /** Localized human label. */
  label: LocalizedString;
  /** mdi icon codepoint name. */
  icon: string;
  iconColor: string;
  description: string;
  /** Field definitions in display order. */
  fields: BriefField[];
  createdOn: string;
  createdBy: Reference;
  updatedOn: string;
  updatedBy: Reference;
};

/**
 * Brief workflow status. The full enum was surfaced by the API's own
 * validation error (2026-05-15): "Status must be one of: Approved,
 * InReview, Draft, Canceled, Archived". `InReview` is the wire value
 * for the "In Review" UI label.
 */
export type BriefStatus = "Draft" | "InReview" | "Approved" | "Canceled" | "Archived";

/**
 * Brief instance — the unit of work. `status` is freely writable via
 * `PUT /briefs/{id}` (not workflow-gated).
 */
export type Brief = {
  id: string;
  icon: string | null;
  name: string;
  status: BriefStatus;
  /** BCP-47-ish locale, e.g. `en-us`. */
  locale: string;
  /** Field values keyed by `BriefField.name`. Shape per-field TBD. */
  fields: Record<string, unknown>;
  briefType: Link;
  isTemplate: boolean;
  /** Inline collections returned with the brief. May be empty on list responses. */
  comments: BriefComment[];
  /** To-dos on the brief. Wire field is `tasks`; the UI/CLI label is "to-do". */
  tasks: BriefTask[];
  references: Reference[];
  contributors: Reference[];
  externalMappings: ExternalMapping[];
  createdOn: string;
  createdBy: Reference;
  updatedOn: string;
  updatedBy: Reference;
};

/** Cross-system mapping rows tying a brief to records in other Sitecore Cloud services. */
export type ExternalMapping = Record<string, unknown>;

/**
 * Task on a brief. Verified against TestDemo 2026-06-03 — persisted
 * fields are `{id, title, status, assignees, brief, createdOn,
 * createdBy, updatedOn, updatedBy}`. `assignees` is only populated on
 * list responses when the request includes `MetadataToLoad=assignees`;
 * other shapes leave it absent.
 *
 * Naming note: the Content Operations UI — and scai's CLI/MCP surface —
 * call these "to-dos". This wire type keeps the API's `task` naming for
 * fidelity; the user-facing label is "to-do" (`scai ops brief todos`).
 */
export type BriefTask = {
  id: string;
  title: string;
  status?: string;
  assignees?: Reference[];
  brief?: Reference;
  createdOn?: string;
  createdBy?: Reference;
  updatedOn?: string;
  updatedBy?: Reference;
};

/**
 * Comment on a brief. Shape is **provisional** — no comment payload
 * was captured during reverse-engineering. Re-probe when comments
 * exist.
 */
export type BriefComment = {
  id: string;
  [key: string]: unknown;
};
