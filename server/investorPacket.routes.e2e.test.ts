/**
 * THE PACKET STOPS SENDING EVERYTHING TO EVERYONE.
 *
 * `POST /api/investor-docs/request` is public and unauthenticated. It took
 * `{name, email, accredited}` from anybody and then read the WHOLE vault:
 *
 *     const docs: any[] = investorDocsRepo.all();
 *
 * Every row became a download link in an email sent to whatever address the
 * requester typed. There was no per-document gate anywhere in the path, and
 * the vault is where a founder keeps the cap table. `/api/uploads/<file>` has
 * no authentication of its own, so a link, once emailed, is a bearer
 * credential that never expires and can be forwarded.
 *
 * These tests drive the built server over HTTP, and the request itself is
 * made with no account and no session, because that is how the leak was
 * reachable.
 *
 * The oracle is the lead record rather than the email body. `sendResendEmail`
 * posts to a hardcoded `https://api.resend.com/emails` with no test seam, so
 * the outbound HTML is not observable from here. The route now writes the
 * packet it chose into the submission row, which is a founder-facing feature
 * in its own right (answering "what did this person actually receive" a year
 * later), and it is the same list the email is built from. Asserting on it
 * asserts on the product rather than on a mock.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[investorPacket.routes] TEST_DATABASE_URL not set, DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 16700 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "packet-admin";

/**
 * The vault holds two documents for every test below. Only ever ONE of them
 * is put in the packet, so any assertion that the other one travelled is an
 * assertion that the leak is back.
 */
const CHOSEN = "Cap Table 2026";
const WITHHELD = "Board Minutes March";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let founderToken = "";
let chosenId = "";
let withheldId = "";

