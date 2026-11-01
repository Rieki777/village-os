/**
 * Admin, Pages: every word a public page says about this village, edited in
 * the page's own order, each box with its limit and a line saying where it
 * shows.
 *
 * Built entirely from the page specs (shared/pageContent), so a field added to
 * a spec is editable here the day it exists, and the editor can never accept
 * what `PUT /api/admin/content/page-<id>` refuses: both ask the same
 * `pageDocumentProblems`.
 *
 * What is saved is ONLY what the founder changed. A box left alone keeps
 * following the platform's default, and "Reset" hands a box back to it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "../adminApi";
import { PAGE_SPECS } from "@shared/pageContent";
import {
  adoptedDocument,
  charCount,
  contentVersion,
  pageDocumentProblems,
  resolvePageRaw,
} from "@shared/pageContent/resolve";
import { pageSectionKey, type FieldSpec, type ListSpec, type PageSpec, type SectionSpec } from "@shared/pageContent/types";

type Doc = Record<string, any>;

/** The `{words}` a founder may type, and what each becomes. */
const WORDS: [string, string][] = [
  ["{village}", "your village's name"],
  ["{tagline}", "your Tagline"],
  ["{location}", "your Location"],
  ["{member}", "what a member is called"],
  ["{commitment}", "what a member signs"],
  ["{role}", "what a role is called"],
  ["{token}", "your recognition token"],
  ["{value}", "your value token"],
  ["{tokens}", "what your village calls its tokens together"],
];

function clip(text: string, max: number): string {
  return charCount(text) > max ? Array.from(text).slice(0, max).join("") : text;
}

