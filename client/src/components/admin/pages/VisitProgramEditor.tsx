/**
 * Admin, Pages, Visit: the visit program, edited beside the page's own words.
 *
 * The program is its own document (`visit-config`, shared/visitProgram.ts):
 * the sentence under the headline, the ways to visit and the logistics. Until
 * 2026-10-23 its only editor could change the three cards a village started
 * with and nothing more, so a village with one way to visit, or five, could
 * not say so. Here a card can be added, removed and moved, every box has its
 * limit, and every box says where it shows and what a blank does.
 *
 * It saves on its own button, because it is a different document from the
 * page's words above it. The editor asks `visitProgramProblems`, the same
 * check `PUT /api/admin/visit-config` runs, so it never offers a save the
 * route refuses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "../adminApi";
import {
  MAX_VISIT_TYPES,
  VISIT_LOGISTICS_FIELDS,
  VISIT_SUBTITLE_FIELD,
  VISIT_TYPE_FIELDS,
  newVisitTypeId,
  normalizeVisitProgram,
  renumberVisitTypes,
  visitProgramProblems,
  type VisitField,
  type VisitProgram,
  type VisitType,
} from "@shared/visitProgram";

const chars = (s: string) => Array.from(s).length;

function Box({ id, field, value, onChange }: { id: string; field: VisitField<string>; value: string; onChange: (v: string) => void }) {
  const n = chars(value);
  const full = n >= field.max;
  const clip = (v: string) => (chars(v) > field.max ? Array.from(v).slice(0, field.max).join("") : v);
  const cls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {field.label}
          {!field.required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
        </label>
        <span className={`text-[11px] tabular-nums ${full ? "text-amber-800 font-semibold" : "text-muted-foreground"}`} aria-live="polite">
          {n} / {field.max}
        </span>
      </div>
      {field.kind === "long" ? (
        <textarea id={id} value={value} rows={Math.min(5, Math.max(2, Math.ceil(field.max / 90)))} onChange={(e) => onChange(clip(e.target.value))} className={`${cls} resize-y`} />
      ) : (
        <input id={id} type="text" value={value} onChange={(e) => onChange(clip(e.target.value))} className={cls} />
      )}
      <p className="text-[11px] text-muted-foreground mt-0.5">{field.help}</p>
    </div>
  );
}

function blankCard(taken: readonly string[]): VisitType {
  return {
    id: newVisitTypeId(taken),
    title: "",
    duration: "",
    format: "",
    cost: "",
    description: "",
    cta_label: "",
    cta_url: "",
    order: taken.length + 1,
  };
}

export default function VisitProgramEditor({
  password,
  onDirtyChange,
}: {
  password: string;
  /** Told whenever there are unsaved changes, so the page picker can wait for them. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<VisitProgram | null>(null);
  const [draft, setDraft] = useState<VisitProgram | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/visit-config`, { headers: authHeaders(password) });
      if (!res.ok) throw new Error(refusal(await res.json().catch(() => ({})), `The visit program could not be read (${res.status}).`));
      const doc = normalizeVisitProgram(await res.json());
      setSaved(doc);
      setDraft(doc);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The visit program could not be read.");
    }
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const problems = useMemo(() => (draft ? visitProgramProblems(draft) : []), [draft]);

  if (loadError) {
    return (
      <section className="border border-border rounded-xl p-4 bg-card">
        <h3 className="text-sm font-bold text-foreground">Visit Program</h3>
        <p role="alert" className="text-sm text-red-700 mt-1">{loadError} Saving is off until it reads, so nothing you have written gets overwritten.</p>
      </section>
    );
  }
  if (!draft) return <p className="text-sm text-muted-foreground">Loading the visit program...</p>;

  const types = draft.visit_types;
  const setTypes = (next: VisitType[]) => setDraft({ ...draft, visit_types: renumberVisitTypes(next) });
  const setCell = (i: number, key: keyof VisitType, v: string) => setTypes(types.map((t, k) => (k === i ? { ...t, [key]: v } : t)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= types.length) return;
    const next = [...types];
    [next[i], next[j]] = [next[j], next[i]];
    setTypes(next);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const doc = { ...draft, visit_types: renumberVisitTypes(draft.visit_types) };
    try {
      const res = await fetch(`${API_BASE}/admin/visit-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error(refusal(await res.json().catch(() => ({})), "Save failed."));
      setSaved(doc);
      setDraft(doc);
      setMessage({ kind: "ok", text: "Saved. Open the page to see it." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Save failed." });
    }
    setSaving(false);
  };

  return (
    <section className="border border-border rounded-xl p-4 bg-card space-y-4" aria-labelledby="visit-program-h">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h3 id="visit-program-h" className="text-sm font-bold text-foreground">Visit Program</h3>
          <p className="text-[11px] text-muted-foreground">
            The rest of the Visit page: the sentence under the headline, the ways to visit and the logistics. It has its own Save button.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || problems.length > 0}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 bg-teal-deep text-white rounded-lg text-xs font-medium hover:bg-teal-deep-dark disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" /> {saving ? "Saving..." : "Save the visit program"}
        </button>
      </header>

      {message && <p role="status" className={`text-sm ${message.kind === "ok" ? "text-teal-deep" : "text-red-700"}`}>{message.text}</p>}
      {problems.length > 0 && (
        <ul role="alert" className="text-sm text-red-700 list-disc pl-5">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <Box id="visit-program-subtitle" field={VISIT_SUBTITLE_FIELD} value={draft.hero_subtitle} onChange={(v) => setDraft({ ...draft, hero_subtitle: v })} />

      <fieldset className="border border-border rounded-lg p-3">
        <legend className="px-1 text-xs font-semibold text-foreground">Ways to visit</legend>
        <p className="text-[11px] text-muted-foreground mb-2">One card each under "Pick a way to visit", in this order. Each one is also a choice in the visit form.</p>
        {types.length === 0 && <p className="text-[11px] text-muted-foreground mb-2">No ways to visit yet. The page keeps its visit form, so people can still write.</p>}
        <div className="space-y-3">
          {types.map((t, i) => (
            <div key={t.id} className="rounded-lg bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Way to visit {i + 1}
                  {t.title ? `: ${t.title}` : ""}
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={`Move way to visit ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label={`Move way to visit ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === types.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label={`Remove way to visit ${i + 1}`} onClick={() => setTypes(types.filter((_, k) => k !== i))} className="p-1 rounded hover:bg-red-50 text-red-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
              {VISIT_TYPE_FIELDS.map((field) => (
                <Box key={field.key} id={`visit-type-${t.id}-${field.key}`} field={field} value={t[field.key]} onChange={(v) => setCell(i, field.key, v)} />
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTypes([...types, blankCard(types.map((t) => t.id))])}
          disabled={types.length >= MAX_VISIT_TYPES}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-teal-deep disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a way to visit ({types.length} of {MAX_VISIT_TYPES})
        </button>
      </fieldset>

      <fieldset className="border border-border rounded-lg p-3 space-y-3">
        <legend className="px-1 text-xs font-semibold text-foreground">Logistics</legend>
        {VISIT_LOGISTICS_FIELDS.map((field) => (
          <Box
            key={field.key}
            id={`visit-logistics-${field.key}`}
            field={field}
            value={draft.logistics[field.key]}
            onChange={(v) => setDraft({ ...draft, logistics: { ...draft.logistics, [field.key]: v } })}
          />
        ))}
      </fieldset>
    </section>
  );
}
