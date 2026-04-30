#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-off diagnostic: fetch the cta-button template item and print its
 * fields, to see what the Authoring API actually stores after a recipe push.
 */

const fs = require("node:fs");

const config = JSON.parse(fs.readFileSync("sitecoreai.cli.json", "utf8"));
const env = config.envProfiles.sandbox;
const host = env.host.startsWith("http") ? env.host : `https://${env.host}`;
const url = `${host.replace(/\/$/, "")}/sitecore/api/authoring/graphql/v1`;

const clientId = process.env.SITECOREAI_CLIENT_ID;
const clientSecret = process.env.SITECOREAI_CLIENT_SECRET;
const audience = process.env.SITECOREAI_AUDIENCE || "https://api.sitecorecloud.io";
const authority = process.env.SITECOREAI_AUTHORITY || "https://auth.sitecorecloud.io";

const PATH = process.argv[2] || "/sitecore/templates/Project/CtaButton";

const QUERY = `
query($path: String!) {
  item(where: { path: $path }) {
    itemId
    name
    path
    parent { itemId path }
    template { templateId name }
    ownFields: fields(ownFields: true) {
      nodes {
        name
        value
        templateField { templateFieldId }
      }
    }
    inherited: fields(ownFields: false) {
      nodes {
        name
        value
        templateField { templateFieldId }
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ query: QUERY, variables: { path: PATH } }),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
})();
