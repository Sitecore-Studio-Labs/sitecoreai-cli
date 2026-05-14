import { fetchEnvironments } from "@/deploy/api";
import { getDeployContext } from "@/deploy/tasks/shared";

const main = async () => {
  const ctx = await getDeployContext({ environmentName: "test" });
  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = (await fetchEnvironments(
      { accessToken: ctx.token, baseUrl: ctx.baseUrl },
      { PageNumber: page, PageSize: 50 }
    )) as any;
    const data = res?.data ?? res?.environments ?? [];
    all.push(...data);
    const total = res?.totalCount ?? data.length;
    if (all.length >= total || data.length === 0) break;
  }
  for (const e of all) {
    process.stdout.write(`${e.name}\t${e.type}\t${e.id}\t${e.provisioningStatus}\n`);
  }
  process.stderr.write(`# total=${all.length}\n`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
