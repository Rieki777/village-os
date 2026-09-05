import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CHARACTER_CARDS, deriveTheme } from "@shared/brandTokens";

/**
 * Admin → Make This Yours → Look: the THREE decisions everything visual
 * derives from (docs/DESIGN_TOKENS_SPEC.md §3.1). A founder with no design
 * background picks a colour, a character, and writes one sentence about
 * their place — palette, radius and type pairing derive, with every colour
 * pairing WCAG-measured before it ships (shared/brandTokens.ts).
 *
 * The preview and the contrast report are computed CLIENT-SIDE from the same
 * shared derivation the server emits, so what the founder sees while
 * deciding is exactly what /api/brand/theme.css will serve — one function,
 * two callers, no drift.
 *
 * Self-contained like TypographyPanel, for the same reason: Admin.tsx is a
 * large file another workstream edits; the mount is one line.
 */
export default function LookPanel({ password }: { password: string }) {
  const [theme, setTheme] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brand", { headers: { Authorization: `Bearer ${password}` } });
      const data = await res.json();
      setTheme(data.brand?.theme ?? {});
    } catch { toast.error("Could not load the look settings"); }
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brand", {
        method: "PUT",
        headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" },
        body: JSON.stringify({ theme: { seed: theme.seed ?? "", character: theme.character ?? "", place: theme.place ?? "" } }),
      });
      if (!res.ok) throw new Error();
      toast.success("Look saved. The whole site re-themes on next load");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  if (!theme) return null;
  const derived = deriveTheme(theme.seed, theme.character);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 mt-6">
      <h3 className="font-semibold text-gray-900 mb-1">Look</h3>
      <p className="text-xs text-gray-500 mb-4">
        Three decisions; everything else derives. Leave the colour empty to keep the platform's
        neutral look. Every derived pairing is contrast-checked, so your colour keeps its hue,
        legibility is non-negotiable.
      </p>

      <div className="flex flex-wrap items-start gap-6 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1.5">Seed colour</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(theme.seed ?? "") ? theme.seed : "#6e7376" /* theme-ok: neutral colour-input default before a founder has picked a seed, never rendered as chrome */}
              onChange={(e) => setTheme({ ...theme, seed: e.target.value })}
              aria-label="Seed colour"
              className="h-9 w-12 rounded border border-gray-200 cursor-pointer"
            />
            <input
              value={theme.seed ?? ""}
              onChange={(e) => setTheme({ ...theme, seed: e.target.value })}
              placeholder="#157f7d" // theme-ok: format hint text in an empty field, never applied as a rendered colour
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 w-28 font-mono"
            />
            {theme.seed && (
              <button type="button" onClick={() => setTheme({ ...theme, seed: "" })}
                className="text-xs text-gray-400 underline underline-offset-2">clear</button>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-gray-900 mb-1.5">Your place, in one sentence</label>
          <input
            value={theme.place ?? ""}
            onChange={(e) => setTheme({ ...theme, place: e.target.value.slice(0, 160) })}
            placeholder="e.g. river valley among old oaks, temperate and misty"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Used to ground generated imagery when the design agency lands. Never shown publicly.
          </p>
        </div>
      </div>

      <label className="block text-sm font-medium text-gray-900 mb-1.5">Character</label>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-5" role="radiogroup" aria-label="Character">
        {CHARACTER_CARDS.map((c) => {
          const active = theme.character === c.id;
          // Each card previews ITSELF: its radius, its palette applied to the
          // current seed, its display face. Deciding blind is the failure mode.
          const p = deriveTheme(theme.seed || "#6e7376" /* theme-ok: same neutral default as the colour input above, feeds derivation rather than bypassing it */, c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme({ ...theme, character: active ? "" : c.id })}
              className={`text-left border px-3 py-2.5 transition-colors ${active ? "border-teal-deep ring-1 ring-teal-deep" : "border-gray-200 hover:border-gray-300"}`}
              style={{ borderRadius: `${c.radiusRem}rem`, background: p?.vars?.["--tone-cream"] }}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-4 w-4 rounded-full" style={{ background: p?.vars?.["--tone-brand"] }} />
                <span aria-hidden="true" className="inline-block h-4 w-4 rounded-full" style={{ background: p?.vars?.["--tone-sun"] }} />
                <span className="text-sm font-semibold" style={{ color: p?.vars?.["--foreground"] }}>{c.label}</span>
              </span>
              <span className="block text-xs mt-1" style={{ color: p?.vars?.["--muted-foreground"] }}>{c.hint}</span>
            </button>
          );
        })}
      </div>

      {derived && (
        <div className="mb-4 text-xs rounded-lg border border-gray-100 px-3 py-2.5">
          {/* The honest report (amendment A3): measured pairs, named verdicts,
              and "adjusted" spelled out — never a green tick it didn't earn. */}
          <p className="font-medium text-gray-900 mb-1">
            Contrast: {derived.contrast.pairs.length} pairs measured ·{" "}
            {derived.contrast.status === "ok" && <span className="text-emerald-700">all pass as-is</span>}
            {derived.contrast.status === "adjusted" && <span className="text-amber-700">passes, and your colour's lightness was adjusted to stay readable</span>}
            {derived.contrast.status === "fail" && <span className="text-red-700">FAILING. This should not happen; please report it</span>}
          </p>
          <p className="text-gray-500">
            worst ratio {derived.contrast.worstRatio}:1 ·{" "}
            {derived.contrast.pairs.map((p) => `${p.name} ${p.ratio}`).join(" · ")}
          </p>
        </div>
      )}

      <button onClick={save} disabled={saving}
        className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {saving ? "Saving..." : "Save look"}
      </button>
    </div>
  );
}
