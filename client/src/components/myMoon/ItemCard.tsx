/**
 * ONE PIECE OF WORK ON MY MOON: its words, keep or drop, how it ended, the
 * role it sits under (or Outside my roles and the role it belongs to), the
 * accountability, the season goal, the member's own seasonal goal, who sees
 * it and an optional proof link.
 *
 * Each change saves on its own through `PATCH /api/me/moon/items/:id`; a
 * typed field saves when it loses focus. The server's refusal is shown under
 * the card as its sentence. While the recap is not the member's to edit
 * (`recapEditable`), every control is read-only.
 */
import { useEffect, useState } from "react";
import {
  ITEM_KEEP_WORDS,
  ITEM_ORIGIN_WORDS,
  ITEM_STATE_WORDS,
  ITEM_VISIBILITIES,
  ITEM_VISIBILITY_WORDS,
  LET_GO_NEEDS_REASON,
  MY_MOON_WORDS,
  NO_ROLE_YET,
  OUTSIDE_MY_ROLES,
  REDIRECT_NEEDS_WHO,
  TASK_STATUSES,
  TASK_STATUS_WORDS,
  type ItemFields,
  type ItemVisibility,
  type RecapItem,
  type RoleHeld,
  type SeasonGoalRef,
  type TaskStatus,
} from "@shared/moonRecap";
import { CHIP, ERROR, INPUT, LABEL, MUTED, SMALL_BTN, SMALL_BTN_ON } from "./moonUi";
import VoiceArea from "@/components/voice/VoiceArea";

export interface ItemCardProps {
  item: RecapItem;
  roles: readonly RoleHeld[];
  seasonGoals: readonly SeasonGoalRef[];
  ownGoals: readonly string[];
  /** Every role on the village, for "the role it belongs to". */
  villageRoles: ReadonlyArray<{ id: string; name: string }>;
  editable: boolean;
  /** Save some fields. Resolves to the refusal sentence, or null when saved. */
  onSave: (fields: ItemFields) => Promise<string | null>;
}

const OUTSIDE = "";

