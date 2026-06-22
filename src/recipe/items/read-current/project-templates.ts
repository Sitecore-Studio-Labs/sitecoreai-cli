/**
 * Templates-family reverse-projection (`read-current`).
 *
 * The non-layout, non-content kinds whose item layout is a `TEMPLATE` /
 * `TEMPLATE_FOLDER` / `Enumeration` tree:
 *   - component-template, content-template, page-template
 *   - component-section (a Template Folder under componentsRoot)
 *   - enumeration (an Enumeration container under enumerationsRoot)
 *
 * Plus the two tree walkers that discover and classify these items
 * (`walkTemplatesTree`, `walkEnumerationsTree`) and the rendering-name index
 * (`collectRenderingComponentNames`) the template classifier consults.
 *
 * See `../read-current.ts` for the module-level contract.
 */

import type { AuthoringApiClient, RemoteItem } from "../../api/client";
import { RENDERING_FIELDS, SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../../ir/sitecore-templates";
import type {
  ComponentSectionRecipeParsed,
  ComponentTemplateRecipeParsed,
  ContentTemplateRecipeParsed,
  EnumerationRecipeParsed,
  PageTemplateRecipeParsed,
  Recipe,
} from "../../schema/recipe";
import {
  byTreeOrder,
  conformsTo,
  fieldValue,
  fieldValueByName,
  fieldsOfTemplate,
  handleOf,
  hasSxaComponentBases,
  hasSxaPageBases,
} from "./helpers";

/**
 * Reverse-project one component-template `TEMPLATE` item (paired with its
 * rendering) into a `ComponentTemplateRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, falling back to
 * `name`), `description`, and the full `fields[]` tree (sections + fields).
 *
 * LOSSY / omitted:
 *  - `handle` is the `Scai Handle` marker, or synthesised from `name` for an
 *    unmarked item (see `handleOf`).
 *  - `section` reference — the component lives *under* a section folder, and
 *    the section is its own recipe with its own handle; the caller resolves
 *    that section's handle (marker-aware) and threads it in here. When the
 *    component sits flat under a root, `section` is omitted.
 *  - `variants`, `params`, `datasource`, `insertOptions`,
 *    `placedIn`, `placeholders`, `children`, `parameters`, `dynamicPlaceholders`,
 *    `otherProperties` — these live in separate trees (Headless Variants,
 *    Presentation Parameters, Available Renderings, Placeholder Settings) or
 *    in the rendering's URL-encoded blobs. v1 reverse-projection captures
 *    the template + datasource fields only; the schema defaults ([]/false)
 *    cover the rest. The rendering item is detected (to classify the
 *    template as a component) but its `OtherProperties` / `Datasource
 *    Location` are not decoded.
 */
const componentTemplateFromItem = async (
  templateItem: RemoteItem,
  sectionHandle: string | undefined,
  client: AuthoringApiClient
): Promise<ComponentTemplateRecipeParsed> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: ComponentTemplateRecipeParsed = {
    kind: "component-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
    // Schema defaults — not reverse-projected in v1 (see JSDoc).
    variants: [],
    params: [],
    placedIn: [],
    placeholders: [],
    dynamicPlaceholders: false,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (sectionHandle) {
    recipe.section = { handle: sectionHandle };
  }
  return recipe;
};

/**
 * Reverse-project one content-template `TEMPLATE` item into a
 * `ContentTemplateRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, and the `fields[]` tree.
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked item (see `handleOf`); `meta.tax.group` is
 * reconstructed from the Content Models group folder the template sits under
 * (threaded in by the caller); `insertOptions` and `defaultWorkflow` are not
 * reverse-projected (they live on the `__Standard Values` item's
 * `__Masters` / `__Default workflow` fields as GUID lists that would need
 * resolving back to handles).
 */
const contentTemplateFromItem = async (
  templateItem: RemoteItem,
  group: string | undefined,
  client: AuthoringApiClient
): Promise<ContentTemplateRecipeParsed> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: ContentTemplateRecipeParsed = {
    kind: "content-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  if (group) recipe.meta = { tax: { group } };
  return recipe;
};

/**
 * Reverse-project one page-template `TEMPLATE` item into a
 * `PageTemplateRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, and the `fields[]`
 * tree (the page-specific fields on top of the inherited SXA base).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker or synthesised
 * from `name`; `insertOptions`, `layout` (the standard-values
 * `__Renderings` shell), and `defaultWorkflow` are not reverse-projected
 * — the same omissions as `contentTemplateFromItem`, plus layout-XML
 * reverse parsing which v1 doesn't do.
 */
const pageTemplateFromItem = async (
  templateItem: RemoteItem,
  client: AuthoringApiClient
): Promise<PageTemplateRecipeParsed> => {
  const displayName =
    fieldValue(templateItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name") ?? templateItem.name;
  const description = fieldValueByName(templateItem, "__Long description");
  const fields = await fieldsOfTemplate(templateItem, client);

  const recipe: PageTemplateRecipeParsed = {
    kind: "page-template",
    schemaVersion: "1",
    handle: handleOf(templateItem),
    name: templateItem.name,
    displayName,
    fields,
  };
  if (description !== undefined && description !== "") recipe.description = description;
  return recipe;
};

/**
 * Reverse-project one component-section Template Folder into a
 * `ComponentSectionRecipe`.
 *
 * Faithful: `name`, `displayName` (`__Display name`, default `name`),
 * `description`, `icon` (`__Icon`), and `sortOrder` (`__Sortorder`).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked folder (see `handleOf`). The section's identity is
 * otherwise purely the folder — nothing else to recover.
 */
const componentSectionFromItem = (folderItem: RemoteItem): ComponentSectionRecipeParsed => {
  const displayName = fieldValue(folderItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
  const description = fieldValueByName(folderItem, "__Long description");
  const icon = fieldValue(folderItem, SYSTEM_FIELDS.ICON, "__Icon");
  const sortOrderRaw = fieldValue(folderItem, SYSTEM_FIELDS.SORT_ORDER, "__Sortorder");

  const recipe: ComponentSectionRecipeParsed = {
    kind: "component-section",
    schemaVersion: "1",
    handle: handleOf(folderItem),
    name: folderItem.name,
  };
  if (displayName !== undefined && displayName !== "" && displayName !== folderItem.name) {
    recipe.displayName = displayName;
  }
  if (description !== undefined && description !== "") recipe.description = description;
  if (icon !== undefined && icon !== "") recipe.icon = icon;
  if (sortOrderRaw !== undefined) {
    const n = Number.parseInt(sortOrderRaw, 10);
    if (Number.isFinite(n)) recipe.sortOrder = n;
  }
  return recipe;
};

/**
 * Reverse-project one `Enumeration`-container item into an
 * `EnumerationRecipe`.
 *
 * Faithful: `name`, `displayName`, `description`, the ordered `values[]`
 * (each value item's `name` + `displayName`), and `default` — read from the
 * container's `Value` shared field, kept only when it matches one of the
 * declared values (the compiler validates `default ∈ values`).
 *
 * LOSSY / omitted: `handle` is the `Scai Handle` marker, or synthesised from
 * `name` for an unmarked container (see `handleOf`); `location.folder` is
 * reconstructed by the caller from the grouping folders the container sits
 * under. An enumeration with no value items can't reverse-project (the
 * schema requires `values.min(1)`) — such a container is skipped by the
 * orchestrator with no error.
 */
const enumerationFromItem = async (
  containerItem: RemoteItem,
  folderSegments: string[],
  client: AuthoringApiClient
): Promise<EnumerationRecipeParsed | null> => {
  const valueItems = (await client.getChildren({ itemId: containerItem.itemId }))
    .filter((child) => child.name !== "__Standard Values")
    .sort(byTreeOrder);
  if (valueItems.length === 0) {
    // The schema requires values.min(1) — a value-less container is not a
    // reverse-projectable enumeration. Skip rather than emit invalid data.
    return null;
  }

  const values = valueItems.map((valueItem) => {
    const valueDisplayName = fieldValue(valueItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
    const value: EnumerationRecipeParsed["values"][number] = { name: valueItem.name };
    if (
      valueDisplayName !== undefined &&
      valueDisplayName !== "" &&
      valueDisplayName !== valueItem.name
    ) {
      value.displayName = valueDisplayName;
    }
    return value;
  });

  const displayName = fieldValue(containerItem, SYSTEM_FIELDS.DISPLAY_NAME, "__Display name");
  const description = fieldValueByName(containerItem, "__Long description");
  const defaultValue = fieldValueByName(containerItem, "Value");

  const recipe: EnumerationRecipeParsed = {
    kind: "enumeration",
    schemaVersion: "1",
    handle: handleOf(containerItem),
    name: containerItem.name,
    values,
  };
  if (displayName !== undefined && displayName !== "" && displayName !== containerItem.name) {
    recipe.displayName = displayName;
  }
  if (description !== undefined && description !== "") recipe.description = description;
  if (folderSegments.length > 0) {
    recipe.location = { scope: "site", folder: folderSegments };
  }
  // Only carry `default` when it names a real value — the compiler rejects
  // an out-of-range default, and a stale container `Value` is not intent.
  if (
    defaultValue !== undefined &&
    defaultValue !== "" &&
    values.some((v) => v.name === defaultValue)
  ) {
    recipe.default = defaultValue;
  }
  return recipe;
};

/**
 * Index every rendering item under `renderingsRoot` by component name, so a
 * candidate template can be classified as a component (has a rendering) vs.
 * a content template (no rendering). Returns a Set of component names — the
 * rendering's `Component Name` field, falling back to the item name.
 *
 * Returns an empty set when `renderingsRoot` resolves to no item.
 */
export const collectRenderingComponentNames = async (
  renderingsRoot: string,
  client: AuthoringApiClient
): Promise<Set<string>> => {
  const names = new Set<string>();
  const root = renderingsRoot ? await client.getItem({ path: renderingsRoot }) : null;
  if (!root) return names;

  const walk = async (parent: RemoteItem): Promise<void> => {
    const children = await client.getChildren({ itemId: parent.itemId });
    for (const child of children) {
      if (conformsTo(child, SITECORE_TEMPLATES.RENDERING)) {
        const componentName =
          fieldValue(child, RENDERING_FIELDS.COMPONENT_NAME, "ComponentName") ?? child.name;
        names.add(componentName);
        names.add(child.name);
      } else if (
        conformsTo(child, SITECORE_TEMPLATES.RENDERING_FOLDER) ||
        conformsTo(child, SITECORE_TEMPLATES.FOLDER)
      ) {
        await walk(child);
      }
    }
  };
  await walk(root);
  return names;
};

/**
 * Classify and reverse-project one `TEMPLATE` item. Page bases are checked
 * first — they're disjoint from component bases, and a page template is
 * neither a component nor a plain content shape.
 */
const templateRecipeFromItem = (
  child: RemoteItem,
  sectionHandle: string | undefined,
  group: string | undefined,
  renderingComponentNames: Set<string>,
  client: AuthoringApiClient
): Promise<Recipe> => {
  if (hasSxaPageBases(child)) {
    return pageTemplateFromItem(child, client);
  }
  if (hasSxaComponentBases(child) || renderingComponentNames.has(child.name)) {
    return componentTemplateFromItem(child, sectionHandle, client);
  }
  return contentTemplateFromItem(child, group, client);
};

/**
 * Walk every `TEMPLATE` item under a templates-tree root, reverse-projecting
 * each into either a component-template or content-template recipe.
 *
 * Templates are discovered by recursing through `TEMPLATE_FOLDER` items. A
 * `TEMPLATE_FOLDER` sitting *directly* under `componentsRoot` is itself a
 * component section and is emitted as a `ComponentSectionRecipe`; its
 * children are then component templates carrying that `section`.
 *
 * Classification of a `TEMPLATE` item:
 *  - has SXA component bases OR a matching rendering → component-template
 *  - otherwise → content-template
 */
export const walkTemplatesTree = async (
  rootPath: string,
  client: AuthoringApiClient,
  renderingComponentNames: Set<string>,
  isComponentsRoot: boolean,
  isContentModelsRoot: boolean
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  /**
   * Recurse. `sectionHandle` is the handle of the component section the
   * current subtree is under (set when we descended through a section folder
   * under componentsRoot — marker-aware, so component templates reference the
   * section by its real handle); `group` is the Content Models group folder
   * name.
   */
  const walk = async (
    parent: RemoteItem,
    sectionHandle: string | undefined,
    group: string | undefined,
    depth: number
  ): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId })).sort(byTreeOrder);
    for (const child of children) {
      if (conformsTo(child, SITECORE_TEMPLATES.TEMPLATE)) {
        recipes.push(
          await templateRecipeFromItem(child, sectionHandle, group, renderingComponentNames, client)
        );
        continue;
      }
      if (
        conformsTo(child, SITECORE_TEMPLATES.TEMPLATE_FOLDER) ||
        conformsTo(child, SITECORE_TEMPLATES.FOLDER)
      ) {
        // A folder directly under componentsRoot IS a component section.
        // Emit the section recipe, then descend carrying its handle so the
        // component templates beneath it reference the same identity.
        if (isComponentsRoot && depth === 0) {
          const section = componentSectionFromItem(child);
          recipes.push(section);
          await walk(child, section.handle, group, depth + 1);
          continue;
        }
        // A folder directly under contentModelsRoot is a taxonomy group.
        const nextGroup = isContentModelsRoot && depth === 0 ? child.name : group;
        // Skip the subordinate buckets (Component Folders / Presentation
        // Parameters) — they hold support templates, not authorable kinds.
        if (child.name === "Component Folders" || child.name === "Presentation Parameters") {
          continue;
        }
        await walk(child, sectionHandle, nextGroup, depth + 1);
        continue;
      }
      // Anything else (Standard Values, renderings, etc.) — not a
      // reverse-projectable kind. Skip silently.
    }
  };

  await walk(root, undefined, undefined, 0);
  return recipes;
};

