/**
 * Probe: verify the proposed fix for the dangling-brief-ref bug.
 *
 * Hypothesis: clearing `brief.references[]` BEFORE `deleteBrief` lets
 * Orchestrate clean up the reverse-view `project.briefs[]` reference
 * at the source. Then a subsequent `deleteProject` has no dangling
 * link to detach and succeeds. If this works, the fix is a tiny
 * scai-side change: prepend an unlink step to `runBriefDelete`.
 *
 * Sequence (self-cleaning):
 *   1. Create throwaway project + brief
 *   2. Link the brief to the project via updateBrief(refs)
 *   3. Read the project — confirm project.briefs[] now contains the brief
 *   4. unlink: updateBrief(briefId, {references: []})
 *   5. Read the project — does project.briefs[] still reference the brief?
 *   6. deleteBrief
 *   7. deleteProject — should succeed cleanly (the fix is real if this works)
 *
 * Output is JSON to stdout with each step's outcome.
 */
import {
  createBrief,
  deleteBrief,
  listBriefTypes,
  resolveBriefClient,
  updateBrief,
  type BriefType,
} from "@/brief";
import {
  createProject,
  deleteProject,
  getProject,
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

  process.stderr.write(`> resolving clients\n`);
  const { client: campaignClient } = await resolveCampaignClient({ envName });
  const { client: briefClient } = await resolveBriefClient({ envName });

  const stamp = new Date().toISOString();

  // 1. Pick a brief type.
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
    process.exit(1);
  }

  // 2. Create throwaway project.
  let project: Project | undefined;
  try {
    project = await createProject(campaignClient, {
      name: `scai-probe-unlink ${stamp}`,
      description: "Throwaway — _probe-project-update.ts.",
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    });
    push("create project", true, `id=${project.id}`);
  } catch (error) {
    push("create project", false, String(error));
    process.exit(1);
  }

  // 3. Create brief.
  let briefId: string | undefined;
  try {
    const brief = await createBrief(briefClient, {
      name: `scai-probe-unlink-brief ${stamp}`,
      briefTypeId: briefType.id,
      locale: "en-us",
      fields: {},
    });
    briefId = brief.id;
    push("create brief", true, `id=${briefId}`);
  } catch (error) {
    push("create brief", false, String(error));
  }

  // 4. Link brief→project via updateBrief.
  if (briefId) {
    try {
      await updateBrief(briefClient, briefId, {
        references: [
          {
            type: "ExternalLink",
            relatedSystem: "co",
            relatedType: "Project",
            id: project.id,
          },
        ],
      });
      push("link brief→project", true, "");
    } catch (error) {
      push("link brief→project", false, String(error));
    }
  }

  // 5. Verify the reverse view — project.briefs[] now contains the brief.
  try {
    const refreshed = await getProject(campaignClient, project.id);
    const briefIds = (refreshed.briefs ?? []).map((b) => b.id);
    const hasBrief = briefIds.includes(briefId ?? "");
    push(
      "read project after link",
      hasBrief,
      `briefs=${JSON.stringify(briefIds)}`,
    );
  } catch (error) {
    push("read project after link", false, String(error));
  }

  // 6. THE TEST: clear brief.references[] BEFORE deleting the brief.
  if (briefId) {
    try {
      await updateBrief(briefClient, briefId, { references: [] });
      push("unlink (references: [])", true, "");
    } catch (error) {
      push("unlink (references: [])", false, String(error));
    }
  }

  // 7. Re-read project — did Orchestrate clean up project.briefs[]?
  let projectBriefsAfterUnlink: Array<{ id: string }> = [];
  try {
    const refreshed = await getProject(campaignClient, project.id);
    projectBriefsAfterUnlink = refreshed.briefs ?? [];
    const briefIds = projectBriefsAfterUnlink.map((b) => b.id);
    const stillHasBrief = briefIds.includes(briefId ?? "");
    push(
      "read project after unlink",
      !stillHasBrief,
      `briefs=${JSON.stringify(briefIds)} (cleared=${!stillHasBrief})`,
    );
  } catch (error) {
    push("read project after unlink", false, String(error));
  }

  // 8. Delete the brief.
  if (briefId) {
    try {
      await deleteBrief(briefClient, briefId);
      push("delete brief", true, `id=${briefId}`);
    } catch (error) {
      push("delete brief", false, String(error));
    }
  }

  // 9. Delete the project. SUCCEEDS = the fix works.
  try {
    await deleteProject(campaignClient, project.id);
    push("delete project (the fix test)", true, "succeeded ✓");
  } catch (error) {
    push("delete project (the fix test)", false, String(error).slice(0, 300));
  }

  process.stdout.write(`${JSON.stringify({ records }, null, 2)}\n`);
  process.exit(records.every((r) => r.ok) ? 0 : 1);
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
