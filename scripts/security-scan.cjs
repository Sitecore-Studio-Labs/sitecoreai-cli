#!/usr/bin/env node
/**
 * Repo security gate — catches the classes of exposure the 2026-07 IP/security
 * audit found, so they cannot silently return. Runs over every git-tracked file
 * (so it honours .gitignore) and fails the build on any violation.
 *
 * What it blocks:
 *   1. Live customer/tenant organization IDs   (org_ + 16 base62 chars)
 *   2. Live tenant CM hostnames                (xmc-<slug>-<slug>-<slug>.sitecorecloud.io)
 *   3. JSON Web Tokens                          (three-segment eyJ… blobs)
 *   4. Non-production Sitecore hosts            (*.sitecore-staging.cloud)
 *   5. Committed recon/secret artifacts         (*.har, .scai/audit-history/**, real .env)
 *
 * Each rule has its own narrow allow predicate (e.g. org IDs must say
 * EXAMPLE/xxxx; hostnames must be xmc-example-*) plus the explicit ALLOWLIST
 * below. To sanction a new example value, add it to ALLOWLIST with a comment —
 * never widen a pattern to make a real value pass.
 *
 * Companion to gitleaks (secrets): gitleaks owns high-entropy credential
 * detection; this owns the identifiers/artifacts that are specific to this repo.
 */
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- CJS-only entry; loaded directly from CI without a TS transpile step. */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
/* eslint-enable @typescript-eslint/no-require-imports */

// Sanctioned literals that would otherwise match a content rule below.
const ALLOWLIST = new Set(["org_EXAMPLExxxxxxxx", "org_ABCDef123456"]);

const CONTENT_RULES = [
  {
    id: "live-org-id",
    // org_ followed by 16 base62 chars is the real Sitecore org-id shape.
    // Real IDs are random; a genuine placeholder says EXAMPLE/xxxx or is
    // explicitly sanctioned. Deliberately narrow — do NOT allow-list by
    // generic words a real ID could coincidentally contain.
    re: /\borg_[A-Za-z0-9]{16}\b/g,
    allow: (v) => ALLOWLIST.has(v) || /EXAMPLE|xxxx/i.test(v),
    message: "live organization ID (use org_EXAMPLExxxxxxxx in samples)",
  },
  {
    id: "live-tenant-host",
    // Real CM hosts are xmc-<org>-<project>-<env>.sitecorecloud.io (three
    // slug segments). Only the sanctioned xmc-example-* family is allowed.
    re: /\bxmc-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.sitecorecloud\.io\b/g,
    allow: (v) => /^xmc-example-/.test(v),
    message: "live tenant CM hostname (use xmc-example-env.sitecorecloud.io)",
  },
  {
    id: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g,
    allow: () => false,
    message: "JSON Web Token committed to the repo",
  },
  {
    id: "staging-host",
    re: /\b[a-z0-9.-]*\bsitecore-staging\.cloud\b/g,
    allow: () => false,
    message: "non-production (staging) Sitecore host",
  },
];

// Path-shaped rules — a tracked file whose PATH matches is itself the violation.
const PATH_RULES = [
  { id: "har-file", re: /\.har$/i, message: "HAR capture (contains session cookies/tokens)" },
  {
    id: "audit-snapshot",
    re: /(^|\/)\.scai\/audit-history\//,
    message: "committed tenant audit snapshot",
  },
  {
    id: "recon-dump",
    re: /\.investigation\.json$/i,
    message: "committed reconnaissance dump",
  },
  {
    id: "real-env-file",
    // .env and .env.<x> are secrets; .env.example / *.sample are fine.
    re: /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/,
    allow: (p) => /\.example$|\.sample$|\.template$/i.test(p),
    message: "environment file with real values (commit only .env.example)",
  },
];

// Skip files this scanner cannot meaningfully lint. This script itself is
// skipped because it necessarily contains the patterns it hunts for.
const SKIP_PATH = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.git\//,
  /package-lock\.json$/,
  /(^|\/)scripts\/security-scan\.cjs$/,
];

const isLikelyBinary = (buf) => {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
};

const trackedFiles = () =>
  execSync("git ls-files -z", { maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

const violations = [];

for (const file of trackedFiles()) {
  if (SKIP_PATH.some((re) => re.test(file))) continue;

  for (const rule of PATH_RULES) {
    if (rule.re.test(file) && !(rule.allow && rule.allow(file))) {
      violations.push({ file, line: 0, id: rule.id, message: rule.message, sample: file });
    }
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue;
  }
  if (isLikelyBinary(buf)) continue;

  const lines = buf.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of CONTENT_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.allow(m[0])) continue;
        violations.push({
          file,
          line: i + 1,
          id: rule.id,
          message: rule.message,
          sample: m[0],
        });
      }
    }
  }
}

if (violations.length === 0) {
  process.stdout.write("security-scan: no violations found.\n");
  process.exit(0);
}

process.stderr.write(`security-scan: ${violations.length} violation(s) found:\n\n`);
for (const v of violations) {
  const at = v.line ? `${v.file}:${v.line}` : v.file;
  process.stderr.write(`  [${v.id}] ${at}\n      ${v.message}\n      → ${v.sample}\n`);
}
process.stderr.write(
  "\nIf a match is an intentional placeholder, allow-list it in scripts/security-scan.cjs.\n" +
    "Never commit real customer identifiers, tokens, HAR captures, or tenant audit snapshots.\n"
);
process.exit(1);
