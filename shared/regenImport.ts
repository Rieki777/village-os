/**
 * What a ReGen Civics file would set in this village, part by part, and the
 * exact bodies the existing routes are sent for each part a founder keeps.
 *
 * The file is read first (shared/regenFile.ts). This file reads it against
 * the village as it stands, so the preview can say "you have this one
 * already" or "this circle is yours, its seats go into it", and it is the only
 * place the bodies are built, so the preview and the load cannot disagree.
 *
 * ── EVERY PART GOES THROUGH A DOOR THAT ALREADY EXISTS ───────────────────
 *
 *   needs           PUT  /api/admin/needs/scope, all or nothing
 *   the whole       PUT  /api/admin/variables/needs.totality_target_pct
 *   circles, seats, ONE org draft (server/lib/orgDrafts.ts): create_circle,
 *   holders, and    create_seat, seat_holder and rest_circle, which the
 *   the old circles founder reads line by line, then publishes or reverts
 *                   whole with the draft's own buttons
 *   after publish   PUT  /api/org/circles/:id/decides, POST /api/admin/needs/links,
 *                   PUT  /api/admin/circles/:id (forming, when the founder picks it)
 *   prefilled       identity, the purpose statement, the covenant's opening, the
 *                   recognition token's name, the exit policy's leaving words
 *                   and each quest go into their own editors, unsaved
 *   a checklist     everything the stewards wrote for the founders to set by
 *                   hand, and their answer to the issuance cap, never written
 *
 * Nothing in this file talks to the network. The screen does that, one route
 * per part, in the order above.
 *
 * ── NO MONEY ─────────────────────────────────────────────────────────────
 *
 * No price, due, token amount or cap is ever in a body built here, and the
 * money modules are named only to say they stay off. The stewards' answer to
 * the issuance cap is shown beside the launch decision it answers.
 */
import { HUMAN_NEEDS_BY_ID, NEED_DEPTH_LABELS, type NeedWeight } from "./needs";
import { MODULES } from "./modules";
import { DECIDES_BY } from "./power";
import { CAP_DECLINED, type DecisionStatus, type ProfileCircle, type ProfileSeat, type RegenProfile } from "./regenFile";
import { CARRIED_FROM_KEY } from "./roleCcos";

/**
 * The modules a file never turns on (Rye, 2026-10-20): the ones that move or
 * raise money, which start off until a village's legal weeks are done. The
 * same five ReGen Civics keeps as VILLAGE_OS_MONEY_MODULES.
 */
export const MONEY_MODULES = ["exchange", "redemption", "commerce", "stays", "crowdpool"] as const;

/** The village as the import reads it, from `GET /api/needs/scope`, `GET /api/org` and `GET /api/season`. */
export interface LiveVillage {
  scope: { needKey: string; label: string; depthTarget: string; breadthTargetPct: number; retired: boolean }[];
  circles: { id: string; name: string; status: string; isExample: boolean; aliases: string[]; decidesBy: string | null; decidesByGloss?: string | null }[];
  seats: { id: string; name: string; circleId: string | null; holders: string[] }[];
  /** A seating made now has a season end to end with. Without one, every seating refuses. */
  seasonEnds: boolean;
}

export interface ScopeEntry {
  needKey: string;
  label?: string;
  depthTarget?: string;
  breadthTargetPct?: number;
  sortOrder?: number;
}

export interface PlanNeed {
  needKey: string;
  label: string;
  entry: ScopeEntry;
  /** The plain line the preview shows. */
  line: string;
}

export interface PlanCircle {
  key: string;
  id: string;
  name: string;
  /** True when a live circle answers to it, so its seats go into that circle and nothing is made. */
  reused: boolean;
  /** The file's own way of deciding, when it names exactly one. */
  decides: { by: string; gloss: string | null } | null;
  /** Every way the project's cards named, when they named more than one. */
  choices: { by: string; gloss: string | null }[];
  /** How the live circle decides now, when it is reused and has said, and its line for "another way". */
  liveDecidesBy: string | null;
  liveDecidesByGloss: string | null;
  needs: string[];
}

