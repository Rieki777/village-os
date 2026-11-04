/**
 * WHAT THE END OF MOON ROOM DRAWS, from the moon-review module's room door
 * (`GET /api/moon-review/rooms/:sessionId`, `RoomResponse` in
 * shared/moonRecap.ts).
 *
 * `moonRoomPanel` is the one place the room's sections read that answer, and
 * it copies field by field into a shape that has no place for a number about
 * a person's moon: no amount, no score, no reading, no moon load, no count of
 * privately held items and no quiet accountability. Whatever else the door
 * sends, the room never draws it (spec section 9, addendum A4: no room panel
 * shows anyone's numbers). The two counts it keeps are of people: how many
 * have sent, and who is ready.
 *
 * The stick holder's recap and goals show only once they chose Show my moon
 * (the stick's `shows`, shared/sessionTemplates.ts). Speak only is where every
 * holder starts.
 */
import { GOAL_STATUS_WORDS, MOON_ROUTES, sendByLine, type RecapStatus, type RoomResponse } from "./moonRecap";

export const moonRoomApi = (sessionId: number): string => MOON_ROUTES.room.replace(":sessionId", String(sessionId));

export interface MoonRoomPanel {
  holderName: string | null;
  /** The holder chose Show my moon. */
  shown: boolean;
  /** Null while the holder speaks only, or has no recap. */
  recap: {
    roles: Array<{ name: string; items: Array<{ text: string; proofUrl: string | null }> }>;
    seasonGoals: string[];
  } | null;
  /** Names of who is ready to share. Nobody is ever listed as not ready. */
  ready: string[];
  /** Null while the holder speaks only, or has set none. */
  goals: {
    last: Array<{ text: string; mark: string; flagged: boolean }>;
    next: Array<{ text: string; doneWhen: string | null }>;
  } | null;
  /** This viewer's own row in Sending together. */
  mine: { statusWords: string; send: boolean } | null;
  /** How many people have sent. */
  sentCount: number;
  /** "Send by Monday 9 November 2026. ..." or empty when the door gave no day. */
  sendBy: string;
}

/** A proof link the room may open: http or https only. */
const safeUrl = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A recap that is not sent yet can be sent from My moon. */
const SENDABLE: ReadonlySet<RecapStatus | null> = new Set<RecapStatus | null>([null, "draft", "returned"]);

/** The room's view of the door's answer: only the words the room may draw. */
export function moonRoomPanel(r: RoomResponse | null, shown: boolean): MoonRoomPanel {
  const recap = shown && r?.recap
    ? {
        roles: (r.recap.roles ?? []).map((role) => ({
          name: str(role.name),
          items: (role.items ?? []).map((i) => ({ text: str(i.text), proofUrl: safeUrl(i.evidenceUrl) })).filter((i) => i.text),
        })),
        // The room door sends no season-goal tallies (A4: no numbers on the shared screen), so none are drawn.
        seasonGoals: [] as string[],
      }
    : null;
  const goals = shown && r?.goals
    ? {
        last: (r.goals.last ?? []).map((g) => ({ text: str(g.text), mark: GOAL_STATUS_WORDS[g.status] ?? "", flagged: g.flagged === true })),
        next: (r.goals.next ?? []).map((g) => ({ text: str(g.text), doneWhen: typeof g.doneWhen === "string" && g.doneWhen ? g.doneWhen : null })),
      }
    : null;
  return {
    holderName: r?.holder ? str(r.holder.name) : null,
    shown,
    recap,
    ready: (r?.ready ?? []).map((p) => str(p.name)).filter(Boolean),
    goals,
    mine: r?.mine ? { statusWords: str(r.mine.statusWords), send: SENDABLE.has(r.mine.recapStatus ?? null) } : null,
    sentCount: Number.isInteger(r?.sentCount) && (r?.sentCount ?? 0) > 0 ? (r?.sentCount as number) : 0,
    sendBy: r?.moon?.sendBy ? sendByLine(r.moon.sendBy) : "",
  };
}
