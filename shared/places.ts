/**
 * LIVING PLACES: the pure rules of the place registry, the building lifecycle
 * and the claimable stewardship of each place (spec: places lane, 2026-11-08).
 *
 * A place's key IS the `structure_key` every place-carrying column already
 * holds (quests, org_roles, circles, events, forum_threads, place_photos...),
 * byte for byte. The registry adds what those columns never had: a record that
 * says the place exists, where it is on its way from idea to in use, and who
 * is leading it there.
 *
 * Nothing here touches the database. The routes (S2) hand these functions the
 * facts they need and act on the verdict, so every rule is provable here with
 * nothing in the way.
 *
 * Article 0.4 shapes every refusal below: a "no" always carries `votePath`,
 * the vote that gets past it. A refusal that names no vote is a defect.
 */

/** The nine stages, in order (plan v3 section 9). */
export const PLACE_STAGES = [
  "idea",
  "sited",
  "designed",
  "permitted",
  "funded",
  "building",
  "built",
  "in_use",
  "needs_care",
] as const;
export type PlaceStage = (typeof PLACE_STAGES)[number];

/** Kinds of place. Land, preserve and feature carry no lifecycle (stage null). */
export const PLACE_KINDS = ["building", "homes", "garden", "system", "feature", "preserve", "land", "route"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const KINDS_WITHOUT_LIFECYCLE: readonly PlaceKind[] = ["feature", "preserve", "land"];

/** The state of a place's steward position, as the card and the map show it. */
export const STEWARD_STATES = ["filled", "held", "open", "paused", "expired"] as const;
export type StewardState = (typeof STEWARD_STATES)[number];

export const TRI = ["no", "yes", "unknown"] as const;
export type Tri = (typeof TRI)[number];

/** The shortest place-carrying column is varchar(64), so 64 is the real ceiling. */
export const PLACE_KEY_MAX = 64;
/** New keys are lowercase: the database compares keys without case (utf8mb4_0900_ai_ci). */
const PLACE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** A key already on a village's map keeps its spelling, mixed case included (0062 doctrine). */
const LEGACY_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Character limits on the village's own words (IV.5). */
export const PLACE_LIMITS = {
  name: 80,
  positionText: 300,
  description: 1000,
  reason: 300,
  claim: { build: 2000, team: 1000, funds: 1000, timeline: 1000, crews: 1000 },
} as const;

export type PlaceKey = string;

/** A key a NEW place may take. */
export function isPlaceKey(input: unknown): input is PlaceKey {
  return typeof input === "string" && PLACE_KEY.test(input);
}

/** A key that may already exist on a map (mixed case allowed, never registered anew). */
export function isLegacyPlaceKey(input: unknown): input is PlaceKey {
  return typeof input === "string" && LEGACY_KEY.test(input);
}

/**
 * Why `key` may not be registered next to `existing`, or null. Equal ignoring
 * case is a collision, because every place column compares without case.
 */
export function keyCollision(key: string, existing: Iterable<string>): string | null {
  const f = key.toLowerCase();
  return Array.from(existing).find((e) => e.toLowerCase() === f) ?? null;
}

export function isStage(s: unknown): s is PlaceStage {
  return typeof s === "string" && (PLACE_STAGES as readonly string[]).includes(s);
}

export function stageIndex(s: PlaceStage): number {
  return PLACE_STAGES.indexOf(s);
}

/** How a decision is being taken. Ordered weakest to strongest. */
export type DecidedVia = "holder" | "consent" | "village_vote" | "highest_vote";
const VIA_RANK: Record<DecidedVia, number> = { holder: 0, consent: 1, village_vote: 2, highest_vote: 3 };

export type Verdict =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; reason: string; votePath: string };

const HIGHEST = "the village's highest vote can make this change now; the warning stays on the record";

export interface PermitItem {
  id: string;
  place: PlaceKey;
  title: string;
  state: "needed" | "in_progress" | "submitted" | "granted" | "not_needed";
  waitsOn?: string[];
}

export function permitDone(i: PermitItem): boolean {
  return i.state === "granted" || i.state === "not_needed";
}

