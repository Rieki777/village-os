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
 * a list, and REPORTS every key it did not read or could not use. It never
 * invents a value: a circle name that matches nothing, or matches more than
 * one circle, stays a name (`circleName`) and `previewDraft` blocks the seat
 * with a sentence saying what to do. A circle given in a form nothing here
 * reads (an object, a number, a key like `parent_circle`, or once beside a
 * structure's seat list) is carried as `circleUnread`, and blocks the same way.
 *
 * ── A KEY COUNTS AS READ ONLY WHERE SOMETHING READS IT ───────────────────
 *
 * `id` becomes the seat's slug everywhere. `title` and `rationale` are read by
 * the accept path only off the FIRST proposal (title) and only when a decision
 * holds ONE proposal (rationale), so the caller says which of those it reads.
 * Anywhere else they are reported like any other key, because a rationale on
 * the fourth of nineteen records reaches no draft.
 *
 * A value of the wrong TYPE counts as unread too. A text field sent as an
 * object would publish as "[object Object]", an array would break the INSERT,
 * and `recruiting: "yes"` would publish as not recruiting, so each is reported
 * and left out of the payload.
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
 * placed, and `circleUnread` only when the proposal gave a circle in a form
 * nothing here reads. `previewDraft` blocks any seat that carries one of them
 * without a `circleId`.
 */
export const PROPOSABLE_SEAT_FIELDS = [
  "name",
  "circleId",
  "circleName",
  "circleMatches",
  "circleUnread",
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
 * canonical key and an alias both carry a value, the canonical key wins. A
 * blank string carries no value, so an alias with one beats it.
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
 * A key that looks like it describes a circle. Used only on keys nothing else
 * read, to tell "a vendor field this village has no use for" apart from "the
 * seat's circle, in a shape nothing here reads", which must block.
 */
const CIRCLE_LIKE = /circle/i;

export interface CircleProblem {
  /**
   * `unknown` matched no live circle; `ambiguous` matched more than one;
   * `unreadable` was given in a form nothing here reads.
   */
  kind: "unknown" | "ambiguous" | "unreadable";
  /** The name exactly as the proposal sent it. For `unreadable`, the keys it came under. */
  name: string;
  /** The ids of the circles it matched. Empty for `unknown` and `unreadable`. */
  matches: string[];
}

export interface NormalisedSeat {
  /** What goes into the `create_seat` change. */
  payload: Record<string, unknown>;
  /** The vendor's own id for this seat, untouched, for `seatIdFor`. */
  vendorId: unknown;
  /** Every key present on the seat that nothing read or could use, in the order it arrived. */
  ignored: string[];
  /** Set when a circle was given and could not be placed. */
  circleProblem: CircleProblem | null;
}

/** What the caller reads off a record for itself, beyond the seat. */
export interface SeatReading {
  /** Keys the caller reads, so they are not reported. `id` always is. */
  readByCaller?: readonly string[];
  /** Circle keys given beside a structure's seat list, which no seat reads. */
  unreadCircleKeys?: readonly string[];
}

const has = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const carries = (v: unknown): boolean => v !== undefined && v !== null;
/** Null, absent and a blank string all say nothing. */
const blank = (v: unknown): boolean => !carries(v) || (typeof v === "string" && v.trim() === "");
const fold = (v: unknown): string => String(v).trim().toLowerCase();
const isText = (v: unknown): boolean => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
/** A circle id that names something. 0 and false are how some senders spell "none". */
const namesACircle = (v: unknown): boolean =>
  (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v) && v !== 0);

/**
 * A list of accountabilities out of whatever the vendor sent.
 *
 * A string is split on ";" and on newlines, each part trimmed, one trailing
 * period dropped, and empty parts dropped. A period in the middle of a string
 * is NOT a separator: sentences inside one accountability are common, and
 * splitting on them would turn one duty into three fragments.
 *
 * An array passes through with items trimmed, and null or blank items dropped.
 * An array holding an object or a nested list is `undefined` as a whole, since
 * keeping the text items would publish a list with duties quietly missing.
 * `null` passes through as `null`. Anything else is `undefined`, which the
 * caller reports as an ignored key, because a number or an object here is a
 * value the seat would silently lose at publish.
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
    if (v.some((s) => carries(s) && typeof s !== "string" && typeof s !== "number" && typeof s !== "boolean")) {
      return undefined;
    }
    return v
      .filter(carries)
      .map((s) => String(s).trim())
      .filter((s) => s !== "");
  }
  return undefined;
}

/**
 * A recruiting flag out of the spellings senders use. Blank is `null`, which
 * publishes as the column default. Anything unrecognised is `undefined`, and
 * reported, because `applyChange` would write it as not recruiting.
 */
export function normaliseRecruiting(v: unknown): boolean | null | undefined {
  if (blank(v)) return null;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === 0) return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
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
export function normaliseProposedSeat(
  raw: Record<string, unknown>,
  circles: readonly LiveCircle[],
  reading: SeatReading = {},
): NormalisedSeat {
  const read = new Set<string>();
  const unusable = new Set<string>();
  const out: Record<string, unknown> = {};

  /**
   * The first key, canonical then aliases, whose value says something and is
   * of a usable shape. Failing that, the first null or blank one. Every present
   * key counts as read; when no key had a usable value, the ones with a value
   * of the wrong shape are reported.
   */
  const pick = (
    canonical: string,
    usable: (v: unknown) => boolean = () => true,
    empty: (v: unknown) => boolean = blank,
  ): { key: string; value: unknown } | null => {
    let found: { key: string; value: unknown } | null = null;
    let nothing: { key: string; value: unknown } | null = null;
    const wrongShape: string[] = [];
    for (const k of [canonical, ...(SEAT_KEY_ALIASES[canonical] ?? [])]) {
      if (!has(raw, k)) continue;
      read.add(k);
      if (empty(raw[k])) {
        if (!nothing) nothing = { key: k, value: raw[k] };
      } else if (!usable(raw[k])) {
        wrongShape.push(k);
      } else if (!found) {
        found = { key: k, value: raw[k] };
      }
    }
    if (found) return found;
    wrongShape.forEach((k) => unusable.add(k));
    return nothing;
  };

  const orNull = (test: (v: unknown) => boolean) => (v: unknown) => v === null || test(v);

  const name = pick("name", orNull(isText));
  if (name) out.name = typeof name.value === "string" ? name.value.trim() : carries(name.value) ? String(name.value) : null;

  for (const k of ["aim", "domain", "whyItMatters"] as const) {
    const v = pick(k, orNull(isText));
    if (v) out[k] = typeof v.value === "number" ? String(v.value) : v.value;
  }
  for (const k of ["criticality", "seats"] as const) {
    // The preview checks both loudly, so a bad value blocks there by name.
    const v = pick(k);
    if (v) out[k] = v.value;
  }

  const recruiting = pick("recruiting", (v) => normaliseRecruiting(v) !== undefined);
  if (recruiting) out.recruiting = normaliseRecruiting(recruiting.value);

  const acc = pick("accountabilities", (v) => normaliseAccountabilities(v) !== undefined);
  if (acc) out.accountabilities = normaliseAccountabilities(acc.value);

  // THE CIRCLE. An explicit id always wins over a name. A name that places
  // exactly one live circle becomes that id. Anything else stays a name, with
  // the count, so the preview can say which of the two problems it is.
  const circleUnread: string[] = [];
  const id = pick("circleId", namesACircle, (v) => blank(v) || v === 0 || v === false);
  for (const k of ["circleId", ...(SEAT_KEY_ALIASES.circleId ?? [])]) if (unusable.has(k)) circleUnread.push(k);
  const explicitId = id && namesACircle(id.value) ? id.value : null;
  let sentName: string | null = null;
  for (const k of CIRCLE_NAME_KEYS) {
    if (!has(raw, k)) continue;
    const v = raw[k];
    read.add(k);
    if (typeof v === "string") {
      if (sentName === null && v.trim() !== "") sentName = v;
    } else if (v !== null) {
      unusable.add(k);
      circleUnread.push(k);
    }
  }
  // Derived on every pass and never trusted from the input.
  if (has(raw, "circleMatches")) read.add("circleMatches");
  // Carried from an earlier pass, where the key that caused it is already gone.
  if (has(raw, "circleUnread")) {
    read.add("circleUnread");
    if (Array.isArray(raw.circleUnread)) for (const k of raw.circleUnread) if (typeof k === "string") circleUnread.push(k);
  }

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
    // An id that names nothing (null, blank, 0, false): the seat sits in no
    // circle, stored as NULL, which is what a proposal naming no circle asked
    // for. Unless a circle arrived some other way, which is checked below.
    out.circleId = null;
  }

  const structural = new Set<string>(["id", ...(reading.readByCaller ?? [])]);
  const unread = Object.keys(raw).filter((k) => !read.has(k) && !structural.has(k));
  for (const k of unread) if (CIRCLE_LIKE.test(k) && !blank(raw[k])) circleUnread.push(k);
  circleUnread.push(...(reading.unreadCircleKeys ?? []));

  // A circle that arrived in a shape nothing reads, on a seat that placed no
  // circle, blocks. Published, it would sit in no circle with nothing saying so.
  const placed = namesACircle(out.circleId) || out.circleName !== undefined;
  const unreadKeys = Array.from(new Set(circleUnread));
  if (!placed && unreadKeys.length) {
    out.circleUnread = unreadKeys;
    circleProblem = { kind: "unreadable", name: unreadKeys.join(", "), matches: [] };
  }

  const ignored = Object.keys(raw).filter((k) => unusable.has(k) || (!read.has(k) && !structural.has(k)));

  return { payload: out, vendorId: raw.id, ignored, circleProblem };
}

