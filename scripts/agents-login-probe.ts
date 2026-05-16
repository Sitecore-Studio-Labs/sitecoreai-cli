/**
 * agents-login-probe.ts — manual validation of the Agentic Studio auth seam.
 *
 * Proves the full chain `src/agents/` depends on, all from Node:
 *
 *     login → cookie capture → authenticated READ + WRITE + STREAM calls
 *
 * The browser-console scripts proved the API contract using the browser's
 * OWN ambient cookies. This proves the *replayed* cookie authenticates the
 * BFF from Node — including writes (Origin/CSRF) and the SSE run stream.
 *
 * It creates a throwaway agent `scai-write-probe-<ts>`, a space, runs it
 * once with a one-word prompt, then DELETES the agent. (Spaces have no
 * delete endpoint, so one probe space is left behind.)
 *
 * Run (from the repo root):
 *     pnpm exec tsx -r tsconfig-paths/register scripts/agents-login-probe.ts
 *
 * The credential is cached — the browser login happens once. Delete the
 * cache file (printed below) to force a fresh login.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runPlaywrightLogin } from "@/agents/session/playwright-login";
import { createAgentsSession, type AgentsCredential, type AgentsSession } from "@/agents/session";
import { agentsRequest, agentsStream } from "@/agents/api/request";

const CACHE_PATH = "/tmp/agents-probe-credential.json";

const getSession = async (): Promise<AgentsSession> => {
  let credential: AgentsCredential;
  if (existsSync(CACHE_PATH)) {
    console.log(`[probe] reusing cached credential — ${CACHE_PATH} (delete it to force re-login)`);
    credential = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as AgentsCredential;
  } else {
    console.log("[probe] launching browser — sign in to Sitecore in the window…");
    credential = await runPlaywrightLogin({ region: "euw" });
    writeFileSync(CACHE_PATH, JSON.stringify(credential, null, 2));
    console.log(`[probe] credential cached to ${CACHE_PATH} — re-runs skip the browser.`);
  }
  return createAgentsSession(credential);
};

const PROBE_TOOLS = {
  enableArtifacts: true,
  enableContextRetrieval: false,
  enableSitecoreContext: false,
  enableWebSearch: false,
  enableImageGeneration: false,
  enableInsightsData: false,
  enableAgentApiSites: false,
  enableAgentApiPages: false,
  enableAgentApiContent: false,
  enableAgentApiComponents: false,
  enableAgentApiAssets: false,
  enableAgentApiPersonalization: false,
  enableAgentApiJobs: false,
  enableAgentApiBriefs: false,
  enableAgentApiBrandKits: false,
  enableStructuredOutput: false,
};

const main = async (): Promise<void> => {
  const session = await getSession();

  // --- READ ---------------------------------------------------------------
  console.log("[probe] READ   GET /api/agents …");
  const agents = await agentsRequest<unknown[]>(session, "/api/agents");
  console.log(`[probe]    -> ${Array.isArray(agents) ? agents.length : "?"} agents`);

  // --- WRITE: create the probe agent --------------------------------------
  const name = `scai-write-probe-${Date.now()}`;
  console.log(`[probe] WRITE  POST /api/agents  ("${name}") …`);
  const created = await agentsRequest<unknown>(session, "/api/agents", {
    method: "POST",
    body: {
      name,
      description: "Temporary — scai transport write-path probe.",
      prompt: "You are a test agent. Reply concisely.",
      tags: [],
      config: {
        executionMode: "standard",
        tools: PROBE_TOOLS,
        defaultContext: [],
        skills: [],
        output: { format: "text" },
      },
      isPredefined: false,
    },
  });
  const agent = (Array.isArray(created) ? created[0] : created) as { id?: string; slug?: string };
  if (!agent?.id || !agent?.slug) {
    throw new Error(`POST /api/agents returned an unexpected shape: ${JSON.stringify(created)}`);
  }
  console.log(`[probe]    -> created id=${agent.id} slug=${agent.slug}`);

  try {
    // --- WRITE: space (POST + PUT config) ---------------------------------
    const spaceId = randomUUID();
    const spaceConfig = {
      purpose: "custom",
      workPattern: "custom-orchestration",
      spaceName: name,
      globalContext: { objective: "" },
      items: [],
      agents: [{ slug: agent.slug, title: name, instanceId: randomUUID() }],
      agentExecutionMode: "sequential",
      launchTarget: { kind: "agent", graphType: agent.slug },
    };
    console.log("[probe] WRITE  POST /api/spaces + PUT /api/spaces/{id}/config …");
    await agentsRequest(session, "/api/spaces", {
      method: "POST",
      body: { id: spaceId, title: name, spaceConfig },
    });
    await agentsRequest(session, `/api/spaces/${spaceId}/config`, {
      method: "PUT",
      body: { spaceConfig },
    });
    console.log(`[probe]    -> space ${spaceId}`);

    // --- STREAM: run the agent (SSE) --------------------------------------
    console.log("[probe] STREAM POST /api/chatv2 …");
    let chunks = 0;
    let sawDone = false;
    for await (const chunk of agentsStream(session, "/api/chatv2", {
      method: "POST",
      body: {
        id: spaceId,
        agentType: "agent",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Reply with the single word: ok" }],
          id: randomUUID(),
        },
        selectedVisibilityType: "private",
        graphType: agent.slug,
      },
    })) {
      chunks += 1;
      if (chunk.includes("[DONE]")) sawDone = true;
    }
    console.log(`[probe]    -> stream delivered ${chunks} chunk(s), sawDONE=${sawDone}`);
  } finally {
    // --- CLEANUP: delete the probe agent ----------------------------------
    console.log(`[probe] DELETE /api/agents/${agent.id} (cleanup) …`);
    try {
      await agentsRequest(session, `/api/agents/${agent.id}`, { method: "DELETE" });
      console.log("[probe]    -> deleted");
    } catch (error) {
      console.error(
        "[probe]    -> cleanup delete failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log("[probe] PASS — cookie authenticates READ + WRITE + STREAM from Node.");
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[probe] FAIL — ${message}`);
  if (error && typeof error === "object" && "hint" in error) {
    console.error("[probe] hint:", (error as { hint?: string }).hint);
  }
  process.exitCode = 1;
});
