/**
 * Real-tenant probe for the Brand Review API. Exercises the same code
 * path the CLI invokes (`generateBrandReview` + the shared auth /
 * client / scope-validation stack) so any wire-shape divergence
 * surfaces here before it surfaces in CI.
 *
 * Credentials come from scai's keychain entry — provision the AI
 * APIs key first with:
 *   scai login ai-skills --env <envName>   (interactive)
 * OR
 *   scai login ai-skills --env <envName> --client-id <id> --client-secret <secret>
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brand-review-probe.ts <envName> <brandKitId> [<sectionId> [<fieldId>]]
 *
 *   <envName>       = env profile from sitecoreai.cli.json (default: sandbox).
 *                     Its `organizationId` selects the credential record.
 *   <brandKitId>    = UUID of the brand kit to evaluate against. Get this
 *                     from the Brand Management API List Brand Kits
 *                     endpoint until scai ships the read primitives.
 *   <sectionId>     = optional UUID; narrows the review to one section.
 *   <fieldId>       = optional UUID; further narrows to one subsection
 *                     within that section.
 *
 * The probe sends a small known-good text payload, then prints:
 *   - the resolved orgId + credential metadata
 *   - the wire request body (so any field-name divergence is visible)
 *   - the wire response (raw, before scai's normalization)
 *   - scai's normalized BrandReviewResult (overallScore + flattened
 *     sectionResults)
 *
 * Exits with 0 on success, with the ScaiError exitCode on a known
 * scai failure, or 99 on unhandled exceptions.
 */
import { readRootConfiguration } from "@/config/root-config";
import {
  acquireAiSkillsToken,
  AI_SKILLS_API_HOST,
  BRAND_REVIEW_BASE_PATH,
  generateBrandReview,
  type BrandApiClientOptions,
} from "@/brand";
import { ScaiError } from "@/shared/errors";

const PROBE_TEXT =
  "Unleash your potential with Powerful! At Powerful, we believe in fueling your active " +
  "lifestyle with clean, nutrient-dense energy solutions. Whether you are starting your " +
  "fitness journey or a seasoned athlete, our products are designed to empower you.";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const brandKitId = process.argv[3];
  const sectionId = process.argv[4];
  const fieldId = process.argv[5];

  if (!brandKitId) {
    process.stderr.write(
      "ERROR: brandKitId is required.\n" +
        "USAGE: tsx scripts/_smoke-brand-review-probe.ts <envName> <brandKitId> [<sectionId> [<fieldId>]]\n"
    );
    process.exit(2);
  }

  const root = readRootConfiguration(process.cwd(), envName);
  const env = root.environments[envName];
  if (!env) {
    process.stderr.write(`ERROR: env profile '${envName}' not found in sitecoreai.cli.json.\n`);
    process.exit(2);
  }
  const orgId = env.organizationId;
  if (!orgId) {
    process.stderr.write(`ERROR: env '${envName}' has no organizationId.\n`);
    process.exit(2);
  }
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    process.stderr.write(
      `ERROR: no AI Skills credential configured for org '${orgId}'. Run \`scai login ai-skills -n ${envName}\` first.\n`
    );
    process.exit(3);
  }

  process.stderr.write(`> env:        ${envName}\n`);
  process.stderr.write(`> orgId:      ${orgId}\n`);
  process.stderr.write(`> clientId:   ${credential.clientId}\n`);
  process.stderr.write(`> brandKitId: ${brandKitId}\n`);
  if (sectionId) {
    process.stderr.write(`> sectionId:  ${sectionId}${fieldId ? `:${fieldId}` : ""}\n`);
  }
  process.stderr.write(`> host:       ${AI_SKILLS_API_HOST}${BRAND_REVIEW_BASE_PATH}\n\n`);

  try {
    // Step 1: prove we can mint a token with the right scopes. Fails
    // early if the credential is broken before we send any payload.
    process.stderr.write("[1/2] minting Brand Review token...\n");
    const token = await acquireAiSkillsToken({ orgId, credential });
    process.stderr.write(`      ok (len=${token.length})\n\n`);

    // Step 2: send the probe payload. This exercises:
    //   - request body shape (brandkitId lowercase, input map, sections[])
    //   - response normalization (reviews → flattened sectionResults)
    //   - overallScore aggregation (client-side min)
    process.stderr.write("[2/2] POST /api/skills/v1/brandreview/generate...\n");
    const client: BrandApiClientOptions = { orgId, credential };
    const result = await generateBrandReview({
      client,
      input: { text: PROBE_TEXT, label: "probe.txt" },
      selector: {
        brandKitId,
        sections: sectionId
          ? [{ sectionId, fieldIds: fieldId ? [fieldId] : undefined }]
          : undefined,
      },
    });
    process.stderr.write(`      ok\n\n`);

    // Pretty-print so divergences show up.
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
