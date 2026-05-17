#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-off recon: discover the SXA Headless page base template GUID(s) and
 * the page-design binding fields on the sandbox tenant, so the
 * PageTemplateRecipe compiler can emit the right `__Base template`
 * inheritance.
 *
 * Usage:
 *   node --env-file=.env.test.local scripts/_recon-page-template.cjs children "<path>"
 *   node --env-file=.env.test.local scripts/_recon-page-template.cjs item "<path>"
 *   node --env-file=.env.test.local scripts/_recon-page-template.cjs basetree "<template-path-or-id>"
 */

const fs = require("node:fs");

const config = JSON.parse(fs.readFileSync("sitecoreai.cli.json", "utf8"));
const env = config.envProfiles.sandbox;
const host = env.host.startsWith("http") ? env.host : `https://${env.host}`;
const url = `${host.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1`;

const authority = process.env.SITECOREAI_AUTHORITY || "https://auth.sitecorecloud.io";
const audience = process.env.SITECOREAI_AUDIENCE || "https://api.sitecorecloud.io";

const gql = async (token, query, variables) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) console.error("GQL errors:", JSON.stringify(json.errors, null, 2));
  return json.data;
};

const token = async () => {
  const res = await fetch(`${authority}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SITECOREAI_CLIENT_ID,
      client_secret: process.env.SITECOREAI_CLIENT_SECRET,
      audience,
    }).toString(),
  });
  const { access_token } = await res.json();
  if (!access_token) throw new Error("no access_token — check SITECOREAI_CLIENT_ID/SECRET");
  return access_token;
};

const ITEM_QUERY = `
query($where: ItemQueryInput!) {
  item(where: $where) {
    itemId name path
    template { templateId name }
    children { nodes { itemId name path template { templateId name } } }
    fields(ownFields: false) {
      nodes { name value templateField { templateFieldId } }
    }
  }
}`;

const where = (arg) =>
  /^[{(]?[0-9a-fA-F-]{36}/.test(arg.replace(/[{}]/g, "")) ? { itemId: arg } : { path: arg };

const showItem = (item) => {
  if (!item) return console.log("  (item not found)");
  console.log(`  ${item.path}`);
  console.log(`  itemId:   ${item.itemId}`);
  console.log(`  template: ${item.template?.name}  ${item.template?.templateId}`);
};

(async () => {
  const [mode, arg] = process.argv.slice(2);
  if (!mode || !arg) {
    console.error("usage: <children|item|basetree> <path|id>");
    process.exit(1);
  }
  const t = await token();

  if (mode === "children") {
    const data = await gql(t, ITEM_QUERY, { where: where(arg) });
    showItem(data?.item);
    console.log("  children:");
    for (const c of data?.item?.children?.nodes ?? []) {
      console.log(`    ${c.name.padEnd(28)} ${(c.template?.name ?? "").padEnd(24)} ${c.path}`);
    }
    return;
  }

  if (mode === "item") {
    const data = await gql(t, ITEM_QUERY, { where: where(arg) });
    showItem(data?.item);
    console.log("  inherited fields with a value:");
    for (const f of data?.item?.fields?.nodes ?? []) {
      if (f.value) console.log(`    ${f.name.padEnd(28)} = ${String(f.value)}`);
    }
    return;
  }

  if (mode === "basetree") {
    // Walk __Base template recursively from a template item.
    const seen = new Set();
    const walk = async (idOrPath, depth) => {
      const data = await gql(t, ITEM_QUERY, { where: where(idOrPath) });
      const item = data?.item;
      if (!item) return console.log(`${"  ".repeat(depth)}(not found: ${idOrPath})`);
      const id = item.itemId.toLowerCase();
      if (seen.has(id))
        return console.log(`${"  ".repeat(depth)}${item.name}  ${item.itemId}  [seen]`);
      seen.add(id);
      console.log(`${"  ".repeat(depth)}${item.name}  ${item.itemId}  (${item.path})`);
      const baseField = (item.fields?.nodes ?? []).find((f) => f.name === "__Base template");
      const bases = (baseField?.value ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const b of bases) await walk(b, depth + 1);
    };
    await walk(arg, 0);
    return;
  }

  console.error(`unknown mode: ${mode}`);
  process.exit(1);
})();
