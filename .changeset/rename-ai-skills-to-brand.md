---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`ai-skills` renamed to `brand` — the credential is named for what it powers.**

The credential formerly called "AI Skills" backs exactly one thing: the
`scai brand` command surface (Brand Management, Review, Documents,
Pipeline). It is unrelated to Deploy, CM, Brief, and Campaign — those
all ride the env automation client. So it is now `brand` throughout.

- **Command:** `scai setup login ai-skills` → `scai setup login brand`.
  `ai-skills` (and `aiskills`, `ai-skill`, `aiskill`) stay as aliases,
  so existing invocations keep working.
- **Config:** the `aiSkills` block in `sitecoreai.cli.json` is now
  `brand`. Existing configs stay readable — a legacy `aiSkills` block is
  still honored — and the CLI writes `brand` going forward. The JSON
  schema accepts both, with `aiSkills` marked deprecated.
- **`setup status`** shows the credential row as `brand:` (was
  `ai skills:`).
- **SDK exports renamed:** `acquireAiSkillsToken` → `acquireBrandToken`,
  `AiSkillsCredential` → `BrandCredential`, `AI_SKILLS_API_HOST` →
  `BRAND_API_HOST`, `AI_SKILLS_REQUIRED_SCOPES` → `BRAND_REQUIRED_SCOPES`,
  and the `AUTH_AI_SKILLS_REQUIRED` error code → `AUTH_BRAND_REQUIRED`.
- **No re-login needed.** The OS-keychain storage keys were deliberately
  kept stable, so already-stored brand secrets and tokens still resolve.

The underlying Sitecore key is still created in Cloud Portal under
"Stream → Admin → AI APIs keys" — that is Sitecore's term, and the help
text keeps it.
