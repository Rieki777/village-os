/**
 * The one-mail-door guard's own fixture suite.
 *
 * A guard nobody has watched refuse is a guard that reports green either way.
 * This drives `check-one-mail-door.mjs` against small fixture trees through its
 * `--root` argument: each fixture SENDS around the door in one of the ways the
 * guard names, and each must fail it, by rule and by file. Talking to the
 * provider about anything but a send (resendAdmin's domains and webhook) must
 * pass. A tree whose door cannot be seen must fail, because a scan blind to
 * the call it guards would pass everything.
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
  check("and the rule", /send-endpoint/.test(r.out), true);
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
  check("as send-call", /send-call/.test(r.out), true);
  const joined = run({ "server/routes/joined.ts": 'export const go = (base: string) => fetch(base + "/emails/batch", { method: "POST" });\n' });
  check("a batch send built with + fails", joined.status, 1);
  check("as send-call", /send-call/.test(joined.out), true);
  const later = run({ "server/lib/later.ts": "export const url = (base: string) => `${base}/emails`;\n" });
  check("a send address built to be fetched later fails", later.status, 1);
  check("as send-url", /send-url/.test(later.out), true);
}

// 5. PROVIDER SETUP IS NOT A SEND, by the integrator's ruling. resendAdmin's
//    domains and webhook calls pass, through the door's helper or on their own,
//    and so does reading the provider's base address.
{
  const admin = run({
    "server/lib/comms/resendAdmin.ts": [
      'import { resendApiBase } from "./transport";',
      'export const domains = (key: string) => fetch(`${resendApiBase()}/domains`, { headers: { Authorization: `Bearer ${key}` } });',
      'export const verify = (id: string) => fetch(`${resendApiBase()}/domains/${id}/verify`, { method: "POST" });',
      'export const hook = () => fetch("https://api.resend.com/webhooks", { method: "POST" });',
      "export const base = process.env.RESEND_API_BASE ?? '';",
      "",
    ].join("\n"),
  });
  check("resendAdmin's domains and webhook calls pass", admin.status, 0);
  check("with nothing found outside the door", /Outside it: 0 finding\(s\)/.test(admin.out), true);
}

// 6. Speaking SMTP is a mail client, whatever host it dials, and a relay host is one too.
{
  const r = run({ "server/lib/smtp.ts": "export const hello = (s: any, from: string) => s.write(`MAIL FROM:<${from}>`);\n" });
  check("an SMTP client fails", r.status, 1);
  check("as smtp", /smtp: MAIL FROM:/.test(r.out), true);
  const relay = run({ "server/lib/relay.ts": 'export const relay = { host: "smtp.resend.com", port: 465 };\n' });
  check("an SMTP relay host fails", relay.status, 1);
  check("as smtp-host", /smtp-host/.test(relay.out), true);
}

// 7. Tests may answer the send path (the fake provider does), post to the fake,
//    set the base, and name the provider's other endpoints. They may never write
//    out the real provider's send endpoint.
{
  const fake = run({
    "server/testkit/fake.ts": 'export const isSend = (p: string) => p === "/emails" || p === "/emails/batch";\n',
    "server/x.e2e.test.ts":
      "export const env = { RESEND_API_BASE: 'http://127.0.0.1:1' };\nexport const u = process.env.RESEND_API_BASE;\n" +
      "export const post = (fakeUrl: string) => fetch(`${fakeUrl}/emails`, { method: 'POST' });\n" +
      'export const d = "https://api.resend.com/domains";\n',
  });
  check("the fake's send path, a post to the fake, a suite's base and a domains address pass", fake.status, 0);
  const real = run({ "server/y.test.ts": 'export const u = "https://api.resend.com/emails";\n' });
  check("a test writing out the real send endpoint fails", real.status, 1);
  check("as send-endpoint", /server\/y\.test\.ts:1\s+send-endpoint/.test(real.out), true);
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
