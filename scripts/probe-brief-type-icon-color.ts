/**
 * Update one existing brief type's iconColor and report the persisted
 * value. Use to confirm whether SitecoreAI's brief authoring UI honours
 * hex strings (`#F8D904`) vs only named CSS colors (`blue`, `green`).
 *
 * Plan: PUT the type with a new iconColor, GET it back, report.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-brief-type-icon-color.ts <briefTypeId> <newColor>
 *
 * Example: set Creative to the named color `gold`:
 *   ... 80288b0a-a926-4b05-a1ff-c2985a00f9b7 gold
 */
import {
  getBriefType,
  resolveBriefClient,
  updateBriefType,
} from "@/brief";

async function main(): Promise<void> {
  const [typeId, newColor] = process.argv.slice(2);
  if (!typeId || !newColor) {
    console.error(
      "Usage: probe-brief-type-icon-color.ts <briefTypeId> <newColor>",
    );
    process.exit(2);
  }
  const { client } = await resolveBriefClient({});
  const before = await getBriefType(client, typeId);
  console.log(
    `Before: ${before.name} icon=${before.icon} color=${before.iconColor}`,
  );

  await updateBriefType(client, typeId, {
    name: before.name,
    label: before.label,
    description: before.description,
    icon: before.icon,
    iconColor: newColor,
    fields: before.fields,
  });

  const after = await getBriefType(client, typeId);
  console.log(
    `After:  ${after.name} icon=${after.icon} color=${after.iconColor}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
