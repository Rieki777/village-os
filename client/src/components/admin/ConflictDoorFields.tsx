/**
 * WHERE A CONFLICT GOES, edited on Departures (2026-09-27).
 *
 * The exit policy's restorative block always held one of these facts, the
 * intake role. The launch checklist's `conflict-door` row now asks for three
 * more, and this is where a founder answers them:
 *
 *   the cover role        a second permission role, for when the intake role's
 *                         holders cannot take a request. RECORDED ONLY, today:
 *                         an intake still reaches the intake role's live
 *                         holders and nobody else, and the checklist counts
 *                         only them, so the field says so where it is chosen;
 *   the reply time        whole hours, promised to a member who asks for care,
 *                         with NO platform default: the box starts empty and a
 *                         number here is one the village chose;
 *   the outside contact   somebody outside the village, required on the
 *                         checklist while fewer than three members are not
 *                         founders.
 *
 * The server holds the rules (`restorativeDoorProblem` in
 * server/lib/exitPolicy.ts refuses a malformed save and says why); this form
 * only keeps two choices from contradicting each other while they are typed,
 * so the refusal is rarely needed: the cover list leaves out the intake role,
 * and clearing or matching the intake role clears the cover.
 *
 * THE THREE NEW FIELDS FOLLOW CONFLICT EVOLUTION (Rye's module ruling,
 * 2026-10-01). The cover role, the reply time and the outside contact are the
 * conflict door's, and the `conflict-door` launch row that asks for them
 * applies only while that module is on. With it off (`door` false) this is
 * the one field Departures always had, the intake role, and nothing else.
 *
 * THE PICKER SAYS WHO HOLDS EACH ROLE TODAY (plan 6.2 frame 2;
 * W2-intake-picker-holders). Each option carries its live-holder count, the
 * one the checklist counts (`liveHolderCount`, lapsed terms out, served by
 * GET /api/roles). An intake role nobody holds gets a sentence and a link to
 * Power groups, where a holder is seated, because the launch row's own link
 * comes back to this page and a holder cannot be seated here.
 *
 * Out of client/src/pages/Admin.tsx because that file sits at its line
 * ratchet, and an admin surface belongs here. Light-only like the rest of the
 * admin panel, so the grays are numbered on purpose.
 */
import { Trans, useLingui } from "@lingui/react/macro";

export interface ConflictDoorDraft {
  intakeContactRole?: string;
  coverRole?: string;
  replyHours?: number | null;
  outsideContact?: { name?: string; organisation?: string; howToReach?: string };
}

