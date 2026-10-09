/**
 * THE RECAP: the host's few lines after a gathering, sent to everybody who
 * said yes, with the village's two questions and the next gathering (the
 * comms build spec 5.9 and 5.14).
 *
 * ── SENDING ────────────────────────────────────────────────────────────────
 *
 * Who gets which version is `recapAudience` (shared/comms/recap.ts): the came
 * version to everybody who said yes unless the host marked them missed, the
 * missed version (with the host's note) to the people marked missed. Each
 * email is one `post()` of kind `events`, so the post office asks permission,
 * the pause and rehearsal of every one, and it expires after seven days (5.1).
 *
 * ONE RECAP PER PERSON, EVER. The key is `recap:<event>:<evening>:<person>`,
 * the same whichever version they get, so a second press, a retry after a
 * crash, or two hosts pressing together posts nothing twice. The emails are
 * posted first and the recap is marked sent after, which is what lets a send
 * that died half way be pressed again and finish.
 *
 * ── THE TWO QUESTIONS AND THE NEXT GATHERING ───────────────────────────────
 *
 * The questions come from Comms Settings (`readCommsSettings().recapQuestions`)
 * as signed `recap_answer` links: the first a yes or no on the action page,
 * the second a box for words. The next gathering is the series' next evening,
 * else the soonest public or village gathering (`nextGatheringOrder`); a guest
 * is only offered one they can actually come to as a guest. Its `rsvp_next`
 * link takes the seat in one press: a member's answer under their user id, a
 * guest's directly, because the link reached their own inbox.
 *
 * Answers land in `event_feedback`, and the host reads them in the panel.
 *
 * "DRAFT IT FOR ME" builds a first draft from the facts and never sends
 * (Rye's ruling of 2026-09-24): a person reads it and presses Send.
 *
 * No raw SQL: the statements are in server/repos/eventRecaps.ts.
 */
import { AUTHORED_KINDS } from "../../../shared/gatherings";
import { GUEST_REFUSAL_WORDS } from "../../../shared/comms/guests";
import { isGuestKey } from "../../../shared/comms/kinds";
import { gatheringWhen, safeUrl, type MergeLink, type MergeValues } from "../../../shared/comms/mergeFields";
import type { ActionDescription } from "../../../shared/comms/preferences";
import {
  RECAP_ANSWER_MAX,
  RECAP_BODY_MAX,
  RECAP_EMPTY,
  RECAP_EXPIRY_DAYS,
  RECAP_LINK_DAYS,
  RECAP_NOTE_MAX,
  RECAP_YES_NO,
  RECORDING_URL_MAX,
  draftRecap,
  nextGatheringOrder,
  recapAudience,
  recapSendRefusal,
  recapWindowClosesAt,
  type NextCandidate,
  type RecapQuestionKey,
  type RecapView,
} from "../../../shared/comms/recap";
import {
  answersWithNames,
  attendanceMarks,
  feedbackFor,
  feedbackOf,
  markRecapSent,
  recapFor,
  saveRecapDraft,
  upsertFeedback,
} from "../../repos/eventRecaps";
import { listCalendarItems } from "../calendar";
import { boolVar, numberVar } from "../variables";
import type { ActionHandler, ActResult } from "./actions";
import { addresseeOf, eveningValues, firstNameOf, personValues, readEvening, type Evening, type MemberLookup } from "./gatheringEvening";
import { actionUrl, giveSeatBack, guestDoorFacts, standingOf, takeSeatOrQueue, zoneOf, type GuestDeps } from "./guests";
import { signLink, type LinkPayload } from "./links";
import { post } from "./postOffice";
import { loadEmailVillage, renderTemplate } from "./render";
import { readCommsSettings } from "./settings";

export interface RecapDeps extends GuestDeps {
  /** A member's name and address by user id; null for nobody, an example account or somebody who has left. */
  member: MemberLookup;
  /** The `comms.recap_window_days` dial. Absent: the game variable. */
  recapWindowDays?(): number;
}

