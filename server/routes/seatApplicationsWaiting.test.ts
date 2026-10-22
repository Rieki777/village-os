/**
 * WAITING ON YOU, END TO END: the approve flow for seat applications over real
 * HTTP and the S5 scratch schema (shared/waitingOnYou.ts).
 *
 * What is pinned:
 *
 *   - three holders A (the applicant), B and C: A applies, B and C each get
 *     the holder notice and A does not; B and C each see the row on their
 *     task board read, and A does not; B aligns for the village; A hears it
 *     was adopted; the row leaves B's and C's groups;
 *   - the row names the seats, their circle, the applicant's first name and
 *     the day, and carries no money even when the terms do;
 *   - put to the village, and withdrawn, each take the row off every board;
 *   - the 48 hour reminder lands once for a holder who did nothing, never
 *     twice however often the job runs, never on an application a holder
 *     already decided, and never before 48 hours;
 *   - the reminder is in the bell only: it has no email cadence;
 *   - a candidate who is the only holder goes to the vote, and nobody is
 *     offered an adopt row for their own application;
 *   - the drafts half: an open draft a proposal made, with what it adds and
 *     its batch's structure page, for whoever may publish it the way the
 *     publish routes decide (`publishDoorFor`): a live holder of `org.decide`
 *     sees it and a member who holds nothing does not; an admin sees it until
 *     a launch vote carries, and after that only by holding the power; a
 *     draft the village is voting on is nobody's to publish, so it is off.
 *
 * The notices go through the real spine (`insertNotification`) on the scratch
 * schema, so "once" is the dedupe key's answer and not a fake's.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { WAITING_URL, type WaitingPayload } from "../../shared/waitingOnYou";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole } from "../lib/orgChart";
import { addChange, createDraft } from "../lib/orgDrafts";
import { emailCadenceFor, insertNotification, resolveNotifyPrefs, type NotifyInput } from "../lib/notify";
import { recordLaunchCarried } from "../lib/launch";
import { remindWaitingHolders } from "../lib/seatApplicationWaiting";
import { insertTension } from "../repos/roleTensions";
import { register } from "./seatApplications";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;
const A = "u-ana";
const B = "u-ben";
const C = "u-cal";

const PEOPLE: Record<string, { id: string; name: string }> = {
  [A]: { id: A, name: "Ana Quillfeather" },
  [B]: { id: B, name: "Ben Hollowell" },
  [C]: { id: C, name: "Cal Brightwater" },
  "u-guest": { id: "u-guest", name: "Gale Visitor" },
};

/** Money in the terms, so the row has something it must not carry. XTS is the ISO code reserved for testing. */
const MONEY_TERMS = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } };

