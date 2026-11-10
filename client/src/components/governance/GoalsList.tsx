/**
 * THE GOALS LIST (joining lane PR 1): the interactive list a candidate writes
 * their first moon's goals in, on both doors. The open form draws it on each
 * role card (components/openProposal/RoleCardBridge.tsx); the member door draws
 * it as the "goals" field of its first step (WizardField).
 *
 * The pattern is the live session's task cards: a card for each, the fields
 * inline, add and remove, and reorder with buttons, so a keyboard or a screen
 * reader can do everything a pointer can. Changes are announced in a polite
 * live region. The rules (limits, nudges, the dates a goal may take) are
 * shared/proposalGoals.ts, the same ones the server holds a proposal to.
 *
 * It shows no share, percentage or amount: the goals together are the value of
 * the moon's contract, and that is all it says.
 */
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { BLANK_GOAL, GOAL_LIMITS, goalDateWindow, goalsNudge, type ProposalGoal } from "@shared/proposalGoals";

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ICON_BTN =
  "inline-flex size-11 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

export interface GoalRole {
  id: string;
  name: string;
  /** The role's own goals. Empty when the role has set none. */
  goals: readonly string[];
}
export interface GoalSeasonOption {
  value: string;
  label: string;
}

let nextKey = 0;
const newKey = () => `g${++nextKey}`;

