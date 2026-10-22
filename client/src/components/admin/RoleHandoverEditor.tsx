/**
 * "BRING ME", "NOT MINE TO HOLD" AND THE RUNBOOK, for one role, in the admin
 * org chart, beside where its aim and domain are edited (0268).
 *
 * Rye, 2026-10-22: these live on the ROLE and change by consent through an
 * org-chart draft, the same way aim and domain do. So Save never writes the
 * role directly: it makes a one-change draft (`update_seat` carrying
 * `bringMe`, `notMine` and `runbook`), previews it, and publishes it, the path
 * `SeatTermsOfferEditor` takes. The draft list is the record of who changed
 * which words, and a published draft can be reverted. `updateOrgRole` does not
 * accept these fields at all.
 *
 * The red line under each box is the parser's own sentence
 * (shared/roleHandoverParse.ts), the one the preview and the publish refuse
 * with, so what this says and what the server says cannot drift.
 *
 * LIGHT ONLY, by ruling: the admin panel is a light workspace.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { ROLE_HANDOVER_WORDS as W, ROLE_LIST_MAX_ITEMS, RUNBOOK_MAX, handoverChecks } from "@shared/roleHandover";
import { parseRoleWordList, parseRunbook } from "@shared/roleHandoverParse";

type Call = (path: string, body?: any, method?: string) => Promise<any>;

export const HANDOVER_EDITOR_WORDS = {
  open: "Bring me, not mine to hold and runbook",
  sub: "These words belong to the role, so they stay when whoever holds it changes. A change goes through a draft, like the aim and domain.",
  save: "Save through a draft",
  saved: "Saved through a draft",
  written: (n: number, of: number) => `${n} of ${of} written`,
  draftTitle: (role: string) => `Handover words: ${role}`,
} as const;

const lines = (v: unknown): string => (Array.isArray(v) ? v.filter((s) => typeof s === "string").join("\n") : "");

/** Make, preview and publish a one-change draft. Answers whether it published. */
async function publishWords(call: Call, roleId: string, roleName: string, payload: Record<string, unknown>): Promise<boolean> {
  const made = await call("/admin/org/drafts", { title: HANDOVER_EDITOR_WORDS.draftTitle(roleName) });
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

export default function RoleHandoverEditor({
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
  const [bringMe, setBringMe] = useState(lines(role.bringMe));
  const [notMine, setNotMine] = useState(lines(role.notMine));
  const [runbook, setRunbook] = useState(typeof role.runbook === "string" ? role.runbook : "");
  const [busy, setBusy] = useState(false);

  const b = parseRoleWordList(bringMe, "bringMe");
  const n = parseRoleWordList(notMine, "notMine");
  const r = parseRunbook(runbook);
  const ok = b.ok && n.ok && r.ok;
  const dirty = bringMe !== lines(role.bringMe) || notMine !== lines(role.notMine) || runbook !== (role.runbook ?? "");
  const checks = handoverChecks(role);
  const written = [checks.bringMe, checks.notMine, checks.runbook].filter(Boolean).length;

  const save = async () => {
    if (!b.ok || !n.ok || !r.ok) return;
    setBusy(true);
    try {
      const payload = { bringMe: b.value, notMine: n.value, runbook: r.value };
      if (await publishWords(call, String(role.id), String(role.name ?? role.id), payload)) {
        toast.success(HANDOVER_EDITOR_WORDS.saved);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  const box = "w-full mt-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm";
  const field = (
    id: string,
    label: string,
    hint: string,
    value: string,
    set: (v: string) => void,
    problem: string | null,
    rows: number,
  ) => (
    <label className="text-xs text-gray-500 block" htmlFor={id}>
      {label}
      <textarea
        id={id}
        rows={rows}
        value={value}
        className={box}
        aria-label={label}
        aria-describedby={`${id}-hint`}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => set(e.target.value)}
      />
      <span id={`${id}-hint`} className="block text-[11px] text-gray-500 mt-0.5">{hint}</span>
      {problem && <span role="alert" className="block text-[11px] text-red-700 mt-0.5">{problem}</span>}
    </label>
  );

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-deep"
      >
        <span>
          {HANDOVER_EDITOR_WORDS.open}
          <span className="ml-2 text-xs font-normal text-gray-500">{HANDOVER_EDITOR_WORDS.written(written, 3)}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 grid gap-2">
          <p className="text-xs text-gray-500">{HANDOVER_EDITOR_WORDS.sub}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {field(`${role.id}-bring-me`, W.bringMe, `${W.bringMeHint} Up to ${ROLE_LIST_MAX_ITEMS}.`, bringMe, setBringMe, b.ok ? null : b.problem, 4)}
            {field(`${role.id}-not-mine`, W.notMine, `${W.notMineHint} Up to ${ROLE_LIST_MAX_ITEMS}.`, notMine, setNotMine, n.ok ? null : n.problem, 4)}
          </div>
          {field(`${role.id}-runbook`, W.runbook, `${W.runbookHint} Up to ${RUNBOOK_MAX} characters.`, runbook, setRunbook, r.ok ? null : r.problem, 3)}
          <div>
            <button
              type="button"
              disabled={busy || !ok || !dirty}
              onClick={() => void save()}
              className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
            >
              {HANDOVER_EDITOR_WORDS.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
