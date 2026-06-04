/**
 * Bulk probe: set five brief types to five distinct named CSS colors
 * so a single SitecoreAI refresh reveals which colors render the icon
 * in colour and which don't. Lets us infer the UI's allow-list without
 * a round-trip per probe.
 *
 * Sets:
 *   Creative        → yellow
 *   Campaign        → orange
 *   Content         → red
 *   Event           → purple
 *   ProductLaunch   → pink
 *
 * Other brief types are left untouched. After refresh, report which
 * coloured / which stayed gray. From there we build the hex→named
 * mapping in the orchestrator wire normaliser.
 */
import { getBriefType, resolveBriefClient, updateBriefType } from "@/brief";

const TARGETS: Array<{ id: string; name: string; color: string }> = [
  { id: "80288b0a-a926-4b05-a1ff-c2985a00f9b7", name: "Creative", color: "yellow" },
  { id: "68809180-6c31-40d2-bfec-793deaf40c4d", name: "Campaign", color: "orange" },
  { id: "b8a28a87-d3fe-436b-aebb-344d135c4ef8", name: "Content", color: "red" },
  { id: "ee1b37f0-02f9-4989-a73a-9f69420ed0a1", name: "Event", color: "purple" },
  { id: "1feca67c-0d81-4d16-8c9f-5918764e12f1", name: "ProductLaunch", color: "pink" },
];

async function main(): Promise<void> {
  const { client } = await resolveBriefClient({});
  for (const { id, name, color } of TARGETS) {
    const before = await getBriefType(client, id);
    if (before.name !== name) {
      console.warn(
        `Skipping ${name} — id ${id} returned name ${before.name} (refresh script with current ids)`,
      );
      continue;
    }
    await updateBriefType(client, id, {
      name: before.name,
      label: before.label,
      description: before.description,
      icon: before.icon,
      iconColor: color,
      fields: before.fields,
    });
    console.log(`✓ ${name}: iconColor → ${color}`);
  }
  console.log(
    "\nRefresh SitecoreAI's brief-types view; report which icons render in colour.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
