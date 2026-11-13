/**
 * YOUR PATH: the one conductor for "what is my next step" (the Root, game feel
 * wave 2; the spec is docs/journey/STATE_MAP.md, section 6).
 *
 * One pure function answers, for one person at one moment, the ONE next step
 * and the dated "what comes after". The root strip under the header, the
 * profile's "Your path" card, the whole-path page and the status page all read
 * it, so no two surfaces can disagree. Nothing else computes a next step.
 *
 * PURE. No database, no clock (the caller passes `now` and `timeZone`), no
 * locale (words are keys). The server gathers the facts in
 * server/lib/pathFacts.ts; the status page builds them from what it was served.
 *
 * THE ORDER IS THE POLICY, first match wins. What a person must do for their
 * role to start comes before anything about the village at large, which is the
 * defect this file exists to end: a holder with agreements waiting used to be
 * told to finish the community training (STATE_MAP C1). The test holds the
 * order with a control that puts training back on top.
 *
 * `walked` is the person's own walk, one circle of the Seed of Life per
 * milestone. It is never totalled, compared, shown to anybody else or turned
 * into a bar.
 *
 * Spanish uses "tú". NEEDS A NATIVE EAR: written carefully, not yet read by a
 * native Costa Rican speaker.
 */
import type { StartStep } from "./roleStartWords";
import type { CompanionStep } from "./companionLine";

/**
 * How many days the first stretch of a role is. The same number as
 * `FIRST_DAYS` in shared/roleStartWords.ts, restated here so this file imports
 * types only: it rides the lazy chunk of the strip on every page, and a value
 * import would pull the seat-application words in behind it. The test holds
 * the two numbers equal.
 */
export const PATH_FIRST_DAYS = 14;
const FIRST_DAYS = PATH_FIRST_DAYS;

// ── Facts ────────────────────────────────────────────────────────────────────

/** A member's standing with the letter (server/lib/nextAction.ts `Joining`). */
export type PathJoining = "unsigned" | "waiting" | null;

/** The member-game facts the old rule already read (server/lib/nextAction.ts `NextActionFacts`). */
export interface MemberFacts {
  trained: boolean;
  joining: PathJoining;
  claims: ReadonlyArray<{ status?: unknown }>;
  budget: { remaining: number; total: number };
  geneKeysMissing?: boolean;
}

export type RecapStatus = "draft" | "waiting" | "returned" | "approved";

/** Opt-in memory on this device only: the address and the sent time, nothing else. */
export interface DeviceProposal {
  email: string;
  sentAt: string;
}

export interface ProposalFacts {
  ref: string;
  /** `/application-status/:ref`, with the token when it is a token read. */
  statusHref: string;
  status: "confirmed" | "adopted" | "declined" | "withdrawn" | "expired";
  /** The step the proposal stands on while confirmed. */
  step: "first_reply" | "interview" | "consent" | null;
  /** A civil day, YYYY-MM-DD. */
  by: string | null;
  /** The role holding the open conversation. */
  withRole: string | null;
  termsToAnswer: boolean;
  /** Adopted with no account: the invitation. */
  invite: { until: string; used: boolean } | null;
  ownAccountAtAdoption: boolean;
  nextSeason: { name: string; opensOn: string } | null;
}

export interface ApplicationFacts {
  id: string;
  roles: string[];
  status: "adopted" | "held-full";
  /** The agreements still waiting, in START_STEPS order. */
  steps: Array<{ step: StartStep; href: string }>;
  /** The civil day the role starts; null means as soon as nothing waits. */
  firstDay: string | null;
}

export interface SeatingFacts {
  roleId: string;
  role: string;
  /** The civil day this seating began. "First days" are counted from it. */
  startedOn: string | null;
  termEndsOn: string | null;
  /** The term-ending warning window is open. */
  warningOpen: boolean;
  lapsed: boolean;
  /** An adopted application already carries this role on. */
  renewing: boolean;
  /** For a kept agent's seating: the agent's name. */
  agent?: string;
}

export interface PathFacts {
  now: Date;
  /** The season document's zone. */
  timeZone: string;
  person:
    | { kind: "visitor"; deviceProposal: DeviceProposal | null }
    | { kind: "token"; proposal: ProposalFacts }
    | { kind: "account"; role: string; founderPowerStands: boolean; proposals: ProposalFacts[] };
  applications: ApplicationFacts[];
  seatings: SeatingFacts[];
  agentsKept: SeatingFacts[];
  onboarding: { title: string; dueOn: string; next: { title: string; dueOn: string } | null } | null;
  moon: { today: string; walkthroughDay: string; sendBy: string; recap: "none" | RecapStatus; returnedNote: boolean } | null;
  /** A room OPEN now, never the next meeting. */
  sessionLive: { href: string; circle: string } | null;
  /** Tasks due within two days. */
  tasksDue: { count: number; nextDue: string } | null;
  proposeWindow: { href: string; closesOn: string | null } | null;
  exit: { status: "open" | "settling" } | null;
  member: MemberFacts;
  /** The village's word for what members sign. */
  commitment?: string | null;
  /** True once any moon recap of this person's was sent. */
  recapEverSent?: boolean;
}

// ── Answer ───────────────────────────────────────────────────────────────────

