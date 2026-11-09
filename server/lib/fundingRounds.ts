/**
 * Funding rounds: the village chooses which proposed quests to fund within a
 * pot (Rye, 2026-11-06). This file holds the rules; server/repos/fundingRounds.ts
 * holds the SQL; server/routes/fundingRounds.ts holds the doors.
 *
 * WHAT IS BUILT HERE (S2). Pots, rounds and the seed stage: a member posts a
 * rough idea, named or anonymous by their own tick, and each idea opens its
 * own forum discussion thread so every idea exists in the standard format.
 * Grow, choose and harvest are derived stages already (shared/fundingRounds.ts)
 * and their doors arrive in the next slice; a round whose grow date is unset
 * stays in seed, which is how a village runs seed only for a season.
 *
 * ANONYMITY. The author is always stored, for erasure and abuse handling, and
 * never leaves the server when the idea is anonymous: every view below is
 * built through `bylineOf`. An anonymous idea's forum thread is posted under
 * the account that opened the round, with a line saying so, because a thread
 * must have an author and the real one may not be shown.
 *
 * THE INTERACTION RECORD. Every member act here writes one row through
 * `recordInteraction`, references only. Acts on an anonymous idea by its
 * author are private rows.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  ANONYMOUS_BYLINE, ANONYMOUS_MIN_MEMBERS, acceptsIdeas, datesProblem, parseIdea, stageAt,
  type Byline, type IdeaStatus, type PotClock, type RoundStage,
} from "../../shared/fundingRounds";
import { LIFECYCLE_RANK, MODULES_BY_ID } from "../../shared/modules";
import { firstNameOf } from "./peopleLock";
import { effectiveLifecycle, moduleConfig } from "./modules";
import {
  forgetMember, ideaById, ideasByAuthor, ideasOfRound, insertIdea, insertIdeaThread, insertInteraction, insertPot, insertRound,
  interactionCountsFor, interactionsOf, listPots, listRounds, liveIdeasOf, openRoundCount, potById, receivedOf, roundById,
  setIdeaThread, updateRoundDates, type IdeaRow, type InteractionInput, type PotRow, type RoundRow,
} from "../repos/fundingRounds";

export const MODULE_ID = "funding-rounds";

const newId = (prefix: string): string => `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

// ── the interaction record ──────────────────────────────────────────────────

/** Write one interaction. Never throws into the act it records. */
export async function recordInteraction(pool: Pool, e: Omit<InteractionInput, "channel"> & { channel?: InteractionInput["channel"] }): Promise<void> {
  try {
    await insertInteraction(pool, { channel: "web", ...e });
  } catch (err) {
    console.error("[funding-rounds] an interaction was not recorded:", err);
  }
}

// ── pots ────────────────────────────────────────────────────────────────────

export interface PotView {
  id: string;
  name: string;
  purpose: string | null;
  unitKind: "currency" | "token";
  unit: string;
  clock: PotClock;
  decider: "power" | "people";
  holderRoleId: string | null;
  circleId: string | null;
  homeStructureKey: string | null;
  status: PotRow["status"];
  /** Received minus paid. */
  balanceMinor: number;
  /** Held plus owed earmarks. None exist before the harvest slice. */
  earmarkedMinor: number;
  freeMinor: number;
}

export async function potView(pool: Pool, p: PotRow): Promise<PotView> {
  const received = await receivedOf(pool, p.id);
  return {
    id: p.id,
    name: p.name,
    purpose: p.purpose,
    unitKind: p.unitKind,
    unit: p.unitCode,
    clock: p.clock,
    decider: p.decider,
    holderRoleId: p.holderRoleId,
    circleId: p.circleId,
    homeStructureKey: p.structureKey,
    status: p.status,
    balanceMinor: received,
    earmarkedMinor: 0,
    freeMinor: received,
  };
}

const UNIT_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

export async function createPot(pool: Pool, actorId: string, body: unknown): Promise<{ ok: true; pot: PotView } | { ok: false; problem: string }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
  if (!name) return { ok: false, problem: "Give the pot a name." };
  const unitKind = b.unitKind === "token" ? "token" : "currency";
  const unitCode = typeof b.unitCode === "string" ? b.unitCode.trim() : "";
  if (!UNIT_CODE.test(unitCode)) return { ok: false, problem: "Name the pot's unit: a currency code such as CRC, or a token id." };
  if (unitKind === "currency" && !/^[A-Z]{3}$/.test(unitCode)) return { ok: false, problem: "A currency is three capital letters, such as CRC." };
  const clock: PotClock = b.clock === "lunar" || b.clock === "fixed" ? b.clock : "seasonal";
  const opt = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const id = newId("pot");
  await insertPot(pool, {
    id,
    name,
    purpose: opt(b.purpose, 4000),
    unitKind,
    unitCode,
    holderRoleId: opt(b.holderRoleId, 64),
    circleId: opt(b.circleId, 64),
    structureKey: opt(b.structureKey, 128),
    clock,
    createdBy: actorId,
  });
  const pot = await potById(pool, id);
  return { ok: true, pot: await potView(pool, pot as PotRow) };
}

