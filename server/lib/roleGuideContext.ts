/**
 * WHAT THE ROLE GUIDE STARTS FROM: what the village already knows about one
 * member's proposal, gathered once and named by role.
 *
 * Rye, 2026-10-24: the guide starts from the current card, the member's season
 * goals and what they have accomplished, the circle's charter, and the org's
 * goals for the season. Members are named by their ROLE titles, never by a
 * code name and never by their own name, so the guide's memory follows the
 * role when it changes hands. Every person's name in any text the guide reads
 * is swapped for the titles of the roles that person holds now, or "a member"
 * when they hold none (the name swap in server/lib/nameSwap.ts, with role
 * titles where the journal bridge puts code names).
 *
 * WHAT NEVER GOES IN. The proposal's terms (`settings`: pay, allowance, notice,
 * rhythm) are left out entirely, because the guide helps with words and the
 * season, and terms never cross to the outside service. So are other members'
 * drafts, contact details and anything from the journal.
 *
 * The four checks (shared/roleGuideChecks.ts) are worked out here too, from
 * the same chart reading, so the guide is handed them rather than asked to
 * find them.
 */
import type { Pool } from "mysql2/promise";
import { listOrgAssignments, listOrgRoles, type LapseContext, type OrgAssignment, type OrgRole } from "./orgChart";
import { accomplishmentsOf } from "./sessionTasks";
import { swapNames, SHARED_NAME_STAND_IN, type NamedMember } from "./nameSwap";
import { readCharterRow } from "../repos/circleCard";
import { villageCircles } from "../repos/roleProposals";
import { charterFromRow } from "@shared/circleCharter";
import { guideChecks, type ChartRoleIn, type CircleIn, type GuideFlag, type GuideRoleIn } from "@shared/roleGuideChecks";
import type { ProposalBody } from "@shared/roleProposals";

/** One role in the proposal, as the guide reads it. */
export interface GuideRole {
  /** `roles.0` or `newRoles.1`, the path the editor and the card text use. */
  key: string;
  name: string;
  circle: string | null;
  /** The posted words, for a role the member renews. Null for a new role. */
  posted: Record<string, unknown> | null;
  /** The words the member has written so far, over the posted ones. */
  words: Record<string, unknown>;
}

export interface GuideCircle {
  name: string;
  existsWhile: string | null;
  accountabilities: string[];
  domains: string[];
}

export interface RoleGuideContext {
  /** The member, by the titles of the roles they hold now. Empty when they hold none. */
  memberRoles: string[];
  roles: GuideRole[];
  circles: GuideCircle[];
  orgGoals: string[];
  season: { aim: string | null; seasonalGoals: string[] };
  /** What the member's accepted work says, newest moon first, at most `ACCOMPLISHED_MAX`. */
  accomplished: string[];
  checks: GuideFlag[];
  /** Swaps every member's name in a text for their role titles. */
  swap: (text: string) => string;
}

/** The most accomplished items the guide reads: enough to see the work, short enough to keep each call cheap. */
export const ACCOMPLISHED_MAX = 20;

const ROLE_WORD_KEYS = ["aim", "domain", "accountabilities", "authorities", "responsibilities", "timeCommitment"] as const;

/** Each member's role titles, from the live seatings. A lapsed seating is still held. PURE. */
export function roleTitlesByUser(assignments: readonly OrgAssignment[], roles: readonly OrgRole[]): Map<string, string[]> {
  const nameOf = new Map(roles.map((r) => [r.id, r.name]));
  const out = new Map<string, string[]>();
  for (const a of assignments) {
    if (a.holderKind !== "member" || !a.userId || a.endedAt) continue;
    const title = nameOf.get(a.orgRoleId);
    if (!title) continue;
    const list = out.get(a.userId) ?? [];
    if (!list.includes(title)) list.push(title);
    out.set(a.userId, list);
  }
  return out;
}

/** How a person reads in a sentence when they are named by role. PURE. */
export function personByRole(titles: readonly string[] | undefined): string {
  if (!titles || titles.length === 0) return SHARED_NAME_STAND_IN;
  const named = titles.map((t) => `the ${t}`);
  return named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** The name swap with role titles in place of names. PURE. */
export function roleNameSwap(roster: readonly NamedMember[], titles: ReadonlyMap<string, string[]>): (text: string) => string {
  const byRole = new Map(roster.map((m) => [m.id, personByRole(titles.get(m.id))]));
  return (text: string) => swapNames(text, roster, byRole);
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s ?? "").trim()).filter(Boolean) : typeof v === "string" ? v.split("\n").map((s) => s.trim()).filter(Boolean) : [];
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function postedWords(role: OrgRole): Record<string, unknown> {
  const r = role as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ROLE_WORD_KEYS) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

