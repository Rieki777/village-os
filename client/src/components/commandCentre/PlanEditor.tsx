/**
 * THE COMMAND CENTRE'S PLAN, EDITED IN PLACE (Rye, 2026-10-22).
 *
 * Two editors over one draft plan, shown where the plan is read: the weeks
 * and their tasks in place of the Timeline, the decisions in place of the
 * Decision Log. The page holds the draft and saves it whole; nothing here
 * talks to the server.
 *
 * Removing hides. A removed week, task or decision drops out of every view
 * and stays listed under "Removed" with a Restore button, and its stored
 * ticks, notes and answers are still there when it comes back.
 *
 * Every field carries the limit `PLAN_LIMITS` sets and the route enforces,
 * and shows its count as it nears it.
 */
import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { charCount } from "@shared/pageContent/resolve";
import { PLAN_LIMITS, planIds, visibleTasks, type CommandCentrePlan } from "@shared/commandCentrePlan";
import {
  addDecision,
  addTask,
  addWeek,
  hiddenItems,
  moveDecision,
  moveTask,
  moveWeek,
  setDecisionHidden,
  setTaskHidden,
  setWeekHidden,
  updateDecision,
  updatePartner,
  updateTask,
  updateWeek,
  type Plan,
} from "@/lib/planEdits";

interface EditorProps {
  plan: Plan;
  onChange: (plan: Plan) => void;
  /** Keys the stored state already uses, so a new id never inherits one. */
  stateKeys: Iterable<string>;
  /** Fills `{village}` and the other words, for previews only. */
  fill: (text: string) => string;
}

const INPUT =
  "w-full min-w-0 text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep bg-white text-stone-700";

