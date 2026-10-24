/**
 * "Across all N roles", as the approved design draws it: my aim this season
 * beside this moon's tasks; my seasonal goals and the village goals they
 * serve, each with how it helps; how we'll know it's working, the signs with
 * their trends; and the load this moon, my growing edge and who could hold
 * this next in three small boxes.
 *
 * The load read is the owner's own slider, saved on change through
 * `PUT /api/season-plans/mine/load`; every other reader sees it read only, as
 * the design's five-step load bar.
 */
import { useContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, LOAD_STEPS, type AcrossOut, type LoadStep } from "@shared/playerCard";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { CardEditContext, EditInPlace, Eyebrow, SlotView } from "./cardParts";
import { savePersonalWords } from "./playerCardApi";
import { SignList } from "./SignList";

const textOf = <T,>(slot: { kind: string; value?: T }, pick: (v: T) => string) => (slot.kind === "shown" ? pick(slot.value as T) : "");

/** The seasonal goals back as the editor's lines: "Title: done when". */
const DONE_WHEN_PREFIX = "Done when ";
const goalLines = (goals: { title: string; doneWhen: string | null }[]) =>
  goals
    .map((g) => {
      const when = g.doneWhen?.startsWith(DONE_WHEN_PREFIX) ? g.doneWhen.slice(DONE_WHEN_PREFIX.length) : g.doneWhen;
      return when ? `${g.title}: ${when}` : g.title;
    })
    .join("\n");

/** How long the slider waits after the last change before it saves, so a drag is one save. */
export const LOAD_SAVE_DELAY_MS = 400;

/** The design's two ends under the slider and the bar: Healthy in green, Heavy in amber. */
function LoadEnds() {
  return (
    <div className="pc-loadends" aria-hidden="true">
      <span>{W.loadEnds[0]}</span>
      <span>{W.loadEnds[1]}</span>
    </div>
  );
}

/**
 * The owner's own slider: saves on change (`PUT /api/season-plans/mine/load`),
 * once the hand settles, and says so. Every other reader sees the bar.
 */
function LoadSlider({ step }: { step: number | null }) {
  const { reload } = useContext(CardEditContext);
  const [value, setValue] = useState<number>(step ?? 3);
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const change = (n: number) => {
    setValue(n);
    setSaid(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void savePersonalWords("loadRead", String(n)).then((r) => {
        setSaid(r.ok ? EDIT_WORDS.loadSaved : r.error);
        if (r.ok) reload();
      });
    }, LOAD_SAVE_DELAY_MS);
  };
  const words = W.loadStep[value as LoadStep] ?? "";
  return (
    <>
      <label className="pc-loadslide" htmlFor={id}>
        <span className="pc-sr">{W.loadSlider}</span>
        <input id={id} type="range" min={1} max={5} step={1} value={value} aria-valuetext={words} onChange={(e) => change(Number(e.target.value))} />
      </label>
      <LoadEnds />
      <p className="pc-f12">{step === null && value === 3 && !said ? W.loadNotSet : words}</p>
      {said ? (
        <p role="status" className="pc-said">
          {said}
        </p>
      ) : null}
    </>
  );
}

function LoadRead({ load }: { load: AcrossOut["load"] }) {
  const { owner } = useContext(CardEditContext);
  if (load.own.kind === "unread") return <p className="pc-dim pc-f12">{load.caption}</p>;
  const step = load.own.kind === "shown" ? load.own.value.step : null;
  if (owner) {
    return (
      <>
        <LoadSlider step={step} />
        <p className="pc-dim pc-f12">{load.caption}</p>
      </>
    );
  }
  return (
    <>
      {step !== null ? (
        <>
          <div
            role="meter"
            aria-label={W.loadSlider}
            aria-valuemin={1}
            aria-valuemax={5}
            aria-valuenow={step}
            aria-valuetext={load.own.kind === "shown" ? load.own.value.words : undefined}
            className="pc-load"
          >
            {LOAD_STEPS.map((s) => (
              <i key={s} className={s <= step ? "pc-on" : undefined} />
            ))}
          </div>
          <LoadEnds />
          <p className="pc-f12">{load.own.kind === "shown" ? load.own.value.words : null}</p>
        </>
      ) : (
        <p className="pc-dim pc-f12">{load.own.kind === "empty" ? load.own.words : null}</p>
      )}
      <p className="pc-dim pc-f12">{load.caption}</p>
    </>
  );
}

