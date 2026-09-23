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
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
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
  /**
   * THIS DIAL'S DEFAULT DEPENDS ON WHERE THE VILLAGE IS, so the platform's
   * value is a starting guess. Declared in shared/gameVariables.ts and carried
   * here on the same payload.
   */
  placeDependent?: boolean;
  /**
   * HAS ANYBODY HERE SAID SO? Not the negation of `isDefault`: a village in
   * Costa Rica that confirms "north" is default AND answered, and until this
   * field existed it was indistinguishable from one that never looked.
   */
  answered?: boolean;
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
  focusKey,
  onFocused,
}: {
  moduleId: string;
  moduleName: string;
  /** What the module is actually being SERVED as, so "off" here is the truth. */
  lifecycle: string;
  /** Module id to name, for saying who else a shared dial moves. */
  moduleNames: Record<string, string>;
  password: string;
  /**
   * THE ONE DIAL A DEEP LINK CAME HERE FOR (`?setting=<key>`, or the literal
   * "config" for a module whose setup lives in its config editor). Focused
   * once the dials are really on screen, which is why this is a prop and not
   * something the URL is read for down here: the address is read once, at the
   * tab, and consumed once.
   */
  focusKey?: string | null;
  /** Called after the focus attempt, so the tab can take the key out of the URL. */
  onFocused?: () => void;
}) {
  const [dials, setDials] = useState<Dial[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  /** The server's own words about a refusal, kept on the dial it refused. */
  const [refused, setRefused] = useState<Record<string, string>>({});
  /** A deep link naming a dial this card does not hold. Said out loud. */
  const [missed, setMissed] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

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

  /**
   * LANDING, once the control a link named is really on screen.
   *
   * The card renders before its dials arrive (two fetches: the catalog, then
   * the variables), so nothing can be focused at navigation time and the
   * browser's own `#hash` jump would have fired long before. This waits for
   * the list and then moves focus to the control itself, so a keyboard user
   * can change it with the next keystroke and a screen reader announces the
   * dial, its value and why it is being asked, instead of leaving focus at
   * the top of a page that scrolled under them.
   *
   * A key that is not on this card gets an honest miss rather than silence:
   * `missed` prints a line and the heading takes focus, so a stale link says
   * so instead of looking like a page that ignored a click.
   */
  useEffect(() => {
    if (!focusKey || dials === null) return;
    const el =
      focusKey === "config"
        ? document.getElementById(`module-config-${moduleId}`)
        : // getElementById, never querySelector: a dial key has dots in it and
          // `#module-setting-calendar.hemisphere` is a valid id but a selector
          // reading "hemisphere" as a class.
          document.getElementById(`module-setting-${focusKey}`);
    if (el) {
      // `center`, so the control does not land under the sticky header, and
      // no smooth behaviour, so a reduced-motion reader is not swept along.
      //
      // Called optionally, like the card scroll in Admin.tsx: jsdom does not
      // implement scrollIntoView, and an unguarded call threw inside this
      // effect and took the focus below it with it. A page that scrolls but
      // never focuses is precisely the half-kept promise this exists to fix,
      // and only a test environment would have shown it.
      el.scrollIntoView?.({ block: "center" });
      const control = el.querySelector<HTMLElement>("input, select, textarea, button, a") ?? el;
      control.focus({ preventScroll: true });
    } else {
      setMissed(focusKey);
      headingRef.current?.focus({ preventScroll: true });
    }
    onFocused?.();
    // focusKey is the whole trigger; re-running on every draft keystroke would
    // yank focus back mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, dials === null, moduleId]);

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
      // The Go-live card and the module cards read readiness, and answering a
      // place-dependent dial is exactly what flips one. They already listen
      // for this; without it the hint a founder just satisfied would sit there
      // until the next poll or reload, which reads as a button that did
      // nothing.
      window.dispatchEvent(new Event("module:saved"));
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
  /*
   * A LIVE MODULE WITH NOTHING TO TELL A MEMBER, said out loud on the card
   * where the dial that fixes it already is.
   *
   * `redemption.process_text` is the village's own words for who to speak to
   * and how the money reaches somebody. It ships empty, and empty shows no
   * card at all, so a member who asks to cash out from a live redemption
   * module reads no instructions anywhere. Ruling 11: warn loudly, never
   * refuse. Nothing here blocks the module, the dial, or going live; a
   * village that means to run redemption by word of mouth may ignore it.
   *
   * The condition reads the SERVED value and not the draft, because a founder
   * halfway through typing has not fixed anything yet, and the warning going
   * quiet on the first keystroke would be a lie the length of a save.
   */
  const emptyProcess =
    moduleId === "redemption" &&
    !off &&
    (dials ?? []).some((v) => v.key === "redemption.process_text" && v.value.trim() === "");
  /**
   * A DIAL WHOSE DEFAULT IS A GUESS ABOUT THIS VILLAGE, AND NOBODY HAS SAID.
   *
   * `calendar.hemisphere` is the case Rye ruled on: it ships "north", which is
   * true in Costa Rica and upside down south of the equator. The value alone
   * cannot tell a village that agreed from a village that never looked, so the
   * server carries `answered` beside it, and this is where a founder is asked.
   *
   * It never blocks anything. The dial saves, the module goes live, and the
   * amber stays until somebody answers, which is the standing house rule that
   * warnings warn and do not refuse.
   */
  const needsAnswer = (v: Dial) => !!v.placeDependent && !v.answered;

  // The Hypha panel owns its own four account fields, so the generic list
  // leaves them alone. Every other module shows every dial it owns.
  const listed = (dials ?? []).filter((v) => moduleId !== "hypha" || !HYPHA_PANEL_KEYS.includes(v.key));

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      {/* tabIndex -1 so a deep link that cannot find its dial has somewhere
          honest to put focus, and the reader hears where they landed. */}
      <h4 className="font-semibold text-gray-900 text-sm" tabIndex={-1} ref={headingRef}>Settings</h4>
      <p className="text-xs text-gray-600 mt-0.5 mb-3">
        Everything {moduleName} reads, editable here. Changes are live the moment they save.
      </p>

      {missed && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3" role="status">
          That link asked for a setting this card does not hold any more. Everything {moduleName}{" "}
          reads is below.
        </p>
      )}

      {off && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {moduleName} is off. You can set it up now: what you save here is kept, and it takes
          effect the moment you turn the module on.
        </p>
      )}

      {emptyProcess && (
        <p
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3"
          role="status"
        >
          Redemption is on and "How redemption works here" is empty, so a member who asks to cash
          out is shown no instructions at all. Write it below. Nothing is blocked either way.
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
              const asking = needsAnswer(v);
              // Tied to the control rather than left floating: a note a screen
              // reader meets only if it happens to pass over it is not an
              // answer to "why am I here", and a deep link lands ON the
              // control. Not role="alert", which would re-announce on every
              // keystroke and is unreachable once announced.
              const answerNoteId = asking ? `module-setting-${v.key}-answer` : undefined;
              return (
                <div
                  key={v.key}
                  id={`module-setting-${v.key}`}
                  className={`border rounded-xl px-4 py-3 ${needsAnswer(v) ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}
                >
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
                      {asking && (
                        <p
                          id={answerNoteId}
                          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2"
                        >
                          Needs your answer. {v.value === v.default ? `It starts as "${v.default}", which is where the platform starts and not something anybody here said.` : ""} Choose
                          it, or press This is right to keep what it shows. Nothing is blocked
                          either way.
                        </p>
                      )}
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
                        aria-describedby={answerNoteId}
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
                        aria-describedby={answerNoteId}
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
                        aria-describedby={answerNoteId}
                        onChange={(e) => setDrafts((d) => ({ ...d, [v.key]: e.target.value }))}
                        className={`${inputCls} w-full font-sans`}
                      />
                    ) : (
                      <input
                        type={v.type === "text" ? "text" : "number"}
                        step={v.type === "decimal" || v.type === "percentage" ? "0.01" : "1"}
                        value={draft}
                        aria-label={v.label}
                        aria-describedby={answerNoteId}
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
                    {asking && !dirty && (
                      /*
                       * THE ONLY WAY TO AGREE WITH A DEFAULT.
                       *
                       * Save is disabled while the draft equals the value, which
                       * is right for every other dial and left this one
                       * unanswerable: a village whose honest answer is the value
                       * already showing had no control to press. This saves that
                       * same value, and the server keeps the row for a
                       * place-dependent dial, so agreeing leaves a trace at last.
                       */
                      <button
                        type="button"
                        onClick={() => save(v, draft)}
                        disabled={saving === v.key}
                        className={saveCls}
                      >
                        {saving === v.key ? "Saving…" : "This is right"}
                      </button>
                    )}
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
            // The landing target for a `config` readiness address: hypha's
            // second half is a contract confirmed in this panel, not a dial.
            <div className="mt-4" id={`module-config-${moduleId}`}>
              <HyphaModulePanel password={password} vars={dials ?? []} onVariableSaved={load} />
            </div>
          )}

          {ConfigPanel && (
            // Likewise for a module whose setup is its structural config, such
            // as crowdpool's linked campaigns.
            <div className="mt-4" id={`module-config-${moduleId}`}>
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
