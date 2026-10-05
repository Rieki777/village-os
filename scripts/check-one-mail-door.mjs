#!/usr/bin/env node
/**
 * ONE MAIL DOOR: nothing sends an email through the provider except
 * `server/lib/comms/transport.ts` (the comms build spec 5.1).
 *
 * ── THE CLASS THIS EXISTS FOR ────────────────────────────────────────────
 *
 * Every email the village sends is written to `comms_messages` BEFORE it is
 * sent: that row is how a founder answers "did that person get it", how a
 * second copy of the same letter is refused, and how an address that asked to
 * stop is never written to again. A send that reaches the provider any other
 * way has no row, no permission check and no suppression check, and nothing
 * anywhere would show it.
 *
 * That door existed. `server/lib/email.ts` carried a whole second client (Resend
 * over its own `fetch`, and an SMTP client on raw sockets) for a month with no
 * caller, one import away from going live around the ledger. It was deleted by
 * the post office lane, and this gate is what keeps the next one from shipping.
 *
 * ── IT IS ABOUT SENDING ──────────────────────────────────────────────────
 *
 * The door this guards is the door an EMAIL goes out by. Talking to the
 * provider about anything else is not a send: setting up the sending domain,
 * checking its DNS records, connecting the delivery-report webhook
 * (server/lib/comms/resendAdmin.ts, `/domains` and `/webhooks`) write no email
 * to anybody, and they pass, whether they go through `resendApi()` in the door
 * or dial the provider's address themselves. Reading the provider's base
 * address is not a send either. The integrator ruled this for the comms build,
 * and the self-test pins it with a fixture in resendAdmin's shape.
 *
 * ── WHAT IT LOOKS FOR, AND WHY EACH ONE ──────────────────────────────────
 *
 *   send-endpoint   a provider's own SEND endpoint written out
 *                   (`api.resend.com/emails` and its equivalents at other
 *                   providers), anywhere, tests and scripts included: nothing
 *                   in this build sends through the real provider from a
 *                   test, a script or a probe (rule 13 of the build).
 *   smtp-host       an SMTP relay host (`smtp.resend.com` and the like),
 *                   anywhere. A relay exists only to send.
 *   mail-sdk        an import or require of a mail provider's SDK, or of an
 *                   SMTP library, anywhere. The door uses `fetch` and needs
 *                   none.
 *   send-call       a `fetch` whose address carries the send path, `/emails`
 *                   or `/emails/batch`: a copied send with its host moved into
 *                   a variable. Shipped code only: a suite may post to the
 *                   fake provider, and the fake answers that path.
 *   send-url        a string ending in the send path, built to be fetched
 *                   later. Shipped code only, for the same reason.
 *   smtp            a string opening with an SMTP command (EHLO, MAIL FROM,
 *                   RCPT TO, STARTTLS, AUTH LOGIN): code speaking SMTP is a
 *                   mail client, whatever host it dials. Shipped code only.
 *
 * Inside the door every one of these is the implementation, and is counted.
 * The door MUST show at least one, or this scan cannot see the very call it
 * guards and a clean result would mean nothing, so that fails too.
 *
 * ── THE ALLOWLIST ────────────────────────────────────────────────────────
 *
 * A line in ALLOWED is a claim that one file is deliberately outside the door,
 * with the reason a reviewer would accept. "I could not find another way" is
 * not a reason. Provider setup needs no line here: it is not a send.
 *
 * Usage: node scripts/check-one-mail-door.mjs [--root <dir>] [--json]
 *   --root  scan another tree (the self-test points it at fixtures)
 *   --json  machine-readable findings
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg !== -1 && process.argv[rootArg + 1] ? path.resolve(process.argv[rootArg + 1]) : path.resolve(import.meta.dirname, "..");

/** Where code that could send lives. Markdown is not code and is not read. */
const SCAN_DIRS = ["server", "shared", "client/src", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/** The one door. */
const THE_DOOR = "server/lib/comms/transport.ts";

/**
 * Files deliberately outside the door, and why that is right.
 */
const ALLOWED = {
  "scripts/check-one-mail-door.mjs": "This gate names the hosts and commands it looks for.",
  "scripts/check-one-mail-door.test.mjs": "The self-test writes fixtures that send around the door, so the gate can be seen to refuse them.",
};

/** Each provider's SEND endpoint. Its other endpoints (domains, webhooks, keys) are not sends. */
const SEND_ENDPOINT =
  /\b(api\.resend\.com\/emails|api\.sendgrid\.com\/v3\/mail\/send|api(\.eu)?\.mailgun\.net\/v3\/\S*\/messages|api\.postmarkapp\.com\/email|api(\.eu)?\.sparkpost\.com\/api\/v1\/transmissions|api\.(brevo|sendinblue)\.com\/v3\/smtp\/email|api\.mailjet\.com\/v3(\.1)?\/send|mandrillapp\.com\/api\/1\.0\/messages\/send)/i;

/** SMTP relays. A relay exists only to send. */
const SMTP_HOST =
  /\b(smtp\.resend\.com|smtp\.sendgrid\.net|smtp\.mailgun\.org|smtp\.postmarkapp\.com|smtp-relay\.(brevo|sendinblue)\.com|in-v3\.mailjet\.com|email-smtp\.[a-z0-9-]+\.amazonaws\.com)\b/i;

const MAIL_SDKS = new Set([
  "resend",
  "nodemailer",
  "@sendgrid/mail",
  "@sendgrid/client",
  "mailgun.js",
  "mailgun-js",
  "postmark",
  "@aws-sdk/client-ses",
  "@aws-sdk/client-sesv2",
  "@mailchimp/mailchimp_transactional",
  "@getbrevo/brevo",
  "sib-api-v3-sdk",
  "node-mailjet",
  "sparkpost",
  "emailjs",
  "smtp-client",
  "smtp-connection",
  "sendmail",
]);

/** A string that ends in the send path: a send address, built to be fetched. */
const SEND_URL = /\/emails(\/batch)?\/?$/;
/** The send path anywhere in a fetch's address, written as a string, a template or an expression. */
const SEND_PATH_IN_ADDRESS = /\/emails(\/batch)?\/?(?=$|[?#"'`)\s])/;
const SMTP_COMMAND = /^(EHLO\b|HELO\b|MAIL FROM:|RCPT TO:|STARTTLS\b|AUTH (LOGIN|PLAIN)\b)/;

/** A call that fetches: `fetch(...)`, `globalThis.fetch(...)`, an injected `fetchImpl(...)`. */
const isFetchCall = (node) =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && /^(fetch|fetchImpl)$/.test(node.expression.text)) ||
    (ts.isPropertyAccessExpression(node.expression) && /^(fetch|fetchImpl)$/.test(node.expression.name.text)));

const posix = (p) => p.split(path.sep).join("/");

/** Test-only code: suites, and the kit only suites import. */
const isTestOnly = (rel) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.split("/").includes("__tests__") || rel.startsWith("server/testkit/");

const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXTENSIONS.test(entry.name)) files.push(full);
  }
}
for (const d of SCAN_DIRS) walk(path.join(ROOT, d));

