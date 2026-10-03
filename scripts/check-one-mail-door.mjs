#!/usr/bin/env node
/**
 * ONE MAIL DOOR: nothing calls the email provider except
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
 * ── WHAT IT LOOKS FOR, AND WHY EACH ONE ──────────────────────────────────
 *
 *   provider-host   a provider's API or SMTP host in a string, anywhere,
 *                   tests and scripts included: nothing in this build calls
 *                   the real provider from a test, a script or a probe
 *                   (rule 13 of the build).
 *   mail-sdk        an import or require of a mail provider's SDK, or of an
 *                   SMTP library. The door uses `fetch` and needs none.
 *   provider-base   reading the provider's address without writing it:
 *                   `process.env.RESEND_API_BASE`, `resendApiBase()`, or
 *                   `RESEND_DEFAULT_BASE`. Shipped code only: the suites set
 *                   the variable to point the door at the fake provider.
 *   emails-endpoint a string ending in the provider's send path, `/emails` or
 *                   `/emails/batch`, which is what a copied send looks like
 *                   once the host has been moved into a variable. Shipped
 *                   code only: the fake provider answers that path.
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
 * not a reason. Provider setup (domains, the delivery-report webhook) goes
 * through `resendApi()` in the door itself, so it needs no line here.
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

const PROVIDER_HOST =
  /\b(api\.resend\.com|smtp\.resend\.com|api\.sendgrid\.com|smtp\.sendgrid\.net|api\.mailgun\.net|api\.eu\.mailgun\.net|smtp\.mailgun\.org|api\.postmarkapp\.com|smtp\.postmarkapp\.com|api\.sparkpost\.com|api\.eu\.sparkpost\.com|api\.brevo\.com|api\.sendinblue\.com|api\.mailjet\.com|mandrillapp\.com|email(-smtp)?\.[a-z0-9-]+\.amazonaws\.com)\b/i;

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

const PROVIDER_BASE_NAMES = new Set(["resendApiBase", "RESEND_DEFAULT_BASE"]);
const EMAILS_ENDPOINT = /\/emails(\/batch)?\/?$/;
const SMTP_COMMAND = /^(EHLO\b|HELO\b|MAIL FROM:|RCPT TO:|STARTTLS\b|AUTH (LOGIN|PLAIN)\b)/;

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
      if (PROVIDER_HOST.test(text)) add(node, "provider-host", text.length > 90 ? `${text.slice(0, 90)}...` : text);
      if (!testOnly && EMAILS_ENDPOINT.test(text)) add(node, "emails-endpoint", text.length > 90 ? `...${text.slice(-90)}` : text);
      if (!testOnly && SMTP_COMMAND.test(text)) add(node, "smtp", text.length > 60 ? `${text.slice(0, 60)}...` : text);
    }

    if (!testOnly) {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "RESEND_API_BASE" && /process\.env$/.test(node.expression.getText(source))) {
        add(node, "provider-base", "reads process.env.RESEND_API_BASE");
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "RESEND_API_BASE" &&
        /process\.env$/.test(node.expression.getText(source))
      ) {
        add(node, "provider-base", "reads process.env[\"RESEND_API_BASE\"]");
      }
      // A use of the name, never its own declaration and never an import of it:
      // importing is not calling, and the call or the reference is what is found.
      if (
        ts.isIdentifier(node) &&
        PROVIDER_BASE_NAMES.has(node.text) &&
        !(node.parent && (ts.isImportSpecifier(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isFunctionDeclaration(node.parent)) && node.parent.name === node)
      ) {
        add(node, "provider-base", `uses ${node.text}`);
      }
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
      "Provider setup goes through resendApi() in server/lib/comms/transport.ts.",
  );
  process.exit(1);
}
console.log("One mail door guard passed.");
