/**
 * A STRUCTURE CHANGE, READ WHOLE: what one arrival from an outside service
 * would do to this village's chart, and what a steward decided about it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The first real vendor sync (2026-10-09) arrived as nineteen proposals: one
 * `circle.proposed` per circle and ONE `org.proposed` holding every seat. The
 * review queue could take that batch only whole. It could not drop one seat out
 * of the structure (the structure is one proposal), it could not turn a seat
 * that already exists here into an update of the live seat (an identical name
 * stays blocked by the preview), it could not retire the old chart, and it
 * could not show what any of it changed. Accepting it put six new circles
 * beside seventeen live ones and four seats that could never publish.
 *
 * So the batch is read here into a PLAN (`planStructure`), and a steward's
 * choices are applied to that plan (`decideStructure`) to produce the exact
 * draft changes, counts and refusals. Both halves are pure and shared: the page
 * runs `decideStructure` on every toggle, the server runs the same function on
 * accept, and a count the page shows is the count the server will write.
 *
 * ── THE RULES IT KEEPS ───────────────────────────────────────────────────
 *
 * - A seat MATCHES a live seat by the rule `previewLoadedDraft` blocks on: the
 *   trimmed, lowercased name of an active, non-example seat. Two proposed seats
 *   may match one live seat, and only one of them may take it over.
 * - A match is never decided for the steward. Each one is unsettled until it is
 *   moved onto the live seat, added under a new name the steward types, or left
 *   out, and an unsettled one refuses the accept.
 * - Moving onto a live seat is an `update_seat`: the seat keeps its id, so it
 *   keeps everyone who holds it, and takes the new circle and the new wording.
 * - Retiring the old chart never unseats anybody. A seat somebody holds is not
 *   retired; it is listed as "carry people first". A circle is retired only when
 *   nothing would be left in it (Rye's rule on the old chart, 2026-09-15:
 *   nothing retires until every current holder has a seat in the new one).
 * - Nothing here reads the vendor's `Notes` as a purpose, and nothing here
 *   reads who holds a seat from the vendor. Holder counts are this village's.
 * - Geography is never invented. A circle sits inside another only when its
 *   payload names a parent this village can place.
 *
 * Pure: no pool, no clock.
 */
import { circlesNamed, readProposedSeats, type CircleProblem, type LiveCircle } from "./proposedSeats";

/** The proposal kinds that change the chart. Everything else in a batch is a note. */
export const STRUCTURE_KINDS = ["org.proposed", "role.proposed", "circle.proposed"] as const;

const isStructureKind = (k: string): boolean => (STRUCTURE_KINDS as readonly string[]).includes(k);

/** Where a circle proposal keeps its name: ours first, then the vendor's own key. */
export const CIRCLE_PROPOSAL_NAME_KEYS = ["name", "Circle Name"] as const;

