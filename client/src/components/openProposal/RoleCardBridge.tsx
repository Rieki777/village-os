/**
 * THE APPLICANT'S OWN ROLE CARD, built beside the open one (Rye, 9 Nov 2026:
 * "walk them through the difference between my role proposal card and the
 * open role card"). Pure pieces for the open-proposal form
 * (pages/ProposeARole.tsx); the shape and limits are
 * shared/openProposalCard.ts.
 *
 *   RoleAsks      under a ticked role: what the role asks (its aim, time and
 *                 outcomes), each outcome a box to tick as "I'll move this",
 *                 with a target; then up to three quests for the first moon,
 *                 each with a "Done when" test.
 *   SeasonServes  once: which of the season's goals the work serves, and how;
 *                 the time they can give; and the two agreements.
 *
 * The admin palette's tokens only (theme audit, 9 Nov).
 */
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { CARD_LIMITS, CARD_WINDOWS, type FirstMoonGoal } from "@shared/openProposalCard";
import { BLANK_GOAL, type ProposalGoal } from "@shared/proposalGoals";
import GoalsList from "@/components/governance/GoalsList";

export interface RoleCardState {
  /** The role's goal (one of its accountabilities) -> target. */
  moves: Record<string, string>;
  /** The goals for the first moon, as the list writes them. Stored as `firstMoon` (see goalsToFirstMoon). */
  goals: ProposalGoal[];
  /** Season goal id -> how the work in THIS role serves it (guide v2: the pick lives on each role card). */
  serves?: Record<string, string>;
}

export const EMPTY_ROLE_CARD: RoleCardState = { moves: {}, goals: [{ ...BLANK_GOAL }], serves: {} };