/**
 * Is a place's checklist complete? A place's own items AND every item they wait
 * on (often on the whole-land place) must be done. An empty checklist is NOT
 * complete: nothing builds before its permits are known (plan section 9).
 */
export function permitsComplete(place: PlaceKey, items: PermitItem[]): { complete: boolean; missing: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const own = items.filter((i) => i.place === place);
  if (own.length === 0) return { complete: false, missing: ["no permit checklist yet"] };
  const seen = new Set<string>();
  const missing: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const it = byId.get(id);
    if (!it) { missing.push(`unknown item ${id}`); return; }
    if (!permitDone(it)) missing.push(it.title);
    for (const w of it.waitsOn ?? []) walk(w);
  };
  for (const i of own) walk(i.id);
  return { complete: missing.length === 0, missing };
}

/** An item may be granted only once everything it waits on is done. */
export function permitGrantRefusal(id: string, items: PermitItem[]): Verdict {
  const byId = new Map(items.map((i) => [i.id, i]));
  const it = byId.get(id);
  if (!it) return { ok: false, code: "permit_unknown", reason: `no permit item ${id}`, votePath: "none needed: add the item first" };
  const blocking = (it.waitsOn ?? []).map((w) => byId.get(w)).filter((w): w is PermitItem => !w || !permitDone(w));
  if (blocking.length) {
    return {
      ok: false,
      code: "permit_waits",
      reason: `waits on: ${blocking.map((b) => b?.title ?? "an unknown item").join(", ")}`,
      votePath: "a village vote may record it granted anyway; the waiting items stay listed on the record",
    };
  }
  return { ok: true, warnings: [] };
}

/** The ids forming a cycle in `waitsOn`, or null. A cycle is refused at write. */
export function findPermitCycle(items: PermitItem[]): string[] | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 2) return null;
    if (s === 1) return stack.slice(stack.indexOf(id)).concat(id);
    state.set(id, 1);
    stack.push(id);
    for (const w of byId.get(id)?.waitsOn ?? []) {
      if (!byId.has(w)) continue;
      const c = visit(w);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const i of items) {
    const c = visit(i.id);
    if (c) return c;
  }
  return null;
}

export interface StageMoveInput {
  kind: PlaceKind;
  from: PlaceStage | null;
  to: PlaceStage;
  via: DecidedVia;
  reason?: string;
  inPreserve: Tri;
  inRiparianBuffer: Tri;
  permits: { complete: boolean; missing: string[] };
  steward: StewardState;
  setAside: boolean;
}

/** The consent flag (US6): siting in the preserve or a riparian buffer. */
export function preserveFlag(p: { inPreserve: Tri; inRiparianBuffer: Tri }): boolean {
  return p.inPreserve === "yes" || p.inRiparianBuffer === "yes";
}

/**
 * May this place move from `from` to `to`, decided this way? Pure; the route
 * supplies every fact. Each refusal names its vote path (0.4).
 */
