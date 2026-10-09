import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useIsAdmin } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { writeStored } from "@/lib/safeStorage";
import { MAP_SKIN_SAVED_EVENT, MAP_SKIN_SAVED_KEY } from "@shared/mapSkin";
import {
  DEFAULT_WALK_LANG,
  WALK_GESTURES,
  WALK_WELCOME_MAX,
  walkPush,
  type MapWalk,
  type WalkGesture,
  type WalkStep,
  type WalkWelcome,
} from "@shared/mapAddress";

/**
 * The village's own welcome, and the Welcome Walk a newcomer can take.
 *
 * THE VILLAGE WRITES BOTH, OR THE MAP HAS NEITHER. Rye, 2026-10-02:
 * "Onboarding is something that founders should do and really personalize and
 * put their spirit into it." The map used to ship a seed walk and an empty
 * editor here meant the village kept it. Now an empty walk means the map
 * offers none, and an empty welcome means the guide greets people plainly.
 * The Journey to Launch asks for both, and links to this panel.
 *
 * Saving tells the map behind the panel, so the walk is offered there the
 * moment it is saved. The event is the one the map's style save already
 * sends, because what the map does with it is the same: fetch its config
 * again and apply it.
 *
 * Steps are stored PER LANGUAGE (`{ en: [...], es: [...] }`) with `en` the
 * default, so a village hosting in two languages does not have to pick which
 * newcomers get a guided arrival.
 *
 * Order is positional: the array order IS the walk order, so there is no sort
 * column to drift out of step with what the editor shows.
 *
 * Self-contained like the other panels, mounted in one line, because
 * Admin.tsx is a large file other workstreams edit.
 *
 * Takes no password prop, and gates its FETCHES on `useIsAdmin` as well as its
 * JSX, so it can be mounted on the map page without handing a member three
 * console refusals on load. The reasoning in full is in MapSkinPanel.tsx,
 * which moved for the same reason on the same day.
 */

const BLANK = (n: number): WalkStep => ({
  id: `step-${n}`,
  structure_key: "",
  title: "",
  body: "",
  gesture: "none",
});

