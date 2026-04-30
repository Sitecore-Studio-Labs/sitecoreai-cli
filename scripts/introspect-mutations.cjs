#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync("sitecoreai.cli.json", "utf8"));
const env = config.envProfiles.sandbox;
const host = env.host.startsWith("http") ? env.host : `https://${env.host}`;
const url = `${host.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1`;

const clientId = process.env.SITECOREAI_CLIENT_ID;
const clientSecret = process.env.SITECOREAI_CLIENT_SECRET;
const audience = process.env.SITECOREAI_AUDIENCE || "https://api.sitecorecloud.io";
const authority = process.env.SITECOREAI_AUTHORITY || "https://auth.sitecorecloud.io";

const query = `
query {
  __schema {
    mutationType {
      fields {
        name
        args {
          name
          type { name kind ofType { name kind ofType { name kind } } }
        }
        type { name kind }
      }
    }
  }
}`;

(async () => {
  const tokenRes = await fetch(`${authority}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }).toString(),
  });
  const { access_token } = await tokenRes.json();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  // Filter to item-related mutations
  const mutations = json.data?.__schema?.mutationType?.fields ?? [];
  const itemMutations = mutations.filter(
    (m) =>
      m.name.toLowerCase().includes("item") ||
      m.name.toLowerCase().includes("create") ||
      m.name.toLowerCase().includes("update")
  );
  console.log("Item-related mutations:");
  for (const m of itemMutations) {
    console.log(`  ${m.name}`);
    for (const arg of m.args) {
      const t = arg.type.name || arg.type.ofType?.name || arg.type.ofType?.ofType?.name || "?";
      console.log(`    ${arg.name}: ${t}`);
    }
  }
})();