export interface PlanSeat {
  /** Stable within one plan: what the founder's tick is keyed by. */
  key: string;
  name: string;
  /** The seat this village will know it by: a new id, or the live seat's own. */
  id: string;
  circleKey: string;
  circleId: string;
  circleName: string;
  /** The live seat of the same name, which this import leaves as it is. */
  existing: boolean;
  /** The `create_seat` payload, or null for a live seat. */
  payload: Record<string, unknown> | null;
  /** The name of the person the file says holds it, or null. */
  holder: string | null;
  /** That person already holds the live seat, so nobody is seated twice. */
  holderAlready: boolean;
  needLinks: { needKey: string; weight: NeedWeight }[];
  /** Why this seat is not loaded at all, or null. */
  leftOut: string | null;
  lines: string[];
}

export interface PlanOldCircle {
  id: string;
  name: string;
  status: string;
  seats: number;
}

export interface IdentityPrefill {
  name?: string;
  tagline?: string;
  location?: string;
  memberName?: string;
  fiatCurrency?: string;
}

export interface ImportPlan {
  profile: RegenProfile;
  needs: PlanNeed[];
  /** Needs the project named and has not taken on yet. Each is the founder's own yes. */
  ownNeeds: PlanNeed[];
  totality: { pct: number; line: string } | null;
  circles: PlanCircle[];
  seats: PlanSeat[];
  /** Live circles this file does not name: the councils a new village is born with, usually. */
  oldCircles: PlanOldCircle[];
  /** Circles that meet a need with no seat carrying it, said so the founder can tag one later. */
  unseatedLinks: string[];
  /** Why the holders cannot ride the draft yet, or null when they can. */
  holdersWait: string | null;
  prefill: {
    identity: IdentityPrefill | null;
    purpose: { text: string; fromFirstLine: boolean } | null;
    covenant: string | null;
    /** The recognition token's name, for the Tokens tab's rename box. */
    tokenName: string | null;
    /** What happens when someone leaves, for the exit policy's leaving words. */
    exitPolicy: string | null;
    quests: { quest: string; needLabel: string | null }[];
  };
  /** What the founders set by hand, in the stewards' words, each with where it is set. Shown as a checklist and never written. */
  notes: { key: string; label: string; text: string; where: string }[];
  /** The modules the stewards chose, in the order to turn them on, with the money modules named as staying off. */
  modules: { on: { id: string; name: string }[]; order: string[]; unknown: string[]; moneyLeftOff: string[] } | null;
  leftOut: string[];
}

export type OldCirclesChoice = "rest" | "forming" | "keep";

export interface ImportChoices {
  needs: boolean;
  ownNeeds: string[];
  totality: boolean;
  structure: boolean;
  /** PlanSeat keys the founder kept. */
  seats: string[];
  holders: boolean;
  /** By circle key: the way it decides, or null to leave it to the village's way. */
  decides: Record<string, { by: string; gloss: string | null } | null>;
  oldCircles: OldCirclesChoice;
  links: boolean;
}

export interface DraftChangeInput {
  op: "create_circle" | "create_seat" | "seat_holder" | "rest_circle";
  orgRoleId: string;
  payload: Record<string, unknown>;
}

export interface AfterPublish {
  decides: { circleId: string; circleName: string; decidesBy: string; decidesByGloss: string | null }[];
  links: { needKey: string; subjectType: "role"; subjectRef: string; weight: NeedWeight; seatName: string }[];
  forming: { circleId: string; circleName: string }[];
}

/* -------------------------------------------------------------------------- *
 * Words.
 * -------------------------------------------------------------------------- */

export function needName(key: string, label?: string | null): string {
  const def = HUMAN_NEEDS_BY_ID[key];
  if (def) return def.label;
  return label?.trim() || key.replace(/^custom:/, "").replace(/-/g, " ");
}

