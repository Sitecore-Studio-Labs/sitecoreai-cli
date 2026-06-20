---
"@sitecoreai-labs/sitecoreai-cli": minor
---

feat(campaigns): campaign icon + attachment SDK foundation

- Add `thumbnailUrl` to the campaign recipe — the project `thumbnail_url`,
  threaded through create (`createProject`), the recipe diff (create +
  update metas), and apply (`readCurrent` / `applyProjectFieldUpdate`).
- Add `attachProjectAttachment()` / `deleteProjectAttachment()` plus the
  `AttachmentMetadata` type (POST/DELETE `/projects/{id}/attachments/{fileId}`).

Both take an MMS **mediaId** (the trailing segment of the file's
`mms-delivery` URL). Producing a viewable mediaId requires the MMS upload
flow (scope `mms.upload.file:add`), which scai's M2M credentials don't
carry — so these accept an existing mediaId. The campaign-side wiring is
complete and verified live; the byte-upload step is tracked separately.
