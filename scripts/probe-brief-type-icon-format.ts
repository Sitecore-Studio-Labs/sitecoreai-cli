/**
 * Update one existing brief type's icon to the kebab `mdi-*` form and
 * report the persisted value. The user can then refresh SitecoreAI's
 * UI on this brief type and confirm whether the icon now renders
 * (current evidence: bare PascalCase like `LightbulbOn` is silently
 * stored but doesn't render in the brief authoring UI).
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-brief-type-icon-format.ts <briefTypeId> <newIconString>
 *
 * Example (set the Creative type to the kebab MDI form):
 *   ...probe-brief-type-icon-format.ts \
 *     80288b0a-a926-4b05-a1ff-c2985a00f9b7 mdi-lightbulb-on
 */
import {
  getBriefType,
  resolveBriefClient,
  updateBriefType,
} from "@/brief";

async function main(): Promise<void> {
  const [typeId, newIcon] = process.argv.slice(2);
  if (!typeId || !newIcon) {
    console.error(
      "Usage: probe-brief-type-icon-format.ts <briefTypeId> <newIconString>",
    );
    process.exit(2);
  }
  const { client } = await resolveBriefClient({});
  const before = await getBriefType(client, typeId);
  console.log(`Before: ${before.name} icon=${before.icon} color=${before.iconColor}`);

  // PUT requires the full type body — replay all required fields.
  await updateBriefType(client, typeId, {
    name: before.name,
    label: before.label,
    description: before.description,
    icon: newIcon,
    iconColor: before.iconColor,
    fields: before.fields,
  });

  const after = await getBriefType(client, typeId);
  console.log(`After:  ${after.name} icon=${after.icon} color=${after.iconColor}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
