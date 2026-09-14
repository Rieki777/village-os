/**
 * A seat as an outside service describes it, read into the shape a draft takes.
 *
 * ── THE DEFECT THIS REPLACES ─────────────────────────────────────────────
 *
 * The accept path in server/routes/review.ts used to copy an allowlist of key
 * names out of each proposed seat and drop everything else without a word.
 * The first real vendor batch spelled the seat's name `role_name`, its holder
 * count `seat_count`, gave its circle as a NAME under `circle`, and sent the
 * accountabilities as one string separated by "; ". Every one of those was
 * dropped, so all nineteen seats previewed as "A seat needs a name", and the
 * steward was shown a draft that could never publish with no hint that the
 * vendor had said plenty.
 *
 * Worse than the loud failure was the quiet one next to it. A seat that DID
 * carry a name but described its circle by an unknown key would have
 * published into no circle at all, because the preview only refuses a
 * `circleId` that does not exist and never a missing one.
 *
 * ── WHAT THIS DOES, AND THE ONE THING IT NEVER DOES ──────────────────────
 *
 * It accepts a short, fixed list of vendor spellings, resolves a circle NAME
 * against this village's own circles, splits a string of accountabilities into
 * a list, and REPORTS every key it did not read. It never invents a value: a
 * circle name that matches nothing, or matches more than one circle, stays a
 * name (`circleName`) and `previewDraft` blocks the seat with a sentence
 * saying what to do.
 *
 * ── IDEMPOTENT, BECAUSE A PAYLOAD COMES THROUGH HERE MORE THAN ONCE ──────
 *
 * A withdrawn draft puts its proposals back in the queue carrying whatever the
 * steward edited, which is usually already canonical. Accepting again runs it
 * through this function a second time, so a canonical payload has to come out
 * unchanged. The one thing that legitimately changes on a second pass is a
 * `circleName` that now resolves, because an admin created that circle in
 * between, which is exactly the recovery the preview's sentence asks for.
 *
 * ── A SECOND ALLOWLIST, NARROWER THAN SEAT_FIELDS ON PURPOSE ─────────────
 *
 * `SEAT_FIELDS` in orgDrafts.ts governs what a DRAFT may change and excludes
 * `represents_circle`, `how_chosen`, `status_override` and
 * `compensation_reality` by construction. The list here governs what a
 * PROPOSAL may put into a draft. A founder writing a draft by hand is a person
 * deciding; everything arriving here was written by something that read a
 * transcript.
 *
 * Pure: no pool, no clock, no imports. The caller hands in the circle list.
 */

/** A circle as `circlesRepo.all()` returns it. Only these fields are read. */
export interface LiveCircle {
  id: unknown;
  name?: unknown;
  aliases?: unknown;
  isExample?: unknown;
}

/**
 * The keys a proposed seat's canonical payload may carry.
 *
 * `circleName` and `circleMatches` exist only when a circle name could not be
 * placed, and `previewDraft` blocks any seat that carries them without a
 * `circleId`.
 */
export const PROPOSABLE_SEAT_FIELDS = [
  "name",
  "circleId",
  "circleName",
  "circleMatches",
  "aim",
  "domain",
  "accountabilities",
  "whyItMatters",
  "seats",
  "criticality",
  "recruiting",
] as const;

/**
 * Vendor spellings, per canonical key, in the order they are tried. When the
 * canonical key and an alias both carry a value, the canonical key wins.
 */
export const SEAT_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  name: ["role_name", "roleName"],
  seats: ["seat_count", "seatCount"],
  whyItMatters: ["why_it_matters"],
  circleId: ["circle_id"],
};

/** Keys that give a circle by NAME, tried in this order. An id beats all of them. */
export const CIRCLE_NAME_KEYS = ["circleName", "circle_name", "circle"] as const;

/**
 * Keys the accept path reads for itself and never puts in a seat payload:
 * `id` becomes the seat's slug (`seatIdFor`), and `title` and `rationale` name
 * the draft. Read, so never reported as ignored.
 */
export const STRUCTURAL_SEAT_KEYS = ["id", "title", "rationale"] as const;

/** Keys a whole-structure payload (`org.proposed`) carries around its seat list. */
const ENVELOPE_KEYS = new Set(["title", "rationale", "seats"]);

export interface CircleProblem {
  /** `unknown` matched no live circle; `ambiguous` matched more than one. */
  kind: "unknown" | "ambiguous";
  /** The name exactly as the proposal sent it. */
  name: string;
  /** The ids of the circles it matched. Empty for `unknown`. */
  matches: string[];
}

export interface NormalisedSeat {
  /** What goes into the `create_seat` change. */
  payload: Record<string, unknown>;
  /** The vendor's own id for this seat, untouched, for `seatIdFor`. */
  vendorId: unknown;
  /** Every key present on the seat that nothing read, in the order it arrived. */
  ignored: string[];
  /** Set when a circle was given by name and could not be placed. */
  circleProblem: CircleProblem | null;
}

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const carries = (v: unknown): boolean => v !== undefined && v !== null;
const fold = (v: unknown): string => String(v).trim().toLowerCase();

/**
 * A list of accountabilities out of whatever the vendor sent.
 *
 * A string is split on ";" and on newlines, each part trimmed, one trailing
 * period dropped, and empty parts dropped. A period in the middle of a string
 * is NOT a separator: sentences inside one accountability are common, and
 * splitting on them would turn one duty into three fragments.
 *
 * An array passes through with items trimmed and empties dropped. `null`
 * passes through as `null`. Anything else is `undefined`, which the caller
 * reports as an ignored key, because a number or an object here is a value
 * the seat would silently lose at publish.
 */