export function ConflictDoorFields({
  restorative,
  roles,
  onChange,
  inputCls,
  door = true,
}: {
  restorative: ConflictDoorDraft | null | undefined;
  roles: ReadonlyArray<{ id: string; name?: string | null; liveHolderCount?: number }>;
  onChange: (patch: Partial<ConflictDoorDraft>) => void;
  inputCls: string;
  /** Conflict Evolution is on, so the whole door is asked for. Off: the intake role alone. */
  door?: boolean;
}) {
  const { t } = useLingui();
  const r = restorative ?? {};
  const intake = r.intakeContactRole ?? "";
  const cover = r.coverRole ?? "";
  const contact = { name: "", organisation: "", howToReach: "", ...(r.outsideContact ?? {}) };
  const setContact = (patch: Partial<typeof contact>) => onChange({ outsideContact: { ...contact, ...patch } });
  const field = `${inputCls} w-full mt-1 min-h-[44px]`;
  const optionText = (role: { id: string; name?: string | null; liveHolderCount?: number }) => {
    const name = role.name ?? role.id;
    if (typeof role.liveHolderCount !== "number") return name;
    const holders = role.liveHolderCount;
    return holders > 0 ? t({ message: `${name} (held by ${holders} today)`, context: "a role in the picker and how many hold it" }) : t`${name} (nobody holds it today)`;
  };
  const chosen = roles.find((role) => role.id === intake);
  const chosenName = chosen ? chosen.name ?? chosen.id : "";
  const unheld = chosen && chosen.liveHolderCount === 0 ? (
    <span className="block mt-1 text-[11px] text-amber-800">
      <Trans>
        Nobody holds the {chosenName} role today, so a request would reach nobody.{" "}
        <a href="/admin?tab=game-roles" className="font-medium underline">Give the role a holder under Power groups</a>, or name a contact
        outside the village.
      </Trans>
    </span>
  ) : null;

  if (!door) {
    return (
      <label className="text-xs text-gray-500 block mb-4"><Trans context="label of the intake role picker">Restorative intake role</Trans>
        <select value={intake} onChange={(e) => onChange({ intakeContactRole: e.target.value })} className={field}>
          <option value="">{t({ message: "none configured", context: "no intake role chosen" })}</option>
          {roles.map((role) => <option key={role.id} value={role.id}>{optionText(role)}</option>)}
        </select>
        <span className="block mt-1 text-[11px] text-gray-500">
          <Trans>A private intake reaches only the people holding this role, in their notifications here.</Trans>
        </span>
        {unheld}
      </label>
    );
  }

  return (
    <fieldset className="mb-4 border border-gray-200 rounded-lg p-4">
      <legend className="text-xs font-medium text-gray-700 px-1"><Trans>Where a conflict goes</Trans></legend>
      <p className="text-[11px] text-gray-500 mb-3">
        <Trans>
          Before the village is asked to start, a member with a conflict needs somebody to bring it to and a
          reply time the village chose. That is a person who holds the intake role today, or a named contact
          outside the village. With fewer than three members who are not founders, the outside contact is
          required. The exit policy page shows the roles, the reply time and the outside contact's organisation
          to anyone. The outside contact's name and how to reach them show to members only.
        </Trans>
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <label className="text-xs text-gray-500"><Trans context="label of the intake role picker">Restorative intake role</Trans>
          <select value={intake}
            onChange={(e) => {
              const next = e.target.value;
              onChange(!next || next === cover ? { intakeContactRole: next, coverRole: "" } : { intakeContactRole: next });
            }}
            className={field}>
            <option value="">{t({ message: "none configured", context: "no intake role chosen" })}</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{optionText(role)}</option>)}
          </select>
          {unheld}
        </label>
        <label className="text-xs text-gray-500"><Trans>Cover role, recorded only for now</Trans>
          <select value={cover} disabled={!intake}
            onChange={(e) => onChange({ coverRole: e.target.value })}
            className={field}>
            <option value="">{t({ message: "no cover role", context: "no cover role chosen" })}</option>
            {roles.filter((role) => role.id !== intake).map((role) => (
              <option key={role.id} value={role.id}>{role.name ?? role.id}</option>
            ))}
          </select>
          <span className="block mt-1 text-[11px] text-gray-500">
            <Trans>A request still goes only to the intake role, and the checklist counts only its holders.</Trans>
          </span>
        </label>
        <label className="text-xs text-gray-500"><Trans>Promised reply time, in hours</Trans>
          <input type="number" min={1} max={720} step={1} inputMode="numeric"
            value={r.replyHours ?? ""} placeholder={t({ message: "The village chooses", context: "empty reply time" })}
            onChange={(e) => onChange({ replyHours: e.target.value === "" ? null : Number(e.target.value) })}
            className={field} />
        </label>
      </div>

      <p className="text-xs font-medium text-gray-700 mb-1"><Trans>A contact outside the village</Trans></p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs text-gray-500"><Trans context="an outside contact's name">Name</Trans>
          <input type="text" value={contact.name} maxLength={120}
            onChange={(e) => setContact({ name: e.target.value })} className={field} />
        </label>
        <label className="text-xs text-gray-500"><Trans context="an outside contact's organisation">Organisation (optional)</Trans>
          <input type="text" value={contact.organisation} maxLength={120}
            onChange={(e) => setContact({ organisation: e.target.value })} className={field} />
        </label>
        <label className="text-xs text-gray-500"><Trans>How to reach them</Trans>
          <input type="text" value={contact.howToReach} maxLength={300}
            onChange={(e) => setContact({ howToReach: e.target.value })} className={field} />
        </label>
      </div>
    </fieldset>
  );
}
