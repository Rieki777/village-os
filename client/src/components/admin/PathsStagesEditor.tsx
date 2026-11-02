/**
 * Admin, Make it yours, Paths & Stages: this village's own words for the paths
 * a newcomer chooses when they join, and for the stages members climb.
 *
 * Every box says where its words show, counts its characters against the
 * limit, and can be handed back to the platform's word. What is saved is only
 * what the founder changed: a box left alone keeps following the default, and
 * a box cleared to blank goes back to it.
 *
 * The ids behind the paths and the stages never change here. The rules, the
 * limits and the one check the server also runs before it writes are in
 * shared/villagePaths.ts, so this editor can never accept what
 * `PUT /api/admin/village-paths` then refuses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Save } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { GAME_CONFIG } from "@shared/gameConfig";
import { charCount } from "@shared/pageContent/resolve";
import {
  LADDER_LIMITS,
  PATH_LIMITS,
  STAGE_LIMITS,
  defaultVillagePathWords,
  villagePathsProblems,
  type PathField,
  type StageField,
} from "@shared/villagePaths";

type Doc = Record<string, any>;
type Group = "paths" | "stages" | "ladder";

const DEFAULTS = defaultVillagePathWords();

const PATH_BOXES: Array<{ field: PathField; label: string; shows: string; long?: boolean }> = [
  { field: "label", label: "Name", shows: "Shows on the join form, on each member's profile, and in this path's emails." },
  { field: "role", label: "Second line", shows: "Shows under the name in the Paths part of each member's profile." },
  { field: "description", label: "Sentence", shows: "Shows under the name on the join form.", long: true },
];

const STAGE_BOXES: Array<{ field: StageField; label: string; shows: string }> = [
  { field: "name", label: "Name", shows: "Shows on the ladder, on quests and roles that ask for this stage, and when a member reaches it." },
  { field: "description", label: "Short line", shows: "Shows under the name for a member standing on this stage." },
];

function clip(text: string, max: number): string {
  return charCount(text) > max ? Array.from(text).slice(0, max).join("") : text;
}

function Box({
  id,
  label,
  shows,
  max,
  value,
  isDefault,
  long,
  onChange,
  onReset,
}: {
  id: string;
  label: string;
  shows: string;
  max: number;
  value: string;
  isDefault: boolean;
  long?: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const n = charCount(value);
  const cls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-xs font-medium text-foreground">{label}</label>
        <span className={`text-[11px] tabular-nums ${n >= max ? "text-amber-800 font-semibold" : "text-muted-foreground"}`} aria-live="polite">
          {n} / {max}
        </span>
      </div>
      {long ? (
        <textarea id={id} value={value} rows={2} onChange={(e) => onChange(clip(e.target.value, max))} className={`${cls} resize-y`} />
      ) : (
        <input id={id} type="text" value={value} onChange={(e) => onChange(clip(e.target.value, max))} className={cls} />
      )}
      <div className="flex items-start justify-between gap-2 mt-0.5">
        <p className="text-[11px] text-muted-foreground">{shows}</p>
        {!isDefault && (
          <button type="button" onClick={onReset} className="shrink-0 inline-flex items-center gap-1 text-[11px] text-teal-deep hover:underline">
            <RotateCcw className="w-3 h-3" aria-hidden="true" /> Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

export default function PathsStagesEditor({ password }: { password: string }) {
  const [saved, setSaved] = useState<Doc>({});
  const [draft, setDraft] = useState<Doc>({});
  const [loading, setLoading] = useState(true);
  // Unknown is not empty: words that could not be read must not be saved
  // over, or one failed request erases a village's own names.
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/village-paths`, { headers: authHeaders(password) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(body, `The saved words could not be read (${res.status}).`));
      const stored = body?.stored && typeof body.stored === "object" && !Array.isArray(body.stored) ? body.stored : {};
      setSaved(stored);
      setDraft(stored);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The saved words could not be read.");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  const problems = useMemo(() => villagePathsProblems(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  /** What the founder typed in one box, or undefined while it follows the default. */
  const typed = (group: Group, id: string | null, field: string): string | undefined => {
    const holder = id === null ? draft[group] : draft[group]?.[id];
    const v = holder?.[field];
    return typeof v === "string" ? v : undefined;
  };

  /** Write one box, or hand it back to the default with `undefined`. Empty groups leave the document. */
  const write = (group: Group, id: string | null, field: string, value: string | undefined) => {
    const next: Doc = { ...draft };
    const groupDoc: Doc = { ...(next[group] ?? {}) };
    const holder: Doc = id === null ? groupDoc : { ...(groupDoc[id] ?? {}) };
    if (value === undefined) delete holder[field];
    else holder[field] = value;
    if (id !== null) {
      if (Object.keys(holder).length) groupDoc[id] = holder;
      else delete groupDoc[id];
    }
    const finalGroup = id === null ? holder : groupDoc;
    if (Object.keys(finalGroup).length) next[group] = finalGroup;
    else delete next[group];
    setDraft(next);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/village-paths`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(body, `The server refused this save (${res.status}). Nothing changed.`));
      const stored = body?.stored && typeof body.stored === "object" ? body.stored : {};
      setSaved(stored);
      setDraft(stored);
      setMessage({ kind: "ok", text: "Saved. New visitors see these words on their next page load." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Save failed. Nothing changed." });
    }
    setSaving(false);
  };

  const ladderTitle = typed("ladder", null, "title");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-xl font-bold text-foreground">Paths &amp; Stages</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your words for the ways into your village and the stages of belonging. Boxes you leave alone keep the platform's words.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={load} aria-label="Reload the saved words" className="p-2 text-muted-foreground hover:bg-muted rounded-lg">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || !!loadError || !dirty || problems.length > 0}
            className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep-dark disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" aria-hidden="true" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {message && (
        <p role="status" className={`mb-4 text-sm ${message.kind === "ok" ? "text-teal-deep" : "text-red-700"}`}>{message.text}</p>
      )}
      {loadError && (
        <p role="alert" className="mb-4 text-sm text-red-700">{loadError} Saving is off until it reads, so nothing you have written gets overwritten.</p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="mb-4 text-sm text-red-700 list-disc pl-5">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <p className="mb-4 text-[11px] text-muted-foreground">
        You can type <code className="text-foreground">{"{village}"}</code> for your village's name and{" "}
        <code className="text-foreground">{"{commitment}"}</code> for what a member signs. The Home page's path cards, the menu and the
        membership letter's path choices keep their own words, in Pages.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="ps-paths-h" className="bg-card border border-gray-200 rounded-xl p-4">
            <h3 id="ps-paths-h" className="text-sm font-bold text-foreground">Paths</h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              The choices on the join form. Each path keeps its journey page and its emails, and you choose the words.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {GAME_CONFIG.paths.map((path) => {
                const shown = typed("paths", path.id, "label") ?? DEFAULTS.paths[path.id].label;
                return (
                  <fieldset key={path.id} className="rounded-lg bg-muted/30 p-3 space-y-2 min-w-0">
                    <legend className="px-1 text-xs font-semibold text-foreground break-words">
                      {shown.trim() || DEFAULTS.paths[path.id].label}
                      <span className="ml-1 font-normal text-muted-foreground">({path.route})</span>
                    </legend>
                    {PATH_BOXES.map((box) => {
                      const own = typed("paths", path.id, box.field);
                      return (
                        <Box
                          key={box.field}
                          id={`ps-path-${path.id}-${box.field}`}
                          label={box.label}
                          shows={box.shows}
                          max={PATH_LIMITS[box.field]}
                          long={box.long}
                          value={own ?? DEFAULTS.paths[path.id][box.field]}
                          isDefault={own === undefined}
                          onChange={(v) => write("paths", path.id, box.field, v)}
                          onReset={() => write("paths", path.id, box.field, undefined)}
                        />
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="ps-stages-h" className="bg-card border border-gray-200 rounded-xl p-4">
            <h3 id="ps-stages-h" className="text-sm font-bold text-foreground">Stages</h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              The ladder members climb, in order. You can rename and re-describe every stage. Their order, how each one is earned and
              what each one opens stay as they are, because quests, roles, the library, the exchange and Game Mechanics are tied to them.
            </p>
            <div className="mb-4 max-w-md">
              <Box
                id="ps-ladder-title"
                label="Name of the ladder"
                shows="Shows as the heading of the ladder on each member's profile, on the quest board, and when a member reaches a new stage."
                max={LADDER_LIMITS.title}
                value={ladderTitle ?? DEFAULTS.ladder.title}
                isDefault={ladderTitle === undefined}
                onChange={(v) => write("ladder", null, "title", v)}
                onReset={() => write("ladder", null, "title", undefined)}
              />
            </div>
            <ol className="grid gap-3 lg:grid-cols-2">
              {GAME_CONFIG.stages.map((stage, index) => {
                const shown = typed("stages", stage.id, "name") ?? DEFAULTS.stages[stage.id].name;
                return (
                  <li key={stage.id} className="rounded-lg bg-muted/30 p-3 space-y-2 min-w-0">
                    <p className="text-xs font-semibold text-foreground break-words">
                      Stage {index + 1}: {shown.trim() || DEFAULTS.stages[stage.id].name}
                    </p>
                    {STAGE_BOXES.map((box) => {
                      const own = typed("stages", stage.id, box.field);
                      return (
                        <Box
                          key={box.field}
                          id={`ps-stage-${stage.id}-${box.field}`}
                          label={box.label}
                          shows={box.shows}
                          max={STAGE_LIMITS[box.field]}
                          value={own ?? DEFAULTS.stages[stage.id][box.field]}
                          isDefault={own === undefined}
                          onChange={(v) => write("stages", stage.id, box.field, v)}
                          onReset={() => write("stages", stage.id, box.field, undefined)}
                        />
                      );
                    })}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
