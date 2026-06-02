#!/usr/bin/env node
/**
 * Coverage-ratchet gate — fails CI when `vitest.config.ts` thresholds
 * drop below the recorded baseline in `coverage-ratchet.json` without
 * an explicit ALLOW_RATCHET_DOWN=1 override.
 *
 * The baseline is committed to the repo. To raise it (the usual case),
 * the script writes the new higher thresholds to the baseline whenever
 * RAISE_RATCHET=1 is set. To deliberately retreat (rare, audited),
 * commit the new baseline alongside an ALLOW_RATCHET_DOWN=1 invocation
 * — CI logs the retreat as an audit trail, the diff sits in the
 * baseline file for review.
 *
 * Usage:
 *
 *   # CI gate (default):
 *   node scripts/check-coverage-ratchet.cjs
 *
 *   # Raise the floor after improving coverage:
 *   RAISE_RATCHET=1 node scripts/check-coverage-ratchet.cjs
 *
 *   # Deliberate retreat (review the diff, document reason in commit):
 *   ALLOW_RATCHET_DOWN=1 RAISE_RATCHET=1 node scripts/check-coverage-ratchet.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CJS-only entry; loaded directly from CI without a TS transpile step. */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "vitest.config.ts");
const BASELINE_PATH = path.join(ROOT, "coverage-ratchet.json");

const METRICS = ["statements", "branches", "functions", "lines"];

const parseThresholds = (configSource) => {
  // Locate the `thresholds: { ... }` block. We tolerate keys in any
  // order and ignore comments inside the block — but we INSIST the
  // four metrics are present (otherwise vitest's silent-strip falls
  // back to 0, which the social contract prohibits).
  const match = configSource.match(/thresholds:\s*\{([\s\S]*?)\}/);
  if (!match) {
    throw new Error(
      "vitest.config.ts: no `thresholds: { ... }` block found. The ratchet gate requires explicit thresholds for statements / branches / functions / lines."
    );
  }
  const block = match[1];
  const found = {};
  for (const metric of METRICS) {
    const m = block.match(new RegExp(`${metric}:\\s*(\\d+(?:\\.\\d+)?)`));
    if (!m) {
      throw new Error(
        `vitest.config.ts: thresholds.${metric} is missing. All four metrics must be set explicitly.`
      );
    }
    found[metric] = Number(m[1]);
  }
  return found;
};

const readBaseline = () => {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
};

const writeBaseline = (thresholds) => {
  const body = {
    $schema:
      "Records the per-metric coverage thresholds. The check-coverage-ratchet script enforces 'never below baseline without ALLOW_RATCHET_DOWN=1'. Edit via the script, not by hand.",
    thresholds,
    updated: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`);
};

const main = () => {
  const configSource = fs.readFileSync(CONFIG_PATH, "utf8");
  const current = parseThresholds(configSource);
  const baseline = readBaseline();

  // First run / no baseline yet — seed it from current and exit.
  if (!baseline) {
    writeBaseline(current);
    console.log(
      `coverage-ratchet: seeded baseline at ${BASELINE_PATH} from current thresholds (${JSON.stringify(current)}). Commit the file.`
    );
    return;
  }

  const drops = [];
  const raises = [];
  for (const metric of METRICS) {
    const b = baseline.thresholds[metric];
    const c = current[metric];
    if (typeof b !== "number") {
      throw new Error(`coverage-ratchet.json: thresholds.${metric} missing or non-numeric.`);
    }
    if (c < b) drops.push({ metric, from: b, to: c });
    else if (c > b) raises.push({ metric, from: b, to: c });
  }

  if (drops.length > 0 && process.env.ALLOW_RATCHET_DOWN !== "1") {
    console.error("✗ coverage-ratchet: thresholds DROPPED below baseline.");
    for (const d of drops) {
      console.error(`    ${d.metric}: ${d.from} → ${d.to} (REGRESSION)`);
    }
    console.error("");
    console.error("Either restore the threshold or commit a deliberate retreat with");
    console.error("  ALLOW_RATCHET_DOWN=1 RAISE_RATCHET=1 node scripts/check-coverage-ratchet.cjs");
    console.error(
      "and document the reason in the commit message. The new baseline must be reviewed."
    );
    process.exit(1);
  }

  if (process.env.RAISE_RATCHET === "1") {
    if (raises.length === 0 && drops.length === 0) {
      console.log("coverage-ratchet: baseline already current — no-op.");
      return;
    }
    writeBaseline(current);
    if (drops.length > 0) {
      console.warn("⚠ coverage-ratchet: baseline LOWERED (audited retreat).");
      for (const d of drops) {
        console.warn(`    ${d.metric}: ${d.from} → ${d.to}`);
      }
    }
    if (raises.length > 0) {
      console.log("✓ coverage-ratchet: baseline RAISED.");
      for (const r of raises) {
        console.log(`    ${r.metric}: ${r.from} → ${r.to}`);
      }
    }
    return;
  }

  // No drops + no raise flag → silent pass, baseline unchanged.
  if (raises.length > 0) {
    console.log(
      "coverage-ratchet: thresholds RAISED above baseline (current run passes; commit with RAISE_RATCHET=1 to capture)."
    );
    for (const r of raises) {
      console.log(`    ${r.metric}: ${r.from} → ${r.to}`);
    }
  }
};

main();
