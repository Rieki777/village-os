/**
 * The Work With Us tab, moved out of client/src/pages/Admin.tsx.
 *
 * IT MOVED RATHER THAN BEING PATCHED IN PLACE. The one-line fix below would
 * have added a line to a file already standing exactly on its monolith-ratchet
 * baseline, so the smallest correct change to Admin.tsx was to make it
 * smaller. scripts/check-file-lines.mjs names this directory as where an admin
 * tab belongs.
 *
 * THE BUG IT CARRIED. `useGameConfig()` was called inline in the JSX below the
 * `if (!cfg) return <Loading/>` early return, so the loading render ran three
 * hooks and the loaded render ran five, and React threw "Rendered more hooks
 * than during the previous render" (minified: #310). The tab crashed to the
 * error screen every time it was opened, for every village, because the fetch
 * always resolves after the first paint. An AST sweep of all 320 non-test
 * source files under client/src found it was the only rules-of-hooks
 * violation in the client, and there is no ESLint in this repo to have caught
 * it.
 *
 * It now reads the name through `useTokenName`, the repo's canonical reader
 * for this exact value with this exact fallback, called unconditionally at the
 * top with the other hooks.
 */
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API_BASE, authHeaders } from "./adminApi";
import { useTokenName } from "@/hooks/useTokenNames";

export default function WorkWithUsTab({ password }: { password: string }) {
  const [cfg, setCfg] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  /*
   * HOISTED, and it must stay hoisted. This read used to sit inline in the
   * JSX, below `if (!cfg) return <Loading/>`, which made it a CONDITIONAL
   * hook: the loading render never reached it, the loaded render did, the
   * hook count changed between the two and React threw "Rendered more hooks
   * than during the previous render". The tab crashed to the error screen
   * every single time it was opened, because the fetch always resolves after
   * the first paint. `useGameConfig` is a hook, not a getter, however much
   * `useGameConfig()?.currency?.name` reads like one.
   *
   * `useTokenName` rather than a hoisted `useGameConfig`: it is the repo's
   * canonical reader for this exact value, carries the same "recognition"
   * fallback character for character, and additionally treats a name that is
   * only whitespace as absent, which the inline expression did not.
   */
  const recognitionName = useTokenName();

  useEffect(() => {
    fetch(`${API_BASE}/admin/work-with-us-config`, { headers: authHeaders(password) })
      .then((r) => r.json()).then(setCfg).catch(() => toast.error("Failed to load"));
  }, [password]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/work-with-us-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  if (!cfg) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  const opts = cfg.reciprocityOptions ?? [];
  const setOpt = (i: number, patch: any) =>
    setCfg({ ...cfg, reciprocityOptions: opts.map((o: any, j: number) => (j === i ? { ...o, ...patch } : o)) });
  const addOpt = () => setCfg({ ...cfg, reciprocityOptions: [...opts, { value: "", title: "", desc: "" }] });
  const removeOpt = (i: number) => setCfg({ ...cfg, reciprocityOptions: opts.filter((_: any, j: number) => j !== i) });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Work With Us</h2>
          <p className="text-sm text-gray-500 mt-1">The intro, the reciprocity (exchange) options, and your AI guide's name and greeting.</p>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="space-y-5 max-w-2xl">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Intro paragraph</label>
          <textarea value={cfg.intro ?? ""} onChange={(e) => setCfg({ ...cfg, intro: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">AI guide's name</label>
            <input type="text" value={cfg.assistantName ?? ""} onChange={(e) => setCfg({ ...cfg, assistantName: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">{recognitionName} on accepted proposal</label>
            <input type="number" min={0} value={cfg.acceptGratitude ?? 0} onChange={(e) => setCfg({ ...cfg, acceptGratitude: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Guide's opening greeting</label>
          <textarea value={cfg.assistantGreeting ?? ""} onChange={(e) => setCfg({ ...cfg, assistantGreeting: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
          <p className="text-[11px] text-gray-400 mt-0.5">Use {"{name}"} where the guide's name should appear.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Reciprocity (exchange) options</label>
            <button onClick={addOpt} className="text-xs text-teal-deep font-medium hover:underline">+ Add option</button>
          </div>
          <div className="space-y-3">
            {opts.map((o: any, i: number) => (
              <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={o.title} onChange={(e) => setOpt(i, { title: e.target.value })} placeholder="Title (shown)" className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <input type="text" value={o.value} onChange={(e) => setOpt(i, { value: e.target.value })} placeholder="Value (stored)" className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <button onClick={() => removeOpt(i)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
                <textarea value={o.desc} onChange={(e) => setOpt(i, { desc: e.target.value })} rows={2} placeholder="Description" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
