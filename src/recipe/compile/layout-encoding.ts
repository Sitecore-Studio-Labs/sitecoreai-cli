import { variantId } from "../items/guids";
import type { LayoutEmitContext } from "../layout/emit";
import { type CompileContext, paramWireValue } from "./shared";

/**
 * The `variantRefFor` + `paramValueFor` encoders every layout-holding item —
 * pages, partial designs, page designs — feeds to `emitLayoutXml` so a
 * placement's variant selection and rendering parameters land in the wire form
 * XM Cloud Pages reads back:
 *
 *  - **variant** → the headless Variant Definition item's GUID when the
 *    component recipe declares the variant (so Pages' variant picker can
 *    display it). Undeclared variants — and standalone compiles without
 *    `componentsByHandle` — fall back to the raw name, which the front end
 *    matches against its exports directly.
 *  - **param** → the value the parameter's Sitecore field stores (enum
 *    Droplinks → enum-value GUIDs, checkboxes → `1`/`""`), so Pages' properties
 *    panel shows it as set. Unknown params (or standalone compiles) keep the
 *    raw value.
 *
 * Extracted so partial/page-design layouts encode variants + params IDENTICALLY
 * to pages. Without it a design's layout renders with unresolved variant names
 * and raw param values — the "layout doesn't work" class of bug.
 */
export const layoutEncodingOptions = (
  site: string,
  context: CompileContext
): Pick<LayoutEmitContext, "variantRefFor" | "paramValueFor"> => ({
  variantRefFor: (componentHandle, variantName) => {
    const declared = context.componentsByHandle
      ?.get(componentHandle)
      ?.variants.some((variant) => variant.name === variantName);
    return declared ? variantId(site, componentHandle, variantName) : undefined;
  },
  paramValueFor: (componentHandle, paramName, rawValue) => {
    const component = context.componentsByHandle?.get(componentHandle);
    if (!component) return undefined;
    const defs = component.parameters
      ? (context.parametersByHandle?.get(component.parameters.handle)?.params ?? [])
      : component.params;
    const def = defs.find((param) => param.name === paramName);
    return def ? paramWireValue(def, rawValue, site) : undefined;
  },
});