const CALENDAR: SeatCalendar = {
  seasons: [{ id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" }],
  currentSeasonId: "s-now",
  timezone: "UTC",
};

const configured = testDbConfigured();
if (!configured) console.warn("[seatApplicationsWaiting] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string; admin?: boolean } | null,
    holders: [] as string[],
    /** Live holders of `org.decide`, kept apart from the seat holders so each half is driven on its own. */
    deciders: [] as string[],
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const notices: NotifyInput[] = [];
  const closers: Record<string, SubjectCloser> = {};
  let server: http.Server;
  let base = "";

  /** The real spine on the scratch schema: no member has an email, so nothing is mailed. */
  const notify = async (input: NotifyInput) => {
    notices.push(input);
    return insertNotification(
      {
        pool: state.pool(),
        memberById: async () => null,
        sendEmail: async () => ({ ok: false }) as any,
        origin: () => "http://127.0.0.1",
        projectName: () => "Test village",
        isPresent: () => true,
      },
      input,
    );
  };

  const landing = {
    vetoHours: () => 72,
    autoApplyEnabled: () => true,
    stewardCouncil: () => false,
    stewardVetoTiers: () => "all",
    consentNoticeHours: () => 0,
    nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * DAY),
    cycleNumberAt: () => 1,
    landingExpiryCycles: () => 3,
    closerFor: (t: string) => closers[t],
    notify: async () => {},
    endedUnclosedCycle: async () => false,
    waitsForCycleClose: () => false,
    snapsToBoundary: () => false,
  };

  const ctxOf = () =>
    ({
      stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
      stageIndexOf: (id: string) => LADDER.indexOf(id),
      roleCapabilities: [],
      villageHeld: [],
      isAdmin: state.viewer?.admin === true,
    }) as unknown as CapabilityCtx;

  const start = async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () =>
        state.viewer ? { ...(PEOPLE[state.viewer.id] ?? { id: state.viewer.id, name: "Someone" }), tokenVersion: 0, prefs: { identityConfirmedAt: { at: Date.now(), v: 0 } } } : null,
      capabilityCtx: async () => ctxOf(),
      guardCapability: async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
        // The admin short-circuit stays out of the member door: an admin reads it as a member does.
        if (state.viewer && hasCapability(cap, { ...ctxOf(), isAdmin: false })) return true;
        res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
        return false;
      },
      getPool: () => state.pool(),
      notify: notify as any,
      notifyAdmins: async () => {},
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null, all: async () => Object.values(PEOPLE) } as any,
      firstName: (n: string) => String(n ?? "").split(" ")[0] ?? "",
      liveHoldersOf: async (cap: string) => (cap === "org.decide" ? [...state.deciders] : [...state.holders]),
      rolesCarrying: () => [{ id: "role-stewards", name: "Stewards" }],
      loadRoleHolders: () => state.holders.map((userId) => ({ roleId: "role-stewards", userId })),
      roleBallotSetup: async () => ({
        method: "majority",
        dials: { unityPct: 50, quorumPct: 0 },
        snapshot: { mode: "equal", token: null },
        tokenProblem: null,
        electorate: [A, B, C].map((userId) => ({ userId, weight: 1 })),
        durationDays: 7,
      }),
      seatCalendar: () => CALENDAR,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      landingDeps: () => ({ pool: state.pool(), ...landing }) as unknown as LandingDeps,
      closers,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  };
  const stop = () => new Promise<void>((resolve) => server?.close(() => resolve()));
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.clone().text(), body: (await res.json().catch(() => ({}))) as any };
  };
  return { state, notices, start, stop, call, notify };
}

describe("the waiting read refuses everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor and a guest get 401, and the database is never read", async () => {
    h.state.viewer = null;
    expect((await h.call("GET", WAITING_URL)).status).toBe(401);
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const r = await h.call("GET", WAITING_URL);
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("applications");
  });
});

describe("the reminder is in the bell only", () => {
  it("has no email cadence, even for a member who asked for governance mail at once", () => {
    const keen = resolveNotifyPrefs({ notify: { governanceEmail: "immediate", rolesEmail: "immediate", tasksEmail: "immediate" } });
    expect(emailCadenceFor("seat_application_reminder", keen)).toBe("off");
    // Control: the holder's first notice rides the governance preference.
    expect(emailCadenceFor("governance", keen)).toBe("immediate");
  });
});