export function normaliseAccountabilities(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    return v
      .split(/[;\r\n]+/)
      .map((s) => s.trim().replace(/\.$/, "").trim())
      .filter((s) => s !== "");
  }
  if (Array.isArray(v)) {
    return v
      .filter((s) => typeof s === "string" || typeof s === "number" || typeof s === "boolean")
      .map((s) => String(s).trim())
      .filter((s) => s !== "");
  }
  return undefined;
}

/**
 * The live circles a name answers to: case-insensitive, trimmed, on the
 * circle's name or any of its aliases. Standing example circles never match,
 * for the reason the preview ignores them: a draft must not become the one
 * door that files real seats under demo data.
 */
export function circlesNamed(name: string, circles: readonly LiveCircle[]): string[] {
  const wanted = fold(name);
  if (wanted === "") return [];
  const ids: string[] = [];
  for (const c of circles) {
    if (!c || c.id === undefined || c.id === null) continue;
    if (c.isExample === true || c.isExample === 1 || c.isExample === "1") continue;
    const aliases = Array.isArray(c.aliases) ? c.aliases : [];
    const hit = (carries(c.name) && fold(c.name) === wanted) || aliases.some((a) => carries(a) && fold(a) === wanted);
    const id = String(c.id);
    if (hit && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** One proposed seat, read into its canonical payload. */
export function normaliseProposedSeat(raw: Record<string, unknown>, circles: readonly LiveCircle[]): NormalisedSeat {
  const read = new Set<string>();
  const unusable = new Set<string>();
  const out: Record<string, unknown> = {};

  /** The first key, canonical then aliases, that carries a value. Every present key counts as read. */
  const pick = (canonical: string): { key: string; value: unknown } | null => {
    let found: { key: string; value: unknown } | null = null;
    let nullish: { key: string; value: unknown } | null = null;
    for (const k of [canonical, ...(SEAT_KEY_ALIASES[canonical] ?? [])]) {
      if (!has(raw, k)) continue;
      read.add(k);
      if (!found && carries(raw[k])) found = { key: k, value: raw[k] };
      if (!nullish && raw[k] === null) nullish = { key: k, value: null };
    }
    return found ?? nullish;
  };

  const name = pick("name");
  if (name) out.name = typeof name.value === "string" ? name.value.trim() : name.value;

  for (const k of ["aim", "domain", "criticality", "recruiting"] as const) {
    const v = pick(k);
    if (v) out[k] = v.value;
  }
  const why = pick("whyItMatters");
  if (why) out.whyItMatters = why.value;
  const seats = pick("seats");
  if (seats) out.seats = seats.value;

  const acc = pick("accountabilities");
  if (acc) {
    const list = normaliseAccountabilities(acc.value);
    if (list === undefined) unusable.add(acc.key);
    else out.accountabilities = list;
  }

  // THE CIRCLE. An explicit id always wins over a name. A name that places
  // exactly one live circle becomes that id. Anything else stays a name, with
  // the count, so the preview can say which of the two problems it is.
  const id = pick("circleId");
  const explicitId =
    id && ((typeof id.value === "string" && id.value.trim() !== "") || typeof id.value === "number") ? id.value : null;
  let sentName: string | null = null;
  for (const k of CIRCLE_NAME_KEYS) {
    if (!has(raw, k)) continue;
    const v = raw[k];
    if (typeof v === "string") {
      read.add(k);
      if (sentName === null && v.trim() !== "") sentName = v;
    } else if (v === null) {
      read.add(k);
    }
  }
  // Derived on every pass and never trusted from the input.
  if (has(raw, "circleMatches")) read.add("circleMatches");

  let circleProblem: CircleProblem | null = null;
  if (explicitId !== null) {
    out.circleId = explicitId;
  } else if (sentName !== null) {
    const matches = circlesNamed(sentName, circles);
    if (matches.length === 1) {
      out.circleId = matches[0];
    } else {
      out.circleName = sentName;
      out.circleMatches = matches.length;
      circleProblem = { kind: matches.length === 0 ? "unknown" : "ambiguous", name: sentName, matches };
    }
  } else if (id) {
    // A null or empty id, as before: carried, and the seat sits in no circle,
    // which is what a proposal that named no circle at all asked for.
    out.circleId = id.value;
  }

  const structural = new Set<string>(STRUCTURAL_SEAT_KEYS);
  const ignored = Object.keys(raw).filter((k) => unusable.has(k) || (!read.has(k) && !structural.has(k)));

  return { payload: out, vendorId: raw.id, ignored, circleProblem };
}

/**
 * The seats a proposal describes, whether it carries one or a list.
 *
 * `org.proposed` is a whole structure with a `seats` array and `role.proposed`
 * is one seat, and both arrive through the same table. Reading them here means
 * the rules above apply once. For a structure, a key beside the seat list
 * that is not `title` or `rationale` is reported too.
 */
export function readProposedSeats(
  payload: Record<string, unknown>,
  circles: readonly LiveCircle[],
): { seats: NormalisedSeat[]; ignored: string[] } {
  const list = Array.isArray(payload.seats);
  const raw = list ? (payload.seats as unknown[]) : [payload];
  const seats = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .map((s) => normaliseProposedSeat(s, circles));
  const ignored: string[] = [];
  const note = (k: string) => {
    if (!ignored.includes(k)) ignored.push(k);
  };
  if (list) for (const k of Object.keys(payload)) if (!ENVELOPE_KEYS.has(k)) note(k);
  for (const s of seats) s.ignored.forEach(note);
  return { seats, ignored };
}