const depthWord = (d: string | undefined): string =>
  d && Object.hasOwn(NEED_DEPTH_LABELS, d) ? NEED_DEPTH_LABELS[d as keyof typeof NEED_DEPTH_LABELS] : "Village OS's default depth";

export function decidesByLabel(by: string, gloss?: string | null): string {
  const def = DECIDES_BY.find((d) => d.id === by);
  if (by === "other" && gloss) return `Another way: ${gloss}`;
  return def?.label ?? by;
}

const WEIGHT_WORDS: Record<NeedWeight, string> = { primary: "it alone meets it", partial: "it helps" };

/** "4 hours a week", or the words as written. */
function contributionLine(seat: ProfileSeat): string | null {
  const { hoursPerWeek, text } = seat.contribution;
  if (text) return `Contribution: ${text}`;
  if (hoursPerWeek) return `Contribution: ${hoursPerWeek} hours a week`;
  return null;
}

/** A seat's "answers for", as the list a seat card keeps, plus its contribution. */
export function accountabilitiesFor(seat: ProfileSeat): string[] {
  const out = (seat.accountabilities ?? "")
    .split(/\r?\n|;/)
    .map((s) => s.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .map((s) => s.slice(0, 300))
    .slice(0, 20);
  const contribution = contributionLine(seat);
  if (contribution) out.push(contribution);
  return out;
}

/** Lowercase letters, digits and single hyphens. Linear, like `dashSlug` in server/lib/orgChart.ts. */
export function slugOf(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).join("-");
}

function uniqueId(base: string, taken: Set<string>, max = 64): string {
  const root = base.slice(0, max).replace(/-+$/, "") || "item";
  let id = root;
  for (let n = 2; taken.has(id); n++) id = `${root.slice(0, max - String(n).length - 1)}-${n}`;
  taken.add(id);
  return id;
}

/** How a decision stands in the 1.0 file, or null for a card. */
export function statusOf(profile: RegenProfile, key: string): DecisionStatus | null {
  return profile.village?.status[key]?.status ?? null;
}

/* -------------------------------------------------------------------------- *
 * The plan.
 * -------------------------------------------------------------------------- */

/**
 * Read a file against the village. `tag` goes on every new seat's id, so an
 * id from this load never meets one an earlier load made and then rested: the
 * live chart this screen can read leaves rested seats out, and the draft's
 * preview refuses an id that exists anywhere.
 */
