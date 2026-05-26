/**
 * Live smoke for the `Scai Handle` marker-field bootstrap
 * (`src/recipe/ensure-marker-field.ts`).
 *
 * Resolves an scai environment, opens an `AuthoringApiClient`, reports the
 * Standard Template's current direct-child sections (read-only), then runs
 * `ensureMarkerField` — the idempotent bootstrap that adds the `Scai Handle`
 * marker field. Safe to re-run: a second run reports `already-present` and
 * writes nothing.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-marker-bootstrap.ts <envName>
 */
import { resolveEnvironment } from "@/shared/env";
import { createAuthoringClient } from "@/recipe/api/authoring-client";
import { ensureMarkerField } from "@/recipe/items/ensure-marker-field";
import { SITECORE_TEMPLATES, STANDARD_TEMPLATE_ID } from "@/recipe/ir/sitecore-templates";

/** Compare two Sitecore GUIDs ignoring case, curly braces, and hyphens. */
const sameGuid = (a: string, b: string): boolean => {
  const norm = (g: string): string => g.trim().toLowerCase().replace(/[{}-]/g, "");
  return norm(a) === norm(b);
};

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  if (!envName) {
    process.stderr.write("usage: _smoke-marker-bootstrap.ts <envName>\n");
    process.exit(2);
  }

  const configPath = process.env.SCAI_CONFIG;
  const {
    environment,
    envName: resolved,
    timeoutMs,
  } = resolveEnvironment({
    environmentName: envName,
    ...(configPath ? { config: configPath } : {}),
  });
  console.log(`[marker] environment: ${resolved}`);

  const client = createAuthoringClient({ environment, request: { timeoutMs } });

  // ── Read-only precheck ────────────────────────────────────────────────
  const standardTemplate = await client.getItem({ itemId: STANDARD_TEMPLATE_ID });
  if (!standardTemplate) {
    process.stderr.write(
      `[marker] could not resolve the Standard Template (${STANDARD_TEMPLATE_ID}) — ` +
        `aborting before any write.\n`
    );
    process.exit(1);
  }
  console.log(
    `[marker] Standard Template: "${standardTemplate.name}" (${standardTemplate.itemId})`
  );

  const children = await client.getChildren({ itemId: standardTemplate.itemId });
  const sections = children.filter((c) =>
    sameGuid(c.templateId, SITECORE_TEMPLATES.TEMPLATE_SECTION)
  );
  console.log(
    `[marker] direct children: ${children.length} ` +
      `(${sections.length} Template Section${sections.length === 1 ? "" : "s"})`
  );
  for (const section of sections) {
    const fields = await client.getChildren({ itemId: section.itemId });
    console.log(`  - section "${section.name}" — ${fields.length} field(s)`);
  }

  // ── Bootstrap (idempotent) ────────────────────────────────────────────
  console.log("[marker] running ensureMarkerField …");
  const result = await ensureMarkerField(client);
  console.log(`[marker] result: ${JSON.stringify(result, null, 2)}`);
  console.log(
    result.status === "created"
      ? "[marker] ✓ Scai Handle field bootstrapped."
      : "[marker] ✓ Scai Handle field already present — no write performed."
  );
};

main().catch((err) => {
  process.stderr.write(
    `[marker] FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(99);
});
