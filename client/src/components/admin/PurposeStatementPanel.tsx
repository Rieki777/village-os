/**
 * THE GOVERNING PURPOSE STATEMENT, IN THE SETUP WIZARD (0217).
 *
 * Rye, 2026-09-23: every village writes one, and "all upgrades going forward
 * will be judged against it." It blocks the Birthing, so it belongs on the
 * screen a founder is already walking down before they ask the village to
 * start.
 *
 * ── WHO MAY WRITE IT, AND WHY THIS SCREEN ASKS THE SERVER ─────────────────
 *
 * "Founder keeps the pen until they give over all steward powers to the
 * village." This panel reads `GET /api/governance/purpose`, which answers
 * `founderHoldsPen` from the same handover state the route enforces with. It
 * never works the answer out from a count of its own: a screen that decided
 * for itself would eventually disagree with the route, and the disagreement
 * would show up as a Save button that 409s.
 *
 * Once the handover is complete the box goes read-only and the panel says
 * where the pen went. Nothing here can reach past that, and nothing should.
 *
 * ── ITS OWN FILE, MOUNTED INSIDE AN EXISTING STEP ────────────────────────
 *
 * Admin.tsx is on the monolith ratchet with a few dozen lines of allowance,
 * and the admin lane is building the wider setup step around this. A file
 * they can grow or replace is a smaller thing to hand over than a block in
 * the middle of a ten-thousand-line page. It renders a panel and not a
 * numbered step, the way GoLivePackagePanel does, so `SETUP_STEPS` and the
 * wizard's progress readout are untouched by it.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { countWords, PURPOSE_MIN_WORDS } from "@shared/governingPurpose";

export default function PurposeStatementPanel({ password }: { password: string }) {
  const [statement, setStatement] = useState("");
  const [founderHoldsPen, setFounderHoldsPen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch(`${API_BASE}/admin/purpose`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setStatement(String(d.statement ?? ""));
        setFounderHoldsPen(d.founderHoldsPen !== false);
      })
      .catch(() => {});
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setNote("");
    try {
      const res = await fetch(`${API_BASE}/admin/purpose`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ statement }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(refusal(d, "The statement was not saved"));
      setNote("Saved. Every later change is judged against this.");
      load();
    } catch (e: any) {
      setNote(e?.message || "The statement was not saved");
    } finally {
      setSaving(false);
    }
  };

  const words = countWords(statement);
  return (
    <div className="bg-background text-foreground rounded-lg p-4 mb-4">
      <h4 className="text-sm font-semibold mb-1">What this village is for, in one statement</h4>
      <p className="text-xs text-gray-500 mb-3">
        The sentence every later change is judged against. Your village cannot start its Game
        without one.
      </p>
      <div>
        <p className="text-sm mb-3">
          Say who this village serves, what they are up against, the move it is making, by what
          means, and what becomes true if it works. One statement, written the way you would say
          it out loud.
        </p>
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          readOnly={!founderHoldsPen}
          rows={10}
          maxLength={20000}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
          placeholder="This village exists for the people who..."
        />
        <p className="text-xs text-gray-500 mt-2">
          {words} word{words === 1 ? "" : "s"}. It takes at least {PURPOSE_MIN_WORDS} to answer all
          five parts.
        </p>
        {founderHoldsPen ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-3 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save the statement"}
          </button>
        ) : (
          <p className="mt-3 text-sm text-gray-700">
            This village looks after all of its powers now, so the statement is the village's to
            change. Anybody who can open a proposal can take a change of purpose to the whole roll.
          </p>
        )}
        {note && <p className="text-xs text-gray-600 mt-2">{note}</p>}
      </div>
    </div>
  );
}
