/**
 * Three parts of the recap the member writes before sending: the ROLE AUDIT,
 * WHO HELPED YOU THIS MOON (A7), and the MOON GOALS (last moon's, scored, and
 * the next moon's three to five).
 *
 * The audit and the thank-yous travel with `Send my recap`, so they are held
 * by the page and edited here. The goals have their own doors and save on
 * their own. Sending gratitude opens the existing gratitude page with the
 * member filled in; nothing here moves anything.
 */
import { useEffect, useState } from "react";
import {
  CARRY_FLAG_WORDS,
  GOAL_STATUS_WORDS,
  GOALS_MAX,
  GOALS_MIN,
  ITEM_VISIBILITIES,
  ITEM_VISIBILITY_WORDS,
  LET_GO_NEEDS_REASON,
  LIMITS,
  MOON_WORDS,
  MY_MOON_WORDS,
  ROLE_AUDIT_WORDS,
  THANKS_MAX,
  THANKS_WORDS,
  carriedTooOften,
  fillSignalWords,
  scoreWords,
  type GoalStatus,
  type ItemVisibility,
  type MyMoonResponse,
  type RoleAudit,
  type RoleAuditChoice,
  type RoleHeld,
  type SeasonGoalRef,
  type ThanksEntry,
} from "@shared/moonRecap";
import * as api from "./moonApi";
import { ERROR, INPUT, LABEL, LINK, MemberOnly, MUTED, SMALL_BTN, SMALL_BTN_ON, Section } from "./moonUi";

// ── The role audit ──────────────────────────────────────────────────────────

const HELD_CHOICES: RoleAuditChoice[] = ["keep", "expand", "contract", "hand_back"];