export function planImport(profile: RegenProfile, live: LiveVillage, opts: { tag: string }): ImportPlan {
  const tag = slugOf(opts.tag).slice(0, 8) || "rc";
  const card = profile.card;
  const village = profile.village;
  const leftOut = [...profile.leftOut];
  const inScope = new Map(live.scope.filter((s) => !s.retired).map((s) => [s.needKey, s]));

  // ── Needs ────────────────────────────────────────────────────────────────
  const needLine = (key: string, label: string, e: ScopeEntry): string => {
    const target = `${depthWord(e.depthTarget)}, for ${e.breadthTargetPct ?? 100} percent of your people`;
    const now = inScope.get(key);
    if (!now) return `${label}: ${target}.`;
    const same = now.depthTarget === (e.depthTarget ?? now.depthTarget) && now.breadthTargetPct === (e.breadthTargetPct ?? now.breadthTargetPct);
    return same
      ? `${label}: you have taken this one on already, at the same depth and breadth.`
      : `${label}: you have taken this one on at ${depthWord(now.depthTarget)} for ${now.breadthTargetPct} percent. This sets ${target}.`;
  };
  const needs: PlanNeed[] = card.needs.map((n, i) => {
    const label = needName(n.needKey, n.label);
    const entry: ScopeEntry = { needKey: n.needKey, sortOrder: n.sortOrder ?? i + 1 };
    if (n.needKey.startsWith("custom:")) entry.label = label;
    if (n.depthTarget) entry.depthTarget = n.depthTarget;
    if (n.breadthTargetPct !== null) entry.breadthTargetPct = n.breadthTargetPct;
    return { needKey: n.needKey, label, entry, line: needLine(n.needKey, label, entry) };
  });
  const ownNeeds: PlanNeed[] = card.customNeeds.map((c, i) => {
    const entry: ScopeEntry = { needKey: c.needKey, label: c.label, sortOrder: needs.length + i + 1 };
    const line = inScope.has(c.needKey)
      ? `${c.label}: you have taken this one on already.`
      : `${c.label}: named in Week 3 and not taken on yet. Village OS's default depth, for everyone.`;
    return { needKey: c.needKey, label: c.label, entry, line };
  });
  const totality =
    card.totalityPct !== null && card.totalityPct > 0
      ? { pct: card.totalityPct, line: `Your village means to meet ${card.totalityPct} percent of its people's human needs, taken over every need it has taken on. The figure describes; nothing reads it as a budget.` }
      : null;

  // ── Circles ──────────────────────────────────────────────────────────────
  const fileCircles = new Map<string, ProfileCircle>();
  for (const c of card.circles) fileCircles.set(c.key, c);
  for (const s of card.seats) {
    if (!fileCircles.has(s.circle)) {
      fileCircles.set(s.circle, { key: s.circle, label: s.circleLabel, needs: [], decidesOn: [], decidesBy: null, decidesByGloss: null, decidesByAnswers: [], startsWith: false });
    }
  }
  const circleIds = new Set(live.circles.map((c) => c.id));
  const usedLive = new Set<string>();
  const circles: PlanCircle[] = [];
  for (const c of Array.from(fileCircles.values())) {
    const lower = c.label.toLowerCase();
    const slug = slugOf(c.label) || `circle-${circles.length + 1}`;
    const match = live.circles.find(
      (l) =>
        !l.isExample &&
        l.status !== "dormant" &&
        !usedLive.has(l.id) &&
        (l.id === slug || l.name.trim().toLowerCase() === lower || l.aliases.some((a) => a.trim().toLowerCase() === lower)),
    );
    if (match) usedLive.add(match.id);
    const choices = c.decidesBy ? [] : c.decidesByAnswers.length > 1 ? c.decidesByAnswers : [];
    const decides = c.decidesBy ? { by: c.decidesBy, gloss: c.decidesByGloss } : c.decidesByAnswers.length === 1 ? c.decidesByAnswers[0] : null;
    circles.push({
      key: c.key,
      id: match ? match.id : uniqueId(slug, circleIds),
      name: match ? match.name : c.label.slice(0, 120),
      reused: !!match,
      decides,
      choices,
      liveDecidesBy: match?.decidesBy ?? null,
      liveDecidesByGloss: match?.decidesByGloss ?? null,
      needs: c.needs,
    });
  }
  const circleByKey = new Map(circles.map((c) => [c.key, c]));

  // ── Seats ────────────────────────────────────────────────────────────────
  const liveByName = new Map(live.seats.map((s) => [s.name.trim().toLowerCase(), s]));
  const seatIds = new Set(live.seats.map((s) => s.id));
  const namesInFile = new Set<string>();
  const seats: PlanSeat[] = card.seats.map((s, i) => {
    const circle = circleByKey.get(s.circle)!;
    const lower = s.name.toLowerCase();
    const liveSeat = liveByName.get(lower);
    const key = `seat-${i}`;
    const holder = s.heldBy === "team" && s.who ? s.who : null;
    const base = { key, name: s.name, circleKey: s.circle, circleId: circle.id, circleName: circle.name, needLinks: s.needLinks };
    if (namesInFile.has(lower)) {
      return {
        ...base, id: "", existing: false, payload: null, holder: null, holderAlready: false, needLinks: [],
        leftOut: `A second role called "${s.name}" is in this file. A village keeps one role to a name, so the second is left out. Rename it on ReGen Civics, or add it by hand on the Org Chart.`,
        lines: [],
      };
    }
    namesInFile.add(lower);
    if (liveSeat) {
      const holderAlready = !!holder && liveSeat.holders.some((h) => h.trim().toLowerCase() === holder.toLowerCase());
      const lines = [`Your chart has a role called "${liveSeat.name}" already, so this load leaves it as it is.`];
      if (holder && !holderAlready) lines.push(`${holder} goes into it as a holder you name, until they have an account and claim it.`);
      return { ...base, id: liveSeat.id, circleId: liveSeat.circleId ?? circle.id, existing: true, payload: null, holder, holderAlready, leftOut: null, lines };
    }
    const id = uniqueId(`${(slugOf(s.name) || "seat").slice(0, 64 - tag.length - 1)}-${tag}`, seatIds);
    const being = s.heldBy === "being";
    const sentence = (t: string | null) => (t && !/[.!?]$/.test(t) ? `${t}.` : t);
    const why = being
      ? [sentence(s.why), `A being holds this role${s.who ? `: ${s.who}` : ""}. It is open for someone to speak for it.`].filter(Boolean).join(" ")
      : s.why;
    const domain = s.domain ?? (fileCircles.get(s.circle)?.decidesOn.length ? fileCircles.get(s.circle)!.decidesOn.join("; ") : null);
    const accountabilities = accountabilitiesFor(s);
    const payload: Record<string, unknown> = {
      name: s.name,
      circleId: circle.id,
      aim: s.aim,
      domain,
      accountabilities,
      whyItMatters: why,
      seats: s.seats,
      recruiting: s.heldBy !== "team",
    };
    const lines: string[] = [`In ${circle.name}.${s.aim ? ` Aim: ${s.aim}` : " The file gives it no aim yet."}`];
    if (accountabilities.length) lines.push(`Answers for: ${accountabilities.join("; ")}`);
    if (domain) lines.push(`Decides on: ${domain}`);
    if (s.why) lines.push(`Why it matters: ${s.why}`);
    if (holder) lines.push(`Held by ${holder}, written down as a holder you name until they have an account and claim it.`);
    else if (s.heldBy === "team") lines.push("Held by someone on your team. The file does not say who, so nobody is put in it.");
    else if (being) lines.push(`A being holds it${s.who ? `: ${s.who}` : ""}. It goes in as an open role, with the being named on its card.`);
    else lines.push("Open, and marked as recruiting.");
    if (s.seats > 1) lines.push(`Room for ${s.seats} people.`);
    return { ...base, id, existing: false, payload, holder, holderAlready: false, leftOut: null, lines };
  });
  for (const s of seats) {
    for (const l of s.needLinks) {
      if (s.leftOut) continue;
      s.lines.push(`Meets ${needName(l.needKey, card.needs.find((n) => n.needKey === l.needKey)?.label)}: ${WEIGHT_WORDS[l.weight]}.`);
    }
  }

  // ── Circle links no seat carries ─────────────────────────────────────────
  const unseatedLinks: string[] = [];
  for (const l of card.needLinks) {
    const label = needName(l.needKey, card.needs.find((n) => n.needKey === l.needKey)?.label);
    if (l.circle === "own") {
      unseatedLinks.push(`${label} is met by one of your own circles that the file does not name. Tag a role for it on What this village is for, screen 5.`);
      continue;
    }
    const carried = card.seats.some((s) => s.circle === l.circle && s.needLinks.some((x) => x.needKey === l.needKey));
    if (!carried) {
      unseatedLinks.push(`${label} is met by ${l.circleLabel}, and no role in it carries that yet. Tag one on What this village is for, screen 5, once the roles exist.`);
    }
  }

  // ── The circles this file does not name ─────────────────────────────────
  const oldCircles: PlanOldCircle[] = live.circles
    .filter((c) => !c.isExample && c.status !== "dormant" && !usedLive.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, status: c.status, seats: live.seats.filter((s) => s.circleId === c.id).length }));

  const holdersWait = live.seasonEnds
    ? null
    : "Naming who holds a role waits for a running season with an end date, because every holding ends with its season. Set your seasons under Season, then load this file again for its holders.";

  // ── The 1.0 file's own sections ──────────────────────────────────────────
  const identity: IdentityPrefill = {};
  if (village?.identity.name) identity.name = village.identity.name;
  if (village?.identity.tagline) identity.tagline = village.identity.tagline;
  if (village?.identity.location) identity.location = village.identity.location;
  if (village?.identity.memberWord) identity.memberName = village.identity.memberWord;
  if (village?.identity.currency) identity.fiatCurrency = village.identity.currency;

  // A Week 4 card has a first line and no statement; the 1.0 file the other way round.
  const statement = village?.purpose.statement ?? null;
  const purpose = statement
    ? { text: statement, fromFirstLine: false }
    : card.firstLine
      ? { text: `All this is for ${card.firstLine}`, fromFirstLine: true }
      : null;

  const notes: ImportPlan["notes"] = [];
  const note = (key: string, label: string, text: string | null | undefined, where: string) => {
    if (text && !notes.some((n) => n.key === key)) notes.push({ key, label, text, where });
  };
  // The stewards' own words for what the founders set by hand, first.
  for (const n of village?.notes ?? []) note(n.key, n.title, n.text, NOTE_WHERE[n.key] ?? "Set by hand in Admin");
  // Then the card's, where the 1.0 file says nothing of its own about them.
  note("membership.entry", "The first step someone takes to come in", card.entry, NOTE_WHERE["membership.entry"]);
  const together = [
    card.decisions.together.length ? `Decided together: ${card.decisions.together.join(", ")}.` : null,
    card.decisions.agreement ? `First agreement: ${card.decisions.agreement}` : null,
  ].filter(Boolean).join(" ");
  note("decide.together", "What the whole village decides together", together, NOTE_WHERE["decide.together"]);
  note("card.how", "How the village decides today", card.decisions.how, "Org Chart, how the village decides");
  if (card.players.toStart || card.players.now) {
    note("card.players", "Players", [card.players.toStart && `To start: ${card.players.toStart}.`, card.players.now && `Now: ${card.players.now}.`].filter(Boolean).join(" "), "Your Game's notes");
  }
  note("card.shape", "The shape of your Game", [card.shape.shape, card.shape.line].filter(Boolean).join(". "), "Your Game's notes");
  // Two settings the Identity boxes do not hold.
  note("identity.timezone", "Your timezone", village?.identity.timezone, "Season, the village's timezone");
  const hemisphere = village?.identity.hemisphere ?? null;
  note("identity.hemisphere", "Your hemisphere", hemisphere === "north" ? "Northern hemisphere" : hemisphere === "south" ? "Southern hemisphere" : null, "Season");
  // A launch decision only the founders make, so the stewards' answer is shown beside it and set nowhere.
  const cap = village?.economy.issuanceCap ?? null;
  if (cap !== null) {
    note(
      "economy.issuanceCap",
      "Your issuance cap",
      cap === CAP_DECLINED
        ? "Your stewards chose to keep Village OS's own 10,000 new tokens each lunar cycle. Declining keeps that cap binding; it uncaps nothing."
        : `Your stewards chose at most ${cap} new tokens each lunar cycle.`,
      "The Launch Plan, Decide this village's issuance cap. This screen writes no number",
    );
  }

  const modules = village ? modulesFor(village.modules.on ?? []) : null;

  return {
    profile,
    needs,
    ownNeeds,
    totality,
    circles,
    seats,
    oldCircles,
    unseatedLinks,
    holdersWait,
    prefill: {
      identity: Object.keys(identity).length ? identity : null,
      purpose,
      covenant: village?.membership.covenant ?? null,
      tokenName: village?.quests.tokenName ?? null,
      exitPolicy: village?.legal.exitPolicy ?? null,
      quests: card.quests.map((q) => ({ quest: q.quest, needLabel: q.need ? needName(q.need, card.needs.find((n) => n.needKey === q.need)?.label) : null })),
    },
    notes,
    modules,
    leftOut,
  };
}

