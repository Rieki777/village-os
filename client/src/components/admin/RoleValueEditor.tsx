/**
 * WHAT A ROLE IS WORTH AND PAYS EACH SEAT EVERY CYCLE (0265, Rye 2026-10-21).
 *
 * Roles are paid in the village's own tokens, never in Gratitude, and each role
 * says what it pays: the value in the village's currency, and the token amounts
 * the cycle settlement pays each seat, under the village's `role.cycle` rule
 * ceilings. A role with no list of its own is paid the standard amounts, which
 * is what the boxes open on. The cash a role pays is in its terms, set through
 * the terms editor beside this one, and the platform states it and never pays it.
 *
 * Admin is a light-only workspace by ruling (2026-09-04): fixed grays here.
 */
import { useState } from "react";
import { toast } from "sonner";
import WorkValueEditor, { draftFrom, draftToBody, usePayOptions, type WorkValueDraft } from "@/components/WorkValueEditor";
import type { TokenAmount } from "@shared/workValue";

export default function RoleValueEditor({
  role,
  call,
  onSaved,
}: {
  role: { id: string; valueMinor?: number | null; valueCurrency?: string | null; valueTokens?: TokenAmount[] | null };
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  onSaved: () => void;
}) {
  const options = usePayOptions();
  const offered = options?.role ?? null;
  const currency = role.valueCurrency || options?.currency || "";
  const [draft, setDraft] = useState<WorkValueDraft | null>(null);
  const [open, setOpen] = useState(false);
  const base = draftFrom(role, offered ?? [], currency);
  const shown = draft ?? base;
  const dirty = JSON.stringify(shown) !== JSON.stringify(base);
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  return (
    <div className="mt-3 rounded-lg border border-gray-100 px-3 py-2 text-gray-700">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-gray-600 min-h-[32px]">
        {open ? "Hide what this role is worth and pays" : "What this role is worth and pays"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <WorkValueEditor draft={shown} onChange={setDraft} offered={offered} currency={currency || null} cadence="cycle" inputClassName={inputCls} recognitionName={options?.recognition ?? null} />
          <button
            type="button"
            disabled={!dirty}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40"
            onClick={async () => {
              const body = draftToBody(shown, offered ?? [], currency, { required: false });
              if (!body.ok) {
                toast.error(body.error);
                return;
              }
              const ok = await call(`/admin/org/roles/${role.id}`, { valueMinor: body.valueMinor, valueTokens: body.valueTokens }, "PUT");
              if (ok) {
                toast.success("Saved");
                setDraft(null);
                onSaved();
              }
            }}
          >
            Save what it pays
          </button>
        </div>
      )}
    </div>
  );
}
