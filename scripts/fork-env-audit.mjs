/**
 * Does `.env.example` still name every variable a founder has to set?
 *
 * NO SHEBANG, deliberately, following scripts/check-identity-keys.mjs. Every
 * caller runs this as `node scripts/fork-env-audit.mjs`, so the line buys
 * nothing, and a shebang together with CRLF line endings makes Vite's
 * transform throw `SyntaxError: Invalid or unexpected token` the moment
 * anything imports this from a Vitest test. Either one alone is fine, which is
 * how that combination stayed hidden until a checkout rewrote the endings.
 * This file exports its rules so a test can drive them; leaving the shebang on
 * would set that trap for whoever writes it.
 *
 * WHY THIS EXISTS, MEASURED 2026-09-02. `.env.example` calls itself "the
 * single source of truth for what each variable does and what breaks without
 * it" (scripts/fork-init.mjs says so too, and docs/PROVISIONING.md sends
 * founders to it). It named 32 variables and the code reads 57. Of the 25
 * missing, seven are founder-facing:
 *
 *     SATELLITE_PROVIDER, SENTINEL_WMS_URL, MAPBOX_TOKEN,
 *     GOOGLE_MAPS_STATIC_KEY, ESRI_API_KEY   the Living Map's aerial imagery
 *     BACKUP_EXPORT_TOKEN                    without it, member uploads are in
 *                                            no backup while the database dump
 *                                            keeps succeeding
 *     SCHEDULER_ENABLED                      set wrong, every background job
 *                                            stops and nothing looks broken
 *
 * The other eighteen are the self-hosted Hypha listener's fifteen, a local
 * OAuth test override, and two tuning dials.
 *
 * A founder cannot set a variable they have never been told exists, and eight
 * of the 25 are unreachable by grep as well, because the code reads them
 * through a string (`keyEnv: "MAPBOX_TOKEN"`, `envOrThrow(env, "…")`), never
 * as `process.env.MAPBOX_TOKEN`. So "read the source" was not a workaround
 * either.
 *
 * THE SECOND CHECK, and the reason it is here rather than in the brand guard.
 * `scripts/check-brand-refs.mjs` scans .ts, .tsx, .js, .jsx, .mjs, .sql, .css,
 * .html and .json. `.env.example` is none of those, so it has never been
 * scanned, and its first line read "Environment variables for a game-amora
 * deployment" for as long as it has existed. That is the first sentence a
 * founder of some other village reads. Widening the brand guard's extension
 * set to catch one dotfile would change what it walks everywhere; checking the
 * one file here is smaller and says what it is doing.
 *
 * WHAT THIS CANNOT SEE. Env names reached through a form of indirection not
 * listed in INDIRECT below. Four forms are covered (`process.env.X`, `env.X`,
 * `env["X"]`, and the two literal-argument shapes this repo uses). A fifth
 * form invented tomorrow is invisible to this script, exactly as the first
 * four were invisible to grep, so a new indirection wants a new pattern here
 * in the same commit. Say it out loud rather than letting the count drift.
 *
 * Usage:
 *   node scripts/fork-env-audit.mjs           # the audit, exit 1 on drift
 *   node scripts/fork-env-audit.mjs --json    # machine readable
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const EXAMPLE = path.join(ROOT, ".env.example");

/** Directories whose env reads a founder is expected to be able to set. */
const SCAN_DIRS = ["server", "shared"];
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs"]);

/**
 * Set by the host or the test harness, never by a founder, so they correctly
 * have no line in `.env.example`. Each one is listed in that file's closing
 * NOTE so the omission is stated rather than silent.
 */
export const INTERNAL = new Set([
  "NODE_ENV",
  "CI",
  "ALLOW_STALE_DIST",
  "TEST_SCHEMA",
  "REQUIRE_TEST_DB",
  // The vitest globalSetup writes this one itself: provisioningReport.ts's
  // setup() assigns process.env.VILLAGE_TEST_RUN_ID before any worker starts,
  // and provisionLogPath() reads it back to name that run's ledger file. A
  // founder setting it would only rename a file in the test cache.
  "VILLAGE_TEST_RUN_ID",
  // Set by the test harness alone: the comms suites point the post office at
  // the fake provider (server/testkit/fakeResend.ts) with it, so no test ever
  // sends a real email. A founder setting it would send the village's mail,
  // and its key, somewhere other than the provider.
  "RESEND_API_BASE",
  // Read by server/lib/voiceClaim.ts, and NOT settings. That check reads them
  // to refuse a HYPHA_VOICE_WEBHOOK_SECRET that is a copy of some other
  // secret, and these two are names a deployment might carry from elsewhere.
  // Nothing in this codebase consumes either as a secret of its own, so
  // documenting them in .env.example would invite a founder to set a variable
  // that does nothing except make the reuse check reject a valid value.
  "JWT_SECRET",
  "SESSION_SECRET",
]);

