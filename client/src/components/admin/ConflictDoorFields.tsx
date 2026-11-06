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
 * Out of client/src/pages/Admin.tsx because that file sits at its line
 * ratchet, and an admin surface belongs here. Light-only like the rest of the
 * admin panel, so the grays are numbered on purpose.
 */

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
}: {
  restorative: ConflictDoorDraft | null | undefined;
  roles: ReadonlyArray<{ id: string; name?: string | null }>;
  onChange: (patch: Partial<ConflictDoorDraft>) => void;
  inputCls: string;
}) {
  const r = restorative ?? {};
  const intake = r.intakeContactRole ?? "";
  const cover = r.coverRole ?? "";
  const contact = { name: "", organisation: "", howToReach: "", ...(r.outsideContact ?? {}) };
  const setContact = (patch: Partial<typeof contact>) => onChange({ outsideContact: { ...contact, ...patch } });
  const field = `${inputCls} w-full mt-1 min-h-[44px]`;

  return (
    <fieldset className="mb-4 border border-gray-200 rounded-lg p-4">
      <legend className="text-xs font-medium text-gray-700 px-1">Where a conflict goes</legend>
      <p className="text-[11px] text-gray-500 mb-3">
        Before the village is asked to start, a member with a conflict needs somebody to bring it to and a
        reply time the village chose. That is a person who holds the intake role today, or a named contact
        outside the village. With fewer than three members who are not founders, the outside contact is
        required. The exit policy page shows the roles, the reply time and the outside contact's organisation
        to anyone. The outside contact's name and how to reach them show to members only.
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <label className="text-xs text-gray-500">Restorative intake role
          <select value={intake}
            onChange={(e) => {
              const next = e.target.value;
              onChange(!next || next === cover ? { intakeContactRole: next, coverRole: "" } : { intakeContactRole: next });
            }}
            className={field}>
            <option value="">none configured</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name ?? role.id}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">Cover role, recorded only for now
          <select value={cover} disabled={!intake}
            onChange={(e) => onChange({ coverRole: e.target.value })}
            className={field}>
            <option value="">no cover role</option>
            {roles.filter((role) => role.id !== intake).map((role) => (
              <option key={role.id} value={role.id}>{role.name ?? role.id}</option>
            ))}
          </select>
          <span className="block mt-1 text-[11px] text-gray-500">
            A request still goes only to the intake role, and the checklist counts only its holders.
          </span>
        </label>
        <label className="text-xs text-gray-500">Promised reply time, in hours
          <input type="number" min={1} max={720} step={1} inputMode="numeric"
            value={r.replyHours ?? ""} placeholder="The village chooses"
            onChange={(e) => onChange({ replyHours: e.target.value === "" ? null : Number(e.target.value) })}
            className={field} />
        </label>
      </div>

      <p className="text-xs font-medium text-gray-700 mb-1">A contact outside the village</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs text-gray-500">Name
          <input type="text" value={contact.name} maxLength={120}
            onChange={(e) => setContact({ name: e.target.value })} className={field} />
        </label>
        <label className="text-xs text-gray-500">Organisation (optional)
          <input type="text" value={contact.organisation} maxLength={120}
            onChange={(e) => setContact({ organisation: e.target.value })} className={field} />
        </label>
        <label className="text-xs text-gray-500">How to reach them
          <input type="text" value={contact.howToReach} maxLength={300}
            onChange={(e) => setContact({ howToReach: e.target.value })} className={field} />
        </label>
      </div>
    </fieldset>
  );
}
