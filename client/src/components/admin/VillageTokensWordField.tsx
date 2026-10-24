/**
 * THE UMBRELLA WORD: what this village calls all its tokens together.
 *
 * Rye, 2026-10-23: "Village Tokens is the umbrella word, which should be able
 * to be set in admin". His word is the platform default
 * (`GAME_CONFIG.currency.collectiveName`); a village sets its own here, on the
 * one page where tokens are named. It is stored in the brand overlay's
 * `currency` section, served as `currency.collectiveName` on the public
 * config, and pages say it as `{tokens}` (shared/pageContent/vars.ts).
 *
 * Blank means "use the default", the overlay's rule for every word it holds,
 * so the box shows the default as its placeholder and never stores it. The
 * PUT merges one section key, so nothing else in the brand document moves.
 * Light-only, like the rest of this folder.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

export default function VillageTokensWordField({ password }: { password: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [fallback, setFallback] = useState("Village Tokens");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/admin/brand`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const word = String(d.brand?.currency?.collectiveName ?? "").trim();
        setSaved(word);
        setValue(word);
        const shipped = String(d.defaults?.currency?.collectiveName ?? "").trim();
        if (shipped) setFallback(shipped);
      })
      .catch(() => { /* the box stays empty and says the default; a save still works */ });
    return () => { alive = false; };
  }, [password]);

  const changed = saved !== null && value.trim() !== saved;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/brand`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ currency: { collectiveName: value.trim().slice(0, 60) } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      const word = String(data.brand?.currency?.collectiveName ?? "").trim();
      setSaved(word);
      setValue(word);
      toast.success(`Your tokens are called ${word || fallback} together`);
    } catch (e: any) {
      toast.error(e?.message || "Could not save that");
    }
    setSaving(false);
  };

  return (
    <div className="mb-6 rounded-xl border border-border px-4 py-3">
      <label htmlFor="village-tokens-word" className="text-sm font-medium text-foreground">
        What your tokens are called together
      </label>
      <p className="text-xs text-muted-foreground mt-0.5">
        One word for every token below, used wherever a page speaks of them all at once. Pages write it as{" "}
        <code className="font-mono">{"{tokens}"}</code>. Leave it blank to keep {fallback}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          id="village-tokens-word"
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && changed) save(); }}
          placeholder={fallback}
          className="text-sm border border-border rounded-lg px-2 py-1 w-56"
        />
        <button
          type="button"
          onClick={save}
          disabled={!changed || saving}
          className="text-xs bg-teal-deep text-white rounded-lg px-2 py-1 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