export default function GoalsList({
  goals,
  onChange,
  roles,
  seasonGoals = [],
  idPrefix = "goals",
  problem,
  today = new Date().toISOString().slice(0, 10),
}: {
  goals: ProposalGoal[];
  onChange: (next: ProposalGoal[]) => void;
  /** The role or roles the goals belong to. With one, a goal never asks which. */
  roles: readonly GoalRole[];
  seasonGoals?: readonly GoalSeasonOption[];
  idPrefix?: string;
  problem?: string | null;
  today?: string;
}) {
  const { t } = useLingui();
  const keys = useRef<string[]>([]);
  while (keys.current.length < goals.length) keys.current.push(newKey());
  if (keys.current.length > goals.length) keys.current.length = goals.length;
  const [said, setSaid] = useState("");
  const focusOn = useRef<string | null>(null);
  useEffect(() => {
    if (!focusOn.current) return;
    document.getElementById(focusOn.current)?.focus();
    focusOn.current = null;
  });

  const many = roles.length > 1;
  const span = goalDateWindow(today);
  const cap = GOAL_LIMITS.max * Math.max(1, roles.length);
  const full = goals.length >= cap;
  const nudge = goalsNudge(goals.length, roles.length);
  const fid = (key: string, part: string) => `${idPrefix}-${key}-${part}`;

  const set = (i: number, patch: Partial<ProposalGoal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const add = () => {
    if (full) return;
    const key = newKey();
    keys.current = [...keys.current, key];
    focusOn.current = fid(key, "title");
    onChange([...goals, { ...BLANK_GOAL, roleId: roles[0]?.id ?? "" }]);
    setSaid(t`Goal added. You have ${goals.length + 1}.`);
  };
  const remove = (i: number) => {
    keys.current = keys.current.filter((_, j) => j !== i);
    focusOn.current = `${idPrefix}-add`;
    onChange(goals.filter((_, j) => j !== i));
    setSaid(t`Goal ${i + 1} removed. You have ${goals.length - 1}.`);
  };
  const move = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= goals.length) return;
    const g = [...goals];
    const k = [...keys.current];
    [g[i], g[to]] = [g[to]!, g[i]!];
    [k[i], k[to]] = [k[to]!, k[i]!];
    keys.current = k;
    focusOn.current = fid(k[to]!, dir === -1 ? "up" : "down");
    onChange(g);
    setSaid(t`Goal moved to position ${to + 1} of ${goals.length}.`);
  };

  return (
    <div className="grid gap-3" data-goals-list="">
      <p className="text-sm text-muted-foreground">
        {t`These are your goals for your first moon. Once you are seated, we issue your tasks on your profile each moon. We track both your goals and your tasks for your compensation. Together, your goals are the value of your contract for the moon.`}
      </p>
      <ol className="grid gap-3" aria-label={t({ message: "Your goals", context: "proposal goals list" })}>
        {goals.map((g, i) => {
          const key = keys.current[i]!;
          const role = roles.find((r) => r.id === g.roleId) ?? roles[0];
          const own = role?.goals ?? [];
          const n = i + 1;
          return (
            <li key={key} className="grid gap-3 rounded-xl border border-border bg-card p-3" data-goal={n}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-card-foreground">{t({ message: `Goal ${n}`, context: "proposal goals list" })}</h4>
                <div className="flex gap-1">
                  <button type="button" id={fid(key, "up")} className={ICON_BTN} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t({ message: `Move goal ${n} up`, context: "proposal goals list" })}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    id={fid(key, "down")}
                    className={ICON_BTN}
                    disabled={i === goals.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t({ message: `Move goal ${n} down`, context: "proposal goals list" })}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICON_BTN} onClick={() => remove(i)} aria-label={t({ message: `Remove goal ${n}`, context: "proposal goals list" })}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "title")}>
                {t({ message: "The goal", context: "proposal goals list" })}
                <input
                  id={fid(key, "title")}
                  className={FIELD}
                  maxLength={GOAL_LIMITS.title}
                  value={g.title}
                  placeholder={t`Plant the first three beds`}
                  onChange={(e) => set(i, { title: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "done")}>
                {t({ message: "Done when", context: "proposal goals list" })}
                <input
                  id={fid(key, "done")}
                  className={FIELD}
                  maxLength={GOAL_LIMITS.doneWhen}
                  value={g.doneWhen}
                  placeholder={t`they are planted and watered`}
                  onChange={(e) => set(i, { doneWhen: e.target.value })}
                />
              </label>
              {many && (
                <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "role")}>
                  {t`Which role it is for`}
                  <select id={fid(key, "role")} className={FIELD} value={g.roleId || roles[0]?.id} onChange={(e) => set(i, { roleId: e.target.value, moves: "" })}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {own.length > 0 ? (
                <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "moves")}>
                  {t`The role goal it moves`}
                  <select id={fid(key, "moves")} className={FIELD} value={g.moves} onChange={(e) => set(i, { moves: e.target.value })}>
                    <option value="">{t({ message: "Pick one", context: "proposal goals list" })}</option>
                    {own.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground" data-no-role-goals="">
                  {t`${role?.name ?? "This role"} has no goals set yet, so there is nothing to pick here. Your goal is read against the role's purpose.`}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {seasonGoals.length > 0 && (
                  <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "serves")}>
                    {t`The season goal it serves (optional)`}
                    <select id={fid(key, "serves")} className={FIELD} value={g.serves} onChange={(e) => set(i, { serves: e.target.value })}>
                      <option value="">{t({ message: "None in particular", context: "proposal goals list" })}</option>
                      {seasonGoals.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="grid gap-1 text-sm font-medium text-foreground" htmlFor={fid(key, "date")}>
                  {t`A day in this moon (optional)`}
                  <input id={fid(key, "date")} type="date" className={FIELD} min={span.min} max={span.max} value={g.date} onChange={(e) => set(i, { date: e.target.value })} />
                </label>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          id={`${idPrefix}-add`}
          onClick={add}
          disabled={full}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t({ message: "Add a goal", context: "proposal goals list" })}
        </button>
        <span className="text-xs text-muted-foreground">{full ? t`That is the most a proposal holds: ${cap}.` : t`Three to five is the usual.`}</span>
      </div>
      {nudge && (
        <p className="text-sm text-muted-foreground" data-goals-nudge="">
          {nudge === "few"
            ? t`Most people list three to five goals for a moon. You can send fewer, and we will read what you give us.`
            : t`Most people list three to five goals for a moon. More is allowed, and a shorter list is easier to read and to check.`}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
