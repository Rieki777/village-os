import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companionLine, isCompanionStep } from "./companionLine";
import { FIRST_DAYS } from "./roleStartWords";
import {
  PATH_FIRST_DAYS,
  PATH_KEYS,
  PATH_MILESTONES,
  PATH_RULES,
  PATH_STATES,
  PATH_WORDS,
  WHOLE_PATH_WORDS,
  companionStepFor,
  civilDay,
  freshOf,
  inFirstDays,
  sayPath,
  sayPathLine,
  tokenFacts,
  visitorFacts,
  walkedOf,
  yourPath,
  yourPathAll,
  type PathFacts,
  type PathState,
  type ProposalFacts,
  type SeatingFacts,
} from "./yourPath";

const NOW = new Date("2026-11-11T18:00:00Z");
const TZ = "America/Costa_Rica";

const account = (over: Partial<PathFacts> = {}): PathFacts => ({
  ...visitorFacts(NOW, TZ),
  person: { kind: "account", role: "user", founderPowerStands: false, proposals: [] },
  // A settled member: trained, a member, a quest done, no thanks left. Only `explore` matches.
  member: { trained: true, joining: null, claims: [{ status: "approved" }], budget: { remaining: 0, total: 100 } },
  commitment: "Love Letter",
  ...over,
});

const proposal = (over: Partial<ProposalFacts> = {}): ProposalFacts => ({
  ref: "p1",
  statusHref: "/application-status/p1?token=abc",
  status: "confirmed",
  step: "first_reply",
  by: "2026-11-16",
  withRole: null,
  termsToAnswer: false,
  invite: null,
  ownAccountAtAdoption: false,
  nextSeason: null,
  ...over,
});

const seating = (over: Partial<SeatingFacts> = {}): SeatingFacts => ({
  roleId: "r1",
  role: "Land Steward",
  startedOn: "2026-09-01",
  termEndsOn: "2026-12-08",
  warningOpen: false,
  lapsed: false,
  renewing: false,
  ...over,
});

const moon = { today: "2026-11-11", walkthroughDay: "2026-12-04", sendBy: "2026-12-07", recap: "none" as const, returnedNote: false };
const untrained = { trained: false, joining: "unsigned" as const, claims: [], budget: { remaining: 100, total: 100 } };
const withPerson = (p: Partial<Extract<PathFacts["person"], { kind: "account" }>>): PathFacts["person"] => ({ kind: "account", role: "user", founderPowerStands: false, proposals: [], ...p });

