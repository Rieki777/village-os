/**
 * HOW ALIGNED TERMS END (seat settings PR8, migration 0251).
 *
 * A text in the alignment store comes into force when every required party
 * has aligned with it (server/lib/alignmentSubjects.ts). This file writes the
 * rows that END it, and nothing else: every act here is one INSERT into
 * `alignment_endings` through server/repos/alignments.ts, which only inserts.
 * Whether a text is in force is still derived on read (`deriveAlignmentState`
 * in shared/alignments.ts), so nothing here flips a flag.
 *
 *   NOTICE      a party gives notice. It takes effect after the terms' own
 *               notice days: the ending group's, else the term group's, else
 *               DEFAULT_NOTICE_DAYS (fourteen, the presets' own figure). The
 *               party who gave it may take it back until then. NOTICE NEVER
 *               UNSEATS ANYBODY: the seat ends through the doors that end
 *               seats (the holder of org.seat, a vote), and an ended seating
 *               ends the terms by the derivation.
 *   AGREEMENT   a party asks to end by agreement. The terms end once every
 *               required party has asked, at the moment the last one did. An
 *               ask may be taken back while the others have not all asked.
 *   PARTY LEFT  a member leaving the village ends every text they are a party
 *               to that has not ended. Leaving is never blocked by terms: the
 *               erasure sweep writes these rows and carries on.
 *
 * `superseded` and `term_end` are written by the sweep in alignmentSubjects.ts.
 *
 * A MEMBERSHIP LETTER (PR9) takes neither notice nor an ask: it ends when its
 * member leaves, by the PARTY LEFT row above, or when they align with the
 * letter again (`superseded`, written with the new signing). Both acts refuse
 * it in a sentence that says so.
 *
 * WHO ACTS FOR WHICH PARTY is the route's question, asked through the one
 * adoption rule; here a party key is handed in and trusted.
 *
 * ONE WRITER PER TEXT AT A TIME. Each act locks the text's row and reads its
 * endings inside the same transaction, so two clicks at once cannot both give
 * notice or both take one back.
 *
 * No recordEvent and no addActivity: the row is the record.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { noticeDaysOf } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import { endingsOf, insertEnding, lockText, textsForParty } from "../repos/alignments";
import { inApplicationTransaction } from "../repos/seatApplications";
import { endingIdFor, endsByAct, newEndingId, viewText, viewTexts, type TextView } from "./alignmentSubjects";

const DAY_MS = 24 * 60 * 60 * 1000;

export type EndingAct =
  | { ok: true; endingId: string; effectiveAt: Date; view: TextView }
  | { ok: false; status: number; error: string; message: string };

const refuse = (status: number, error: string, message: string): EndingAct => ({ ok: false, status, error, message });

interface ActInput {
  textId: string;
  /** 'user:<id>' or 'village': the party this act is for. */
  partyKey: string;
  /** The member whose click this is. */
  actorId: string;
  now: Date;
  timezone: string;
}

/** Lock the text, read it as of `now`, and hand both to `work`. */
async function onText<T extends EndingAct>(pool: Pool, input: ActInput, work: (conn: PoolConnection, v: TextView) => Promise<T>): Promise<EndingAct> {
  return inApplicationTransaction(pool, async (conn) => {
    if (!(await lockText(conn, input.textId))) return refuse(404, "not_found", "There is no text by that id.");
    const tz = input.timezone || "UTC";
    const v = await viewText(conn, input.textId, civilDateKey(input.now, tz), tz, input.now);
    if (!v) return refuse(404, "not_found", "There is no text by that id.");
    if (!v.parties.some((p) => p.partyKey === input.partyKey)) {
      return refuse(403, "not_a_party", "You are not a party to these terms, so there is nothing for you to end.");
    }
    // A membership letter (PR9) ends when its member leaves the village, never by notice or agreement.
    if (!endsByAct(v.text.subjectType)) {
      return refuse(409, "ends_on_leaving", "A membership letter ends when you leave the village, so there is no notice to give and nothing to agree.");
    }
    if (v.derived.state === "ended") return refuse(409, "ended", v.derived.why ?? "These terms have already ended.");
    if (!v.derived.allAligned) {
      return refuse(409, "not_aligned", "These terms are still waiting for every party to align, so there is nothing to end yet. The application can be withdrawn instead.");
    }
    return work(conn, v);
  });
}

