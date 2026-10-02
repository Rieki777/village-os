#!/usr/bin/env node
/**
 * Write a new village's local `.env` in one pass.
 *
 * Nothing about this platform is forked per village (docs/ARCHITECTURE.md:
 * "a fork inherits the platform by pulling, not by find-and-replace"). Every
 * instance runs the same code from the same repository; what differs is the
 * database it points at and the environment variables it boots with. So this
 * script does not touch `shared/gameConfig.ts`, `client/index.html`, or any
 * client page. Those are shared platform code, not per-village files, and
 * a village's actual name, tagline, colours and logo are set at runtime from
 * Admin, Make This Yours, after the first login. Nothing here can set them,
 * because nothing on disk holds them.
 *
 * What this script CAN do: fill in `.env.example` with what it can generate
 * (the random secrets, correctly formatted) and what you tell it (your
 * village's name, your own email, your domain if you have one), then print
 * an honest list of what it left blank because the value needs a human step
 * this script cannot perform: a Stripe account, a verified Resend domain,
 * a Railway MySQL connection string. That list is not a failure report; it
 * is the actual next steps.
 *
 * `.env.example` is the single source of truth for what each variable does
 * and what breaks without it. Read the comment there before wondering why a
 * value is blank here. This script does not repeat those explanations, it
 * points at them.
 *
 * Usage:
 *   node scripts/fork-init.mjs --village-name "Rio Nuevo" \
 *        --admin-email founder@example.org --domain rionuevo.example.org
 *
 *   --village-name   required. Used to shape EMAIL_FROM's display name and
 *                    this script's own report. Not written to any variable
 *                    by itself; there is no VILLAGE_NAME setting.
 *   --admin-email    required. Your own email. Used as the default
 *                    BREAK_GLASS_ADMIN_EMAIL and PLATFORM_SUPPORT_EMAIL, and
 *                    printed back as the address you bootstrap with.
 *   --domain         optional. Sets FRONTEND_URL and, together with
 *                    --village-name, EMAIL_FROM. Skip it if you do not have
 *                    a domain yet; fill FRONTEND_URL in by hand once you do.
 *   --from-email     optional. Overrides the EMAIL_FROM this script would
 *                    otherwise build from --village-name and --domain.
 *   --support-email  optional. Overrides PLATFORM_SUPPORT_EMAIL. Defaults to
 *                    --admin-email.
 *   --admin-password optional. Overrides the generated one-time bootstrap
 *                    password.
 *   --out            optional. Where to write. Defaults to `.env`.
 *   --example        optional. Template to read. Defaults to `.env.example`.
 *   --force          overwrite an existing --out file. Without it, an
 *                    existing file is left untouched and the script refuses,
 *                    because overwriting a live deployment's secrets logs
 *                    out every member and re-locks anything MEMBER_SECRETS_KEY
 *                    or VILLAGE_SECRETS_KEY encrypted.
 *   --dry            report what WOULD be written; write nothing.
 *   --compose        this village runs with docker-compose.yml on one machine.
 *                    Also generates the two MySQL passwords the compose file
 *                    reads, points DATABASE_URL at its `db` service, and sets
 *                    FRONTEND_URL to http://localhost:<port> when no --domain
 *                    is given (--port, default 3000, sets VILLAGE_PORT too).
 *
 * The one-time ADMIN_PASSWORD is never printed. It is in the file this writes;
 * the founder opens that file and reads it, and a founder's AI assistant
 * running this command never sees it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

/** Wrap a single string of prose to `width` columns for terminal printing. */
function wrap(text, width) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("Usage:")[1].split("*/")[0]);
  process.exit(0);
}