/** What the accept path reads off a proposal besides its seats. */
export interface ProposalReading {
  /** The draft's title is taken from this proposal. */
  readsTitle?: boolean;
  /** The draft's rationale is taken from this proposal. */
  readsRationale?: boolean;
}

/**
 * The seats a proposal describes, whether it carries one or a list.
 *
 * `org.proposed` is a whole structure with a `seats` array and `role.proposed`
 * is one seat, and both arrive through the same table. Reading them here means
 * the rules above apply once. For a structure, every key beside the seat list
 * is reported unless the caller reads it, and inside the list only `id` is
 * read for the caller. A circle given once beside the list reaches no seat,
 * so every seat that placed no circle of its own blocks on it.
 */
export function readProposedSeats(
  payload: Record<string, unknown>,
  circles: readonly LiveCircle[],
  reading: ProposalReading = {},
): { seats: NormalisedSeat[]; ignored: string[] } {
  const callerKeys = [...(reading.readsTitle ? ["title"] : []), ...(reading.readsRationale ? ["rationale"] : [])];
  const list = Array.isArray(payload.seats);
  const raw = list ? (payload.seats as unknown[]) : [payload];
  const envelope = list ? Object.keys(payload).filter((k) => k !== "seats" && !callerKeys.includes(k)) : [];
  const seatReading: SeatReading = list
    ? { unreadCircleKeys: envelope.filter((k) => CIRCLE_LIKE.test(k) && !blank(payload[k])) }
    : { readByCaller: callerKeys };
  const seats = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .map((s) => normaliseProposedSeat(s, circles, seatReading));
  const ignored: string[] = [];
  const note = (k: string) => {
    if (!ignored.includes(k)) ignored.push(k);
  };
  envelope.forEach(note);
  for (const s of seats) s.ignored.forEach(note);
  return { seats, ignored };
}