/**
 * Where a founder sets each thing the stewards wrote a note about, keyed by
 * the 1.0 file's decision key (ReGen Civics shared/villageDecisions.ts, the
 * ones that land as a note). A key this does not know still shows, with a
 * plain "set by hand".
 */
const NOTE_WHERE: Record<string, string> = {
  "seats.nextHolder": "Org Chart, in each role",
  "decide.together": "Governance",
  "decide.voting": "Game variables, governance",
  "decide.founders": "Members, and the launch vote on the Launch Plan",
  "decide.stewards": "The steward slate",
  "membership.entry": "Training and the welcome pages",
  "membership.rite": "Training and quests",
  "membership.greeter": "Arrival settings",
  "membership.joining": "Membership settings",
  "quests.contribution": "Gratitude and quests",
  "seasons.year": "Season",
  "economy.poolToken": "Game variables, the gratitude pool",
  "legal.structure": "The Launch Plan",
  "legal.land": "The Launch Plan",
  "legal.care": "The Launch Plan",
  "network.tools": "Your tools directory",
  "launch.address": "Go live",
};

/**
 * The modules the stewards chose, by Village OS's own registry: named, each
 * after what it requires, and never a money module. Village OS demotes a
 * module turned on before its dependency straight back to off, so the order
 * is part of the answer.
 */
