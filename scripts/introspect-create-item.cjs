#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-off introspection helper. Discovers the actual `CreateItemInput`
 * shape on the connected Authoring API, plus a few related types so we
 * know what `parent`, `templateId`, and `fields` actually expect.
 *
 * Reads SITECOREAI_ENV_SANDBOX_* (or globals) from env. Run via:
 *   set -a && . .env.test.local && set +a
 *   node scripts/introspect-create-item.cjs
 */

const fs = require("node:fs");

// Find env profile
const config = JSON.parse(fs.readFileSync("sitecoreai.cli.json", "utf8"));
const env = config.envProfiles.sandbox;
const host = env.host.startsWith("http") ? env.host : `https://${env.host}`;
const url = `${host.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1`;

const clientId = process.env.SITECOREAI_CLIENT_ID;
const clientSecret = process.env.SITECOREAI_CLIENT_SECRET;
const audience = process.env.SITECOREAI_AUDIENCE || "https://api.sitecorecloud.io";
const authority = process.env.SITECOREAI_AUTHORITY || "https://auth.sitecorecloud.io";

const introspectionQuery = `
query Introspect {
  inputType: __type(name: "CreateItemInput") {
    name
    inputFields {
      name
      type { name kind ofType { name kind ofType { name kind } } }
    }
  }
  fieldType: __type(name: "ItemFieldValueInput") {
    name
    inputFields {
      name
      type { name kind ofType { name kind } }
    }
  }
  altFieldType: __type(name: "FieldValueInput") {
    name
    inputFields {
      name
      type { name kind ofType { name kind } }
    }
  }
  itemType: __type(name: "Item") {
    name
    fields {
      name
      type { name kind ofType { name kind } }
    }
  }
}`;

(async () => {
  // Mint token
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
  if (!tokenRes.ok) {
    console.error("token mint failed:", tokenRes.status, await tokenRes.text());
    process.exit(1);
  }
  const { access_token } = await tokenRes.json();

  // Introspect
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ query: introspectionQuery }),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
})();