const findings = [];
let doorSeen = false;
let testOnlyCount = 0;

/** The text a string-ish node holds, with every interpolation as `${}`. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

for (const file of files.sort()) {
  const rel = posix(path.relative(ROOT, file));
  const inDoor = rel === THE_DOOR;
  if (inDoor) doorSeen = true;
  const testOnly = isTestOnly(rel);
  if (testOnly) testOnlyCount += 1;
  const kind = /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const add = (node, rule, detail) => findings.push({ rel, line: at(node), rule, detail, inDoor, allowed: ALLOWED[rel] ?? null });

  const moduleName = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0].text;
      if (ts.isIdentifier(callee) && callee.text === "require") return node.arguments[0].text;
    }
    return null;
  };

  const visit = (node) => {
    const mod = moduleName(node);
    if (mod && (MAIL_SDKS.has(mod) || [...MAIL_SDKS].some((m) => mod.startsWith(`${m}/`)))) add(node, "mail-sdk", `imports "${mod}"`);

    const text = literalText(node);
    if (text !== null) {
      if (SEND_ENDPOINT.test(text)) add(node, "send-endpoint", text.length > 90 ? `${text.slice(0, 90)}...` : text);
      if (SMTP_HOST.test(text)) add(node, "smtp-host", text.length > 90 ? `${text.slice(0, 90)}...` : text);
      if (!testOnly && SEND_URL.test(text)) add(node, "send-url", text.length > 90 ? `...${text.slice(-90)}` : text);
      if (!testOnly && SMTP_COMMAND.test(text)) add(node, "smtp", text.length > 60 ? `${text.slice(0, 60)}...` : text);
    }

    // The address a fetch is handed, however it is written: a string, a
    // template, or `base + "/emails"`. A fetch to anything else passes.
    if (!testOnly && isFetchCall(node) && node.arguments[0]) {
      const arg = node.arguments[0];
      const address = literalText(arg) ?? arg.getText(source);
      if (SEND_PATH_IN_ADDRESS.test(address)) add(node, "send-call", `fetch(${address.length > 80 ? `...${address.slice(-80)}` : address})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const inside = findings.filter((f) => f.inDoor);
const live = findings.filter((f) => !f.inDoor && !f.allowed);
const waived = findings.filter((f) => !f.inDoor && f.allowed);
const problems = [];
if (!doorSeen) problems.push(`the door itself, ${THE_DOOR}, was not found, so there is nothing to compare the rest of the tree against`);
else if (inside.length === 0) {
  problems.push(
    `the door, ${THE_DOOR}, shows none of the signs this scan looks for, so the scan cannot see the call it guards and a clean result would mean nothing`,
  );
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scanned: files.length, testOnly: testOnlyCount, door: THE_DOOR, inside, live, waived, problems }, null, 2));
  process.exit(live.length || problems.length ? 1 : 0);
}

const byRule = (list) => {
  const counts = {};
  for (const f of list) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(", ") || "none";
};

console.log(
  `Scanned ${files.length} file(s) under ${SCAN_DIRS.join(", ")} (${testOnlyCount} of them test-only). ` +
    `The one door is ${THE_DOOR}: ${inside.length} sign(s) of the provider inside it (${byRule(inside)}). ` +
    `Outside it: ${live.length} finding(s), ${waived.length} waived by name.`,
);

if (live.length || problems.length) {
  console.error("\nONE MAIL DOOR GUARD FAILED: something can reach the email provider without the post office.\n");
  for (const p of problems) console.error(`  ${p}`);
  for (const f of live) console.error(`  ${f.rel}:${f.line}  ${f.rule}: ${f.detail}`);
  console.error(
    "\nSend through post() in server/lib/comms/postOffice.ts, which records the email before it goes. " +
      "Talking to the provider about anything but a send (domains, webhooks) is not a send and passes this guard.",
  );
  process.exit(1);
}
console.log("One mail door guard passed.");
