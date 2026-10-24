/**
 * A ROUND THAT OUTLIVED ITS CALL, on the closed record (0281). Rye ruled on
 * 2026-10-23 that a night names a time to answer by and that a night left
 * unanswered counts as no objection, and chose that the round outlives the
 * call. Under a proposal still open when the session closed with somebody
 * sleeping on it (`view.nights`, shared/sessions.ts `nightRoundState`):
 *
 *   each night, by name    until when it lasts, or that it ended and counts
 *                          as no objection;
 *   whoever asked for one  I consent, a concern or an objection (each of the
 *                          last two in one sentence), by their time;
 *   once no night lasts    whether the round consented, and for the
 *                          facilitator or an admin, Mark it decided.
 *
 * Every write reads its result before it says anything and a refusal is said
 * in the server's words. What landed is handed to the record (`onDone`), which
 * reads it out from a line that outlives this round, and the focus moves to
 * the proposal itself, since the form or the button it came from is gone.
 * Times are read on the room's own clock (`now`), never the device's alone.
 */
import { useState } from "react";
import { CONSENT_LABELS, ROOM_COPY, SESSION_LIMITS, cleanLine, consentNeedsWords, type NightRound, type SessionView } from "@shared/sessions";
import type { RoomActions } from "./useSessionRoom";
import { BTN_PRIMARY, BTN_SECONDARY, HINT, INPUT, nameOf, nightWhen, tile } from "./roomUi";

const AFTER_NIGHT = ["consent", "concern", "object"] as const;
type AfterNight = (typeof AFTER_NIGHT)[number];

export default function NightAfterCall({
  view,
  entryId,
  round,
  actions,
  now = Date.now(),
  onDone,
}: {
  view: SessionView;
  entryId: number;
  round: NightRound;
  actions?: Pick<RoomActions, "answerNight" | "decideAfterNight">;
  now?: number;
  /** What landed, for the record to read out, and to move the focus to this proposal. */
  onDone?: (words: string) => void;
}) {
  const target = `decision:${entryId}`;
  const nights = view.responses.filter((r) => r.target === target && r.value === "sleep" && r.answerBy);
  const mine = nights.find((r) => r.userId === view.me.userId);
  const [choice, setChoice] = useState<AfterNight | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const idBase = `night-${entryId}`;
  // Their own night, still ahead on the room's clock: the server's word and the clock both say so.
  const mineLasts = round.canAnswer && !!mine && Date.parse(mine.answerBy!) > now;

  const send = async () => {
    if (!choice || busy || !actions) return;
    const sentence = cleanLine(words, SESSION_LIMITS.text);
    if (consentNeedsWords(choice) && !sentence) {
      setNote(ROOM_COPY.consentNeedsSentence);
      return;
    }
    setNote(null);
    setBusy(true);
    const r = await actions.answerNight(entryId, choice, consentNeedsWords(choice) ? sentence : null, { quiet: true });
    setBusy(false);
    if (!r.ok) setNote(r.error);
    else onDone?.(ROOM_COPY.nightAnswered);
  };

  const decide = async () => {
    if (busy || !actions) return;
    setNote(null);
    setBusy(true);
    const r = await actions.decideAfterNight(entryId, { quiet: true });
    setBusy(false);
    if (!r.ok) setNote(r.error);
    else onDone?.(ROOM_COPY.decidedAfterNight);
  };

  return (
    <div className="mt-2 space-y-2" data-night-round={round.open ? "open" : round.consented ? "consented" : "settled"}>
      {nights.map((r) => {
        const at = Date.parse(r.answerBy!);
        if (r === mine && mineLasts) {
          return (
            <p key={`night-${r.userId}`} className="text-sm font-semibold text-foreground">
              {ROOM_COPY.recordNightYours(nightWhen(at, now))}
            </p>
          );
        }
        const name = nameOf(view, r.userId) ?? "";
        return (
          <p key={`night-${r.userId}`} className="text-sm text-foreground">
            {at <= now ? ROOM_COPY.nightOver(name, nightWhen(at, now)) : ROOM_COPY.nightOpen(name, nightWhen(at, now))}
          </p>
        );
      })}
      {mineLasts && actions && (
        <div className="space-y-2">
          <div role="radiogroup" aria-label={ROOM_COPY.nightAnswerAsk} className="grid gap-2 sm:grid-cols-3">
            {AFTER_NIGHT.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={choice === v}
                className={tile(choice === v)}
                onClick={() => {
                  setChoice(v);
                  setNote(null);
                }}
              >
                {CONSENT_LABELS[v]}
              </button>
            ))}
          </div>
          {choice && consentNeedsWords(choice) && (
            <div>
              <label htmlFor={`${idBase}-words`} className={`${HINT} block`}>
                {ROOM_COPY.consentSentence}
              </label>
              <input
                id={`${idBase}-words`}
                className={`mt-1 ${INPUT}`}
                maxLength={SESSION_LIMITS.text}
                value={words}
                onChange={(e) => setWords(e.target.value)}
              />
            </div>
          )}
          <button type="button" className={BTN_PRIMARY} disabled={!choice || busy} onClick={() => void send()}>
            {ROOM_COPY.consentSend}
          </button>
        </div>
      )}
      {!round.open && <p className="text-sm font-semibold text-foreground">{round.consented ? ROOM_COPY.recordConsented : ROOM_COPY.recordNotConsented}</p>}
      {round.canDecide && actions && (
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void decide()}>
          {ROOM_COPY.markDecided}
        </button>
      )}
      {note && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {note}
        </p>
      )}
    </div>
  );
}
