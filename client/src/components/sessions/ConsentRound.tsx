/**
 * A consent round, on the agenda or on one proposal.
 *
 * Four tiles: I consent, I consent with a concern, I object, and I'll sleep on
 * it, for someone who decides best after a night. A concern or an objection is
 * said in one sentence so the room can hear it whole, and the tile cannot be
 * sent without it; sleeping on it needs none and is never an objection. A
 * night names when it ends (Rye, 2026-10-23): "Tomorrow, 9:00", "In two days,
 * 9:00", or a time up to a week ahead, and the tile cannot be sent without it.
 * The tally counts the people here; the round is consented when everyone here
 * has answered, nobody is sleeping on it, and nobody objects. While a night
 * lasts the round stays open and says until when, by name; once it ends with
 * no other answer it counts as no objection, by default, and says that too.
 * Each member can change their answer while the round is open.
 *
 * The answers are heard by the people in the room: the server sends them only
 * to the people who joined and to admins, so anybody else reads that sentence
 * in place of a tally that would count everyone as still to answer. The
 * sentence being typed is a draft, so moving the room does not lose it.
 *
 * An answer belongs to the person who gave it, so nobody else changes it, and
 * the person changes it by answering again: the server keeps one answer per
 * person and the newest wins. The line under the button says so, once they
 * have answered. Once the round is no longer open there is no box at all.
 */
import { useState } from "react";
import {
  CONSENT_LABELS,
  CONSENT_VALUES,
  ROOM_COPY,
  SESSION_LIMITS,
  SLEEP_LIMITS,
  cleanLine,
  consentNeedsWords,
  isConsentValue,
  type ConsentValue,
  type ResponseTarget,
} from "@shared/sessions";
import GrowingText from "./GrowingText";
import {
  BTN_PRIMARY,
  BTN_QUIET,
  H3,
  HINT,
  INPUT,
  LABEL,
  consentOn,
  localInputValue,
  myResponse,
  nameOf,
  nightWhen,
  nineAfter,
  seesAnswers,
  tile,
  useDraft,
  waitingNames,
  type StageProps,
} from "./roomUi";

/**
 * "Waiting for Ana, Luz", in small muted words under a tally, so the
 * facilitator can ask the people still to answer by name. The server sends the
 * names only to viewers who see the answers and only while the session is
 * open, so for anybody else, and once everyone has answered, it says nothing.
 */
export function WaitingLine({ view, target, className = "" }: { view: StageProps["view"]; target: ResponseTarget; className?: string }) {
  const names = seesAnswers(view) && view.status === "open" ? waitingNames(view, target) : [];
  if (!names.length) return null;
  return <p className={`text-sm text-muted-foreground ${className}`}>{ROOM_COPY.waitingFor(names)}</p>;
}

export interface ConsentRoundProps extends Omit<StageProps, "now"> {
  target: ResponseTarget;
  ask: string;
  /** Not in the room yet: the round is shown and nothing can be sent. */
  readOnly?: boolean;
}

