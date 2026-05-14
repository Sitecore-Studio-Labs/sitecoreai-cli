import { fetchEnvironments, fetchEnvironmentDeployments, fetchDeployment } from "@/deploy/api";
import { getDeployContext } from "@/deploy/tasks/shared";

const main = async () => {
  const ctx = await getDeployContext({ environmentName: "test" });
  const apiOpts = { accessToken: ctx.token, baseUrl: ctx.baseUrl };

  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = (await fetchEnvironments(apiOpts, { PageNumber: page, PageSize: 50 })) as any;
    const data = res?.data ?? res?.environments ?? [];
    all.push(...data);
    const total = res?.totalCount ?? data.length;
    if (all.length >= total || data.length === 0) break;
  }

  const ehs = all.filter((e) => e.type === "eh");
  process.stderr.write(`# EH count: ${ehs.length}\n`);

  const results: any[] = [];
  let i = 0;
  const workers = Array.from({ length: 6 }).map(async () => {
    while (i < ehs.length) {
      const idx = i++;
      const e = ehs[idx];
      try {
        const dep = (await fetchEnvironmentDeployments(apiOpts, e.id)) as any;
        const list = dep?.data ?? dep?.deployments ?? dep ?? [];
        const sorted = Array.isArray(list)
          ? [...list].sort((a, b) =>
              String(b.createdAt ?? b.startedAt ?? "").localeCompare(
                String(a.createdAt ?? a.startedAt ?? "")
              )
            )
          : [];
        const latest = sorted[0];
        let latestDetail: any = null;
        if (latest?.id) {
          try {
            latestDetail = await fetchDeployment(apiOpts, latest.id, e.organizationId);
          } catch (err: any) {
            latestDetail = { _err: err?.message ?? String(err) };
          }
        }
        results.push({
          name: e.name,
          id: e.id,
          provisioningStatus: e.provisioningStatus,
          provisioningLastFailureMessage: e.provisioningLastFailureMessage,
          lastSuccessfulDeploymentId: e.lastSuccessfulDeploymentId,
          createdAt: e.createdAt,
          deploymentCount: Array.isArray(list) ? list.length : 0,
          latestId: latest?.id ?? null,
          latestCreatedAt: latest?.createdAt ?? null,
          latestCompletedAt: latest?.completedAt ?? null,
          latestDetailKeys: latestDetail ? Object.keys(latestDetail) : null,
          latestStatus:
            latestDetail?.statusName ??
            latestDetail?.status ??
            latestDetail?.deploymentStatus ??
            null,
          latestDetail,
        });
      } catch (err: any) {
        results.push({ name: e.name, id: e.id, error: err?.message ?? String(err) });
      }
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
