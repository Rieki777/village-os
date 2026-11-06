/**
 * THE CIRCLE CARD'S VIEW MODEL: one card per circle, the circle-level sibling
 * of the player role card (`shared/playerCard.ts`), shaped by the CCOS Circle
 * Charter.
 *
 * Its order leads with the work (Rye, 2026-10-22): the header with the
 * circle's name, where it sits and "This circle exists while ..."; why it
 * exists; what it answers for; what it looks after; what it may decide on its
 * own; what it does regularly; the roles in it, filled or open; how it gives
 * back, keeps power in balance and hands a role on; its values and its living
 * agreement; the tools it relies on; and who agreed to the words, and when.
 *
 * Pure and node-tested (`circleCard.test.ts`). The rules it keeps are the
 * player card's:
 *
 *   1. UNREAD IS ABSENT, NEVER EMPTY. Every input a host may not have read is
 *      a `Read<T>`: `undefined` comes out as a slot of kind "unread", which
 *      draws nothing. `null` or an empty list is "read, and empty", and comes
 *      out with its own words.
 *   2. A ROLE IS NAMED BY ITS FULL TITLE, `org_roles.name` verbatim.
 *   3. NO PERSON IS NAMED. A holder arrives as a handle for the link to their
 *      card and nothing else, and the link's words name the role. The adoption
 *      record says how the words were adopted, never by whom.
 *   4. EVERY HEADING IS PLAIN WORDS, with its CCOS term beside it for the
 *      hover, or `null` where the village turned the terms off.
 */
import { CHARTER_LIST_LIMITS, type CharterListField, type CircleCharter, type CircleValue } from "./circleCharter";
import { CCOS_TERMS, CIRCLE_CARD_WORDS as W, CIRCLE_HEADINGS, termLabel, type CircleSectionKey } from "./circleCardWords";
import { circleWordLabel, CIRCLE_WORD_KEYS, type CircleWordKey, type CircleWordsPayload } from "./circleCharterParse";
import type { Slot } from "./playerCard";
import { formatDay, type Read } from "./roleSheet";
import type { SignReading } from "./roleSigns";
import { openProposalHref } from "./openProposals";
import { proposeTermsHref } from "./seatTermsOffer";
import type { WorkPay } from "./workValue";

export type { Read } from "./roleSheet";
export type { Slot } from "./playerCard";

const UNREAD = { kind: "unread" } as const;
const empty = (words: string) => ({ kind: "empty", words }) as const;
const shown = <T>(value: T): Slot<T> => ({ kind: "shown", value });
const clean = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── Links ───────────────────────────────────────────────────────────────────

/** A circle's card. */
export const circleCardHref = (circleId: string): string => `/circles/${encodeURIComponent(circleId)}`;
/** One role's card on /roles, the way /roles and the map link a role. */
export const roleHref = (roleId: string): string => `/roles?seat=${encodeURIComponent(roleId)}`;
/**
 * A holder's player card, at this role's section: `/profile/:handle#role-<id>`.
 * The anchor is the player card's `ROLE_ANCHOR`, spelled here so this model
 * does not carry the whole player card; `circleCard.test.ts` holds the two equal.
 */
export const holderCardHref = (handle: string, roleId: string): string =>
  `/profile/${encodeURIComponent(handle)}#role-${roleId}`;

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CircleIn {
  /** `circles.id`. */
  id: string;
  /** `circles.name`, verbatim. */
  name: string;
  /** `circles.purpose`. */
  purpose: string | null;
  /** `circles.status`: active, forming or dormant. */
  status: string | null;
  /** The circle this one sits in, when it sits in one. */
  parent: { id: string; name: string } | null;
}

/** One role in the circle, read off the `/api/org` seat projection at this reader's tier. */
export interface CircleRoleIn {
  /** `org_roles.id`. */
  id: string;
  /** `org_roles.name`, printed verbatim. */
  name: string;
  /** How many people the role holds (`org_roles.seats`). */
  capacity: number;
  /** Live holdings, lapsed ones included (`holderCount`). */
  holderCount: number;
  /** The derived state: open, partial, filled, forming or expired. */
  state: string;
  isExample?: boolean;
  /**
   * The member holders' handles, for the links to their cards. Read only where
   * this reader sees the member holder rows; `undefined` below that tier.
   * A holder with no account or no handle is `null` and gets no link.
   */
  holderHandles: Read<(string | null)[]>;
  /**
   * What the role pays (server/lib/workPay.ts), at the `terms.read` tier, so
   * the Apply link never sits beside a role whose pay the reader has not seen
   * (Rye, 2026-10-30). Absent below that tier and the row draws nothing.
   */
  pay?: WorkPay | null;
}