/** One case per rule: the least that matches it, on top of facts that would otherwise fall through. */
const CASES: Array<{ state: PathState; facts: PathFacts; step: string; after?: string | null; href: string | null }> = [
  { state: "founder-setup", facts: account({ person: withPerson({ role: "founder", founderPowerStands: true }) }), step: "Set up your village", href: "/setup-game" },
  { state: "leaving", facts: account({ exit: { status: "open" } }), step: "Your leaving is with us. Read how it goes", after: "We write to you when it is settled.", href: "/exit-policy" },
  { state: "session-live", facts: account({ sessionLive: { href: "/sessions/s1", circle: "Land" } }), step: "Join the Land session now", href: "/sessions/s1" },
  { state: "terms-to-answer", facts: tokenFacts(NOW, TZ, proposal({ termsToAnswer: true })), step: "Read the terms we changed and answer", href: "/application-status/p1?token=abc" },
  {
    state: "agreements",
    facts: account({ applications: [{ id: "a1", roles: ["Land Steward"], status: "adopted", steps: [{ step: "confidentiality", href: "/aligned" }, { step: "terms", href: "/role-applications/a1" }], firstDay: null }] }),
    step: "Align with the confidentiality agreement",
    after: "Your role as Land Steward starts once the last one is aligned.",
    href: "/profile#before-you-start",
  },
  {
    state: "held-for-seat",
    facts: account({ applications: [{ id: "a1", roles: ["Land Steward"], status: "held-full", steps: [], firstDay: null }] }),
    step: "Read the terms you agreed for Land Steward",
    after: "Every place in Land Steward is filled. Your role starts when one opens, and we tell you the day.",
    href: "/role-applications/a1",
  },
  {
    state: "start-day",
    facts: account({ applications: [{ id: "a1", roles: ["Land Steward"], status: "adopted", steps: [], firstDay: "2026-12-21" }] }),
    step: "Get to know Land Steward before it starts",
    after: "Your role starts on 21 December.",
    href: "/role-applications/a1",
  },
  { state: "invitation", facts: tokenFacts(NOW, TZ, proposal({ status: "adopted", step: null, invite: { until: "2026-11-25", used: false } })), step: "Make your account with the invitation in your email", after: "It works until 25 November.", href: null },
  { state: "invitation-ran-out", facts: tokenFacts(NOW, TZ, proposal({ status: "adopted", step: null, invite: { until: "2026-11-01", used: false } })), step: "Ask us for a new invitation", after: "We send a new one to the same address.", href: null },
  { state: "adopted-sign-in", facts: tokenFacts(NOW, TZ, proposal({ status: "adopted", step: null, ownAccountAtAdoption: true })), step: "Sign in to see your role", href: "/login?next=/profile" },
  { state: "recap-returned", facts: account({ seatings: [seating()], moon: { ...moon, recap: "returned" } }), step: "Your moon recap came back with a note", href: "/profile#my-moon" },
  { state: "recap-due", facts: account({ seatings: [seating()], moon: { ...moon, today: "2026-12-05" } }), step: "Send your moon recap", after: "Send it by Monday 7 December.", href: "/profile#my-moon" },
  { state: "term-ending", facts: account({ seatings: [seating({ warningOpen: true })] }), step: "Say whether you carry on as Land Steward", after: "Your term ends on 8 December.", href: "/season-plans/mine?renew=r1" },
  { state: "lapsed", facts: account({ seatings: [seating({ lapsed: true })] }), step: "Your term as Land Steward has ended. Say whether you carry on", href: "/season-plans/mine?renew=r1" },
  { state: "agent-term-ending", facts: account({ agentsKept: [seating({ warningOpen: true, agent: "Fern" })] }), step: "Say whether Fern carries on as Land Steward", after: "Your term ends on 8 December.", href: "/season-plans/mine?renew=r1" },
  {
    state: "first-days",
    facts: account({ onboarding: { title: "Our first 14 days", dueOn: "2026-11-25", next: { title: "Meet your buddy", dueOn: "2026-11-12" } } }),
    step: "Next in Our first 14 days: Meet your buddy",
    after: "Due on 12 November.",
    href: "/profile#onboarding",
  },
  { state: "task-due", facts: account({ tasksDue: { count: 1, nextDue: "2026-11-12" } }), step: "A task of yours is due tomorrow", href: "/profile#my-tasks" },
  { state: "in-review", facts: tokenFacts(NOW, TZ, proposal()), step: "While we read it, take a quest", after: "The role that welcomes people writes to you by 16 November.", href: "/quests" },
  { state: "declined", facts: tokenFacts(NOW, TZ, proposal({ status: "declined", step: null, nextSeason: { name: "Winter", opensOn: "2026-12-01" } })), step: "Stay close: take a quest", after: "You can propose again for Winter, from 1 December.", href: "/quests" },
  { state: "closed", facts: tokenFacts(NOW, TZ, proposal({ status: "expired", step: null })), step: "Look at the roles open now", href: "/roles" },
  { state: "propose-window", facts: account({ proposeWindow: { href: "/roles/select", closesOn: "2026-12-10" } }), step: "Propose your roles for next season", after: "The window closes on 10 December.", href: "/roles/select" },
  { state: "training", facts: account({ member: { ...untrained } }), step: "Finish your community training", href: "/training" },
  { state: "membership-waiting", facts: account({ member: { ...untrained, trained: true, joining: "waiting" } }), step: "Your Love Letter is with us. Take a quest while you wait", href: "/quests" },
  { state: "membership", facts: account({ member: { ...untrained, trained: true } }), step: "Sign the Love Letter", href: "/love-letter" },
  { state: "holder-moon", facts: account({ seatings: [seating()], moon }), step: "Add this moon's work to your recap", after: "We walk through it together on Friday 4 December.", href: "/profile#my-moon" },
  { state: "first-quest", facts: account({ member: { trained: true, joining: null, claims: [], budget: { remaining: 0, total: 100 } } }), step: "Take your first quest", href: "/quests" },
  { state: "finish-quest", facts: account({ member: { trained: true, joining: null, claims: [{ status: "claimed" }], budget: { remaining: 0, total: 100 } } }), step: "Turn in your quest", href: "/quests" },
  { state: "thank", facts: account({ member: { trained: true, joining: null, claims: [{ status: "approved" }], budget: { remaining: 40, total: 100 } } }), step: "Thank someone this cycle", href: "/gratitude" },
  { state: "lines", facts: account({ member: { trained: true, joining: null, claims: [{ status: "approved" }], budget: { remaining: 0, total: 100 }, geneKeysMissing: true } }), step: "Find your lines", href: "/profile/gene-keys" },
  { state: "unconfirmed", facts: visitorFacts(NOW, TZ, { email: "ana@example.org", sentAt: "2026-11-11T12:00:00Z" }), step: "Open the link we sent to ana@example.org", after: "It works until 13 November.", href: null },
  { state: "visitor", facts: visitorFacts(NOW, TZ), step: "Find where you belong", after: "Then tell us about you and the role, a few short questions.", href: "/roles" },
  { state: "explore", facts: account(), step: "Find your next quest", href: "/quests" },
];

