/**
 * THE ROWS BEHIND A SIGN: what a reader sees on tapping a count on the card.
 *
 * Each sign in `shared/roleSigns.ts` turns rows into one number. This turns the
 * same rows, over the same window, into the lines that number was made of, so
 * a reader can check it. Pure, and node-tested (`roleSignRows.test.ts`).
 *
 * THE RULES:
 *
 *   1. NEVER RANKED. Rows come in the order things happened, earliest first,
 *      and a row with no date comes last in the order it arrived. Nothing is
 *      sorted by how well anybody did.
 *   2. A PERSON IS AN ID HERE, NEVER A NAME. `personId` is handed to the host,
 *      which prints a first name at the member tier and nothing below it.
 *   3. A ROLE IS NAMED BY ITS FULL TITLE, the same as everywhere on the card.
 *   4. THE SAME RULES AS THE COUNT. A row is in the sheet exactly when the
 *      counter looked at it, so the sheet and the number cannot disagree.
 *   5. UNREAD IS NOT EMPTY. An unknown key or an unread table returns null.
 */
import { isWithinBusinessDays } from "./businessDays";
import { isSignKey, SIGNS, type SignRows, type SignWindow, type Stamp } from "./roleSigns";

export interface SignSheetRow {
  /** When it happened, as an instant. Null for a state row with no date. */
  at: string | null;
  words: string;
  /** Whose row it is, for the host to name at the member tier. Never printed as is. */
  personId: string | null;
}

export const SHEET_WORDS = {
  answered: "Answered within 2 business days",
  answeredLate: "Answered after 2 business days",
  waiting: "Waiting, still inside 2 business days",
  notAnswered: "Not answered within 2 business days",
  filed: "Season plan filed",
  notFiled: "No season plan filed yet",
  activeInTime: "Active within 7 days of joining",
  stillNew: "Joined, still inside 7 days",
  notActive: "Not active within 7 days of joining",
  questFinished: "Community quest finished",
  fullCard: (role: string) => `${role}: full card and a term`,
  missing: (role: string, what: string) => `${role}: missing ${what}`,
  draftDecided: "Org chart draft decided within 2 business days",
  draftLate: "Org chart draft decided after 2 business days",
  draftWaiting: "Org chart draft open, still inside 2 business days",
  draftOpen: "Org chart draft not decided within 2 business days",
  met: (n: number) => `The circle met, ${n} people`,
  decision: "A decision recorded",
  noRows: "Nothing to show in this window yet",
  heading: "What this count is made of",
  firstNamesNote: "First names only. Listed in the order it happened.",
  orderNote: "Listed in the order it happened.",
} as const;

const ms = (s: Stamp | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const t = s instanceof Date ? s.getTime() : new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
};
const iso = (s: Stamp | null | undefined): string | null => {
  const t = ms(s);
  return t === null ? null : new Date(t).toISOString();
};
const inWindow = (s: Stamp | null | undefined, w: SignWindow): boolean => {
  const t = ms(s);
  return t !== null && t >= w.from.getTime() && t < w.to.getTime();
};
const DAY_MS = 86_400_000;

function listOf(v: string[] | string | null): string[] {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s.trim());
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
  } catch {
    return [];
  }
}

function answerWords(
  created: Stamp,
  decided: Stamp | null,
  w: SignWindow,
  words: { inTime: string; late: string; waiting: string; missed: string },
): string {
  const c = new Date(ms(created)!);
  const d = ms(decided);
  if (d !== null) return isWithinBusinessDays(c, new Date(d), 2, w.timeZone) ? words.inTime : words.late;
  return isWithinBusinessDays(c, w.to, 2, w.timeZone) ? words.waiting : words.missed;
}