/** One published org draft that wrote this circle's words. */
export interface AdoptionIn {
  draftId: string;
  /** `org_drafts.published_at`, ISO. */
  publishedAt: string;
  /** The village voted it in (`published_by` is the ballot). */
  byVote: boolean;
  /** The draft created the circle (`create_circle`), with its first purpose. */
  created: boolean;
}

export interface CircleCardIn {
  circle: CircleIn;
  /** The `circle_charters` row read back. `null` is no row yet: every field unwritten. */
  charter: Read<CircleCharter | null>;
  /** The circle's active roles, in their sort order. */
  roles: Read<CircleRoleIn[]>;
  /** Published drafts that wrote the circle's words, any order. */
  adoptions: Read<AdoptionIn[]>;
  /** The village's zone, for the dates. */
  timeZone: string;
  /** Show the CCOS term beside each heading (`org.ccos_terms`). */
  frameworkTerms: boolean;
  /**
   * The reader may read terms (`terms.read`), so an open role's Apply link
   * opens the member door. False for a visitor or a guest: theirs opens
   * "propose a role" with that role picked (shared/openProposals.ts), the door
   * somebody with no membership can walk through, where the member door would
   * only refuse them (joining blockers, 2026-10-31). Left out, the member door.
   */
  readerMayApply?: boolean;
  /** The words an open org draft would change: "Proposed, waiting for consent" beside each. */
  pending?: Read<CircleWordKey[]>;
  /** The open drafts that would change the circle's words, with the words they propose. */
  proposals?: Read<{ draftId: string; proposedAt: string; words: CircleWordsPayload }[]>;
  /**
   * The live parts Amora reads itself (server/lib/circleLive.ts), at the
   * member tier only. `sessionsOn` is false where Live Sessions is off, and
   * then the meeting sections draw nothing.
   */
  live?: Read<{
    signs: SignReading[];
    lastMetAt: string | null;
    openTensions: number;
    sessionsOn: boolean;
    /** Live Sessions' own words for the circle's rhythm ("Every Thursday at 18:00"), or null when none is kept. */
    rhythm?: string | null;
    /** Its next meeting in words ("Tomorrow at 18:00"), or null. */
    next?: string | null;
    /** What waits for the next meeting, as this reader may see it; null when unread. */
    waiting?: number | null;
  }>;
  /** The last day of the current season, a civil date: the review is due then (Rye, 2026-10-22). Null with no season. */
  reviewOn?: Read<string | null>;
}

/** One sign as the card prints it. */
export interface SignOut {
  label: string;
  /** "3", or "2 of 5"; null when it is not counted. */
  value: string | null;
  /** "Up on last moon" and the rest; "Not counted yet" for a sign that is not counted. */
  trend: string | null;
  /** How it is counted, in a sentence; null when it is not counted. */
  countedFrom: string | null;
}

/** Plain facts and the links beside them. */
export interface FactsOut {
  lines: string[];
  links: { label: string; href: string }[];
}

/** One proposal waiting for consent, as a decider reads it. */
export interface ProposalOut {
  draftId: string;
  /** "Proposed on 22 Oct 2026". */
  proposedOn: string;
  /** Each field it changes: the plain heading and the lines it would show. Empty lines clear the field. */
  fields: { key: CircleWordKey; label: string; lines: string[] }[];
}

// ── Output ──────────────────────────────────────────────────────────────────

export interface RoleRowOut {
  id: string;
  name: string;
  href: string;
  /** "Filled", "Open", "1 of 2 filled". */
  stateWords: string;
  filled: boolean;
  /** One link per member holder with a card, each named by the role it holds. */
  holderCards: { href: string; label: string; ariaLabel: string }[];
  /** Apply for it: an open or partly filled real role. */
  applyHref: string | null;
  applyLabel: string;
  /** Passed through untouched from `CircleRoleIn.pay`. */
  pay?: WorkPay | null;
}

