---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Hardens two security-adjacent paths and clears a sweep of CodeQL +
AI-suggested findings:

- `scai setup login` (Windows): the device-flow browser launcher now
  validates the URL via `new URL()` and switches the Windows code path
  from `cmd /c start "" <url>` (shell:true) to
  `rundll32 url.dll,FileProtocolHandler <url>` so shell metacharacters
  in a hostile verification URI can't chain commands. Closes the CodeQL
  `js/command-line-injection` finding.
- `scai setup login --use-brand`: the AI-APIs-client detector matches
  the actual scope namespace (`ai.org.`) rather than the bare `ai.org`
  prefix, removing a spurious-match window against any scope that
  happens to start with those characters. Closes the CodeQL
  `js/incomplete-url-substring-sanitization` finding.

Plus internal reliability cleanups (collapsed five redundant `??` /
`&&` fallbacks flagged by `js/useless-expression`), CI workflow
`permissions: contents: read` hardening on `ci.yml` + `smoke.yml`, a
test-cleanup try/finally on the headless-CLI test, a corrected
`RecipeInputResolution` mock value in `recipe push` tests, and three
CHANGELOG markdown list-formatting repairs.
