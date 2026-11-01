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
 *
 * THE ROOM AS A PARTY. The room's grid is this stage's one foil card: each
 * person as a small portrait (their fronted character's stock art, or their
 * initials), their number set as a figure in the body face, so a 1 reads as a
 * one, and their words under it. The facilitator wears a star, the note taker
 * a pen.
 *
 * A number and its words belong to the person who gave them, and they change
 * them by giving them again (the server keeps one per person). The line under
 * the button says so once they have.
 */
import { useEffect, useRef, useState } from "react";
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
import Figure from "@/components/sheet/Figure";
import GrowingText from "./GrowingText";
import FilledInNote from "./FilledInNote";
import PersonDisc from "./PersonDisc";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  H3,
  HERO_CONTENT,
  HERO_INNER,
  HERO_SHELL,
  HINT,
  LABEL,
  nameOf,
  presentPeople,
  tile,
  type StageProps,
} from "./roomUi";

const NUMBERS = Array.from({ length: ARRIVAL_MAX - ARRIVAL_MIN + 1 }, (_, i) => ARRIVAL_MIN + i);

export default function StageArrival({ view, actions }: StageProps) {
  // The facilitator filling in for somebody (0288) gives that person's number here.
  const forNo = view.me.facilitates ? (actions.fillingFor ?? null) : null;
  const whom = forNo ?? view.me.userId;
  const me = view.people.find((p) => p.userId === whom) ?? null;
  const [score, setScore] = useState<number | null>(me?.arrival ?? null);
  const [wish, setWish] = useState(me?.wish ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // A different person chosen: the form starts from what they gave, if anything.
  // Only a real change of person resets it. The first render already started
  // from the stored values, and a mount effect that ran again after a click
  // (its passive flush can land after the click's update) put the stored
  // number back over the one just chosen. A refetch keeps the same person, so
  // it never resets the form either.
  const shownFor = useRef(whom);
  useEffect(() => {
    if (shownFor.current === whom) return;
    shownFor.current = whom;
    setScore(me?.arrival ?? null);
    setWish(me?.wish ?? "");
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whom]);
  const [roundBusy, setRoundBusy] = useState(false);

  const summary = arrivalSummary(view.people.map((p) => p.arrival));
  const speakers = roundSpeakers(view.state.round);
  const roundOn = view.state.round.order.length > 0;
  const joined = view.me.joined;

  const give = async () => {
    if (score == null || busy) return;
    const givenFor = whom;
    setBusy(true);
    setSaved(false);
    try {
      const r = await actions.arrival(score, cleanLine(wish, SESSION_LIMITS.wish));
      // "Saved" speaks for the person on screen: a switch while the save was out leaves it unsaid.
      if (r.ok && shownFor.current === givenFor) setSaved(true);
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
        <p role="status" className="rounded-xl border border-notice/50 bg-muted px-4 py-3 text-sm font-medium text-foreground">
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
            <div>
              <label htmlFor="arrival-wish" className={`${LABEL} mb-1`}>
                {SESSION_COPY.wishPrompt}
              </label>
              <GrowingText
                id="arrival-wish"
                value={wish}
                onValue={(next) => {
                  setWish(next);
                  setSaved(false);
                }}
                onSubmit={() => void give()}
                label={SESSION_COPY.wishPlaceholder}
                max={SESSION_LIMITS.wish}
                minRows={1}
                singleLine
              />
            </div>
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
            {me?.arrival != null && <p className={`${HINT} text-xs`}>{ROOM_COPY.answerAgain}</p>}
          </div>
        ) : (
          <p className={`${HINT} mt-2`}>{ROOM_COPY.joinFirst}</p>
        )}
      </section>

      <section className={HERO_SHELL} aria-labelledby="arrival-room">
        <div className={HERO_INNER}>
          <div className={HERO_CONTENT}>
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

            {!joined && <p className={HINT}>{ROOM_COPY.arrivalHeardInRoom}</p>}

            {roundOn && (
              <div className="flex flex-wrap gap-3" aria-live="polite">
                {speakers.done ? (
                  <p className="text-sm font-semibold text-open">{ROOM_COPY.roundDone}</p>
                ) : (
                  <>
                    <p className="rounded-xl border border-notice/60 bg-muted px-4 py-2 text-sm">
                      <span className="text-muted-foreground">{ROOM_COPY.speakingNow}</span>{" "}
                      <span className="font-semibold text-foreground">{nameOf(view, speakers.now) ?? ""}</span>
                    </p>
                    {speakers.next != null && (
                      <p className="rounded-xl border border-border bg-muted px-4 py-2 text-sm">
                        <span className="text-muted-foreground">{ROOM_COPY.readyNext}</span>{" "}
                        <span className="font-semibold text-foreground">{nameOf(view, speakers.next) ?? ""}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {view.people.map((p) => {
                const speaking = speakers.now === p.userId;
                const mark = p.userId === view.facilitatorUserId ? "facilitator" : p.userId === view.secretaryUserId ? "notes" : null;
                return (
                  <li
                    key={p.userId}
                    className={`flex items-start gap-3 rounded-xl border bg-muted px-3 py-3 transition-colors ${
                      speaking ? "border-notice ring-1 ring-notice/40" : "border-border"
                    }`}
                  >
                    <PersonDisc person={p} size="portrait" mark={mark} />
                    <div className="min-w-0 flex-1">
                      {joined ? (
                        <dl className="flex">
                          <Figure
                            layout="seat"
                            face="body"
                            tone={p.arrival != null ? "gold" : null}
                            value={p.arrival != null ? String(p.arrival) : "·"}
                            label={p.name}
                          />
                        </dl>
                      ) : (
                        <p className="font-semibold text-foreground">{p.name}</p>
                      )}
                      {joined && <p className="mt-2 text-sm text-muted-foreground">{p.wish ?? (p.arrival == null ? ROOM_COPY.notYet : "")}</p>}
                      {joined && <FilledInNote filled={p.arrivalFilledIn} actions={actions} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
