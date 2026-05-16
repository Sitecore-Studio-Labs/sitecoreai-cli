#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One-shot migration helper: delete an enumerations subtree on a tenant
 * so a subsequent `scai provision recipe push` can re-create the items conforming
 * to the new per-site `Enumeration` / `Enumerations Folder` templates.
 *
 * Why this exists: the Authoring GraphQL `updateItem` mutation can't
 * change an item's templateId after creation (verified against the
 * sandbox schema 2026-05-03 — `UpdateItemInput` only accepts database,
 * fields, itemId, language, path, version). Items pushed before scai
 * adopted the Enumeration template pair are still bound to the generic
 * Folder template; the only way to migrate them is delete-and-recreate.
 *
 * Usage:
 *   node scripts/cleanup-enumerations.cjs \
 *     --path "/sitecore/content/<site-coll>/<site>/Settings/Enumerations" \
 *     [--env-name sandbox] [--what-if] [--yes]
 *
 * Loads creds from the same env vars + sitecoreai.cli.json profile that
 * `scai provision recipe push` uses, so source the same `.env.test.local` first.
 */

const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const SCAI_DIR = path.resolve(__dirname, "..");
const { readRootConfiguration } = require(path.join(SCAI_DIR, "dist/config/root-config.js"));
const { createAuthoringClient } = require(
  path.join(SCAI_DIR, "dist/recipe/api/authoring-client.js")
);

function parseArgs(argv) {
  const args = { envName: "sandbox", whatIf: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" || a === "-p") args.path = argv[++i];
    else if (a === "--env-name" || a === "-n") args.envName = argv[++i];
    else if (a === "--what-if" || a === "-w") args.whatIf = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  console.log(`Usage: cleanup-enumerations.cjs --path <enum-root> [--env-name <name>] [--what-if] [--yes]

Required:
  --path, -p      Sitecore content path to delete recursively
                  (e.g. /sitecore/content/<site-coll>/<site>/Settings/Enumerations)

Options:
  --env-name, -n  scai env profile to use (default: sandbox)
  --what-if, -w   Preview the deletion; don't mutate anything
  --yes, -y       Skip the interactive confirmation prompt`);
}

async function walk(client, p, depth, lines) {
  if (depth > 8) return;
  const item = await client.getItem({ path: p });
  if (!item) return;
  lines.push(`${"  ".repeat(depth)}${item.name}  [${item.templateId.slice(0, 8)}…]`);
  const children = await client.getChildren({ path: p });
  for (const c of children) {
    await walk(client, `${p}/${c.name}`, depth + 1, lines);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.path) {
    usage();
    process.exit(args.help ? 0 : 2);
  }

  const config = readRootConfiguration(SCAI_DIR, args.envName);
  const env = config.environments[args.envName];
  if (!env) {
    console.error(`Env profile '${args.envName}' not found in ${SCAI_DIR}/sitecoreai.cli.json`);
    process.exit(2);
  }
  const client = createAuthoringClient({ environment: env });

  const root = await client.getItem({ path: args.path });
  if (!root) {
    console.log(`Nothing to delete: ${args.path} doesn't exist on '${args.envName}'.`);
    return;
  }

  const lines = [];
  await walk(client, args.path, 0, lines);
  console.log(`Subtree to delete on '${args.envName}' (${lines.length} items):\n`);
  console.log(lines.join("\n"));
  console.log();

  if (args.whatIf) {
    console.log("--what-if: no mutations performed.");
    return;
  }

  if (!args.yes) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `Permanently delete ${lines.length} items rooted at\n  ${args.path}\non '${args.envName}'? [y/N] `
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Aborted.");
      return;
    }
  }

  // Sitecore deleteItem cascades through children; one call removes the
  // whole subtree. `permanently: true` (the executor default) skips the
  // recycle bin so a re-push doesn't collide on the recycled GUIDs.
  await client.deleteItem({ path: args.path });
  console.log(`Deleted ${lines.length} items rooted at ${args.path}.`);
  console.log("Run `scai provision recipe push` to re-create with the new Enumeration templates.");
}

main().catch((err) => {
  console.error("FAIL", err?.message ?? err);
  process.exit(1);
});
