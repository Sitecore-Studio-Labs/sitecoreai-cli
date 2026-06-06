import { resolveEnvironment } from "@/policy/environment";
import { getAccessToken } from "@/serialization/api/auth";
import { listSites, deleteSite } from "@/sites/api/sites";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "TestDemo";
  const action = process.argv[3] ?? "list";
  const { environment } = resolveEnvironment({ environmentName: envName, skipPolicy: true });
  const accessToken = await getAccessToken(environment);
  if (!accessToken) throw new Error("no token");
  const sites = await listSites({ accessToken });
  for (const s of sites) {
    const name = (s as { name?: string }).name;
    if (name?.startsWith("E2eSite")) {
      console.log(name, (s as { id?: string }).id);
      if (action === "delete" && (s as { id?: string }).id) {
        try {
          await deleteSite({ accessToken }, (s as { id: string }).id, { force: true });
          console.log(`  deleted`);
        } catch (e) {
          console.log(`  delete failed: ${(e as Error).message}`);
        }
      }
    }
  }
};
main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(99);
});