export interface AdoptionOut {
  /** The newest adoption, in words. */
  latest: string;
  /** "3 changes adopted since 4 September 2026", when there was more than one. */
  summary: string | null;
  /** Up to five, newest first: what was adopted and how. */
  lines: { day: string; what: string; how: string }[];
}

interface SectionBase<K extends CircleSectionKey> {
  key: K;
  heading: string;
  /** "CCOS: Domains", or null where the village turned the terms off. */
  term: string | null;
}

export type CircleSection =
  | (SectionBase<"purpose"> & { kind: "text"; slot: Slot<string> })
  | (SectionBase<CharterListField> & { kind: "list"; slot: Slot<string[]>; note: string | null })
  | (SectionBase<"values"> & { kind: "values"; slot: Slot<CircleValue[]> })
  | (SectionBase<"roles"> & { kind: "roles"; slot: Slot<RoleRowOut[]>; note: string | null })
  | (SectionBase<"signs"> & { kind: "signs"; slot: Slot<SignOut[]> })
  | (SectionBase<"meet" | "wholeness" | "tensions" | "review"> & { kind: "facts"; slot: Slot<FactsOut> })
  | (SectionBase<"adoption"> & { kind: "adoption"; slot: Slot<AdoptionOut> });

export interface CircleCard {
  header: {
    eyebrow: string;
    name: string;
    parent: { name: string; href: string; label: string } | null;
    /** "Forming" or "Resting"; null for an active circle. */
    status: string | null;
    existsWhile: Slot<string>;
    existsWhileLabel: string;
    existsWhileTerm: string | null;
    /** The one-line key to the underlined headings, when the terms are on. */
    termsKey: string | null;
  };
  sections: CircleSection[];
  /** The words an open draft would change, by payload key. Empty when none, or unread. */
  pending: CircleWordKey[];
  /** The words "Proposed, waiting for consent". */
  pendingWords: string;
  /** The open proposals, oldest first. Empty when none, or below the member tier. */
  proposals: ProposalOut[];
}

// ── The pieces ──────────────────────────────────────────────────────────────

function base<K extends CircleSectionKey>(key: K, terms: boolean): SectionBase<K> {
  return { key, heading: CIRCLE_HEADINGS[key], term: terms ? termLabel(CCOS_TERMS[key]) : null };
}

function listSection(field: CharterListField, charter: Read<CircleCharter | null>, terms: boolean): CircleSection {
  const b = base(field, terms);
  if (charter === undefined) return { ...b, kind: "list", slot: UNREAD, note: null };
  const items = (charter?.[field] ?? []).map(clean).filter((s): s is string => s !== null);
  if (!items.length) return { ...b, kind: "list", slot: empty(W.notWritten), note: null };
  const { min } = CHARTER_LIST_LIMITS[field];
  // Written below the template's floor: shown as written, with the floor said once.
  const note = field === "accountabilities" && items.length < min ? W.accountabilitiesShort(items.length) : null;
  return { ...b, kind: "list", slot: shown(items), note };
}

function stateWords(r: CircleRoleIn): { words: string; filled: boolean } {
  switch (r.state) {
    case "filled":
      return { words: W.roleFilled, filled: true };
    case "partial":
      return { words: W.rolePartly(r.holderCount, r.capacity), filled: false };
    case "forming":
      return { words: W.roleForming, filled: false };
    case "expired":
      return { words: W.roleExpired, filled: r.holderCount > 0 };
    default:
      return { words: W.roleOpen, filled: false };
  }
}

function roleRow(r: CircleRoleIn, asMember: boolean): RoleRowOut {
  const name = clean(r.name) ?? r.id;
  const { words, filled } = stateWords(r);
  const handles = (r.holderHandles ?? []).filter((h): h is string => typeof h === "string" && h.trim() !== "");
  const holderCards = handles.map((h, i) => ({
    href: holderCardHref(h, r.id),
    label: W.seeCard,
    ariaLabel: W.seeCardOf(name, i + 1, handles.length),
  }));
  const mayApply = !r.isExample && (r.state === "open" || r.state === "partial");
  return {
    id: r.id,
    name,
    href: roleHref(r.id),
    stateWords: words,
    filled,
    holderCards,
    applyHref: mayApply ? (asMember ? proposeTermsHref(r.id) : openProposalHref(r.id)) : null,
    applyLabel: W.apply,
    ...(r.pay ? { pay: r.pay } : {}),
  };
}

