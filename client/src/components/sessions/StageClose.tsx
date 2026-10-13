/**
 * CLOSE. Any proposal still open, so one the room consented to is marked
 * before the end; gratitude, one word each, feedback on the facilitation
 * (which the facilitator reads unsigned on the closed record, and nobody else
 * does), an idea for the tool (which lands in the village's feedback inbox),
 * and the facilitator's Close.
 *
 * Closing keeps the record, erases the arrival words and numbers, and tells
 * the admins and everyone holding an action. A session with an action nobody
 * holds does not close: the refusal is shown here, and the room moves to the
 * actions stage with those actions marked.
 */
import { useState } from "react";
import {
  CLOSE_REFUSAL,
  FACILITATION_LABELS,
  FACILITATION_VALUES,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  cleanLine,
  cleanText,
  type FacilitationValue,
} from "@shared/sessions";
import GratitudeRound from "./GratitudeRound";
import { OpenProposals } from "./Proposal";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, H3, HINT, INPUT, LABEL, myResponse, nameOf, tile, type StageProps } from "./roomUi";

function WordRound({ view, actions }: Omit<StageProps, "now">) {
  const mine = myResponse(view, "word");
  const [word, setWord] = useState(mine?.value ?? "");
  const [busy, setBusy] = useState(false);
  const words = view.responses.filter((r) => r.target === "word");
  const canSay = view.me.joined && view.status === "open";

  const say = async () => {
    const clean = cleanLine(word, SESSION_LIMITS.word);
    if (!clean || busy) return;
    setBusy(true);
    try {
      await actions.respond("word", clean);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="close-word">
      <h3 id="close-word" className={H3}>
        {SESSION_COPY.wordPrompt}
      </h3>
      {canSay && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void say();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{ROOM_COPY.wordPlaceholder}</span>
            <input
              className={INPUT}
              value={word}
              maxLength={SESSION_LIMITS.word}
              placeholder={ROOM_COPY.wordPlaceholder}
              onChange={(e) => setWord(e.target.value)}
            />
          </label>
          <button type="submit" className={BTN_SECONDARY} disabled={busy || !word.trim()}>
            {ROOM_COPY.wordSave}
          </button>
        </form>
      )}
      {words.length > 0 && (
        <div className="mt-4">
          <h4 className="sr-only">{ROOM_COPY.roomWords}</h4>
          <ul className="flex flex-wrap gap-2" aria-label={ROOM_COPY.roomWords}>
            {words.map((w) => (
              <li key={w.userId} className="rounded-2xl bg-teal-deep/10 px-4 py-2 text-center">
                <span className="block font-display text-lg font-semibold text-foreground">{w.value}</span>
                <span className="block text-xs text-muted-foreground">{nameOf(view, w.userId) ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FacilitationFeedback({ view, actions }: Omit<StageProps, "now">) {
  const [choice, setChoice] = useState<FacilitationValue | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // The facilitator does not give feedback on their own facilitation.
  if (!view.me.joined || view.status !== "open" || view.me.facilitates) return null;

  const send = async () => {
    if (!choice || busy) return;
    setBusy(true);
    try {
      const r = await actions.respond("facilitation", choice, cleanText(words, SESSION_LIMITS.text));
      if (r.ok) setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="close-facilitation">
      <h3 id="close-facilitation" className={H3}>
        {SESSION_COPY.facilitationPrompt}
      </h3>
      <div role="radiogroup" aria-labelledby="close-facilitation" className="mt-3 grid gap-2 sm:grid-cols-3">
        {FACILITATION_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={choice === v}
            className={tile(choice === v)}
            onClick={() => {
              setChoice(v);
              setSent(false);
            }}
          >
            {FACILITATION_LABELS[v]}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className={LABEL}>{SESSION_COPY.facilitationMore}</span>
        <textarea
          className={`${INPUT} mt-1 min-h-20`}
          value={words}
          maxLength={SESSION_LIMITS.text}
          onChange={(e) => {
            setWords(e.target.value);
            setSent(false);
          }}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_SECONDARY} disabled={!choice || busy} onClick={() => void send()}>
          {ROOM_COPY.facilitationSend}
        </button>
        {sent && (
          <p role="status" className="text-sm text-open">
            {ROOM_COPY.facilitationSent}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * What the room said about the facilitation, unsigned. The server sends it to
 * the facilitator and to admins, and only once the session is closed, all at
 * once: an answer that showed up while the room was still open would be tied
 * to whoever had just pressed send. So it is read on the closed record
 * (ClosedRecord), and the open Close stage does not draw it.
 */
export function FacilitationReading({ view }: Pick<StageProps, "view">) {
  const list = view.facilitation;
  if (!list) return null;
  const counts = FACILITATION_VALUES.map((v) => ({ v, n: list.filter((f) => f.value === v).length }));
  return (
    <section className={CARD} aria-labelledby="close-reading">
      <h3 id="close-reading" className={H3}>
        {ROOM_COPY.facilitationHeading}
      </h3>
      {list.length ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-2">
            {counts.map(({ v, n }) => (
              <li key={v} className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
                <span className="font-display text-lg font-bold tabular-nums text-foreground">{n}</span>{" "}
                <span className="text-muted-foreground">{FACILITATION_LABELS[v]}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1.5">
            {list
              .filter((f) => f.text)
              .map((f, i) => (
                <li key={i} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
                  {f.text}
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p className={`${HINT} mt-2`}>{ROOM_COPY.facilitationNone}</p>
      )}
    </section>
  );
}

function ToolIdea({ view, actions }: Omit<StageProps, "now">) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (!view.me.joined || view.status !== "open") return null;

  const send = async () => {
    const clean = cleanText(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.toolFeedback(clean);
      if (r.ok) {
        setSent(true);
        setText("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="close-tool">
      <h3 id="close-tool" className={H3}>
        {SESSION_COPY.toolPrompt}
      </h3>
      <label className="mt-3 block">
        <span className="sr-only">{SESSION_COPY.toolPrompt}</span>
        <textarea
          className={`${INPUT} min-h-20`}
          value={text}
          maxLength={SESSION_LIMITS.text}
          placeholder={SESSION_COPY.toolPlaceholder}
          onChange={(e) => {
            setText(e.target.value);
            setSent(false);
          }}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_SECONDARY} disabled={busy || !text.trim()} onClick={() => void send()}>
          {ROOM_COPY.toolSend}
        </button>
        {sent && (
          <p role="status" className="text-sm text-open">
            {SESSION_COPY.toolSent}
          </p>
        )}
      </div>
    </section>
  );
}

function CloseButton({ actions, onRefused }: Pick<StageProps, "actions"> & { onRefused: (unowned: number[], sentence: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await actions.close({ quiet: true });
      setAsking(false);
      if (r.ok) return;
      if (r.unowned && r.unowned.length) {
        const sentence = r.error === ROOM_COPY.writeFailed ? CLOSE_REFUSAL : r.error;
        setRefusal(sentence);
        onRefused(r.unowned, sentence);
      } else {
        setRefusal(r.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${CARD} border-teal-deep/40`}>
      {asking ? (
        <div role="group" aria-label={SESSION_COPY.closeButton}>
          <p className="font-medium text-foreground">{ROOM_COPY.closeConfirm}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void close()}>
              {ROOM_COPY.closeYes}
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setAsking(false)}>
              {ROOM_COPY.closeNo}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={BTN_PRIMARY} onClick={() => setAsking(true)}>
          {SESSION_COPY.closeButton}
        </button>
      )}
      {refusal && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {refusal}
        </p>
      )}
    </section>
  );
}

export default function StageClose({ view, actions, onRefused }: Omit<StageProps, "now"> & { onRefused: (unowned: number[], sentence: string) => void }) {
  return (
    <div className="space-y-5">
      <OpenProposals view={view} actions={actions} />
      <GratitudeRound view={view} />
      <WordRound view={view} actions={actions} />
      <FacilitationFeedback view={view} actions={actions} />
      <ToolIdea view={view} actions={actions} />
      {view.me.facilitates && view.status === "open" && <CloseButton actions={actions} onRefused={onRefused} />}
    </div>
  );
}
