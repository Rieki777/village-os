/**
 * THE MEMBER DOOR: APPLY TO HOLD SEATS, ON TERMS (seat settings PR4).
 *
 * A member applies to hold one to five of the village's seats as ONE formal
 * proposal, with the terms they would hold them on (shared/seatSettings.ts).
 * This file is the part of that door with no database and no request in it:
 * what an application must carry, who adopts it, and the words a ballot about
 * it may say. The route (server/routes/seatApplications.ts), the closer
 * (server/lib/seatApplicationCloser.ts) and the page all read these, so a rule
 * has one spelling.
 *
 * ── WHO ADOPTS, AND THE SELF-DEALING FALLTHROUGH ───────────────────────────
 *
 * Adoption follows whoever holds `org.seat` (Rye, 2026-09-23 and 2026-09-24):
 * a live holder adopts, or the village votes. `whoMayPutHandToVillage` in
 * shared/powerHands.ts answers who holds it, and `adoptionPath` below adds the
 * one rule this door needs on top: a holder never adopts their OWN terms. A
 * candidate who is the only live holder falls through to a ballot, and a
 * candidate who is one of several holders waits for one of the others.
 *
 * ── WHAT A BALLOT MAY SAY ──────────────────────────────────────────────────
 *
 * A ballot's title and document are as public as the governance module: the
 * list and the detail routes check no sign-in. So they carry seat names and
 * aims ONLY. No candidate name, no amount, no currency, no free text the
 * member wrote, no hash. Members read the application itself on its page,
 * behind `terms.read`. The document is plain lines, because the decision page
 * prints it as written.
 *
 * Money in an application is a RECORD. Nothing here pays, posts or settles.
 */
import { looksLikePaymentDetails, PAYMENT_DETAIL_MESSAGE, parseSeatSettings, type SeatSettings } from "./seatSettings";
import type { HandOpenerRule } from "./powerHands";

/** The ballot subject an application is voted under. 16 characters, inside varchar(24). */
export const ROLE_APPLICATION = "role_application";

/** The power that adopts seat applications. */
export const ADOPTING_POWER = "org.seat";

/** One application holds at least one seat and at most five. */
export const MIN_SEATS = 1;
export const MAX_SEATS = 5;

/** The longest the member's own words may run, each. */
export const WORDS_MAX = 2000;