function modulesFor(chosen: readonly string[]): NonNullable<ImportPlan["modules"]> {
  const byId = new Map(MODULES.map((m) => [m.id, m]));
  const money = new Set<string>(MONEY_MODULES);
  const known = chosen.filter((id) => byId.has(id) && !money.has(id) && !byId.get(id)!.core);
  const unknown = chosen.filter((id) => !byId.has(id));
  const ordered: string[] = [];
  const visit = (id: string, depth = 0) => {
    if (ordered.includes(id) || depth > 10) return;
    for (const dep of byId.get(id)?.requires ?? []) if (known.includes(dep)) visit(dep, depth + 1);
    ordered.push(id);
  };
  for (const id of known) visit(id);
  const order: string[] = [];
  for (const id of ordered) {
    const missing = (byId.get(id)?.requires ?? []).filter((dep) => !known.includes(dep));
    for (const dep of missing) order.push(`${byId.get(id)!.name} needs ${byId.get(dep)?.name ?? dep} on first.`);
  }
  return {
    on: ordered.map((id) => ({ id, name: byId.get(id)!.name })),
    order,
    unknown,
    moneyLeftOff: MONEY_MODULES.map((id) => byId.get(id)?.name ?? id),
  };
}

/* -------------------------------------------------------------------------- *
 * The founder's ticks, and what they send.
 * -------------------------------------------------------------------------- */

