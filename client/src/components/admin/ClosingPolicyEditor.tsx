/**
 * THE CLOSING SECTION OF THE EXIT POLICY, in the Departures tab.
 *
 * Rye, 2026-09-25: a village names what closing means before it launches. It
 * may choose the platform's suggested default or name another in its own
 * words, and either way the statement is always shown and always editable,
 * because the statement IS the policy. The registry and its rules are in
 * shared/closingPolicies.ts.
 *
 * ── CHOOSING THE DEFAULT IS NOT ADOPTING IT ──────────────────────────────
 *
 * Choosing a policy fills the box with its words, and a save of those words
 * is a DRAFT. The section counts only once the adopt box is ticked and saved,
 * which is when the server stamps who and when. Any change to the choice or
 * the words unticks it, so a founder who edits an adopted policy re-adopts the
 * new words on purpose and never by leaving a box ticked. The server applies
 * the same rule on its side (server/lib/closingPolicy.ts), so reaching the
 * route some other way gets the same answer.
 *
 * ITS OWN CARD AND ITS OWN SAVE, because it has its own route: the published
 * policy's "Publish policy" never writes this section and never erases it.
 *
 * Mounted from the Departures tab in client/src/pages/Admin.tsx, which sits at
 * its line ratchet, so everything lives here and that file carries one line.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { useSettingFocus } from "./settingFocus";
import {
  CLOSING_POLICIES,
  CLOSING_POLICY_IDS,
  closingNamed,
  closingStatementProblem,
  type ClosingPolicyId,
  type ClosingSectionForReaders,
} from "@shared/closingPolicies";

/** The address the launch checklist links to: `?tab=exits-admin&setting=exit.closing`. */
export const CLOSING_SETTING_KEY = "exit.closing";
const STATEMENT_ID = "closing-policy-statement";

const sameWords = (a: unknown, b: unknown) =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export default function ClosingPolicyEditor({
  password,
  closing,
  onSaved,
}: {
  password: string;
  /** The section as `GET /api/admin/exits` serves it, or absent when nothing is saved. */
  closing: ClosingSectionForReaders | null | undefined;
  onSaved: () => void;
}) {
  const stored = closing ?? null;
  const [policyId, setPolicyId] = useState<string>(stored?.policyId ?? "");
  const [statement, setStatement] = useState<string>(stored?.statement ?? "");
  const [adopt, setAdopt] = useState<boolean>(closingNamed(stored));
  const [saving, setSaving] = useState(false);

  // What the server holds is the starting point every time it changes, so a
  // save followed by the tab's reload shows the record and not the draft.
  useEffect(() => {
    setPolicyId(stored?.policyId ?? "");
    setStatement(stored?.statement ?? "");
    setAdopt(closingNamed(stored));
  }, [stored?.policyId, stored?.statement, stored?.adoptedAt]);

  useSettingFocus(CLOSING_SETTING_KEY, STATEMENT_ID, true);

  /**
   * Choose a policy. The box fills with its words when it is empty or still
   * holds another policy's default, and never over words a founder wrote.
   */
  const choose = (id: ClosingPolicyId) => {
    const holdsOnlyADefault =
      !statement.trim() ||
      CLOSING_POLICY_IDS.some((p) => CLOSING_POLICIES[p].defaultStatement && sameWords(CLOSING_POLICIES[p].defaultStatement, statement));
    setPolicyId(id);
    if (holdsOnlyADefault) setStatement(CLOSING_POLICIES[id].defaultStatement);
    setAdopt(false);
  };

  const problem = policyId || statement.trim() ? closingStatementProblem(policyId, statement) : null;
  const canAdopt = !!policyId && closingStatementProblem(policyId, statement) === null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/exit-policy/closing`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ policyId, statement, adopt: adopt && canAdopt }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(refusal(d, "What closing means was not saved"));
      toast.success(
        d?.named
          ? "Adopted. Members read it on the exit policy page, and the launch checklist counts it."
          : "Saved as a draft. It counts once the village adopts it.",
      );
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "What closing means was not saved");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h3 className="font-semibold text-gray-900 mb-1">What closing this village means</h3>
      <p className="text-xs text-gray-500 mb-4">
        If the village ever closes, its treasury and assets go somewhere. Name where before the
        village starts: the launch checklist waits for it, and every member reads it at
        /exit-policy. The platform works nothing out and moves nothing on closing. This is the
        village's written promise.
      </p>

      <fieldset className="mb-4 border-0 p-0 m-0">
        <legend className="text-xs font-medium text-gray-700 mb-2">How what is left is shared</legend>
        <div className="space-y-2">
          {CLOSING_POLICY_IDS.map((id) => (
            <label key={id} className="flex items-start gap-2 text-sm text-gray-800 min-h-[44px]">
              <input
                type="radio"
                name="closing-policy"
                value={id}
                checked={policyId === id}
                onChange={() => choose(id)}
                className="mt-1 w-5 h-5 shrink-0 focus:outline-none focus:ring-2 focus:ring-teal-deep"
              />
              <span>
                <span className="font-medium">{CLOSING_POLICIES[id].name}</span>
                <span className="block text-xs text-gray-500">{CLOSING_POLICIES[id].summary}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="text-xs text-gray-500 block mb-2" htmlFor={STATEMENT_ID}>
        <span className="font-medium text-gray-700">The village's words</span>
      </label>
      <textarea
        id={STATEMENT_ID}
        rows={5}
        maxLength={5000}
        value={statement}
        onChange={(e) => {
          setStatement(e.target.value);
          setAdopt(false);
        }}
        aria-describedby="closing-policy-hint"
        className={`${inputCls} w-full`}
      />
      <p id="closing-policy-hint" className="text-[11px] text-gray-500 mt-1 mb-3">
        Always the village's to edit. Choosing the default fills this with its words, and you may
        change them.
      </p>
      {problem && <p className="text-[11px] text-amber-900 mb-3">{problem}</p>}

      <div className={`rounded-lg border p-3 mb-3 ${canAdopt ? "border-gray-200" : "border-amber-200 bg-amber-50"}`}>
        <label className="text-xs text-gray-700 flex items-start gap-2">
          <input
            type="checkbox"
            checked={adopt && canAdopt}
            disabled={!canAdopt}
            onChange={(e) => setAdopt(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 focus:outline-none focus:ring-2 focus:ring-teal-deep"
          />
          <span>The village adopts these words as what closing means here.</span>
        </label>
        <p className="text-[11px] text-gray-500 mt-2 pl-7">
          {closingNamed(stored) && stored?.adoptedAt
            ? `Adopted on ${day(stored.adoptedAt)}. Changing the choice or the words needs adopting again.`
            : stored
              ? "Saved as a draft and not adopted yet, so the launch checklist and /exit-policy both read it as not named."
              : "Nothing saved yet. Until words are adopted, the launch checklist and /exit-policy both read it as not named."}
        </p>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || !policyId}
        className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 min-h-[44px] font-medium disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep"
      >
        {saving ? "Saving..." : "Save what closing means"}
      </button>
    </div>
  );
}
