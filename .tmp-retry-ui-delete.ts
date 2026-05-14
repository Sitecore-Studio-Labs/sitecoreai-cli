import { resolveTenant } from "@/hygiene/tasks/shared";

const TARGETS = [
  { name: "accordion-block", id: "4d57c4f12f87460190ce895dcfe8b519" },
  { name: "avatar-block", id: "f29336deeff4485ba0393d8cd6ad61a7" },
  { name: "badge-block", id: "e5af3a777c6745b3812783ad3e8957d5" },
  { name: "card-block", id: "d6ccc20205144697a31cb5bfb1a36c69" },
  { name: "cta-button", id: "d5045f52e27645c09d396fc48fc879d0" },
  { name: "rich-text-block", id: "6ac5404af99c49d69e40513219704d37" },
  { name: "ui (root folder)", id: "77b59280ee684047a8951fcb4044dec8" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  const pending = new Map(TARGETS.map((t) => [t.id, t.name]));
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts && pending.size > 0; attempt += 1) {
    if (attempt > 1) await sleep(15000);
    console.log(`\nAttempt ${attempt} (${pending.size} remaining):`);
    for (const [id, name] of [...pending]) {
      try {
        await client.deleteItem({ itemId: id, permanently: true });
        console.log(`  ✓ ${name}`);
        pending.delete(id);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        console.log(`  ✗ ${name}: ${msg.slice(0, 100)}`);
      }
    }
  }
  console.log(`\n${pending.size === 0 ? "All deleted ✓" : `${pending.size} still failing after ${maxAttempts} attempts`}`);
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