describe("yourPath: one case per rule", () => {
  it("has a case for every state, in the rules' own order", () => {
    expect(CASES.map((c) => c.state)).toEqual([...PATH_STATES]);
    expect(PATH_RULES.map((r) => r.state)).toEqual([...PATH_STATES]);
  });

  for (const c of CASES) {
    it(`${c.state}: the least facts that match it`, () => {
      const a = yourPath(c.facts);
      expect(a.state).toBe(c.state);
      expect(a.step.href).toBe(c.href);
      const said = sayPath(a, "en");
      expect(said.step).toBe(c.step);
      if (c.after !== undefined) expect(said.after).toBe(c.after);
    });
  }
});

describe("yourPath: the higher rule wins", () => {
  /** Merge two cases' facts; the earlier rule must answer. Only pairs that share a kind of person can meet. */
  const merge = (hi: PathFacts, lo: PathFacts): PathFacts | null => {
    if (hi.person.kind !== lo.person.kind) return null;
    const def = hi.person.kind === "account" ? account() : visitorFacts(NOW, TZ);
    const out: Record<string, unknown> = { ...lo };
    for (const k of Object.keys(hi) as Array<keyof PathFacts>) {
      if (JSON.stringify(hi[k]) !== JSON.stringify(def[k])) out[k] = hi[k];
    }
    return out as unknown as PathFacts;
  };

  let pairs = 0;
  for (let i = 0; i + 1 < CASES.length; i++) {
    const hi = CASES[i];
    const lo = CASES[i + 1];
    // A seated holder is never asked to sign as a step, so these two cannot meet in one person; the named test below holds that.
    if (hi.state === "membership" && lo.state === "holder-moon") continue;
    const both = merge(hi.facts, lo.facts);
    if (!both) continue;
    pairs++;
    it(`${hi.state} is said before ${lo.state}`, () => {
      const all = yourPathAll(both).map((a) => a.state);
      expect(all[0]).toBe(hi.state);
    });
  }

  it("covers the adjacent pairs that can meet in one person", () => {
    expect(pairs).toBeGreaterThanOrEqual(20);
  });

  it("an adopted holder with agreements waiting is asked to align, never to train (STATE_MAP C1)", () => {
    const f = account({
      member: { ...untrained },
      applications: [{ id: "a1", roles: ["Lead Financial Steward"], status: "adopted", steps: [{ step: "membership", href: "/love-letter" }], firstDay: null }],
    });
    const a = yourPath(f);
    expect(a.state).toBe("agreements");
    expect(sayPath(a, "en").step).toBe("Align with the membership letter");
    expect(a.step.href).toBe("/love-letter");
  });

  it("CONTROL: with training put back on top, the same holder is told to train, so the order is what holds C1", () => {
    const f = account({
      member: { ...untrained },
      applications: [{ id: "a1", roles: ["Lead Financial Steward"], status: "adopted", steps: [{ step: "membership", href: "/love-letter" }], firstDay: null }],
    });
    const training = PATH_RULES.find((r) => r.state === "training")!;
    const broken = [training, ...PATH_RULES.filter((r) => r !== training)];
    expect(yourPath(f, broken).state).toBe("training");
  });

  it("a seated holder is never sent to training or to sign as a step", () => {
    for (const joining of ["waiting", "unsigned"] as const) {
      const f = account({ member: { ...untrained, joining }, seatings: [seating()], moon });
      expect(yourPath(f).state).toBe("holder-moon");
      expect(yourPathAll(f).map((a) => a.state)).not.toContain("training");
      expect(yourPathAll(f).map((a) => a.state)).not.toContain("membership");
    }
  });

  it("two applications: the earliest start day speaks, and a tie breaks by role name", () => {
    const app = (id: string, role: string, firstDay: string | null) => ({ id, roles: [role], status: "adopted" as const, steps: [{ step: "terms" as const, href: `/role-applications/${id}` }], firstDay });
    expect(yourPath(account({ applications: [app("a", "Water", "2026-12-21"), app("b", "Land", "2026-12-01")] })).step.href).toBe("/role-applications/b");
    expect(yourPath(account({ applications: [app("a", "Water", "2026-12-21"), app("b", "Land", "2026-12-21")] })).step.href).toBe("/role-applications/b");
  });

  it("the proposal window waits while the first days are open", () => {
    const f = account({ proposeWindow: { href: "/roles/select", closesOn: null }, onboarding: { title: "Our first days", dueOn: "2026-11-25", next: { title: "Meet your buddy", dueOn: "2026-11-12" } } });
    expect(yourPathAll(f).map((a) => a.state)).not.toContain("propose-window");
  });
});

