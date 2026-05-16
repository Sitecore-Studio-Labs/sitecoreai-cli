---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Phase D — recipe client factories + Authoring GraphQL escape hatch.**

Extends the existing `@sitecoreai-labs/sitecoreai-cli/recipe` public
surface with three additions library consumers need to build their
own recipe-execution flows without re-implementing the wire-protocol
semantics. Purely additive — no existing `./recipe` consumer breaks.

New exports from `./recipe`:

- **`createAuthoringClient(options: AuthoringClientOptions): AuthoringApiClient`** —
  production factory for scai's `AuthoringApiClient` implementation.
  Includes path-resolution, parent-folder auto-creation (Folder /
  Template Folder / Rendering Folder / HeadlessVariantsGrouping
  template selection), and retry-on-throttle for read GETs. Library
  consumers that want the same wire protocol as `scai recipe push`
  use this factory directly. The interface-only `AuthoringApiClient`
  export was already public — this adds the implementation seam.
- **`createSitesApiClient(options: SitesApiClientOptions): SitesApiClient`** —
  production factory for the Sites API client surface used by recipe
  execution (`createSite`, `getJobStatus`, `listSites`,
  `listSiteTemplates`, `listCollections`, `listLanguages`,
  `addLanguage`). Adapter over `src/sites/api/*` function-style API.
  Sites types — `Job`, `JobResponse`, `Language`, `NewSiteInput`,
  `Site`, `SiteCollection`, `SiteTemplate` — are also re-exported.
- **`runAuthoringGraphQL` + `AuthoringRequestOptions`** — ad-hoc
  Authoring GraphQL escape hatch sharing retry / timeout / auth /
  redaction with `createAuthoringClient`. Use this when scai's typed
  clients don't cover the query/mutation you need but you want the
  same transport semantics.

Nothing renamed, nothing relocated — these symbols already existed at
`src/recipe/api/authoring-client.ts`, `src/recipe/api/sites-client.ts`,
and `src/recipe/api/graphql.ts`. Phase D just makes them part of the
public contract.