/** Every part on, the file's own needs only, the old circles rested, and holders only when a season can hold them. */
export function defaultChoices(plan: ImportPlan): ImportChoices {
  const decides: ImportChoices["decides"] = {};
  for (const c of plan.circles) {
    // A circle that already decides its own way keeps it unless the founder picks the file's.
    decides[c.key] = c.reused && c.liveDecidesBy ? null : c.decides;
  }
  return {
    needs: plan.needs.length > 0,
    ownNeeds: [],
    totality: plan.totality !== null,
    structure: plan.circles.length > 0 || plan.seats.length > 0,
    seats: plan.seats.filter((s) => !s.leftOut).map((s) => s.key),
    holders: plan.holdersWait === null && plan.seats.some((s) => s.holder && !s.holderAlready),
    decides,
    oldCircles: "rest",
    links: plan.seats.some((s) => s.needLinks.length > 0),
  };
}

/** The needs scope write's body, or null when there is nothing to send. */
export function scopeBodyFor(plan: ImportPlan, choices: ImportChoices): { needs: ScopeEntry[] } | null {
  const needs = [
    ...(choices.needs ? plan.needs.map((n) => n.entry) : []),
    ...plan.ownNeeds.filter((n) => choices.ownNeeds.includes(n.needKey)).map((n) => n.entry),
  ];
  return needs.length ? { needs } : null;
}