export function RoleAuditPanel({ roles, audit, onChange, outsideRoles, villageRoles, editable }: {
  roles: readonly RoleHeld[];
  audit: RoleAudit;
  onChange: (a: RoleAudit) => void;
  outsideRoles: MyMoonResponse["outsideRoles"];
  villageRoles: ReadonlyArray<{ id: string; name: string }>;
  editable: boolean;
}) {
  const entry = (roleId: string) => audit.roles.find((r) => r.roleId === roleId) ?? null;
  const setEntry = (roleId: string, patch: Partial<{ choice: RoleAuditChoice; note: string | null }> | null) => {
    const rest = audit.roles.filter((r) => r.roleId !== roleId);
    if (patch === null) return onChange({ ...audit, roles: rest });
    const was = entry(roleId);
    onChange({ ...audit, roles: [...rest, { roleId, choice: patch.choice ?? was?.choice ?? "keep", note: patch.note !== undefined ? patch.note : was?.note ?? null }] });
  };
  // Fill: roles the member does not hold that their outside work named (check 23).
  const fillRoles = Array.from(new Set(outsideRoles.items.map((i) => i.belongsToRoleId).filter((x): x is string => !!x && !roles.some((r) => r.roleId === x))));
  const nameOf = (id: string) => villageRoles.find((r) => r.id === id)?.name ?? outsideRoles.items.find((i) => i.belongsToRoleId === id)?.belongsTo ?? id;
  const unplaced = outsideRoles.items.filter((i) => !i.belongsToRoleId);

  const choiceRow = (roleId: string, choices: RoleAuditChoice[], name: string) => {
    const e = entry(roleId);
    return (
      <div key={roleId} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="audit-role">
        <p className="m-0 text-sm font-semibold text-foreground">{name}</p>
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button key={c} type="button" disabled={!editable} aria-pressed={e?.choice === c} className={e?.choice === c ? SMALL_BTN_ON : SMALL_BTN} onClick={() => (e?.choice === c && c === "fill" ? setEntry(roleId, null) : setEntry(roleId, { choice: c }))}>
              {ROLE_AUDIT_WORDS[c]}
            </button>
          ))}
        </div>
        {e ? (
          <label className={LABEL}>
            {MY_MOON_WORDS.auditNote}
            <input value={e.note ?? ""} readOnly={!editable} maxLength={LIMITS.roleAuditNote} onChange={(ev) => setEntry(roleId, { note: ev.target.value || null })} className={INPUT} />
          </label>
        ) : null}
      </div>
    );
  };

  return (
    <Section title={MOON_WORDS.roleAudit}>
      {roles.map((r) => choiceRow(r.roleId, HELD_CHOICES, r.name))}
      {outsideRoles.fill.map((f) => <p key={f.roleId} className={MUTED}>{fillSignalWords(f.name, f.count)}</p>)}
      {fillRoles.map((id) => choiceRow(id, ["fill"], nameOf(id)))}

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-base font-semibold text-foreground">{MOON_WORDS.newRole}</h4>
        {unplaced.length > 0 ? (
          <p className={MUTED}>
            {MY_MOON_WORDS.auditPrefilled}: {unplaced.map((i) => i.text).join("; ")}
          </p>
        ) : null}
        {audit.newRoles.map((n, idx) => (
          <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input aria-label={MY_MOON_WORDS.newRoleName} placeholder={MY_MOON_WORDS.newRoleName} value={n.name} readOnly={!editable} maxLength={LIMITS.newRoleName} className={INPUT}
              onChange={(e) => onChange({ ...audit, newRoles: audit.newRoles.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) })} />
            <input aria-label={MY_MOON_WORDS.newRoleWhy} placeholder={MY_MOON_WORDS.newRoleWhy} value={n.why ?? ""} readOnly={!editable} maxLength={LIMITS.roleAuditNote} className={INPUT}
              onChange={(e) => onChange({ ...audit, newRoles: audit.newRoles.map((x, i) => (i === idx ? { ...x, why: e.target.value || null } : x)) })} />
            <button type="button" className={SMALL_BTN} disabled={!editable} onClick={() => onChange({ ...audit, newRoles: audit.newRoles.filter((_, i) => i !== idx) })}>{MY_MOON_WORDS.remove}</button>
          </div>
        ))}
        {audit.newRoles.length < LIMITS.newRoles ? (
          <button type="button" className={`${SMALL_BTN} self-start`} disabled={!editable}
            onClick={() => onChange({ ...audit, newRoles: [...audit.newRoles, { name: unplaced[audit.newRoles.length]?.text.slice(0, LIMITS.newRoleName) ?? "", why: null }] })}>
            {MY_MOON_WORDS.addNewRole}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

// ── Who helped you this moon (A7) ───────────────────────────────────────────

/** The gratitude page with the member filled in, by handle. */
export const gratitudeHref = (handle: string | null) => (handle ? `/gratitude?to=${encodeURIComponent(`@${handle}`)}` : "/gratitude");

export function ThanksPanel({ thanks, onChange, editable }: { thanks: ThanksEntry[]; onChange: (t: ThanksEntry[]) => void; editable: boolean }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ userId: string; name: string; handle: string | null }>>([]);
  const [known, setKnown] = useState<Record<string, { name: string; handle: string | null }>>({});
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void api.findMembers(q).then((r) => live && setFound(r)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const full = thanks.length >= THANKS_MAX;
  const pick = (m: { userId: string; name: string; handle: string | null }) => {
    setKnown((k) => ({ ...k, [m.userId]: { name: m.name, handle: m.handle } }));
    if (!thanks.some((t) => t.userId === m.userId)) onChange([...thanks, { userId: m.userId, name: null, note: null, visibility: "approvers" }]);
    setQ("");
    setFound([]);
  };
  const addName = () => {
    if (!q.trim()) return;
    onChange([...thanks, { userId: null, name: q.trim(), note: null, visibility: "approvers" }]);
    setQ("");
  };
  const set = (idx: number, patch: Partial<ThanksEntry>) => onChange(thanks.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

  return (
    <Section title={THANKS_WORDS.heading}>
      {thanks.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {thanks.map((t, idx) => {
            const who = t.userId ? known[t.userId]?.name ?? t.name ?? MY_MOON_WORDS.none : t.name ?? "";
            return (
              <li key={`${t.userId ?? t.name}-${idx}`} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-sm font-semibold text-foreground">{who}</p>
                  <div className="flex flex-wrap gap-2">
                    {t.userId ? <a className={`${LINK} text-sm`} href={gratitudeHref(known[t.userId]?.handle ?? null)}>{THANKS_WORDS.sendGratitude}</a> : null}
                    <button type="button" className={SMALL_BTN} disabled={!editable} onClick={() => onChange(thanks.filter((_, i) => i !== idx))}>{MY_MOON_WORDS.remove}</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
                  <input aria-label={MY_MOON_WORDS.thanksNote} placeholder={MY_MOON_WORDS.thanksNote} value={t.note ?? ""} maxLength={200} readOnly={!editable} onChange={(e) => set(idx, { note: e.target.value || null })} className={INPUT} />
                  <select aria-label={MY_MOON_WORDS.whoSees} value={t.visibility} disabled={!editable} onChange={(e) => set(idx, { visibility: e.target.value as ItemVisibility })} className={INPUT}>
                    {ITEM_VISIBILITIES.map((v) => <option key={v} value={v}>{ITEM_VISIBILITY_WORDS[v]}</option>)}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!full ? (
        <div className="flex flex-col gap-2">
          <label className={LABEL}>
            {MY_MOON_WORDS.thanksFind}
            <input value={q} readOnly={!editable} onChange={(e) => setQ(e.target.value)} className={INPUT} />
          </label>
          {found.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {found.map((m) => (
                <li key={m.userId}>
                  <button type="button" className={SMALL_BTN} onClick={() => pick(m)}>{m.name}{m.handle ? ` @${m.handle}` : ""}</button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className={`${SMALL_BTN} self-start`} disabled={!editable || !q.trim()} onClick={addName}>{MY_MOON_WORDS.thanksAdd}</button>
        </div>
      ) : null}
      <p className={MUTED}>{MY_MOON_WORDS.thanksSavedOnSend}</p>
    </Section>
  );
}

// ── Moon goals (decision 20) ────────────────────────────────────────────────

type DraftGoal = { text: string; doneWhen: string; seasonGoalId: string; carriedFromId: string | null; carryCount: number };

const SCORE_CHOICES: Array<Exclude<GoalStatus, "open">> = ["done", "partly", "carried", "let_go"];

export function GoalsPanel({ cycleId, last, goalScore, next, seasonGoals, reload, editable }: {
  cycleId: string;
  last: MyMoonResponse["lastMoonGoals"];
  goalScore: MyMoonResponse["goalScore"];
  next: MyMoonResponse["nextMoonGoals"];
  seasonGoals: readonly SeasonGoalRef[];
  reload: () => Promise<unknown>;
  editable: boolean;
}) {
  const fromServer = (): DraftGoal[] =>
    [...next].sort((a, b) => Number(!!b.carriedFromId) - Number(!!a.carriedFromId) || a.position - b.position)
      .map((g) => ({ text: g.text, doneWhen: g.doneWhen ?? "", seasonGoalId: g.seasonGoalId ?? "", carriedFromId: g.carriedFromId, carryCount: g.carryCount }));
  const [draft, setDraft] = useState<DraftGoal[]>(fromServer);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(fromServer()), [next]);

  const score = async (id: string, status: Exclude<GoalStatus, "open">) => {
    setError(null);
    const reason = (reasons[id] ?? "").trim();
    if (status === "let_go" && !reason) return setError(LET_GO_NEEDS_REASON);
    const r = await api.scoreGoal(id, { status, letGoReason: status === "let_go" ? reason : null });
    if (!r.ok) return setError(r.error);
    await reload();
  };
  const save = async () => {
    setError(null);
    setLine(null);
    const goals = draft.filter((g) => g.text.trim()).map((g) => ({ text: g.text.trim(), doneWhen: g.doneWhen.trim() || null, seasonGoalId: g.seasonGoalId || null, carriedFromId: g.carriedFromId }));
    const r = await api.saveNextGoals(cycleId, goals);
    if (!r.ok) return setError(r.error);
    setLine(MY_MOON_WORDS.saved);
    await reload();
  };
  const set = (idx: number, patch: Partial<DraftGoal>) => setDraft(draft.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  const filled = draft.filter((g) => g.text.trim()).length;

  return (
    <>
      {last.length > 0 ? (
        <Section title={MY_MOON_WORDS.lastGoals}>
          <MemberOnly>
            <p className={MUTED}>{MY_MOON_WORDS.goalScoreLine}: {scoreWords(goalScore)}</p>
          </MemberOnly>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {last.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <p className="m-0 text-sm font-medium text-foreground">{g.text}</p>
                {g.doneWhen ? <p className="m-0 text-xs text-muted-foreground">{MY_MOON_WORDS.doneWhen}: {g.doneWhen}</p> : null}
                {g.flagged ? <p className="m-0 text-xs text-destructive">{CARRY_FLAG_WORDS}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {SCORE_CHOICES.map((s) => (
                    <button key={s} type="button" disabled={!editable} aria-pressed={g.status === s} className={g.status === s ? SMALL_BTN_ON : SMALL_BTN} onClick={() => void score(g.id, s)}>
                      {GOAL_STATUS_WORDS[s]}
                    </button>
                  ))}
                </div>
                {g.status !== "let_go" ? (
                  <input aria-label={MY_MOON_WORDS.letGoReason} placeholder={MY_MOON_WORDS.letGoReason} value={reasons[g.id] ?? g.letGoReason ?? ""} readOnly={!editable}
                    onChange={(e) => setReasons({ ...reasons, [g.id]: e.target.value })} className={INPUT} />
                ) : g.letGoReason ? <p className="m-0 text-xs text-muted-foreground">{g.letGoReason}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={MY_MOON_WORDS.nextGoals}>
        <p className={MUTED}>{MY_MOON_WORDS.nextGoalsLine}</p>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {draft.map((g, idx) => (
            <li key={idx} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="next-goal">
              {g.carriedFromId ? <p className="m-0 text-xs text-muted-foreground">{MY_MOON_WORDS.carriedTimes(g.carryCount)}</p> : null}
              {carriedTooOften(g) ? <p className="m-0 text-xs text-destructive">{CARRY_FLAG_WORDS}</p> : null}
              <label className={LABEL}>
                {MY_MOON_WORDS.goalText}
                <input value={g.text} maxLength={LIMITS.goalText} readOnly={!editable} onChange={(e) => set(idx, { text: e.target.value })} className={INPUT} />
              </label>
              <label className={LABEL}>
                {MY_MOON_WORDS.doneWhen}
                <input value={g.doneWhen} maxLength={LIMITS.goalDoneWhen} readOnly={!editable} onChange={(e) => set(idx, { doneWhen: e.target.value })} className={INPUT} />
              </label>
              <label className={LABEL}>
                {MY_MOON_WORDS.seasonGoal}
                <select value={g.seasonGoalId} disabled={!editable} onChange={(e) => set(idx, { seasonGoalId: e.target.value })} className={INPUT}>
                  <option value="">{MY_MOON_WORDS.none}</option>
                  {seasonGoals.map((s) => <option key={s.id} value={s.id}>{s.words}</option>)}
                </select>
              </label>
              <button type="button" className={`${SMALL_BTN} self-start`} disabled={!editable} onClick={() => setDraft(draft.filter((_, i) => i !== idx))}>{MY_MOON_WORDS.remove}</button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {draft.length < GOALS_MAX ? (
            <button type="button" className={SMALL_BTN} disabled={!editable} onClick={() => setDraft([...draft, { text: "", doneWhen: "", seasonGoalId: "", carriedFromId: null, carryCount: 0 }])}>{MY_MOON_WORDS.addGoal}</button>
          ) : null}
          <button type="button" className={SMALL_BTN} disabled={!editable || filled < GOALS_MIN || filled > GOALS_MAX} onClick={save}>{MY_MOON_WORDS.saveGoals}</button>
        </div>
        {line ? <p className={MUTED} aria-live="polite">{line}</p> : null}
        {error ? <p role="alert" className={ERROR}>{error}</p> : null}
      </Section>
    </>
  );
}