// ── rounds ──────────────────────────────────────────────────────────────────

export interface RoundView {
  id: string;
  potId: string;
  title: string;
  stage: RoundStage;
  acceptsIdeas: boolean;
  seedAt: string;
  growAt: string | null;
  chooseAt: string | null;
  harvestAt: string | null;
  /** When the current stage ends, or null when no later date is set. */
  stageEndsAt: string | null;
  offeredMinor: number | null;
  ideasPerMember: number;
  /** True when the anonymous tick is offered: allowed by the round and the village is big enough. */
  anonymousOffered: boolean;
  ideaCount: number;
}

const isoOf = (d: Date | null): string | null => (d ? d.toISOString() : null);

function datesOf(r: RoundRow) {
  return { seedAt: r.seedAt, growAt: r.growAt, chooseAt: r.chooseAt, harvestAt: r.harvestAt, closedAt: r.closedAt };
}

export function roundView(r: RoundRow, now: Date, memberCount: number, ideaCount: number): RoundView {
  const stage = stageAt(datesOf(r), now);
  const next: Record<RoundStage, Date | null> = { seed: r.growAt, grow: r.chooseAt, choose: r.harvestAt, harvest: r.closedAt, closed: null };
  return {
    id: r.id,
    potId: r.potId,
    title: r.title,
    stage,
    acceptsIdeas: acceptsIdeas(datesOf(r), now),
    seedAt: r.seedAt.toISOString(),
    growAt: isoOf(r.growAt),
    chooseAt: isoOf(r.chooseAt),
    harvestAt: isoOf(r.harvestAt),
    stageEndsAt: isoOf(next[stage]),
    offeredMinor: r.offeredMinor,
    ideasPerMember: r.ideasPerMember,
    anonymousOffered: r.anonymousAllowed && memberCount >= ANONYMOUS_MIN_MEMBERS,
    ideaCount,
  };
}

const dateOrNull = (v: unknown): Date | null | "bad" => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : "bad";
};

export async function openRound(pool: Pool, actorId: string, potId: string, body: unknown): Promise<{ ok: true; round: RoundRow } | { ok: false; status: number; problem: string }> {
  const pot = await potById(pool, potId);
  if (!pot) return { ok: false, status: 404, problem: "No such pot." };
  if (pot.status !== "open") return { ok: false, status: 409, problem: "This pot is not open." };
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 160) : "";
  if (!title) return { ok: false, status: 400, problem: "Give the round a name, such as the season it funds." };
  const seed = dateOrNull(b.seedAt ?? new Date().toISOString());
  const grow = dateOrNull(b.growAt);
  const choose = dateOrNull(b.chooseAt);
  const harvest = dateOrNull(b.harvestAt);
  if (seed === "bad" || grow === "bad" || choose === "bad" || harvest === "bad" || seed === null) {
    return { ok: false, status: 400, problem: "A date could not be read." };
  }
  const problem = datesProblem({ seedAt: seed, growAt: grow, chooseAt: choose, harvestAt: harvest, closedAt: null });
  if (problem) return { ok: false, status: 400, problem };
  const offered = b.offeredMinor == null || b.offeredMinor === "" ? null : Number(b.offeredMinor);
  if (offered != null && (!Number.isInteger(offered) || offered < 0)) return { ok: false, status: 400, problem: "The amount offered must be a whole amount." };
  const perMember = b.ideasPerMember == null ? 2 : Number(b.ideasPerMember);
  if (!Number.isInteger(perMember) || perMember < 1 || perMember > 10) return { ok: false, status: 400, problem: "Ideas per member is a number from 1 to 10." };
  const id = newId("round");
  await insertRound(pool, {
    id,
    potId,
    title,
    seedAt: seed,
    growAt: grow,
    chooseAt: choose,
    harvestAt: harvest,
    offeredMinor: offered,
    quorumPct: 40,
    ideasPerMember: perMember,
    anonymousAllowed: b.anonymousAllowed !== false,
    createdBy: actorId,
  });
  return { ok: true, round: (await roundById(pool, id)) as RoundRow };
}

