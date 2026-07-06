---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Image-defaults substitution now materialises brand images as shared site-level media items: a role-substituted image uploads ONCE per (site, role, URL) into the `Defaults` folder under the media-library root (`<root>/Defaults/<role>-<hash>`), and every component or content item mapping that role references the same media item. Role-annotated image fields with no authored default also materialise the mapped URL now — the role alone declares the dependency, no throwaway stock URL required.
