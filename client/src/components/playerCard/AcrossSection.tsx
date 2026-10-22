/**
 * "Across all N roles": my aim, my seasonal goals, the village goals I serve
 * with how each helps, this moon's tasks, the signs, and the load: the counted
 * fact, my own read of it, my growing edge and who could hold this next.
 *
 * The load read is the owner's own slider, saved on change through
 * `PUT /api/season-plans/mine/load`; every other reader sees it read only.
 */
import { useContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, LOAD_STEPS, type AcrossOut, type LoadStep } from "@shared/playerCard";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { BOX, CardEditContext, EditInPlace, Eyebrow, H2, LINK, SECTION, SlotView } from "./cardParts";
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

/**
 * The owner's own slider: saves on change (`PUT /api/season-plans/mine/load`),
 * once the hand settles, and says so. Every other reader sees the meter.
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
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {W.loadSlider}
      </label>
      <input
        id={id}
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        aria-valuetext={words}
        onChange={(e) => change(Number(e.target.value))}
        className="h-11 w-full min-w-0 cursor-pointer accent-notice"
      />
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{W.loadEnds[0]}</span>
        <span>{W.loadEnds[1]}</span>
      </div>
      <p className="text-sm">{step === null && value === 3 && !said ? W.loadNotSet : words}</p>
      {said ? (
        <p role="status" className="text-sm text-card-foreground">
          {said}
        </p>
      ) : null}
    </div>
  );
}

function LoadRead({ load }: { load: AcrossOut["load"] }) {
  const { owner } = useContext(CardEditContext);
  if (load.own.kind === "unread") return null;
  const step = load.own.kind === "shown" ? load.own.value.step : null;
  if (owner) {
    return (
      <div className="grid gap-1">
        <LoadSlider step={step} />
        <p className="text-xs text-muted-foreground">{load.caption}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      {step !== null ? (
        <>
          <div
            role="meter"
            aria-label={W.loadSlider}
            aria-valuemin={1}
            aria-valuemax={5}
            aria-valuenow={step}
            aria-valuetext={load.own.kind === "shown" ? load.own.value.words : undefined}
            className="flex gap-1"
          >
            {LOAD_STEPS.map((s) => (
              <span key={s} className={`h-2 flex-1 rounded-full ${s <= step ? "bg-notice" : "bg-muted"}`} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
            <span>{W.loadEnds[0]}</span>
            <span>{W.loadEnds[1]}</span>
          </div>
          <p className="text-sm">{load.own.kind === "shown" ? load.own.value.words : null}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{load.own.kind === "empty" ? load.own.words : null}</p>
      )}
      <p className="text-xs text-muted-foreground">{load.caption}</p>
    </div>
  );
}

export function AcrossSection({ across, sheets, timeZone }: { across: AcrossOut; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  return (
    <section aria-labelledby="pc-across-h" className={`${SECTION} grid gap-6`}>
      <div className="grid gap-1">
        <Eyebrow gold>{across.heading}</Eyebrow>
        {across.doors.length ? (
          <div className="flex flex-wrap gap-3">
            {across.doors.map((d) => (
              <Link key={d.href} href={d.href} className={LINK}>
                {d.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <div>
            <h3 id="pc-across-h" className={H2}>
              {W.aim}
            </h3>
            <SlotView slot={across.aim}>{(a) => <p className="mt-2 text-lg">{a}</p>}</SlotView>
            {across.aim.kind !== "unread" && (
              <EditInPlace target={{ kind: "personal", key: "aim" }} label={W.aim} initial={textOf(across.aim, (a: string) => a)} />
            )}
          </div>

          {across.seasonalGoals.items.kind !== "unread" && (
            <div className="grid gap-2">
              <Eyebrow gold>{across.seasonalGoals.heading}</Eyebrow>
              <p className="text-sm text-muted-foreground">{across.seasonalGoals.lede}</p>
              <SlotView slot={across.seasonalGoals.items}>
                {(goals) => (
                  <ul className="grid gap-2">
                    {goals.map((g, i) => (
                      <li key={i} className={BOX}>
                        <p className="font-semibold">{g.title}</p>
                        {g.doneWhen ? <p className="text-sm text-muted-foreground">{g.doneWhen}</p> : null}
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
            <div className="grid gap-2">
              <Eyebrow>{W.goals}</Eyebrow>
              <SlotView slot={across.goals}>
                {(goals) => (
                  <ul className="grid gap-2">
                    {goals.map((g, i) => (
                      <li key={i} className={BOX}>
                        <p className="font-semibold">{g.goal}</p>
                        <p className="text-sm text-muted-foreground">
                          {W.howItHelps}: {g.howItHelps}
                        </p>
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
          <div className="grid content-start gap-2">
            <h3 className={H2}>{W.tasks}</h3>
            <SlotView slot={across.tasks}>
              {(tasks) => (
                <ol className="grid gap-2">
                  {tasks.map((t, i) => (
                    <li key={t.id} className={`${BOX} flex items-start gap-3`}>
                      <span className="font-display text-lg text-notice" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="grid flex-1 gap-0.5">
                        <span className="font-semibold">{t.title}</span>
                        {t.roleTitle ? <span className="text-sm text-muted-foreground">{t.roleTitle}</span> : null}
                        {t.doneWhen ? <span className="text-sm text-muted-foreground">{t.doneWhen}</span> : null}
                      </span>
                      <span className="text-sm font-medium">{t.state}</span>
                    </li>
                  ))}
                </ol>
              )}
            </SlotView>
          </div>
        )}
      </div>

      {across.signs.kind !== "unread" && (
        <div className="grid gap-2">
          <h3 className={H2}>{W.signs}</h3>
          <SlotView slot={across.signs}>{(signs) => <SignList signs={signs} sheets={sheets} timeZone={timeZone} />}</SlotView>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className={`${BOX} grid content-start gap-2`}>
          <Eyebrow>{across.load.heading}</Eyebrow>
          <p className="text-sm">{across.load.words}</p>
          <LoadRead load={across.load} />
        </div>
        {across.growingEdge.text.kind !== "unread" && (
          <div className={`${BOX} grid content-start gap-2`}>
            <Eyebrow>{across.growingEdge.heading}</Eyebrow>
            <SlotView slot={across.growingEdge.text}>{(t) => <p className="text-sm">{t}</p>}</SlotView>
            <EditInPlace target={{ kind: "personal", key: "growingEdge" }} label={across.growingEdge.heading} initial={textOf(across.growingEdge.text, (t: string) => t)} />
          </div>
        )}
        {across.whoCouldHoldNext.text.kind !== "unread" && (
          <div className={`${BOX} grid content-start gap-2`}>
            <Eyebrow>{across.whoCouldHoldNext.heading}</Eyebrow>
            <SlotView slot={across.whoCouldHoldNext.text}>{(t) => <p className="text-sm">{t}</p>}</SlotView>
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
