---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Push failure summaries now name the op that actually errored. `DEPLOY_FAILED` abort details previously quoted the aborted recipe's last plan action — often a benign trailing skip like "Field already at desired value" — while the real apply-error hid in truncated event logs. The summary now surfaces the action the executor stamped `status: "error"` onto, with the last action kept only as a fallback.