export const PATH_STATES = [
  "founder-setup",
  "leaving",
  "session-live",
  "terms-to-answer",
  "agreements",
  "held-for-seat",
  "start-day",
  "invitation",
  "invitation-ran-out",
  "adopted-sign-in",
  "recap-returned",
  "recap-due",
  "term-ending",
  "lapsed",
  "agent-term-ending",
  "first-days",
  "task-due",
  "in-review",
  "declined",
  "closed",
  "propose-window",
  "training",
  "membership-waiting",
  "membership",
  "holder-moon",
  "first-quest",
  "finish-quest",
  "thank",
  "lines",
  "unconfirmed",
  "visitor",
  "explore",
] as const;
export type PathState = (typeof PATH_STATES)[number];

export const PATH_MILESTONES = ["proposed", "confirmed", "first_reply", "conversations", "adopted", "account", "agreements", "seated", "first_days", "first_recap"] as const;
export type PathMilestone = (typeof PATH_MILESTONES)[number];

export const PATH_KEYS = [
  "path.founderSetup.step",
  "path.leaving.step",
  "path.leaving.after",
  "path.sessionLive.step",
  "path.sessionLive.after",
  "path.termsToAnswer.step",
  "path.termsToAnswer.after",
  "path.agreements.confidentiality",
  "path.agreements.membership",
  "path.agreements.terms",
  "path.agreements.afterDay",
  "path.agreements.afterNow",
  "path.heldForSeat.step",
  "path.heldForSeat.after",
  "path.startDay.step",
  "path.startDay.after",
  "path.invitation.step",
  "path.invitation.after",
  "path.invitationRanOut.step",
  "path.invitationRanOut.after",
  "path.adoptedSignIn.step",
  "path.recapReturned.step",
  "path.recapDue.step",
  "path.recapDue.after",
  "path.termEnding.step",
  "path.termEnding.after",
  "path.lapsed.step",
  "path.lapsed.after",
  "path.agentTermEnding.step",
  "path.firstDays.step",
  "path.firstDays.after",
  "path.taskDue.step",
  "path.inReview.step",
  "path.inReview.firstReply",
  "path.inReview.interview",
  "path.inReview.consent",
  "path.inReview.consentNoDay",
  "path.declined.step",
  "path.declined.after",
  "path.closed.step",
  "path.proposeWindow.step",
  "path.proposeWindow.after",
  "path.training.step",
  "path.membershipWaiting.step",
  "path.membership.step",
  "path.holderMoon.step",
  "path.holderMoon.after",
  "path.firstQuest.step",
  "path.finishQuest.step",
  "path.thank.step",
  "path.lines.step",
  "path.unconfirmed.step",
  "path.unconfirmed.after",
  "path.visitor.step",
  "path.visitor.after",
  "path.explore.step",
] as const;
export type PathKey = (typeof PATH_KEYS)[number];

export interface PathLine {
  key: PathKey;
  vars: Record<string, string>;
}

export interface PathAnswer {
  /** Which rule matched. */
  state: PathState;
  whose: "yours" | "ours" | "nobody";
  step: PathLine & { href: string | null };
  /** A day is always in `vars.day`, a civil YYYY-MM-DD. */
  after: PathLine | null;
  /** The Seed of Life: one circle per milestone walked, in order. */
  walked: PathMilestone[];
  /** Paths where the strip stays quiet: the step's own page. */
  quietOn: string[];
  /**
   * The person is new to this part of the village: a visitor, an applicant, or
   * a holder in the first stretch after their role's start day. It warms the
   * companion's line and keeps stage and rank out of sight. It is never shown
   * to anybody else and nobody is labelled by it.
   */
  fresh: boolean;
}

// ── Days ─────────────────────────────────────────────────────────────────────

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})/;

