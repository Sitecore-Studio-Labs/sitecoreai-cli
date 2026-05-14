import {
  resolveTenant,
  scanItemsAndFields,
  extractInternalRefs,
} from "@/hygiene/tasks/shared";

const ACTIVE_CONTENT_ROOTS = [
  "/sitecore/content/example/test-sync",
  "/sitecore/content/demo-registry/content-modelling",
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

type Candidate = { name: string; itemId: string; path: string };

// Stage 2 candidates: ui (templates side), demo-registry orphan sites, example
// orphan templates, loose component templates, demo-registry+example media-library shared.
const STAGE_2: Candidate[] = [
  // ui templates side — re-test after component-folders move
  { name: "ui (templates)", itemId: "77b59280ee684047a8951fcb4044dec8", path: "/sitecore/templates/Project/ui" },

  // demo-registry orphan templates (from inventory)
  { name: "Datasources", itemId: "c189112cba854ce585a6a3d260cd68a1", path: "/sitecore/templates/Project/demo-registry/Datasources" },
  { name: "Article Card", itemId: "1b8d93301fa74ec490dff6f90048bedc", path: "/sitecore/templates/Project/demo-registry/Article Card" },
  { name: "Articles", itemId: "ce3fc41a2bdd4baea3e92570ece358b7", path: "/sitecore/templates/Project/demo-registry/Articles" },
  { name: "Badge", itemId: "cd7d3774e1ab42a9b5325e5e0012ed10", path: "/sitecore/templates/Project/demo-registry/Badge" },
  { name: "Offer Card_2", itemId: "dce294df191641b2a459883b93dc87bc", path: "/sitecore/templates/Project/demo-registry/Offer Card_2" },
  { name: "Offer Card_3", itemId: "1aeed890e43348668bea6a508b981d6b", path: "/sitecore/templates/Project/demo-registry/Offer Card_3" },
  { name: "Offers", itemId: "5dff70c63c1b4b309b63613aa27b89d8", path: "/sitecore/templates/Project/demo-registry/Offers" },
  { name: "Image", itemId: "64e39adaf7504c1ab8fb5dc914c2c182", path: "/sitecore/templates/Project/demo-registry/Image" },
  { name: "Article Card Folder", itemId: "186ebcd7feac4b3b977c9df84c2456b3", path: "/sitecore/templates/Project/demo-registry/Article Card Folder" },
  { name: "Articles Folder", itemId: "b2c81b10226a4206b5cd6c6108d1b153", path: "/sitecore/templates/Project/demo-registry/Articles Folder" },
  { name: "Badge Folder", itemId: "a67c818ae54e4012868efbd83c05e840", path: "/sitecore/templates/Project/demo-registry/Badge Folder" },
  { name: "Image Folder", itemId: "50bd493179ae4f0f8313001f3e084ed7", path: "/sitecore/templates/Project/demo-registry/Image Folder" },
  { name: "Offer Card Folder", itemId: "bb573c46546042579a14f4baca5455df", path: "/sitecore/templates/Project/demo-registry/Offer Card Folder" },
  { name: "Offers Folder", itemId: "800b2d88662943088e27c65b034fde88", path: "/sitecore/templates/Project/demo-registry/Offers Folder" },
  { name: "Page (demo-registry)", itemId: "0fedb712d67e457fb09b13ee0070c0d7", path: "/sitecore/templates/Project/demo-registry/Page" },
  { name: "Headless Site (demo-registry)", itemId: "fc1b06ea357a421f9cab78beb66a7f4d", path: "/sitecore/templates/Project/demo-registry/Headless Site" },
  { name: "Headless Tenant (demo-registry)", itemId: "59edf67abab341edba3501100c4c2946", path: "/sitecore/templates/Project/demo-registry/Headless Tenant" },
  { name: "JSS Settings (demo-registry)", itemId: "4e03fdbb1a404557a71b83dfb8ed5ea8", path: "/sitecore/templates/Project/demo-registry/JSS Settings" },
  { name: "Offer Card", itemId: "e7e9162486174f1eb3a595d1983dae38", path: "/sitecore/templates/Project/demo-registry/Offer Card" },
  { name: "Page Design Folder (demo-registry)", itemId: "7b45a1b3ac0c4db69c9362fbd44eb798", path: "/sitecore/templates/Project/demo-registry/Page Design Folder" },
  { name: "Page Designs (demo-registry)", itemId: "17f7a83464934123be884bbebd410790", path: "/sitecore/templates/Project/demo-registry/Page Designs" },
  { name: "Partial Design Folder (demo-registry)", itemId: "97537915054548d9b4dc06062df35d3f", path: "/sitecore/templates/Project/demo-registry/Partial Design Folder" },

  // example tenant orphan templates (riskier — may be used by test-sync)
  { name: "Page (example)", itemId: "c1ff6ab06ac149719abf18fbebba25db", path: "/sitecore/templates/Project/example/Page" },
  { name: "Article Page", itemId: "feab9d0808eb4ffd8133d3c76acaf047", path: "/sitecore/templates/Project/example/Article Page" },
  { name: "Audio Product Page", itemId: "386cf972c0874a52a08cad88e8312fa9", path: "/sitecore/templates/Project/example/Audio Product Page" },
  { name: "Detail Page", itemId: "ea8fd672cf5d4f668405b2f99a14888f", path: "/sitecore/templates/Project/example/Detail Page" },
  { name: "Headless Site (example)", itemId: "543a47ba8eb74161ab7b4130bd2dbcd9", path: "/sitecore/templates/Project/example/Headless Site" },
  { name: "Headless Tenant (example)", itemId: "1bca523dc99d463e89149aa688e01b5e", path: "/sitecore/templates/Project/example/Headless Tenant" },
  { name: "Home Page (example)", itemId: "86c7562f54df4edca3e9489b129b3a62", path: "/sitecore/templates/Project/example/Home Page" },
  { name: "JSS Settings (example)", itemId: "6a4f19ab42fc4ae187eb5d2ddea803ae", path: "/sitecore/templates/Project/example/JSS Settings" },
  { name: "Landing Page", itemId: "f968f7184396484096196b309f68142b", path: "/sitecore/templates/Project/example/Landing Page" },
  { name: "Page Design Folder (example)", itemId: "4dd18242384e43188259a0714bc4aeb8", path: "/sitecore/templates/Project/example/Page Design Folder" },
  { name: "Page Designs (example)", itemId: "4479f9925f78444fa9e9b78dd53f2cc2", path: "/sitecore/templates/Project/example/Page Designs" },
  { name: "Page Folder (example)", itemId: "5021d6921afe4d98b037a5a1f9bec808", path: "/sitecore/templates/Project/example/Page Folder" },
  { name: "Partial Design Folder (example)", itemId: "49d5b531f53e4fa7be7728efd23c2ee8", path: "/sitecore/templates/Project/example/Partial Design Folder" },
  { name: "Partial Designs (example)", itemId: "248d86f05b80458381939a79b87aab6d", path: "/sitecore/templates/Project/example/Partial Designs" },
  { name: "Product Page", itemId: "f2d3569d177448e0bb30d0a5c8548691", path: "/sitecore/templates/Project/example/Product Page" },

  // Loose component templates at project root
  { name: "accordion-item", itemId: "57699429637d474087cf28cec992247f", path: "/sitecore/templates/Project/accordion-item" },
  { name: "AccordionBlock", itemId: "291ef5a96cf040b890c9df60f47d2712", path: "/sitecore/templates/Project/AccordionBlock" },
  { name: "AccordionBlock Parameters", itemId: "8cdcdea0a3de4c458fbb90e79e58365f", path: "/sitecore/templates/Project/AccordionBlock Parameters" },
  { name: "AccordionItem", itemId: "61841d60d9ec445680404dc588438df1", path: "/sitecore/templates/Project/AccordionItem" },
  { name: "AvatarBlock", itemId: "c7709b7fe9254d5ab402418d1d3b523e", path: "/sitecore/templates/Project/AvatarBlock" },
  { name: "AvatarBlock Parameters", itemId: "1f290bbf6d3e4e1d9165309d18a64318", path: "/sitecore/templates/Project/AvatarBlock Parameters" },
  { name: "BadgeBlock", itemId: "efbcb497e4e940e291e6d7580049097b", path: "/sitecore/templates/Project/BadgeBlock" },
  { name: "BadgeBlock Parameters", itemId: "f045d0a77a5344839428265b4e7b4352", path: "/sitecore/templates/Project/BadgeBlock Parameters" },
  { name: "CardBlock", itemId: "df6cd8d8ff48435499b837e0ddbbfc7e", path: "/sitecore/templates/Project/CardBlock" },
  { name: "CardBlock Parameters", itemId: "ee802c48a61f4e58b216e28cee5e51a3", path: "/sitecore/templates/Project/CardBlock Parameters" },
  { name: "CtaButton", itemId: "42b8baac7e744c84b11b24fdbc2623c1", path: "/sitecore/templates/Project/CtaButton" },
  { name: "CtaButton Parameters", itemId: "a00d03a6450c4edc938c1527c3d0350c", path: "/sitecore/templates/Project/CtaButton Parameters" },
  { name: "RichTextBlock", itemId: "97175d4efecc4f9ea1fc68bba1358c39", path: "/sitecore/templates/Project/RichTextBlock" },
  { name: "RichTextBlock Parameters", itemId: "c01fa8ac98714374b074f58d523e677f", path: "/sitecore/templates/Project/RichTextBlock Parameters" },

  // Presentation (small, 3 items)
  { name: "Presentation", itemId: "29b28db28cca45aa893d4f549f0c5d32", path: "/sitecore/templates/Project/Presentation" },

  // Renderings: loose components at project root
  { name: "AccordionBlock (renderings)", itemId: "ef4171b1209945108f57f37339f64046", path: "/sitecore/layout/Renderings/Project/AccordionBlock" },
  { name: "AvatarBlock (renderings)", itemId: "a228f19891404813b3cd398d717a2c30", path: "/sitecore/layout/Renderings/Project/AvatarBlock" },
  { name: "BadgeBlock (renderings)", itemId: "975738e5590f49709e63b71c9ce33502", path: "/sitecore/layout/Renderings/Project/BadgeBlock" },
  { name: "CardBlock (renderings)", itemId: "1106aa205db344ee86cfc5e3fc17caeb", path: "/sitecore/layout/Renderings/Project/CardBlock" },
  { name: "CtaButton (renderings)", itemId: "413e8020b0ad4d4fa05fbcd4070e7794", path: "/sitecore/layout/Renderings/Project/CtaButton" },
  { name: "RichTextBlock (renderings)", itemId: "2a2f8a3fdaac44b5b31ffd346a84c6d9", path: "/sitecore/layout/Renderings/Project/RichTextBlock" },

  // Media library shared folders (descendants=0)
  { name: "shared (demo-registry media)", itemId: "a76264f7482c4791b18a9177fde14a49", path: "/sitecore/media library/Project/demo-registry/shared" },
  { name: "shared (example media)", itemId: "7e603e2f22124bbc8980186c9d725f3b", path: "/sitecore/media library/Project/example/shared" },
];

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // Build templateIds-in-use set from active content.
  console.log("=== Building active-content templateId set ===");
  const activeTemplateIds = new Set<string>();
  for (const root of ACTIVE_CONTENT_ROOTS) {
    const { scanned } = await scanItemsAndFields({
      client,
      envName,
      root,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 10000 },
      latestVersionOnly: true,
      skipFields: true,
    });
    for (const s of scanned) {
      if (s.templateId) activeTemplateIds.add(norm(s.templateId));
    }
    console.log(`  ${root}: ${scanned.length} items, contributed templateIds`);
  }
  console.log(`  -> ${activeTemplateIds.size} distinct templateIds in use`);

  // Pre-scan active content fields once for the rendering-ref scan.
  console.log("\n=== Indexing active-content fields for ref scan ===");
  const activeFieldIndex: Array<{ srcPath: string; fieldName: string; refs: Set<string> }> = [];
  for (const root of ACTIVE_CONTENT_ROOTS) {
    const { scanned, fieldsByItemId } = await scanItemsAndFields({
      client,
      envName,
      root,
      logger: { verbose: () => {}, warn: () => {} } as any,
      options: { concurrency: 8, batchSize: 50, pageParallelism: 4, limit: 10000 },
      latestVersionOnly: true,
    });
    for (const s of scanned) {
      const fields = fieldsByItemId.get(s.itemId);
      if (!fields) continue;
      for (const f of fields) {
        if (!f.value) continue;
        const refs = new Set<string>();
        for (const r of extractInternalRefs(f.value)) refs.add(r);
        if (refs.size > 0) activeFieldIndex.push({ srcPath: s.path, fieldName: f.name, refs });
      }
    }
  }
  console.log(`  indexed ${activeFieldIndex.length} field-with-refs entries`);

  // For each candidate, scan its subtree, then check both:
  //   (a) any subtree itemId used as templateId by active content
  //   (b) any subtree itemId referenced by an active-content field
  console.log("\n=== Safety check per candidate ===");
  const safe: Array<Candidate & { subtreeSize: number; reason: string }> = [];
  const blocked: Array<Candidate & { conflicts: string[] }> = [];

  for (const c of STAGE_2) {
    let subtreeIds: Set<string>;
    let subtreeSize = 0;
    try {
      const r = await scanItemsAndFields({
        client,
        envName,
        root: c.path,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
      subtreeIds = new Set(r.scanned.map((s) => norm(s.itemId)));
      subtreeSize = r.scanned.length;
    } catch (err: any) {
      console.log(`  ⚠ ${c.name}: scan failed (${err?.message ?? err}) — skipping`);
      continue;
    }

    const conflicts: string[] = [];
    // (a) templateId-in-use check
    for (const id of subtreeIds) {
      if (activeTemplateIds.has(id)) {
        conflicts.push(`active content templated by ${id}`);
        break;
      }
    }
    // (b) reference-from-active-content check
    if (conflicts.length === 0) {
      for (const fe of activeFieldIndex) {
        for (const r of fe.refs) {
          if (subtreeIds.has(r)) {
            conflicts.push(`referenced by ${fe.srcPath}.${fe.fieldName} → ${r}`);
            break;
          }
        }
        if (conflicts.length > 0) break;
      }
    }

    if (conflicts.length > 0) {
      blocked.push({ ...c, conflicts });
      console.log(`  ✗ ${c.name} (${subtreeSize}): ${conflicts[0]}`);
    } else {
      safe.push({ ...c, subtreeSize, reason: `${subtreeSize} items, no active refs` });
      console.log(`  ✓ ${c.name} (${subtreeSize}): safe`);
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Safe to delete: ${safe.length}`);
  console.log(`Blocked:        ${blocked.length}`);
  if (blocked.length > 0) {
    console.log(`\nBlocked details:`);
    for (const b of blocked) console.log(`  ${b.name}  ${b.path}`);
    for (const b of blocked) console.log(`    → ${b.conflicts[0]}`);
  }

  console.log(`\n=== Executing deletes ===`);
  let okCount = 0;
  for (const c of safe) {
    try {
      await client.deleteItem({ itemId: c.itemId, permanently: true });
      okCount += 1;
      console.log(`  ✓ ${c.name}  (${c.subtreeSize} items)`);
    } catch (err: any) {
      console.log(`  ✗ ${c.name}: ${err?.message ?? err}`);
    }
  }
  console.log(`\nDeleted ${okCount} / ${safe.length} candidates.`);
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