export interface ContextInput {
  userId: string;
  body: ProposalBody;
  /** The goals of the season the proposal is for. */
  orgGoals: readonly string[];
  lapse: LapseContext;
  /** Every member whose names the swap must know (`rosterOf` in server/lib/saberraOutbox.ts). */
  roster: readonly NamedMember[];
}

/** Everything the guide starts from, for one member's draft. */
export async function roleGuideContext(pool: Pool, input: ContextInput): Promise<RoleGuideContext> {
  const [roles, assignments, circles, accomplished] = await Promise.all([
    listOrgRoles(pool),
    listOrgAssignments(pool, input.lapse),
    villageCircles(pool),
    accomplishmentsOf(pool, input.userId, { lapseContext: () => input.lapse }),
  ]);
  const titles = roleTitlesByUser(assignments, roles);
  const swap = roleNameSwap(input.roster, titles);
  const live = roles.filter((r) => r.active && !r.isExample);
  const roleById = new Map(live.map((r) => [r.id, r]));
  const circleName = new Map(circles.filter((c) => c.live).map((c) => [c.id, c.name]));

  const guideRoles: GuideRole[] = [];
  const checkRoles: GuideRoleIn[] = [];
  input.body.roles.forEach((p, i) => {
    const posted = roleById.get(p.roleId);
    if (!posted) return;
    const words = { ...postedWords(posted), ...(p.words as Record<string, unknown>) };
    guideRoles.push({ key: `roles.${i}`, name: posted.name, circle: posted.circleId ? circleName.get(posted.circleId) ?? null : null, posted: postedWords(posted), words });
    checkRoles.push({ key: `roles.${i}`, name: text(words.name) || posted.name, circleId: posted.circleId, roleId: posted.id, domain: text(words.domain), accountabilities: list(words.accountabilities), time: text(words.timeCommitment) || null });
  });
  input.body.newRoles.forEach((n, i) => {
    const words = n.words as Record<string, unknown>;
    const name = text(words.name) || "A new role";
    guideRoles.push({ key: `newRoles.${i}`, name, circle: circleName.get(n.circleId) ?? null, posted: null, words: { ...words } });
    checkRoles.push({ key: `newRoles.${i}`, name, circleId: n.circleId, roleId: null, domain: text(words.domain), accountabilities: list(words.accountabilities), time: text(words.timeCommitment) || null });
  });

  const circleIds = Array.from(new Set(checkRoles.map((r) => r.circleId).filter((id): id is string => !!id)));
  const charters = await Promise.all(circleIds.map(async (id) => ({ id, charter: charterFromRow(await readCharterRow(pool, id)) })));
  const guideCircles: GuideCircle[] = charters.map(({ id, charter }) => ({
    name: circleName.get(id) ?? "",
    existsWhile: charter.existsWhile,
    accountabilities: charter.accountabilities ?? [],
    domains: charter.domains ?? [],
  }));
  const checkCircles: CircleIn[] = charters.map(({ id, charter }) => ({ id, name: circleName.get(id) ?? "", accountabilities: charter.accountabilities ?? [] }));
  const chart: ChartRoleIn[] = live.map((r) => ({ id: r.id, name: r.name, circleId: r.circleId, domain: r.domain ?? "", accountabilities: r.accountabilities }));

  const done = accomplished
    .slice()
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .flatMap((m) => m.items.map((it) => it.text.trim()).filter(Boolean))
    .slice(0, ACCOMPLISHED_MAX);

  return {
    memberRoles: titles.get(input.userId) ?? [],
    roles: guideRoles,
    circles: guideCircles,
    orgGoals: input.orgGoals.map((g) => g.trim()).filter(Boolean),
    season: { aim: input.body.season.aim, seasonalGoals: input.body.season.seasonalGoals.map((g) => (typeof g === "string" ? g : String((g as any)?.text ?? ""))).filter(Boolean) },
    accomplished: done.map(swap),
    checks: guideChecks({ roles: checkRoles, chart, circles: checkCircles }),
    swap,
  };
}