/**
 * Determine whether an enumerations-tree item is a grouping folder (groups
 * containers) vs. a populated container (parents value leaves) by inspecting
 * its grandchildren: if any grandchild itself has children, the item groups
 * containers → it's a folder.
 */
const groupsContainers = async (
  grandchildren: readonly RemoteItem[],
  client: AuthoringApiClient
): Promise<boolean> => {
  for (const gc of grandchildren) {
    const ggc = await client.getChildren({ itemId: gc.itemId });
    if (ggc.filter((x) => x.name !== "__Standard Values").length > 0) {
      return true;
    }
  }
  return false;
};

/**
 * Walk the enumerations tree, reverse-projecting each `Enumeration`-template
 * container into an `EnumerationRecipe`. Grouping folders (`Enumerations
 * Folder` template) are recursed into; the cumulative folder path is
 * threaded onto each enum's `location.folder`.
 *
 * Container-vs-folder discrimination uses the structural rule the compiler
 * guarantees — grouping folders only ever parent containers/other folders,
 * containers only ever parent value leaves — inspected via `groupsContainers`.
 */
export const walkEnumerationsTree = async (
  rootPath: string,
  client: AuthoringApiClient
): Promise<Recipe[]> => {
  const recipes: Recipe[] = [];
  const root = rootPath ? await client.getItem({ path: rootPath }) : null;
  if (!root) return recipes;

  // `folderSegments` carries the grouping-folder path as `string[]` —
  // matches the canonical array shape on `EnumerationRecipe.location.folder`
  // so the reverse-projected recipe emits the same wire shape authors hand
  // to scai (no slash-joined fallback).
  const walk = async (parent: RemoteItem, folderSegments: string[]): Promise<void> => {
    const children = (await client.getChildren({ itemId: parent.itemId }))
      .filter((c) => c.name !== "__Standard Values")
      .sort(byTreeOrder);
    for (const child of children) {
      const grandchildren = (await client.getChildren({ itemId: child.itemId })).filter(
        (gc) => gc.name !== "__Standard Values"
      );
      if (grandchildren.length === 0) {
        // A childless item under the enumerations root is neither a
        // grouping folder nor a populated container — skip.
        continue;
      }
      if (await groupsContainers(grandchildren, client)) {
        await walk(child, [...folderSegments, child.name]);
      } else {
        const recipe = await enumerationFromItem(child, folderSegments, client);
        if (recipe) recipes.push(recipe);
      }
    }
  };

  await walk(root, []);
  return recipes;
};