/** Set or clear the later dates. The seed date never moves once ideas can arrive. */
export async function setRoundDates(pool: Pool, roundId: string, body: unknown, now: Date): Promise<{ ok: true; round: RoundRow } | { ok: false; status: number; problem: string }> {
  const r = await roundById(pool, roundId);
  if (!r) return { ok: false, status: 404, problem: "No such round." };
  const stage = stageAt(datesOf(r), now);
  if (stage !== "seed") return { ok: false, status: 409, problem: "Dates are set while the round is still taking ideas." };
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const grow = dateOrNull(b.growAt);
  const choose = dateOrNull(b.chooseAt);
  const harvest = dateOrNull(b.harvestAt);
  if (grow === "bad" || choose === "bad" || harvest === "bad") return { ok: false, status: 400, problem: "A date could not be read." };
  if (grow && grow.getTime() <= now.getTime()) return { ok: false, status: 400, problem: "The grow date must be in the future." };
  const problem = datesProblem({ seedAt: r.seedAt, growAt: grow, chooseAt: choose, harvestAt: harvest, closedAt: null });
  if (problem) return { ok: false, status: 400, problem };
  await updateRoundDates(pool, roundId, { growAt: grow, chooseAt: choose, harvestAt: harvest });
  return { ok: true, round: (await roundById(pool, roundId)) as RoundRow };
}

// ── ideas ───────────────────────────────────────────────────────────────────

export interface IdeaView {
  id: string;
  roundId: string;
  title: string;
  what: string;
  whoHelps: string | null;
  roughCostMinor: number | null;
  whoMight: string | null;
  structureKey: string | null;
  circleId: string | null;
  status: IdeaStatus;
  byline: Byline;
  /** The viewer wrote it. True for their own anonymous idea too; never reveals anyone else. */
  mine: boolean;
  threadId: string | null;
  createdAt: string | null;
}

/** How an idea's author is shown: "a member" when anonymous, else their first name. */
export function bylineOf(idea: Pick<IdeaRow, "shownAs" | "authorId">, nameOf: (id: string) => string | null): Byline {
  if (idea.shownAs === "anonymous") return ANONYMOUS_BYLINE;
  const name = firstNameOf(nameOf(idea.authorId) ?? "");
  return name ? { kind: "named", text: name } : ANONYMOUS_BYLINE;
}

export function ideaView(idea: IdeaRow, viewerId: string | null, nameOf: (id: string) => string | null): IdeaView {
  return {
    id: idea.id,
    roundId: idea.roundId,
    title: idea.title,
    what: idea.what,
    whoHelps: idea.whoHelps,
    roughCostMinor: idea.roughCostMinor,
    whoMight: idea.whoMight,
    structureKey: idea.structureKey,
    circleId: idea.circleId,
    status: idea.status,
    byline: bylineOf(idea, nameOf),
    mine: viewerId != null && idea.authorId === viewerId,
    threadId: idea.threadId,
    createdAt: idea.createdAt,
  };
}

/** An amount in a unit's minor units, as plain text for a thread body. */
export function amountText(minor: number, unitKind: "currency" | "token", unit: string): string {
  if (unitKind === "currency") {
    try {
      const f = new Intl.NumberFormat("en", { style: "currency", currency: unit });
      const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
      return f.format(minor / 10 ** digits);
    } catch {
      return `${minor} ${unit}`;
    }
  }
  return `${minor} ${unit}`;
}

/** The forum category an idea's thread goes in: Projects when the village has it, else the first. */
function ideaCategory(): string | null {
  const cfg = moduleConfig<{ categories?: Array<{ id: string }> }>("forum");
  const cats = Array.isArray(cfg?.categories) ? cfg!.categories : (MODULES_BY_ID["forum"]?.defaultConfig?.categories ?? []);
  if (!Array.isArray(cats) || cats.length === 0) return null;
  return (cats.find((c: { id: string }) => c.id === "projects") ?? cats[0]).id;
}

export interface SeedDeps {
  memberCount: () => Promise<number>;
  nameOf: (id: string) => string | null;
}

export async function seedIdea(
  pool: Pool,
  deps: SeedDeps,
  authorId: string,
  roundId: string,
  body: unknown,
  now: Date,
): Promise<{ ok: true; idea: IdeaView } | { ok: false; status: number; problem: string }> {
  const round = await roundById(pool, roundId);
  if (!round) return { ok: false, status: 404, problem: "No such round." };
  if (!acceptsIdeas(datesOf(round), now)) return { ok: false, status: 409, problem: "This round is not taking ideas right now." };
  const pot = await potById(pool, round.potId);
  if (!pot || pot.status !== "open") return { ok: false, status: 409, problem: "This round's pot is not open." };
  const parsed = parseIdea(body);
  if (!parsed.ok) return { ok: false, status: 400, problem: parsed.problem };
  const idea = parsed.idea;
  if (idea.shownAs === "anonymous") {
    if (!round.anonymousAllowed) return { ok: false, status: 400, problem: "This round asks every idea to carry a name." };
    if ((await deps.memberCount()) < ANONYMOUS_MIN_MEMBERS) {
      return { ok: false, status: 400, problem: `The village needs ${ANONYMOUS_MIN_MEMBERS} members before an idea can be shared without a name.` };
    }
  }
  if ((await liveIdeasOf(pool, roundId, authorId)) >= round.ideasPerMember) {
    return { ok: false, status: 409, problem: `Each member may share ${round.ideasPerMember} ideas in this round. Withdraw one to share another.` };
  }
  const id = newId("idea");
  await insertIdea(pool, id, roundId, authorId, idea);
  const row = (await ideaById(pool, id)) as IdeaRow;
  await openIdeaThread(pool, row, round, pot, deps);
  await recordInteraction(pool, {
    actorUserId: authorId,
    kind: "idea.seeded",
    subjectType: "funding_idea",
    subjectRef: id,
    roundId,
    visibility: idea.shownAs === "anonymous" ? "private" : "members",
    dedupeKey: `idea.seeded:${id}`,
  });
  return { ok: true, idea: ideaView((await ideaById(pool, id)) as IdeaRow, authorId, deps.nameOf) };
}

