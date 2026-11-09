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
import { useLingui } from "@lingui/react/macro";
import { CARD_LIMITS, CARD_WINDOWS } from "@shared/openProposalCard";
import ApplicationAgreements from "./ApplicationAgreements";

export interface RoleCardState {
  /** Outcome text -> target. */
  moves: Record<string, string>;
  quests: Array<{ quest: string; doneWhen: string }>;
}

export const EMPTY_ROLE_CARD: RoleCardState = { moves: {}, quests: [{ quest: "", doneWhen: "" }] };

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RoleAsks({
  roleId,
  roleName,
  aim,
  timeCommitment,
  accountabilities,
  value,
  onChange,
}: {
  roleId: string;
  roleName: string;
  aim: string | null;
  timeCommitment: string | null;
  accountabilities: readonly string[];
  value: RoleCardState;
  onChange: (next: RoleCardState) => void;
}) {
  const { t } = useLingui();
  const picked = Object.keys(value.moves);
  const full = picked.length >= CARD_LIMITS.movesPerRole;
  const setQuest = (i: number, patch: Partial<{ quest: string; doneWhen: string }>) =>
    onChange({ ...value, quests: value.quests.map((q, j) => (j === i ? { ...q, ...patch } : q)) });

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
            {t`Which of ${roleName}'s outcomes will you move? Pick up to ${CARD_LIMITS.movesPerRole}, each with a target.`}
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
                    className="mt-1 size-4 shrink-0 accent-primary"
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
        <legend className="text-sm font-semibold text-card-foreground">{t`Your first moon in ${roleName}: up to ${CARD_LIMITS.questsPerRole} quests, each with a "Done when" test`}</legend>
        {value.quests.map((q, i) => {
          const n = i + 1;
          return (
          <div key={i} className="grid gap-1 sm:grid-cols-2">
            <input
              aria-label={t({ message: `Quest ${n} for ${roleName}`, context: "open proposal card field" })}
              placeholder={t({ message: "The quest", context: "open proposal card" })}
              maxLength={CARD_LIMITS.quest}
              value={q.quest}
              onChange={(e) => setQuest(i, { quest: e.target.value })}
              className={FIELD}
            />
            <input
              aria-label={t({ message: `Done when, for quest ${n} for ${roleName}`, context: "open proposal card field" })}
              placeholder={t({ message: "Done when...", context: "open proposal card" })}
              maxLength={CARD_LIMITS.doneWhen}
              value={q.doneWhen}
              onChange={(e) => setQuest(i, { doneWhen: e.target.value })}
              className={FIELD}
            />
          </div>
          );
        })}
        {value.quests.length < CARD_LIMITS.questsPerRole && (
          <button
            type="button"
            onClick={() => onChange({ ...value, quests: [...value.quests, { quest: "", doneWhen: "" }] })}
            className="min-h-11 justify-self-start text-sm font-medium text-foreground underline underline-offset-2"
          >
            {t({ message: "Add a quest", context: "open proposal card" })}
          </button>
        )}
      </fieldset>
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
}: {
  goals: ReadonlyArray<{ id: string; text: string }>;
  serves: Record<string, string>;
  onServes: (next: Record<string, string>) => void;
  hours: string;
  onHours: (v: string) => void;
  agreed: { loveLetter: boolean; nda: boolean };
  onAgreed: (next: { loveLetter: boolean; nda: boolean }) => void;
}) {
  const { t } = useLingui();
  const full = Object.keys(serves).length >= CARD_LIMITS.serves;
  return (
    <div className="grid gap-5">
      {goals.length > 0 && (
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
                    className="mt-1 size-4 shrink-0 accent-primary"
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
      <div>
        <label htmlFor="card-hours" className="mb-2 block text-sm font-semibold text-card-foreground">
          {t`The time you can give (optional)`}
        </label>
        <input id="card-hours" maxLength={CARD_LIMITS.hours} value={hours} onChange={(e) => onHours(e.target.value)} placeholder={t({ message: "e.g. roughly 25 hours a week", context: "open proposal card" })} className={FIELD} />
        <p className="mt-1 text-xs text-muted-foreground">{t`We don't pay for hours. We pay for contracted work and the contributions you lay out each moon and season.`}</p>
      </div>
      <ApplicationAgreements value={agreed} onChange={onAgreed} />
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
}: {
  roles: ReadonlyArray<{ id: string; name: string | null; accountabilities?: string[]; timeCommitment?: string | null }>;
  card: {
    roles: Array<{ roleId: string; moves: Array<{ text: string; target: string }>; firstMoon: Array<{ quest: string; doneWhen: string }> }>;
    serves: Array<{ goalId: string; how: string; goal?: string }>;
    hours: string;
    agreed: { loveLetter: boolean; nda: boolean };
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
    if (asks.length && !(mine?.moves ?? []).some((m) => asks.includes(m.text))) gaps.push(t`No outcome of ${roleName} picked`);
    if (!(mine?.firstMoon ?? []).length) gaps.push(t`No first-moon quest for ${roleName}`);
  }
  if (!card.serves.length) gaps.push(t`No season goal served`);
  if (!card.agreed.loveLetter || !card.agreed.nda) gaps.push(t`The agreements are not given`);
  if (card.terms?.choice === "talk") gaps.push(t`They want to talk about the terms`);
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
            <p className="bg-primary px-3 py-2 text-sm font-bold text-primary-foreground">{roleName}</p>
            <div className="grid sm:grid-cols-2">
              <div className="min-w-0 border-b border-border p-3 sm:border-b-0 sm:border-r">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "The role asks", context: "open proposal side by side" })}</p>
                {time && <p className="mt-1 text-xs text-muted-foreground">{t({ message: `Time: roughly ${time}`, context: "open proposal side by side" })}</p>}
                <ul className="mt-2 grid gap-1 text-sm">
                  {asks.length === 0 && <li className="text-muted-foreground">{t`This role lists no outcomes yet.`}</li>}
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
                    return (
                      <li key={i}>
                        {t({ message: `First moon: ${quest}`, context: "open proposal side by side" })}
                        {doneWhen && <span className="text-muted-foreground"> {t({ message: `(done when ${doneWhen})`, context: "open proposal side by side" })}</span>}
                      </li>
                    );
                  })}
                  {!mine.moves.length && !mine.firstMoon.length && <li className="text-muted-foreground">{t`Nothing offered for this role beyond their note.`}</li>}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-border p-3 text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "The season's goals they serve", context: "open proposal side by side" })}</p>
        {card.serves.length ? (
          <ul className="mt-2 grid gap-1 text-foreground">
            {card.serves.map((s) => (
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
          {card.agreed.loveLetter && card.agreed.nda
            ? t`They aligned with the Love Letter, and will align with the NDA once approved.`
            : t`They have not agreed to the Love Letter and the NDA.`}
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
 * reviewer sees flagged. Interviews are booked across time zones, so the zone
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
                className="size-4 accent-primary"
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
          <input type="radio" name="card-terms" required className="mt-1 size-4 accent-primary" checked={value.terms.choice === "accept"} onChange={() => onChange({ ...value, terms: { ...value.terms, choice: "accept" } })} />
          {t`I accept the terms on offer.`}
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
          <input type="radio" name="card-terms" required className="mt-1 size-4 accent-primary" checked={value.terms.choice === "talk"} onChange={() => onChange({ ...value, terms: { ...value.terms, choice: "talk" } })} />
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
        <p className="text-xs text-muted-foreground">{t`Everyone who reads your application sees a wish to talk about the terms.`}</p>
      </fieldset>
    </div>
  );
}

/**
 * WHAT HAPPENS NEXT, for the roles picked (brief v2, 13.6; Rye's answer 7):
 * the interviews in order, with their length and which is the final approval,
 * when a role carries them (the role-interviews lane fills `interviews`), and
 * the booking link when the role has one (`bookingUrl`, PR-A).
 */
export function NextForRoles({
  roles,
}: {
  roles: ReadonlyArray<{ id: string; name: string; interviews?: Array<{ role: string; minutes: number; finalApproval?: boolean }>; bookingUrl?: string | null }>;
}) {
  const { t } = useLingui();
  const withSteps = roles.filter((r) => (r.interviews?.length ?? 0) > 0 || r.bookingUrl);
  if (!withSteps.length) return null;
  return (
    <div className="mt-4 grid gap-3 text-left" data-next-for-roles="">
      {withSteps.map((r) => {
        const roleName = r.name;
        const interviews = r.interviews ?? [];
        return (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <p className="text-sm font-semibold text-card-foreground">{t`For ${roleName}, if the village takes your application forward:`}</p>
            {interviews.length > 0 && (
              <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-foreground">
                {interviews.map((i, n) => {
                  const who = i.role;
                  const minutes = i.minutes;
                  return (
                    <li key={n}>
                      {i.finalApproval
                        ? t({ message: `${minutes} minutes with ${who}, the final approval`, context: "open proposal interviews" })
                        : t({ message: `${minutes} minutes with ${who}`, context: "open proposal interviews" })}
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
