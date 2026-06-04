/**
 * Delete the 8 legacy `*Brief`-suffixed brief types from the tenant.
 * Verified by hand 2026-06-04 that no current briefs reference these
 * type ids; the registry-side recipes ship the unsuffixed PascalCase
 * names (Creative, Campaign, etc.) instead.
 */
import { deleteBriefType, resolveBriefClient } from "@/brief";

const LEGACY_IDS: Array<{ name: string; id: string }> = [
  { name: "CreativeBrief", id: "487b2c26-0019-4cc4-8b0a-a411aedf0991" },
  { name: "CampaignBrief", id: "1193a168-b4aa-4cf4-95c5-4f36b8cafd6f" },
  { name: "ContentBrief", id: "99f6e93b-d8fc-47fe-90df-0de8e36d167a" },
  { name: "EventBrief", id: "81ccf358-b270-4e87-a040-11a3e2ff55d5" },
  { name: "ProductLaunchBrief", id: "0ac88d42-954d-4534-9602-7cc7b527bf79" },
  { name: "PaidMediaBrief", id: "3783c715-006e-456b-b1c8-16653f3d4565" },
  { name: "EmailBrief", id: "c40a296f-84ff-4b9b-8de4-ce3bc1f701db" },
  { name: "SocialMediaBrief", id: "abcb8451-ee8f-49cb-bf1c-584c67f742ea" },
];

async function main(): Promise<void> {
  const { client } = await resolveBriefClient({});
  for (const { name, id } of LEGACY_IDS) {
    try {
      await deleteBriefType(client, id);
      console.log(`✓ Deleted ${name} (${id})`);
    } catch (err) {
      console.error(
        `✗ Failed ${name} (${id}): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