describe("yourPath: words", () => {
  it("every key has an English and a Spanish sentence", () => {
    for (const lang of ["en", "es"] as const) {
      expect(Object.keys(PATH_WORDS[lang]).sort()).toEqual([...PATH_KEYS].sort());
      for (const k of PATH_KEYS) expect(PATH_WORDS[lang][k].trim().length, `${lang} ${k}`).toBeGreaterThan(0);
      for (const m of PATH_MILESTONES) expect(WHOLE_PATH_WORDS[lang].milestone[m].length).toBeGreaterThan(0);
    }
  });

  it("Spanish differs from English on every key, and uses the same variables", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of PATH_KEYS) {
      expect(PATH_WORDS.es[k], k).not.toBe(PATH_WORDS.en[k]);
      expect(vars(PATH_WORDS.es[k]), k).toBe(vars(PATH_WORDS.en[k]));
    }
  });

  it("says a case in Spanish", () => {
    const a = yourPath(CASES.find((c) => c.state === "start-day")!.facts);
    expect(sayPath(a, "es-CR")).toEqual({ step: "Conoce Land Steward antes de empezar", after: "Tu rol empieza el 21 de diciembre.", whose: "Te toca a ti" });
    const recap = yourPath(CASES.find((c) => c.state === "recap-due")!.facts);
    expect(sayPath(recap, "es").after).toBe("Envíalo a más tardar el lunes 7 de diciembre.");
  });

  it("no rendered sentence carries an hour, a dash, an ISO date or a brace, in either language", () => {
    for (const c of CASES) {
      for (const lang of ["en", "es"]) {
        const s = sayPath(yourPath(c.facts), lang);
        for (const text of [s.step, s.after ?? ""]) {
          expect(text, `${c.state} ${lang}`).not.toMatch(/\bhours?\b|\bhoras?\b/i);
          expect(text).not.toMatch(/[–—]/);
          expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
          expect(text).not.toMatch(/[{}]/);
          expect(text).not.toMatch(/rather than/i);
        }
      }
    }
  });

  it("a missing word for what members sign falls back, never a raw brace", () => {
    const f = { ...CASES.find((c) => c.state === "membership")!.facts, commitment: null };
    expect(sayPath(yourPath(f), "en").step).toBe("Sign the letter");
    expect(sayPath(yourPath(f), "es").step).toBe("Firma la carta");
  });

  it("a day is the village's civil day in three zones, never the UTC instant", () => {
    const late = new Date("2026-11-12T03:30:00Z");
    expect(civilDay(late, "America/Costa_Rica")).toBe("2026-11-11");
    expect(civilDay(late, "UTC")).toBe("2026-11-12");
    expect(civilDay(late, "Pacific/Auckland")).toBe("2026-11-12");
    expect(sayPathLine({ key: "path.startDay.after", vars: { day: "2026-12-21" } }, "en")).toBe("Your role starts on 21 December.");
    // The task is due "today" by the village's day, whatever the server's clock zone is.
    const f = account({ now: late, tasksDue: { count: 1, nextDue: "2026-11-11" } });
    expect(sayPath(yourPath(f), "en").step).toBe("A task of yours is due today");
    expect(sayPath(yourPath({ ...f, timeZone: "Pacific/Auckland", tasksDue: { count: 1, nextDue: "2026-11-15" } }), "en").step).toBe("A task of yours is due on 15 November");
  });
});

