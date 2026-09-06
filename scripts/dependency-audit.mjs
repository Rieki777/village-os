#!/usr/bin/env node
/**
 * The dependency audit gate.
 *
 * WHY THIS EXISTS RATHER THAN A BARE `pnpm audit`. The CI step used to be
 * `pnpm audit --prod --audit-level high`, which is correct about advisories and
 * wrong about everything else, because ONE exit code carries two completely
 * different facts:
 *
 *   1. "This tree depends on something with a high advisory."   MUST block.
 *   2. "I could not reach the registry to ask."                 Must NOT block.
 *
 * On 2026-09-04 the second happened. `registry.npmjs.org` served its root in
 * 0.34s while `/-/npm/v1/security/audits` hung and timed out, npm's own status
 * page said All Systems Operational, and every merge in this repository stopped,
 * main included, because a third party's endpoint was down. Nothing was wrong
 * with anybody's code.
 *
 * So this script separates the two questions. It ASKS for a result, and it only
 * ever fails the build on an ANSWER.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not weaken the gate on findings. A high or critical advisory exits 1,
 * exactly as before, and the ci.yml note still stands: if an advisory has no
 * upstream fix, add a documented `pnpm.overrides` or an explicit dated ignore.
 * `continue-on-error` remains the wrong answer, because it cannot tell the two
 * cases apart either.
 *
 * The decision to pass on an unreachable registry is a deliberate trade, made
 * once, in the open: the audit reads KNOWN advisories, which do not change in
 * the minutes an outage lasts, and the next commit asks again. Blocking every
 * lane in the programme on somebody else's uptime is the worse failure, and it
 * is the one that pushes people toward disabling the gate permanently.
 *
 * ── THE SHAPE THAT MATTERS, AND IT IS NOT THE OBVIOUS ONE ────────────────
 *
 * pnpm reports an unreachable registry as a PARSEABLE JSON DOCUMENT on stdout:
 *
 *     {"error":{"code":"ECONNREFUSED","message":"request to ... failed"}}
 *
 * not as unparseable noise and not on stderr. The first version of this script
 * looked for a network signature in stderr, and stderr held nothing but a node
 * deprecation warning, so it called a blackholed registry a real failure and
 * exited 1. Measured against `npm_config_registry=http://127.0.0.1:9/`, which
 * is how both paths below are tested.
 */
import { spawn } from "node:child_process";

const ATTEMPTS = 3;
const BACKOFF_MS = [0, 5000, 15000];
/** Anything at or above this fails the build. */
const BLOCKING = ["high", "critical"];

const NETWORK =
  /FetchError|Socket timeout|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_SOCKET|network|socket hang up|request to .* failed/i;

function runAudit() {
  return new Promise((resolve) => {
    // shell:true on Windows ONLY, and it is required rather than convenient:
    // node refuses to spawn a .cmd shim without a shell and throws EINVAL, and
    // pnpm on Windows is a .cmd. Node warns that shell:true concatenates
    // arguments instead of escaping them, which is a real hazard when any
    // argument comes from outside; every argument here is a fixed literal on
    // the next line, so there is nothing to escape. CI runs ubuntu and takes
    // the plain path.
    const p = spawn("pnpm", ["audit", "--prod", "--audit-level", "high", "--json"], {
      shell: process.platform === "win32",
      // pnpm retries fetches on its own, so without this the two retry loops
      // MULTIPLY: three attempts here became nine requests and took 233s
      // against a blackholed registry. Retrying is this script's job, where the
      // backoff is visible and the total is bounded, so pnpm's own is turned off.
      env: { ...process.env, npm_config_fetch_retries: "0" },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: -1, out, err: err + String(e) }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

/** pnpm prints a deprecation warning before the document, so parse from the first brace. */
function parseDoc(out) {
  const i = out.indexOf("{");
  if (i < 0) return null;
  try {
    const doc = JSON.parse(out.slice(i));
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}

let lastErr = "";

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const wait = BACKOFF_MS[attempt - 1];
  if (wait) {
    console.log(`  registry did not answer, waiting ${wait / 1000}s before attempt ${attempt} of ${ATTEMPTS}`);
    await new Promise((r) => setTimeout(r, wait));
  }

  const { code, out, err } = await runAudit();
  const doc = parseDoc(out);

  // Tested FIRST, because this is the shape the gate exists to survive.
  if (doc && doc.error) {
    lastErr = [doc.error.code, doc.error.message].filter(Boolean).join(": ");
    if (NETWORK.test(lastErr)) continue;
    console.error("\nDEPENDENCY AUDIT FAILED: the registry answered with an error that does not");
    console.error("look like a network problem, so it is not being waived.\n");
    console.error(`  ${lastErr}\n`);
    process.exit(1);
  }

  if (doc && doc.metadata) {
    const v = doc.metadata.vulnerabilities || {};
    const blocking = BLOCKING.reduce((n, k) => n + (Number(v[k]) || 0), 0);
    const counts = Object.entries(v).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "none";

    if (blocking > 0) {
      console.error(`\nDEPENDENCY AUDIT FAILED: ${blocking} advisory(ies) at high or above.\n`);
      console.error(`  all severities: ${counts}\n`);
      for (const a of Object.values(doc.advisories || {})) {
        if (!BLOCKING.includes(String(a.severity))) continue;
        console.error(`  ${String(a.severity).toUpperCase()}  ${a.module_name}  ${a.title}`);
        if (a.patched_versions) console.error(`      patched in: ${a.patched_versions}`);
        if (a.url) console.error(`      ${a.url}`);
      }
      console.error("\nIf there is no upstream fix, add a documented pnpm.overrides entry, or an");
      console.error("explicit ignore carrying a date and a reason. Do not disable this step.\n");
      process.exit(1);
    }

    console.log(`Dependency audit clean at high and above. All severities: ${counts}.`);
    process.exit(0);
  }

  // No document at all. Retry if it smells like the network, otherwise report it.
  lastErr = (err || out).trim();
  if (NETWORK.test(lastErr) || code === -1) continue;
  console.error("\nDEPENDENCY AUDIT FAILED: the audit produced no readable report, and the");
  console.error("failure does not look like a network problem, so it is not being waived.\n");
  console.error(lastErr.slice(0, 4000) || `(no output, exit code ${code})`);
  process.exit(1);
}

// Every attempt failed to reach the registry. This is the deliberate trade
// documented at the top of this file: no answer is not a finding.
console.warn(`\nDEPENDENCY AUDIT COULD NOT RUN, after ${ATTEMPTS} attempts.\n`);
console.warn("  The registry did not answer, so this build has NOT been audited.");
console.warn("  This is not a clean audit. It is an absent one, and it is being allowed");
console.warn("  through deliberately so that one third party's outage cannot stop every");
console.warn("  merge in the programme. The next commit asks again.\n");
console.warn(`  last error: ${lastErr.slice(0, 600)}\n`);
process.exit(0);
