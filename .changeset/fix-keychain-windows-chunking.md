---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Fix credential writes silently failing on Windows when a secret exceeds the
Windows Credential Manager 2560-byte blob limit. Sitecore access tokens
(deploy/CM/publishing/brief/campaign) and the CM token bundle routinely
exceed it, which made `scai setup login` report success while the keychain
write was rejected. Large secrets are now transparently split across
companion keychain entries and reassembled on read; values that fit are
stored unchanged, so existing credentials keep working. Keychain write
failures also now surface the underlying error in the warning instead of
being silently swallowed.
