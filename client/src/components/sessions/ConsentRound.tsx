/**
 * A consent round, on the agenda or on one proposal.
 *
 * Three tiles: I consent, I consent with a concern, I object. A concern or an
 * objection is said in one sentence so the room can hear it whole, and the
 * tile cannot be sent without it. The tally counts the people here; the round
 * is consented when everyone here has answered and nobody objects. Each member
 * can change their answer while the round is open.
 *
 * The answers are heard by the people in the room: the server sends them only
 * to the people who joined and to admins, so anybody else reads that sentence
 * in place of a tally that would count everyone as still to answer. The
 * sentence being typed is a draft, so moving the room does not lose it.
 */
import { useState } from "react";
import {
  CONSENT_LABELS,
  CONSENT_VALUES,
  ROOM_COPY,
  SESSION_LIMITS,
  cleanLine,
  consentNeedsWords,
  isConsentValue,
  type ConsentValue,
  type ResponseTarget,
} from "@shared/sessions";
import { BTN_PRIMARY, H3, HINT, INPUT, consentOn, myResponse, nameOf, seesAnswers, tile, useDraft, type StageProps } from "./roomUi";

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
  const { tally } = consentOn(view, target);
  const heard = view.responses.filter((r) => r.target === target && (r.value === "concern" || r.value === "object") && r.text);
  const groupId = `consent-${target.replace(":", "-")}`;

  const send = async () => {
    if (!choice || busy) return;
    const sentence = cleanLine(words, SESSION_LIMITS.text);
    if (consentNeedsWords(choice) && !sentence) {
      setNote(ROOM_COPY.consentNeedsSentence);
      return;
    }
    setNote(null);
    setBusy(true);
    try {
      const r = await actions.respond(target, choice, consentNeedsWords(choice) ? sentence : null, { quiet: true });
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
          <div role="radiogroup" aria-labelledby={`${groupId}-ask`} className="grid gap-2 sm:grid-cols-3">
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
            <label className="block">
              <span className="sr-only">{ROOM_COPY.consentSentence}</span>
              <input
                className={INPUT}
                value={words}
                maxLength={SESSION_LIMITS.text}
                placeholder={ROOM_COPY.consentSentence}
                onChange={(e) => draft.set(e.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={!choice || busy} onClick={() => void send()}>
              {mine ? ROOM_COPY.consentChange : ROOM_COPY.consentSend}
            </button>
            {note && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {note}
              </p>
            )}
          </div>
        </>
      )}
      <p className={HINT} aria-live="polite">
        {seesAnswers(view) ? ROOM_COPY.tallyLine(tally) : ROOM_COPY.answersHeardInRoom}
      </p>
      {seesAnswers(view) && tally.consented && <p className="text-sm font-semibold text-open">{ROOM_COPY.consented}</p>}
      {heard.length > 0 && (
        <ul className="space-y-1.5">
          {heard.map((r) => (
            <li key={`${r.userId}`} className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
              <span className="font-semibold">{nameOf(view, r.userId) ?? ""}</span>{" "}
              <span className="text-muted-foreground">{isConsentValue(r.value) ? CONSENT_LABELS[r.value] : ""}:</span> {r.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