type Fail = { ok: false; status: number; error: string };
const NOT_FOUND: Fail = { ok: false, status: 404, error: "This gathering isn't on the calendar." };

const nowOf = (d: GuestDeps): number => (d.now ? d.now() : Date.now());
const site = (d: GuestDeps): string => String(d.origin() ?? "").trim().replace(/\/+$/, "");
const windowDays = (d: RecapDeps): number => (d.recapWindowDays ? d.recapWindowDays() : numberVar("comms.recap_window_days"));

/** How far ahead a recap looks for the next gathering. */
const NEXT_LOOKAHEAD_DAYS = 120;
/** How many candidates a guest's next gathering is checked against before giving up. */
const NEXT_GUEST_TRIES = 12;

// ── The next gathering ──────────────────────────────────────────────────────

export interface NextGathering {
  eventId: string;
  occurrenceKey: string;
  title: string;
  startsAt: Date;
}

/** The gathering a recap offers next, for a member or for a guest, or null when there is none to offer. */
export async function nextGatheringFor(deps: RecapDeps, evening: Evening, audience: "member" | "guest"): Promise<NextGathering | null> {
  const now = nowOf(deps);
  const layers = audience === "guest" ? ["public"] : ["public", "village"];
  const items = await listCalendarItems(deps.getPool(), {
    from: new Date(now),
    to: new Date(now + NEXT_LOOKAHEAD_DAYS * 86_400_000),
    viewer: { userId: null, isAdmin: false },
    timezone: zoneOf(deps),
    kinds: AUTHORED_KINDS,
    layers: layers as Array<"public" | "village">,
    now: new Date(now),
  });
  const order = nextGatheringOrder(items as NextCandidate[], {
    eventId: evening.row.id,
    occurrenceKey: evening.occurrenceKey,
    now,
    layers,
  });
  for (const c of order.slice(0, audience === "guest" ? NEXT_GUEST_TRIES : 1)) {
    if (audience === "guest" && (await guestDoorFacts(deps, c.id, c.occurrenceKey)).refusal) continue;
    return { eventId: c.id, occurrenceKey: c.occurrenceKey, title: c.title, startsAt: new Date(c.startsAt) };
  }
  return null;
}

/** The signed one-press link that saves this person a seat at the next gathering. */
export function rsvpNextLink(origin: string, next: NextGathering, personKey: string, now: number): string | null {
  const days = Math.min(NEXT_LOOKAHEAD_DAYS, Math.max(1, Math.ceil((next.startsAt.getTime() - now) / 86_400_000) + 1));
  try {
    const token = signLink("rsvp_next", { e: next.eventId, ...(next.occurrenceKey ? { o: next.occurrenceKey } : {}), p: personKey }, days);
    return actionUrl(origin, token);
  } catch {
    // A key that cannot ride in a link gets the recap without the button.
    return null;
  }
}

/** The two questions as one-click links for one person: yes and no for the first, the box for the second. */
export function questionLinks(origin: string, evening: Evening, personKey: string, questions: [string, string]): MergeLink[] {
  const sign = (q: RecapQuestionKey, a?: string) =>
    actionUrl(
      origin,
      signLink(
        "recap_answer",
        { e: evening.row.id, ...(evening.occurrenceKey ? { o: evening.occurrenceKey } : {}), p: personKey, q, ...(a ? { a } : {}) },
        RECAP_LINK_DAYS,
      ),
    );
  try {
    return [
      { label: `${questions[0]} Yes`, href: sign("q1", "yes") },
      { label: `${questions[0]} No`, href: sign("q1", "no") },
      { label: questions[1], href: sign("q2") },
    ];
  } catch {
    return [];
  }
}

// ── The host's panel ────────────────────────────────────────────────────────