/** A circle proposal's name, or "" when it carries none. A blank `name` says nothing. */
export function proposedCircleName(payload: Record<string, unknown>): string {
  for (const k of CIRCLE_PROPOSAL_NAME_KEYS) {
    const v = payload[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

/**
 * A slug from text, bounded BEFORE it is trimmed and trimmed without a regex
 * (the `-+$` alternation is a polynomial ReDoS on an unbounded vendor string).
 */
function slugOf(text: string, max: number): string {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, max);
  while (slug.startsWith("-")) slug = slug.slice(1);
  while (slug.endsWith("-")) slug = slug.slice(0, -1);
  return slug;
}

/** The id a proposed circle gets: its name as a slug, or one derived from the proposal. */
export function circleIdFor(name: string, proposalId: string): string {
  const slug = slugOf(name, 56);
  return slug !== "" ? slug : `circle-${proposalId.toLowerCase()}`;
}

/**
 * The id a proposed seat gets. The vendor's id slugified, never used raw, and
 * a fallback when nothing slug-shaped is left (`org_roles.id` is also a URL and
 * a path segment, so it has to match `^[a-z0-9][a-z0-9-]{0,63}$`).
 */
export function seatIdFor(vendorId: unknown, fallback: string): string {
  const slug = slugOf(String(vendorId ?? ""), 64);
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : fallback;
}

/** The trimmed, lowercased name the preview's duplicate check compares. */
export const seatNameKey = (name: unknown): string => String(name ?? "").trim().toLowerCase();

// ── Inputs ───────────────────────────────────────────────────────────────

export interface PlanProposal {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface PlanLiveCircle {
  id: string;
  name: string;
  aliases?: unknown;
  parentCircleId: string | null;
  status: string;
  isExample: boolean;
}

export interface PlanLiveSeat {
  id: string;
  name: string;
  circleId: string | null;
  active: boolean;
  isExample: boolean;
  /** How many people hold it now, from this village's own seatings. */
  holders: number;
}

// ── The plan ─────────────────────────────────────────────────────────────

export interface PlanCircle {
  /** The include key: the proposal id. */
  key: string;
  proposalId: string;
  name: string;
  /** The id the draft would create, or the live circle this one already is. */
  id: string;
  /** `new` makes a circle. `live` names a circle this village already has. */
  status: "new" | "live";
  parentId: string | null;
  purpose: string | null;
  /** Why this circle cannot be accepted as sent, or null. */
  problem: string | null;
  /** The payload exactly as it arrived, for "What was sent". */
  sent: Record<string, unknown>;
}

export interface PlanSeatMatch {
  seatId: string;
  name: string;
  circleId: string | null;
  holders: number;
}

export interface PlanSeat {
  /** The include key: `<proposal id>#<index in its proposal>`. */
  key: string;
  proposalId: string;
  index: number;
  /** The id a create_seat would use. */
  id: string;
  name: string;
  aim: string | null;
  circleId: string | null;
  /** The circle's name could not be placed, said in a sentence. */
  circleProblem: string | null;
  /** The canonical create_seat payload `readProposedSeats` produced. */
  payload: Record<string, unknown>;
  /** The live seat this one is named the same as, or null. */
  match: PlanSeatMatch | null;
  /** Why this seat cannot be accepted as sent, besides a match, or null. */
  problem: string | null;
  sent: Record<string, unknown>;
}

export interface StructurePlan {
  circles: PlanCircle[];
  seats: PlanSeat[];
  /** The live chart this plan was read against, examples left out. */
  live: { circles: PlanLiveCircle[]; seats: PlanLiveSeat[] };
  /** Proposals in the batch that change no structure (risks, tensions...). */
  notes: Array<{ proposalId: string; kind: string }>;
}

function circleProblemWords(p: CircleProblem): string {
  if (p.kind === "ambiguous") return `More than one circle answers to "${p.name}"`;
  if (p.kind === "unreadable") return `Its circle came in a form this village cannot read (${p.name})`;
  return `There is no circle called "${p.name}" here or in this change`;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Read a batch against the live chart.
 *
 * Circle proposals first, because seats name their circle in words and the
 * circles this batch makes are part of what those words may mean. A circle
 * proposal whose name a live circle already answers to is `live`: it makes
 * nothing, and the seats naming it land in the live circle. Placing a seat
 * against a live circle AND a new circle of the same name would match two and
 * block as ambiguous, so the new one is never offered.
 */
export function planStructure(
  proposals: readonly PlanProposal[],
  liveCircles: readonly PlanLiveCircle[],
  liveSeats: readonly PlanLiveSeat[],
): StructurePlan {
  const circlesLive = liveCircles.filter((c) => !c.isExample);
  const seatsLive = liveSeats.filter((s) => !s.isExample && s.active);
  const liveCircleIds = new Set(liveCircles.map((c) => c.id));
  const asLive: LiveCircle[] = liveCircles.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, isExample: c.isExample }));

  const notes: StructurePlan["notes"] = [];
  const circles: PlanCircle[] = [];
  const takenIds = new Set<string>();
  const newNames = new Set<string>();

  for (const p of proposals) {
    if (!isStructureKind(p.kind)) {
      notes.push({ proposalId: p.id, kind: p.kind });
      continue;
    }
    if (p.kind !== "circle.proposed") continue;
    const name = proposedCircleName(p.payload);
    const purpose = text(p.payload.purpose);
    const answers = name ? circlesNamed(name, asLive) : [];
    if (answers.length === 1) {
      circles.push({
        key: p.id, proposalId: p.id, name, id: answers[0], status: "live",
        parentId: null, purpose, problem: null, sent: p.payload,
      });
      continue;
    }
    const id = circleIdFor(name, p.id);
    let problem: string | null = null;
    if (name === "") problem = "This circle came with no name";
    else if (answers.length > 1) problem = `More than one live circle answers to "${name}"`;
    else if (liveCircleIds.has(id)) problem = `A circle with the id "${id}" already exists under another name`;
    else if (newNames.has(name.toLowerCase()) || takenIds.has(id)) problem = `"${name}" arrived twice in this batch`;
    if (!problem) {
      takenIds.add(id);
      newNames.add(name.toLowerCase());
    }
    circles.push({ key: p.id, proposalId: p.id, name, id, status: "new", parentId: null, purpose, problem, sent: p.payload });
  }

  // The circles a seat may be placed in: every live one, and each new one
  // this batch can make.
  const madeHere = circles.filter((c) => c.status === "new" && !c.problem);
  const placeable: LiveCircle[] = [...asLive, ...madeHere.map((c) => ({ id: c.id, name: c.name }))];
  const knownIds = new Set<string>([...liveCircles.map((c) => c.id), ...madeHere.map((c) => c.id)]);

  // A parent only when the payload names one this village can place.
  for (const c of circles) {
    if (c.status !== "new") continue;
    const raw = text(c.sent.parentCircleId) ?? text(c.sent.parentCircleName);
    if (!raw) continue;
    const viaId = knownIds.has(raw) ? raw : null;
    const viaName = viaId ? null : circlesNamed(raw, placeable);
    const parent = viaId ?? (viaName && viaName.length === 1 ? viaName[0] : null);
    if (parent && parent !== c.id) c.parentId = parent;
    else if (!c.problem) c.problem = `Its parent "${raw}" is not a circle this village can place`;
  }

  const liveByName = new Map<string, PlanLiveSeat>();
  for (const s of seatsLive) liveByName.set(seatNameKey(s.name), s);
  const liveSeatIds = new Set(liveSeats.map((s) => s.id));

  const seats: PlanSeat[] = [];
  for (const p of proposals) {
    if (p.kind !== "org.proposed" && p.kind !== "role.proposed") continue;
    let read: ReturnType<typeof readProposedSeats>;
    try {
      read = readProposedSeats(p.payload, placeable);
    } catch {
      continue;
    }
    const rawList = Array.isArray(p.payload.seats)
      ? (p.payload.seats as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
      : [p.payload];
    read.seats.forEach((seat, index) => {
      const name = typeof seat.payload.name === "string" ? seat.payload.name : "";
      const live = name ? liveByName.get(seatNameKey(name)) : undefined;
      const id = seatIdFor(seat.vendorId, `orgrole-${p.id.toLowerCase()}-${index + 1}`);
      const circleId = typeof seat.payload.circleId === "string" && seat.payload.circleId ? seat.payload.circleId : null;
      let problem: string | null = null;
      if (name.trim() === "") problem = "This seat came with no name";
      else if (liveSeatIds.has(id)) problem = `A seat with the id "${id}" already exists`;
      seats.push({
        key: `${p.id}#${index}`,
        proposalId: p.id,
        index,
        id,
        name,
        aim: text(seat.payload.aim),
        circleId,
        circleProblem: seat.circleProblem ? circleProblemWords(seat.circleProblem) : null,
        payload: seat.payload,
        match: live ? { seatId: live.id, name: live.name, circleId: live.circleId, holders: live.holders } : null,
        problem,
        sent: rawList[index] ?? {},
      });
    });
  }

  return { circles, seats, live: { circles: circlesLive, seats: seatsLive }, notes };
}

// ── The steward's decisions ─────────────────────────────────────────────

/** What happens to one proposed seat named the same as a live seat. */
export type ConflictChoice =
  | { choice: "update" }
  | { choice: "rename"; name: string }
  | { choice: "leave" };

export interface StructureDecisions {
  /** Keys left out: a circle's proposal id, or a seat's `<proposal>#<index>`. */
  exclude?: readonly string[];
  /** Per matched seat key. A matched seat with no entry is unsettled. */
  conflicts?: Readonly<Record<string, ConflictChoice>>;
  /** Retire what the old chart leaves empty, in the same change. */
  retireOldChart?: boolean;
}

export interface DecidedChange {
  op: "create_circle" | "create_seat" | "update_seat" | "rest_seat" | "rest_circle";
  orgRoleId: string;
  payload: Record<string, unknown>;
}

export interface RetireSet {
  seats: Array<{ id: string; name: string; circleId: string | null }>;
  circles: Array<{ id: string; name: string }>;
  /** Old seats somebody holds. They stay until their people have a seat in the new chart. */
  carryFirst: Array<{ id: string; name: string; circleId: string | null; holders: number }>;
}

export interface DecidedStructure {
  changes: DecidedChange[];
  counts: {
    newCircles: number;
    newSeats: number;
    /** Kept seats named the same as a live seat. */
    matched: number;
    /** Of those, how many still need a choice. */
    unsettled: number;
    updates: number;
    retiringCircles: number;
    retiringSeats: number;
    /** Circles and seats kept in this change, the number the bar says. */
    kept: number;
  };
  /** What retiring the old chart would do. Filled whether or not it is switched on. */
  retire: RetireSet;
  /** Every seat key that is in the change, with its final name. */
  keptSeats: Array<{ key: string; name: string; via: "create" | "update" | "rename" }>;
  /** Proposals the accept decides whole. */
  accepted: string[];
  /** Structures split in two: the kept seats go in the draft, the rest stay queued. */
  split: Array<{ proposalId: string; kept: number[]; left: number[] }>;
  /** Proposals this accept does not touch. They stay in the queue. */
  untouched: string[];
  /** Every reason the accept would be refused. Empty means it may go ahead. */
  problems: string[];
}

/** The seat fields an update carries across. `seats` is never one: the live count holds its people. */
const UPDATE_FIELDS = ["name", "aim", "domain", "whyItMatters", "accountabilities", "criticality", "recruiting"] as const;

/**
 * Apply a steward's decisions to a plan.
 *
 * Never throws and never guesses. Anything the steward has not settled, or
 * cannot apply, is a sentence in `problems`, and the server refuses the accept
 * while that list has anything in it.
 *
 * `actor` is stamped on every retire change, which is how the preview tells a
 * steward's own retirement apart from a machine proposing one.
 */
export function decideStructure(
  plan: StructurePlan,
  decisions: StructureDecisions,
  actor = "",
): DecidedStructure {
  const out = new Set<string>();
  for (const k of decisions.exclude ?? []) out.add(k);
  const conflicts = decisions.conflicts ?? {};
  const problems: string[] = [];
  const inChange = (key: string) => !out.has(key);

  const circleById = new Map<string, PlanCircle>();
  for (const c of plan.circles) if (c.status === "new" && !c.problem) circleById.set(c.id, c);
  const liveCircleName = new Map(plan.live.circles.map((c) => [c.id, c.name]));
  const nameOfCircle = (id: string | null): string =>
    id === null ? "the village" : (circleById.get(id)?.name ?? liveCircleName.get(id) ?? id);

  const keptCircles = plan.circles.filter((c) => inChange(c.key));
  for (const c of keptCircles) {
    if (c.problem) problems.push(`${c.name || "A circle"}: ${c.problem}. Leave it out to go ahead.`);
  }
  const keptNew = keptCircles.filter((c) => c.status === "new" && !c.problem);
  const keptNewIds = new Set(keptNew.map((c) => c.id));
  const leftOutNewIds = new Set(plan.circles.filter((c) => c.status === "new" && !inChange(c.key)).map((c) => c.id));
  for (const c of keptNew) {
    if (c.parentId && leftOutNewIds.has(c.parentId)) {
      problems.push(`"${c.name}" sits inside "${nameOfCircle(c.parentId)}", which is left out. Keep both or leave both out.`);
    }
  }

  // Seats: the ones in the change, and what each one becomes.
  const liveNames = new Set(plan.live.seats.map((s) => seatNameKey(s.name)));
  const keptSeats: DecidedStructure["keptSeats"] = [];
  const creates: PlanSeat[] = [];
  const renames = new Map<string, string>();
  const updates: PlanSeat[] = [];
  let matched = 0;
  let unsettled = 0;
  for (const s of plan.seats) {
    if (!inChange(s.key)) continue;
    const choice = s.match ? conflicts[s.key] : undefined;
    if (choice?.choice === "leave") continue;
    if (s.problem) problems.push(`${s.name || "A seat"}: ${s.problem}. Leave it out to go ahead.`);
    if (s.circleProblem) problems.push(`"${s.name}": ${s.circleProblem}. Leave it out to go ahead.`);
    if (s.circleId && leftOutNewIds.has(s.circleId)) {
      problems.push(`"${s.name}" sits in "${nameOfCircle(s.circleId)}", which is left out. Keep the circle or leave the seat out.`);
    }
    if (!s.match) {
      creates.push(s);
      keptSeats.push({ key: s.key, name: s.name, via: "create" });
      continue;
    }
    matched += 1;
    if (!choice) {
      unsettled += 1;
      continue;
    }
    if (choice.choice === "update") {
      updates.push(s);
      keptSeats.push({ key: s.key, name: s.name, via: "update" });
    } else {
      const typed = String(choice.name ?? "").trim();
      renames.set(s.key, typed);
      creates.push(s);
      keptSeats.push({ key: s.key, name: typed, via: "rename" });
    }
  }
  if (unsettled > 0) {
    problems.push(
      unsettled === 1
        ? "One seat already exists here. Choose what happens to it."
        : `${unsettled} seats already exist here. Choose what happens to each one.`,
    );
  }

  // Two proposed seats may not both take over one live seat.
  const takenBy = new Map<string, PlanSeat>();
  for (const s of updates) {
    const prior = takenBy.get(s.match!.seatId);
    if (prior) {
      problems.push(
        `"${s.match!.name}" can move only once. One of its two matches has to be added under a new name or left out.`,
      );
    } else takenBy.set(s.match!.seatId, s);
  }

  // A typed name has to be a name of its own.
  const finalNames = new Map<string, number>();
  for (const k of keptSeats) if (k.via !== "update") finalNames.set(seatNameKey(k.name), (finalNames.get(seatNameKey(k.name)) ?? 0) + 1);
  for (const [key, typed] of Array.from(renames.entries())) {
    const seat = plan.seats.find((s) => s.key === key)!;
    if (typed === "") problems.push(`Type a new name for the second "${seat.name}", or choose another option.`);
    else if (typed.length > 120) problems.push(`"${typed.slice(0, 40)}" is longer than a seat name can be.`);
    else if (liveNames.has(seatNameKey(typed))) problems.push(`A live seat is already called "${typed}". Type a name of its own.`);
    else if ((finalNames.get(seatNameKey(typed)) ?? 0) > 1) problems.push(`Two seats in this change would be called "${typed}".`);
  }

  // ── Retiring the old chart ──
  const retire = retireSet(plan, {
    keptNew,
    keptLive: keptCircles.filter((c) => c.status === "live"),
    creates,
    updates,
  });
  const retiring = decisions.retireOldChart === true;

  // ── The changes, in the order publish applies them ──
  const changes: DecidedChange[] = [];
  for (const c of parentsFirst(keptNew)) {
    changes.push({
      op: "create_circle",
      orgRoleId: `circle:${c.id}`,
      payload: { name: c.name, purpose: c.purpose, parentCircleId: c.parentId },
    });
  }
  for (const s of updates) {
    const payload: Record<string, unknown> = {};
    for (const k of UPDATE_FIELDS) if (s.payload[k] !== undefined) payload[k] = s.payload[k];
    if (s.circleId) payload.circleId = s.circleId;
    changes.push({ op: "update_seat", orgRoleId: s.match!.seatId, payload });
  }
  for (const s of creates) {
    const renamed = renames.get(s.key);
    changes.push({
      op: "create_seat",
      orgRoleId: s.id,
      payload: renamed !== undefined ? { ...s.payload, name: renamed } : { ...s.payload },
    });
  }
  if (retiring) {
    for (const s of retire.seats) changes.push({ op: "rest_seat", orgRoleId: s.id, payload: { chosenBy: actor, retiring: "old-chart" } });
    for (const c of retire.circles) changes.push({ op: "rest_circle", orgRoleId: `circle:${c.id}`, payload: { chosenBy: actor, retiring: "old-chart" } });
  }

  // ── What happens to each proposal ──
  const accepted: string[] = [];
  const split: DecidedStructure["split"] = [];
  const untouched: string[] = [];
  const keptKeys = new Set(keptSeats.map((k) => k.key));
  for (const c of plan.circles) (inChange(c.key) ? accepted : untouched).push(c.proposalId);
  const seatProposals = Array.from(new Set(plan.seats.map((s) => s.proposalId)));
  for (const pid of seatProposals) {
    const mine = plan.seats.filter((s) => s.proposalId === pid);
    const kept = mine.filter((s) => keptKeys.has(s.key)).map((s) => s.index);
    const left = mine.filter((s) => !keptKeys.has(s.key)).map((s) => s.index);
    if (kept.length === 0) untouched.push(pid);
    else if (left.length === 0) accepted.push(pid);
    else split.push({ proposalId: pid, kept, left });
  }
  for (const n of plan.notes) untouched.push(n.proposalId);

  const kept = keptCircles.length + keptSeats.length;
  if (kept === 0) problems.push("Nothing is kept in this change yet.");

  return {
    changes,
    counts: {
      newCircles: keptNew.length,
      newSeats: creates.length,
      matched,
      unsettled,
      updates: updates.length,
      retiringCircles: retiring ? retire.circles.length : 0,
      retiringSeats: retiring ? retire.seats.length : 0,
      kept,
    },
    retire,
    keptSeats,
    accepted,
    split,
    untouched,
    problems,
  };
}

/** New circles with every parent before its children, so a publish never makes a child first. */
function parentsFirst(list: PlanCircle[]): PlanCircle[] {
  const ids = new Set(list.map((c) => c.id));
  const done = new Set<string>();
  const ordered: PlanCircle[] = [];
  let guard = list.length + 1;
  while (ordered.length < list.length && guard-- > 0) {
    for (const c of list) {
      if (done.has(c.id)) continue;
      if (c.parentId && ids.has(c.parentId) && !done.has(c.parentId)) continue;
      done.add(c.id);
      ordered.push(c);
    }
  }
  // A loop cannot be made from parents this plan resolved, but nothing is ever dropped.
  for (const c of list) if (!done.has(c.id)) ordered.push(c);
  return ordered;
}

/**
 * What "retire the old chart" would take away.
 *
 * Every live seat not taken over by a kept seat is old. An old seat nobody
 * holds retires; one somebody holds stays and is listed to carry first. A live
 * circle retires when, after this change, nothing is left in it: no seat that
 * stays, no seat moved or made into it, no circle inside it that stays, and no
 * kept proposal naming it. Worked from the leaves up, so a parent empties once
 * its children have.
 */
function retireSet(
  plan: StructurePlan,
  kept: { keptNew: PlanCircle[]; keptLive: PlanCircle[]; creates: PlanSeat[]; updates: PlanSeat[] },
): RetireSet {
  const taken = new Set(kept.updates.map((s) => s.match!.seatId));
  const seats: RetireSet["seats"] = [];
  const carryFirst: RetireSet["carryFirst"] = [];
  const staysIn = new Map<string, number>();
  const bump = (id: string | null) => {
    if (id) staysIn.set(id, (staysIn.get(id) ?? 0) + 1);
  };
  for (const s of plan.live.seats) {
    if (taken.has(s.id)) continue;
    if (s.holders > 0) {
      carryFirst.push({ id: s.id, name: s.name, circleId: s.circleId, holders: s.holders });
      bump(s.circleId);
    } else {
      seats.push({ id: s.id, name: s.name, circleId: s.circleId });
    }
  }
  for (const s of kept.updates) bump(s.circleId ?? s.match!.circleId);
  for (const s of kept.creates) bump(s.circleId);
  for (const c of kept.keptLive) bump(c.id);
  for (const c of kept.keptNew) bump(c.parentId);

  const live = plan.live.circles.filter((c) => c.status !== "dormant");
  const retired = new Set<string>();
  // In the order they empty, so a circle always rests after the circles inside it.
  const order: Array<{ id: string; name: string }> = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const c of live) {
      if (retired.has(c.id) || (staysIn.get(c.id) ?? 0) > 0) continue;
      const childStays = live.some((k) => k.parentCircleId === c.id && !retired.has(k.id));
      if (childStays) continue;
      retired.add(c.id);
      order.push({ id: c.id, name: c.name });
      moved = true;
    }
  }
  return {
    seats,
    circles: order,
    carryFirst,
  };
}
