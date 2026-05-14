import { resolveTenant } from "@/hygiene/tasks/shared";

const FIXES = [
  { itemId: "55fc3dece24a49e5a2b55ea20d316ebd", path: "component folders/accordion-block data folder/__standard values" },
  { itemId: "30190557c3894428a0fbd20d0c344b9c", path: "component folders/avatar-block data folder/__standard values" },
  { itemId: "a9c2828c5666486b8e9e54f97a72cee6", path: "component folders/badge-block data folder/__standard values" },
  { itemId: "e37fb485ddf045a98ac952da3bf9d4e6", path: "component folders/card-block data folder/__standard values" },
  { itemId: "6e368030fe384b19a8382c0f2bb77b6a", path: "component folders/cta-button data folder/__standard values" },
  { itemId: "164bbd68715d4afba6cd23cc19636ae5", path: "component folders/rich-text-block data folder/__standard values" },
];

const UI_TARGETS = [
  "77b59280ee684047a8951fcb4044dec8",
  "4d57c4f12f87460190ce895dcfe8b519",
  "f29336deeff4485ba0393d8cd6ad61a7",
  "e5af3a777c6745b3812783ad3e8957d5",
  "d6ccc20205144697a31cb5bfb1a36c69",
  "d5045f52e27645c09d396fc48fc879d0",
  "6ac5404af99c49d69e40513219704d37",
];

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });

  console.log("=== Clearing __Masters on the 6 Data Folder standard-values items ===");
  for (const fix of FIXES) {
    try {
      await client.updateItemFields({
        itemId: fix.itemId,
        fields: [{ name: "__Masters", value: "" }],
      });
      console.log(`  ✓ ${fix.path}`);
    } catch (err: any) {
      console.log(`  ✗ ${fix.path}: ${err?.message ?? err}`);
    }
  }

  console.log("\n=== Retrying deletes (bottom-up) ===");
  const targets = [
    { name: "accordion-block", id: "4d57c4f12f87460190ce895dcfe8b519" },
    { name: "avatar-block", id: "f29336deeff4485ba0393d8cd6ad61a7" },
    { name: "badge-block", id: "e5af3a777c6745b3812783ad3e8957d5" },
    { name: "card-block", id: "d6ccc20205144697a31cb5bfb1a36c69" },
    { name: "cta-button", id: "d5045f52e27645c09d396fc48fc879d0" },
    { name: "rich-text-block", id: "6ac5404af99c49d69e40513219704d37" },
    { name: "ui (root)", id: "77b59280ee684047a8951fcb4044dec8" },
  ];
  for (const t of targets) {
    try {
      await client.deleteItem({ itemId: t.id, permanently: true });
      console.log(`  ✓ ${t.name}`);
    } catch (err: any) {
      console.log(`  ✗ ${t.name}: ${String(err?.message ?? err).slice(0, 150)}`);
    }
  }
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
