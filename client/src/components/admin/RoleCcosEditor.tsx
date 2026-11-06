/**
 * A ROLE'S CCOS WORDS, for one role, in the admin org chart, beside the
 * handover words of 0268 (0274, Rye 2026-10-22): "This role exists while",
 * what it can decide on its own, what it does regularly, the three "Holding
 * this role well" lines and the time chip.
 *
 * They live on the ROLE and change by consent, so Save never writes the role
 * directly: it makes a one-change draft (`update_seat` carrying only the
 * words that changed), previews it, and publishes it, the path
 * `RoleHandoverEditor` and `SeatTermsOfferEditor` take. The draft list is the
 * record of who changed which words, and a published draft can be reverted.
 * The admin role routes refuse these keys outright.
 *
 * The red line under each box is the parser's own sentence
 * (shared/roleCcosParse.ts), the one the preview and the publish refuse with.
 *
 * LIGHT ONLY, by ruling: the admin panel is a light workspace.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  CCOS_LIST_MAX_ITEMS,
  ROLE_CCOS_FIELDS,
  ROLE_CCOS_TEXT_MAX,
  ROLE_CCOS_WORDS as W,
  isRoleCcosListField,
  type RoleCcosField,
} from "@shared/roleCcos";
import { parseRoleCcosField } from "@shared/roleCcosParse";

type Call = (path: string, body?: any, method?: string) => Promise<any>;

export const CCOS_EDITOR_WORDS = {
  open: "When it exists, what it decides alone, its regular work and holding it well",
  sub: "These words belong to the role, so they stay when whoever holds it changes. A change goes through a draft, like the aim and domain. A role with none of them written shows nothing extra on its card.",
  holdingWell: "Holding this role well",
  save: "Save through a draft",
  saved: "Saved through a draft",
  written: (n: number, of: number) => `${n} of ${of} written`,
  draftTitle: (role: string) => `Role words: ${role}`,
} as const;

const HINTS: Record<RoleCcosField, string> = {
  existsWhile: W.existsWhileHint,
  authorities: W.authoritiesHint,
  responsibilities: W.responsibilitiesHint,
  signsStretched: W.signsStretchedHint,
  flowsBack: W.flowsBackHint,
  stepBack: W.stepBackHint,
  timeCommitment: W.timeCommitmentHint,
};

/** What the box holds for a field, as the role carries it now. */
function asBox(role: Record<string, any>, f: RoleCcosField): string {
  const v = role[f];
  if (isRoleCcosListField(f)) return Array.isArray(v) ? v.filter((s) => typeof s === "string").join("\n") : "";
  return typeof v === "string" ? v : "";
}

/** Make, preview and publish a one-change draft. Answers whether it published. */
async function publishWords(call: Call, roleId: string, roleName: string, payload: Record<string, unknown>): Promise<boolean> {
  const made = await call("/admin/org/drafts", { title: CCOS_EDITOR_WORDS.draftTitle(roleName) });
  if (!made?.id) return false;
  const id = encodeURIComponent(String(made.id));
  const added = await call(`/admin/org/drafts/${id}/changes`, { op: "update_seat", orgRoleId: roleId, payload });
  if (!added) return false;
  const preview = await call(`/admin/org/drafts/${id}/preview`, undefined, "GET");
  const blocked = (preview?.lines ?? []).find((l: any) => l?.blocked);
  if (blocked) {
    toast.error(String(blocked.blocked));
    return false;
  }
  return !!(await call(`/admin/org/drafts/${id}/publish`, {}));
}

export default function RoleCcosEditor({
  role,
  call,
  onSaved,
}: {
  /** The role's `/api/org` row. */
  role: Record<string, any>;
  call: Call;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState<Record<RoleCcosField, string>>(
    () => Object.fromEntries(ROLE_CCOS_FIELDS.map((f) => [f, asBox(role, f)])) as Record<RoleCcosField, string>,
  );
  const [busy, setBusy] = useState(false);

  const parsed = Object.fromEntries(ROLE_CCOS_FIELDS.map((f) => [f, parseRoleCcosField(f, boxes[f])])) as Record<
    RoleCcosField,
    ReturnType<typeof parseRoleCcosField>
  >;
  const ok = ROLE_CCOS_FIELDS.every((f) => parsed[f].ok);
  const changed = ROLE_CCOS_FIELDS.filter((f) => boxes[f] !== asBox(role, f));
  const written = ROLE_CCOS_FIELDS.filter((f) => asBox(role, f).trim() !== "").length;

  const save = async () => {
    if (!ok || !changed.length) return;
    setBusy(true);
    try {
      // Only the words that changed, so the draft says exactly what moved.
      const payload = Object.fromEntries(changed.map((f) => [f, (parsed[f] as { ok: true; value: unknown }).value]));
      if (await publishWords(call, String(role.id), String(role.name ?? role.id), payload)) {
        toast.success(CCOS_EDITOR_WORDS.saved);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  const box = "w-full mt-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm";
  const field = (f: RoleCcosField, rows: number) => {
    const id = `${role.id}-ccos-${f}`;
    const r = parsed[f];
    const problem = r.ok ? null : r.problem;
    const limit = isRoleCcosListField(f) ? `Up to ${CCOS_LIST_MAX_ITEMS}.` : `Up to ${ROLE_CCOS_TEXT_MAX[f]} characters.`;
    const set = (v: string) => setBoxes((b) => ({ ...b, [f]: v }));
    return (
      <label key={f} className="text-xs text-gray-500 block min-w-0" htmlFor={id}>
        {W[f]}
        {rows === 1 ? (
          <input
            id={id}
            value={boxes[f]}
            className={`${box} min-h-[44px]`}
            aria-label={W[f]}
            aria-describedby={`${id}-hint`}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <textarea
            id={id}
            rows={rows}
            value={boxes[f]}
            className={box}
            aria-label={W[f]}
            aria-describedby={`${id}-hint`}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => set(e.target.value)}
          />
        )}
        <span id={`${id}-hint`} className="block text-[11px] text-gray-500 mt-0.5">
          {HINTS[f]} {limit}
        </span>
        {problem && (
          <span role="alert" className="block text-[11px] text-red-700 mt-0.5">
            {problem}
          </span>
        )}
      </label>
    );
  };

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-deep"
      >
        <span>
          {CCOS_EDITOR_WORDS.open}
          <span className="ml-2 text-xs font-normal text-gray-500">{CCOS_EDITOR_WORDS.written(written, ROLE_CCOS_FIELDS.length)}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 grid gap-2">
          <p className="text-xs text-gray-500">{CCOS_EDITOR_WORDS.sub}</p>
          {field("existsWhile", 1)}
          <div className="grid sm:grid-cols-2 gap-2">
            {field("authorities", 4)}
            {field("responsibilities", 4)}
          </div>
          <p className="text-xs font-semibold text-gray-700 mt-1">{CCOS_EDITOR_WORDS.holdingWell}</p>
          <div className="grid sm:grid-cols-3 gap-2">
            {field("signsStretched", 3)}
            {field("flowsBack", 3)}
            {field("stepBack", 3)}
          </div>
          {field("timeCommitment", 1)}
          <div>
            <button
              type="button"
              disabled={busy || !ok || !changed.length}
              onClick={() => void save()}
              className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
            >
              {CCOS_EDITOR_WORDS.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
