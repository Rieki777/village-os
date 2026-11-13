/**
 * THE APPLICATION'S STEPS, the drawn pieces (the lead, 11 Nov 2026; Phase A,
 * lane A1). The page is pages/ProposeARole.tsx; the step map is ./stones.ts;
 * the village's words are shared/foundingApplication.ts.
 *
 *   StepMark          six circles on a gold rule: where you are, and a way
 *                     back to any step already reached (a phone and a tablet)
 *   StepTrail         the same six as a vertical trail with every name, in
 *                     its own column beside the step (a desk, D-06)
 *   AboutPanes        About you's three short panes, named under the step (M7)
 *   RewardsBeside     the rewards' shape in the rail beside every step (D-06)
 *   RoleChoice        with no role named, the open roles, one door each
 *   KnowUsStep        step 1: the ways to get to know us, each ticked by the
 *                     applicant; it never locks, and says so
 *   ValueItems        step 3: several value items, each tagged to one of the
 *                     season's goals, shown right there
 *   CompensationShape step 4: the shape of compensation as data (N% where the
 *                     village has set nothing), the plain word on risk, the footer
 *   FirstDayFacts     step 5: the first cycle and the first conversations
 *
 * THE FOUNDING REGISTER (Phase A brief): the same night world, quieter. Larger
 * display type, more space, gold rules, sacred geometry only as structure, and
 * no game words. Fireflies belong to the page's one primary act, never here.
 */
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import { BTN_SECONDARY, CARD, DOOR, EYEBROW, FIELD, HINT, LABEL, QUIET, TILE } from "@/components/journey/look";
import { LAST_STONE, stoneOfField } from "./stones";
import { DraftMark } from "@/components/proposalDrafts/AskSera";
import { BLANK_GOAL, GOAL_LIMITS } from "@shared/proposalGoals";
import type { DraftableGoal } from "@shared/seraDrafts";
import { PLACEHOLDER_PARTS, shareWords, type FoundingSetup } from "@shared/foundingApplication";

/** A gold rule, the register's one ornament. */
export const GOLD_RULE = "border-t border-notice/40";

/**
 * WHERE YOU ARE: six circles on a gold rule. The step you are on is filled,
 * a step already reached is a ring you can return to, a step ahead waits.
 * On a phone the circles carry it alone (the heading names the step); on a
 * desk each circle has its name under it.
 */