/**
 * Terms no village-neutral template may carry, READ OUT OF the brand guard
 * rather than copied from it.
 *
 * Copying the four words here was the first version, and the brand guard
 * failed this file for containing them, which is the guard working. Writing
 * them again behind a `brand-ok:` waiver would have silenced a correct finding
 * and left two lists to keep in step by hand. Parsing the one that already
 * exists means a fork that adds its own village's terms there gets them
 * checked here too, with no second edit and no way for the two to disagree.
 *
 * Importing the module instead is not an option: `check-brand-refs.mjs` walks
 * the tree and calls `process.exit` at import time.
 */
export function bannedTerms(src) {
  const m = src.match(/const BANNED = \[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/**
 * How this codebase reaches an environment variable. Every pattern must put
 * the variable name in capture group 1.
 */
const INDIRECT = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
  /\benv\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
  // server/lib/satellite.ts names each provider's key slot as data.
  /\bkeyEnv:\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
  // server/lib/hypha/selfHostedListener.ts reads required names by literal.
  /\benvOrThrow\(\s*env\s*,\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
];

/**
 * Every `KEY=` line in the template, including ones deliberately commented out
 * (`# TEST_DATABASE_URL=mysql://…` ships that way on purpose).
 *
 * THE TRAILING `\S*$` IS LOAD-BEARING and the first version did not have it.
 * Without it, `# SATELLITE_PROVIDER=sentinel2. No host is named here because…`
 * counted as documenting SATELLITE_PROVIDER, so deleting the real slot and
 * leaving the sentence behind kept the audit green. A guard satisfied by a
 * mention rather than a setting is the same class of failure as the drift it
 * is here to catch. A commented-out variable line carries a value with no
 * whitespace and then ends; a sentence does not.
 */
export function templateKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=\S*$/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** Every env name a file reaches for, by any covered form. */
export function envNamesIn(source) {
  const names = new Set();
  for (const re of INDIRECT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) names.add(m[1]);
  }
  return names;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    // Tests set and restore env freely; that is fixture wiring, not a setting
    // a founder is ever asked for.
    else if (SCAN_EXT.has(path.extname(entry.name)) && !/\.(test|e2e\.test)\.[tm]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function main(argv) {
  if (!fs.existsSync(EXAMPLE)) {
    console.error("::error::.env.example is missing. It is the template scripts/fork-init.mjs reads and docs/PROVISIONING.md sends founders to, so a fork cannot be provisioned without it.");
    return 1;
  }
  const text = fs.readFileSync(EXAMPLE, "utf8");
  const documented = templateKeys(text);

  const used = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const relPath = path.relative(ROOT, file).split(path.sep).join("/");
      for (const name of envNamesIn(fs.readFileSync(file, "utf8"))) {
        if (!used.has(name)) used.set(name, relPath);
      }
    }
  }

  const undocumented = [...used.keys()]
    .filter((n) => !documented.has(n) && !INTERNAL.has(n))
    .sort();

  const guardPath = path.join(ROOT, "scripts", "check-brand-refs.mjs");
  const banned = fs.existsSync(guardPath) ? bannedTerms(fs.readFileSync(guardPath, "utf8")) : null;
  if (!banned) {
    console.error("::error::could not read the BANNED list out of scripts/check-brand-refs.mjs. This script reads it as text so the two cannot drift; if that array's shape changed, change this reading with it rather than leaving it silently checking nothing.");
    return 1;
  }

  const brandHits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    // A line that has to name a term (explaining a fix, say) waives with this.
    if (/env-audit-ok/.test(line)) return;
    for (const term of banned) {
      if (new RegExp(`\\b${term}`, "i").test(line)) brandHits.push({ line: i + 1, term, text: line.trim().slice(0, 100) });
    }
  });

  console.log(
    `fork env audit: ${documented.size} documented, ${used.size} read by server/ and shared/, ` +
      `${INTERNAL.size} internal by declaration, ${undocumented.length} undocumented, ${brandHits.length} brand reference(s).`,
  );

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ documented: [...documented].sort(), undocumented, brandHits }));
  }

  let failed = false;
  for (const name of undocumented) {
    failed = true;
    console.error(
      `::error::${name} is read by ${used.get(name)} and is not named in .env.example. ` +
        "A founder cannot set a variable nobody has told them exists, and that file calls itself the single source of truth for exactly this. " +
        "Add it with the one line saying what breaks without it, or, if it is set by the host or the test harness rather than by a founder, add it to INTERNAL here and to the closing NOTE in .env.example.",
    );
  }
  for (const hit of brandHits) {
    failed = true;
    console.error(
      `::error::.env.example:${hit.line} names "${hit.term}": ${hit.text}. ` +
        "This template is read by every village standing one up, and check-brand-refs.mjs cannot see this file because it does not scan this extension. Use a neutral placeholder.",
    );
  }
  if (!failed) console.log("fork env audit passed: the template names every founder-settable variable, and names no village.");
  return failed ? 1 : 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (invoked) process.exit(main(process.argv.slice(2)));