/** Today as a civil day in the village's zone. */
export function civilDay(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** An instant as a civil day in a zone; null for no instant. */
export function civilDayOf(at: Date | string | null | undefined, timeZone: string): string | null {
  if (at == null || at === "") return null;
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : civilDay(d, timeZone);
}

const dayNumber = (day: string): number => {
  const m = CIVIL.exec(day);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : Number.NaN;
};

/** Whole days from `from` to `to`, both civil days. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** True while a seating that began on `startedOn` is inside its first stretch. Decided by the start day alone. */
export function inFirstDays(startedOn: string | null | undefined, today: string): boolean {
  if (!startedOn) return false;
  const n = daysBetween(startedOn, today);
  return Number.isFinite(n) && n >= 0 && n < FIRST_DAYS;
}

// ── The rules ────────────────────────────────────────────────────────────────

const byDayThenName = <T>(day: (x: T) => string | null, name: (x: T) => string) => (a: T, b: T): number => {
  const da = day(a) ?? "9999-12-31";
  const db = day(b) ?? "9999-12-31";
  return da === db ? name(a).localeCompare(name(b)) : da.localeCompare(db);
};

const first = <T>(list: readonly T[], sort: (a: T, b: T) => number): T | null => (list.length ? [...list].sort(sort)[0] : null);

const bare = (href: string): string => href.split(/[?#]/)[0] || "/";

interface Hit {
  state: PathState;
  whose: PathAnswer["whose"];
  step: PathLine & { href: string | null };
  after: PathLine | null;
}

const line = (key: PathKey, vars: Record<string, string> = {}): PathLine => ({ key, vars });
const stepOf = (key: PathKey, href: string | null, vars: Record<string, string> = {}): Hit["step"] => ({ key, href, vars });

const AGREEMENT_KEY: Record<StartStep, PathKey> = {
  confidentiality: "path.agreements.confidentiality",
  membership: "path.agreements.membership",
  terms: "path.agreements.terms",
};

/** Where the confidentiality agreement is aligned: inline, on the profile's own card. */
export const BEFORE_YOU_START_HREF = "/profile#before-you-start";
export const applicationPathHref = (id: string): string => `/role-applications/${encodeURIComponent(id)}`;
export const renewHref = (roleId: string): string => `/season-plans/mine?renew=${encodeURIComponent(roleId)}`;

type Rule = (f: PathFacts, today: string) => Hit | null;

const isAccount = (f: PathFacts): f is PathFacts & { person: { kind: "account" } } => f.person.kind === "account";
const proposalsOf = (f: PathFacts): ProposalFacts[] => (f.person.kind === "account" ? f.person.proposals : f.person.kind === "token" ? [f.person.proposal] : []);
const liveSeatings = (f: PathFacts): SeatingFacts[] => f.seatings.filter((s) => !s.lapsed);
const roleOf = (a: ApplicationFacts): string => a.roles[0] ?? "";
const commitmentOf = (f: PathFacts): string => (f.commitment ?? "").trim();

/**
 * The ordered rules. Exported so the test can prove the order matters: a
 * control moves `training` to the top and watches the agreements case fail.
 */
export const PATH_RULES: ReadonlyArray<{ state: PathState; rule: Rule }> = [
  {
    state: "founder-setup",
    rule: (f) =>
      isAccount(f) && f.person.founderPowerStands && (f.person.role === "founder" || f.person.role === "admin")
        ? { state: "founder-setup", whose: "yours", step: stepOf("path.founderSetup.step", "/setup-game"), after: null }
        : null,
  },
  {
    state: "leaving",
    rule: (f) => (isAccount(f) && f.exit ? { state: "leaving", whose: "ours", step: stepOf("path.leaving.step", "/exit-policy"), after: line("path.leaving.after") } : null),
  },
  {
    state: "session-live",
    rule: (f) =>
      isAccount(f) && f.sessionLive
        ? { state: "session-live", whose: "yours", step: stepOf("path.sessionLive.step", f.sessionLive.href, { circle: f.sessionLive.circle }), after: line("path.sessionLive.after") }
        : null,
  },
  {
    state: "terms-to-answer",
    rule: (f) => {
      const p = proposalsOf(f).find((x) => x.status === "confirmed" && x.termsToAnswer);
      return p ? { state: "terms-to-answer", whose: "yours", step: stepOf("path.termsToAnswer.step", p.statusHref), after: line("path.termsToAnswer.after") } : null;
    },
  },
  {
    state: "agreements",
    rule: (f, today) => {
      if (!isAccount(f)) return null;
      const a = first(
        f.applications.filter((x) => x.steps.length > 0),
        byDayThenName<ApplicationFacts>((x) => x.firstDay, roleOf),
      );
      if (!a) return null;
      const s = a.steps[0];
      const later = a.firstDay !== null && a.firstDay > today;
      return {
        state: "agreements",
        whose: "yours",
        step: stepOf(AGREEMENT_KEY[s.step], s.step === "confidentiality" ? BEFORE_YOU_START_HREF : s.href),
        after: later ? line("path.agreements.afterDay", { role: roleOf(a), day: a.firstDay! }) : line("path.agreements.afterNow", { role: roleOf(a) }),
      };
    },
  },
  {
    state: "held-for-seat",
    rule: (f) => {
      if (!isAccount(f)) return null;
      const a = first(
        f.applications.filter((x) => x.status === "held-full"),
        byDayThenName<ApplicationFacts>((x) => x.firstDay, roleOf),
      );
      return a ? { state: "held-for-seat", whose: "ours", step: stepOf("path.heldForSeat.step", applicationPathHref(a.id), { role: roleOf(a) }), after: line("path.heldForSeat.after", { role: roleOf(a) }) } : null;
    },
  },
  {
    state: "start-day",
    rule: (f, today) => {
      if (!isAccount(f)) return null;
      const a = first(
        f.applications.filter((x) => x.status === "adopted" && x.steps.length === 0 && x.firstDay !== null && x.firstDay > today),
        byDayThenName<ApplicationFacts>((x) => x.firstDay, roleOf),
      );
      return a ? { state: "start-day", whose: "yours", step: stepOf("path.startDay.step", applicationPathHref(a.id), { role: roleOf(a) }), after: line("path.startDay.after", { day: a.firstDay! }) } : null;
    },
  },
  {
    state: "invitation",
    rule: (f, today) => {
      if (f.person.kind !== "token") return null;
      const p = f.person.proposal;
      return p.status === "adopted" && !p.ownAccountAtAdoption && p.invite && !p.invite.used && p.invite.until >= today
        ? { state: "invitation", whose: "yours", step: stepOf("path.invitation.step", null), after: line("path.invitation.after", { day: p.invite.until }) }
        : null;
    },
  },
  {
    state: "invitation-ran-out",
    rule: (f, today) => {
      if (f.person.kind !== "token") return null;
      const p = f.person.proposal;
      // The ask door does not exist yet (STATE_MAP 6.7, item 1), so the step carries no href and the page says how to reach us.
      return p.status === "adopted" && !p.ownAccountAtAdoption && p.invite && !p.invite.used && p.invite.until < today
        ? { state: "invitation-ran-out", whose: "ours", step: stepOf("path.invitationRanOut.step", null), after: line("path.invitationRanOut.after") }
        : null;
    },
  },
  {
    state: "adopted-sign-in",
    rule: (f) => {
      if (f.person.kind !== "token") return null;
      const p = f.person.proposal;
      // An adoption the page knows no invitation for is answered the same way: the letter says how to come in.
      return p.status === "adopted" ? { state: "adopted-sign-in", whose: "yours", step: stepOf("path.adoptedSignIn.step", "/login?next=/profile"), after: null } : null;
    },
  },
  {
    state: "recap-returned",
    rule: (f) => (isAccount(f) && f.moon?.recap === "returned" ? { state: "recap-returned", whose: "yours", step: stepOf("path.recapReturned.step", "/profile#my-moon"), after: null } : null),
  },
  {
    state: "recap-due",
    rule: (f) => {
      if (!isAccount(f) || !f.moon || liveSeatings(f).length === 0) return null;
      const m = f.moon;
      return m.today >= m.walkthroughDay && m.today <= m.sendBy && (m.recap === "none" || m.recap === "draft")
        ? { state: "recap-due", whose: "yours", step: stepOf("path.recapDue.step", "/profile#my-moon"), after: line("path.recapDue.after", { day: m.sendBy }) }
        : null;
    },
  },
  {
    state: "term-ending",
    rule: (f) => {
      if (!isAccount(f)) return null;
      const s = first(
        f.seatings.filter((x) => x.warningOpen && !x.lapsed && !x.renewing),
        byDayThenName<SeatingFacts>((x) => x.termEndsOn, (x) => x.role),
      );
      return s
        ? { state: "term-ending", whose: "yours", step: stepOf("path.termEnding.step", renewHref(s.roleId), { role: s.role }), after: s.termEndsOn ? line("path.termEnding.after", { day: s.termEndsOn }) : null }
        : null;
    },
  },
  {
    state: "lapsed",
    rule: (f) => {
      if (!isAccount(f)) return null;
      const s = first(
        f.seatings.filter((x) => x.lapsed && !x.renewing),
        byDayThenName<SeatingFacts>((x) => x.termEndsOn, (x) => x.role),
      );
      return s ? { state: "lapsed", whose: "yours", step: stepOf("path.lapsed.step", renewHref(s.roleId), { role: s.role }), after: line("path.lapsed.after") } : null;
    },
  },
  {
    state: "agent-term-ending",
    rule: (f) => {
      if (!isAccount(f)) return null;
      const s = first(
        f.agentsKept.filter((x) => (x.warningOpen || x.lapsed) && !x.renewing),
        byDayThenName<SeatingFacts>((x) => x.termEndsOn, (x) => x.role),
      );
      return s
        ? {
            state: "agent-term-ending",
            whose: "yours",
            step: stepOf("path.agentTermEnding.step", renewHref(s.roleId), { agent: s.agent ?? "", role: s.role }),
            after: s.termEndsOn ? line("path.termEnding.after", { day: s.termEndsOn }) : null,
          }
        : null;
    },
  },
  {
    state: "first-days",
    rule: (f) =>
      isAccount(f) && f.onboarding?.next
        ? {
            state: "first-days",
            whose: "yours",
            step: stepOf("path.firstDays.step", "/profile#onboarding", { title: f.onboarding.title, item: f.onboarding.next.title }),
            after: line("path.firstDays.after", { day: f.onboarding.next.dueOn }),
          }
        : null,
  },
  {
    state: "task-due",
    rule: (f, today) => (isAccount(f) && f.tasksDue ? { state: "task-due", whose: "yours", step: stepOf("path.taskDue.step", "/profile#my-tasks", { day: f.tasksDue.nextDue, today }), after: null } : null),
  },
  {
    state: "in-review",
    rule: (f) => {
      const p = first(
        proposalsOf(f).filter((x) => x.status === "confirmed"),
        byDayThenName<ProposalFacts>((x) => x.by, (x) => x.ref),
      );
      if (!p) return null;
      const after =
        p.step === "first_reply" && p.by
          ? line("path.inReview.firstReply", { day: p.by })
          : p.step === "interview" && p.withRole
            ? line("path.inReview.interview", { withRole: p.withRole })
            : p.step === "consent" && p.by
              ? line("path.inReview.consent", { day: p.by })
              : p.step === "consent"
                ? line("path.inReview.consentNoDay")
                : null;
      return { state: "in-review", whose: "ours", step: stepOf("path.inReview.step", "/quests"), after };
    },
  },
  {
    state: "declined",
    rule: (f) => {
      if (f.person.kind !== "token" || f.person.proposal.status !== "declined") return null;
      const next = f.person.proposal.nextSeason;
      return { state: "declined", whose: "nobody", step: stepOf("path.declined.step", "/quests"), after: next ? line("path.declined.after", { season: next.name, day: next.opensOn }) : null };
    },
  },
  {
    state: "closed",
    rule: (f) =>
      f.person.kind === "token" && (f.person.proposal.status === "withdrawn" || f.person.proposal.status === "expired")
        ? { state: "closed", whose: "nobody", step: stepOf("path.closed.step", "/roles"), after: null }
        : null,
  },
  {
    state: "propose-window",
    rule: (f) =>
      isAccount(f) && f.proposeWindow && !f.onboarding?.next
        ? {
            state: "propose-window",
            whose: "yours",
            step: stepOf("path.proposeWindow.step", f.proposeWindow.href),
            after: f.proposeWindow.closesOn ? line("path.proposeWindow.after", { day: f.proposeWindow.closesOn }) : null,
          }
        : null,
  },
  {
    state: "training",
    rule: (f) => (isAccount(f) && !f.member.trained && liveSeatings(f).length === 0 ? { state: "training", whose: "yours", step: stepOf("path.training.step", "/training"), after: null } : null),
  },
  {
    state: "membership-waiting",
    rule: (f) =>
      isAccount(f) && f.member.joining === "waiting" && liveSeatings(f).length === 0
        ? { state: "membership-waiting", whose: "ours", step: stepOf("path.membershipWaiting.step", "/quests", { commitment: commitmentOf(f) }), after: null }
        : null,
  },
  {
    state: "membership",
    rule: (f) =>
      // A seated holder is never sent to sign as a step: for them the letter is an agreement before the role starts, or it is done.
      isAccount(f) && f.member.joining === "unsigned" && liveSeatings(f).length === 0 ? { state: "membership", whose: "yours", step: stepOf("path.membership.step", "/love-letter", { commitment: commitmentOf(f) }), after: null } : null,
  },
  {
    state: "holder-moon",
    rule: (f) =>
      isAccount(f) && f.moon && liveSeatings(f).length > 0
        ? { state: "holder-moon", whose: "yours", step: stepOf("path.holderMoon.step", "/profile#my-moon"), after: line("path.holderMoon.after", { day: f.moon.walkthroughDay }) }
        : null,
  },
  {
    state: "first-quest",
    rule: (f) => (isAccount(f) && f.member.claims.length === 0 ? { state: "first-quest", whose: "yours", step: stepOf("path.firstQuest.step", "/quests"), after: null } : null),
  },
  {
    state: "finish-quest",
    rule: (f) =>
      isAccount(f) && f.member.claims.some((c) => c.status === "claimed" || c.status === "submitted")
        ? { state: "finish-quest", whose: "yours", step: stepOf("path.finishQuest.step", "/quests"), after: null }
        : null,
  },
  {
    state: "thank",
    rule: (f) =>
      isAccount(f) && f.member.budget.remaining > 0 && f.member.budget.total > 0 ? { state: "thank", whose: "yours", step: stepOf("path.thank.step", "/gratitude"), after: null } : null,
  },
  {
    state: "lines",
    rule: (f) => (isAccount(f) && f.member.geneKeysMissing === true ? { state: "lines", whose: "yours", step: stepOf("path.lines.step", "/profile/gene-keys"), after: null } : null),
  },
  {
    state: "unconfirmed",
    rule: (f) => {
      if (f.person.kind !== "visitor" || !f.person.deviceProposal) return null;
      const sent = new Date(f.person.deviceProposal.sentAt);
      if (Number.isNaN(sent.getTime())) return null;
      const until = new Date(sent.getTime() + UNCONFIRMED_DAYS * 86_400_000);
      if (until.getTime() < f.now.getTime()) return null;
      return {
        state: "unconfirmed",
        whose: "yours",
        step: stepOf("path.unconfirmed.step", null, { email: f.person.deviceProposal.email }),
        after: line("path.unconfirmed.after", { day: civilDay(until, f.timeZone) }),
      };
    },
  },
  {
    state: "visitor",
    rule: (f) => (f.person.kind === "visitor" ? { state: "visitor", whose: "yours", step: stepOf("path.visitor.step", "/roles"), after: line("path.visitor.after") } : null),
  },
  {
    state: "explore",
    rule: () => ({ state: "explore", whose: "yours", step: stepOf("path.explore.step", "/quests"), after: null }),
  },
];

/** A sent proposal waits two days for its link to be opened (server/routes/openProposals.ts `tidyOpenProposals`). */
export const UNCONFIRMED_DAYS = 2;

/** The milestones this person has walked, in order. It only grows as a person moves forward. */
export function walkedOf(f: PathFacts): PathMilestone[] {
  const today = civilDay(f.now, f.timeZone);
  const has = new Set<PathMilestone>();
  const upTo = (m: PathMilestone) => {
    for (const x of PATH_MILESTONES) {
      has.add(x);
      if (x === m) return;
    }
  };
  for (const p of proposalsOf(f)) {
    if (p.status === "adopted") upTo("adopted");
    else {
      upTo("confirmed");
      if (p.step === "interview" || p.step === "consent") has.add("first_reply");
      if (p.step === "consent") has.add("conversations");
    }
  }
  if (f.person.kind === "visitor" && f.person.deviceProposal) has.add("proposed");
  if (isAccount(f)) {
    has.add("account");
    for (const a of f.applications) {
      upTo("account");
      if (a.status === "adopted" && a.steps.length === 0) has.add("agreements");
    }
    if (f.seatings.length > 0) {
      upTo("seated");
      const started = f.seatings.map((s) => s.startedOn).filter((d): d is string => !!d).sort()[0] ?? null;
      const pathDone = f.onboarding ? f.onboarding.next === null : !inFirstDays(started, today);
      if (pathDone) has.add("first_days");
      if (f.recapEverSent || (f.moon && f.moon.recap !== "none" && f.moon.recap !== "draft")) has.add("first_recap");
    }
  }
  return PATH_MILESTONES.filter((m) => has.has(m));
}

/** Whether this person is new to this part of the village. Decided by the role's start day, never by whether a path exists. */
export function freshOf(f: PathFacts): boolean {
  if (!isAccount(f)) return true;
  if (f.applications.length > 0) return true;
  const today = civilDay(f.now, f.timeZone);
  return f.seatings.some((s) => !s.lapsed && inFirstDays(s.startedOn, today));
}

function answer(f: PathFacts, hit: Hit, walked: PathMilestone[], fresh: boolean): PathAnswer {
  const quietOn = hit.step.href ? [bare(hit.step.href)] : [];
  return { state: hit.state, whose: hit.whose, step: hit.step, after: hit.after, walked, quietOn, fresh };
}

/** Every rule that matches, in order: the whole-path view. The first is the one next step. */
export function yourPathAll(f: PathFacts, rules: ReadonlyArray<{ state: PathState; rule: Rule }> = PATH_RULES): PathAnswer[] {
  const today = civilDay(f.now, f.timeZone);
  const walked = walkedOf(f);
  const fresh = freshOf(f);
  const out: PathAnswer[] = [];
  for (const r of rules) {
    const hit = r.rule(f, today);
    if (hit) out.push(answer(f, hit, walked, fresh));
  }
  return out;
}

/** The ONE next step. The last rule always matches, so there is always an answer. */
export function yourPath(f: PathFacts, rules: ReadonlyArray<{ state: PathState; rule: Rule }> = PATH_RULES): PathAnswer {
  return yourPathAll(f, rules)[0];
}

/** The facts of somebody with no account, for the strip a visitor sees. */
export function visitorFacts(now: Date, timeZone: string, deviceProposal: DeviceProposal | null = null): PathFacts {
  return {
    now,
    timeZone,
    person: { kind: "visitor", deviceProposal },
    applications: [],
    seatings: [],
    agentsKept: [],
    onboarding: null,
    moon: null,
    sessionLive: null,
    tasksDue: null,
    proposeWindow: null,
    exit: null,
    member: { trained: false, joining: null, claims: [], budget: { remaining: 0, total: 0 } },
  };
}

/** The facts of one proposal read by its emailed link: the status page. */
export function tokenFacts(now: Date, timeZone: string, proposal: ProposalFacts): PathFacts {
  return { ...visitorFacts(now, timeZone), person: { kind: "token", proposal } };
}

// ── The companion ────────────────────────────────────────────────────────────

/**
 * The companion's key for a path state (shared/companionLine.ts). A state the
 * companion has no line for stays quiet: a guide that improvises a step is
 * worse than a silent one.
 */
const COMPANION: Partial<Record<PathState, CompanionStep>> = {
  "founder-setup": "founder-setup",
  visitor: "find-role",
  unconfirmed: "check-email",
  "in-review": "proposal-waiting",
  training: "training",
  membership: "membership",
  "membership-waiting": "membership-waiting",
  "first-days": "first-days",
  "first-quest": "first-quest",
  "finish-quest": "finish-quest",
  thank: "send-gratitude",
  lines: "gene-keys",
  explore: "explore",
};

export const companionStepFor = (state: PathState): CompanionStep | null => COMPANION[state] ?? null;

// ── Words ────────────────────────────────────────────────────────────────────

export const PATH_LANGUAGES = ["en", "es"] as const;
export type PathLanguage = (typeof PATH_LANGUAGES)[number];

/** "es", "es-CR" read as Spanish; anything else reads as English. */
export function pathLanguage(locale: unknown): PathLanguage {
  const tag = typeof locale === "string" ? locale.trim().toLowerCase().split(/[-_]/)[0] : "";
  return tag === "es" ? "es" : "en";
}

/** Keyed by the union, so a key without Spanish fails the typecheck. */
type PathTable = Record<PathKey, string>;

const EN: PathTable = {
  "path.founderSetup.step": "Set up your village",
  "path.leaving.step": "Your leaving is with us. Read how it goes",
  "path.leaving.after": "We'll write to you when it is settled.",
  "path.sessionLive.step": "Join the {circle} session now",
  "path.sessionLive.after": "What you carry out of the room lands on your task board.",
  "path.termsToAnswer.step": "Read the terms we changed and answer",
  "path.termsToAnswer.after": "We'll read your answer, then adopt or talk again.",
  "path.agreements.confidentiality": "Align with the confidentiality agreement",
  "path.agreements.membership": "Align with the membership letter",
  "path.agreements.terms": "Align with your role's terms",
  "path.agreements.afterDay": "Your role as {role} starts on {day}.",
  "path.agreements.afterNow": "Your role as {role} starts once the last one is aligned.",
  "path.heldForSeat.step": "Read the terms you agreed for {role}",
  "path.heldForSeat.after": "Every place in {role} is filled. Your role starts when one opens, and we tell you the day.",
  "path.startDay.step": "Get to know {role} before it starts",
  "path.startDay.after": "Your role starts on {day}.",
  "path.invitation.step": "Make your account with the invitation in your email",
  "path.invitation.after": "It works until {day}.",
  "path.invitationRanOut.step": "Ask us for a new invitation",
  "path.invitationRanOut.after": "We send a new one to the same address.",
  "path.adoptedSignIn.step": "Sign in to see your role",
  "path.recapReturned.step": "Your moon recap came back with a note",
  "path.recapDue.step": "Send your moon recap",
  "path.recapDue.after": "Send it by {weekday} {day}.",
  "path.termEnding.step": "Say whether you carry on as {role}",
  "path.termEnding.after": "Your term ends on {day}.",
  "path.lapsed.step": "Your term as {role} has ended. Say whether you carry on",
  "path.lapsed.after": "The village can seat you again for another term.",
  "path.agentTermEnding.step": "Say whether {agent} carries on as {role}",
  "path.firstDays.step": "Next in {title}: {item}",
  "path.firstDays.after": "Due on {day}.",
  "path.taskDue.step": "A task of yours is due {dayWords}",
  "path.inReview.step": "While we read it, take a quest",
  "path.inReview.firstReply": "The role that welcomes people writes to you by {day}.",
  "path.inReview.interview": "Your conversation with {withRole} is next. We arrange a time with you.",
  "path.inReview.consent": "The circle answers by {day}.",
  "path.inReview.consentNoDay": "The circle answers next.",
  "path.declined.step": "Stay close: take a quest",
  "path.declined.after": "You can propose again for {season}, from {day}.",
  "path.closed.step": "Look at the roles open now",
  "path.proposeWindow.step": "Propose your roles for next season",
  "path.proposeWindow.after": "The window closes on {day}.",
  "path.training.step": "Finish your community training",
  "path.membershipWaiting.step": "Your {commitment} is with us. Take a quest while you wait",
  "path.membership.step": "Sign the {commitment}",
  "path.holderMoon.step": "Add this moon's work to your recap",
  "path.holderMoon.after": "We walk through it together on {weekday} {day}.",
  "path.firstQuest.step": "Take your first quest",
  "path.finishQuest.step": "Turn in your quest",
  "path.thank.step": "Thank someone this cycle",
  "path.lines.step": "Find your lines",
  "path.unconfirmed.step": "Open the link we sent to {email}",
  "path.unconfirmed.after": "It works until {day}.",
  "path.visitor.step": "Find where you belong",
  "path.visitor.after": "Then tell us about you and the role, a few short questions.",
  "path.explore.step": "Find your next quest",
};

const ES: PathTable = {
  "path.founderSetup.step": "Prepara tu aldea",
  "path.leaving.step": "Tu salida está con nosotros. Lee cómo sigue",
  "path.leaving.after": "Te escribiremos cuando quede resuelta.", // needs-native-review: new words, 12 Nov 2026
  "path.sessionLive.step": "Únete ahora a la sesión de {circle}",
  "path.sessionLive.after": "Lo que te llevas de la sala queda en tu tablero de tareas.",
  "path.termsToAnswer.step": "Lee los términos que cambiamos y responde",
  "path.termsToAnswer.after": "Leeremos tu respuesta y luego adoptamos o volvemos a conversar.", // needs-native-review: new words, 12 Nov 2026
  "path.agreements.confidentiality": "Alinéate con el acuerdo de confidencialidad",
  "path.agreements.membership": "Alinéate con la carta de membresía",
  "path.agreements.terms": "Alinéate con los términos de tu rol",
  "path.agreements.afterDay": "Tu rol de {role} empieza el {day}.",
  "path.agreements.afterNow": "Tu rol de {role} empieza cuando te alinees con el último.",
  "path.heldForSeat.step": "Lee los términos que acordaste para {role}",
  "path.heldForSeat.after": "Todos los lugares de {role} están ocupados. Tu rol empieza cuando se abra uno, y te avisamos el día.",
  "path.startDay.step": "Conoce {role} antes de empezar",
  "path.startDay.after": "Tu rol empieza el {day}.",
  "path.invitation.step": "Crea tu cuenta con la invitación de tu correo",
  "path.invitation.after": "Funciona hasta el {day}.",
  "path.invitationRanOut.step": "Pídenos una invitación nueva",
  "path.invitationRanOut.after": "Te enviamos una nueva a la misma dirección.",
  "path.adoptedSignIn.step": "Inicia sesión para ver tu rol",
  "path.recapReturned.step": "Tu resumen de la luna volvió con una nota",
  "path.recapDue.step": "Envía tu resumen de la luna",
  "path.recapDue.after": "Envíalo a más tardar el {weekday} {day}.",
  "path.termEnding.step": "Dinos si sigues como {role}",
  "path.termEnding.after": "Tu periodo termina el {day}.",
  "path.lapsed.step": "Tu periodo como {role} terminó. Dinos si sigues",
  "path.lapsed.after": "La aldea puede darte el rol otra vez por otro periodo.",
  "path.agentTermEnding.step": "Dinos si {agent} sigue como {role}",
  "path.firstDays.step": "Lo siguiente en {title}: {item}",
  "path.firstDays.after": "Para el {day}.",
  "path.taskDue.step": "Tienes una tarea para {dayWords}",
  "path.inReview.step": "Mientras la leemos, toma una misión",
  "path.inReview.firstReply": "El rol que da la bienvenida te escribe a más tardar el {day}.",
  "path.inReview.interview": "Lo que sigue es tu conversación con {withRole}. Acordamos contigo un momento.",
  "path.inReview.consent": "El círculo responde a más tardar el {day}.",
  "path.inReview.consentNoDay": "Lo que sigue es la respuesta del círculo.",
  "path.declined.step": "Quédate cerca: toma una misión",
  "path.declined.after": "Puedes proponer de nuevo para {season}, desde el {day}.",
  "path.closed.step": "Mira los roles abiertos ahora",
  "path.proposeWindow.step": "Propón tus roles para la próxima temporada",
  "path.proposeWindow.after": "El plazo cierra el {day}.",
  "path.training.step": "Termina tu formación comunitaria",
  "path.membershipWaiting.step": "Tu {commitment} está con nosotros. Toma una misión mientras esperas",
  "path.membership.step": "Firma la {commitment}",
  "path.holderMoon.step": "Agrega el trabajo de esta luna a tu resumen",
  "path.holderMoon.after": "Lo repasamos juntos el {weekday} {day}.",
  "path.firstQuest.step": "Toma tu primera misión",
  "path.finishQuest.step": "Entrega tu misión",
  "path.thank.step": "Agradece a alguien en este ciclo",
  "path.lines.step": "Encuentra tus líneas",
  "path.unconfirmed.step": "Abre el enlace que enviamos a {email}",
  "path.unconfirmed.after": "Funciona hasta el {day}.",
  "path.visitor.step": "Encuentra tu lugar",
  "path.visitor.after": "Después cuéntanos de ti y del rol, en unas pocas preguntas cortas.",
  "path.explore.step": "Encuentra tu próxima misión",
};

export const PATH_WORDS: Readonly<Record<PathLanguage, PathTable>> = { en: EN, es: ES };

/** What each milestone is called on the whole-path page, and the chapter it sits in. */
export const PATH_CHAPTERS = ["arriving", "welcomed", "root", "moon"] as const;
export type PathChapter = (typeof PATH_CHAPTERS)[number];

export const MILESTONE_CHAPTER: Record<PathMilestone, PathChapter> = {
  proposed: "arriving",
  confirmed: "arriving",
  first_reply: "welcomed",
  conversations: "welcomed",
  adopted: "welcomed",
  account: "root",
  agreements: "root",
  seated: "root",
  first_days: "moon",
  first_recap: "moon",
};

interface WholePathWords {
  chapter: Record<PathChapter, string>;
  milestone: Record<PathMilestone, string>;
  whose: Record<PathAnswer["whose"], string>;
  today: string;
  tomorrow: string;
  on: (day: string) => string;
  defaultCommitment: string;
}

export const WHOLE_PATH_WORDS: Readonly<Record<PathLanguage, WholePathWords>> = {
  en: {
    chapter: { arriving: "Arriving", welcomed: "Being welcomed", root: "Taking root", moon: "Your first moon" },
    milestone: {
      proposed: "You sent your proposal",
      confirmed: "You confirmed it was you",
      first_reply: "We wrote back",
      conversations: "We talked together",
      adopted: "The circle said yes",
      account: "You made your account",
      agreements: "You aligned with what we agreed",
      seated: "Your role took root",
      first_days: "Our first days together",
      first_recap: "Your first moon recap",
    },
    whose: { yours: "Your move", ours: "Our move", nobody: "Nobody's move" },
    today: "today",
    tomorrow: "tomorrow",
    on: (day) => `on ${day}`,
    defaultCommitment: "letter",
  },
  es: {
    chapter: { arriving: "La llegada", welcomed: "La bienvenida", root: "Echar raíz", moon: "Tu primera luna" },
    milestone: {
      proposed: "Enviaste tu propuesta",
      confirmed: "Confirmaste que eras tú",
      first_reply: "Te respondimos",
      conversations: "Conversamos",
      adopted: "El círculo dijo que sí",
      account: "Creaste tu cuenta",
      agreements: "Te alineaste con lo que acordamos",
      seated: "Tu rol echó raíz",
      first_days: "Nuestros primeros días",
      first_recap: "Tu primer resumen de la luna",
    },
    whose: { yours: "Te toca a ti", ours: "Nos toca a nosotros", nobody: "No le toca a nadie" },
    today: "hoy",
    tomorrow: "mañana",
    on: (day) => `el ${day}`,
    defaultCommitment: "carta",
  },
};

const LOCALE: Record<PathLanguage, string> = { en: "en-GB", es: "es" };

/** A civil day in words: "16 November", "16 de noviembre". Never an instant, never ISO. */
export function dayInWords(day: string, lang: PathLanguage): string {
  const m = CIVIL.exec(String(day ?? "").trim());
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The weekday of a civil day: "Monday", "lunes". */
export function weekdayInWords(day: string, lang: PathLanguage): string {
  const m = CIVIL.exec(String(day ?? "").trim());
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(LOCALE[lang], { weekday: "long", timeZone: "UTC" });
}

/** One line in words. A var the sentence does not use is ignored; a brace never reaches the page. */
export function sayPathLine(l: PathLine, locale: unknown): string {
  const lang = pathLanguage(locale);
  const w = WHOLE_PATH_WORDS[lang];
  const v: Record<string, string> = { ...l.vars };
  const day = v.day;
  if (day) {
    v.weekday = weekdayInWords(day, lang);
    const gap = v.today ? daysBetween(v.today, day) : Number.NaN;
    v.dayWords = gap <= 0 ? w.today : gap === 1 ? w.tomorrow : w.on(dayInWords(day, lang));
    v.day = dayInWords(day, lang);
  }
  if (!v.commitment) v.commitment = w.defaultCommitment;
  return PATH_WORDS[lang][l.key].replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "").replace(/\s{2,}/g, " ").trim();
}

export interface SaidPath {
  step: string;
  after: string | null;
  whose: string;
}

/** The answer in the reader's language: the step, what comes after, and whose move it is. */
export function sayPath(a: PathAnswer, locale: unknown): SaidPath {
  return { step: sayPathLine(a.step, locale), after: a.after ? sayPathLine(a.after, locale) : null, whose: WHOLE_PATH_WORDS[pathLanguage(locale)].whose[a.whose] };
}