/** Earliest first; undated rows last, in the order they arrived. Never by outcome. */
function inOrder(rows: SignSheetRow[]): SignSheetRow[] {
  return rows
    .map((r, i) => ({ r, i, t: r.at === null ? Number.POSITIVE_INFINITY : new Date(r.at).getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.r);
}

/** The rows behind one sign over one window, or null when it cannot be read. */
export function signSheetRows(key: string | null | undefined, rows: SignRows, w: SignWindow): SignSheetRow[] | null {
  if (!isSignKey(key)) return null;
  const def = SIGNS[key];
  if (!def.reads.every((k) => rows[k] !== undefined)) return null;
  const out: SignSheetRow[] = [];

  switch (key) {
    case "applications-answered":
      for (const r of rows.seat_applications!) {
        if (r.status === "withdrawn" || !inWindow(r.created_at, w)) continue;
        out.push({
          at: iso(r.created_at),
          words: answerWords(r.created_at, r.decided_at, w, {
            inTime: SHEET_WORDS.answered,
            late: SHEET_WORDS.answeredLate,
            waiting: SHEET_WORDS.waiting,
            missed: SHEET_WORDS.notAnswered,
          }),
          personId: r.candidate_user_id ?? null,
        });
      }
      break;
    case "season-plans-filed": {
      const filedAt = new Map<string, number>();
      for (const p of rows.season_plans!) {
        const t = ms(p.filed_at);
        if (p.season_id !== rows.season_id || t === null || t >= w.to.getTime()) continue;
        const was = filedAt.get(p.user_id);
        if (was === undefined || t < was) filedAt.set(p.user_id, t);
      }
      for (const u of rows.users!) {
        const t = filedAt.get(u.id);
        out.push({
          at: t === undefined ? null : new Date(t).toISOString(),
          words: t === undefined ? SHEET_WORDS.notFiled : SHEET_WORDS.filed,
          personId: u.id,
        });
      }
      break;
    }
    case "newcomers-active": {
      const firstAct = new Map<string, number>();
      const note = (id: string | null, s: Stamp) => {
        const t = ms(s);
        if (!id || t === null) return;
        const was = firstAct.get(id);
        if (was === undefined || t < was) firstAct.set(id, t);
      };
      for (const c of rows.quest_claims!) note(c.user_id, c.claimed_at);
      for (const a of rows.org_role_assignments!) note(a.user_id, a.started_at);
      for (const u of rows.users!) {
        if (!inWindow(u.joined_at, w)) continue;
        const joined = ms(u.joined_at)!;
        const deadline = joined + 7 * DAY_MS;
        const act = firstAct.get(u.id);
        const active = act !== undefined && act >= joined && act <= deadline;
        out.push({
          at: iso(u.joined_at),
          words: active ? SHEET_WORDS.activeInTime : deadline <= w.to.getTime() ? SHEET_WORDS.notActive : SHEET_WORDS.stillNew,
          personId: u.id,
        });
      }
      break;
    }
    case "community-quests-finished":
      for (const c of rows.quest_claims!) {
        if (c.status !== "consented" || !inWindow(c.consented_at, w)) continue;
        out.push({ at: iso(c.consented_at), words: SHEET_WORDS.questFinished, personId: c.user_id });
      }
      break;
    case "roles-with-card-and-term": {
      const now = w.to.getTime();
      const termed = new Set(
        rows.org_role_assignments!
          .filter((a) => {
            const ended = ms(a.ended_at);
            return (ended === null || ended > now) && ms(a.term_ends_at) !== null;
          })
          .map((a) => a.org_role_id),
      );
      for (const r of rows.org_roles!) {
        if (!(r.active === true || r.active === 1)) continue;
        const title = r.name?.trim() || r.id;
        const missing = [
          r.aim?.trim() ? null : "aim",
          r.domain?.trim() ? null : "domain",
          listOf(r.accountabilities).length ? null : "what it answers for",
          termed.has(r.id) ? null : "a term",
        ].filter((s): s is string => s !== null);
        out.push({
          at: null,
          words: missing.length ? SHEET_WORDS.missing(title, missing.join(", ")) : SHEET_WORDS.fullCard(title),
          personId: null,
        });
      }
      break;
    }
    case "org-drafts-decided":
      for (const d of rows.org_drafts!) {
        if (d.status === "withdrawn" || !inWindow(d.created_at, w)) continue;
        out.push({
          at: iso(d.created_at),
          words: answerWords(d.created_at, d.published_at, w, {
            inTime: SHEET_WORDS.draftDecided,
            late: SHEET_WORDS.draftLate,
            waiting: SHEET_WORDS.draftWaiting,
            missed: SHEET_WORDS.draftOpen,
          }),
          personId: null,
        });
      }
      break;
    case "circle-met": {
      const people = new Map<number, Set<number>>();
      for (const p of rows.live_session_people!) {
        const set = people.get(p.session_id) ?? new Set<number>();
        set.add(p.member_no);
        people.set(p.session_id, set);
      }
      for (const s of rows.live_sessions!) {
        const n = people.get(s.id)?.size ?? 0;
        if (!inWindow(s.created_at, w) || n < 2) continue;
        if (rows.circle_id !== undefined && s.circle_id !== rows.circle_id) continue;
        out.push({ at: iso(s.created_at), words: SHEET_WORDS.met(n), personId: null });
      }
      break;
    }
    case "decisions-recorded":
      for (const e of rows.live_session_entries!) {
        if (e.kind !== "decision" || e.status !== "done" || !inWindow(e.created_at, w)) continue;
        out.push({ at: iso(e.created_at), words: SHEET_WORDS.decision, personId: null });
      }
      break;
  }
  return inOrder(out);
}