export function StepMark({ labels, now, reached, onGo }: { labels: readonly string[]; now: number; reached: number; onGo: (i: number) => void }) {
  const { t } = useLingui();
  return (
    <nav aria-label={t({ message: "The six steps of your application", context: "founding application steps" })} data-step-mark="">
      <ol className="relative grid grid-cols-6 gap-1">
        <span aria-hidden="true" className={`absolute inset-x-[8%] top-[1.375rem] ${GOLD_RULE}`} />
        {labels.map((label, i) => {
          const here = i === now;
          const open = i <= reached && !here;
          const dot = here ? "size-4 bg-notice ring-4 ring-notice/25" : i <= reached ? "size-3.5 border-2 border-notice bg-background" : "size-3 border border-border bg-background";
          const inner = (
            <>
              <span className="flex h-11 items-center justify-center">
                <span aria-hidden="true" className={`relative rounded-full ${dot}`} />
              </span>
              <span className={`hidden text-center text-xs leading-snug lg:block ${here ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </>
          );
          const name = t({ message: `Step ${i + 1}: ${label}`, context: "founding application steps" });
          return (
            <li key={label} className="min-w-0">
              {open ? (
                <button type="button" onClick={() => onGo(i)} aria-label={name} className="grid w-full justify-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" data-step-go={i}>
                  {inner}
                </button>
              ) : (
                <span aria-label={name} aria-current={here ? "step" : undefined} className="grid justify-items-center">
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** With no role named: the open roles, each one door. One application is for one role. */
export function RoleChoice({ roles, onPick }: { roles: ReadonlyArray<{ id: string; name: string; circle: string; aim: string | null }>; onPick: (id: string) => void }) {
  const { t } = useLingui();
  if (roles.length === 0) {
    return <p className={HINT}>{t({ message: "No role is open right now. Check back soon.", context: "founding application choose" })}</p>;
  }
  return (
    <ul className="grid gap-3" data-role-choice="">
      {roles.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onPick(r.id)} className={`${DOOR} w-full py-4 text-left`} data-role={r.id}>
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">{r.circle}</span>
              <span className="break-words font-display text-xl leading-tight">{t({ message: `Apply: ${r.name}`, context: "founding application choose" })}</span>
              {r.aim && <span className="break-words text-sm font-normal text-muted-foreground">{r.aim}</span>}
            </span>
            <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Step 1: each way ticked by the applicant. The note shows while any is open, and the step never locks. */
export function KnowUsStep({ ways, note, ticked, onChange }: { ways: readonly string[]; note: string; ticked: readonly string[]; onChange: (next: string[]) => void }) {
  const { t } = useLingui();
  const open = ways.some((w) => !ticked.includes(w));
  return (
    <div className="grid gap-5">
      {ways.length > 0 ? (
        <fieldset className="grid gap-2" data-know-us="">
          <legend className={`mb-2 ${LABEL}`}>{t({ message: "Tick the ones you have done", context: "founding application know us" })}</legend>
          {ways.map((w, i) => (
            <label key={w} htmlFor={`know-us-${i}`} className={`flex min-h-11 cursor-pointer items-center gap-3 ${QUIET}`}>
              <input
                id={`know-us-${i}`}
                type="checkbox"
                className="size-5 shrink-0 accent-notice"
                checked={ticked.includes(w)}
                onChange={() => onChange(ticked.includes(w) ? ticked.filter((x) => x !== w) : [...ticked, w])}
              />
              <span className="min-w-0 break-words text-foreground">{w}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className={HINT}>{t({ message: "We will share how to meet us once you apply.", context: "founding application know us" })}</p>
      )}
      {open && note && (
        <p className="border-l-2 border-notice/60 pl-4 text-sm leading-relaxed text-foreground" data-know-note="">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Step 3: several value items, each a deliverable tagged to one of the
 * season's goals, with the goals shown right there. Add, edit, remove. The
 * items travel as the card's goals (shared/proposalGoals.ts judges them).
 */
export function ValueItems({
  roleId,
  items,
  onChange,
  goals,
  assist,
  missingTag,
}: {
  roleId: string;
  items: DraftableGoal[];
  onChange: (next: DraftableGoal[]) => void;
  goals: ReadonlyArray<{ id: string; text: string }>;
  assist?: ReactNode;
  /** The items still without a season goal, by position (1-based), to mark their choice. */
  missingTag?: readonly number[];
}) {
  const { t } = useLingui();
  const rows = items.length ? items : [{ ...BLANK_GOAL }];
  const set = (i: number, next: Partial<DraftableGoal>) => onChange(rows.map((g, k) => (k === i ? { ...g, ...next } : g)));
  const prefix = `value-${roleId}`;
  return (
    <div className="grid gap-6" data-role-card={roleId}>
      {goals.length > 0 ? (
        <div className={`${QUIET} grid gap-2`} data-season-goals="">
          <p className={EYEBROW}>{t({ message: "This season's goals", context: "founding application value" })}</p>
          <ul className="grid gap-1 text-sm text-foreground">
            {goals.map((g) => (
              <li key={g.id} className="break-words">
                {g.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={`${QUIET} text-sm text-foreground`} data-no-season-goals="">
          {t({ message: "The village has not set its goals for this season yet. You can still apply: say in each item what it brings.", context: "founding application value" })}
        </p>
      )}
      {assist}
      <ol className="grid gap-4" data-goals-list="">
        {rows.map((g, i) => {
          const n = i + 1;
          const untagged = missingTag?.includes(n) ?? false;
          return (
            <li key={i} className={`${TILE} grid gap-3`} data-value-item={n}>
              <div className="flex items-center justify-between gap-3">
                <p className={EYEBROW}>{t({ message: `Value ${n}`, context: "founding application value" })}</p>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, k) => k !== i))}
                    className="inline-flex min-h-11 items-center gap-1 px-2 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X className="size-4" aria-hidden="true" />
                    {t({ message: `Remove value ${n}`, context: "founding application value" })}
                  </button>
                )}
              </div>
              {g.seraDraft && <DraftMark founding onKeep={() => set(i, { seraDraft: false })} />}
              <div>
                <label htmlFor={`${prefix}-${i}-title`} className={`mb-2 block ${LABEL}`}>
                  {t({ message: "What you will bring", context: "founding application value" })}
                </label>
                <input id={`${prefix}-${i}-title`} maxLength={GOAL_LIMITS.title} value={g.title} onChange={(e) => set(i, { title: e.target.value, seraDraft: false })} className={`${FIELD} py-3`} />
              </div>
              <div>
                <label htmlFor={`${prefix}-${i}-done`} className={`mb-2 block ${LABEL}`}>
                  {t({ message: "How we will know it is done", context: "founding application value" })}
                </label>
                <input id={`${prefix}-${i}-done`} maxLength={GOAL_LIMITS.doneWhen} value={g.doneWhen} onChange={(e) => set(i, { doneWhen: e.target.value, seraDraft: false })} className={`${FIELD} py-3`} />
              </div>
              {goals.length > 0 && (
                <div>
                  <label htmlFor={`${prefix}-${i}-serves`} className={`mb-2 block ${LABEL}`}>
                    {t({ message: "The season goal it serves", context: "founding application value" })}
                  </label>
                  <select
                    id={`${prefix}-${i}-serves`}
                    value={g.serves}
                    onChange={(e) => set(i, { serves: e.target.value })}
                    className={`${FIELD} min-h-11 py-3`}
                    aria-invalid={untagged || undefined}
                    data-value-serves=""
                  >
                    <option value="">{t({ message: "Choose a goal", context: "founding application value" })}</option>
                    {goals.map((sg) => (
                      <option key={sg.id} value={sg.id}>
                        {sg.text}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length < GOAL_LIMITS.max && (
        <div>
          <button type="button" onClick={() => onChange([...rows, { ...BLANK_GOAL }])} className={BTN_SECONDARY} data-add-value="">
            <Plus className="size-4" aria-hidden="true" />
            {t({ message: "Add another value item", context: "founding application value" })}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Step 4's compensation shape, drawn as the role cards draw it (lane A3): the
 * village's split as shares of the whole, "N%" where it has written none, the
 * line that the mix is settled in onboarding, the plain word on risk (T68) and
 * the footer (build list 7.5). Never a range, a minimum or a budget figure.
 */
/** The village's split as shares of the whole, or the placeholder parts with N% where it has written none. */
function useShares(setup: FoundingSetup): Array<{ label: string; pct: number | null }> {
  const { t } = useLingui();
  const placeholder: Record<(typeof PLACEHOLDER_PARTS)[number], string> = {
    Cash: t({ message: "Cash", context: "founding application compensation" }),
    Equity: t({ message: "Equity", context: "founding application compensation" }),
    Credits: t({ message: "Credits", context: "founding application compensation" }),
  };
  return setup.shares.length ? setup.shares : PLACEHOLDER_PARTS.map((p) => ({ label: placeholder[p], pct: null }));
}

export function CompensationShape({ setup }: { setup: FoundingSetup }) {
  const { t } = useLingui();
  const shares = useShares(setup);
  return (
    <section aria-labelledby="comp-shape-h" className="grid gap-5" data-comp-shape="">
      <div className={`${GOLD_RULE} pt-5`}>
        <h3 id="comp-shape-h" className="font-display text-2xl text-card-foreground">
          {t({ message: "How compensation is shaped", context: "founding application compensation" })}
        </h3>
        <p className={`mt-1 ${HINT}`}>{t({ message: "The shape of the whole, before any amount. Amounts come later, in conversation.", context: "founding application compensation" })}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {shares.map((s) => (
          <div key={s.label} className={`${TILE} grid min-w-0 content-start gap-1`} data-share={s.label}>
            <dt className={`${EYEBROW} break-words`}>{s.label}</dt>
            <dd className="font-display text-3xl leading-none text-foreground sm:text-4xl" data-share-pct="">
              {shareWords(s.pct)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-foreground" data-comp-onboarding="">
        {t({ message: "To be decided in the onboarding process.", context: "founding application compensation" })}
      </p>
      <div className="grid gap-2">
        {setup.atRisk && (
          <p className="text-sm leading-relaxed text-foreground" data-at-risk="">
            {setup.atRisk}
          </p>
        )}
        {setup.footer && (
          <p className="text-xs text-muted-foreground" data-comp-footer="">
            {setup.footer}
          </p>
        )}
      </div>
    </section>
  );
}

/** Step 5's facts: what the first cycle looks like, and the first conversations once chosen. */
export function FirstDayFacts({ setup, firstConversation = null }: { setup: FoundingSetup; firstConversation?: string | null }) {
  const { t } = useLingui();
  return (
    <div className="grid gap-5">
      {/* The first conversation of the role's own list (conversations[0]). Its booking link comes with the
          invitation and on the status page, so nobody books before we invite them (role journey L6). */}
      {firstConversation && (
        <div className="grid gap-2" data-first-booking="">
          <p className={EYEBROW}>{t({ message: "Your first conversation", context: "founding application first day" })}</p>
          <p className="text-base leading-relaxed text-foreground">
            {t({ message: `With ${firstConversation}. Once we invite you, you book it at a time you choose, through the booking link in your invitation, or we'll write to you with times.`, context: "founding application first day" })}
          </p>
        </div>
      )}
      {setup.firstCycle && (
        <div className="grid gap-2" data-first-cycle="">
          <p className={EYEBROW}>{t({ message: "Your first cycle", context: "founding application first day" })}</p>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">{setup.firstCycle}</p>
        </div>
      )}
      {setup.firstConversations.length > 0 && (
        <div className="grid gap-2" data-first-conversations="">
          <p className={EYEBROW}>{t({ message: "Your first conversations", context: "founding application first day" })}</p>
          <ul className="grid gap-2">
            {setup.firstConversations.map((c) => (
              <li key={c} className={`${QUIET} text-sm text-foreground`}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The quiet way back to the roles, under the title when more than one is open. */
export function OtherRole({ onChoose }: { onChoose: () => void }) {
  const { t } = useLingui();
  return (
    <button type="button" onClick={onChoose} className="min-h-11 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" data-other-role="">
      {t({ message: "Apply for a different role", context: "founding application" })}
    </button>
  );
}


/**
 * A DESK'S PATH (D-06): the six steps as a vertical trail in their own column,
 * every name showing. A passed step is a gold ring with a check and a way back;
 * the step you stand on is filled gold; a step ahead waits as a plain ring.
 */
export function StepTrail({ labels, now, reached, onGo }: { labels: readonly string[]; now: number; reached: number; onGo: (i: number) => void }) {
  const { t } = useLingui();
  return (
    <nav aria-label={t({ message: "The six steps of your application", context: "founding application steps" })} data-step-trail="">
      <ol className="grid">
        {labels.map((label, i) => {
          const here = i === now;
          const passed = i <= reached && !here;
          const stone = here
            ? "border-notice bg-notice text-background"
            : passed
              ? "border-notice text-notice"
              : "border-border text-muted-foreground";
          const inner = (
            <>
              <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold ${stone}`}>
                {passed ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={`min-w-0 text-left text-sm leading-snug ${here ? "font-semibold text-foreground" : passed ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </>
          );
          const name = t({ message: `Step ${i + 1}: ${label}`, context: "founding application steps" });
          return (
            <li key={label} className="relative" data-trail-state={here ? "here" : passed ? "passed" : "ahead"}>
              {i < labels.length - 1 && <span aria-hidden="true" className={`absolute left-[11px] top-9 h-4 border-l ${i < reached ? "border-notice/60" : "border-border"}`} />}
              {passed ? (
                <button type="button" onClick={() => onGo(i)} aria-label={name} className="flex min-h-11 w-full items-center gap-3 rounded-lg hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" data-step-go={i}>
                  {inner}
                </button>
              ) : (
                <span aria-label={name} aria-current={here ? "step" : undefined} className="flex min-h-11 items-center gap-3">
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** About you's panes, in order (M7). */
export const ABOUT_PANES = 3;

/** The About you pane that holds a field: who you are, your story, then who can speak for you. */
export function aboutPaneOf(field: string | null): number {
  switch (field) {
    case "name":
    case "email":
    case "why":
      return 0;
    case "checkConsent":
    case "references":
      return 2;
    default:
      return 1;
  }
}

/** The three panes named under About you's heading, the one you are on marked. */
export function AboutPanes({ names, now }: { names: readonly string[]; now: number }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-about-panes="">
      {names.map((n, i) => (
        <li key={n} aria-current={i === now ? "step" : undefined} className={i === now ? "font-semibold text-foreground" : "text-muted-foreground"}>
          <span className={i === now ? "text-notice" : ""}>{i + 1}</span> {n}
        </li>
      ))}
    </ol>
  );
}

/** The rewards' shape beside every step on a desk (D-06): the split, the line that it is settled in onboarding, the word on risk. */
export function RewardsBeside({ setup }: { setup: FoundingSetup }) {
  const { t } = useLingui();
  const shares = useShares(setup);
  return (
    <section aria-labelledby="rewards-beside-h" className="grid gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm" data-rewards-beside="">
      <p id="rewards-beside-h" className={EYEBROW}>
        {t({ message: "How rewards work", context: "founding application compensation" })}
      </p>
      <dl className="grid grid-cols-3 gap-2">
        {shares.map((s) => (
          <div key={s.label} className="grid min-w-0 gap-1 rounded-xl border border-border bg-muted px-3 py-2">
            <dt className="break-words text-xs text-muted-foreground">{s.label}</dt>
            <dd className="font-display text-xl leading-none text-foreground">{shareWords(s.pct)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t({ message: "To be decided in the onboarding process.", context: "founding application compensation" })}</p>
      {setup.atRisk && <p className="text-xs leading-relaxed text-muted-foreground">{setup.atRisk}</p>}
    </section>
  );
}

/** Every problem found on the last Continue or Send, each a way to its own place (audit M1). */
export function ProblemsList<P extends { field: string | null; message: string }>({ problems, labels, stone, onShow }: { problems: readonly P[]; labels: readonly string[]; stone: number; onShow: (p: P) => void }) {
  const { t } = useLingui();
  if (problems.length === 0) return null;
  return (
    <div id="propose-problems" tabIndex={-1} role="alert" className="mb-8 rounded-lg border border-border bg-muted p-4 text-sm text-foreground outline-none" data-problems="">
      <p className="font-semibold">
        {stone === LAST_STONE
          ? problems.length === 1
            ? t`One thing to fix before we can send this:`
            : t`${problems.length} things to fix before we can send this:`
          : problems.length === 1
            ? t({ message: "One thing to look at before you continue:", context: "founding application check" })
            : t({ message: `${problems.length} things to look at before you continue:`, context: "founding application check" })}
      </p>
      <ul className="mt-2 grid gap-1">
        {problems.map((p, i) => {
          const where = labels[stoneOfField(p.field)];
          return (
            <li key={`${p.field}-${i}`}>
              <button type="button" onClick={() => onShow(p)} className="min-h-11 text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
                {stoneOfField(p.field) !== stone ? `${where}: ${p.message}` : p.message}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The role beside the step on a desk: its circle, name, aim, the commitment it asks, and a check that always happens. */
export function RoleBeside({ role, pct }: { role: { circle: string; name: string; aim: string | null; alwaysChecked?: boolean }; pct: number | null | undefined }) {
  const { t } = useLingui();
  return (
    <div className={`${CARD} grid gap-3`} data-role-beside="">
      <p className={EYEBROW}>{role.circle}</p>
      <p className="font-display text-2xl leading-tight text-card-foreground">{role.name}</p>
      {role.aim && <p className="text-sm leading-relaxed text-muted-foreground">{role.aim}</p>}
      {typeof pct === "number" && <p className={`${GOLD_RULE} pt-3 text-sm text-foreground`}>{t({ message: `The role asks ${pct}% of your commitment`, context: "founding application beside" })}</p>}
      {role.alwaysChecked && <p className="text-sm text-foreground">{t({ message: "A background check happens for this role whatever the references say.", context: "open proposal role" })}</p>}
    </div>
  );
}

/** A desk's keyboard, named once beside Continue (D-06). */
export function EnterHint() {
  const { t } = useLingui();
  return (
    <span className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground lg:flex" data-enter-hint="">
      <kbd className="rounded-lg border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{t({ message: "Enter", context: "the keyboard key" })}</kbd>
      {t({ message: "to continue", context: "founding application keys" })}
    </span>
  );
}

/** Review & submit: each step in a line, with a way back to it. */
export function ReviewLines({ review, labels, onChange }: { review: ReadonlyArray<[number, string]>; labels: readonly string[]; onChange: (i: number) => void }) {
  const { t } = useLingui();
  return (
    <ul className="grid gap-2" data-review="">
      {review.map(([i, line]) => (
        <li key={i} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3">
          <span className="grid min-w-0">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">{labels[i]}</span>
            <span className="break-words text-sm text-foreground">{line}</span>
          </span>
          <button type="button" onClick={() => onChange(i)} className="min-h-11 shrink-0 px-2 text-sm font-medium text-notice underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {t({ message: "Change", context: "open proposal review" })}
          </button>
        </li>
      ))}
    </ul>
  );
}