const DRY = !!args.dry;
const FORCE = !!args.force;
const villageName = typeof args["village-name"] === "string" ? args["village-name"].trim() : "";
const adminEmail = typeof args["admin-email"] === "string" ? args["admin-email"].trim() : "";
const domainInput = typeof args.domain === "string" ? args.domain.trim() : "";
const fromEmailOverride = typeof args["from-email"] === "string" ? args["from-email"].trim() : "";
const supportEmailOverride = typeof args["support-email"] === "string" ? args["support-email"].trim() : "";
const adminPasswordOverride = typeof args["admin-password"] === "string" ? args["admin-password"].trim() : "";
const COMPOSE = !!args.compose;
const portInput = typeof args.port === "string" ? args.port.trim() : "3000";
if (!/^\d{2,5}$/.test(portInput)) {
  console.error(`fork-init: --port "${portInput}" is not a port number.`);
  process.exit(1);
}
const outPath = path.resolve(ROOT, typeof args.out === "string" ? args.out : ".env");
const examplePath = path.resolve(ROOT, typeof args.example === "string" ? args.example : ".env.example");

const missing = [];
if (!villageName) missing.push("--village-name");
if (!adminEmail) missing.push("--admin-email");
if (missing.length) {
  console.error(`fork-init: missing required flag(s): ${missing.join(", ")}`);
  console.error("Run `node scripts/fork-init.mjs --help` for the full usage.");
  process.exit(1);
}
if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error(`fork-init: "${adminEmail}" does not look like an email address.`);
  process.exit(1);
}

if (!fs.existsSync(examplePath)) {
  console.error(`fork-init: cannot find the template at ${path.relative(ROOT, examplePath)}.`);
  process.exit(1);
}

if (fs.existsSync(outPath) && !FORCE && !DRY) {
  console.error(
    `fork-init: ${path.relative(ROOT, outPath)} already exists and was left untouched.\n` +
      "Overwriting it would replace a live deployment's secrets, which logs out every\n" +
      "member, makes every member-stored key MEMBER_SECRETS_KEY encrypted unreadable, and\n" +
      "makes every integration key VILLAGE_SECRETS_KEY encrypted unreadable too.\n" +
      "Pass --force if you are certain this is a fresh instance with nothing to lose,\n" +
      "or --dry to preview without writing.",
  );
  process.exit(1);
}

/** crypto.randomBytes(32).toString("hex"), the exact recipe FORK_RUNBOOK.md
 * documents for both AUTH_TOKEN_SECRET and MEMBER_SECRETS_KEY. */
const genHex32 = () => crypto.randomBytes(32).toString("hex");

/** A one-time bootstrap password. Readable enough to type once by hand if
 * needed, random enough that guessing it isn't a real path in. */
function genPassword() {
  const words = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  const digits = crypto.randomInt(1000, 9999);
  return `${words}-${digits}`;
}

const domain = domainInput.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const frontendUrl = domain ? `https://${domain}` : COMPOSE ? `http://localhost:${portInput}` : "";
const emailFrom =
  fromEmailOverride || (domain ? `${villageName} <hello@${domain}>` : "");
const supportEmail = supportEmailOverride || adminEmail;
const adminPassword = adminPasswordOverride || genPassword();
const authTokenSecret = genHex32();
const memberSecretsKey = genHex32();
/* Its own value, never a copy of the one above: they seal different things
 * (a member's own LLM key, and the village's third-party credentials), and
 * one of them may have to be rotated without taking the other's stores down
 * with it. Same recipe, separate draw. */
const villageSecretsKey = genHex32();
/* The uploads export's own token (GET /api/admin/backup/uploads-archive). It
 * was the one generated value this script left for a human, and a village
 * that never sets it has no backup of its members' photographs. */
const backupExportToken = genHex32();
/* Compose only: the database the compose file starts, and the address the app
 * reaches it at on the network compose makes. `db` is the service name. */
const mysqlPassword = COMPOSE ? genHex32() : "";
const mysqlRootPassword = COMPOSE ? genHex32() : "";
const databaseUrl = COMPOSE ? `mysql://village:${mysqlPassword}@db:3306/village` : "";

/**
 * What this script can resolve, keyed by the exact variable name in
 * `.env.example`. Anything NOT in this map is left exactly as the template
 * has it (usually blank) and reported as needing a human step.
 *
 * `secret: true` means the VALUE is never printed back in the report, only
 * the fact that it was generated. ADMIN_PASSWORD is one of them: the founder
 * needs it once, on the /claim page, and reads it from the file; an assistant
 * running this script for them is never handed it.
 */