/** Everything the composer shows for one evening. */
export async function recapView(deps: RecapDeps, eventId: string, occurrenceKey: string): Promise<{ ok: true; view: RecapView } | Fail> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return NOT_FOUND;
  const occ = evening.occurrenceKey;
  const [recap, answers, marks, settings, feedback] = await Promise.all([
    recapFor(pool, eventId, occ),
    answersWithNames(pool, eventId, occ),
    attendanceMarks(pool, eventId, occ),
    readCommsSettings(pool),
    feedbackFor(pool, eventId, occ),
  ]);
  const audience = recapAudience(
    answers.filter((a) => a.status === "going").map((a) => a.personKey),
    marks,
  );
  const facts = {
    state: recap?.state ?? null,
    bodyMd: recap?.bodyMd ?? "",
    startsAt: evening.startsAt.getTime(),
    endsAt: evening.endsAt ? evening.endsAt.getTime() : null,
    now: nowOf(deps),
    windowDays: windowDays(deps),
    commsLifecycle: deps.commsLifecycle(),
  };
  // Saving a draft needs no body yet; "write the recap first" is the composer's own state, not a block.
  const refusal = recapSendRefusal(facts);
  const next = await nextGatheringFor(deps, evening, "member");
  return {
    ok: true,
    view: {
      manage: true,
      eventId,
      occurrenceKey: occ,
      title: evening.title,
      startsAt: evening.startsAt.toISOString(),
      recap: recap
        ? {
            bodyMd: recap.bodyMd,
            missedNoteMd: recap.missedNoteMd ?? "",
            recordingUrl: recap.recordingUrl ?? "",
            state: recap.state,
            sentAt: recap.sentAt,
          }
        : null,
      audience: { came: audience.came.length, missed: audience.missed.length },
      questions: settings.recapQuestions,
      answers: feedback,
      sendable: { ok: refusal === null, reason: refusal },
      closesAt: new Date(recapWindowClosesAt(facts)).toISOString(),
      next: next ? { title: next.title, when: gatheringWhen(next.startsAt, zoneOf(deps)).when } : null,
    },
  };
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n") : "");

/** Save the composer's draft. */
export async function saveRecap(
  deps: RecapDeps,
  eventId: string,
  occurrenceKey: string,
  input: { bodyMd?: unknown; missedNoteMd?: unknown; recordingUrl?: unknown },
  authorUserId: string,
): Promise<{ ok: true } | Fail> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return NOT_FOUND;
  const bodyMd = text(input.bodyMd).trim();
  const missedNoteMd = text(input.missedNoteMd).trim();
  const rawUrl = text(input.recordingUrl).trim();
  if (bodyMd.length > RECAP_BODY_MAX) return { ok: false, status: 400, error: `Keep the recap under ${RECAP_BODY_MAX} characters.` };
  if (missedNoteMd.length > RECAP_NOTE_MAX) return { ok: false, status: 400, error: `Keep the note under ${RECAP_NOTE_MAX} characters.` };
  const recordingUrl = rawUrl ? safeUrl(rawUrl) : null;
  if (rawUrl && (!recordingUrl || recordingUrl.length > RECORDING_URL_MAX || /^mailto:/i.test(recordingUrl))) {
    return { ok: false, status: 400, error: "Paste the recording's full web address, starting with https://." };
  }
  const saved = await saveRecapDraft(pool, {
    eventId,
    occurrenceKey: evening.occurrenceKey,
    bodyMd,
    missedNoteMd: missedNoteMd || null,
    recordingUrl,
    authorUserId,
  });
  return saved ? { ok: true } : { ok: false, status: 409, error: "Already sent." };
}

/** "Draft it for me": a first draft from the facts and the host's notes. Saves nothing. */
export async function draftForMe(deps: RecapDeps, eventId: string, occurrenceKey: string, notes: unknown): Promise<{ ok: true; bodyMd: string } | Fail> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return NOT_FOUND;
  const occ = evening.occurrenceKey;
  const marks = await attendanceMarks(pool, eventId, occ);
  const going = (await answersWithNames(pool, eventId, occ)).filter((a) => a.status === "going").length;
  const came = marks.size ? Array.from(marks.values()).filter((m) => m === "came").length : null;
  const day = gatheringWhen(evening.startsAt, zoneOf(deps)).when.replace(/ at .*$/, "");
  return { ok: true, bodyMd: draftRecap({ title: evening.title, dateLine: day, came, going, notes: text(notes).slice(0, RECAP_BODY_MAX) }) };
}