const keptSeats = (plan: ImportPlan, choices: ImportChoices): PlanSeat[] =>
  plan.seats.filter((s) => !s.leftOut && choices.seats.includes(s.key) && (s.existing || choices.structure));

/** The rest_circle lines a choice of "rest" sends: only a circle nobody sits in can rest. */
export function restableOldCircles(plan: ImportPlan): PlanOldCircle[] {
  return plan.oldCircles.filter((c) => c.seats === 0);
}

/**
 * The org draft's changes, in the order they apply: circles, then the seats
 * inside them, then who holds them, then the old circles resting last.
 */
export function draftChangesFor(plan: ImportPlan, choices: ImportChoices): DraftChangeInput[] {
  const out: DraftChangeInput[] = [];
  const seats = keptSeats(plan, choices);
  const createsCircles = choices.structure && plan.circles.some((c) => !c.reused);
  if (choices.structure) {
    plan.circles.forEach((c, i) => {
      if (c.reused) return;
      out.push({ op: "create_circle", orgRoleId: `circle:${c.id}`, payload: { name: c.name, sortOrder: i + 1 } });
    });
    // Each role is one the village already keeps on its ReGen Civics card, so
    // it arrives with the lines it has: the CCOS count of what a role answers
    // for (shared/roleCcos.ts) binds roles written here, not roles carried in.
    for (const s of seats) {
      if (!s.existing && s.payload) out.push({ op: "create_seat", orgRoleId: s.id, payload: { ...s.payload, [CARRIED_FROM_KEY]: "regen-civics" } });
    }
  }
  if (choices.holders && plan.holdersWait === null) {
    for (const s of seats) {
      if (s.holder && !s.holderAlready) out.push({ op: "seat_holder", orgRoleId: s.id, payload: { displayName: s.holder } });
    }
  }
  if (createsCircles && choices.oldCircles === "rest") {
    for (const c of restableOldCircles(plan)) out.push({ op: "rest_circle", orgRoleId: `circle:${c.id}`, payload: {} });
  }
  return out;
}

/** What is sent once the draft is published, when its seats and circles exist. */
export function afterPublishFor(plan: ImportPlan, choices: ImportChoices, liveScope: readonly string[]): AfterPublish {
  const seats = keptSeats(plan, choices);
  const scope = new Set<string>([...liveScope, ...(scopeBodyFor(plan, choices)?.needs ?? []).map((n) => n.needKey)]);
  const decides: AfterPublish["decides"] = [];
  if (choices.structure) {
    for (const c of plan.circles) {
      const pick = choices.decides[c.key];
      if (pick) decides.push({ circleId: c.id, circleName: c.name, decidesBy: pick.by, decidesByGloss: pick.by === "other" ? pick.gloss : null });
    }
  }
  const links: AfterPublish["links"] = [];
  if (choices.links) {
    for (const s of seats) {
      for (const l of s.needLinks) if (scope.has(l.needKey)) links.push({ needKey: l.needKey, subjectType: "role", subjectRef: s.id, weight: l.weight, seatName: s.name });
    }
  }
  const forming: AfterPublish["forming"] =
    choices.structure && choices.oldCircles === "forming" && plan.circles.some((c) => !c.reused)
      ? plan.oldCircles.filter((c) => c.status !== "forming").map((c) => ({ circleId: c.id, circleName: c.name }))
      : [];
  return { decides, links, forming };
}

/** The draft's title and the line under it, in the founder's list of drafts. */
export function draftWordsFor(profile: RegenProfile): { title: string; rationale: string } {
  const project = profile.from.project ?? "your project";
  const weeks = profile.from.weeks.length ? ` (weeks ${profile.from.weeks.join(", ")})` : "";
  const kind = profile.kind === "village" ? "Village OS 1.0 file" : "Week 4 card";
  return {
    title: `Started from ${project}'s ReGen Civics profile`.slice(0, 200),
    rationale: `Loaded from the ${kind}${weeks}. Read every line before you publish it. Publishing applies the whole draft at once, and reverting it puts back what was there.`,
  };
}