export default function WalkEditorPanel({ focus = false }: {
  /** Bring this panel into view once it renders: the door was opened for it. */
  focus?: boolean;
} = {}) {
  const mayAdminister = useIsAdmin();
  const [walk, setWalk] = useState<MapWalk>({});
  const [welcome, setWelcome] = useState<WalkWelcome>({});
  const root = useRef<HTMLDivElement | null>(null);
  const [lang, setLang] = useState(DEFAULT_WALK_LANG);
  const [structures, setStructures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [report, setReport] = useState<any>(null);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);

  const steps = walk[lang] ?? [];

  const load = useCallback(async () => {
    if (!mayAdminister) return;
    try {
      const [w, s] = await Promise.all([
        gameFetch("/api/admin/map/walk").then((r) => (r.ok ? r.json() : null)),
        gameFetch("/api/admin/map/structures").then((r) => (r.ok ? r.json() : null)),
      ]);
      setWalk(w?.walk ?? {});
      setWelcome(w?.welcome ?? {});
      setStructures(s?.structures ?? []);
      // The report is a nice-to-have beside the editor, so it never blocks it.
      gameFetch("/api/admin/map/walk-log")
        .then((r) => (r.ok ? r.json() : null))
        .then(setReport)
        .catch(() => { /* no numbers this time */ });
    } catch { toast.error("Could not load the walk"); }
  }, [mayAdminister]);
  useEffect(() => { load(); }, [load]);

  // Asked for by address (the Journey to Launch's link): scroll here once shown.
  useEffect(() => {
    if (focus && mayAdminister) root.current?.scrollIntoView?.({ block: "start" });
  }, [focus, mayAdminister]);

  const setSteps = (next: WalkStep[]) => setWalk({ ...walk, [lang]: next });
  const patch = (i: number, p: Partial<WalkStep>) =>
    setSteps(steps.map((s, n) => (n === i ? { ...s, ...p } : s)));

  /** Positional move, used by the buttons and by a finished drag. */
  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = steps.slice();
    const [held] = next.splice(from, 1);
    next.splice(to, 0, held);
    setSteps(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await gameFetch("/api/admin/map/walk", {
        method: "PUT",
        body: JSON.stringify({ walk, welcome }),
      });
      if (!res.ok) throw new Error();
      // Read back what the server kept: it drops untitled steps and clamps
      // fields, so showing the stored answer keeps the panel honest.
      const data = await res.json();
      setWalk(data.walk ?? {});
      setWelcome(data.welcome ?? {});
      // The map behind this panel fetches its config again: this tab by the
      // event, any other open map by the storage write.
      window.dispatchEvent(new Event(MAP_SKIN_SAVED_EVENT));
      writeStored("local", MAP_SKIN_SAVED_KEY, String(Date.now()));
      toast.success("Saved. New arrivals get it from here");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  /**
   * Push the DRAFT into the preview frame without saving.
   *
   * The same `{type:'config'}` message the live shell sends, so what a
   * founder previews is produced by the same code path that will run for a
   * newcomer. Nothing is written until Save.
   */
  const pushPreview = useCallback(() => {
    const win = previewFrame.current?.contentWindow;
    if (!win) return;
    const draft = (walk[lang] ?? []).filter((s) => s.title.trim());
    win.postMessage(
      { type: "config", ...walkPush({ walk: draft, welcome: welcome[lang] ?? "" }) },
      window.location.origin,
    );
  }, [walk, welcome, lang]);

  // The artifact announces itself when it can accept a config.
  useEffect(() => {
    if (!previewing) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type === "grounds-ready") pushPreview();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewing, pushPreview]);

  const input = "w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2";
  const langs = Array.from(new Set([DEFAULT_WALK_LANG, ...Object.keys(walk)]));

  /**
   * Where the walk loses people.
   *
   * The reason walk_log exists. A completion rate on its own is a number to
   * feel bad about; the step that lost the most people is a sentence to
   * rewrite, so that is what leads.
   */
  const funnel = report && report.runs > 0 ? report : null;

  // Nothing for a member, matching the fetch gate above: every control here
  // writes, so a visible copy would only advertise a refusal.
  if (!mayAdminister) return null;

  return (
    <div ref={root} id="welcome-walk" className="bg-white border border-gray-100 rounded-2xl p-6 mt-6">
      <h3 className="font-semibold text-gray-900 mb-1">Welcome and walk</h3>
      <p className="text-xs text-gray-500 mb-4">
        The first words someone reads on the map, and the short walk the guide can take them on.
        Until you write a walk, the map offers none.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs font-medium text-gray-500" htmlFor="walk-lang">Language</label>
        <select id="walk-lang" value={lang} onChange={(e) => setLang(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button type="button"
          onClick={() => {
            const code = window.prompt("Language code, two letters (for example: es)")?.trim().toLowerCase();
            if (!code || !/^[a-z]{2}$/.test(code)) return;
            setWalk({ ...walk, [code]: walk[code] ?? [] });
            setLang(code);
          }}
          className="text-xs text-gray-500 underline underline-offset-2">add a language</button>
      </div>

      {funnel && (
        <div className="mb-5 border border-gray-200 rounded-xl p-4 bg-gray-50">
          <div className="text-sm font-medium text-gray-900 mb-1">
            {funnel.worstStep
              ? `Most people stop at "${funnel.worstStep.step}"`
              : "Nobody has left the walk partway"}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {funnel.runs} walk{funnel.runs === 1 ? "" : "s"} in the last {funnel.days} days.{" "}
            {funnel.completed} finished, {funnel.abandoned} left partway, {funnel.unfinished} still going.
          </p>
          <ul className="space-y-1">
            {funnel.steps.map((s: any) => (
              <li key={s.step} className="flex items-center gap-2 text-xs">
                <span className="w-40 truncate text-gray-700">{s.step}</span>
                {/* A bar per step, widest where the most people arrived. */}
                <span className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                  <span className="block h-2 bg-teal-deep"
                    style={{ width: `${funnel.runs ? (s.reached / funnel.runs) * 100 : 0}%` }} />
                </span>
                <span className="w-28 text-right text-gray-500">
                  {s.reached} reached{s.lost ? `, ${s.lost} left` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5">
        <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor="walk-welcome">Welcome</label>
        <textarea id="walk-welcome" rows={3} maxLength={WALK_WELCOME_MAX} value={welcome[lang] ?? ""}
          className={input} placeholder="What the guide says when someone opens the map"
          onChange={(e) => setWelcome({ ...welcome, [lang]: e.target.value })} />
        <p className="text-xs text-muted-foreground mt-1">
          Leave it empty and the guide greets people plainly, with the village's name and how to move the map.
        </p>
      </div>

      {steps.length === 0 && (
        <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg py-6 text-center mb-4">
          No stops yet. The map offers no walk until you write one.
        </p>
      )}

      <ol className="space-y-3 mb-4">
        {steps.map((s, i) => (
          <li
            key={s.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); move(Number(e.dataTransfer.getData("text/plain")), i); }}
            className="border border-gray-200 rounded-xl p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span className="text-xs font-medium text-gray-500 pt-2">Step {i + 1}</span>
              {/* Buttons as well as dragging: a drag handle alone is unusable
                  by keyboard and awkward on a phone. */}
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                  aria-label={`Move step ${i + 1} earlier`}
                  className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === steps.length - 1}
                  aria-label={`Move step ${i + 1} later`}
                  className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30">↓</button>
                <button type="button" onClick={() => setSteps(steps.filter((_, n) => n !== i))}
                  aria-label={`Delete step ${i + 1}`}
                  className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded">Delete</button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`w-title-${i}`}>Title</label>
                <input id={`w-title-${i}`} value={s.title} className={input}
                  onChange={(e) => patch(i, { title: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`w-struct-${i}`}>Where on the map</label>
                {/* A list plus a free-text fallback: the list comes from
                    structures the village has actually addressed, and a walk
                    written before the addressing is done still needs a home. */}
                <input id={`w-struct-${i}`} list="walk-structures" value={s.structure_key} className={input}
                  placeholder="greenhouse" onChange={(e) => patch(i, { structure_key: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`w-body-${i}`}>What it says</label>
                <textarea id={`w-body-${i}`} rows={2} value={s.body} className={input}
                  onChange={(e) => patch(i, { body: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`w-gest-${i}`}>Move on when they</label>
                <select id={`w-gest-${i}`} value={s.gesture} className={`${input} bg-white`}
                  onChange={(e) => patch(i, { gesture: e.target.value as WalkGesture })}>
                  {WALK_GESTURES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`w-hint-${i}`}>Nudge, if they pause</label>
                <input id={`w-hint-${i}`} value={s.gate_hint ?? ""} className={input}
                  placeholder="drag the land to look around"
                  onChange={(e) => patch(i, { gate_hint: e.target.value })} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <datalist id="walk-structures">
        {structures.map((k) => <option key={k} value={k} />)}
      </datalist>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button"
          onClick={() => setSteps([...steps, BLANK(steps.length + 1)])}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
          Add a step
        </button>
        <button type="button" onClick={() => { setPreviewing((p) => !p); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
          {previewing ? "Close preview" : "Preview on the map"}
        </button>
        {previewing && (
          <button type="button" onClick={pushPreview}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            Push my edits
          </button>
        )}
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save welcome and walk"}
        </button>
      </div>

      {previewing && (
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">
            This is your draft running on the real map. Nothing is saved until you press Save welcome and walk.
          </p>
          {/* Mounted only while previewing: the map is four megabytes, and an
              admin page has no business loading it before it is asked to. */}
          <iframe
            ref={previewFrame}
            src="/grounds/index.html"
            title="Walk preview"
            className="w-full h-[520px] rounded-xl border border-gray-200"
          />
        </div>
      )}
    </div>
  );
}
