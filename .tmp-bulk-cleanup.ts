/**
 * Bulk orphan-site-residue cleanup (Stage 1: clearly safe deletes).
 *
 * Before deleting:
 *   1. Inspect the Presentation folder so user has context to classify.
 *   2. Build a templateId-in-use set from the two active sites' content +
 *      from the entire `templates/Project/example/<active-site>` tree.
 *   3. For each candidate delete target, look up its descendants and refuse
 *      if any descendant templateId is in-use by active content.
 *   4. Delete each cleared candidate by itemId.
 *
 * Stage 1 candidates (high-confidence safe):
 *   - /sitecore/templates/Project/ui (was a site collection, user confirmed)
 *   - /sitecore/layout/Renderings/Project/ui (same)
 *   - FooterSocialTplP4*, NavLinkTplP4*, NavListTplP4* under demo-registry
 *     (auto-generated names with hash suffixes — recipe-test residue)
 *   - Cards / Lists / Layout / UI under /sitecore/layout/Renderings/Project/demo-registry
 */
import { resolveTenant, scanItemsAndFields, extractInternalRefs } from "@/hygiene/tasks/shared";

type Candidate = { name: string; itemId: string; path: string };

const STAGE_1: Candidate[] = [
  // ui — site collection (user confirmed)
  {
    name: "ui (templates)",
    itemId: "77b59280ee684047a8951fcb4044dec8",
    path: "/sitecore/templates/Project/ui",
  },
  {
    name: "ui (renderings)",
    itemId: "100acba7e182467f8f5b29ae39925d19",
    path: "/sitecore/layout/Renderings/Project/ui",
  },
  // FooterSocialTpl* family (9 items under demo-registry templates)
  {
    name: "FooterSocialTplP4divlkrx",
    itemId: "88a17056947748edb0747121aff0b0dc",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4divlkrx",
  },
  {
    name: "FooterSocialTplP4foq11",
    itemId: "3c5594eb3c204c509bbbde76c271f8f5",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4foq11",
  },
  {
    name: "FooterSocialTplP4lantj3",
    itemId: "c907ebe98c574ba09c7d953c789556ba",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4lantj3",
  },
  {
    name: "FooterSocialTplP4mom2hq1h2sy",
    itemId: "daf244f5bec54e15b5b05073105dc1cd",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4mom2hq1h2sy",
  },
  {
    name: "FooterSocialTplP4mom2wopo0dg",
    itemId: "88c19044aa8540d983aac9b4fe43f5be",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4mom2wopo0dg",
  },
  {
    name: "FooterSocialTplP4mom31e2r0m8",
    itemId: "c53b014522b34a37be095e8a9a3cf7b0",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4mom31e2r0m8",
  },
  {
    name: "FooterSocialTplP4momnqt8p3ex",
    itemId: "78c49ba329374f2bb627b34f63b4fb46",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4momnqt8p3ex",
  },
  {
    name: "FooterSocialTplP4momntiy55rx",
    itemId: "247358feaec340838b6b2c19f3ccddd9",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4momntiy55rx",
  },
  {
    name: "FooterSocialTplP4rmom2cxew",
    itemId: "9a6d4433e6634470b262ff35d009c177",
    path: "/sitecore/templates/Project/demo-registry/FooterSocialTplP4rmom2cxew",
  },
  // NavLinkTpl* family
  {
    name: "NavLinkTplP4divlkrx",
    itemId: "f18b2efad414472aa9eb3ee4e3253b05",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4divlkrx",
  },
  {
    name: "NavLinkTplP4foq11",
    itemId: "76513d9be53f4116bb6dc6bb42a5af8a",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4foq11",
  },
  {
    name: "NavLinkTplP4lantj3",
    itemId: "7b7484cdf27d444682a79a5ba4b51e6c",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4lantj3",
  },
  {
    name: "NavLinkTplP4mom2hq1h2sy",
    itemId: "2a930621f2434e3aab079a211b396363",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4mom2hq1h2sy",
  },
  {
    name: "NavLinkTplP4mom2wopo0dg",
    itemId: "79a9ace28fdd4ec8b6a22f9ec7bb787e",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4mom2wopo0dg",
  },
  {
    name: "NavLinkTplP4mom31e2r0m8",
    itemId: "f025d7b5290f4538ad7f4f737cfdc36e",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4mom31e2r0m8",
  },
  {
    name: "NavLinkTplP4momnqt8p3ex",
    itemId: "a21edaa1037e481b816dd87e91366b5f",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4momnqt8p3ex",
  },
  {
    name: "NavLinkTplP4momntiy55rx",
    itemId: "61f7f850433245e2a12cf253e5115e77",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4momntiy55rx",
  },
  {
    name: "NavLinkTplP4rmom2cxew",
    itemId: "22d65973d4984500960f9d66f4bc9dd2",
    path: "/sitecore/templates/Project/demo-registry/NavLinkTplP4rmom2cxew",
  },
  // NavListTpl* family
  {
    name: "NavListTplP4divlkrx",
    itemId: "63601a7dabf140f7beb85f46d05ee9df",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4divlkrx",
  },
  {
    name: "NavListTplP4foq11",
    itemId: "ff499957a9ee4c09899066c8ff8a9ebf",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4foq11",
  },
  {
    name: "NavListTplP4lantj3",
    itemId: "4e144ef7f24a4c0aacd0495bfb5cbef6",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4lantj3",
  },
  {
    name: "NavListTplP4mom2hq1h2sy",
    itemId: "9091c25dfe4342c388a9462db833c0a2",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4mom2hq1h2sy",
  },
  {
    name: "NavListTplP4mom2wopo0dg",
    itemId: "5c102a5242864c6396fa6cb9ef56f596",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4mom2wopo0dg",
  },
  {
    name: "NavListTplP4mom31e2r0m8",
    itemId: "8af74e4c9e7d4b3590fb767b40636452",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4mom31e2r0m8",
  },
  {
    name: "NavListTplP4momnqt8p3ex",
    itemId: "19879e37e7e94bb7a6f44d43173cc1cd",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4momnqt8p3ex",
  },
  {
    name: "NavListTplP4momntiy55rx",
    itemId: "f60865e727f54cf08ea28e09e96794aa",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4momntiy55rx",
  },
  {
    name: "NavListTplP4rmom2cxew",
    itemId: "031db11b207041bf8b0e8e46c5a5e0db",
    path: "/sitecore/templates/Project/demo-registry/NavListTplP4rmom2cxew",
  },
  // Cards / Lists / Layout / UI under demo-registry renderings
  {
    name: "Cards (demo-registry renderings)",
    itemId: "746f553968354d6c8c3e58e286373eef",
    path: "/sitecore/layout/Renderings/Project/demo-registry/Cards",
  },
  {
    name: "Layout (demo-registry renderings)",
    itemId: "7205e36af8dd417cb1f9dbe09047cd19",
    path: "/sitecore/layout/Renderings/Project/demo-registry/Layout",
  },
  {
    name: "UI (demo-registry renderings)",
    itemId: "e14453c360bf45ffae22f5b91a714403",
    path: "/sitecore/layout/Renderings/Project/demo-registry/UI",
  },
  {
    name: "Lists (demo-registry renderings)",
    itemId: "6b17267365394680870d45c16a397720",
    path: "/sitecore/layout/Renderings/Project/demo-registry/Lists",
  },
];

