/**
 * EVERY SETTING A MODULE READS, ON THE MODULE'S OWN CARD.
 *
 * Rye, 2026-09-15: "ALL settings dealing with modules should exist inside the
 * module card/section so that it is easy to know where they are at and make
 * the right adjustments", and earlier: the module page should hold "all the
 * settings people can tweak when setting up the modules". Setting up happens
 * BEFORE a module is switched on, which is the whole reason this section
 * renders at every lifecycle and says plainly when the module is off.
 *
 * ONE WRITE PATH, and it is the one Game Mechanics has always used:
 * `PUT /api/admin/variables/:key`. Nothing here validates a value, decides a
 * ring, or stores anything of its own. The server is the authority on all
 * three, and its refusal is shown verbatim on the dial it refused, because a
 * toast that has already faded is not an answer to "why did that not save".
 *
 * WHICH DIALS APPEAR is answered by the server too: every variable arrives
 * tagged with the modules that own it (`modulesOwning`, shared/modules.ts), so
 * this component filters and never classifies. A dial two modules own appears
 * on both cards, saying which other module moves with it.
 *
 * THE STRUCTURAL CONFIG belongs here for the same reason the dials do. A
 * module's `module_settings.config` document is a setting a founder owns
 * (forum categories, the automation channel), and several of those editors
 * already existed on other tabs with no way to reach them from the module they
 * configure. They are MOUNTED here rather than copied, so there is still one
 * editor and one write route for each.
 *
 * Light-only, by the founder's ruling on the admin workspace: the gray scale
 * here is the same fixed-light zone the rest of client/src/components/admin
 * sits in (scripts/check-tailwind-gray.mjs LIGHT_SURFACES), never a semantic
 * theme token.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { stalemateWarningFor } from "@shared/ballotSubjects";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import HyphaModulePanel, { HYPHA_PANEL_KEYS } from "@/components/admin/HyphaModulePanel";
import {
  AutomationConfigEditor,
  CrowdpoolCampaignsEditor,
  ForumCategoriesEditor,
  ResourcesRoutingEditor,
  ToolsCategoriesEditor,
} from "@/components/admin/ModuleConfigPanels";

/** A variable row as GET /api/admin/variables sends it. */
interface Dial {
  key: string;
  label: string;
  description: string;
  category: string;
  type: string;
  value: string;
  default: string;
  isDefault: boolean;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  choices?: Array<{ value: string; label: string }> | null;
  ring: "open" | "founder";
  applyTiming: "instant" | "cycle-close";
  modules: string[];
}

/**
 * The config editors that already existed, keyed by the module they configure.
 *
 * Each one writes through `PUT /api/admin/modules/:id/config` and re-reads the
 * live document before it writes, so mounting one here changes nothing about
 * how it saves.
 */
const CONFIG_PANELS: Record<string, (p: { password: string }) => ReactElement> = {
  forum: ForumCategoriesEditor,
  tools: ToolsCategoriesEditor,
  crowdpool: CrowdpoolCampaignsEditor,
  resources: ResourcesRoutingEditor,
  automation: AutomationConfigEditor,
};

/**
 * Modules whose remaining settings live on a surface of their own, with the
 * tab to send a founder to. A caution card that stamps who accepted it and
 * when is not a control to duplicate: it is shown once, in one place, and this
 * says where.
 */
const ELSEWHERE: Record<string, { tab: string; what: string }> = {
  exchange: { tab: "exchange-admin", what: "Selling tokens for fiat is opened on the Exchange screen, behind the caution card the server version-stamps." },
  library: { tab: "library-admin", what: "Selling library credits for fiat is opened on the Library screen, behind its own caution card." },
  events: { tab: "events-admin", what: "The weekly brief that goes out with the calendar is set on the Calendar screen." },
  health: { tab: "health-admin", what: "The floors each vital sign is measured against are set on the Village Health screen." },
  map: { tab: "circles-map", what: "How this village says power is held is declared on the living map itself." },
};

const inputCls =
  "border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-teal-deep";
const saveCls =
  "min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep disabled:opacity-40";
const resetCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";