export interface SendSummary {
  ok: true;
  came: number;
  missed: number;
  /** Emails the post office took (queued, sent or rehearsed). */
  posted: number;
  /** People nobody could write to, or whose email the post office refused. */
  skipped: number;
}

/** Send the recap to everybody who said yes, each their own version. */
export async function sendRecap(deps: RecapDeps, eventId: string, occurrenceKey: string): Promise<SendSummary | Fail> {
  const pool = deps.getPool();
  const zone = zoneOf(deps);
  const evening = await readEvening(pool, eventId, occurrenceKey, zone);
  if (!evening) return NOT_FOUND;
  const occ = evening.occurrenceKey;
  const recap = await recapFor(pool, eventId, occ);
  const now = nowOf(deps);
  const refusal = recapSendRefusal({
    state: recap?.state ?? null,
    bodyMd: recap?.bodyMd ?? "",
    startsAt: evening.startsAt.getTime(),
    endsAt: evening.endsAt ? evening.endsAt.getTime() : null,
    now,
    windowDays: windowDays(deps),
    commsLifecycle: deps.commsLifecycle(),
  });
  if (refusal || !recap) return { ok: false, status: 409, error: refusal ?? RECAP_EMPTY };

  const going = (await answersWithNames(pool, eventId, occ)).filter((a) => a.status === "going").map((a) => a.personKey);
  const { came, missed } = recapAudience(going, await attendanceMarks(pool, eventId, occ));
  const origin = site(deps);
  const village = await loadEmailVillage(pool, origin);
  const { recapQuestions } = await readCommsSettings(pool);
  const host = await deps.member(recap.authorUserId);
  const nextFor = {
    member: await nextGatheringFor(deps, evening, "member"),
    guest: await nextGatheringFor(deps, evening, "guest"),
  };

  let posted = 0;
  let skipped = 0;
  const sendTo = async (personKey: string, version: "came" | "missed") => {
    const who = await addresseeOf(deps, personKey);
    if (!who) {
      skipped += 1;
      return;
    }
    const next = who.guest ? nextFor.guest : nextFor.member;
    const rsvpLink = next ? rsvpNextLink(origin, next, personKey, now) : null;
    const values: MergeValues = {
      ...eveningValues(evening, { village: zone, reader: who.timezone }),
      ...personValues(who.name),
      ...(host?.name ? { "gathering.hostName": firstNameOf(host.name) } : {}),
      "recap.body": { markdown: recap.bodyMd },
      "recap.missedNote": version === "missed" && recap.missedNoteMd ? { markdown: recap.missedNoteMd } : null,
      "recap.recording": recap.recordingUrl ?? "",
      "recap.questions": { links: questionLinks(origin, evening, personKey, recapQuestions) },
      ...(next && rsvpLink
        ? {
            "nextGathering.title": next.title,
            "nextGathering.when": gatheringWhen(next.startsAt, zone).when,
            "nextGathering.rsvpLink": rsvpLink,
          }
        : {}),
    };
    const templateKey = version === "came" ? "gathering.recap_came" : "gathering.recap_missed";
    const words = await renderTemplate(templateKey, values, { getPool: deps.getPool, village, contactId: who.contactId });
    const result = await post(deps.postOffice, {
      idempotencyKey: `recap:${eventId}:${occ}:${personKey}`,
      kind: "events",
      origin: "event.recap",
      to: { email: who.email, name: who.name, userId: who.userId, contactId: who.contactId },
      subject: words.subject,
      html: words.html,
      text: words.text,
      preheader: words.preheader,
      expiresAt: new Date(now + RECAP_EXPIRY_DAYS * 86_400_000),
      source: { templateKey, ...(words.version !== null ? { templateVersion: words.version } : {}) },
    });
    if (result.status === "skipped" || result.status === "failed" || result.status === "expired") skipped += 1;
    else posted += 1;
  };
  for (const k of came) await sendTo(k, "came");
  for (const k of missed) await sendTo(k, "missed");
  await markRecapSent(pool, eventId, occ);
  return { ok: true, came: came.length, missed: missed.length, posted, skipped };
}