describe.skipIf(!configured)("waiting on you, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO circles (id, name, aliases, is_example) VALUES ('wc-orchard', 'Orchard Circle', ?, 0)",
      [JSON.stringify([])],
    );
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.state.viewer = { id: A, stage: "member" };
    h.state.holders = [A, B, C];
    h.state.deciders = [];
    h.notices.length = 0;
  });

  const as = (id: string, admin = false) => {
    h.state.viewer = { id, stage: "member", admin };
  };

  /** A fresh seat in the Orchard Circle. */
  const seat = async (name: string) => {
    n += 1;
    return createOrgRole(pool, { id: `wseat-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: 1, circleId: "wc-orchard" });
  };

  const apply = async (seatId: string, terms: unknown = { v: 1 }) => {
    as(A);
    const r = await h.call("POST", "/api/governance/role-applications", {
      seatIds: [seatId],
      deliverables: "Two more people can keep the orchard ledger by the season's end.",
      fitStatement: "I kept the orchard ledger all last season.",
      seatSettings: terms,
    });
    expect(r.status, r.text).toBe(201);
    return r.body as { id: string; status: string };
  };

  const waitingFor = async (id: string, admin = false): Promise<WaitingPayload & { raw: string }> => {
    as(id, admin);
    const r = await h.call("GET", WAITING_URL);
    expect(r.status, r.text).toBe(200);
    return { ...(r.body as WaitingPayload), raw: r.text };
  };

  const rowIds = async (id: string) => (await waitingFor(id)).applications.map((a) => a.id);

  /** Written more than 48 hours ago, by MySQL's own clock. */
  const age = (applicationId: string, hours: number) =>
    pool.query("UPDATE seat_applications SET created_at = created_at - INTERVAL ? HOUR WHERE id = ?", [hours, applicationId]); // module-review-ok: ages a fixture row on the scratch schema

  const reminders = async (applicationId: string) =>
    (
      await pool.query<any[]>( // module-review-ok: reads back the scratch schema's notifications
        "SELECT user_id FROM notifications WHERE type = 'seat_application_reminder' AND link = ? ORDER BY user_id",
        [`/role-applications/${applicationId}`],
      )
    )[0].map((r: any) => String(r.user_id));

  it("three holders: B and C hear and see the row, A does not; B aligns; A hears; the row leaves both boards", async () => {
    const s = await seat("Ledger Keeper");
    const app = await apply(s, MONEY_TERMS);
    expect(app.status).toBe("awaiting-holder");

    // The holder notice: B and C, never the applicant, linking the application and naming the tasks.
    const waiting = h.notices.filter((x) => x.dedupeKey.startsWith(`sa:${app.id}:waiting:`));
    expect(waiting.map((x) => x.userId).sort()).toEqual([B, C]);
    for (const x of waiting) {
      expect(x.link).toBe(`/role-applications/${app.id}`);
      expect(x.body).toContain("Tasks on your profile");
    }

    // B and C each see the row; A does not.
    for (const holder of [B, C]) {
      const w = await waitingFor(holder);
      const row = w.applications.find((a) => a.id === app.id);
      expect(row, holder).toBeTruthy();
      expect(row!.seats).toEqual(["Ledger Keeper"]);
      expect(row!.circles).toEqual(["Orchard Circle"]);
      expect(row!.applicant).toBe("Ana");
      expect(row!.href).toBe(`/role-applications/${app.id}`);
      expect(row!.appliedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // No money on the row, though the terms carry it, and no surname.
      expect(w.raw).not.toMatch(/XTS|4321000|amountMinor|Quillfeather/);
      // A member who is not an admin is shown no drafts.
      expect(w.drafts).toEqual([]);
    }
    expect(await rowIds(A)).not.toContain(app.id);

    // B aligns for the village.
    as(B);
    const adopted = await h.call("POST", `/api/governance/role-applications/${app.id}/adopt`);
    expect(adopted.status, adopted.text).toBe(200);
    expect(adopted.body.status).toBe("adopted");
    expect(h.notices.some((x) => x.userId === A && x.title.startsWith("Adopted:"))).toBe(true);

    // It leaves every holder's group.
    expect(await rowIds(B)).not.toContain(app.id);
    expect(await rowIds(C)).not.toContain(app.id);
  });

  it("put to the village, or withdrawn, the row leaves every holder's group", async () => {
    const voted = await apply(await seat("Seed Librarian"));
    const taken = await apply(await seat("Path Warden"));
    expect(await rowIds(C)).toEqual(expect.arrayContaining([voted.id, taken.id]));

    as(C);
    const put = await h.call("POST", `/api/governance/role-applications/${voted.id}/put-to-village`);
    expect(put.status, put.text).toBe(200);
    as(A);
    const back = await h.call("POST", `/api/governance/role-applications/${taken.id}/withdraw`);
    expect(back.status, back.text).toBe(200);

    for (const holder of [B, C]) {
      const ids = await rowIds(holder);
      expect(ids, holder).not.toContain(voted.id);
      expect(ids, holder).not.toContain(taken.id);
    }
  });

  it("the 48 hour reminder lands once for a holder who did nothing, and never on one already decided", async () => {
    const idle = await apply(await seat("Well Tender"));
    const decided = await apply(await seat("Gate Keeper"));
    const fresh = await apply(await seat("Bell Ringer"));
    as(B);
    expect((await h.call("POST", `/api/governance/role-applications/${decided.id}/adopt`)).status).toBe(200);
    await age(idle.id, 49);
    await age(decided.id, 49);
    await age(fresh.id, 47);

    const deps = { pool, notify: h.notify, liveHoldersOf: async () => [...h.state.holders] };
    await remindWaitingHolders(deps);
    await remindWaitingHolders(deps);
    await remindWaitingHolders(deps);

    // B and C each once on the idle one, never the applicant, never twice.
    expect(await reminders(idle.id)).toEqual([B, C]);
    // B acted: nobody is reminded of a decision already made.
    expect(await reminders(decided.id)).toEqual([]);
    // Not yet 48 hours.
    expect(await reminders(fresh.id)).toEqual([]);
    const sent = h.notices.filter((x) => x.type === "seat_application_reminder" && x.link === `/role-applications/${idle.id}`);
    expect(sent[0]?.title).toBe("Still waiting on a role holder: Well Tender");
  });

  it("a candidate who is the only holder goes to the vote, and sees no adopt row for their own application", async () => {
    h.state.holders = [A];
    const own = await apply(await seat("Orchard Steward"));
    expect(own.status).toBe("voting");
    expect(await rowIds(A)).toEqual([]);

    // With a second holder the road is the holder's, and still never the candidate's own row.
    h.state.holders = [A, B];
    const next = await apply(await seat("Compost Keeper"));
    expect(next.status).toBe("awaiting-holder");
    expect(await rowIds(A)).not.toContain(next.id);
    expect(await rowIds(B)).toContain(next.id);
  });

  /** A queue-made draft with one circle and two seats, plus an orphan and one typed by hand. */
  const draftFixtures = async (tag: string) => {
    const proposal = `xp-wait-${tag}`;
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO external_proposals (id, village_id, module_id, batch_id, kind, payload, dedupe_key, identity_key) " +
        "VALUES (?, 'v-test', 'mod-test', ?, 'role.proposed', ?, ?, ?)",
      [proposal, `batch-wait-${tag}`, JSON.stringify({ title: "A new water circle" }), tag.padEnd(64, "d"), tag.padEnd(64, "i")],
    );
    const fromQueue = await createDraft(pool, { title: `The water circle ${tag}`, createdBy: B, sourceKind: "agent", sourceModuleId: "mod-test", sourceProposalId: proposal });
    const orphan = await createDraft(pool, { title: `An older proposal ${tag}`, createdBy: B, sourceKind: "agent", sourceModuleId: "mod-test", sourceProposalId: `xp-gone-${tag}` });
    const byHand = await createDraft(pool, { title: `My own sketch ${tag}`, createdBy: B });
    if (!fromQueue.ok || !orphan.ok || !byHand.ok) throw new Error("a draft fixture was refused");
    for (const c of [
      { op: "create_circle" as const, orgRoleId: `wc-water-${tag}`, payload: { name: `Water Circle ${tag}` } },
      { op: "create_seat" as const, orgRoleId: `wseat-spring-${tag}`, payload: { name: "Spring Keeper", circleId: `wc-water-${tag}` } },
      { op: "create_seat" as const, orgRoleId: `wseat-rain-${tag}`, payload: { name: "Rain Keeper", circleId: `wc-water-${tag}` } },
    ]) {
      const added = await addChange(pool, fromQueue.id, c);
      expect(added.ok, JSON.stringify(added)).toBe(true);
    }
    return { fromQueue: fromQueue.id, orphan: orphan.id, byHand: byHand.id, batch: `batch-wait-${tag}` };
  };

  /** An open `org_draft` vote on a draft, the row `openBallot` would write. */
  const voteOn = (draftId: string) =>
    pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, " +
        "weight_mode, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP() + INTERVAL 7 DAY,'open')",
      [`bal-${draftId}`, "org_draft", draftId, `org_draft:${draftId}`, "Adopt the draft", "the draft", "majority", "equal", 50, 0, 3, 3, B],
    );

  const draftIds = async (id: string, admin = false) => (await waitingFor(id, admin)).drafts.map((d) => d.id);

  it("an open draft a proposal made waits on a holder of org.decide, with what it adds and its batch's page", async () => {
    const d = await draftFixtures("hold");
    h.state.deciders = [B];

    const holder = await waitingFor(B);
    const row = holder.drafts.find((x) => x.id === d.fromQueue);
    expect(row).toEqual({ id: d.fromQueue, title: "The water circle hold", circles: 1, seats: 2, href: `/review/structure/${d.batch}` });
    // A batch nobody can find falls back to the review queue.
    expect(holder.drafts.find((x) => x.id === d.orphan)?.href).toBe("/review");
    // A draft typed by hand waits on nobody.
    expect(holder.drafts.map((x) => x.id)).not.toContain(d.byHand);

    // A member who holds nothing sees none, though the same draft waits on B.
    expect(await draftIds(C)).toEqual([]);
    // The seat power is not this one: A, B and C all hold org.seat here.
    h.state.deciders = [];
    expect(await draftIds(B)).toEqual([]);
  });

  it("a draft the village is voting on is nobody's to publish, so it waits on nobody", async () => {
    const d = await draftFixtures("vote");
    h.state.deciders = [B];
    expect(await draftIds(B)).toContain(d.fromQueue);
    await voteOn(d.fromQueue);
    expect(await draftIds(B)).not.toContain(d.fromQueue);
    expect(await draftIds(C, true)).not.toContain(d.fromQueue);
  });

  it("an admin sees it before a launch vote carries, and after it only by holding the power", async () => {
    const d = await draftFixtures("launch");
    try {
      // Before launch: the admin panel's door is the admin's, holding nothing.
      expect(await draftIds(C, true)).toContain(d.fromQueue);
      // Control in the same state: the same person without the account role sees none.
      expect(await draftIds(C)).toEqual([]);

      await recordLaunchCarried(pool, { ballotId: "bal-launch-wait", closedBy: B });

      // After launch an admin is not the decider by being an admin.
      expect(await draftIds(C, true)).toEqual([]);
      // Holding the power puts it back.
      h.state.deciders = [C];
      expect(await draftIds(C, true)).toContain(d.fromQueue);
      expect(await draftIds(C)).toContain(d.fromQueue);
    } finally {
      // The launch is this case's alone: the cases above it read a village that has not launched.
      await pool.query("DELETE FROM app_config WHERE config_key = 'launch-state'"); // module-review-ok: resets a fixture row on the scratch schema
    }
  });

  it("a tension raised with a role B holds waits on B, with its words and no raiser, and on nobody else", async () => {
    const roleId = await seat("Water keeper");
    await pool.query( // module-review-ok: a fixture seating on the scratch schema this suite provisioned
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) VALUES (?, ?, 'member', ?, ?)",
      [`ora-${roleId}`, roleId, B, B],
    );
    await insertTension(pool, { id: "rt-00000000000000aa", roleId, raisedBy: C, text: "The rota leaves Sundays empty.", now: new Date() });
    const b = await waitingFor(B);
    expect(b.raisedWithYou).toEqual([
      expect.objectContaining({ id: "rt-00000000000000aa", roleId, role: "Water keeper", circle: "Orchard Circle", text: "The rota leaves Sundays empty.", status: "open", overdue: false }),
    ]);
    expect(b.raw).not.toContain(C);
    expect((await waitingFor(A)).raisedWithYou).toEqual([]);
    expect((await waitingFor(C)).raisedWithYou).toEqual([]);
  });
});
