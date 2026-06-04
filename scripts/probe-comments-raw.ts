import { resolveBriefClient } from "@/brief/client";

async function main(): Promise<void> {
  const { client } = await resolveBriefClient({});
  const briefId = "c3c242ce-d618-4fe2-b7e8-181d5b927e73";
  // Try GET single-comment by id — the inline brief.comments[] returns
  // only ids; see if the dedicated read endpoint returns populated data.
  const commentIds = [
    "4d19e511-db37-4e02-8801-2ef1244f10bf",
    "a00d6442-e99c-4332-8dfc-29d19c6e649e",
    "a8c2f1c1-74a1-429d-8717-63f4aa2bb291",
    "7239693e-a2f9-4993-aa7d-7d3098dfdd95",
  ];
  for (const id of commentIds) {
    const u = `${client.baseUrl}/api/brief/v1/comments/${id}`;
    const res = await fetch(u, {
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: "application/json",
      },
    });
    console.log(`\n--- GET /comments/${id} → ${res.status} ${res.statusText} ---`);
    const body = await res.text();
    console.log(body.slice(0, 1200));
  }
  void briefId;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