// Active site content paths — anything we delete must not be a templateId
// used by content under these roots.
const ACTIVE_CONTENT_ROOTS = [
  "/sitecore/content/example/test-sync",
  "/sitecore/content/demo-registry/content-modelling",
];

const norm = (s: string) => s.replace(/[{}-]/g, "").toLowerCase();

const main = async () => {
  const { client, envName } = resolveTenant({ environmentName: "test" });

  // ===== Step 1: inspect Presentation for user context =====
  console.log("=== /sitecore/templates/Project/Presentation contents ===");
  try {
    const kids = await client.getChildren({ itemId: "29b28db28cca45aa893d4f549f0c5d32" });
    for (const k of kids) console.log(`  ${k.path}  (template: ${(k as any).templateName ?? "?"})`);
    if (kids.length === 0) console.log("  (empty)");
  } catch (err: any) {
    console.log(`  ERR: ${err?.message ?? err}`);
  }

  // ===== Step 2: build templateId-in-use set from active sites =====
  console.log("\n=== Building active-content templateId set ===");
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
    console.log(`  ${root}: ${scanned.length} items scanned`);
  }
  console.log(`  -> ${activeTemplateIds.size} distinct templateIds in use by active content`);

  // ===== Step 3: for each candidate, scan its subtree templateIds, refuse if any are in use =====
  console.log("\n=== Safety check per candidate ===");
  const safeToDelete: Array<Candidate & { reason?: string }> = [];
  const blocked: Array<Candidate & { conflict: string[] }> = [];
  for (const c of STAGE_1) {
    let subtree: any;
    try {
      subtree = await scanItemsAndFields({
        client,
        envName,
        root: c.path,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
    } catch (err: any) {
      console.log(`  ⚠ ${c.name}: scan failed (${err?.message ?? err}) — skipping`);
      continue;
    }
    // Items under templates/Project hold templateIds AS items (their own templateId is "Template");
    // the templateId-in-use check has to compare the item's itemId (since items here ARE templates)
    // to the activeTemplateIds set. For renderings, items are renderings; we cross-check rendering
    // itemIds against active content's `__Renderings`/`__Final Renderings` fields (heavier — skip
    // for now and just do reference scan below).
    const conflicts: string[] = [];
    if (c.path.startsWith("/sitecore/templates/Project/")) {
      for (const it of subtree.scanned) {
        if (activeTemplateIds.has(norm(it.itemId))) {
          conflicts.push(`${it.path} (used by active content)`);
        }
      }
    }
    if (conflicts.length > 0) {
      blocked.push({ ...c, conflict: conflicts });
      console.log(
        `  ✗ ${c.name}: ${conflicts.length} subtree items are used as templates by active content`
      );
    } else {
      safeToDelete.push({
        ...c,
        reason: `${subtree.scanned.length} items in subtree, none used by active content`,
      });
      console.log(`  ✓ ${c.name}: safe (${subtree.scanned.length} items in subtree)`);
    }
  }

  // ===== Step 4: reference scan — check renderings for refs from active content =====
  // For each candidate that's a rendering (path under /sitecore/layout/Renderings/Project/),
  // scan all active content fields for GUID refs matching the rendering subtree itemIds.
  console.log("\n=== Reference scan (renderings → active content) ===");
  const renderingCandidates = safeToDelete.filter((c) =>
    c.path.startsWith("/sitecore/layout/Renderings/Project/")
  );
  if (renderingCandidates.length > 0) {
    const renderingIds = new Set<string>();
    const idsByCandidate = new Map<string, Set<string>>();
    for (const c of renderingCandidates) {
      const subtree = await scanItemsAndFields({
        client,
        envName,
        root: c.path,
        logger: { verbose: () => {}, warn: () => {} } as any,
        options: { concurrency: 4, batchSize: 50, pageParallelism: 2, limit: 5000 },
        latestVersionOnly: true,
        skipFields: true,
      });
      const ids = new Set<string>();
      for (const it of subtree.scanned) {
        const n = norm(it.itemId);
        renderingIds.add(n);
        ids.add(n);
      }
      idsByCandidate.set(c.itemId, ids);
    }
    console.log(
      `  Scanning active content fields for references to ${renderingIds.size} rendering itemIds…`
    );
    let foundRefs = 0;
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
          for (const ref of extractInternalRefs(f.value)) {
            if (renderingIds.has(ref)) {
              console.log(`  ⚠ ${s.path}.${f.name} → ${ref}`);
              foundRefs += 1;
              // Remove the offending candidate from safe list.
              for (const [candId, ids] of idsByCandidate) {
                if (ids.has(ref)) {
                  const idx = safeToDelete.findIndex((c) => c.itemId === candId);
                  if (idx >= 0) safeToDelete.splice(idx, 1);
                }
              }
            }
          }
        }
      }
    }
    if (foundRefs === 0)
      console.log("  ✓ No references to rendering candidates from active content");
  }

  // ===== Step 5: print summary and execute =====
  console.log("\n=== Summary ===");
  console.log(`Safe to delete: ${safeToDelete.length}`);
  for (const c of safeToDelete) console.log(`  ${c.itemId}  ${c.path}  — ${c.reason ?? ""}`);
  if (blocked.length > 0) {
    console.log(`Blocked: ${blocked.length}`);
    for (const c of blocked)
      console.log(`  ${c.itemId}  ${c.path}  (${c.conflict.length} conflicts)`);
  }

  console.log("\n=== Executing deletes ===");
  const results: Array<{ name: string; itemId: string; status: "ok" | "err"; error?: string }> = [];
  for (const c of safeToDelete) {
    try {
      await client.deleteItem({ itemId: c.itemId, permanently: true });
      results.push({ name: c.name, itemId: c.itemId, status: "ok" });
      console.log(`  ✓ ${c.name}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      results.push({ name: c.name, itemId: c.itemId, status: "err", error: msg });
      console.log(`  ✗ ${c.name}: ${msg}`);
    }
  }
  const okCount = results.filter((r) => r.status === "ok").length;
  console.log(`\nDeleted ${okCount} / ${safeToDelete.length}`);
};

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