export function checkStageMove(m: StageMoveInput): Verdict {
  const warnings: string[] = [];
  if (KINDS_WITHOUT_LIFECYCLE.includes(m.kind)) {
    return { ok: false, code: "no_lifecycle", reason: `a ${m.kind} has no building stages`, votePath: "a village vote may change the place's kind first" };
  }
  if (m.setAside) {
    return { ok: false, code: "set_aside", reason: "this place is set aside", votePath: "propose restoring it first; its steward or a village vote adopts that" };
  }
  if (m.from === m.to) return { ok: false, code: "same_stage", reason: "the place is already at this stage", votePath: "none needed" };
  const rank = VIA_RANK[m.via];

  // needs care: only from built or in use, and back to in use.
  if (m.to === "needs_care" && m.from !== "built" && m.from !== "in_use") {
    return { ok: false, code: "care_before_built", reason: "only a built place can need care", votePath: HIGHEST };
  }
  if (m.from === "needs_care" && m.to !== "in_use" && rank < VIA_RANK.highest_vote) {
    return { ok: false, code: "care_returns_to_use", reason: "a place that needs care returns to in use", votePath: HIGHEST };
  }

  const fromI = m.from === null ? -1 : stageIndex(m.from === "needs_care" ? "in_use" : m.from);
  const toI = stageIndex(m.to === "needs_care" ? "in_use" : m.to);
  const forward = toI > fromI;

  const careReturn = m.from === "needs_care" && m.to === "in_use";
  if (!forward && !careReturn && m.to !== "needs_care" && !(m.reason && m.reason.trim())) {
    return { ok: false, code: "back_needs_reason", reason: "moving a place back needs a reason", votePath: "give the reason; the same people decide" };
  }
  if (forward && toI - fromI > 1 && m.from !== null && rank < VIA_RANK.highest_vote) {
    return { ok: false, code: "skips_stages", reason: `a place moves one stage at a time (${m.from} to ${PLACE_STAGES[fromI + 1]})`, votePath: HIGHEST };
  }

  // Sited and beyond: the preserve answers must be known, and a yes needs consent.
  if (forward && toI >= stageIndex("sited")) {
    if (m.inPreserve === "unknown" || m.inRiparianBuffer === "unknown") {
      if (rank < VIA_RANK.highest_vote) {
        return {
          ok: false,
          code: "preserve_unknown",
          reason: "nobody has answered whether this place is inside the preserve or a riparian buffer",
          votePath: `the land steward answers; or ${HIGHEST}`,
        };
      }
      warnings.push("moved with the preserve answers unknown");
    }
    if (preserveFlag(m) && rank < VIA_RANK.consent) {
      return {
        ok: false,
        code: "preserve_consent",
        reason: "this place sits inside the preserve or a riparian buffer",
        votePath: "the place's circle consents, or a village vote decides",
      };
    }
    if (preserveFlag(m)) warnings.push("sited inside the preserve or a riparian buffer, by consent");
  }

  // The building gate (plan section 13).
  if (m.to === "building" && forward) {
    const missing: string[] = [];
    if (!m.permits.complete) missing.push(`permits: ${m.permits.missing.join(", ")}`);
    if (m.steward !== "filled" && m.steward !== "held") missing.push("a steward filled or held for now");
    if (missing.length) {
      if (rank < VIA_RANK.highest_vote) {
        return { ok: false, code: "building_gate", reason: `not ready to build: ${missing.join("; ")}`, votePath: HIGHEST };
      }
      warnings.push(`moved to building without: ${missing.join("; ")}`);
    }
  }
  return { ok: true, warnings };
}

/**
 * Who may ADOPT a stage proposal (spec US7, adversarial G1). The proposer, and
 * whoever approved the quest that triggered it, never adopt it: the next one in
 * the chain does, ending in a village vote (0.3).
 */
export function stageAdopterRefusal(a: {
  actorId: string;
  proposerId: string;
  sourceApproverId?: string | null;
  actorHoldsPlaceTend: boolean;
}): Verdict {
  if (a.actorId === a.proposerId) {
    return { ok: false, code: "own_proposal", reason: "you proposed this change", votePath: "another holder adopts it, or any member puts it to a village vote" };
  }
  if (a.sourceApproverId && a.actorId === a.sourceApproverId) {
    return { ok: false, code: "approved_source", reason: "you approved the work this change comes from", votePath: "another holder adopts it, or any member puts it to a village vote" };
  }
  if (!a.actorHoldsPlaceTend) {
    return { ok: false, code: "no_power", reason: "adopting a stage change needs the power to tend this place", votePath: "any member may put it to a village vote" };
  }
  return { ok: true, warnings: [] };
}

/**
 * The steward position's state, from the role facts. No role yet (a virtual
 * invitation) is open. "Held" and "paused" are kept on the place with a reason
 * and an end moon, so neither waits forever (adversarial G5).
 */
export function stewardState(f: {
  roleId: string | null;
  seat: "open" | "filled" | "partial" | "forming" | "expired" | null;
  held: boolean;
  paused: boolean;
}): StewardState {
  if (f.paused) return "paused";
  if (f.roleId === null || f.seat === null) return f.held ? "held" : "open";
  if (f.seat === "filled" || f.seat === "partial") return "filled";
  if (f.seat === "expired") return f.held ? "held" : "expired";
  return f.held ? "held" : "open";
}

export interface StewardClaimInput {
  build: string;
  team: string;
  funds: { amountMinor: number | null; unit: string | null; note: string };
  timeline: string;
  crews: string;
}

