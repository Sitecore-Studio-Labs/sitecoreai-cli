/**
 * End-to-end populate-then-review probe.
 *
 *   1. Create a new brand kit (named scai-probe-<timestamp>).
 *   2. List its predefined sections.
 *   3. Pick the first section, list its fields.
 *   4. Update one field with a small brand-rule "intent" + "content".
 *   5. Wait briefly + run Brand Review against the kit.
 *
 * Surfaces every Brand Management write op scai has wired plus the
 * Brand Review op, against a fresh kit (so it does NOT touch the
 * operator's existing "Sync" kit).
 *
 * The kit it creates lingers on the tenant — delete manually via
 * Sitecore Stream UI when done.
 */
import { readRootConfiguration } from "@/config/root-config";
import {
  BRAND_MANAGEMENT_BASE_PATH,
  generateBrandReview,
  requestBrandApi,
  type BrandApiClientOptions,
} from "@/brand";
import { ScaiError } from "@/shared/errors";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "test";

  const root = readRootConfiguration(process.cwd(), envName);
  const env = root.environments[envName];
  if (!env?.organizationId) {
    process.stderr.write(`ERROR: env '${envName}' has no organizationId.\n`);
    process.exit(2);
  }
  const orgId = env.organizationId;
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    process.stderr.write(`ERROR: no AI Skills credential for org '${orgId}'.\n`);
    process.exit(3);
  }
  const client: BrandApiClientOptions = { orgId, credential };
  const kitName = `scai-probe-${Date.now()}`;

  try {
    // 1. CREATE kit
    process.stderr.write(`[1/5] creating brand kit '${kitName}'...\n`);
    type Created = { id?: string; name?: string; [k: string]: unknown };
    const created = await requestBrandApi<Created>(client, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits`,
      method: "POST",
      body: { name: kitName, brandName: kitName },
    });
    const newKitId = created.id;
    if (!newKitId) {
      process.stderr.write(
        `ERROR: create returned no id. Raw response:\n${JSON.stringify(created, null, 2)}\n`
      );
      process.exit(7);
    }
    process.stderr.write(`      ok — kitId=${newKitId}\n\n`);

    // 2. LIST sections (predefined, hopefully)
    process.stderr.write(`[2/5] listing sections...\n`);
    type SectionList = {
      data?: Array<{ id?: string; name?: string; status?: string }>;
    };
    const sections = await requestBrandApi<SectionList>(client, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits/${newKitId}/sections`,
      method: "GET",
    });
    const sectionRows = sections.data ?? [];
    process.stderr.write(`      ok (${sectionRows.length} section(s))\n`);
    for (const s of sectionRows) {
      process.stderr.write(`      - ${s.id} ${s.name ?? "(unnamed)"} [${s.status ?? "?"}]\n`);
    }
    if (sectionRows.length === 0) {
      process.stderr.write(
        "\nERROR: created kit has no predefined sections. Docs claim there should be Brand Context / Global Goals / Tone of Voice / etc.\n"
      );
      process.exit(7);
    }

    // 3. LIST fields of the first section
    const firstSection = sectionRows[0];
    process.stderr.write(`\n[3/5] listing fields of section '${firstSection.name}'...\n`);
    type FieldList = {
      data?: Array<{ id?: string; name?: string; intent?: string; content?: string }>;
    };
    const fields = await requestBrandApi<FieldList>(client, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v2/organizations/${orgId}/brandkits/${newKitId}/sections/${firstSection.id}/fields`,
      method: "GET",
    });
    const fieldRows = fields.data ?? [];
    process.stderr.write(`      ok (${fieldRows.length} field(s))\n`);
    for (const f of fieldRows) {
      process.stderr.write(`      - ${f.id} ${f.name ?? "(unnamed)"}\n`);
    }

    // 4. WRITE content to one field (PATCH existing or POST new)
    let targetFieldId = fieldRows[0]?.id;
    if (!targetFieldId) {
      process.stderr.write(`\n[4/5] no predefined fields — creating one...\n`);
      type CreatedField = { id?: string };
      const createdField = await requestBrandApi<CreatedField>(client, {
        basePath: BRAND_MANAGEMENT_BASE_PATH,
        path: `/api/brands/v2/organizations/${orgId}/brandkits/${newKitId}/sections/${firstSection.id}/fields`,
        method: "POST",
        body: {
          name: "scai-probe-field",
          intent: "Test what scai's Brand Review pipeline does end-to-end.",
          content: "Brand voice is warm, energetic, and direct. Avoid jargon. Use active voice.",
          aiEditable: true,
        },
      });
      targetFieldId = createdField.id;
      process.stderr.write(`      ok — fieldId=${targetFieldId}\n`);
    } else {
      process.stderr.write(`\n[4/5] PATCH field '${targetFieldId}' with rule content...\n`);
      await requestBrandApi(client, {
        basePath: BRAND_MANAGEMENT_BASE_PATH,
        path: `/api/brands/v2/organizations/${orgId}/brandkits/${newKitId}/sections/${firstSection.id}/fields/${targetFieldId}`,
        method: "PATCH",
        body: {
          intent: "Test what scai's Brand Review pipeline does end-to-end.",
          content: "Brand voice is warm, energetic, and direct. Avoid jargon. Use active voice.",
          aiEditable: true,
        },
      });
      process.stderr.write(`      ok\n`);
    }

    // 5. Brand Review against the populated kit
    process.stderr.write(`\n[5/5] POST /brandreview/generate against the populated kit...\n`);
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (
      url: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1]
    ): ReturnType<typeof globalThis.fetch> => {
      if (typeof url === "string" && url.includes("/brandreview/generate") && init?.body) {
        process.stderr.write(`\n=== wire request body ===\n${init.body}\n\n`);
      }
      return realFetch(url, init);
    };
    const result = await generateBrandReview({
      client,
      input: {
        text: "We are pumped to launch! Our team has been crushing it lately and we have built the most powerful tool in the industry. Are you ready??",
        label: "probe.txt",
      },
      selector: {
        brandKitId: newKitId,
        sections: [{ sectionId: firstSection.id!, fieldIds: [targetFieldId!] }],
      },
    });
    process.stderr.write(`      ok\n\n`);
    process.stdout.write("=== scai-normalized BrandReviewResult ===\n");
    process.stdout.write(
      JSON.stringify(
        {
          overallScore: result.overallScore,
          sectionResultCount: result.sectionResults.length,
          sectionResults: result.sectionResults,
        },
        null,
        2
      ) + "\n\n"
    );
    process.stdout.write("=== raw response ===\n");
    process.stdout.write(JSON.stringify(result.raw, null, 2) + "\n");

    process.stderr.write(
      `\nNote: kit '${kitName}' (${newKitId}) was left on the tenant. Delete via Sitecore Stream UI when done.\n`
    );
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(`\nFAIL [${err.code}] ${err.message}\n`);
      if (err.hint) {
        process.stderr.write(`HINT  ${err.hint}\n`);
      }
      process.exit(err.exitCode);
    }
    throw err;
  }
};

main().catch((err) => {
  process.stderr.write(
    `unhandled: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(99);
});
