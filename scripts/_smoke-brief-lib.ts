/**
 * End-to-end smoke through the real `@/brief` library, not just the
 * probe scripts. Exercises `acquireBriefToken` against the env profile
 * pattern, then calls each verified read helper and prints the result.
 *
 * Usage:
 *   SITECOREAI_ENV_<NAME>_CLIENT_ID='<id>' \
 *   SITECOREAI_ENV_<NAME>_CLIENT_SECRET='<secret>' \
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brief-lib.ts <NAME>
 */
import {
  acquireBriefToken,
  listBriefs,
  listBriefTypes,
  listBriefTasks,
  listBriefComments,
  type BriefApiClientOptions,
} from "@/brief";

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  if (!envName) {
    process.stderr.write("Usage: tsx scripts/_smoke-brief-lib.ts <ENV_NAME>\n");
    process.exit(2);
  }
  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_ID`];
  const clientSecret = process.env[`SITECOREAI_ENV_${envSlug}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    process.stderr.write(`Missing env creds for ${envSlug}\n`);
    process.exit(2);
  }

  // Build the env profile shape `acquireBriefToken` expects.
  const environment = {
    host: "",
    authority: "https://auth.sitecorecloud.io",
    audience: "https://api.sitecorecloud.io",
    clientId,
    clientSecret,
    name: envName,
  };

  process.stderr.write(`> acquiring brief token via M2M\n`);
  const accessToken = await acquireBriefToken({ envName, environment });
  process.stderr.write(`> token acquired, length=${accessToken.length}\n`);

  const options: BriefApiClientOptions = { accessToken };

  const briefs = await listBriefs(options);
  process.stderr.write(`> listBriefs: ${briefs.totalCount} total\n`);
  const briefId = briefs.data[0]?.id;

  const types = await listBriefTypes(options);
  process.stderr.write(`> listBriefTypes: ${types.totalCount} total\n`);

  const tasks = await listBriefTasks(options, briefId ? { briefId } : undefined);
  process.stderr.write(`> listBriefTasks (BriefId=${briefId ?? "<none>"}): ${tasks.totalCount}\n`);

  const comments = await listBriefComments(options, briefId ? { briefId } : undefined);
  process.stderr.write(`> listBriefComments: ${comments.totalCount}\n`);

  process.stdout.write(
    `${JSON.stringify(
      {
        briefs: {
          totalCount: briefs.totalCount,
          firstName: briefs.data[0]?.name,
          firstStatus: briefs.data[0]?.status,
          firstBriefTypeId: briefs.data[0]?.briefType.id,
        },
        types: {
          totalCount: types.totalCount,
          names: types.data.map((t) => t.name),
          firstFieldCount: types.data[0]?.fields.length,
        },
        tasks: { totalCount: tasks.totalCount },
        comments: { totalCount: comments.totalCount },
      },
      null,
      2
    )}\n`
  );
};

main().catch((err) => {
  process.stderr.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