export type ClaimParse = { ok: true; claim: StewardClaimInput } | { ok: false; field: string; reason: string };

/** The five answers of a claim (US4.3). Funds are a statement, never a payment. */
export function parseStewardClaim(input: unknown): ClaimParse {
  const o = (input ?? {}) as Record<string, unknown>;
  const L = PLACE_LIMITS.claim;
  const text = (k: keyof typeof L, required: boolean): string | { field: string; reason: string } => {
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
    if (required && !v) return { field: k, reason: "required" };
    if (v.length > L[k]) return { field: k, reason: `at most ${L[k]} characters` };
    return v;
  };
  const build = text("build", true);
  if (typeof build !== "string") return { ok: false, ...build };
  const team = text("team", false);
  if (typeof team !== "string") return { ok: false, ...team };
  const timeline = text("timeline", true);
  if (typeof timeline !== "string") return { ok: false, ...timeline };
  const crews = text("crews", false);
  if (typeof crews !== "string") return { ok: false, ...crews };
  const f = (o.funds ?? {}) as Record<string, unknown>;
  const note = typeof f.note === "string" ? f.note.trim() : "";
  if (note.length > L.funds) return { ok: false, field: "funds", reason: `at most ${L.funds} characters` };
  let amountMinor: number | null = null;
  if (f.amountMinor !== undefined && f.amountMinor !== null && f.amountMinor !== "") {
    const n = Number(f.amountMinor);
    if (!Number.isSafeInteger(n) || n < 0) return { ok: false, field: "funds", reason: "a whole amount of 0 or more" };
    amountMinor = n;
  }
  const unit = typeof f.unit === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(f.unit) ? f.unit : null;
  if (amountMinor !== null && amountMinor > 0 && !unit) return { ok: false, field: "funds", reason: "name the unit of the amount" };
  return { ok: true, claim: { build, team, funds: { amountMinor, unit, note }, timeline, crews } };
}

/** Absolute counts for the preserve (US6.3). Never a ranking, never a share. */
export function preserveCounts(places: Array<{ inPreserve: Tri; inRiparianBuffer: Tri; footprintM2: number | null }>) {
  let footprintM2 = 0;
  let withFootprint = 0;
  let inPreserve = 0;
  let inBuffer = 0;
  let unanswered = 0;
  for (const p of places) {
    if (typeof p.footprintM2 === "number" && p.footprintM2 > 0) { footprintM2 += p.footprintM2; withFootprint++; }
    if (p.inPreserve === "yes") inPreserve++;
    if (p.inRiparianBuffer === "yes") inBuffer++;
    if (p.inPreserve === "unknown" || p.inRiparianBuffer === "unknown") unanswered++;
  }
  return { footprintM2, withFootprint, inPreserve, inBuffer, unanswered };
}

/* ── The village seed (US1.6-1.8) ─────────────────────────────────────────── */

/**
 * What a dispute is about. `exists` and `match` put the place itself in doubt,
 * so the place cannot be confirmed; `position`, `count` and `size` doubt a
 * detail of a place whose existence is not in question.
 */
export const DISPUTE_KINDS = ["exists", "match", "position", "count", "size"] as const;
export type DisputeKind = (typeof DISPUTE_KINDS)[number];
export interface SeedDispute { kind: DisputeKind; topic: string; sources: string[]; toSettle: string }

/** Is the place itself in doubt? */
export function placeInDoubt(disputes: readonly { kind: DisputeKind }[] | undefined): boolean {
  return (disputes ?? []).some((d) => d.kind === "exists" || d.kind === "match");
}

/** Stages that claim something stands or is being raised. Never on an unconfirmed place. */
export const STANDING_STAGES: readonly PlaceStage[] = ["building", "built", "in_use", "needs_care"];
export interface SeedPlace {
  key: string;
  name: string;
  zone: string | null;
  kind: PlaceKind;
  stage: PlaceStage | null;
  confirmed: boolean;
  onMap?: boolean;
  proposedMatch?: string;
  zoneProposed?: boolean;
  phase?: string;
  positionText: string;
  description: string;
  disputes?: SeedDispute[];
  stewardRoleTitle?: string;
  roleTitles?: string[];
  temporary?: { successor: string | null };
  setAside?: { reason: string };
  partOf?: string;
  serves?: string[];
  vitals?: string[];
  childSafeZone?: boolean;
  isHome?: boolean;
  targetDate?: string;
}
export interface PlacesSeed {
  version: number;
  zones: Array<{ key: string; name: string; order: number; positionText: string }>;
  places: SeedPlace[];
  permits: PermitItem[];
  registryDisputes?: SeedDispute[];
}