// ── The one-click answers ───────────────────────────────────────────────────

/** The evening and the person a recap or next-gathering link names. */
function linkTarget(payload: LinkPayload): { eventId: string; occurrenceKey: string; personKey: string } | null {
  const eventId = typeof payload.e === "string" ? payload.e : "";
  const personKey = typeof payload.p === "string" ? payload.p : "";
  if (!eventId || !personKey) return null;
  return { eventId, occurrenceKey: typeof payload.o === "string" ? payload.o : "", personKey };
}

const SEEN_BY_HOST = "Your host sees your answer and your name.";

/** The handler for `recap_answer`: the first question yes or no, the second in words. */
export function recapAnswerAction(deps: RecapDeps): ActionHandler {
  const questionOf = (payload: LinkPayload): RecapQuestionKey | null => (payload.q === "q1" || payload.q === "q2" ? payload.q : null);

  async function describe(payload: LinkPayload): Promise<ActionDescription | null> {
    const t = linkTarget(payload);
    const q = questionOf(payload);
    if (!t || !q) return null;
    const pool = deps.getPool();
    const evening = await readEvening(pool, t.eventId, t.occurrenceKey, zoneOf(deps));
    if (!evening) return null;
    const { recapQuestions } = await readCommsSettings(pool);
    const about = `About ${evening.title}, ${gatheringWhen(evening.startsAt, zoneOf(deps)).when}.`;
    const previous = await feedbackOf(pool, evening.row.id, evening.occurrenceKey, t.personKey, q);
    if (q === "q1") {
      return {
        purpose: "recap_answer",
        title: recapQuestions[0],
        paragraphs: [about, SEEN_BY_HOST],
        choices: RECAP_YES_NO.map((v) => ({ value: v, label: v === "yes" ? "Yes" : "No", ...(payload.a === v ? { primary: true } : {}) })),
        current: previous === "yes" || previous === "no" ? previous : null,
        input: null,
      };
    }
    return {
      purpose: "recap_answer",
      title: recapQuestions[1],
      paragraphs: [about, ...(previous ? [`You wrote: ${previous}`] : []), SEEN_BY_HOST],
      choices: [],
      current: null,
      input: { name: "answer", label: "Your answer", multiline: true, maxLength: RECAP_ANSWER_MAX },
    };
  }

  return {
    purpose: "recap_answer",
    describe,
    async act(payload, body): Promise<ActResult> {
      const t = linkTarget(payload);
      const q = questionOf(payload);
      if (!t || !q) return { ok: false, status: 400, error: "This link doesn't work. Open the newest email from the village." };
      const pool = deps.getPool();
      const evening = await readEvening(pool, t.eventId, t.occurrenceKey, zoneOf(deps));
      if (!evening) return { ok: false, status: 404, error: "This gathering isn't on the calendar." };
      let answer: string;
      if (q === "q1") {
        if (body.choice !== "yes" && body.choice !== "no") return { ok: false, status: 400, error: "Press Yes or No." };
        answer = body.choice;
      } else {
        answer = text(body.text).trim();
        if (!answer) return { ok: false, status: 400, error: "Write your answer, then press Send." };
        if (answer.length > RECAP_ANSWER_MAX) return { ok: false, status: 400, error: `Keep it under ${RECAP_ANSWER_MAX} characters.` };
      }
      await upsertFeedback(pool, { eventId: evening.row.id, occurrenceKey: evening.occurrenceKey, personKey: t.personKey, questionKey: q, answer });
      return { ok: true, outcome: { ok: true, title: "Thank you!", paragraphs: [], description: await describe(payload) } };
    },
  };
}

