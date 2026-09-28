/**
 * THE RESTORATIVE PATH, WHEN THE CONFLICT AGREEMENT HOLDS IT (2026-09-28).
 *
 * Once a village saves a conflict agreement, the exit policy's restorative
 * block reads through it (server/lib/conflictAgreement.ts), and the policy's
 * own save refuses to change that block. So Departures stops offering fields
 * whose edits would be refused, prints what the policy now carries, and points
 * at where the agreement is written.
 *
 * Out of client/src/pages/Admin.tsx because that file sits at its line
 * ratchet. Light-only like the rest of the admin panel.
 */
export const AGREEMENT_HREF = "/governance#conflict-agreement";

export function RestorativeInAgreement({ steps }: { steps: unknown }) {
  const lines = Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
  return (
    <div className="mb-4 rounded-lg border border-stone-200 p-3">
      <p className="text-xs font-medium text-stone-700">The restorative path</p>
      <p className="text-[11px] text-stone-600 mt-1">
        This comes from the village's conflict agreement now, with the care and cover roles, the reply time and the outside contact.{" "}
        <a href={AGREEMENT_HREF} className="text-teal-deep underline">
          Change it in the agreement
        </a>
        .
      </p>
      <ol className="mt-2 list-decimal pl-5 text-xs text-stone-700 space-y-1">
        {lines.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