/**
 * Every problem with a seed, or an empty list. `liveKeys` are the keys on the
 * village's published map: none may be dropped (US1.7). A place with a dispute
 * may not be confirmed (US1.8).
 */
export function seedProblems(seed: PlacesSeed, liveKeys: readonly string[]): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  const folded = new Map<string, string>();
  const zones = new Set(seed.zones.map((z) => z.key));
  for (const p of seed.places) {
    if (!(p.onMap ? isLegacyPlaceKey(p.key) : isPlaceKey(p.key))) out.push(`${p.key}: not a valid place key`);
    if (keys.has(p.key)) out.push(`${p.key}: listed twice`);
    keys.add(p.key);
    const f = p.key.toLowerCase();
    if (folded.has(f)) out.push(`${p.key}: differs from ${folded.get(f)} only by case`);
    folded.set(f, p.key);
    if (!(PLACE_KINDS as readonly string[]).includes(p.kind)) out.push(`${p.key}: unknown kind ${p.kind}`);
    if (p.zone !== null && !zones.has(p.zone)) out.push(`${p.key}: unknown zone ${p.zone}`);
    if (p.stage !== null && !isStage(p.stage)) out.push(`${p.key}: unknown stage ${p.stage}`);
    if (p.stage === null && !KINDS_WITHOUT_LIFECYCLE.includes(p.kind)) out.push(`${p.key}: a ${p.kind} needs a stage`);
    if (p.stage !== null && KINDS_WITHOUT_LIFECYCLE.includes(p.kind)) out.push(`${p.key}: a ${p.kind} carries no stage`);
    for (const d of p.disputes ?? []) if (!(DISPUTE_KINDS as readonly string[]).includes(d.kind)) out.push(`${p.key}: unknown dispute kind ${d.kind}`);
    if (placeInDoubt(p.disputes) && p.confirmed) out.push(`${p.key}: is in doubt but marked confirmed`);
    if (p.proposedMatch && !p.disputes?.some((d) => d.kind === "match")) out.push(`${p.key}: a proposed match needs a match dispute until it is confirmed`);
    if (p.stage !== null && STANDING_STAGES.includes(p.stage) && !p.confirmed) out.push(`${p.key}: ${p.stage} on an unconfirmed place`);
    if (p.onMap && !liveKeys.includes(p.key)) out.push(`${p.key}: marked on the map, but the map has no such key`);
    if (!p.onMap && liveKeys.includes(p.key)) out.push(`${p.key}: is on the map but not marked onMap`);
    if (p.name.length > PLACE_LIMITS.name) out.push(`${p.key}: name over ${PLACE_LIMITS.name} characters`);
    if (p.positionText.length > PLACE_LIMITS.positionText) out.push(`${p.key}: position text too long`);
    if (p.setAside && !p.setAside.reason.trim()) out.push(`${p.key}: set aside with no reason`);
  }
  for (const k of liveKeys) if (!keys.has(k)) out.push(`${k}: on the map but missing from the registry`);
  for (const p of seed.places) {
    for (const ref of [p.temporary?.successor, p.partOf, ...(p.serves ?? [])]) {
      if (ref && !keys.has(ref)) out.push(`${p.key}: refers to unknown place ${ref}`);
    }
  }
  const cycle = findPermitCycle(seed.permits);
  if (cycle) out.push(`permits wait on each other in a circle: ${cycle.join(" > ")}`);
  for (const i of seed.permits) {
    if (!keys.has(i.place)) out.push(`permit ${i.id}: unknown place ${i.place}`);
    for (const w of i.waitsOn ?? []) if (!seed.permits.some((x) => x.id === w)) out.push(`permit ${i.id}: waits on unknown ${w}`);
  }
  return out;
}
