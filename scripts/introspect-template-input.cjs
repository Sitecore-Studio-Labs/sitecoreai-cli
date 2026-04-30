#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync("sitecoreai.cli.json", "utf8"));
const env = config.envProfiles.sandbox;
const host = env.host.startsWith("http") ? env.host : `https://${env.host}`;
const url = `${host.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1`;

const introspectType = (name) => `
  ${name}: __type(name: "${name}") {
    name
    inputFields {
      name
      type { name kind ofType { name kind ofType { name kind } } }
    }
  }
`;

const query = `query {
  ${introspectType("CreateItemInput")}
  ${introspectType("UpdateItemInput")}
  ${introspectType("CreateItemTemplateInput")}
  ${introspectType("CreateItemFromBranchInput")}
  ${introspectType("DeleteItemInput")}
}`;

(async () => {
  const tokenRes = await fetch(
    `${process.env.SITECOREAI_AUTHORITY || "https://auth.sitecorecloud.io"}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SITECOREAI_CLIENT_ID,
        client_secret: process.env.SITECOREAI_CLIENT_SECRET,
        audience: process.env.SITECOREAI_AUDIENCE || "https://api.sitecorecloud.io",
      }).toString(),
    }
  );
  const { access_token } = await tokenRes.json();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  for (const [type, info] of Object.entries(json.data || {})) {
    if (!info) {
      console.log(`${type}: NOT FOUND`);
      continue;
    }
    console.log(`\n${info.name}:`);
    for (const f of info.inputFields) {
      const t = f.type.name || f.type.ofType?.name || f.type.ofType?.ofType?.name || "?";
      const required = f.type.kind === "NON_NULL" ? "!" : "";
      const isList = f.type.kind === "LIST" || f.type.ofType?.kind === "LIST";
      console.log(`  ${f.name}: ${isList ? "[" : ""}${t}${required}${isList ? "]" : ""}`);
    }
  }
})();