const RESOLVED = {
  AUTH_TOKEN_SECRET: { value: authTokenSecret, secret: true, note: "generated" },
  MEMBER_SECRETS_KEY: { value: memberSecretsKey, secret: true, note: "generated" },
  VILLAGE_SECRETS_KEY: { value: villageSecretsKey, secret: true, note: "generated" },
  ADMIN_PASSWORD: { value: adminPassword, secret: true, note: "generated, one-time" },
  FRONTEND_URL: { value: frontendUrl, secret: false, note: domain ? "from --domain" : "" },
  EMAIL_FROM: { value: emailFrom, secret: false, note: domain ? "from --village-name and --domain" : "" },
  BREAK_GLASS_ADMIN_EMAIL: { value: adminEmail, secret: false, note: "from --admin-email" },
  PLATFORM_SUPPORT_EMAIL: { value: supportEmail, secret: false, note: "from --support-email or --admin-email" },
  BACKUP_EXPORT_TOKEN: { value: backupExportToken, secret: true, note: "generated" },
  DATABASE_URL: { value: databaseUrl, secret: true, note: "the compose file's own database" },
  MYSQL_PASSWORD: { value: mysqlPassword, secret: true, note: "generated, compose only" },
  MYSQL_ROOT_PASSWORD: { value: mysqlRootPassword, secret: true, note: "generated, compose only" },
  VILLAGE_PORT: { value: COMPOSE ? portInput : "", secret: false, note: "compose only" },
};

const KEY_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

const templateText = fs.readFileSync(examplePath, "utf8");
const templateLines = templateText.split(/\r?\n/);

const outLines = [];
const templateKeys = [];
const filledKeys = [];
const blankKeys = [];
const defaultedKeys = [];
let commentBlock = [];

/**
 * Which section of `.env.example` the reader is currently inside.
 *
 * The dividers were already detected here, to stop a section header leaking
 * into the next variable's explanation, and then thrown away. Keeping the text
 * is what lets the report below separate "the server will not start without
 * this" from "only if you run your own on-chain listener".
 *
 * That distinction stopped being cosmetic on 2026-09-02. Documenting the
 * nineteen variables the template had been missing took the unresolved list
 * from 28 to 47, and a flat wall of 47 items each with a paragraph under it is
 * a worse answer to "what do I do next" than a short list was, even though it
 * is a more complete one. Grouping is how the file gets to be complete AND the
 * report gets to be short.
 */
let section = "";

/** Sections whose blanks are genuinely the founder's next actions. Everything
 *  else is opt-in, and is listed by name with a pointer rather than in full. */
const ACTIONABLE = /^(REQUIRED|STRONGLY RECOMMENDED|WHO FOUNDS THIS VILLAGE)/;

