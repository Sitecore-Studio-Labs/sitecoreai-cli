# `agents` area — unstable surface & follow-ups

The `agents` area (Sitecore **Agentic Studio**) is a deliberate **stopgap**.
Agentic Studio has no machine-credential auth and no published, versioned
API — the whole area is reverse-engineered from HAR captures. This file
inventories every point that is fragile by construction: what it is,
where it lives, what breaks it, and what replaces it.

Severity:

- **HIGH** — breaks on a Sitecore-side change with no warning and no
  automatic recovery.
- **MED** — fragile, but self-healing or env-overridable.
- **LOW** — a known limitation or consistency gap, stable until the
  product changes shape.

Code markers: `grep -rn "UNSTABLE\|TEMPORARY" src/agents`.

---

## 1. Auth — the entire model is a stopgap

scai's other areas authenticate with client-credentials OAuth. Agentic
Studio's BFF is gated by a **first-party browser session cookie**, so this
area can't.

| Item                                         | Where                                                   | Severity | Notes                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie-gated BFF, no machine credentials     | `session/`                                              | HIGH     | The reason the whole area is a stopgap.                                                                                                                                                                                       |
| Playwright browser login                     | `session/playwright-login.ts`                           | MED      | Only Playwright touch point; `playwright-core` is an isolated optional dep. Interactive headed sign-in (MFA) — **workstation-only, no CI/headless path**.                                                                     |
| Browser-fingerprint headers                  | `session/index.ts` (`browserHeaders`), `api/request.ts` | HIGH     | The edge WAF answers **HTTP 406** to non-browser callers, so every request replays a captured `User-Agent` + static `sec-*`/`Origin`/`Referer`. Breaks if the WAF tightens (e.g. cross-validates `sec-ch-ua` against the UA). |
| Login-completion detector                    | `session/playwright-login.ts`                           | MED      | Polls `GET /api/agents` for `200` to know sign-in finished. Breaks if `/api/agents` changes its unauthenticated behavior.                                                                                                     |
| Cookie injection (`agentsSessionFromCookie`) | `session/index.ts`                                      | MED      | For a future Marketplace app — depends on that app being able to read the first-party cookie (cross-origin caveat, unproven).                                                                                                 |

**Replacement:** when Sitecore exposes ordinary user credentials — add a
`kind: "bearer"` arm to `AgentsCredential`, branch in `createAgentsSession`
(`authHeaders` → `Authorization`), delete `playwright-login.ts`, drop
`playwright-core`, drop `browserHeaders`. The transport and everything
above it is unaffected — that is the point of the `AgentsSession` seam.

## 2. Server-action writes — schemas & html-templates

`schema` and `html-template` creation are **Next.js server actions**, not
`/api/` routes. There is no clean write endpoint.

| Item                                  | Where                                                                              | Severity | Notes                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSchema` / `createHtmlTemplate` | `api/schemas.ts`, `api/html-templates.ts`, `api/request.ts` (`agentsServerAction`) | HIGH     | POST `/schemas/create` & `/html-templates/create` with a `Next-Action` header.                                                                                                                                                                                                                  |
| Action hash rotates per deploy        | discovery: `playwright-login.ts` (`discoverActionHash`)                            | MED      | `scai agents login` scans the create pages' chunks for `createServerReference("<hash>",…)` and stores the hashes on the credential. Fallbacks: `SITECOREAI_SCHEMA_ACTION` / `SITECOREAI_HTML_TEMPLATE_ACTION`, then a hard-coded constant. A rotation **self-heals on next login**.             |
| Reverse-engineered Next.js internals  | `api/request.ts`, `api/schemas.ts`, `api/html-templates.ts`                        | HIGH     | The `createServerReference` discovery regex, the `Next-Router-State-Tree` constants, the `$undefined` (`RSC_UNDEFINED`) arg encoding, and the `[prevState, payload]` arg tuple are all reverse-engineered. A Next.js major upgrade on Sitecore's side can change any of them — not auto-healed. |

**Replacement:** real `POST /api/schemas` / `POST /api/html-templates`.
Then delete `agentsServerAction` and the per-file server-action machinery.

## 3. Reverse-engineered `/api/*` surface

| Item                             | Where                   | Severity | Notes                                                                                                               |
| -------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Whole `/api/*` contract          | `api/`                  | MED      | Reverse-engineered from HARs, unversioned, no OpenAPI. Shapes carry `[key: string]: unknown` and parse defensively. |
| `graphType` for a run            | `api/runs.ts`           | MED      | Agent slug for a standard agent, flow id for a workflow — inferred from observed runs.                              |
| Agent-create returns `[{agent}]` | `api/agents.ts`         | LOW      | The POST response is a single-element array; observed, unwrapped.                                                   |
| `GET /api/html-templates` path   | `api/html-templates.ts` | MED      | Inferred from the `/html-templates` page — the GET itself was never directly captured.                              |
| Partial response shapes          | `api/schema.ts`         | LOW      | schema / brand-kit / jobs shapes were seen empty or partial; typed loosely.                                         |

**Replacement:** a published, versioned Sitecore API + OpenAPI — then
`api/schema.ts` becomes generated, not hand-typed.

## 4. Known limitations & consistency gaps (stable, but bounded)

| Item                                                                        | Where                                    | Severity | Notes                                                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| No verified UPDATE for skill / widget / custom-mcp / schema / html-template | `recipe/*.kind.ts`, `recipe/converge.ts` | LOW      | Those recipe kinds are **create-only** — an existing resource is reported `noop`, never converged. Only `agent` has create + update. |
| `tools` is read-only                                                        | `api/tools.ts`                           | LOW      | A platform catalog, not an authored resource — no recipe kind.                                                                       |
| Runs accumulate spaces                                                      | `api/spaces.ts`, `api/runs.ts`           | LOW      | Every run creates a space; the BFF exposes no space-delete.                                                                          |

## Cross-area note — region resolution (resolved)

Surfaced while building this area: scai had **no shared region/host
convention** — campaign, brief, and agents each invented their own. Now
closed. `src/shared/region.ts` derives the region from the organization
id via the Platform Inventory API (`api/inventory/v1/tenants`);
`resolveRegionalBaseUrl` (campaign + brief hosts) and `resolveRegionCode`
(the `scai agents login` `--region` default) both route through it.
`sites` stays single-host; `campaignBaseUrl` / `briefBaseUrl` survive as
explicit per-env overrides.

---

## Retirement

The area is built to be deleted in pieces as Sitecore ships proper
surfaces:

1. **User credentials** → retire §1 (Playwright, cookie, browser headers).
2. **`/api/schemas` + `/api/html-templates` write endpoints** → retire §2.
3. **A versioned, documented API** → retire §3 (generate `api/schema.ts`).

See also the `project_scai_agentic_studio_api` memory and
`docs/recipe-sync-architecture.md` for the recipe/sync model.
