/**
 * ARRIVAL. Each person gives one number from 1 to 11 for how they are
 * arriving, and, if they like, what would make it an 11+. While the session is
 * open the people in it see each other's numbers and words, the way a spoken
 * round works; at close the words and the numbers are erased and only the
 * spread is kept. Nobody fixes anybody's answer. Somebody who has not joined
 * is sent nobody's number, so they read that sentence once, in place of a
 * "Not yet" beside every name.
 *
 * The facilitator can run it as a speaking round in the order of the people
 * here, two names at a time: who speaks now and who is ready next.
 */
import { useState } from "react";
import {
  ARRIVAL_MAX,
  ARRIVAL_MIN,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  STAGE_DEFS,
  arrivalIsLow,
  arrivalSummary,
  cleanLine,
  roundSpeakers,
} from "@shared/sessions";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, H3, HINT, INPUT, LABEL, nameOf, presentPeople, tile, type StageProps } from "./roomUi";

const NUMBERS = Array.from({ length: ARRIVAL_MAX - ARRIVAL_MIN + 1 }, (_, i) => ARRIVAL_MIN + i);

export default function StageArrival({ view, actions }: StageProps) {
  const me = view.people.find((p) => p.userId === view.me.userId) ?? null;
  const [score, setScore] = useState<number | null>(me?.arrival ?? null);
  const [wish, setWish] = useState(me?.wish ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [roundBusy, setRoundBusy] = useState(false);

  const summary = arrivalSummary(view.people.map((p) => p.arrival));
  const speakers = roundSpeakers(view.state.round);
  const roundOn = view.state.round.order.length > 0;
  const joined = view.me.joined;

  const give = async () => {
    if (score == null || busy) return;
    setBusy(true);
    setSaved(false);
    try {
      const r = await actions.arrival(score, cleanLine(wish, SESSION_LIMITS.wish));
      if (r.ok) setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const roundAct = async (kind: "start" | "next" | "previous" | "end") => {
    setRoundBusy(true);
    try {
      if (kind === "start") {
        // The facilitator goes first to set the tone, then everyone here.
        const here = presentPeople(view).map((p) => p.userId);
        const order = [view.facilitatorUserId, ...here.filter((u) => u !== view.facilitatorUserId)].filter((u) =>
          here.includes(u),
        );
        await actions.act({ type: "round", label: STAGE_DEFS.arrival.short, order: order.length ? order : here });
      } else if (kind === "end") {
        await actions.act({ type: "round", label: null, order: [] });
      } else {
        await actions.act({ type: kind });
      }
    } finally {
      setRoundBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {arrivalIsLow(summary) && (
        <p role="status" className="rounded-xl border border-amber/60 bg-amber-light px-4 py-3 text-sm font-medium text-foreground">
          {SESSION_COPY.arrivalLow}
        </p>
      )}

      <section className={CARD} aria-labelledby="arrival-mine">
        <h3 id="arrival-mine" className={H3}>
          {SESSION_COPY.arrivalPrompt}
        </h3>
        {joined ? (
          <div className="mt-3 space-y-4">
            <div role="radiogroup" aria-labelledby="arrival-mine" className="grid grid-cols-6 gap-2 sm:grid-cols-11">
              {NUMBERS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={score === n}
                  className={`${tile(score === n)} px-0 text-base tabular-nums`}
                  onClick={() => {
                    setScore(n);
                    setSaved(false);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <label className="block">
              <span className={LABEL}>{SESSION_COPY.wishPrompt}</span>
              <input
                className={`${INPUT} mt-1`}
                value={wish}
                maxLength={SESSION_LIMITS.wish}
                placeholder={SESSION_COPY.wishPlaceholder}
                onChange={(e) => {
                  setWish(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={BTN_PRIMARY} disabled={score == null || busy} onClick={() => void give()}>
                {me?.arrival != null ? ROOM_COPY.changeNumber : ROOM_COPY.giveNumber}
              </button>
              {saved && (
                <p role="status" className="text-sm text-open">
                  {SESSION_COPY.arrivalSaved}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className={`${HINT} mt-2`}>{ROOM_COPY.joinFirst}</p>
        )}
      </section>

      <section className={CARD} aria-labelledby="arrival-room">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="arrival-room" className={H3}>
            {ROOM_COPY.theRoom}
          </h3>
          {view.me.facilitates && (
            <div className="flex flex-wrap gap-2">
              {!roundOn ? (
                <button type="button" className={BTN_SECONDARY} disabled={roundBusy} onClick={() => void roundAct("start")}>
                  {ROOM_COPY.roundStart}
                </button>
              ) : (
                <>
                  <button type="button" className={BTN_SECONDARY} disabled={roundBusy || speakers.done} onClick={() => void roundAct("next")}>
                    {ROOM_COPY.roundNext}
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled={roundBusy || view.state.round.at === 0} onClick={() => void roundAct("previous")}>
                    {ROOM_COPY.roundBack}
                  </button>
                  <button type="button" className={BTN_SECONDARY} disabled={roundBusy} onClick={() => void roundAct("end")}>
                    {ROOM_COPY.roundEnd}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {!joined && <p className={`${HINT} mt-2`}>{ROOM_COPY.arrivalHeardInRoom}</p>}

        {roundOn && (
          <div className="mt-3 flex flex-wrap gap-3" aria-live="polite">
            {speakers.done ? (
              <p className="text-sm font-semibold text-open">{ROOM_COPY.roundDone}</p>
            ) : (
              <>
                <p className="rounded-xl bg-teal-deep/10 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">{ROOM_COPY.speakingNow}</span>{" "}
                  <span className="font-semibold text-foreground">{nameOf(view, speakers.now) ?? ""}</span>
                </p>
                {speakers.next != null && (
                  <p className="rounded-xl bg-muted/60 px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{ROOM_COPY.readyNext}</span>{" "}
                    <span className="font-semibold text-foreground">{nameOf(view, speakers.next) ?? ""}</span>
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.people.map((p) => {
            const speaking = speakers.now === p.userId;
            return (
              <li
                key={p.userId}
                className={`flex gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  speaking ? "border-teal-deep bg-teal-deep/5" : "border-border bg-card"
                }`}
              >
                {joined && (
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold tabular-nums ${
                      p.arrival != null ? "bg-teal-deep/15 text-foreground" : "bg-muted text-muted-foreground"
                    }`}
                    aria-label={p.arrival != null ? String(p.arrival) : ROOM_COPY.notYet}
                  >
                    {p.arrival ?? "·"}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{p.name}</span>
                  {joined && <span className="block text-sm text-muted-foreground">{p.wish ?? (p.arrival == null ? ROOM_COPY.notYet : "")}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