/** The handler for `rsvp_next`: one press saves a seat at the next gathering. */
export function rsvpNextAction(deps: RecapDeps): ActionHandler {
  const whenOf = (e: Evening) => gatheringWhen(e.startsAt, zoneOf(deps)).when;

  async function describe(payload: LinkPayload): Promise<ActionDescription | null> {
    const t = linkTarget(payload);
    if (!t) return null;
    const pool = deps.getPool();
    const evening = await readEvening(pool, t.eventId, t.occurrenceKey, zoneOf(deps));
    if (!evening) return null;
    const base = { purpose: "rsvp_next" as const, input: null, current: null };
    const stand = await standingOf(pool, evening.row.id, t.personKey, evening.occurrenceKey);
    if (stand.going) {
      return { ...base, title: "You're on the list", paragraphs: [`${evening.title}, ${whenOf(evening)}.`], choices: [{ value: "release", label: "Give my place back" }] };
    }
    if (stand.place) {
      return {
        ...base,
        title: `Waitlist: number ${stand.place}`,
        paragraphs: [`${evening.title}, ${whenOf(evening)}.`, "We'll email you the moment a seat opens."],
        choices: [{ value: "release", label: "Leave the waitlist" }],
      };
    }
    if (evening.startsAt.getTime() <= nowOf(deps)) {
      return { ...base, title: "Already begun", paragraphs: ["Pick another gathering on the calendar."], choices: [] };
    }
    return {
      ...base,
      title: `Save a seat at ${evening.title}`,
      paragraphs: [`${whenOf(evening)}.`],
      choices: [{ value: "going", label: "Save me a seat", primary: true }],
    };
  }

  return {
    purpose: "rsvp_next",
    describe,
    async act(payload, body): Promise<ActResult> {
      const t = linkTarget(payload);
      if (!t) return { ok: false, status: 400, error: "This link doesn't work. Open the newest email from the village." };
      const pool = deps.getPool();
      const evening = await readEvening(pool, t.eventId, t.occurrenceKey, zoneOf(deps));
      if (!evening) return { ok: false, status: 404, error: "This gathering isn't on the calendar." };
      const eventId = evening.row.id;
      const occ = evening.occurrenceKey;

      if (body.choice === "release") {
        const gave = await giveSeatBack(pool, eventId, t.personKey, occ);
        return {
          ok: true,
          outcome: { ok: true, title: gave === "nothing" ? "Nothing to give back" : "Place given back", paragraphs: [], description: await describe(payload) },
        };
      }
      if (body.choice !== "going") return { ok: false, status: 400, error: "Press Save me a seat." };

      if (isGuestKey(t.personKey)) {
        // A guest confirms directly: the link reached their own inbox.
        const door = await guestDoorFacts(deps, eventId, occ);
        if (door.refusal) return { ok: false, status: 409, error: GUEST_REFUSAL_WORDS[door.refusal] };
      } else {
        const member = await deps.member(t.personKey);
        if (!member) return { ok: false, status: 404, error: "Sign in to answer this gathering." };
        const rsvpOpen = deps.rsvpEnabled ? deps.rsvpEnabled() : boolVar("events.rsvp_enabled");
        if (!rsvpOpen) return { ok: false, status: 409, error: "Answers are closed for now. Check back soon." };
        if (!(await deps.memberMayRsvp(t.personKey))) {
          return { ok: false, status: 403, error: "Your account can't answer gatherings yet. Sign in to see what opens it." };
        }
      }
      const seat = await takeSeatOrQueue(pool, eventId, t.personKey, occ);
      if (seat.kind === "refused") return { ok: false, status: seat.status, error: seat.error };
      return {
        ok: true,
        outcome: {
          ok: true,
          title: seat.kind === "going" ? "You're in!" : `Waitlist: number ${seat.position}`,
          paragraphs: seat.kind === "going" ? [`See you at ${evening.title}, ${whenOf(evening)}.`] : ["We'll email you the moment a seat opens."],
          description: await describe(payload),
        },
      };
    },
  };
}