/** A text field that holds its limit and shows the count as it gets close. */
export function LimitedField({
  value,
  max,
  onChange,
  label,
  multiline = false,
  rows = 2,
  placeholder,
  autoFocus,
  className = "",
}: {
  value: string;
  max: number;
  onChange: (next: string) => void;
  label: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const n = charCount(value);
  const near = n >= Math.floor(max * 0.8);
  return (
    <div className={`min-w-0 ${className}`}>
      {multiline ? (
        <textarea
          value={value}
          maxLength={max}
          rows={rows}
          aria-label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          className={`${INPUT} resize-y font-sans leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          value={value}
          maxLength={max}
          aria-label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          className={INPUT}
        />
      )}
      {near && (
        <p
          className={`text-[11px] mt-0.5 text-right ${n > max ? "text-red-600" : "text-stone-500"}`}
        >
          {n}/{max}
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  tone = "plain",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "plain" | "remove";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-stone-200 bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        tone === "remove"
          ? "text-stone-500 hover:bg-red-50 hover:text-red-600"
          : "text-stone-500 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

/** Move and remove, beside a field where there is room and under it where there is not. */
function RowButtons({ children }: { children: ReactNode }) {
  // Gaps of 8px between 36px buttons keep the 44px touch zones index.css adds
  // from overlapping, and the 4px on the right keeps the last one inside its row.
  return <div className="flex gap-2 justify-end shrink-0 pr-1">{children}</div>;
}

function AddButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 transition-colors disabled:opacity-40"
    >
      <Plus className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}

function taken(plan: Plan, stateKeys: Iterable<string>): Set<string> {
  const ids = new Set<string>(Array.from(stateKeys));
  planIds(plan).forEach(id => ids.add(id));
  return ids;
}

/** Restores what was removed. Listed so a removal is never a mystery. */
export function RemovedItems({
  plan,
  onChange,
  kinds,
  fill,
}: {
  plan: Plan;
  onChange: (plan: Plan) => void;
  kinds: Array<"week" | "task" | "decision">;
  fill: (text: string) => string;
}) {
  const items = hiddenItems(plan).filter(i => kinds.includes(i.kind));
  if (items.length === 0) return null;
  const restore = (kind: "week" | "task" | "decision", id: string) =>
    onChange(
      kind === "week"
        ? setWeekHidden(plan, id, false)
        : kind === "task"
          ? setTaskHidden(plan, id, false)
          : setDecisionHidden(plan, id, false)
    );
  const KIND_WORD: Record<"week" | "task" | "decision", string> = {
    week: "Week",
    task: "Task",
    decision: "Decision",
  };
  return (
    <details className="bg-stone-100 rounded-xl border border-stone-200 px-4 py-3 mt-6">
      <summary className="cursor-pointer text-sm font-semibold text-stone-600 select-none">
        Removed ({items.length})
      </summary>
      <p className="text-xs text-stone-500 mt-2 mb-2">
        Hidden from every view. Their ticks, notes and answers are kept, and
        come back with them.
      </p>
      <ul className="space-y-2">
        {items.map(item => (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-start gap-3"
          >
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-stone-500 mt-0.5 w-16">
              {KIND_WORD[item.kind]}
            </span>
            <span className="flex-1 min-w-0 text-sm text-stone-600 break-words">
              {fill(item.text) || "Untitled"}
            </span>
            <button
              type="button"
              onClick={() => restore(item.kind, item.id)}
              className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-white border border-stone-200 text-teal-deep hover:bg-teal-deep/10"
            >
              <RotateCcw className="w-3 h-3" />
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The weeks and their tasks, in plan order, with the build partner's name on
 * top where the legend shows it.
 */
export function PlanWeeksEditor({
  plan,
  onChange,
  stateKeys,
  fill,
  villageName,
}: EditorProps & { villageName: string }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const weeks = plan.weeks.filter(w => !w.hidden);
  const totalTasks = plan.weeks.reduce((n, w) => n + w.tasks.length, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
          Who owns it
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LimitedField
            label="Build partner's name"
            value={plan.partnerName}
            max={PLAN_LIMITS.partnerName}
            onChange={v => onChange(updatePartner(plan, v))}
            className="w-44"
          />
          <span className="px-2 py-0.5 rounded-full border text-xs font-semibold bg-amber/20 text-amber-800 border-amber/40">
            {villageName}
          </span>
          <span className="px-2 py-0.5 rounded-full border text-xs font-semibold bg-violet-100 text-violet-700 border-violet-200">
            Both
          </span>
        </div>
        <p className="text-xs text-stone-500 mt-2">
          The build side's name shows on the owner pill, this legend and each
          row's dropdown. Write {"{village}"} in any text below for your
          village's name.
        </p>
      </div>

      {weeks.map((week, wi) => {
        const tasks = week.tasks.filter(t => !t.hidden);
        return (
          <section
            key={week.id}
            className="bg-white rounded-xl border border-stone-200 shadow-sm p-4"
            aria-label={`Week ${wi + 1}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-2">
              <LimitedField
                label={`Week ${wi + 1} label`}
                value={week.label}
                max={PLAN_LIMITS.weekLabel}
                placeholder="Week label, for example Week 7 | May 5-11"
                autoFocus={focusId === week.id}
                onChange={v =>
                  onChange(updateWeek(plan, week.id, { label: v }))
                }
                className="flex-1"
              />
              <RowButtons>
                <IconButton
                  label="Move this week up"
                  disabled={wi === 0}
                  onClick={() => onChange(moveWeek(plan, week.id, -1))}
                >
                  <ArrowUp className="w-4 h-4" />
                </IconButton>
                <IconButton
                  label="Move this week down"
                  disabled={wi === weeks.length - 1}
                  onClick={() => onChange(moveWeek(plan, week.id, 1))}
                >
                  <ArrowDown className="w-4 h-4" />
                </IconButton>
                <IconButton
                  label="Remove this week"
                  tone="remove"
                  onClick={() => onChange(setWeekHidden(plan, week.id, true))}
                >
                  <Trash2 className="w-4 h-4" />
                </IconButton>
              </RowButtons>
            </div>
            <LimitedField
              label={`Week ${wi + 1} goal`}
              value={week.goal}
              max={PLAN_LIMITS.weekGoal}
              multiline
              placeholder="What this week is for"
              onChange={v => onChange(updateWeek(plan, week.id, { goal: v }))}
              className="mt-2"
            />
            <ul className="mt-3 space-y-2">
              {tasks.map((task, ti) => {
                const first = wi === 0 && ti === 0;
                const last = wi === weeks.length - 1 && ti === tasks.length - 1;
                return (
                  <li
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-2 pb-2 sm:pb-0 border-b border-stone-100 sm:border-0 last:border-0"
                  >
                    <LimitedField
                      label={`Week ${wi + 1}, task ${ti + 1}`}
                      value={task.text}
                      max={PLAN_LIMITS.taskText}
                      multiline
                      rows={2}
                      placeholder="What needs doing"
                      autoFocus={focusId === task.id}
                      onChange={v => onChange(updateTask(plan, task.id, v))}
                      className="flex-1"
                    />
                    <RowButtons>
                      <IconButton
                        label="Move this task up"
                        disabled={first}
                        onClick={() => onChange(moveTask(plan, task.id, -1))}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        label="Move this task down"
                        disabled={last}
                        onClick={() => onChange(moveTask(plan, task.id, 1))}
                      >
                        <ArrowDown className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        label="Remove this task"
                        tone="remove"
                        onClick={() =>
                          onChange(setTaskHidden(plan, task.id, true))
                        }
                      >
                        <X className="w-4 h-4" />
                      </IconButton>
                    </RowButtons>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3">
              <AddButton
                disabled={
                  week.tasks.length >= PLAN_LIMITS.tasksPerWeek ||
                  totalTasks >= PLAN_LIMITS.tasks
                }
                onClick={() => {
                  const next = addTask(plan, week.id, taken(plan, stateKeys));
                  setFocusId(next.id);
                  onChange(next.plan);
                }}
              >
                Add a task
              </AddButton>
            </div>
          </section>
        );
      })}

      <AddButton
        disabled={plan.weeks.length >= PLAN_LIMITS.weeks}
        onClick={() => {
          const next = addWeek(plan, taken(plan, stateKeys));
          setFocusId(next.id);
          onChange(next.plan);
        }}
      >
        Add a week
      </AddButton>

      <RemovedItems
        plan={plan}
        onChange={onChange}
        kinds={["week", "task"]}
        fill={fill}
      />
    </div>
  );
}

/** One decision's suggested options: chips that come off, and a box to add one. */
function OptionsField({
  options,
  onChange,
  label,
}: {
  options: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text || options.length >= PLAN_LIMITS.optionsPerDecision) return;
    onChange([...options, text]);
    setDraft("");
  };
  return (
    <div>
      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
        Suggested options
      </p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {options.map((opt, i) => (
          <span
            key={`${opt}-${i}`}
            className="inline-flex items-center gap-1.5 max-w-full text-xs pl-2.5 pr-2.5 py-1 rounded-full border border-stone-200 text-stone-700 bg-white"
          >
            <span className="break-words min-w-0">{opt}</span>
            <button
              type="button"
              aria-label={`Remove the option ${opt}`}
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-stone-500 hover:bg-red-50 hover:text-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {options.length === 0 && (
          <span className="text-xs text-stone-500 italic">None yet.</span>
        )}
      </div>
      {options.length < PLAN_LIMITS.optionsPerDecision && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            maxLength={PLAN_LIMITS.option}
            aria-label={label}
            placeholder="Add an option"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className={`${INPUT} flex-1`}
          />
          <AddButton onClick={add} disabled={!draft.trim()}>
            Add
          </AddButton>
        </div>
      )}
    </div>
  );
}

/** The decisions, in plan order: title, description, options and the task each one settles. */
export function DecisionsEditor({
  plan,
  onChange,
  stateKeys,
  fill,
}: EditorProps) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const decisions = plan.decisions.filter(d => !d.hidden);
  const tasks = visibleTasks(plan);

  return (
    <div className="space-y-3">
      {decisions.map((dec, di) => (
        <section
          key={dec.id}
          className="bg-white border border-stone-200 rounded-xl shadow-sm p-4 space-y-3"
          aria-label={`Decision ${di + 1}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-2">
            <LimitedField
              label={`Decision ${di + 1} title`}
              value={dec.title}
              max={PLAN_LIMITS.decisionTitle}
              placeholder="What needs deciding"
              autoFocus={focusId === dec.id}
              onChange={v =>
                onChange(updateDecision(plan, dec.id, { title: v }))
              }
              className="flex-1"
            />
            <RowButtons>
              <IconButton
                label="Move this decision up"
                disabled={di === 0}
                onClick={() => onChange(moveDecision(plan, dec.id, -1))}
              >
                <ArrowUp className="w-4 h-4" />
              </IconButton>
              <IconButton
                label="Move this decision down"
                disabled={di === decisions.length - 1}
                onClick={() => onChange(moveDecision(plan, dec.id, 1))}
              >
                <ArrowDown className="w-4 h-4" />
              </IconButton>
              <IconButton
                label="Remove this decision"
                tone="remove"
                onClick={() => onChange(setDecisionHidden(plan, dec.id, true))}
              >
                <Trash2 className="w-4 h-4" />
              </IconButton>
            </RowButtons>
          </div>
          <LimitedField
            label={`Decision ${di + 1} description`}
            value={dec.description}
            max={PLAN_LIMITS.decisionDescription}
            multiline
            rows={3}
            placeholder="What it covers and why it matters"
            onChange={v =>
              onChange(updateDecision(plan, dec.id, { description: v }))
            }
          />
          <OptionsField
            options={dec.options}
            label={`Add an option to decision ${di + 1}`}
            onChange={options =>
              onChange(updateDecision(plan, dec.id, { options }))
            }
          />
          <label className="block">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Timeline task it settles
            </span>
            <select
              value={dec.linkedItem ?? ""}
              onChange={e =>
                onChange(
                  updateDecision(plan, dec.id, {
                    linkedItem: e.target.value || undefined,
                  })
                )
              }
              className={`${INPUT} mt-1`}
            >
              <option value="">None</option>
              {tasks.map(t => {
                const text = fill(t.text) || "Untitled task";
                return (
                  <option key={t.id} value={t.id}>
                    {text.length > 70 ? `${text.slice(0, 70)}...` : text}
                  </option>
                );
              })}
            </select>
          </label>
        </section>
      ))}

      <AddButton
        disabled={plan.decisions.length >= PLAN_LIMITS.decisions}
        onClick={() => {
          const next = addDecision(plan, taken(plan, stateKeys));
          setFocusId(next.id);
          onChange(next.plan);
        }}
      >
        Add a decision
      </AddButton>

      <RemovedItems
        plan={plan}
        onChange={onChange}
        kinds={["decision"]}
        fill={fill}
      />
    </div>
  );
}

/**
 * The way into editing, and once in, Save and Cancel. Drawn above the views
 * and again under the editor, so a long plan never hides the way out.
 */
/**
 * A new village's Command Centre starts empty (Rye, 2026-10-22: "start
 * empty"). Say so, instead of drawing an empty board.
 */
export function EmptyPlanNote({ plan }: { plan: CommandCentrePlan }) {
  if (plan.weeks.length > 0 || plan.decisions.length > 0) return null;
  return (
    <p className="text-white text-sm max-w-2xl mb-6">
      No plan yet. Use Edit the plan to add your first week, its tasks and the decisions ahead.
    </p>
  );
}

export function PlanEditBar({
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
  bottom = false,
}: {
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  bottom?: boolean;
}) {
  if (!editing) {
    return (
      <div className="max-w-4xl mx-auto mb-4 flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit the plan
        </button>
      </div>
    );
  }
  return (
    <div
      className={`max-w-4xl mx-auto flex flex-wrap items-center gap-3 rounded-xl border border-teal-deep/30 bg-white px-4 py-3 shadow-sm ${bottom ? "mt-6" : "mb-4"}`}
    >
      <p className="flex-1 min-w-48 text-sm text-stone-700">
        <span className="font-semibold">Editing the plan.</span> Nothing changes
        for anyone else until you save.
      </p>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-deep text-white hover:bg-teal-deep-dark transition-colors disabled:opacity-60"
      >
        <Save className="w-3.5 h-3.5" />
        {saving ? "Saving..." : "Save plan"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