export default function ItemCard({ item, roles, seasonGoals, ownGoals, villageRoles, editable, onSave }: ItemCardProps) {
  const [text, setText] = useState(item.text);
  const [letGo, setLetGo] = useState(item.letGoReason ?? "");
  const [redirect, setRedirect] = useState(item.redirectTo ?? "");
  const [proof, setProof] = useState(item.evidenceUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setText(item.text), [item.text]);
  useEffect(() => setLetGo(item.letGoReason ?? ""), [item.letGoReason]);
  useEffect(() => setRedirect(item.redirectTo ?? ""), [item.redirectTo]);
  useEffect(() => setProof(item.evidenceUrl ?? ""), [item.evidenceUrl]);

  const save = async (fields: ItemFields) => {
    if (!editable || busy) return;
    setBusy(true);
    setError(await onSave(fields));
    setBusy(false);
  };
  const saveIfChanged = (key: keyof ItemFields, value: string, was: string | null) => {
    const v = value.trim();
    if (v === (was ?? "")) return;
    void save({ [key]: v || null } as ItemFields);
  };

  const role = roles.find((r) => r.roleId === item.roleId) ?? null;
  const lines = role ? [...role.accountabilities, ...role.deliverables] : [];
  const dropped = item.state === "dropped";
  const id = `item-${item.id}`;

  return (
    <article
      aria-label={item.text}
      data-testid="moon-item"
      className={`flex flex-col gap-3 rounded-[14px] border border-dash-edge bg-card p-3 sm:p-4 ${dropped ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{ITEM_ORIGIN_WORDS[item.origin]}</span>
        {item.originNote ? <span>· {item.originNote}</span> : null}
        {item.state === "suggested" ? <span className={CHIP}>{ITEM_STATE_WORDS.suggested}</span> : null}
        {item.evidenceOn ? <span>· {item.evidenceOn}</span> : null}
      </div>

      <label className={LABEL} htmlFor={`${id}-text`}>
        {MY_MOON_WORDS.itemWords}
        {/* This box saves on blur; spoken words arrive without a blur, so they save as they land. */}
        <VoiceArea value={text} onValue={(v) => { setText(v); saveIfChanged("text", v, item.text); }} disabled={!editable}>
        <textarea
          id={`${id}-text`}
          value={text}
          rows={2}
          readOnly={!editable}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => saveIfChanged("text", text, item.text)}
          className={INPUT}
        />
        </VoiceArea>
      </label>

      <div className="flex flex-wrap gap-2" role="group" aria-label={ITEM_STATE_WORDS.kept}>
        {(["kept", "dropped"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={!editable}
            aria-pressed={item.state === s}
            onClick={() => void save({ state: s })}
            className={item.state === s ? SMALL_BTN_ON : SMALL_BTN}
          >
            {ITEM_KEEP_WORDS[s]}
          </button>
        ))}
      </div>

      {!dropped ? (
        <>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={LABEL}>{MY_MOON_WORDS.howItEnded}</legend>
            <div className="flex flex-wrap gap-2">
              {TASK_STATUSES.map((s: TaskStatus) => (
                <button
                  key={s}
                  type="button"
                  disabled={!editable}
                  aria-pressed={item.taskStatus === s}
                  onClick={() => void save({ taskStatus: item.taskStatus === s ? null : s })}
                  className={item.taskStatus === s ? SMALL_BTN_ON : SMALL_BTN}
                >
                  {TASK_STATUS_WORDS[s]}
                </button>
              ))}
            </div>
            {item.taskStatus === "let_go" ? (
              <label className={LABEL}>
                {MY_MOON_WORDS.letGoReason}
                <input value={letGo} readOnly={!editable} onChange={(e) => setLetGo(e.target.value)} onBlur={() => saveIfChanged("letGoReason", letGo, item.letGoReason)} className={INPUT} />
                {!item.letGoReason ? <span className="mt-1 block text-xs text-muted-foreground">{LET_GO_NEEDS_REASON}</span> : null}
              </label>
            ) : null}
            {item.taskStatus === "redirect" ? (
              <label className={LABEL}>
                {MY_MOON_WORDS.redirectTo}
                <input value={redirect} readOnly={!editable} onChange={(e) => setRedirect(e.target.value)} onBlur={() => saveIfChanged("redirectTo", redirect, item.redirectTo)} className={INPUT} />
                {!item.redirectTo ? <span className="mt-1 block text-xs text-muted-foreground">{REDIRECT_NEEDS_WHO}</span> : null}
              </label>
            ) : null}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              {MY_MOON_WORDS.role}
              <select
                value={item.roleId ?? OUTSIDE}
                disabled={!editable}
                onChange={(e) => void save({ roleId: e.target.value || null, accountabilityWords: null })}
                className={INPUT}
              >
                {roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.name}</option>)}
                <option value={OUTSIDE}>{OUTSIDE_MY_ROLES}</option>
              </select>
            </label>

            {role ? (
              <label className={LABEL}>
                {MY_MOON_WORDS.accountability}
                <select value={item.accountabilityWords ?? ""} disabled={!editable} onChange={(e) => void save({ accountabilityWords: e.target.value || null })} className={INPUT}>
                  <option value="">{MY_MOON_WORDS.none}</option>
                  {lines.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            ) : (
              <label className={LABEL}>
                {MY_MOON_WORDS.belongsTo}
                <select value={item.belongsToRoleId ?? ""} disabled={!editable} onChange={(e) => void save({ belongsToRoleId: e.target.value || null })} className={INPUT}>
                  <option value="">{item.belongsToSeatWords || NO_ROLE_YET}</option>
                  {villageRoles.filter((r) => !roles.some((h) => h.roleId === r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            )}

            <label className={LABEL}>
              {MY_MOON_WORDS.seasonGoal}
              <select value={item.seasonGoalId ?? ""} disabled={!editable} onChange={(e) => void save({ seasonGoalId: e.target.value || null })} className={INPUT}>
                <option value="">{MY_MOON_WORDS.none}</option>
                {seasonGoals.map((g) => <option key={g.id} value={g.id}>{g.words}</option>)}
              </select>
            </label>

            <label className={LABEL}>
              {MY_MOON_WORDS.ownGoal}
              <select value={item.ownGoalWords ?? ""} disabled={!editable} onChange={(e) => void save({ ownGoalWords: e.target.value || null })} className={INPUT}>
                <option value="">{MY_MOON_WORDS.none}</option>
                {ownGoals.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>

            <label className={LABEL}>
              {MY_MOON_WORDS.whoSees}
              <select value={item.visibility} disabled={!editable} onChange={(e) => void save({ visibility: e.target.value as ItemVisibility })} className={INPUT}>
                {ITEM_VISIBILITIES.map((v) => <option key={v} value={v}>{ITEM_VISIBILITY_WORDS[v]}</option>)}
              </select>
            </label>

            <label className={LABEL}>
              {MY_MOON_WORDS.proofLink}
              <input type="url" inputMode="url" value={proof} readOnly={!editable} onChange={(e) => setProof(e.target.value)} onBlur={() => saveIfChanged("evidenceUrl", proof, item.evidenceUrl)} className={INPUT} />
            </label>
          </div>
        </>
      ) : null}

      {busy ? <p className={MUTED}>{MY_MOON_WORDS.saving}</p> : null}
      {error ? <p role="alert" className={ERROR}>{error}</p> : null}
    </article>
  );
}