/** The list's goals as a card stores them: `quest` is the title, blank rows left out. */
export function goalsToFirstMoon(goals: readonly ProposalGoal[]): FirstMoonGoal[] {
  return goals
    .filter((g) => g.title.trim() || g.doneWhen.trim() || g.moves || g.serves || g.date)
    .map((g) => ({ quest: g.title, doneWhen: g.doneWhen, ...(g.moves ? { moves: g.moves } : {}), ...(g.serves ? { serves: g.serves } : {}), ...(g.date ? { date: g.date } : {}) }));
}

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RoleAsks({
  roleId,
  roleName,
  aim,
  timeCommitment,
  accountabilities,
  goals,
  value,
  onChange,
}: {
  roleId: string;
  roleName: string;
  aim: string | null;
  timeCommitment: string | null;
  accountabilities: readonly string[];
  /** The season's goals, to pick which this role's work serves (guide v2). Absent: the card asks nothing about them. */
  goals?: ReadonlyArray<{ id: string; text: string }>;
  value: RoleCardState;
  onChange: (next: RoleCardState) => void;
}) {
  const { t } = useLingui();
  const serves = value.serves ?? {};
  const servesFull = Object.keys(serves).length >= CARD_LIMITS.serves;
  const picked = Object.keys(value.moves);
  const full = picked.length >= CARD_LIMITS.movesPerRole;

  return (
    <div className="mt-3 grid gap-3 rounded-xl border border-border bg-muted/40 p-3" data-role-card={roleId}>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "What this role asks", context: "open proposal card" })}</p>
        {aim && <p className="mt-1 text-sm text-foreground">{aim}</p>}
        {timeCommitment && <p className="mt-1 text-xs text-muted-foreground">{t({ message: `Time: roughly ${timeCommitment}`, context: "open proposal card" })}</p>}
      </div>
      {accountabilities.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-card-foreground">
            {t`Which of ${roleName}'s goals will you move? Pick up to ${CARD_LIMITS.movesPerRole}, each with a target.`}
          </legend>
          {accountabilities.map((a, i) => {
            const on = a in value.moves;
            const id = `card-${roleId}-move-${i}`;
            return (
              <div key={a} className="grid gap-1">
                <label htmlFor={id} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-notice"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => {
                      const moves = { ...value.moves };
                      if (on) delete moves[a];
                      else moves[a] = "";
                      onChange({ ...value, moves });
                    }}
                  />
                  <span className="min-w-0 break-words">{a}</span>
                </label>
                {on && (
                  <input
                    aria-label={t({ message: `Your target for: ${a}`, context: "open proposal card field" })}
                    placeholder={t({ message: "Your target, e.g. 13 of 13 Mondays", context: "open proposal card" })}
                    maxLength={CARD_LIMITS.target}
                    value={value.moves[a]}
                    onChange={(e) => onChange({ ...value, moves: { ...value.moves, [a]: e.target.value } })}
                    className={`${FIELD} ml-6 w-auto`}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-card-foreground">{t`Your goals for your first moon in ${roleName}`}</legend>
        <GoalsList
          idPrefix={`card-${roleId}-goals`}
          goals={value.goals}
          onChange={(next) => onChange({ ...value, goals: next })}
          roles={[{ id: roleId, name: roleName, goals: accountabilities }]}
          seasonGoals={(goals ?? []).map((g) => ({ value: g.id, label: g.text }))}
        />
      </fieldset>
      {/* Guide v2: which season goal THIS role's work serves, on the card, after its goals. */}
      {goals && goals.length > 0 && (
        <fieldset className="grid gap-2" data-card-serves={roleId}>
          <legend className="text-sm font-semibold text-card-foreground">
            {t`Which of the village's goals for the season does your work in ${roleName} serve? Pick up to ${CARD_LIMITS.serves}, and say how.`}
          </legend>
          {goals.map((g, i) => {
            const on = g.id in serves;
            const id = `card-${roleId}-goal-${i}`;
            const goalText = g.text;
            return (
              <div key={g.id} className="grid gap-1">
                <label htmlFor={id} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-notice"
                    checked={on}
                    disabled={!on && servesFull}
                    onChange={() => {
                      const next = { ...serves };
                      if (on) delete next[g.id];
                      else next[g.id] = "";
                      onChange({ ...value, serves: next });
                    }}
                  />
                  <span className="min-w-0 break-words">{goalText}</span>
                </label>
                {on && (
                  <input
                    aria-label={t`How your work in ${roleName} serves: ${goalText}`}
                    placeholder={t({ message: "How your work serves it", context: "open proposal card" })}
                    maxLength={CARD_LIMITS.how}
                    value={serves[g.id]}
                    onChange={(e) => onChange({ ...value, serves: { ...serves, [g.id]: e.target.value } })}
                    className={`${FIELD} ml-6 w-auto`}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}

export function SeasonServes({
  goals,
  serves,
  onServes,
  hours,
  onHours,
  agreed,
  onAgreed,
  membership,
  showGoals = true,
  showHours = true,
}: {
  /** Off when each role card asks its own goal (guide v2); the no-goals line still shows. */
  showGoals?: boolean;
  /** Off when the practicalities ask the time first (guide v2). */
  showHours?: boolean;
  goals: ReadonlyArray<{ id: string; text: string }>;
  serves: Record<string, string>;
  onServes: (next: Record<string, string>) => void;
  hours: string;
  onHours: (v: string) => void;
  agreed: { nda: boolean };
  onAgreed: (next: { nda: boolean }) => void;
  /**
   * The membership alignment itself, made here when they apply
   * (MembershipAtApplication.tsx, Rye's answer 8). There is no Love Letter
   * tick: this is the agreement.
   */
  membership: ReactNode;
}) {
  const { t } = useLingui();
  const full = Object.keys(serves).length >= CARD_LIMITS.serves;
  return (
    <div className="grid gap-5">
      {/* Brief v3: a season with no goals yet says so, and never blocks applying. */}
      {goals.length === 0 && (
        <p className="rounded-lg bg-muted p-3 text-sm text-foreground" data-no-season-goals="">
          {t`The village has not set its goals for this season yet. You can still propose: say in your aim what you would bring.`}
        </p>
      )}
      {showGoals && goals.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold text-card-foreground">
            {t`Which of the village's goals for the season will your work serve? Pick up to ${CARD_LIMITS.serves}, and say how.`}
          </legend>
          {goals.map((g, i) => {
            const on = g.id in serves;
            const id = `card-goal-${i}`;
            const goalText = g.text;
            return (
              <div key={g.id} className="grid gap-1">
                <label htmlFor={id} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-notice"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => {
                      const next = { ...serves };
                      if (on) delete next[g.id];
                      else next[g.id] = "";
                      onServes(next);
                    }}
                  />
                  <span className="min-w-0 break-words">{goalText}</span>
                </label>
                {on && (
                  <input
                    aria-label={t`How your work serves: ${goalText}`}
                    placeholder={t({ message: "How your work serves it", context: "open proposal card" })}
                    maxLength={CARD_LIMITS.how}
                    value={serves[g.id]}
                    onChange={(e) => onServes({ ...serves, [g.id]: e.target.value })}
                    className={`${FIELD} ml-6 w-auto`}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      {showHours && <HoursField hours={hours} onHours={onHours} />}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-card-foreground">{t({ message: "Agreements", context: "open proposal card" })}</legend>
        {membership}
        <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
          <input type="checkbox" required className="mt-1 size-4 shrink-0 accent-notice" checked={agreed.nda} onChange={(e) => onAgreed({ ...agreed, nda: e.target.checked })} />
          {t`Once approved into a role, I will align with the village's confidentiality agreement before I see any confidential records or my role starts.`}
        </label>
      </fieldset>
    </div>
  );
}

/**
 * THE TWO CARDS SIDE BY SIDE, for whoever decides (pages/OpenProposal.tsx).
 * One row per role: what the role asks on the left, what the applicant offers
 * on the right, and the gaps named, so a decider sees the delta at a glance:
 * an outcome nobody picked, a role with no first-moon quest, no season goal
 * served, an agreement not given. A proposal sent before cards existed says so.
 */
export function CardSideBySide({
  roles,
  card,
  membershipAligned = false,
}: {
  /** The applicant aligned with the membership letter, on the form or from their account (Rye's answer 8). */
  membershipAligned?: boolean;
  roles: ReadonlyArray<{ id: string; name: string | null; accountabilities?: string[]; timeCommitment?: string | null }>;
  card: {
    roles: Array<{ roleId: string; moves: Array<{ text: string; target: string }>; firstMoon: FirstMoonGoal[] }>;
    serves: Array<{ goalId: string; how: string; goal?: string; roleId?: string }>;
    hours: string;
    agreed: { loveLetter?: boolean; nda: boolean };
    timeZone?: string;
    windows?: string[];
    earliestStart?: string;
    terms?: { choice: "accept" | "talk"; note: string };
  } | null;
}) {
  const { t } = useLingui();
  if (!card) {
    return <p className="text-sm text-muted-foreground">{t`This proposal was sent before applicants wrote their own role card, so there is nothing to set beside the open card.`}</p>;
  }
  const gaps: string[] = [];
  for (const r of roles) {
    const mine = card.roles.find((x) => x.roleId === r.id);
    const asks = r.accountabilities ?? [];
    const roleName = r.name ?? r.id;
    if (asks.length && !(mine?.moves ?? []).some((m) => asks.includes(m.text))) gaps.push(t`No goal of ${roleName} picked`);
    if (!(mine?.firstMoon ?? []).length) gaps.push(t({ message: `No goal for ${roleName}`, context: "open proposal side by side" }));
  }
  if (card.terms?.choice === "talk") gaps.push(t`They want to talk about the terms`);
  if (!card.serves.length) gaps.push(t`No season goal served`);
  if (!membershipAligned) gaps.push(t`Not aligned with the membership letter`);
  if (!card.agreed.nda) gaps.push(t`The confidentiality agreement is not promised`);
  const tz = card.timeZone ?? "";
  const start = card.earliestStart ?? "";
  const windowList = (card.windows ?? []).join(", ");
  const termsNote = card.terms?.note ?? "";
  return (
    <div className="grid gap-4">
      {roles.map((r) => {
        const mine = card.roles.find((x) => x.roleId === r.id) ?? { moves: [], firstMoon: [] };
        const asks = r.accountabilities ?? [];
        const roleName = r.name ?? r.id;
        const time = r.timeCommitment ?? "";
        return (
          <div key={r.id} className="overflow-hidden rounded-xl border border-border" data-side-by-side={r.id}>
            <p className="border-b border-border bg-muted px-3 py-2 text-sm font-bold text-notice">{roleName}</p>
            <div className="grid sm:grid-cols-2">
              <div className="min-w-0 border-b border-border p-3 sm:border-b-0 sm:border-r">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "The role asks", context: "open proposal side by side" })}</p>
                {time && <p className="mt-1 text-xs text-muted-foreground">{t({ message: `Time: roughly ${time}`, context: "open proposal side by side" })}</p>}
                <ul className="mt-2 grid gap-1 text-sm">
                  {asks.length === 0 && <li className="text-muted-foreground">{t`This role lists no goals yet.`}</li>}
                  {asks.map((a) => {
                    const m = mine.moves.find((x) => x.text === a);
                    return (
                      <li key={a} className={m ? "text-foreground" : "text-muted-foreground"}>
                        {m ? "✓ " : "· "}
                        {a}
                        {!m && <span className="ml-1 text-xs font-semibold">{t({ message: "(not picked)", context: "open proposal side by side" })}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="min-w-0 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "They offer", context: "open proposal side by side" })}</p>
                <ul className="mt-2 grid gap-1 text-sm text-foreground">
                  {mine.moves.map((m) => {
                    const text = m.text;
                    return (
                      <li key={text}>
                        {t({ message: `I'll move: ${text}`, context: "open proposal side by side" })}
                        {m.target && <span className="text-muted-foreground"> ({m.target})</span>}
                      </li>
                    );
                  })}
                  {mine.firstMoon.map((q, i) => {
                    const quest = q.quest;
                    const doneWhen = q.doneWhen;
                    const moves = q.moves ?? "";
                    const day = q.date ?? "";
                    return (
                      <li key={i} data-goal={i + 1}>
                        {t({ message: `Goal: ${quest}`, context: "open proposal side by side" })}
                        {doneWhen && <span className="text-muted-foreground"> {t({ message: `(done when ${doneWhen})`, context: "open proposal side by side" })}</span>}
                        {moves && <span className="block text-xs text-muted-foreground">{t({ message: `Moves: ${moves}`, context: "open proposal side by side" })}</span>}
                        {day && <span className="block text-xs text-muted-foreground">{t({ message: `By ${day}`, context: "open proposal side by side" })}</span>}
                      </li>
                    );
                  })}
                  {/* Guide v2: the season goals this role's work serves, picked on its card. */}
                  {card.serves
                    .filter((s) => s.roleId === r.id)
                    .map((s) => {
                      const goalWords = s.goal || s.goalId;
                      return (
                        <li key={`serves-${s.goalId}`} data-serves-goal="">
                          {t({ message: `Serves the season goal: ${goalWords}`, context: "open proposal side by side" })}
                          {s.how && <span className="text-muted-foreground">: {s.how}</span>}
                        </li>
                      );
                    })}
                  {!mine.moves.length && !mine.firstMoon.length && !card.serves.some((s) => s.roleId === r.id) && <li className="text-muted-foreground">{t`Nothing offered for this role beyond their note.`}</li>}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-border p-3 text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "The season's goals they serve", context: "open proposal side by side" })}</p>
        {card.serves.length && card.serves.every((s) => s.roleId) ? (
          <p className="mt-1 text-muted-foreground">{t({ message: "Named on each role above.", context: "open proposal side by side goals" })}</p>
        ) : card.serves.length ? (
          <ul className="mt-2 grid gap-1 text-foreground">
            {card.serves.filter((s) => !s.roleId).map((s) => (
              <li key={s.goalId}>
                {s.goal || s.goalId}
                {s.how && <span className="text-muted-foreground">: {s.how}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">{t({ message: "None picked.", context: "open proposal side by side goals" })}</p>
        )}
        {card.hours && <p className="mt-2 text-foreground">{t`Time they can give: ${card.hours}`}</p>}
        {card.timeZone && <p className="mt-1 text-foreground">{t({ message: `Time zone: ${tz}`, context: "open proposal side by side" })}</p>}
        {card.earliestStart && <p className="mt-1 text-foreground">{t({ message: `Earliest start: ${start}`, context: "open proposal side by side" })}</p>}
        {card.windows && card.windows.length > 0 && <p className="mt-1 text-foreground">{t({ message: `Usual times: ${windowList}`, context: "open proposal side by side" })}</p>}
        {card.terms?.choice === "talk" ? (
          <p className="mt-2 rounded-lg bg-muted p-2 font-semibold text-foreground" data-terms-flag="">
            {t`Wants to talk about the terms: ${termsNote}`}
          </p>
        ) : card.terms?.choice === "accept" ? (
          <p className="mt-1 text-foreground">{t`Accepts the terms on offer.`}</p>
        ) : null}
        <p className="mt-2 text-foreground">
          {membershipAligned ? t`They aligned with the membership letter when they proposed.` : t`They have not aligned with the membership letter yet.`}{" "}
          {card.agreed.nda ? t`They will align with the confidentiality agreement once approved.` : t`They have not promised the confidentiality agreement.`}
        </p>
      </div>
      {gaps.length > 0 && (
        <p role="note" className="rounded-xl bg-muted p-3 text-sm text-foreground" data-card-gaps="">
          {t({ message: "Gaps to talk through:", context: "open proposal side by side" })} {gaps.join("; ")}.
        </p>
      )}
    </div>
  );
}

/** The browser's own zone, or "" where the runtime cannot say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Every zone the runtime knows, for the picker; empty on an older engine (the field then takes typing). */
function knownZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return f ? f("timeZone") : [];
  } catch {
    return [];
  }
}

export interface Practical {
  timeZone: string;
  windows: string[];
  earliestStart: string;
  terms: { choice: "" | "accept" | "talk"; note: string };
}

/**
 * FORM V2's PRACTICALITIES (role journey brief v2, 5.4): the time zone (from
 * the browser, editable), the usual times they can meet, the earliest start,
 * and the terms on offer: accepted, or a wish to talk about them, which every
 * reviewer sees flagged. Conversations are booked across time zones, so the zone
 * leads.
 */
export function Practicalities({ value, onChange }: { value: Practical; onChange: (next: Practical) => void }) {
  const { t } = useLingui();
  const zones = knownZones();
  const windowWords: Record<(typeof CARD_WINDOWS)[number], string> = {
    "weekday-mornings": t({ message: "Weekday mornings", context: "open proposal card window" }),
    "weekday-afternoons": t({ message: "Weekday afternoons", context: "open proposal card window" }),
    "weekday-evenings": t({ message: "Weekday evenings", context: "open proposal card window" }),
    "weekend-mornings": t({ message: "Weekend mornings", context: "open proposal card window" }),
    "weekend-afternoons": t({ message: "Weekend afternoons", context: "open proposal card window" }),
    "weekend-evenings": t({ message: "Weekend evenings", context: "open proposal card window" }),
  };
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="card-tz" className="mb-2 block text-sm font-semibold text-card-foreground">
            {t({ message: "Your time zone", context: "open proposal card" })}
          </label>
          <input id="card-tz" list="card-tz-list" maxLength={CARD_LIMITS.timeZone} value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })} className={FIELD} />
          {zones.length > 0 && (
            <datalist id="card-tz-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
        </div>
        <div>
          <label htmlFor="card-start" className="mb-2 block text-sm font-semibold text-card-foreground">
            {t`The earliest you could start (optional)`}
          </label>
          <input id="card-start" type="date" value={value.earliestStart} onChange={(e) => onChange({ ...value, earliestStart: e.target.value })} className={FIELD} />
        </div>
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-semibold text-card-foreground">{t`When you can usually meet (optional)`}</legend>
        <div className="grid gap-1 sm:grid-cols-3">
          {CARD_WINDOWS.map((w) => (
            <label key={w} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-4 accent-notice"
                checked={value.windows.includes(w)}
                onChange={() => onChange({ ...value, windows: value.windows.includes(w) ? value.windows.filter((x) => x !== w) : [...value.windows, w] })}
              />
              {windowWords[w]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-card-foreground">{t`The terms on offer`}</legend>
        <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
          <input type="radio" name="card-terms" required className="mt-1 size-4 accent-notice" checked={value.terms.choice === "accept"} onChange={() => onChange({ ...value, terms: { ...value.terms, choice: "accept" } })} />
          {t`I accept the terms on offer.`}
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
          <input type="radio" name="card-terms" required className="mt-1 size-4 accent-notice" checked={value.terms.choice === "talk"} onChange={() => onChange({ ...value, terms: { ...value.terms, choice: "talk" } })} />
          {t`I'd like to talk about the terms.`}
        </label>
        {value.terms.choice === "talk" && (
          <textarea
            aria-label={t`What you would like to talk about in the terms`}
            required
            rows={3}
            maxLength={CARD_LIMITS.termsNote}
            value={value.terms.note}
            onChange={(e) => onChange({ ...value, terms: { ...value.terms, note: e.target.value } })}
            className={FIELD}
          />
        )}
      </fieldset>
    </div>
  );
}

/**
 * WHAT HAPPENS NEXT, for the roles picked (brief v2, 13.6; Rye's answer 7):
 * the conversations in order, with their length and which is the final approval,
 * when a role carries them (the role-conversations lane fills `conversations`), and
 * the booking link when the role has one (`bookingUrl`, PR-A).
 */
export function NextForRoles({
  roles,
}: {
  roles: ReadonlyArray<{ id: string; name: string; conversations?: Array<{ role: string; minutes: number; finalApproval?: boolean }>; bookingUrl?: string | null }>;
}) {
  const { t } = useLingui();
  const withSteps = roles.filter((r) => (r.conversations?.length ?? 0) > 0 || r.bookingUrl);
  if (!withSteps.length) return null;
  return (
    <div className="mt-4 grid gap-3 text-left" data-next-for-roles="">
      {withSteps.map((r) => {
        const roleName = r.name;
        const conversations = r.conversations ?? [];
        return (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <p className="text-sm font-semibold text-card-foreground">{t`For ${roleName}, if the village takes your proposal forward:`}</p>
            {conversations.length > 0 && (
              <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-foreground">
                {conversations.map((i, n) => {
                  const who = i.role;
                  const minutes = i.minutes;
                  return (
                    <li key={n}>
                      {i.finalApproval
                        ? t({ message: `${minutes} minutes with ${who}, the final approval`, context: "open proposal conversations" })
                        : t({ message: `${minutes} minutes with ${who}`, context: "open proposal conversations" })}
                    </li>
                  );
                })}
              </ol>
            )}
            {r.bookingUrl && /^https:\/\//.test(r.bookingUrl) ? (
              <a href={r.bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline underline-offset-2">
                {t`Book your first conversation`}
              </a>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t`We'll write to you to find a time.`}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "The time you can give", with the line that pay is never for hours. Asked first among the practicalities (guide v2). */
export function HoursField({ hours, onHours }: { hours: string; onHours: (v: string) => void }) {
  const { t } = useLingui();
  return (
    <div>
      <label htmlFor="card-hours" className="mb-2 block text-sm font-semibold text-card-foreground">
        {t`The time you can give (optional)`}
      </label>
      <input id="card-hours" maxLength={CARD_LIMITS.hours} value={hours} onChange={(e) => onHours(e.target.value)} placeholder={t({ message: "e.g. roughly 25 hours a week", context: "open proposal card" })} className={FIELD} />
      <p className="mt-1 text-xs text-muted-foreground">{t`We don't pay for hours. We pay for contracted work and the contributions you lay out each moon and season.`}</p>
    </div>
  );
}
