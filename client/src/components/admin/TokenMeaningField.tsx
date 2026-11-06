/**
 * WHAT A TOKEN MEANS, IN THE VILLAGE'S OWN WORDS (0283).
 *
 * Rye, 2026-10-23: "Village Tokens is the umbrella word, which should be able
 * to be set in admin to name each type of token and for what categories it's
 * issued and what it means." The name is the rename box beside this; the
 * categories are the token jobs above the table; this is the meaning.
 *
 * It replaces the sentence the platform used to write for each token
 * (`describeToken`, once in tokenCatalog.ts). The 2026-10-22 ruling says
 * shipped copy never says what a token does, because every community sets its
 * own rules, so the only text here is the village's, and the empty state asks
 * for it without suggesting what it should say. Members read it on their
 * wallet. Light-only, like the rest of this folder.
 */
import { useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

/** The column's width (varchar 600). The server judges it again. */
const MAX = 600;

interface MeaningToken {
  slug: string;
  name?: string;
  description?: string | null;
  isExample?: boolean;
}

export default function TokenMeaningField({
  token,
  password,
  onSaved,
}: {
  token: MeaningToken;
  password: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stored = String(token.description ?? "").trim();
  const name = token.name || token.slug;

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/tokens/${encodeURIComponent(token.slug)}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ description: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(draft.trim() ? `Saved what ${name} means` : `Cleared what ${name} means`);
      setDraft(null);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Could not save that");
    }
    setSaving(false);
  };

  if (draft !== null) {
    const length = draft.trim().length;
    return (
      <div className="mt-1 max-w-md">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}
          rows={3}
          autoFocus
          aria-label={`What ${name} means`}
          placeholder="Say in your own words what this token means here"
          className="w-full text-sm border border-border rounded-lg px-2 py-1.5"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || length > MAX}
            className="text-xs bg-teal-deep text-white rounded-lg px-2 py-1 disabled:opacity-40"
          >
            Save
          </button>
          <button type="button" onClick={() => setDraft(null)} className="text-xs text-muted-foreground">
            Cancel
          </button>
          <span className={`ml-auto text-[11px] ${length > MAX ? "text-red-600" : "text-muted-foreground"}`}>
            {length}/{MAX}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-0.5 max-w-md">
      {stored ? (
        <p className="text-xs text-muted-foreground whitespace-pre-line">{stored}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Nothing written yet about what this token means here.</p>
      )}
      {!token.isExample && (
        <button type="button" onClick={() => setDraft(stored)} className="text-xs text-teal-deep underline">
          {stored ? "edit what it means" : "write what it means"}
        </button>
      )}
    </div>
  );
}