async function call(method: string, route: string, body?: unknown, token = founderToken) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/** Seed a vault document the way the product does, through the admin route. */
async function uploadDoc(title: string) {
  const form = new FormData();
  const bytes = Buffer.from(`${title}\nconfidential fixture body\n`, "utf8");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "text/plain" }), `${title}.txt`);
  form.append("name", title);
  const res = await fetch(`${BASE}/api/admin/investor-docs/upload`, { // module-review-ok: the test client dialling the built server on localhost
    method: "POST",
    headers: { Authorization: `Bearer ${founderToken}` },
    body: form,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

/** The public form, with no account and no session. That is the point. */
async function requestPacket(name: string, email: string) {
  return call("POST", "/api/investor-docs/request", { name, email, accredited: true }, "");
}

/** The lead the route just captured, newest first. */
async function newestLead() {
  const res = await call("GET", "/api/admin/submissions?type=investor-doc-request");
  expect(res.status, res.text).toBe(200);
  expect(Array.isArray(res.json), res.text).toBe(true);
  return res.json[0];
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the investor packet test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-packet-"));
  testDb = await provisionTestDb();

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "packet-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Packet Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "PacketTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const a = await uploadDoc(CHOSEN);
  expect(a.status, a.text).toBe(200);
  chosenId = String(a.json?.id ?? "");
  const b = await uploadDoc(WITHHELD);
  expect(b.status, b.text).toBe(200);
  withheldId = String(b.json?.id ?? "");
  expect(chosenId && withheldId, "both fixture documents must be in the vault").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await testDb?.drop();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
});

describe.skipIf(!DB_CONFIGURED)("the investor packet only sends what a person chose", () => {
  it("the fixtures really are in the vault, or nothing below means anything", async () => {
    const res = await call("GET", "/api/admin/investor-docs");
    expect(res.status, res.text).toBe(200);
    const titles = res.json.map((d: any) => d.title);
    expect(titles).toContain(CHOSEN);
    expect(titles).toContain(WITHHELD);
    // Nothing is in the packet until somebody says so.
    expect(res.json.every((d: any) => d.inPacket === false), res.text).toBe(true);
  });

  /*
   * THE REGRESSION THAT MATTERS MOST. Two documents sit in the vault and a
   * stranger asks for the packet. Before this fix both of them were emailed.
   */
  it("sends no documents at all when nobody has chosen any", async () => {
    const res = await requestPacket("Curious Stranger", "stranger@example.test");
    expect(res.status, res.text).toBe(200);

    /*
     * This assertion is FIRST on purpose. It is the one that means something
     * against the unfixed tree: there, with two unchosen documents sitting in
     * the vault, the route answers "Check your email for the documents." and
     * the documents really are on their way. Everything below it can only
     * report that a field or a route does not exist yet, which is a weaker
     * kind of red. The requester must never be told they were sent something
     * they were not sent.
     */
    expect(
      String(res.json?.message ?? "").toLowerCase(),
      "the route promised documents when nothing had been chosen",
    ).not.toContain("document");

    expect(res.json?.documentsSent, "a packet went out with nothing chosen").toBe(0);

    const lead = await newestLead();
    expect(lead?.data?.email).toBe("stranger@example.test");
    expect(lead?.data?.documentsSent, "the lead record must say what was sent").toEqual([]);
    /*
     * This suite boots with RESEND_API_KEY empty, so no email is dispatched at
     * all. The lead has to carry that fact next to the packet, or a founder
     * reading a list of titles would believe somebody received them.
     */
    expect(lead?.data?.emailed, "the lead record must say whether an email went").toBe(false);
  });

  it("sends the chosen document and withholds the one nobody chose", async () => {
    const set = await call("PATCH", `/api/admin/investor-docs/${chosenId}`, { inPacket: true });
    expect(set.status, set.text).toBe(200);
    expect(set.json?.inPacket).toBe(true);

    const res = await requestPacket("Real Investor", "investor@example.test");
    expect(res.status, res.text).toBe(200);
    expect(res.json?.documentsSent).toBe(1);

    const lead = await newestLead();
    expect(lead?.data?.email).toBe("investor@example.test");
    const sent = (lead?.data?.documentsSent ?? []).map((d: any) => d.title);
    expect(sent, "the chosen document did not travel").toContain(CHOSEN);
    expect(sent, "an unchosen document travelled anyway").not.toContain(WITHHELD);
    expect(sent).toHaveLength(1);
  });

  it("keeps the choice behind the admin gate", async () => {
    const res = await call("PATCH", `/api/admin/investor-docs/${withheldId}`, { inPacket: true }, "");
    expect(res.status, res.text).toBe(401);

    const after = await call("GET", "/api/admin/investor-docs");
    const withheld = after.json.find((d: any) => d.id === withheldId);
    expect(withheld?.inPacket, "an anonymous caller moved a document into the packet").toBe(false);
  });
});

/**
 * THE OTHER DOOR OUT OF THE VAULT: A LINK AN ADMIN PASTES INTO A PUBLIC FIELD.
 *
 * `GET /api/investor-summary` is public and echoes the whole admin-authored
 * document back, `cta_url` and all. The vault's entire posture is that
 * `/api/uploads/<file>` has no authentication, so a link IS the credential.
 * Pasting a vault document's link into the call-to-action field therefore
 * published the cap table to everyone who loaded /investor, without anybody
 * choosing to release it and without the per-document `inPacket` choice PR #91
 * built ever being asked.
 *
 * The same field, and the same public echo, exists on `visit-config`.
 *
 * These tests use the REAL url of a REAL vault document, read back out of the
 * admin listing, so they cannot pass against a link shape the uploader has
 * stopped producing.
 */
describe.skipIf(!DB_CONFIGURED)("a vault link cannot be published as a call to action", () => {
  /** The genuine, working link to a document sitting in this village's vault. */
  async function vaultUrl(): Promise<string> {
    const res = await call("GET", "/api/admin/investor-docs");
    expect(res.status, res.text).toBe(200);
    const doc = res.json.find((d: any) => d.id === withheldId);
    const url = String(doc?.url ?? "");
    expect(url, "the fixture document must carry a real uploads url").toMatch(/^\/api\/uploads\//);
    return url;
  }

  it("refuses the vault link, and says why in words a founder can act on", async () => {
    const url = await vaultUrl();
    const before = await call("GET", "/api/admin/investor-summary");
    expect(before.status, before.text).toBe(200);

    const res = await call("PUT", "/api/admin/investor-summary", { ...before.json, cta_url: url });
    expect(res.status, res.text).toBe(400);
    const said = String(res.json?.error ?? "");
    // A founder pasting a vault link is trying to do something reasonable.
    // The answer has to name the vault and offer the door that exists.
    expect(said.toLowerCase()).toContain("vault");
    expect(said.toLowerCase()).toContain("packet");
    expect(said.length, "a bare validation code is not an answer").toBeGreaterThan(60);
  });

  it("publishes nothing, so the refusal is a refusal and not a warning", async () => {
    const url = await vaultUrl();
    const shown = await call("GET", "/api/investor-summary", undefined, "");
    expect(shown.status, shown.text).toBe(200);
    expect(shown.text).not.toContain(url);
    expect(shown.text).not.toContain("/api/uploads/");
  });

  it("refuses an absolute link at the same file, which is what a browser copies", async () => {
    const url = await vaultUrl();
    const before = await call("GET", "/api/admin/investor-summary");
    const res = await call("PUT", "/api/admin/investor-summary", {
      ...before.json,
      cta_url: `https://village.example${url}`,
    });
    expect(res.status, res.text).toBe(400);
  });

  it("reads the path a browser would ask for, dots and all", async () => {
    // Self-audit, second finding. A browser normalizes `/api/./uploads/x` and
    // `/api/x/../uploads/y` before it sends them, so both reach the file while
    // a plain prefix test on the pasted text sees neither.
    const url = await vaultUrl();
    const file = url.slice("/api/uploads/".length);
    const before = await call("GET", "/api/admin/investor-summary");
    for (const dodge of [`/api/./uploads/${file}`, `/api/elsewhere/../uploads/${file}`]) {
      const res = await call("PUT", "/api/admin/investor-summary", { ...before.json, cta_url: dodge });
      expect(res.status, `${dodge}: ${res.text}`).toBe(400);
    }
  });

  it("checks a list of links link by link, which my first draft did not", async () => {
    // Self-audit after everything was green. The walk called String() on the
    // whole value, so an array whose FIRST entry is innocent read as one
    // string beginning with that entry and passed. A guard that only ever
    // meets the input the current form sends is a guard for the current form.
    const url = await vaultUrl();
    const before = await call("GET", "/api/admin/investor-summary");
    const res = await call("PUT", "/api/admin/investor-summary", {
      ...before.json,
      cta_url: ["https://example.org/talk-to-us", url],
    });
    expect(res.status, res.text).toBe(400);
  });

  it("still takes an ordinary call to action, so this is a validation and not a gate", async () => {
    const before = await call("GET", "/api/admin/investor-summary");
    const res = await call("PUT", "/api/admin/investor-summary", {
      ...before.json,
      cta_url: "https://example.org/talk-to-us",
    });
    expect(res.status, res.text).toBe(200);
    const shown = await call("GET", "/api/investor-summary", undefined, "");
    expect(shown.json?.cta_url).toBe("https://example.org/talk-to-us");
  });

  it("holds the same line on the visit page's call to action", async () => {
    const url = await vaultUrl();
    const before = await call("GET", "/api/admin/visit-config");
    expect(before.status, before.text).toBe(200);
    const types = Array.isArray(before.json?.visit_types) ? before.json.visit_types : [];
    expect(types.length, "the visit config must carry visit types to test").toBeGreaterThan(0);
    const res = await call("PUT", "/api/admin/visit-config", {
      ...before.json,
      visit_types: types.map((v: any, i: number) => (i === 0 ? { ...v, cta_url: url } : v)),
    });
    expect(res.status, res.text).toBe(400);
    const shown = await call("GET", "/api/visit-config", undefined, "");
    expect(shown.text).not.toContain("/api/uploads/");
  });
});

/**
 * THE OTHER THING A CALL TO ACTION CAN CARRY: CODE.
 *
 * The guard above reads the PATH a link resolves to, which is exactly what a
 * link into `/api/uploads/` needs. It never read the SCHEME. So
 * `javascript:alert(1)` parsed, its pathname came out as `alert(1)`, nothing
 * under `/api/uploads/` matched, and it saved.
 *
 * Both documents these routes write are handed back by a PUBLIC GET, and both
 * pages that read them drop the value straight into `href`:
 * `client/src/components/InvestorSummary.tsx` and `client/src/pages/Visit.tsx`.
 * So the stored string runs in the browser of every visitor who clicks it,
 * with no account needed at either end of that.
 *
 * The allowlist is `http`, `https`, `mailto`, and a path on this site. It is
 * wider than `POST /api/journey/resources` next door, which takes http and
 * https only, and both are right for their own surface: a founder pointing a
 * visit button at `mailto:` or at `/visit` is doing an ordinary thing, and
 * the journey list is a set of working documents on the web.
 *
 * THE DODGES ARE THE WHOLE TEST. A browser lowercases a scheme, drops leading
 * whitespace, and strips every tab and newline anywhere in the URL before it
 * decides what the link does. `JavaScript:`, ` javascript:` and
 * `java<newline>script:` therefore all reach the same place, while a check
 * reading the characters an admin typed sees three harmless different
 * strings. So the guard asks the same parser the browser uses and reads the
 * protocol off the result.
 */
describe.skipIf(!DB_CONFIGURED)("a call to action cannot carry a scheme that runs code", () => {
  /** Every spelling of the same link that a browser resolves to javascript:. */
  const RUNS_CODE = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "  javascript:alert(1)",
    "\tjavascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "java\rscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ];

  /** Links a founder legitimately pastes, which must keep saving. */
  const ORDINARY = [
    "https://example.org/talk-to-us",
    "http://example.org/talk-to-us",
    "mailto:hello@example.org",
    "MAILTO:hello@example.org",
    "/visit",
    "#visit-form",
  ];

  it("refuses every spelling of a link that runs code, and names what it takes", async () => {
    const before = await call("GET", "/api/admin/investor-summary");
    expect(before.status, before.text).toBe(200);
    for (const dodge of RUNS_CODE) {
      const res = await call("PUT", "/api/admin/investor-summary", { ...before.json, cta_url: dodge });
      expect(res.status, `${JSON.stringify(dodge)} saved: ${res.text}`).toBe(400);
      const said = String(res.json?.error ?? "");
      // A refusal that does not say what the field takes sends a founder
      // guessing, and this field takes four different shapes.
      expect(said, `${JSON.stringify(dodge)}: ${said}`).toContain("mailto:");
      expect(said.length, "a bare validation code is not an answer").toBeGreaterThan(60);
    }
  });

  it("publishes none of them, so the refusal is a refusal", async () => {
    const shown = await call("GET", "/api/investor-summary", undefined, "");
    expect(shown.status, shown.text).toBe(200);
    expect(shown.text.toLowerCase()).not.toContain("javascript:");
    expect(shown.text.toLowerCase()).not.toContain("vbscript:");
    expect(shown.text.toLowerCase()).not.toContain("data:text/html");
  });

  it("still takes the four shapes an ordinary call to action uses", async () => {
    for (const good of ORDINARY) {
      const before = await call("GET", "/api/admin/investor-summary");
      const res = await call("PUT", "/api/admin/investor-summary", { ...before.json, cta_url: good });
      expect(res.status, `${good} was refused: ${res.text}`).toBe(200);
      const shown = await call("GET", "/api/investor-summary", undefined, "");
      expect(shown.json?.cta_url, `${good} did not survive the round trip`).toBe(good);
    }
  });

  it("checks a list of links link by link, the way the vault guard does", async () => {
    const before = await call("GET", "/api/admin/investor-summary");
    const res = await call("PUT", "/api/admin/investor-summary", {
      ...before.json,
      cta_url: ["https://example.org/talk-to-us", "javascript:alert(1)"],
    });
    expect(res.status, res.text).toBe(400);
  });

  it("reaches the call to action nested inside a visit type", async () => {
    const before = await call("GET", "/api/admin/visit-config");
    expect(before.status, before.text).toBe(200);
    const types = Array.isArray(before.json?.visit_types) ? before.json.visit_types : [];
    expect(types.length, "the visit config must carry visit types to test").toBeGreaterThan(0);
    const res = await call("PUT", "/api/admin/visit-config", {
      ...before.json,
      visit_types: types.map((v: any, i: number) => (i === 0 ? { ...v, cta_url: "javascript:alert(1)" } : v)),
    });
    expect(res.status, res.text).toBe(400);
    const shown = await call("GET", "/api/visit-config", undefined, "");
    expect(shown.text.toLowerCase()).not.toContain("javascript:");
  });

  it("leaves an empty call to action alone, which is how a founder hides the button", async () => {
    const before = await call("GET", "/api/admin/investor-summary");
    const res = await call("PUT", "/api/admin/investor-summary", { ...before.json, cta_url: "" });
    expect(res.status, res.text).toBe(200);
  });
});