/** Open the idea's forum discussion thread, when the forum is on for members. Never fails the seed. */
async function openIdeaThread(pool: Pool, idea: IdeaRow, round: RoundRow, pot: PotRow, deps: SeedDeps): Promise<void> {
  try {
    if (LIFECYCLE_RANK[effectiveLifecycle("forum")] < LIFECYCLE_RANK.members) return;
    const category = ideaCategory();
    if (!category) return;
    const anonymous = idea.shownAs === "anonymous";
    const lines = [
      anonymous ? "Posted for a member who chose not to give their name." : null,
      idea.what,
      idea.whoHelps ? `Who it would help: ${idea.whoHelps}` : null,
      idea.roughCostMinor != null ? `Rough cost: ${amountText(idea.roughCostMinor, pot.unitKind, pot.unitCode)}` : null,
      idea.whoMight ? `Who might do it: ${idea.whoMight}` : null,
      `An idea for ${round.title}, in Funding rounds: /funding-rounds/${round.id}`,
    ].filter(Boolean);
    const threadId = `thr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await insertIdeaThread(pool, {
      id: threadId,
      category,
      authorId: anonymous ? round.createdBy : idea.authorId,
      title: `Idea: ${idea.title}`,
      body: lines.join("\n\n"),
      meta: { fundingIdeaId: idea.id, fundingRoundId: round.id },
    });
    await setIdeaThread(pool, idea.id, threadId);
  } catch (err) {
    console.error(`[funding-rounds] idea ${idea.id} has no forum thread yet:`, err);
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

export interface Overview {
  pots: PotView[];
  rounds: RoundView[];
}

export async function overview(pool: Pool, now: Date, memberCount: number): Promise<Overview> {
  const pots = await listPots(pool);
  const rounds = await listRounds(pool);
  const views: RoundView[] = [];
  for (const r of rounds) views.push(roundView(r, now, memberCount, (await ideasOfRound(pool, r.id)).length));
  const potViews: PotView[] = [];
  for (const p of pots) potViews.push(await potView(pool, p));
  return { pots: potViews, rounds: views };
}

export async function roundDetail(
  pool: Pool,
  roundId: string,
  viewerId: string,
  now: Date,
  memberCount: number,
  nameOf: (id: string) => string | null,
): Promise<{ round: RoundView; pot: PotView; ideas: IdeaView[] } | null> {
  const r = await roundById(pool, roundId);
  if (!r) return null;
  const pot = await potById(pool, r.potId);
  if (!pot) return null;
  const ideas = await ideasOfRound(pool, roundId);
  return {
    round: roundView(r, now, memberCount, ideas.length),
    pot: await potView(pool, pot),
    ideas: ideas.map((i) => ideaView(i, viewerId, nameOf)),
  };
}

export { interactionCountsFor };

// ── member export and erasure ───────────────────────────────────────────────

/** A member's own Funding rounds data: their ideas (anonymous ones included, they are theirs) and their interaction rows. */
export async function exportMemberFundingRounds(pool: Pool, userId: string): Promise<unknown> {
  const ideas = await ideasByAuthor(pool, userId);
  return {
    ideas: ideas.map((i) => ({ id: i.id, roundId: i.roundId, title: i.title, what: i.what, shownAs: i.shownAs, status: i.status, createdAt: i.createdAt })),
    interactions: await interactionsOf(pool, userId),
  };
}

export async function forgetMemberFundingRounds(pool: Pool, userId: string): Promise<void> {
  await forgetMember(pool, userId);
}

/** The off switch waits while a round has moved past seed and is not closed. */
export async function fundingRoundsOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const n = await openRoundCount(pool, new Date());
  return { count: n, description: n === 1 ? "a funding round is under way" : `${n} funding rounds are under way` };
}
