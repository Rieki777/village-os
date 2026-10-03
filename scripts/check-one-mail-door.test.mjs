/**
 * The one-mail-door guard's own fixture suite.
 *
 * A guard nobody has watched refuse is a guard that reports green either way.
 * This drives `check-one-mail-door.mjs` against small fixture trees through its
 * `--root` argument: each fixture sends around the door in one of the ways the
 * guard names, and each must fail it, by rule and by file. A tree whose door
 * cannot be seen must fail too, because a scan blind to the call it guards
 * would pass everything.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GUARD = path.resolve(import.meta.dirname, "check-one-mail-door.mjs");

/** A door in the shape of the real one: the host, the base, and a fetch to the send path. */
const DOOR = [
  'export const RESEND_DEFAULT_BASE = "https://api.resend.com";',
  "export function resendApiBase() { return process.env.RESEND_API_BASE || RESEND_DEFAULT_BASE; }",
  'export async function send(body) { return fetch(`${resendApiBase()}/emails`, { method: "POST", body }); }',
  "",
].join("\n");

let checks = 0;
let failures = 0;

function run(files, { withDoor = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maildoor-"));
  const all = withDoor ? { "server/lib/comms/transport.ts": DOOR, ...files } : files;
  for (const [name, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  const r = spawnSync(process.execPath, [GUARD, "--root", root], { encoding: "utf8" });
  fs.rmSync(root, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function check(label, got, want) {
  checks += 1;
  if (got === want) return;
  failures += 1;
  console.error(`FAIL: ${label}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
}

// 1. A tree where every send goes through the door passes, and says what it read.
{
  const r = run({ "server/lib/notify.ts": 'import { post } from "./comms/postOffice";\nexport const x = post;\n' });
  check("a tree that uses the door passes", r.status, 0);
  check("and prints its denominator", /Scanned 2 file\(s\)/.test(r.out), true);
  check("and counts what it saw inside the door", /sign\(s\) of the provider inside it/.test(r.out), true);
}

// 2. THE FIXTURE THE BRIEF NAMES: a library that sends around the door, in the
//    shape server/lib/email.ts had before the post office lane deleted it.
{
  const r = run({
    "server/lib/email.ts":
      'export async function sendViaResend(key, body) {\n  return fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body });\n}\n',
  });
  check("a send around the door fails", r.status, 1);
  check("naming the file and the line", /server\/lib\/email\.ts:2/.test(r.out), true);
  check("and the rule", /provider-host/.test(r.out), true);
}

// 3. A mail SDK, imported or required.
{
  const r = run({ "server/lib/mailer2.ts": 'import { Resend } from "resend";\nexport const r = new Resend("k");\n' });
  check("an SDK import fails", r.status, 1);
  check("as mail-sdk", /mail-sdk: imports "resend"/.test(r.out), true);
  const q = run({ "scripts/blast.mjs": 'const nodemailer = require("nodemailer");\nexport default nodemailer;\n' });
  check("a required SMTP library fails, in a script too", q.status, 1);
  check("as mail-sdk", /mail-sdk: imports "nodemailer"/.test(q.out), true);
}

// 4. A copied send whose host moved into a variable: only the path is left to see.
{
  const r = run({ "server/routes/sneaky.ts": "export const go = (base: string) => fetch(`${base}/emails`, { method: \"POST\" });\n" });
  check("a send to the path with the host in a variable fails", r.status, 1);
  check("as emails-endpoint", /emails-endpoint/.test(r.out), true);
}

// 5. Reaching for the provider's address without writing it.
{
  const env = run({ "server/lib/a.ts": "export const base = process.env.RESEND_API_BASE ?? '';\n" });
  check("reading RESEND_API_BASE outside the door fails", env.status, 1);
  check("as provider-base", /provider-base: reads process\.env\.RESEND_API_BASE/.test(env.out), true);
  const call = run({ "server/lib/b.ts": 'import { resendApiBase } from "./comms/transport";\nexport const u = () => resendApiBase();\n' });
  check("calling resendApiBase outside the door fails", call.status, 1);
  check("as provider-base", /provider-base: uses resendApiBase/.test(call.out), true);
}

// 6. Speaking SMTP is a mail client, whatever host it dials.
{
  const r = run({ "server/lib/smtp.ts": "export const hello = (s: any, from: string) => s.write(`MAIL FROM:<${from}>`);\n" });
  check("an SMTP client fails", r.status, 1);
  check("as smtp", /smtp: MAIL FROM:/.test(r.out), true);
}

// 7. Tests may answer the send path (the fake provider does) and set the base,
//    and may never name the real provider's host.
{
  const fake = run({
    "server/testkit/fake.ts": 'export const isSend = (p: string) => p === "/emails" || p === "/emails/batch";\n',
    "server/x.e2e.test.ts": "export const env = { RESEND_API_BASE: 'http://127.0.0.1:1' };\nexport const u = process.env.RESEND_API_BASE;\n",
  });
  check("the fake's send path and a suite's base pass", fake.status, 0);
  const real = run({ "server/y.test.ts": 'export const u = "https://api.resend.com/emails";\n' });
  check("a test naming the real host fails", real.status, 1);
  check("as provider-host", /server\/y\.test\.ts:1\s+provider-host/.test(real.out), true);
}

// 8. The client is code too: a browser holding the key would be the worst door of all.
{
  const r = run({ "client/src/pages/Mail.tsx": 'export const go = () => fetch("https://api.resend.com/emails");\n' });
  check("a client send around the door fails", r.status, 1);
}

// 9. A blind scan is a failure, never a pass.
{
  const none = run({ "server/lib/notify.ts": "export const x = 1;\n" }, { withDoor: false });
  check("no door at all fails", none.status, 1);
  check("saying the door was not found", /was not found/.test(none.out), true);
  const empty = run({ "server/lib/comms/transport.ts": "export const nothing = 1;\n" }, { withDoor: false });
  check("a door the scan cannot see into fails", empty.status, 1);
  check("saying the scan cannot see the call it guards", /cannot see the call it guards/.test(empty.out), true);
}

console.log(`${checks - failures}/${checks} one-mail-door checks passed.`);
process.exit(failures === 0 ? 0 : 1);