export default function ConsentRound({ view, actions, target, ask, readOnly }: ConsentRoundProps) {
  const mine = myResponse(view, target);
  const [choice, setChoice] = useState<ConsentValue | null>(mine && isConsentValue(mine.value) ? mine.value : null);
  const draft = useDraft(`${view.id}:${target}:words`, mine?.text ?? "");
  const words = draft.text;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A night's end, as the viewer's own clock writes it in a datetime field.
  const [nightEnds, setNightEnds] = useState(mine?.answerBy ? localInputValue(Date.parse(mine.answerBy)) : "");
  const now = Date.now();
  const { tally } = consentOn(view, target, now);
  const heard = view.responses.filter((r) => r.target === target && (r.value === "concern" || r.value === "object") && r.text);
  const nights = seesAnswers(view) ? view.responses.filter((r) => r.target === target && r.value === "sleep") : [];
  const untimedNights = nights.filter((r) => !r.answerBy).length;
  const groupId = `consent-${target.replace(":", "-")}`;

  const send = async () => {
    if (!choice || busy) return;
    const sentence = cleanLine(words, SESSION_LIMITS.text);
    if (consentNeedsWords(choice) && !sentence) {
      setNote(ROOM_COPY.consentNeedsSentence);
      return;
    }
    const nightAt = choice === "sleep" && nightEnds ? new Date(nightEnds).getTime() : Number.NaN;
    if (choice === "sleep" && !Number.isFinite(nightAt)) {
      setNote(ROOM_COPY.nightNeeded);
      return;
    }
    setNote(null);
    setBusy(true);
    try {
      const r = await actions.respond(
        target,
        choice,
        consentNeedsWords(choice) ? sentence : null,
        { quiet: true },
        choice === "sleep" ? new Date(nightAt).toISOString() : undefined,
      );
      // The server holds the sentence now; the draft is done with, the words stay on screen.
      if (r.ok) draft.clear(words);
      else setNote(r.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${groupId}-ask`} className="space-y-3">
      <h3 id={`${groupId}-ask`} className={H3}>
        {ask}
      </h3>
      {!readOnly && (
        <>
          <div role="radiogroup" aria-labelledby={`${groupId}-ask`} className="grid gap-2 sm:grid-cols-2">
            {CONSENT_VALUES.map((v) => (
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
            <GrowingText
              value={words}
              onValue={draft.set}
              onSubmit={() => void send()}
              label={ROOM_COPY.consentSentence}
              max={SESSION_LIMITS.text}
              minRows={2}
              singleLine
            />
          )}
          {choice === "sleep" && (
            <fieldset className="space-y-2">
              <legend className={LABEL}>{ROOM_COPY.nightAsk}</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_QUIET} onClick={() => setNightEnds(localInputValue(nineAfter(now, 1)))}>
                  {ROOM_COPY.nightTomorrow}
                </button>
                <button type="button" className={BTN_QUIET} onClick={() => setNightEnds(localInputValue(nineAfter(now, 2)))}>
                  {ROOM_COPY.nightTwoDays}
                </button>
              </div>
              <label htmlFor={`${groupId}-night`} className={`${HINT} block`}>
                {ROOM_COPY.nightTimeLabel}
              </label>
              <input
                id={`${groupId}-night`}
                type="datetime-local"
                className={`${INPUT} max-w-xs`}
                min={localInputValue(now + SLEEP_LIMITS.minAheadMs)}
                max={localInputValue(now + SLEEP_LIMITS.maxAheadMs)}
                value={nightEnds}
                onChange={(e) => setNightEnds(e.target.value)}
                aria-describedby={`${groupId}-night-hint`}
              />
              <p id={`${groupId}-night-hint`} className={`${HINT} text-xs`}>
                {ROOM_COPY.nightHint}
              </p>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={!choice || busy || (choice === "sleep" && !nightEnds)} onClick={() => void send()}>
              {mine ? ROOM_COPY.consentChange : ROOM_COPY.consentSend}
            </button>
            {note && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {note}
              </p>
            )}
          </div>
          {mine && <p className={`${HINT} text-xs`}>{ROOM_COPY.answerAgain}</p>}
        </>
      )}
      <p className={HINT} aria-live="polite">
        {seesAnswers(view) ? ROOM_COPY.tallyLine(tally) : ROOM_COPY.answersHeardInRoom}
      </p>
      <WaitingLine view={view} target={target} />
      {nights
        .filter((r) => r.answerBy)
        .map((r) => {
          const at = Date.parse(r.answerBy!);
          const name = nameOf(view, r.userId) ?? "";
          return (
            <p key={`night-${r.userId}`} className="text-sm text-foreground">
              {at <= now ? ROOM_COPY.nightOver(name, nightWhen(at, now)) : ROOM_COPY.nightOpen(name, nightWhen(at, now))}
            </p>
          );
        })}
      {untimedNights > 0 && <p className="text-sm text-foreground">{ROOM_COPY.sleepingOpen}</p>}
      {seesAnswers(view) && tally.consented && <p className="text-sm font-semibold text-open">{ROOM_COPY.consented}</p>}
      {heard.length > 0 && (
        <ul className="space-y-1.5">
          {heard.map((r) => (
            <li key={`${r.userId}`} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
              <span className="font-semibold">{nameOf(view, r.userId) ?? ""}</span>{" "}
              <span className="text-muted-foreground">{isConsentValue(r.value) ? CONSENT_LABELS[r.value] : ""}:</span> {r.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
