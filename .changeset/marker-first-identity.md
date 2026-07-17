---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Recipe push: marker-first identity for content-item name-twins. A CreateOnly create whose existing name-twin carries a `Scai Handle` marker from a DIFFERENT recipe family now fails at plan time with a precise cross-recipe name-collision error naming both owners — instead of adopting the foreign item and aborting on the first field its template can't resolve ("Cannot find a field with the name Title/HasPanel", the blank-environment batch aborts). Versionless handle-base compare keeps re-versioned recipes (`@1`→`@2`) owning their items. Additionally, fieldless content-item creates whose fields ride separate SetField ops in the same push are now convergence-eligible (the create carries `retemplateOnAdopt`), closing the eligibility hole that let wrong-template twins through to the field writes.
