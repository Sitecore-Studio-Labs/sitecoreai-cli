/**
 * Probe: discover the HTTP contract for clearing `briefs[]` on a
 * project. The dangling-brief-ref bug (where deleteProject 403s
 * because the project still references a brief that's already been
 * deleted) needs a workaround: PATCH or PUT the project to clear
 * `briefs[]`, then retry DELETE.
 *
 * Sequence (self-cleaning):
 *   1. Create throwaway project + brief + link
 *   2. Delete the brief directly → project now has dangling brief ref
 *   3. Try `deleteProject` → expect to fail with the detach error
 *   4. Try PATCH /projects/{id} body { briefs: [] }
 *   5. Try PUT /projects/{id} body { ...project, briefs: [] }
 *   6. Whichever update works → retry DELETE
 *   7. If all fail → DELETE the project (might require admin cleanup)
 *
 * Output is JSON to stdout with the results of each step.
 */
import {
  resolveBriefClient,
  createBrief,
  deleteBrief,
  type BriefType,
  listBriefTypes,
  updateBrief,
} from "@/brief";
import {
  campaignRequest,
  createProject,
  deleteProject,
  resolveCampaignClient,
  type Project,
} from "@/campaigns";

type StepRecord = {
  step: string;
  ok: boolean;
  detail: string;
};

const main = async (): Promise<void> => {
  const envName = process.argv[2];
  const records: StepRecord[] = [];
  const push = (step: string, ok: boolean, detail: string): void => {
    records.push({ step, ok, detail });
    process.stderr.write(`  ${ok ? "ok  " : "FAIL"} ${step} — ${detail}\n`);
  };

  process.stderr.write(`> resolving clients${envName ? ` for '${envName}'` : ""}\n`);
  const { client: campaignClient, orgId } = await resolveCampaignClient({
    envName,
  });
  const { client: briefClient } = await resolveBriefClient({ envName });
  process.stderr.write(`> org=${orgId}\n`);
  process.stderr.write(`> campaignBase=${campaignClient.baseUrl}\n`);
  process.stderr.write(`> briefBase=${briefClient.baseUrl}\n`);

  const stamp = new Date().toISOString();

  // 1. Pick a brief type so the throwaway brief is creatable.
  let briefType: BriefType | undefined;
  try {
    const types = await listBriefTypes(briefClient, { limit: 5 });
    briefType = types.data[0];
    if (!briefType) {
      push("pick brief type", false, "no brief types on tenant");
      process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
      process.exit(1);
    }
    push("pick brief type", true, `name=${briefType.name}`);
  } catch (error) {
    push("pick brief type", false, String(error));
    process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
    process.exit(1);
  }

  // 2. Create throwaway project.
  let project: Project | undefined;
  try {
    project = await createProject(campaignClient, {
      name: `scai-probe-update ${stamp}`,
      description: "Throwaway project — _probe-project-update.ts.",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    });
    push("create project", true, `id=${project.id}`);
  } catch (error) {
    push("create project", false, String(error));
    process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
    process.exit(1);
  }

  // 3. Create a brief, then PUT references pointing at the project.
  let briefId: string | undefined;
  try {
    const brief = await createBrief(briefClient, {
      name: `scai-probe-update-brief ${stamp}`,
      briefTypeId: briefType.id,
      locale: "en-us",
      fields: {},
    });
    briefId = brief.id;
    push("create brief", true, `id=${briefId}`);
  } catch (error) {
    push("create brief", false, String(error));
  }
  if (briefId) {
    try {
      await updateBrief(briefClient, briefId, {
        references: [
          {
            type: "ExternalLink",
            relatedSystem: "Orchestrate",
            relatedType: "Campaign",
            id: project.id,
          },
        ],
      });
      push("link brief→project", true, `briefId=${briefId}`);
    } catch (error) {
      push("link brief→project", false, String(error));
    }
  }

  // 4. Delete the brief → project now has a dangling brief reference.
  if (briefId) {
    try {
      await deleteBrief(briefClient, briefId);
      push("delete brief", true, `id=${briefId}`);
    } catch (error) {
      push("delete brief", false, String(error));
    }
  }

  // 5. Try deleteProject → expect failure if the bug reproduces.
  try {
    await deleteProject(campaignClient, project.id);
    push(
      "initial deleteProject",
      true,
      "succeeded immediately — bug may not reproduce on this tenant",
    );
    process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    push("initial deleteProject", false, `${String(error).slice(0, 200)}`);
  }

  const projectPath = `/api/orchestrate/v1/projects/${encodeURIComponent(project.id)}`;

  // 6. PATCH attempt — partial update with just briefs cleared.
  try {
    await campaignRequest<unknown>(campaignClient, projectPath, {
      method: "PATCH",
      body: { briefs: [] },
    });
    push("PATCH { briefs: [] }", true, "accepted");
  } catch (error) {
    push("PATCH { briefs: [] }", false, `${String(error).slice(0, 200)}`);
  }

  // 7. PUT attempt — full body with briefs[] cleared. Use the project
  // we created plus an empty briefs array.
  try {
    await campaignRequest<unknown>(campaignClient, projectPath, {
      method: "PUT",
      body: {
        name: project.name,
        description: project.description ?? "",
        start_date: project.start_date,
        due_date: project.due_date,
        status: project.status,
        brandkit_id: project.brandkit_id,
        labels: project.labels ?? [],
        members: project.members ?? [],
        briefs: [],
      },
    });
    push("PUT (full body) briefs=[]", true, "accepted");
  } catch (error) {
    push(
      "PUT (full body) briefs=[]",
      false,
      `${String(error).slice(0, 200)}`,
    );
  }

  // 8. Retry deleteProject after attempted updates.
  try {
    await deleteProject(campaignClient, project.id);
    push("deleteProject (after update)", true, "succeeded ✓");
  } catch (error) {
    push(
      "deleteProject (after update)",
      false,
      `${String(error).slice(0, 200)}`,
    );
  }

  process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
  process.exit(records.every((r) => r.ok) ? 0 : 1);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
