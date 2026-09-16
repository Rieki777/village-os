/**
 * THE STEWARD REVIEW SURFACE, DRIVEN, against the built server.
 *
 * This is acceptance test 2 from the work order, word for word: "A steward who
 * is not an admin can open it, edit a proposed role name, accept a batch of
 * twelve, and see the twelve land. A read failure renders as an error and
 * never as an empty queue."
 *
 * It is an e2e and not a unit test because every interesting word in that
 * sentence is about the request. "A steward who is not an admin" is a claim
 * about a token and a gate. "Edit before accept" is a claim about what the
 * server does with a body no client has ever sent. Neither survives being
 * tested against a function call.
 *
 * ── THE THIRD ASSERTION IS THE ONE PEOPLE SKIP ───────────────────────────
 *
 * "A read failure renders as an error and never as an empty queue" is not
 * something a server test can prove about a page. What it CAN prove is the
 * half that makes the page able to tell them apart: a refusal is a non-200
 * with a reason, and never a 200 carrying an empty list. A queue route that
 * answered `{batches: []}` to somebody who may not read it would make the
 * client's three states indistinguishable no matter how the client was
 * written.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { landProposal } from "./lib/externalProposals";
import { seatHolder } from "./lib/orgChart";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[review.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 30002 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "review-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
let founderId = "";

// Kira is a plain member who will end up keeping the review queue with no
// admin password anywhere in her requests. Otto holds nothing; he is the
// control that proves the gate is a gate.
let kiraToken = "";
let kiraId = "";
let ottoToken = "";

const BATCH = "batch-first-import";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "ReviewTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the review route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-review-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "review-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Review Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "ReviewTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const kira = await register("Kira Vance", "kira");
  kiraToken = kira.token; kiraId = kira.id;
  const otto = await register("Otto Brand", "otto");
  ottoToken = otto.token;
  // NO MORE ACCOUNTS THAN THESE. This file used to register three extra
  // members so the roster carried the change limit for a batch of twelve,
  // because `draftChangeCap` was `max(3, members * 3)`. Rye ruled that limit
  // broken on 2026-09-14: a village's beginning is one large import. The limit
  // is now `org.proposal_change_limit`, shipping at 500, so a village of three
  // accounts accepts twelve seats with nothing blocked, and the accept test
  // below asserts exactly that.

  // Kira becomes a steward: the Steward Circle role gains intake.moderate, and
  // she is seated in it. No admin role anywhere on her account.
  const roles = await call("GET", "/api/roles", undefined, "");
  const steward = (roles.json ?? []).find((r: any) => r.id === "steward-circle");
  expect(steward, "the seeded Steward Circle must exist").toBeTruthy();
  const granted = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
    capabilities: [...(steward.capabilities ?? []), "intake.moderate"],
    grantedEscalations: ["intake.moderate"],
  });
  expect(granted.status, granted.text).toBe(200);
  // The seeded Steward Circle asks for the Member stage, so a fresh account
  // cannot be seated in it. Same step the handover suite takes, and the
  // refusal it produces is a real product rule rather than a fixture problem.
  await call("PUT", `/api/admin/players/${kiraId}/stage`, { stageId: "member" });
  const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: kiraId, action: "add" });
  expect(seated.status, seated.text).toBe(200);

  // Twelve proposals in one batch, as an outside service would send them.
  for (let i = 1; i <= 12; i += 1) {
    const r = await landProposal(pool, {
      villageId: "v1",
      moduleId: "saberra",
      batchId: BATCH,
      kind: "role.proposed",
      sourceRef: `meeting-2026-08-14#${i}`,
      quote: `Somebody said seat ${i} needs an owner.`,
      payload: { name: `Proposed Seat ${i}`, aim: `Look after thing ${i}`, seats: 1 },
    });
    expect(r.ok, `proposal ${i} must land`).toBe(true);
  }
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("a steward who is not an admin", () => {
  it("is not an admin, which is the premise of every assertion below", async () => {
    const me = await call("GET", "/api/me/profile", undefined, kiraToken);
    expect(me.status).toBe(200);
    expect(me.json?.user?.role ?? me.json?.role).not.toBe("admin");
    // And the admin panel stays shut to her, so nothing here is passing
    // because she quietly became an administrator.
    const panel = await call("GET", "/api/admin/modules", undefined, kiraToken);
    expect(panel.status).toBe(401);
  });

  it("opens the queue with a member token and sees the batch of twelve", async () => {
    const q = await call("GET", "/api/review/queue", undefined, kiraToken);
    expect(q.status, q.text).toBe(200);
    const batch = (q.json.batches ?? []).find((b: any) => b.batchId === BATCH);
    expect(batch, "the batch must be one group").toBeTruthy();
    expect(batch.items).toHaveLength(12);
    expect(batch.moduleId).toBe("saberra");
    // The evidence rides on the card, the way the Calls tab renders it.
    expect(batch.items[0].quote).toContain("needs an owner");
    expect(batch.items[0].evidence).toBe("quoted");
    // Not stated is not zero.
    expect(batch.items[0].confidence).toBeNull();
  });

  it("says the village's change limit, what the batch proposes, and who may change the limit", async () => {
    const LIMIT = "/api/admin/variables/org.proposal_change_limit";
    const q = await call("GET", "/api/review/queue", undefined, kiraToken);
    expect(q.status, q.text).toBe(200);
    expect(q.json.proposalChangeLimit).toBe(500);
    const batch = (q.json.batches ?? []).find((b: any) => b.batchId === BATCH);
    expect(batch.proposedChanges).toBe(12);
    // The shares the page counts a steward's edits against add up to that total.
    expect(Object.values(batch.proposedChangesByItem as Record<string, number>).reduce((a, n) => a + n, 0)).toBe(12);
    // Kira keeps the queue and is no admin, so the admin page would refuse her.
    expect(q.json.mayChangeProposalLimit).toBe(false);

    // An admin who keeps the queue is offered the setting. The village holds
    // intake.moderate through the Steward Circle, so the founder is seated in
    // it the way Kira was; an admin does not pass a held key by being one.
    expect(founderId, "set-password names the founder").toBeTruthy();
    // The same Member-stage floor Kira was given: the seat asks for it, and a
    // granted stage is a floor over the computed one, so it lowers nobody.
    const staged = await call("PUT", `/api/admin/players/${founderId}/stage`, { stageId: "member" });
    expect(staged.status, staged.text).toBe(200);
    const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: founderId, action: "add" });
    expect(seated.status, seated.text).toBe(200);
    const asAdmin = await call("GET", "/api/review/queue");
    expect(asAdmin.status, asAdmin.text).toBe(200);
    expect(asAdmin.json.mayChangeProposalLimit).toBe(true);

    // The village's tuned value is the one the queue says, over the default.
    const tuned = await call("PUT", LIMIT, { value: "6" });
    expect(tuned.status, tuned.text).toBe(200);
    expect((await call("GET", "/api/review/queue", undefined, kiraToken)).json.proposalChangeLimit).toBe(6);
    const restored = await call("PUT", LIMIT, { value: "500" });
    expect(restored.status, restored.text).toBe(200);
    expect((await call("GET", "/api/review/queue", undefined, kiraToken)).json.proposalChangeLimit).toBe(500);
  });

  it("REFUSES somebody without the capability, and never with an empty queue", async () => {
    // The half of "a failed read is never an empty queue" that a server can
    // prove. A 200 carrying `{batches: []}` here would make the page unable to
    // tell "you may not read this" from "nothing is waiting", however the page
    // was written.
    const otto = await call("GET", "/api/review/queue", undefined, ottoToken);
    expect(otto.status).not.toBe(200);
    expect(otto.json?.batches).toBeUndefined();

    const stranger = await call("GET", "/api/review/queue", undefined, "");
    expect(stranger.status).not.toBe(200);
    expect(stranger.json?.batches).toBeUndefined();
  });

  it("edits a proposed role name and accepts the batch of twelve, and the twelve land", async () => {
    const q = await call("GET", "/api/review/queue", undefined, kiraToken);
    const batch = (q.json.batches ?? []).find((b: any) => b.batchId === BATCH);
    const first = batch.items[0];
    /*
     * WHICH one is first is not knowable in advance, and an earlier version of
     * this test assumed it was "Proposed Seat 1". `received_at` is a timestamp
     * at SECOND precision, so all twelve land on the same value and the tie is
     * broken by `id`, which is random. That test passed twice and would have
     * failed about eleven times in twelve, which is the worst kind of green.
     *
     * So the name being replaced is read off the row rather than assumed, and
     * the assertions below are about THAT name.
     */
    const replaced = String((first.payload as Record<string, unknown>).name);
    expect(replaced).toMatch(/^Proposed Seat \d+$/);

    // THE EDIT. The server has re-validated an edited payload at accept since
    // the draft queue was written and no client had ever sent one. This is a
    // client sending one.
    const accepted = await call("POST", `/api/review/batches/${BATCH}/accept`, {
      edits: { [first.id]: { ...first.payload, name: "Well Keeper, as the village calls it" } },
    }, kiraToken);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.json.accepted).toBe(12);
    expect(accepted.json.seats).toBe(12);
    // ONE decision, ONE reorganisation. Twelve drafts would be twelve previews
    // and twelve undos for a change made once.
    expect(accepted.json.draftId).toBeTruthy();
    expect(accepted.json.blocked).toBe(0);

    const [changes] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT payload FROM org_draft_changes WHERE draft_id = ? ORDER BY sort_order",
      [accepted.json.draftId],
    );
    expect(changes).toHaveLength(12);
    const names = changes.map((c) => {
      const p = typeof c.payload === "string" ? JSON.parse(c.payload) : c.payload;
      return String(p.name);
    });
    // The steward's version landed, and the vendor's did not.
    expect(names).toContain("Well Keeper, as the village calls it");
    expect(names).not.toContain(replaced);
    expect(names.filter((n) => n.startsWith("Proposed Seat"))).toHaveLength(11);

    // The provenance 0143 added, on the draft a month from now.
    const [[draft]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT source_kind, source_module_id, source_proposal_id, cites FROM org_drafts WHERE id = ?",
      [accepted.json.draftId],
    );
    expect(draft.source_kind).toBe("agent");
    expect(draft.source_module_id).toBe("saberra");
    expect(draft.source_proposal_id).toBeTruthy();

    // And the edited payload is stored back on the proposal row, so the text
    // the steward removed is not left in the table as the only version.
    const [[row]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT payload, status, created_ref FROM external_proposals WHERE id = ?",
      [first.id],
    );
    const stored = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    expect(stored.name).toBe("Well Keeper, as the village calls it");
    expect(stored.name).not.toBe(replaced);
    expect(row.status).toBe("accepted");
    expect(row.created_ref).toBe(accepted.json.draftId);

    // The queue is empty afterwards because the work was done, which is the
    // one case where an empty queue is the truth.
    const after = await call("GET", "/api/review/queue", undefined, kiraToken);
    expect(after.json.counts.proposals).toBe(0);
  });

  it("refuses a second accept on a batch that is already decided", async () => {
    const again = await call("POST", `/api/review/batches/${BATCH}/accept`, {}, kiraToken);
    expect(again.status).toBe(404);
  });

  it("gives every proposed seat an id that the public export will accept", async () => {
    // `org_roles.id` doubles as a URL slug AND as a path segment, and the
    // federated export refuses anything that is not slug-shaped, because there
    // is no legitimate seat called `../../etc/passwd`. That guard fails closed
    // in the wrong direction here: a seat created with a vendor's raw string
    // would render on the map and be silently absent from every federated
    // document forever, with nothing saying why.
    const [rows] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT org_role_id FROM org_draft_changes",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(String(r.org_role_id), `${r.org_role_id} must be a slug`).toMatch(
        /^[a-z0-9][a-z0-9-]{0,63}$/,
      );
    }
  });

  it("publishes NO agent name at the anonymous tier, and still counts the seat", async () => {
    // Guardrail 7 from the work order: nothing about which commercial services
    // a village uses is published. An agent's display name is a vendor's
    // product name, so the public holder row carries a generic word instead.
    // `org.public_people` defaults to on, so this is the shipped default and
    // not a state a test arranged.
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO org_roles (id, name, seats) VALUES ('agent-seat','The Note Taker',1)",
    );
    const seated = await seatHolder(pool, "agent-seat", {
      displayName: "Saberra Meeting Scribe",
      isAgent: true,
      agentSlug: "saberra-scribe",
    });
    expect(seated.ok, seated.reason).toBe(true);

    const anon = await call("GET", "/api/org", undefined, "");
    expect(anon.status, anon.text).toBe(200);
    // The vendor's name is nowhere in the bytes an anonymous caller downloads.
    expect(anon.text).not.toContain("Saberra");
    expect(anon.text).not.toContain("saberra-scribe");

    const seat = (anon.json.roles ?? []).find((r: any) => r.id === "agent-seat");
    expect(seat, "the seat must be published").toBeTruthy();
    // The seat is HELD, because it is. Counts and names agree.
    expect(seat.holderCount).toBe(1);
    expect((seat.holders ?? []).map((h: any) => h.name)).toEqual(["An agent"]);
  });

  it("holds the quest reward behind its own key, which a steward does not have", async () => {
    // `intake.moderate` opens the queue. Putting a quest on the board creates
    // a payout obligation and asks for `quest.approve`, which Kira was never
    // given. A village should be able to hand out the first without the
    // second, and this is that being true rather than being intended.
    const r = await call("POST", "/api/review/quests/anything/accept", {
      reward: { gratitude: "50-100" },
    }, kiraToken);
    expect(r.status).not.toBe(200);
    expect([401, 403, 409]).toContain(r.status);
  });

  it("reads a vendor's own field names, places each seat by circle name, and names what it did not read", async () => {
    // THE DEFECT. A real first batch spelled a seat's name `role_name`, its
    // holder count `seat_count`, gave its circle by NAME, and sent its
    // accountabilities as one string. The accept path copied canonical keys
    // only and dropped the rest in silence, so every seat blocked as nameless.
    const water = await call("POST", "/api/admin/circles", { name: "Springs & Wells", aliases: ["Water Care"] });
    expect(water.status, water.text).toBe(200);
    const waterId = String(water.json.id);

    const SHAPED = "batch-vendor-shape";
    const records: Record<string, unknown>[] = [
      {
        role_name: "Spring Keeper", aim: "The spring runs clean all year.", domain: null,
        accountabilities: "Test the spring monthly; Keep the log.", circle: "springs & wells ", seat_count: 1, recruiting: true,
      },
      {
        role_name: "Pipe Mender", aim: "No line stays broken for a week.", domain: "The water lines.",
        accountabilities: "Walk the lines after rain\nCarry the repair kit", circle: "Water Care", seat_count: 2,
        recruiting: false, vendor_rank: 3,
        // A batch of three gives its draft no rationale, so this one is reported.
        rationale: "The lines break every rain.",
      },
      {
        role_name: "Mill Warden", aim: "The mill turns when the grain is in.", domain: "The mill.",
        accountabilities: "Run the mill", circle: "Milling Circle", seat_count: 1, recruiting: false,
      },
    ];
    const ids: string[] = [];
    for (const [i, payload] of records.entries()) {
      const r = await landProposal(pool, {
        villageId: "v1",
        moduleId: "saberra",
        batchId: SHAPED,
        kind: "role.proposed",
        sourceRef: `record-${i + 1}`,
        quote: `The record describes the seat ${String(payload.role_name)}.`,
        payload,
      });
      expect(r.ok, `record ${i + 1} must land`).toBe(true);
      if (r.ok) ids.push(r.id);
    }

    const payloadsByName = async (draftId: string): Promise<Record<string, Record<string, unknown>>> => {
      const [rows] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
        "SELECT payload FROM org_draft_changes WHERE draft_id = ?", [draftId],
      );
      const out: Record<string, Record<string, unknown>> = {};
      for (const row of rows) {
        const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        out[String(p.name)] = p;
      }
      return out;
    };

    const first = await call("POST", `/api/review/batches/${SHAPED}/accept`, {}, kiraToken);
    expect(first.status, first.text).toBe(200);
    expect(first.json.seats).toBe(3);
    // One blocked, and only the one whose circle does not exist yet.
    expect(first.json.blocked).toBe(1);
    // Named, never dropped in silence. Sorted, because a JSON column may
    // reorder an object's keys on the way back out.
    expect(first.json.ignored).toHaveLength(1);
    expect(first.json.ignored[0].proposalId).toBe(ids[1]);
    expect([...first.json.ignored[0].keys].sort()).toEqual(["rationale", "vendor_rank"]);
    // The reason itself reaches the steward, and it names the recovery walked below.
    expect(first.json.blockedLines).toEqual([
      { reads: 'Create the seat "Mill Warden"', blocked: expect.stringContaining('There is no circle called "Milling Circle" yet') },
    ]);
    expect(first.json.blockedLines[0].blocked).toContain("withdraw this draft. Its proposals go back in the review queue");

    // The queue read lists that draft with its reasons, so a reload or a second
    // blocked accept cannot leave it with no withdraw on any screen.
    const stuckOn = async () => {
      const q = await call("GET", "/api/review/queue", undefined, kiraToken);
      expect(q.status, q.text).toBe(200);
      return (q.json.stuckDrafts ?? []) as { draftId: string; blocked: number; blockedLines: unknown }[];
    };
    expect((await stuckOn()).find((d) => d.draftId === first.json.draftId)).toEqual({
      draftId: first.json.draftId, blocked: 1, blockedLines: first.json.blockedLines,
    });

    const one = await payloadsByName(first.json.draftId);
    expect(one["Spring Keeper"]).toMatchObject({
      circleId: waterId, seats: 1, recruiting: true, accountabilities: ["Test the spring monthly", "Keep the log"],
    });
    expect(one["Pipe Mender"]).toMatchObject({
      circleId: waterId, seats: 2, accountabilities: ["Walk the lines after rain", "Carry the repair kit"],
    });
    expect(one["Pipe Mender"]).not.toHaveProperty("vendor_rank");
    expect(one["Mill Warden"]).not.toHaveProperty("circleId");
    expect(one["Mill Warden"].circleName).toBe("Milling Circle");

    // THE RECOVERY the blocked line asks for: an admin makes the circle, the
    // steward withdraws, accepts again, and the reopened proposal is placed.
    const mill = await call("POST", "/api/admin/circles", { name: "Milling Circle" });
    expect(mill.status, mill.text).toBe(200);
    const withdrawn = await call("POST", `/api/review/drafts/${first.json.draftId}/withdraw`, {}, kiraToken);
    expect(withdrawn.status, withdrawn.text).toBe(200);
    expect(withdrawn.json.reopened).toBe(3);
    // A second withdraw is refused and names the state, which is how the page
    // tells it apart from the break-glass refusal that is also a 409.
    const twice = await call("POST", `/api/review/drafts/${first.json.draftId}/withdraw`, {}, kiraToken);
    expect(twice.status, twice.text).toBe(409);
    expect(twice.json.draftStatus).toBe("withdrawn");
    expect((await stuckOn()).map((d) => d.draftId)).not.toContain(first.json.draftId);

    const again = await call("POST", `/api/review/batches/${SHAPED}/accept`, {}, kiraToken);
    expect(again.status, again.text).toBe(200);
    expect(again.json.blocked).toBe(0);
    // A draft that can publish is not stuck.
    expect((await stuckOn()).map((d) => d.draftId)).not.toContain(again.json.draftId);
    const two = await payloadsByName(again.json.draftId);
    expect(two["Mill Warden"]).toMatchObject({ circleId: String(mill.json.id) });
    expect(two["Mill Warden"]).not.toHaveProperty("circleName");
    expect(again.json.blockedLines).toEqual([]);

    // ONE proposal through the single accept: it returns the blocked reason
    // too, and a lone proposal's rationale names the draft, so it is read.
    const out = await call("POST", `/api/review/drafts/${again.json.draftId}/withdraw`, {}, kiraToken);
    expect(out.status, out.text).toBe(200);
    const single = await landProposal(pool, {
      villageId: "v1",
      moduleId: "saberra",
      batchId: "batch-vendor-single",
      kind: "role.proposed",
      sourceRef: "record-single",
      quote: "The record describes the seat Kiln Tender.",
      payload: { role_name: "Kiln Tender", circle: "Kiln Circle", rationale: "Somebody fires the kiln." },
    });
    expect(single.ok).toBe(true);
    const lone = await call("POST", `/api/review/proposals/${single.ok ? single.id : ""}/accept`, {}, kiraToken);
    expect(lone.status, lone.text).toBe(200);
    expect(lone.json.blocked).toBe(1);
    expect(lone.json.blockedLines[0].blocked).toContain('There is no circle called "Kiln Circle" yet');
    expect(lone.json.ignored).toEqual([]);
    expect((await stuckOn()).map((d) => d.draftId)).toContain(lone.json.createdRef);

    // AN OBJECT WHERE A VALUE BELONGS. Converting it threw inside the preview:
    // the accept answered with an error after writing its draft, and from then
    // on every read of this queue failed, the draft's withdraw with it.
    const hostile = await landProposal(pool, {
      villageId: "v1",
      moduleId: "saberra",
      batchId: "batch-vendor-hostile",
      kind: "role.proposed",
      sourceRef: "record-hostile",
      quote: "The record describes the seat Gate Keeper.",
      payload: { role_name: "Gate Keeper", criticality: { toString: 0 }, seat_count: { valueOf: 0, toString: 0 } },
    });
    expect(hostile.ok, JSON.stringify(hostile)).toBe(true);
    const taken = await call("POST", `/api/review/proposals/${hostile.ok ? hostile.id : ""}/accept`, {}, kiraToken);
    expect(taken.status, taken.text).toBe(200);
    expect(taken.json.blocked).toBe(1);
    expect(taken.json.blockedLines[0].blocked).toContain("Criticality is normal or high");
    expect(taken.json.blockedLines[0].blocked).toContain("A seat holds between 1 and 50 people");
    expect((await stuckOn()).map((d) => d.draftId)).toContain(taken.json.createdRef);
  });
});