function rolesSection(roles: Read<CircleRoleIn[]>, terms: boolean, asMember: boolean): CircleSection {
  const b = base("roles", terms);
  if (roles === undefined) return { ...b, kind: "roles", slot: UNREAD, note: null };
  if (!roles.length) return { ...b, kind: "roles", slot: empty(W.noRoles), note: null };
  // Below the member tier no handle is read, so a filled role carries no link: say why once.
  const handlesUnread = roles.some((r) => r.holderHandles === undefined && r.holderCount > 0);
  return { ...b, kind: "roles", slot: shown(roles.map((r) => roleRow(r, asMember))), note: handlesUnread ? W.holdersPrivate : null };
}

function adoptionSection(adoptions: Read<AdoptionIn[]>, timeZone: string, terms: boolean): CircleSection {
  const b = base("adoption", terms);
  if (adoptions === undefined) return { ...b, kind: "adoption", slot: UNREAD };
  const dated = adoptions
    .map((a) => ({ a, t: Date.parse(a.publishedAt), day: formatDay(a.publishedAt, true, timeZone) }))
    .filter((x): x is { a: AdoptionIn; t: number; day: string } => !Number.isNaN(x.t) && !!x.day)
    .sort((x, y) => y.t - x.t);
  if (!dated.length) return { ...b, kind: "adoption", slot: empty(W.noAdoption) };
  const how = (x: (typeof dated)[number]) => (x.a.byVote ? W.adoptedByVote(x.day) : W.adoptedDirectly(x.day));
  const first = dated[dated.length - 1]!;
  return {
    ...b,
    kind: "adoption",
    slot: shown({
      latest: how(dated[0]!),
      summary: dated.length > 1 ? W.adoptionCount(dated.length, first.day) : null,
      lines: dated.slice(0, 5).map((x) => ({ day: x.day, what: x.a.created ? W.createdLine : W.wordsLine, how: how(x) })),
    }),
  };
}

function proposalOut(p: { draftId: string; proposedAt: string; words: CircleWordsPayload }, timeZone: string): ProposalOut {
  const fields = CIRCLE_WORD_KEYS.filter((k) => p.words[k] !== undefined).map((key) => {
    const v = p.words[key] as string | string[] | CircleValue[] | null | undefined;
    const lines = v === null || v === undefined ? [] : typeof v === "string" ? [v] : (v as Array<string | CircleValue>).map((x) => (typeof x === "string" ? x : W.valueLine(x.value, x.practice)));
    return { key, label: circleWordLabel(key), lines };
  });
  return { draftId: p.draftId, proposedOn: W.proposedOn(formatDay(p.proposedAt, true, timeZone) ?? ""), fields };
}

/** Where Live Sessions lives, for the meeting sections' links. */
export const SESSIONS_HREF = "/sessions";

/** The catalog's own label for a key, for a sign that could not be counted. */
const SIGN_LABELS: Record<string, string> = {
  "circle-met": "Times the circle met",
  "decisions-recorded": "Decisions recorded",
  "roles-with-card-and-term": "Roles with a full card and a term",
};

function signOut(r: SignReading): SignOut {
  if (r.kind === "not-counted") {
    return { label: SIGN_LABELS[r.key ?? ""] ?? r.key ?? "", value: null, trend: W.notCountedYet, countedFrom: null };
  }
  const value = r.now.of === undefined ? String(r.now.n) : W.nOf(r.now.n, r.now.of);
  const trend = !r.trend ? null : r.trend.kind === "later" ? W.trendLater : W.trend[r.trend.direction];
  return { label: r.label, value, trend, countedFrom: r.countedFrom };
}