function FieldBox({
  field,
  value,
  isDefault,
  onChange,
  onReset,
  id,
}: {
  field: FieldSpec;
  value: string;
  isDefault: boolean;
  onChange: (v: string) => void;
  onReset?: () => void;
  id: string;
}) {
  const n = charCount(value);
  const full = n >= field.max;
  const input =
    field.kind === "long" ? (
      <textarea
        id={id}
        value={value}
        rows={Math.min(6, Math.max(2, Math.ceil(field.max / 90)))}
        onChange={(e) => onChange(clip(e.target.value, field.max))}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-y"
      />
    ) : (
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(clip(e.target.value, field.max))}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
      />
    );
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {field.label}
          {field.optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
        </label>
        <span className={`text-[11px] tabular-nums ${full ? "text-amber-800 font-semibold" : "text-muted-foreground"}`} aria-live="polite">
          {n} / {field.max}
        </span>
      </div>
      {input}
      <div className="flex items-start justify-between gap-2 mt-0.5">
        {field.help ? <p className="text-[11px] text-muted-foreground">{field.help}</p> : <span />}
        {onReset && !isDefault && (
          <button type="button" onClick={onReset} className="shrink-0 inline-flex items-center gap-1 text-[11px] text-teal-deep hover:underline">
            <RotateCcw className="w-3 h-3" aria-hidden="true" /> Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

function ListEditor({
  list,
  rows,
  stored,
  onChange,
  onReset,
  idBase,
}: {
  list: ListSpec;
  rows: ReadonlyArray<Record<string, string>>;
  stored: boolean;
  onChange: (rows: Record<string, string>[]) => void;
  onReset: () => void;
  idBase: string;
}) {
  const editable = rows.map((r) => ({ ...r }));
  const setCell = (i: number, key: string, v: string) => {
    editable[i] = { ...editable[i], [key]: v };
    onChange(editable);
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= editable.length) return;
    [editable[i], editable[j]] = [editable[j], editable[i]];
    onChange(editable);
  };
  const free = !list.fixed;
  return (
    <fieldset className="border border-gray-200 rounded-lg p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">{list.label}</legend>
      {list.help && <p className="text-[11px] text-muted-foreground mb-2">{list.help}</p>}
      <div className="space-y-3">
        {editable.map((row, i) => (
          <div key={row.id ?? i} className="rounded-lg bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {list.itemLabel} {i + 1}
                {row[list.titleKey] ? `: ${row[list.titleKey]}` : ""}
              </span>
              {free && (
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={`Move ${list.itemLabel} ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label={`Move ${list.itemLabel} ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === editable.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label={`Remove ${list.itemLabel} ${i + 1}`} onClick={() => onChange(editable.filter((_, k) => k !== i))} className="p-1 rounded hover:bg-red-50 text-red-700">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
            {list.fields.map((field) => (
              <FieldBox
                key={field.key}
                id={`${idBase}-${i}-${field.key}`}
                field={field}
                value={row[field.key] ?? ""}
                isDefault
                onChange={(v) => setCell(i, field.key, v)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3">
        {free ? (
          <button
            type="button"
            onClick={() => onChange([...editable, Object.fromEntries(list.fields.map((f) => [f.key, ""]))])}
            disabled={editable.length >= list.maxItems}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-deep disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a {list.itemLabel.toLowerCase()} ({editable.length} of {list.maxItems})
          </button>
        ) : (
          <span />
        )}
        {stored && (
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-[11px] text-teal-deep hover:underline">
            <RotateCcw className="w-3 h-3" aria-hidden="true" /> Reset {list.label.toLowerCase()} to default
          </button>
        )}
      </div>
    </fieldset>
  );
}

function SectionEditor({
  spec,
  section,
  draft,
  setDraft,
}: {
  spec: PageSpec;
  section: SectionSpec;
  draft: Doc;
  setDraft: (next: Doc) => void;
}) {
  const own: Doc = draft[section.id] ?? {};
  const resolved = resolvePageRaw(spec, draft)[section.id];
  const write = (key: string, value: unknown) => {
    const nextSection: Doc = { ...own };
    if (value === undefined) delete nextSection[key];
    else nextSection[key] = value;
    const next = { ...draft };
    if (Object.keys(nextSection).length) next[section.id] = nextSection;
    else delete next[section.id];
    setDraft(next);
  };
  const idBase = `page-${spec.id}-${section.id}`;
  return (
    <section className="bg-card border border-gray-200 rounded-xl p-4 space-y-4" aria-labelledby={`${idBase}-h`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${idBase}-h`} className="text-sm font-bold text-foreground">{section.label}</h3>
          <p className="text-[11px] text-muted-foreground">{section.shows}</p>
        </div>
        {section.hideable && (
          <label className="shrink-0 max-w-full inline-flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={!resolved.hidden} onChange={(e) => write("hidden", e.target.checked ? undefined : true)} />
            Show this section
          </label>
        )}
      </header>
      {!resolved.hidden && (
        <div className="space-y-3">
          {section.fields.map((field) => {
            const storedValue = own[field.key];
            const isDefault = typeof storedValue !== "string";
            return (
              <FieldBox
                key={field.key}
                id={`${idBase}-${field.key}`}
                field={field}
                // The box shows what the founder typed, blank included, so a
                // box can be cleared and retyped. `withoutBlanks` decides at
                // save time what a blank means.
                value={isDefault ? resolved.fields[field.key] : storedValue}
                isDefault={isDefault}
                onChange={(v) => write(field.key, v)}
                onReset={() => write(field.key, undefined)}
              />
            );
          })}
          {(section.lists ?? []).map((list) => (
            <ListEditor
              key={list.key}
              idBase={`${idBase}-${list.key}`}
              list={list}
              rows={resolved.lists[list.key]}
              stored={Array.isArray(own[list.key])}
              onChange={(rows) => write(list.key, rows)}
              onReset={() => write(list.key, undefined)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Whether visitors can see this village's story pages at all (the Home page,
 * the journeys, Team, Visit and the rest in shared/brochure.ts). It took a
 * database statement and a restart until 2026-10-22; it applies on the next
 * page load now.
 */
function BrochureSwitch({ password }: { password: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/admin/brochure-pages`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.enabled === "boolean") setOn(d.enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, [password]);
  const flip = async () => {
    if (on === null) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/admin/brochure-pages`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ enabled: !on }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(d, "That did not save."));
      setOn(Boolean(d.enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
    setBusy(false);
  };
  if (on === null) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-xl p-4 bg-card">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-bold text-foreground">{on ? "Your story pages are showing" : "Your story pages are hidden"}</p>
        <p className="text-[11px] text-muted-foreground">
          {on
            ? "Visitors see your homepage, journeys, team, visit and the other pages edited here."
            : "Visitors see the simple welcome page instead, and these pages answer not found. Turn them on when their words are yours."}
        </p>
        {error && <p role="alert" className="text-[11px] text-red-700 mt-1">{error}</p>}
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        className="shrink-0 px-3 py-1.5 text-xs font-medium border border-teal-deep text-teal-deep rounded-lg hover:bg-teal-deep/5 disabled:opacity-50"
      >
        {busy ? "Saving..." : on ? "Hide them" : "Show them"}
      </button>
    </div>
  );
}

/**
 * What a blank box means, decided once, at save: a required box left blank
 * goes back to following the default, an optional one is a real "none".
 */
function withoutBlanks(spec: PageSpec, doc: Doc): Doc {
  const out: Doc = {};
  for (const section of spec.sections) {
    const own = doc[section.id];
    if (!own || typeof own !== "object") continue;
    const next: Doc = { ...own };
    for (const field of section.fields) {
      if (!field.optional && typeof next[field.key] === "string" && next[field.key].trim() === "") delete next[field.key];
    }
    if (Object.keys(next).length) out[section.id] = next;
  }
  return out;
}

export default function PagesEditor({ password }: { password: string }) {
  const [pageId, setPageId] = useState(PAGE_SPECS[0]?.id ?? "");
  const spec = useMemo(() => PAGE_SPECS.find((p) => p.id === pageId) ?? PAGE_SPECS[0], [pageId]);
  const [saved, setSaved] = useState<Doc>({});
  const [draft, setDraft] = useState<Doc>({});
  const [loading, setLoading] = useState(true);
  // Unknown is not empty: a page whose saved words could not be read must not
  // be saved over, or one failed request erases a village's own words.
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/content`, { headers: authHeaders(password) });
      if (!res.ok) throw new Error(refusal(await res.json().catch(() => ({})), `The saved words could not be read (${res.status}).`));
      const all = (await res.json()) as Doc;
      const own = all?.[pageSectionKey(spec)];
      const doc = own && typeof own === "object" && !Array.isArray(own) ? own : {};
      setSaved(doc);
      setDraft(doc);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The saved words could not be read.");
    }
    setLoading(false);
  }, [password, spec]);

  useEffect(() => {
    load();
  }, [load]);

  const problems = useMemo(() => pageDocumentProblems(spec, draft), [spec, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const put = async (raw: Doc, done: string) => {
    const doc = withoutBlanks(spec, raw);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/admin/content/${pageSectionKey(spec)}`, {
        method: "PUT",
        // The words this editor was opened on: a save over words that moved since is refused (409).
        headers: authHeaders(password, { "Content-Type": "application/json", "x-content-was": contentVersion(saved) }),
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error(refusal(await res.json().catch(() => ({})), "Save failed."));
      setSaved(doc);
      setDraft(doc);
      setMessage({ kind: "ok", text: done });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Save failed." });
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-xl font-bold text-foreground">Pages</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every word your public pages say about this village. Boxes you leave alone follow the platform's default.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={load} aria-label="Reload the saved words" className="p-2 text-muted-foreground hover:bg-muted rounded-lg">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => put(draft, "Saved. Open the page to see it.")}
            disabled={saving || loading || !!loadError || !dirty || problems.length > 0}
            className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep-dark disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" aria-hidden="true" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <BrochureSwitch password={password} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label htmlFor="pages-picker" className="text-xs font-medium text-foreground">Page</label>
        <select
          id="pages-picker"
          value={spec.id}
          onChange={(e) => setPageId(e.target.value)}
          disabled={dirty}
          title={dirty ? "Save or reload before switching pages" : undefined}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
        >
          {PAGE_SPECS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <a href={spec.path} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-teal-deep hover:underline">
          Open this page <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
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

      <details className="mb-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Words you can type in curly brackets</summary>
        <ul className="mt-2 grid sm:grid-cols-2 gap-1">
          {WORDS.map(([w, means]) => (
            <li key={w}><code className="text-foreground">{w}</code> becomes {means}</li>
          ))}
        </ul>
      </details>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-4">
          {spec.sections.map((section) => (
            <SectionEditor key={section.id} spec={spec} section={section} draft={draft} setDraft={setDraft} />
          ))}
          <div className="border border-gray-200 rounded-xl p-4 bg-muted/20">
            <h3 className="text-sm font-bold text-foreground">Keep the words you see now</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              Saves every box on this page as this village's own, including the ones still following the platform's default, so a later change to the defaults never changes your page.
            </p>
            <button
              type="button"
              onClick={() => put(adoptedDocument(spec, draft), "Every box on this page is now saved as your own.")}
              disabled={saving || loading || !!loadError || problems.length > 0}
              className="mt-2 px-3 py-1.5 text-xs font-medium border border-teal-deep text-teal-deep rounded-lg hover:bg-teal-deep/5 disabled:opacity-50"
            >
              Keep these words as ours
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
