/**
 * THE ROLE PROPOSAL TEST HARNESS, for tests and for nothing else.
 *
 * One express app with the member door (server/routes/seatApplications.ts)
 * and the proposal routes (server/routes/roleProposals.ts) registered side by
 * side, the way server/index.ts registers them, so a submit writes a real
 * application through the real door and an adoption runs the real adopt
 * route. The suites drive it over loopback HTTP against the S5 scratch schema
 * they provision: server/routes/roleProposals.test.ts (PR A) and
 * server/routes/roleProposals.consent.test.ts (PR B).
 *
 * The seasons are dated from today, so "next season" is always next. The
 * people are named by role in the village, never as anybody real.
 */
import http from "node:http";
import express from "express";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import type { SeatCalendar } from "../../shared/seatTerms";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { register as registerProposals } from "../routes/roleProposals";
import { register as registerApplications } from "../routes/seatApplications";

export const LADDER = ["visitor", "guest", "member"];
export const DAY = 24 * 60 * 60 * 1000;
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The member who proposes, the holder who adopts, and another member who reads the link. */
export const OWNER = "u-one";
export const HOLDER = "u-two";
export const READER = "u-three";
export const PEOPLE: Record<string, { id: string; name: string }> = {
  [OWNER]: { id: OWNER, name: "Member One" },
  [HOLDER]: { id: HOLDER, name: "Member Two" },
  [READER]: { id: READER, name: "Member Three" },
  "u-guest": { id: "u-guest", name: "Guest Four" },
};

export const GOAL_FOOD = "Grow food for thirty people";
export const GOAL_TEAM = "Ready to grow the team to 30";

/** Dated from today, so "next season" is always next. */
export const NOW_STARTS = iso(Date.now() - 200 * DAY);
export const NEXT_STARTS = iso(Date.now() + 40 * DAY);
export const NEXT_ENDS = iso(Date.now() + 220 * DAY);
export const SEASONS = [
  { id: "s-now", name: "This season", startsOn: NOW_STARTS, endsOn: NEXT_STARTS, goals: [{ text: "Plant the beds" }] },
  { id: "s-next", name: "Next season", startsOn: NEXT_STARTS, endsOn: NEXT_ENDS, goals: [{ text: GOAL_FOOD }, { text: GOAL_TEAM }] },
];

/** Money in the terms, so there is something the public tier must not carry. XTS is the ISO code reserved for testing. */
export const MONEY_TERMS = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } };

/** The proposal routes' base. */
export const P = "/api/governance/role-proposals";

/** The permission role the adopting holder sits in, named the way the decision record names it. */
export const POWER_ROLE = { id: "role-founder", name: "Founder" };

/** The season today falls in, the latest that has begun and not ended, as `seasonState().current` reads it. */
export function runningSeason(seasons: readonly any[]): any | null {
  const today = iso(Date.now());
  const running = [...seasons]
    .filter((s) => s?.startsOn && s.startsOn <= today && (!s.endsOn || today < s.endsOn))
    .sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));
  return running.length ? running[running.length - 1] : null;
}

export function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    /**
     * Who holds `org.seat` live, through POWER_ROLE. The gate reads them the
     * way the server's does: the power is in their role's capabilities.
     */
    holders: [HOLDER] as string[],
    /** Accounts whose user role is `admin`: the gate's admin short-circuit, on a key the panel still holds. */
    admins: [] as string[],
    /** Accounts whose user role is `founder`: an admin to the gate, and named so in a decision. */
    founders: [] as string[],
    /** The powers this village has taken on (`capability_holding`). */
    villageHeld: [] as string[],
    /** The roles carrying `org.seat` (`rolesCarrying`). Empty is a fresh fork where no role carries it yet. */
    powerRoles: [POWER_ROLE] as Array<{ id: string; name: string }>,
    seasons: SEASONS as any[],
    governance: "public" as "public" | "members",
    sessionsOn: true,
    /** Buckets that answer "over the limit", by prefix. */
    limited: [] as string[],
    queries: 0,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const notices: any[] = [];
  const closers: Record<string, SubjectCloser> = {};
  let server: http.Server;
  let base = "";

  const viewerId = () => state.viewer?.id ?? "";
  const accountRole = () => (state.founders.includes(viewerId()) ? "founder" : state.admins.includes(viewerId()) ? "admin" : "member");
  const ctxOf = () =>
    ({
      stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
      stageIndexOf: (id: string) => LADDER.indexOf(id),
      roleCapabilities: state.holders.includes(viewerId()) ? ["org.seat"] : [],
      villageHeld: [...state.villageHeld],
      isAdmin: accountRole() !== "member",
      isFounder: accountRole() === "founder",
    }) as unknown as CapabilityCtx;
  // Identity freshly confirmed, so terms carrying money do not ask the re-confirm.
  const authedUser = async () =>
    state.viewer
      ? { ...(PEOPLE[state.viewer.id] ?? { id: state.viewer.id, name: "Someone" }), role: accountRole(), tokenVersion: 0, prefs: { identityConfirmedAt: { at: Date.now(), v: 0 } } }
      : null;
  const guardCapability = async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
    if (state.viewer && hasCapability(cap, ctxOf())) return true;
    res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
    return false;
  };
  const firstName = (n: string) => String(n ?? "").split(" ")[0] ?? "";
  const members = { byId: async (id: string) => PEOPLE[id] ?? null, all: async () => Object.values(PEOPLE) } as any;
  const overLimit = async (bucket: string) => state.limited.some((p) => bucket.startsWith(p));
  const notify = async (input: any) => {
    notices.push(input);
    return { fresh: true } as any;
  };
  const calendar = (): SeatCalendar => ({ seasons: state.seasons, currentSeasonId: "s-now", timezone: "UTC" });
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

  const start = async () => {
    const app = express();
    app.use(express.json());
    registerApplications(app, {
      authedUser,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: () => state.pool(),
      notify,
      notifyAdmins: async () => {},
      overLimit,
      members,
      firstName,
      liveHoldersOf: async () => [...state.holders],
      rolesCarrying: () => [...state.powerRoles],
      loadRoleHolders: () => state.holders.map((userId) => ({ roleId: POWER_ROLE.id, userId })),
      roleBallotSetup: async () => ({
        method: "majority",
        dials: { unityPct: 50, quorumPct: 0 },
        snapshot: { mode: "equal", token: null },
        tokenProblem: null,
        electorate: [OWNER, HOLDER, READER].map((userId) => ({ userId, weight: 1 })),
        durationDays: 7,
      }),
      seatCalendar: calendar,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      landingDeps: () => ({ pool: state.pool(), ...landing }) as unknown as LandingDeps,
      closers,
    } as any);
    registerProposals(app, {
      authedUser,
      isAdmin: async () => false,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: () => state.pool(),
      firstName,
      overLimit,
      notify,
      members,
      isPresent: () => true,
      // The running season the way server/index.ts reads it: the one today falls in.
      seasonState: () => ({ seasons: state.seasons, current: runningSeason(state.seasons), timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      mapLifecycle: () => "public",
      boolVar: () => false,
      villageName: () => "Test village",
      clock: () => LUNAR_CLOCK,
      governanceLifecycle: () => state.governance,
      sessionsOn: () => state.sessionsOn,
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
  /** A request with its own body and headers (a file upload), answered as the raw response (a text download). */
  const raw = (url: string, init: RequestInit = {}) => fetch(`${base}${url}`, init); // module-review-ok: this suite's own loopback server, not an outbound call
  const as = (id: string | null, stage = "member") => {
    state.viewer = id ? { id, stage } : null;
  };
  return { state, notices, start, stop, call, raw, as };
}