export function AcrossSection({ across, sheets, timeZone }: { across: AcrossOut; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  return (
    <section aria-labelledby="pc-across-h" className="pc-panel">
      <Eyebrow gold>{across.heading}</Eyebrow>
      {across.doors.length ? (
        <div className="pc-doors">
          {across.doors.map((d) => (
            <Link key={d.href} href={d.href} className="pc-tab">
              {d.label}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="pc-season">
        <div className="pc-col">
          <h3 id="pc-across-h" className="pc-h2">
            {W.aim}
          </h3>
          <SlotView slot={across.aim}>{(a) => <p className="pc-aim">{a}</p>}</SlotView>
          {across.aim.kind !== "unread" && (
            <EditInPlace target={{ kind: "personal", key: "aim" }} label={W.aim} initial={textOf(across.aim, (a: string) => a)} />
          )}

          {across.seasonalGoals.items.kind !== "unread" && (
            <div className="pc-stack">
              <Eyebrow gold>{across.seasonalGoals.heading}</Eyebrow>
              <p className="pc-dim pc-f13">{across.seasonalGoals.lede}</p>
              <SlotView slot={across.seasonalGoals.items}>
                {(goals) => (
                  <ul className="pc-goals">
                    {goals.map((g, i) => (
                      <li key={i} className="pc-goal pc-sgoal">
                        <b>{g.title}</b>
                        {g.doneWhen ? <span>{g.doneWhen}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </SlotView>
              <EditInPlace
                target={{ kind: "personal", key: "seasonalGoals" }}
                label={across.seasonalGoals.heading}
                initial={textOf(across.seasonalGoals.items, goalLines)}
                hint={EDIT_WORDS.seasonalGoalsHint}
              />
            </div>
          )}

          {across.goals.kind !== "unread" && (
            <div className="pc-stack">
              <Eyebrow>{W.goals}</Eyebrow>
              <SlotView slot={across.goals}>
                {(goals) => (
                  <ul className="pc-goals">
                    {goals.map((g, i) => (
                      <li key={i} className="pc-goal">
                        <b>{g.goal}</b>
                        <span>
                          {W.howItHelps}: {g.howItHelps}
                        </span>
                        <EditInPlace
                          target={{ kind: "personal", key: "howItHelps", goal: g.goal }}
                          label={`${W.howItHelps}, ${g.goal}`}
                          initial={g.howItHelps === W.howItHelpsMissing ? "" : g.howItHelps}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </SlotView>
              <EditInPlace
                target={{ kind: "personal", key: "servesGoal" }}
                label={W.goals}
                initial={textOf(across.goals, (g: { goal: string }[]) => g.map((x) => x.goal).join("\n"))}
                hint={EDIT_WORDS.servesGoalsHint}
              />
            </div>
          )}
        </div>

        {across.tasks.kind !== "unread" && (
          <div className="pc-col pc-tasks">
            <h3 className="pc-h2">{W.tasks}</h3>
            <p className="pc-dim pc-f13">{across.moonLine}</p>
            <SlotView slot={across.tasks}>
              {(tasks) => (
                <ol className="pc-quests">
                  {tasks.map((t, i) => (
                    <li key={t.id} className="pc-quest">
                      <span className="pc-qn" aria-hidden="true">
                        {i + 1}
                      </span>
                      <div>
                        <b>{t.title}</b>
                        {t.roleTitle ? <span>{t.roleTitle}</span> : null}
                        {t.roleTitle && t.doneWhen ? <br /> : null}
                        {t.doneWhen ? <span>{t.doneWhen}</span> : null}
                      </div>
                      <span className={`pc-state${t.state === W.taskDone ? " pc-done" : ""}`}>{t.state}</span>
                    </li>
                  ))}
                </ol>
              )}
            </SlotView>
          </div>
        )}
      </div>

      {across.signs.kind !== "unread" && (
        <div className="pc-stack pc-signsblock">
          <h3 className="pc-h2">{W.signs}</h3>
          <p className="pc-lede pc-f14">{across.signsLede}</p>
          <SlotView slot={across.signs}>{(signs) => <SignList signs={signs} sheets={sheets} timeZone={timeZone} />}</SlotView>
        </div>
      )}

      <div className="pc-trio">
        <div className="pc-mini">
          <Eyebrow>{across.load.heading}</Eyebrow>
          <p className="pc-f14">{across.load.words}</p>
          <LoadRead load={across.load} />
        </div>
        {across.growingEdge.text.kind !== "unread" && (
          <div className="pc-mini">
            <Eyebrow>{across.growingEdge.heading}</Eyebrow>
            <SlotView slot={across.growingEdge.text}>{(t) => <p className="pc-f14">{t}</p>}</SlotView>
            <EditInPlace target={{ kind: "personal", key: "growingEdge" }} label={across.growingEdge.heading} initial={textOf(across.growingEdge.text, (t: string) => t)} />
          </div>
        )}
        {across.whoCouldHoldNext.text.kind !== "unread" && (
          <div className="pc-mini">
            <Eyebrow>{across.whoCouldHoldNext.heading}</Eyebrow>
            <SlotView slot={across.whoCouldHoldNext.text}>{(t) => <p className="pc-f14">{t}</p>}</SlotView>
            <EditInPlace
              target={{ kind: "personal", key: "whoCouldHoldNext" }}
              label={across.whoCouldHoldNext.heading}
              initial={textOf(across.whoCouldHoldNext.text, (t: string) => t)}
            />
          </div>
        )}
      </div>
    </section>
  );
}