/** Give notice. Takes effect after the terms' notice days. One running notice per party. */
export async function giveNotice(pool: Pool, input: ActInput): Promise<EndingAct> {
  return onText(pool, input, async (conn, v) => {
    if (v.derived.notices.some((n) => n.partyKey === input.partyKey)) {
      return refuse(409, "notice_running", "Notice is already running on these terms. Take it back first if you want to give it again.");
    }
    const days = noticeDaysOf(v.text.settings).days;
    const effectiveAt = new Date(input.now.getTime() + days * DAY_MS);
    const id = newEndingId();
    await insertEnding(conn, { id, textId: v.text.id, kind: "notice", refersTo: null, partyKey: input.partyKey, effectiveAt, recordedBy: input.actorId });
    return { ok: true, endingId: id, effectiveAt, view: v };
  });
}

/** Ask to end by agreement. The terms end when every required party has asked. */
export async function askToEnd(pool: Pool, input: ActInput): Promise<EndingAct> {
  return onText(pool, input, async (conn, v) => {
    if (v.derived.asks.some((a) => a.partyKey === input.partyKey)) {
      return refuse(409, "asked", "You already asked to end these terms by agreement. The other party has not asked yet.");
    }
    const id = newEndingId();
    await insertEnding(conn, { id, textId: v.text.id, kind: "mutual", refersTo: null, partyKey: input.partyKey, effectiveAt: input.now, recordedBy: input.actorId });
    return { ok: true, endingId: id, effectiveAt: input.now, view: v };
  });
}

/**
 * Take back a notice before it takes effect, or an ask to end by agreement
 * before every party has asked. Only the party who gave it. A `notice_withdrawn`
 * row naming it in `refers_to`; the notice row itself is never touched.
 */
export async function takeBack(pool: Pool, input: ActInput & { endingId: string }): Promise<EndingAct> {
  return onText(pool, input, async (conn, v) => {
    const open = [...v.derived.notices, ...v.derived.asks].find((x) => x.id === input.endingId);
    const row = (await endingsOf(conn, [v.text.id])).find((e) => e.id === input.endingId);
    if (!row || (row.kind !== "notice" && row.kind !== "mutual")) return refuse(404, "not_found", "There is no notice or ask by that id on these terms.");
    if (row.partyKey !== input.partyKey) return refuse(403, "not_yours", "Only the party who gave it can take it back.");
    if (!open) return refuse(409, "taken_effect", "That has already taken effect or been taken back, so there is nothing to take back.");
    const id = newEndingId();
    await insertEnding(conn, { id, textId: v.text.id, kind: "notice_withdrawn", refersTo: row.id, partyKey: input.partyKey, effectiveAt: input.now, recordedBy: input.actorId });
    return { ok: true, endingId: id, effectiveAt: input.now, view: v };
  });
}

/**
 * A MEMBER LEFT THE VILLAGE (spec section 5). Every text they are a party to
 * that has not ended gets a `party_left` ending, effective now, keyed on the
 * text so a resumed erasure writes nothing twice. Returns the titles of the
 * texts it ended, for the exit flow to name. Never refuses: leaving never
 * waits on terms.
 */
export async function recordPartyLeft(pool: Pool, userId: string, now: Date, timezone = "UTC"): Promise<string[]> {
  const tz = timezone || "UTC";
  const texts = await textsForParty(pool, userId);
  if (texts.length === 0) return [];
  const ended: string[] = [];
  for (const v of await viewTexts(pool, texts, civilDateKey(now, tz), tz, now)) {
    if (v.derived.state === "ended") continue;
    await insertEnding(pool, {
      id: endingIdFor("party_left", v.text.id),
      textId: v.text.id,
      kind: "party_left",
      refersTo: null,
      partyKey: `user:${userId}`,
      effectiveAt: now,
      recordedBy: userId,
    });
    ended.push(v.text.title);
  }
  return ended;
}
