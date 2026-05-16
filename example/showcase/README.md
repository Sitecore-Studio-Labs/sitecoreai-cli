# Showcase recipe set

A **coherent, end-to-end recipe set** — every handle resolves, it passes
`validateRecipeSet`, and it pushes cleanly to a tenant. Unlike the
illustrative snippets in [`../recipes/`](../recipes/) (which exercise
schema parsing in isolation and intentionally leave cross-recipe
references dangling), this directory is a complete vertical slice of the
design system, safe to push as a unit.

## What it covers

| Recipe | Kind | Role |
| ------ | ---- | ---- |
| `cta.recipe.ts` | `component-template` | A placeable CTA button |
| `rich-text.recipe.ts` | `component-template` | A placeable rich-text block |
| `main-placeholder.recipe.ts` | `placeholder` | `headless-main` page-body slot (folder: `Page Designs`) |
| `header-placeholder.recipe.ts` | `placeholder` | `/header` slot (folder: `Partial Designs`) |
| `header.recipe.ts` | `partial-design` | Header partial — places the CTA into `/header` |
| `page.recipe.ts` | `page-template` | The page template (SXA Headless page base set) |
| `design.recipe.ts` | `page-design` | Wraps the header partial, seeds the page body |
| `home.recipe.ts` | `page` | The home page — conforms to the template, scoped datasource |

Together they exercise: component templates + renderings + variants,
the hybrid placeholder model (`Allowed Controls` whitelists +
placement-legality validation), page templates with SXA base
inheritance, partial/page designs with layout XML, and a page item with
a `scoped` page-local datasource.

## Push it

The set has its own [`sitecoreai.cli.json`](./sitecoreai.cli.json) (recipe
glob + a `showcase` env profile) so it pushes in isolation:

```bash
# dry-run
scai provision recipe push --config example/showcase/sitecoreai.cli.json -n showcase --what-if

# apply
scai provision recipe push --config example/showcase/sitecoreai.cli.json -n showcase --allow-write
```

Client-credentials come from the environment (`SITECOREAI_CLIENT_ID` /
`SITECOREAI_CLIENT_SECRET`); point the `showcase` profile's `recipeRoots`
at your tenant before pushing.

## Verify it locally

`_verify.ts` validates + compiles the set without tenant access:

```bash
pnpm exec tsx -r tsconfig-paths/register example/showcase/_verify.ts
```