for (const line of templateLines) {
  const m = line.match(KEY_LINE);
  if (!m) {
    outLines.push(line);
    if (line.startsWith("#")) {
      const text = line.replace(/^#\s?/, "");
      // A section-header divider ("── REQUIRED: ... ──") separates blocks;
      // it is not itself part of the next variable's explanation.
      if (/^──/.test(text)) {
        commentBlock = [];
        section = text.replace(/^──\s*/, "").replace(/\s*──\s*$/, "").trim();
      } else commentBlock.push(text);
    } else {
      // A blank line (or any non-comment line) also separates comment
      // blocks, so the file's header does not leak into the first variable.
      commentBlock = [];
    }
    continue;
  }
  const key = m[1];
  const templateValue = m[2];
  templateKeys.push(key);
  const resolved = RESOLVED[key];
  if (resolved && resolved.value) {
    outLines.push(`${key}=${resolved.value}`);
    filledKeys.push({ key, ...resolved });
  } else if (templateValue.trim() !== "") {
    // The template already ships a working default (e.g. TRUSTED_PROXY_HOPS=1).
    // Keep it as-is; it needs no human step and is not a gap to report.
    outLines.push(line);
    defaultedKeys.push({ key, value: templateValue.trim() });
  } else {
    outLines.push(line);
    blankKeys.push({ key, comment: commentBlock.join(" "), section });
  }
  commentBlock = [];
}

// Drift guard: every key this script knows how to resolve should actually
// exist in the template it just read. A key that vanished from
// .env.example without this list being updated would silently stop being
// filled, which is exactly the drift the brief is written to prevent.
const unknownToTemplate = Object.keys(RESOLVED).filter((k) => !templateKeys.includes(k));
if (unknownToTemplate.length) {
  console.warn(
    `fork-init: WARNING: this script knows how to fill ${unknownToTemplate.join(", ")}, ` +
      `but .env.example no longer names ${unknownToTemplate.length === 1 ? "it" : "them"}. ` +
      "The two have drifted apart; update scripts/fork-init.mjs to match.",
  );
}

const rendered = outLines.join("\n");

if (DRY) {
  console.log(`--dry: would write ${templateKeys.length} variable(s) to ${path.relative(ROOT, outPath)}.`);
} else {
  fs.writeFileSync(outPath, rendered, "utf8");
  console.log(`Wrote ${path.relative(ROOT, outPath)} (${templateKeys.length} variables).`);
}

console.log("");
console.log(`Filled in automatically (${filledKeys.length} of ${templateKeys.length}):`);
for (const f of filledKeys) {
  const shown = f.secret ? "(generated, not shown)" : `= ${f.value}`;
  console.log(`  ${f.key}  ${shown}${f.note ? `  [${f.note}]` : ""}`);
}

console.log("");
console.log("Your one-time founder password is the ADMIN_PASSWORD line in");
console.log(`  ${path.relative(ROOT, outPath)}`);
console.log("Open that file yourself to read it, and keep it to yourself. You type it");
console.log("once, on your village's /claim page, and then it stops working.");

if (defaultedKeys.length) {
  console.log("");
  console.log(`Left at the template's own working default (${defaultedKeys.length}):`);
  for (const d of defaultedKeys) console.log(`  ${d.key}=${d.value}`);
}

const actionable = blankKeys.filter((b) => ACTIONABLE.test(b.section));
const optional = blankKeys.filter((b) => !ACTIONABLE.test(b.section));

console.log("");
console.log(`Your next steps: ${actionable.length} variable(s) this script cannot fill in.`);
console.log("Every one of these closes something that is otherwise shut.");
for (const b of actionable) {
  console.log("");
  console.log(`  ${b.key}`);
  for (const wrapped of wrap(b.comment, 74)) console.log(`    ${wrapped}`);
}

if (optional.length) {
  // Named, never explained in full. A founder who needs Stripe knows they need
  // Stripe; a founder who does not should not have to read past it. The
  // explanation for each is one line away, in the file this just read.
  const bySection = new Map();
  for (const b of optional) {
    if (!bySection.has(b.section)) bySection.set(b.section, []);
    bySection.get(b.section).push(b.key);
  }
  console.log("");
  console.log(`Opt in later, when you want the feature (${optional.length}, none of them blocking):`);
  for (const [name, keys] of bySection) {
    console.log("");
    for (const wrapped of wrap(name, 74)) console.log(`  ${wrapped}`);
    for (const wrapped of wrap(keys.join(", "), 72)) console.log(`    ${wrapped}`);
  }
  console.log("");
  console.log("  What each one does, and what breaks without it, is the comment above it");
  console.log(`  in ${path.relative(ROOT, examplePath)}.`);
}

console.log("");
console.log(
  "This script never sets your village's name, tagline, colours, logo or\n" +
    "starting content. Those live in the database, not in a file, and you\n" +
    "set them from Admin, Make This Yours, the first time you log in.",
);
console.log(
  DRY
    ? "\nNothing was written (--dry)."
    : COMPOSE
      ? `\nNext: docker compose up -d, wait for the app to say it is listening\n(docker compose logs -f app), then open ${frontendUrl}/claim. START_HERE.md has the rest.`
      : `\nNext: put these values in your host's environment variables (on Railway, your\nservice, Variables). This file does not deploy on its own. Then follow START_HERE.md.`,
);