describe("yourPath: hrefs", () => {
  const app = readFileSync(resolve(__dirname, "../client/src/App.tsx"), "utf8");
  const routes = Array.from(app.matchAll(/<Route path="([^"]+)"/g)).map((m) => m[1]);
  const matches = (path: string) =>
    routes.some((r) => {
      const re = new RegExp(`^${r.replace(/:[^/]+\*?/g, "[^/]+").replace(/\//g, "\\/")}$`);
      return re.test(path);
    });

  it("every href a rule can produce is a route of the app", () => {
    expect(routes.length).toBeGreaterThan(50);
    for (const c of CASES) {
      const href = yourPath(c.facts).step.href;
      if (href === null) continue;
      expect(matches(href.split(/[?#]/)[0]), `${c.state} → ${href}`).toBe(true);
    }
    expect(matches("/path")).toBe(true);
  });

  it("the strip stays quiet on the step's own page", () => {
    expect(yourPath(account()).quietOn).toEqual(["/quests"]);
    expect(yourPath(CASES.find((c) => c.state === "term-ending")!.facts).quietOn).toEqual(["/season-plans/mine"]);
    expect(yourPath(CASES.find((c) => c.state === "invitation")!.facts).quietOn).toEqual([]);
  });
});

describe("yourPath: the walk and newness", () => {
  it("walked never shrinks as a person moves forward through the joining states", () => {
    const adoptedApp = (steps: Array<{ step: "terms"; href: string }>) => ({ id: "a1", roles: ["Land Steward"], status: "adopted" as const, steps, firstDay: null });
    const walk: PathFacts[] = [
      visitorFacts(NOW, TZ),
      visitorFacts(NOW, TZ, { email: "ana@example.org", sentAt: "2026-11-11T12:00:00Z" }),
      tokenFacts(NOW, TZ, proposal()),
      tokenFacts(NOW, TZ, proposal({ step: "interview", withRole: "Land Steward" })),
      tokenFacts(NOW, TZ, proposal({ step: "consent", by: null })),
      tokenFacts(NOW, TZ, proposal({ status: "adopted", step: null, invite: { until: "2026-11-25", used: false } })),
      account({ applications: [adoptedApp([{ step: "terms", href: "/role-applications/a1" }])] }),
      account({ applications: [adoptedApp([])] }),
      account({ seatings: [seating({ startedOn: "2026-11-11" })], moon }),
      account({ seatings: [seating({ startedOn: "2026-10-01" })], moon }),
      account({ seatings: [seating({ startedOn: "2026-10-01" })], moon: { ...moon, recap: "waiting" } }),
    ];
    let last = -1;
    for (const f of walk) {
      const n = walkedOf(f).length;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect(walkedOf(walk[walk.length - 1])).toEqual([...PATH_MILESTONES]);
    expect(walkedOf(walk[0])).toEqual([]);
  });

  it("first days are decided by the role's start day, with or without an onboarding path (verify B6)", () => {
    expect(PATH_FIRST_DAYS).toBe(FIRST_DAYS);
    expect(inFirstDays("2026-11-11", "2026-11-11")).toBe(true);
    expect(inFirstDays("2026-11-11", "2026-11-24")).toBe(true);
    expect(inFirstDays("2026-11-11", "2026-11-25")).toBe(false);
    expect(inFirstDays(null, "2026-11-25")).toBe(false);
    // No path at all, seated today: still new.
    expect(freshOf(account({ seatings: [seating({ startedOn: "2026-11-10" })], onboarding: null }))).toBe(true);
    // A path still open long after the start day does not keep somebody new.
    expect(freshOf(account({ seatings: [seating({ startedOn: "2026-08-01" })], onboarding: { title: "x", dueOn: "2026-12-01", next: { title: "y", dueOn: "2026-12-01" } } }))).toBe(false);
    expect(freshOf(account())).toBe(false);
    expect(freshOf(visitorFacts(NOW, TZ))).toBe(true);
    expect(yourPath(account({ applications: [{ id: "a", roles: ["R"], status: "adopted", steps: [], firstDay: null }] })).fresh).toBe(true);
  });

  it("the companion speaks only where it has a line for the path's step", () => {
    for (const s of PATH_STATES) {
      const step = companionStepFor(s);
      if (step !== null) expect(isCompanionStep(step), s).toBe(true);
    }
    expect(companionStepFor("agreements")).toBeNull();
    expect(companionLine({ step: companionStepFor("visitor"), visitor: true, locale: "es" })?.short).toBe("Empieza por los roles que te llaman.");
    expect(companionLine({ step: companionStepFor("agreements") })).toBeNull();
  });
});
