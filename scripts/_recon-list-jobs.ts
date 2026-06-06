import { resolveEnvironment } from "@/policy/environment";
import { getAccessToken } from "@/serialization/api/auth";
import { listJobs } from "@/sites/api/jobs";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const accessToken = await getAccessToken(environment);
  if (!accessToken) throw new Error("no token");
  const jobs = await listJobs({ accessToken });
  console.log(`Total jobs: ${jobs.length}`);
  for (const j of jobs.slice(0, 20)) {
    console.log(JSON.stringify(j, null, 2));
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