export const APPLICATION_STATUSES = ["awaiting-holder", "voting", "adopted", "not-adopted", "withdrawn", "held-full"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses an application can still move out of by a member's act. */
export const OPEN_STATUSES: readonly ApplicationStatus[] = ["awaiting-holder", "voting"];

/** What each status reads as, on the page and in a list. Keyed by the union, so a new status cannot render blank. */
export const STATUS_WORDS: Record<ApplicationStatus, string> = {
  "awaiting-holder": "Waiting for a seat holder",
  voting: "The village is voting",
  adopted: "Adopted",
  "not-adopted": "Not adopted",
  withdrawn: "Withdrawn",
  "held-full": "Held, the seat is full",
};

/** Where an application is read. Members only. */
export function applicationHref(id: string): string {
  return `/seat-applications/${encodeURIComponent(id)}`;
}

/** An application id: `sa-` and sixteen hex characters. */
export const APPLICATION_ID = /^sa-[0-9a-f]{16}$/;

// ── The input ────────────────────────────────────────────────────────────────

export interface ApplicationInput {
  seatIds: string[];
  /** Why this member. Stored, read by members on the page, never on a ballot. */
  note: string | null;
  /** What will be true at the season's end. */
  deliverables: string | null;
  settings: SeatSettings;
  /** YYYY-MM-DD, the earliest day the seats may be taken up, or null for "when adopted". */
  startsOn: string | null;
  /**
   * The season the member applies for, from their season plan (season plans
   * RC1). A season that has not started yet sets the first day to its own,
   * so the application's term sits in that season.
   */
  seasonId: string | null;
}

export type ParsedApplication = { ok: true; input: ApplicationInput } | { ok: false; error: string; field: string };

const words = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/**
 * Read a request body into an application, or the first reason it cannot be one.
 *
 * `orgRoleId` is still read for a draft saved before seats became a list, so
 * an old draft publishes as an application for its one seat.
 */
export function parseApplicationInput(body: unknown): ParsedApplication {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = Array.isArray(b.seatIds) ? b.seatIds : b.orgRoleId !== undefined && b.orgRoleId !== null && b.orgRoleId !== "" ? [b.orgRoleId] : [];
  const seatIds = raw.map((s) => String(s ?? "").trim()).filter((s) => s !== "");
  if (seatIds.length < MIN_SEATS) return { ok: false, field: "seatIds", error: "Pick the seat you are applying for." };
  if (seatIds.length > MAX_SEATS) {
    return { ok: false, field: "seatIds", error: `One application holds at most ${MAX_SEATS} seats. Apply for the rest in a second one.` };
  }
  if (new Set(seatIds).size !== seatIds.length) return { ok: false, field: "seatIds", error: "Each seat appears once in an application." };
  if (seatIds.some((s) => s.length > 64)) return { ok: false, field: "seatIds", error: "That seat id is longer than any seat this village has." };

  const note = words(b.note ?? b.fitStatement);
  const deliverables = words(b.deliverables);
  for (const [field, text] of [
    ["deliverables", deliverables],
    ["note", note],
  ] as const) {
    if (text && text.length > WORDS_MAX) return { ok: false, field, error: `Keep this to ${WORDS_MAX} characters.` };
    if (text && looksLikePaymentDetails(text)) return { ok: false, field, error: PAYMENT_DETAIL_MESSAGE };
  }

  const parsed = parseSeatSettings(b.seatSettings ?? b.settings ?? null);
  if (!parsed.ok || !parsed.settings) {
    return { ok: false, field: "seatSettings", error: parsed.problems[0]?.message ?? "These terms could not be read." };
  }

  const startsRaw = words(b.startsNoEarlierThan);
  if (startsRaw && !/^\d{4}-\d{2}-\d{2}$/.test(startsRaw)) {
    return { ok: false, field: "startsNoEarlierThan", error: "Write the first day as a date like 2027-03-21, or leave it empty." };
  }
  const seasonId = words(b.seasonId);
  if (seasonId && seasonId.length > 64) return { ok: false, field: "seasonId", error: "That season id is longer than any season this village has." };
  return { ok: true, input: { seatIds, note, deliverables, settings: parsed.settings, startsOn: startsRaw, seasonId } };
}

// ── Who adopts ───────────────────────────────────────────────────────────────

export type AdoptionPath = "holder" | "ballot";

/**
 * Which road an application takes, decided once when it is written.
 *
 * `rule` is `whoMayPutHandToVillage` over `org.seat`. When the village holds
 * the power, or nobody holds it live, the village votes. When a role holds it,
 * a live holder who is NOT the candidate adopts; a candidate who is the only
 * live holder cannot adopt their own terms, so it falls through to a ballot.
 */
export function adoptionPath(rule: HandOpenerRule, candidateId: string): AdoptionPath {
  if (rule.who !== "live-holders") return "ballot";
  return rule.holders.some((h) => h !== candidateId) ? "holder" : "ballot";
}

export interface DoorRefusal {
  status: number;
  error: string;
  message: string;
}

/** Why this member may not adopt this application for the village, or null. */
export function adoptRefusal(rule: HandOpenerRule, actorId: string, candidateId: string): DoorRefusal | null {
  if (actorId === candidateId) {
    return { status: 403, error: "own_terms", message: "Your own terms go to the village to adopt." };
  }
  if (rule.who !== "live-holders" || !rule.holders.includes(actorId)) {
    return {
      status: 403,
      error: "not_a_holder",
      message: "Adopting an application for the village is for a live holder of the power that seats people.",
    };
  }
  return null;
}

/**
 * Why this member may not send this application to a vote, or null. Any live
 * holder may, the candidate included. When the power is the village's, or
 * nobody holds it live any more, any member may (red team G5): an application
 * written while a holder sat would otherwise wait for nobody, for good.
 */
export function putToVillageRefusal(rule: HandOpenerRule, actorId: string): DoorRefusal | null {
  if (rule.who === "any-member") return null;
  if (rule.who === "live-holders" && rule.holders.includes(actorId)) return null;
  return {
    status: 403,
    error: "not_a_holder",
    message: "Sending an application to the village is for a live holder of the power that seats people.",
  };
}

// ── The ballot's words ───────────────────────────────────────────────────────

export interface BallotSeat {
  name: string;
  aim: string | null;
}

/** "A, B and C". */
export function seatList(names: readonly string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "a seat";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** The ballot's title: the seats, never the person. */
export function applicationBallotTitle(seats: readonly BallotSeat[]): string {
  return `Who holds ${seatList(seats.map((s) => s.name))}`.slice(0, 200);
}

/**
 * The ballot's document: plain lines, seat names and aims only.
 *
 * Built from nothing but the seats, so the member's words, their name and the
 * money in the terms have no path in. The application's page is named by its
 * address so a member can go and read it.
 */
export function applicationBallotDoc(seats: readonly BallotSeat[], applicationId: string): string {
  const lines = [
    applicationBallotTitle(seats),
    "",
    seats.length === 1 ? "THE SEAT" : "THE SEATS",
    ...seats.flatMap((s) => [`  ${s.name.trim()}`, ...(s.aim && s.aim.trim() ? [`    ${s.aim.trim()}`] : [])]),
    "",
    "WHAT THE VILLAGE DECIDES",
    "  Whether a member's application to hold these seats, on the terms it sets, is adopted.",
    "  If it carries, the member holds every seat it names on those terms, from the day it lands or a later first day the application sets.",
    "",
    "Members read the application on its page.",
    `  ${applicationHref(applicationId)}`,
    "",
  ];
  return lines.join("\n");
}

/** The roll's notice and the members' notices: the seat names, nothing else. */
export function applicationNoticeTitle(kind: "opened" | "waiting" | "adopted" | "not-adopted" | "held-full", seatNames: readonly string[]): string {
  const seats = seatList(seatNames);
  switch (kind) {
    case "opened":
      return `The village is asked who holds ${seats}`;
    case "waiting":
      return `An application waits for a seat holder: ${seats}`;
    case "adopted":
      return `Adopted: your application for ${seats}`;
    case "not-adopted":
      return `Not adopted: your application for ${seats}`;
    case "held-full":
      return `Held, a seat is full: your application for ${seats}`;
  }
}

// ── The public record of an application's ballot ─────────────────────────────

/** Who the ballot names as having closed or withdrawn it: the system, never a member. */
export const APPLICATION_BALLOT_ACTOR = "governance";

/** The only words a withdrawn application's ballot records. */
export const APPLICATION_WITHDRAWN_NOTE = "The application was withdrawn.";

/** The only words a closed application's ballot records, whatever the closer typed. */
export const APPLICATION_CLOSED_NOTE = "The village decided on the application. Members read it on its page.";

/**
 * Does the public ballot name whoever closed or withdrew it? Not for an
 * application (red team S1): the candidate withdraws their own, so naming the
 * withdrawer names the candidate on a record built never to name them.
 */
export function ballotNamesItsCloser(subjectType: string): boolean {
  return subjectType !== ROLE_APPLICATION;
}

/**
 * The outcome words a close may store (red team U12). An application's ballot
 * takes no free text: a closer could type the candidate's name into a public
 * record, so it records fixed words and the application page says the rest.
 */
export function closeNoteFor(subjectType: string, typed: string): string {
  return subjectType === ROLE_APPLICATION ? APPLICATION_CLOSED_NOTE : typed;
}