function liveSections(input: CircleCardIn, terms: boolean): CircleSection[] {
  const live = input.live;
  const day = (iso: string | null) => (iso ? formatDay(iso, true, input.timeZone) : null);
  const signs: CircleSection =
    live === undefined
      ? { ...base("signs", terms), kind: "signs", slot: UNREAD }
      : { ...base("signs", terms), kind: "signs", slot: shown(live.signs.map(signOut)) };
  if (live === undefined) {
    return [
      signs,
      { ...base("meet", terms), kind: "facts", slot: UNREAD },
      { ...base("wholeness", terms), kind: "facts", slot: UNREAD },
      { ...base("tensions", terms), kind: "facts", slot: UNREAD },
    ];
  }
  const met = day(live.lastMetAt);
  const meet: CircleSection = live.sessionsOn
    ? {
        ...base("meet", terms),
        kind: "facts",
        slot: shown({
          lines: [
            live.rhythm ? W.rhythm(live.rhythm) : W.rhythmNotSet,
            ...(live.next ? [W.nextMeeting(live.next)] : []),
            met ? W.lastMet(met) : W.notMetYet,
            ...(typeof live.waiting === "number" ? [W.waiting(live.waiting)] : []),
          ],
          links: [{ label: W.openSessions, href: SESSIONS_HREF }],
        }),
      }
    : { ...base("meet", terms), kind: "facts", slot: UNREAD };
  const wholeness: CircleSection = live.sessionsOn
    ? {
        ...base("wholeness", terms),
        kind: "facts",
        slot: shown({ lines: [W.arrivalRound, W.sharedBreath, W.gratitudeRound], links: [{ label: W.bringSomething, href: SESSIONS_HREF }] }),
      }
    : { ...base("wholeness", terms), kind: "facts", slot: UNREAD };
  const tensions: CircleSection = {
    ...base("tensions", terms),
    kind: "facts",
    slot: shown({ lines: [W.openTensions(live.openTensions), W.tensionFlow, W.tensionWhere], links: [] }),
  };
  return [signs, meet, wholeness, tensions];
}

function reviewSection(input: CircleCardIn, terms: boolean): CircleSection {
  if (input.reviewOn === undefined) return { ...base("review", terms), kind: "facts", slot: UNREAD };
  const due = input.reviewOn ? formatDay(input.reviewOn, true, input.timeZone) : null;
  const latest = (input.adoptions ?? [])
    .map((a) => ({ iso: a.publishedAt, t: Date.parse(a.publishedAt) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t)
    .pop();
  const changed = latest ? formatDay(latest.iso, true, input.timeZone) : null;
  const lines = [due ? W.reviewDue(due) : W.noReviewDate, ...(changed ? [W.lastChanged(changed)] : [])];
  return { ...base("review", terms), kind: "facts", slot: shown({ lines, links: [] }) };
}

// ── The card ────────────────────────────────────────────────────────────────

export function buildCircleCard(input: CircleCardIn): CircleCard {
  const { circle, charter, roles, adoptions, timeZone, frameworkTerms: terms } = input;
  const existsWhile: Slot<string> =
    charter === undefined ? UNREAD : clean(charter?.existsWhile) ? shown(clean(charter!.existsWhile)!) : empty(W.existsWhileEmpty);
  const purpose = clean(circle.purpose);
  const valuesSlot: Slot<CircleValue[]> =
    charter === undefined ? UNREAD : charter?.values?.length ? shown(charter.values) : empty(W.notWritten);
  const list = (f: CharterListField) => listSection(f, charter, terms);
  return {
    header: {
      eyebrow: W.eyebrow,
      name: clean(circle.name) ?? circle.id,
      parent: circle.parent
        ? { name: circle.parent.name, href: circleCardHref(circle.parent.id), label: W.partOf }
        : null,
      status: circle.status ? (W.status[circle.status] ?? null) : null,
      existsWhile,
      existsWhileLabel: W.existsWhile,
      existsWhileTerm: terms ? termLabel(CCOS_TERMS.existsWhile) : null,
      termsKey: terms ? W.termsKey : null,
    },
    sections: [
      { ...base("purpose", terms), kind: "text", slot: purpose ? shown(purpose) : empty(W.noPurpose) },
      list("accountabilities"),
      list("domains"),
      list("authorities"),
      list("responsibilities"),
      rolesSection(roles, terms, input.readerMayApply !== false),
      ...liveSections(input, terms),
      list("stewardship"),
      list("checks"),
      list("succession"),
      { ...base("values", terms), kind: "values", slot: valuesSlot },
      list("livingAgreement"),
      list("tools"),
      reviewSection(input, terms),
      adoptionSection(adoptions, timeZone, terms),
    ],
    pending: Array.from(new Set(input.pending ?? [])),
    pendingWords: W.pending,
    proposals: (input.proposals ?? []).map((p) => proposalOut(p, timeZone)),
  };
}