export default function ModuleSettingsSection({
  moduleId,
  moduleName,
  lifecycle,
  moduleNames,
  password,
}: {
  moduleId: string;
  moduleName: string;
  /** What the module is actually being SERVED as, so "off" here is the truth. */
  lifecycle: string;
  /** Module id to name, for saying who else a shared dial moves. */
  moduleNames: Record<string, string>;
  password: string;
}) {
  const [dials, setDials] = useState<Dial[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  /** The server's own words about a refusal, kept on the dial it refused. */
  const [refused, setRefused] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/variables`, { headers: authHeaders(password) });
      if (!res.ok) { setFailed(true); setDials([]); return; }
      const data = await res.json();
      const flat: Dial[] = Array.isArray(data)
        ? data
        : (data.categories ?? []).flatMap((c: any) => c.variables ?? []);
      setFailed(false);
      setDials(flat.filter((v) => (v.modules ?? []).includes(moduleId)));
    } catch {
      setFailed(true);
      setDials([]);
    }
  }, [moduleId, password]);

  useEffect(() => { void load(); }, [load]);

  const save = async (dial: Dial, value: string) => {
    setSaving(dial.key);
    try {
      const res = await fetch(`${API_BASE}/admin/variables/${encodeURIComponent(dial.key)}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ value }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const sentence = refusal(d, "That value was refused");
        setRefused((r) => ({ ...r, [dial.key]: sentence }));
        toast.error(sentence);
        return;
      }
      setRefused((r) => { const n = { ...r }; delete n[dial.key]; return n; });
      setDrafts((p) => { const n = { ...p }; delete n[dial.key]; return n; });
      toast.success("Saved");
      await load();
    } catch {
      const sentence = "That did not reach the server, so nothing was saved.";
      setRefused((r) => ({ ...r, [dial.key]: sentence }));
      toast.error(sentence);
    } finally {
      setSaving(null);
    }
  };

  const ConfigPanel = CONFIG_PANELS[moduleId];
  const elsewhere = ELSEWHERE[moduleId];
  const off = lifecycle === "off";
  // The Hypha panel owns its own four account fields, so the generic list
  // leaves them alone. Every other module shows every dial it owns.
  const listed = (dials ?? []).filter((v) => moduleId !== "hypha" || !HYPHA_PANEL_KEYS.includes(v.key));

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <h4 className="font-semibold text-gray-900 text-sm">Settings</h4>
      <p className="text-xs text-gray-600 mt-0.5 mb-3">
        Everything {moduleName} reads, editable here. Changes are live the moment they save.
      </p>

      {off && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {moduleName} is off. You can set it up now: what you save here is kept, and it takes
          effect the moment you turn the module on.
        </p>
      )}

      {dials === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {failed && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" role="status">
              The settings could not be read, so this list may be incomplete.
            </p>
          )}
          {listed.length === 0 && !ConfigPanel && !elsewhere && !failed && (
            <p className="text-sm text-gray-500">{moduleName} has no settings of its own.</p>
          )}

          <div className="space-y-3">
            {listed.map((v) => {
              const draft = drafts[v.key] ?? v.value;
              const dirty = draft !== v.value;
              const others = (v.modules ?? []).filter((id) => id !== moduleId);
              const warning = stalemateWarningFor(v.key, draft);
              return (
                <div key={v.key} id={`module-setting-${v.key}`} className="border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-medium text-gray-900 text-sm">
                        {v.label}
                        {v.isDefault && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">platform default</span>
                        )}
                        {v.ring === "founder" && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">founder held</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5 max-w-xl">{v.description}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-mono">
                        {v.key}
                        {v.min !== undefined && v.min !== null && v.max !== undefined && v.max !== null && ` · ${v.min}-${v.max}`}
                        {v.unit ? ` ${v.unit}` : ""}
                      </p>
                      {others.length > 0 && (
                        <p className="text-[11px] text-gray-600 mt-0.5">
                          Shared with {others.map((id) => moduleNames[id] ?? id).join(", ")}. Changing it here changes it there.
                        </p>
                      )}
                      {v.applyTiming === "cycle-close" && (
                        <p className="text-[11px] text-gray-600 mt-0.5">A change here takes effect at the next cycle close.</p>
                      )}
                    </div>
                    {v.type === "boolean" ? (
                      <select
                        value={draft}
                        aria-label={v.label}
                        onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="true">on</option>
                        <option value="false">off</option>
                      </select>
                    ) : v.type === "choice" ? (
                      <select
                        value={draft}
                        aria-label={v.label}
                        onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                        className={`${inputCls} bg-white max-w-[220px]`}
                      >
                        {(v.choices ?? []).map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    ) : v.type === "longtext" ? (
                      <textarea
                        value={draft}
                        rows={6}
                        aria-label={v.label}
                        onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                        className={`${inputCls} w-full font-sans`}
                      />
                    ) : (
                      <input
                        type={v.type === "text" ? "text" : "number"}
                        step={v.type === "decimal" || v.type === "percentage" ? "0.01" : "1"}
                        value={draft}
                        aria-label={v.label}
                        onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                        className={`${inputCls} w-40`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => save(v, draft)}
                      disabled={!dirty || saving === v.key}
                      className={saveCls}
                    >
                      {saving === v.key ? "Saving…" : "Save"}
                    </button>
                    {!v.isDefault && (
                      <button
                        type="button"
                        onClick={() => save(v, v.default)}
                        title={`Back to the platform default (${v.default})`}
                        className={resetCls}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {warning && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3" role="status">
                      {warning}
                    </p>
                  )}
                  {refused[v.key] && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3" role="alert">
                      {refused[v.key]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {moduleId === "hypha" && (
            <div className="mt-4">
              <HyphaModulePanel password={password} vars={dials ?? []} onVariableSaved={load} />
            </div>
          )}

          {ConfigPanel && (
            <div className="mt-4">
              <ConfigPanel password={password} />
            </div>
          )}

          {elsewhere && (
            <p className="text-xs text-gray-600 mt-4">
              {elsewhere.what}{" "}
              <a href={`/admin?tab=${elsewhere.tab}`} className="text-teal-deep underline">
                Open it
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
