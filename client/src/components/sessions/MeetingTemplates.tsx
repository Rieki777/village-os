/**
 * THE VILLAGE'S MEETING TEMPLATES, on /sessions: every meeting the village
 * holds again and again, grouped by category in the order their keepers set.
 *
 * Everybody admitted reads them. Whoever holds `session.template` (the gate's
 * answer, `mayKeep`) also makes a new one, edits one, duplicates one, moves it
 * earlier or later in its category, and archives it or brings it back. The
 * whole flow is edited here as data: each section's kind, title, prompt and
 * minutes, in order, so a meeting's shape changes after every round of
 * feedback without anybody touching code (shared/sessionTemplates.ts).
 *
 * Every write reads `res.ok` before it claims anything, and a refusal shows
 * the server's own sentence.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  SEASON_COPY,
  SECTION_KINDS,
  SECTION_KIND_DEFS,
  TEMPLATES_API,
  TEMPLATE_COPY,
  TEMPLATE_LIMITS,
  flowMinutes,
  groupByCategory,
  templateApi,
  type SectionKind,
  type SessionTemplate,
  type TemplateSection,
  type TemplatesPayload,
} from "@shared/sessionTemplates";
import { gameFetch } from "@/lib/gameApi";
import { BTN_ICON, BTN_QUIET, CHIP, HINT, LABEL, TEXTBOX } from "./roomUi";
import { LIST_UI } from "./SessionList";

interface Draft {
  id: number | null;
  name: string;
  category: string;
  summary: string;
  circleId: string;
  durationMin: string;
  feedsFromId: string;
  flow: TemplateSection[];
}

const draftOf = (t: SessionTemplate | null): Draft => ({
  id: t?.id ?? null,
  name: t?.name ?? "",
  category: t?.category ?? "",
  summary: t?.summary ?? "",
  circleId: t?.circleId ?? "",
  durationMin: t?.durationMin == null ? "" : String(t.durationMin),
  feedsFromId: t?.feedsFromId == null ? "" : String(t.feedsFromId),
  flow: t ? t.flow.map((s) => ({ ...s })) : [{ key: "s1", kind: "round", title: "", prompt: "", minutes: 10 }],
});

async function sentence(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" && /\s/.test(body.error) ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export default function MeetingTemplates({
  payload,
  circles,
  onChanged,
}: {
  payload: TemplatesPayload;
  circles: readonly { id: string; name: string }[];
  onChanged(): Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { templates, mayKeep } = payload;
  if (!templates.length && !mayKeep) return null;

  const groups = groupByCategory(templates);
  const archived = templates.filter((t) => t.status === "archived");
  const categories = Array.from(new Set(templates.map((t) => t.category))).sort();
  const nameOf = (id: number | null) => templates.find((t) => t.id === id)?.name ?? null;
  const circleName = (id: string | null) => circles.find((c) => c.id === id)?.name ?? null;

  const send = async (url: string, method: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await gameFetch(url, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        setError(await sentence(res, TEMPLATE_COPY.saveFailed));
        return false;
      }
      await onChanged();
      return true;
    } catch {
      setError(TEMPLATE_COPY.saveFailed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const body = {
      name: draft.name,
      category: draft.category,
      summary: draft.summary,
      circleId: draft.circleId || null,
      durationMin: draft.durationMin.trim() === "" ? null : Number(draft.durationMin),
      feedsFromId: draft.feedsFromId ? Number(draft.feedsFromId) : null,
      flow: draft.flow,
    };
    const ok = draft.id == null ? await send(TEMPLATES_API, "POST", body) : await send(templateApi(draft.id), "PATCH", body);
    if (ok) setDraft(null);
  };

  const setSection = (i: number, patch: Partial<TemplateSection>) =>
    setDraft((d) => (d ? { ...d, flow: d.flow.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : d));
  const moveSection = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + by;
      if (j < 0 || j >= d.flow.length) return d;
      const flow = [...d.flow];
      [flow[i], flow[j]] = [flow[j], flow[i]];
      return { ...d, flow };
    });

  const row = (t: SessionTemplate, inGroup: SessionTemplate[]) => {
    const at = inGroup.indexOf(t);
    return (
      <li key={t.id} className="rounded-xl border border-border bg-muted px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{t.name}</p>
            {t.summary && <p className="mt-0.5 text-sm text-muted-foreground">{t.summary}</p>}
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span className={CHIP}>{TEMPLATE_COPY.flowMinutes(flowMinutes(t.flow))}</span>
              {circleName(t.circleId) && <span className={CHIP}>{circleName(t.circleId)}</span>}
              {nameOf(t.feedsFromId) && (
                <span className={CHIP}>
                  {TEMPLATE_COPY.feedsLabel}: {nameOf(t.feedsFromId)}
                </span>
              )}
            </p>
          </div>
          {mayKeep && (
            <div className="flex flex-wrap items-center gap-1">
              {t.status === "active" && (
                <>
                  <button type="button" className={BTN_ICON} aria-label={TEMPLATE_COPY.moveUp} title={TEMPLATE_COPY.moveUp} disabled={busy || at <= 0} onClick={() => void send(`${templateApi(t.id)}/move`, "POST", { direction: "up" })}>
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    aria-label={TEMPLATE_COPY.moveDown}
                    title={TEMPLATE_COPY.moveDown}
                    disabled={busy || at < 0 || at >= inGroup.length - 1}
                    onClick={() => void send(`${templateApi(t.id)}/move`, "POST", { direction: "down" })}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setDraft(draftOf(t))}>
                    {TEMPLATE_COPY.edit}
                  </button>
                  <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void send(`${templateApi(t.id)}/duplicate`, "POST", {})}>
                    {TEMPLATE_COPY.duplicate}
                  </button>
                </>
              )}
              <button
                type="button"
                className={BTN_QUIET}
                disabled={busy}
                onClick={() => void send(`${templateApi(t.id)}/archive`, "POST", { archived: t.status === "active" })}
              >
                {t.status === "active" ? TEMPLATE_COPY.archive : TEMPLATE_COPY.unarchive}
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <section aria-labelledby="meeting-templates-heading" className={LIST_UI.card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="meeting-templates-heading" className={LIST_UI.heading}>
            {TEMPLATE_COPY.manageHeading}
          </h2>
          <p className={`mt-1 ${HINT}`}>{TEMPLATE_COPY.manageLede}</p>
          <Link href="/sessions/season" className={`mt-1 ${BTN_QUIET}`}>
            {SEASON_COPY.link}
          </Link>
        </div>
        {mayKeep && !draft && (
          <button type="button" className={LIST_UI.secondary} onClick={() => setDraft(draftOf(null))}>
            {TEMPLATE_COPY.newTemplate}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {draft && (
        <form
          className="mt-4 space-y-4 rounded-xl border border-notice/50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              {TEMPLATE_COPY.nameLabel}
              <input className={LIST_UI.input} value={draft.name} maxLength={TEMPLATE_LIMITS.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className={LABEL}>
              {TEMPLATE_COPY.categoryLabel}
              <input
                className={LIST_UI.input}
                list="meeting-template-categories"
                value={draft.category}
                maxLength={TEMPLATE_LIMITS.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
              <datalist id="meeting-template-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>
          <label className={LABEL}>
            {TEMPLATE_COPY.summaryLabel}
            <textarea className={`mt-1 ${TEXTBOX}`} rows={2} value={draft.summary} maxLength={TEMPLATE_LIMITS.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={LABEL}>
              {TEMPLATE_COPY.circleLabel}
              <select className={LIST_UI.input} value={draft.circleId} onChange={(e) => setDraft({ ...draft, circleId: e.target.value })}>
                <option value="">{TEMPLATE_COPY.anyCircle}</option>
                {circles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              {TEMPLATE_COPY.durationLabel}
              <input
                className={LIST_UI.input}
                type="number"
                inputMode="numeric"
                min={TEMPLATE_LIMITS.durationMin}
                max={TEMPLATE_LIMITS.durationMax}
                placeholder={TEMPLATE_COPY.usualLength}
                value={draft.durationMin}
                onChange={(e) => setDraft({ ...draft, durationMin: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              {TEMPLATE_COPY.feedsLabel}
              <select className={LIST_UI.input} value={draft.feedsFromId} onChange={(e) => setDraft({ ...draft, feedsFromId: e.target.value })}>
                <option value="">{TEMPLATE_COPY.feedsNone}</option>
                {templates
                  .filter((t) => t.id !== draft.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className={HINT}>{TEMPLATE_COPY.feedsHint}</p>

          <fieldset className="space-y-3">
            <legend className={LABEL}>
              {TEMPLATE_COPY.sectionsHeading} <span className="font-normal text-muted-foreground tabular-nums">· {TEMPLATE_COPY.flowMinutes(flowMinutes(draft.flow))}</span>
            </legend>
            <ol className="space-y-3">
              {draft.flow.map((s, i) => (
                <li key={`${s.key}-${i}`} className="space-y-2 rounded-xl border border-border bg-muted p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6rem]">
                    <label className="text-xs font-semibold text-foreground">
                      {TEMPLATE_COPY.sectionKind}
                      <select className={LIST_UI.input} value={s.kind} onChange={(e) => setSection(i, { kind: e.target.value as SectionKind })}>
                        {SECTION_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {SECTION_KIND_DEFS[k].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-foreground">
                      {TEMPLATE_COPY.sectionTitle}
                      <input className={LIST_UI.input} value={s.title} maxLength={TEMPLATE_LIMITS.sectionTitle} onChange={(e) => setSection(i, { title: e.target.value })} />
                    </label>
                    <label className="text-xs font-semibold text-foreground">
                      {TEMPLATE_COPY.sectionMinutes}
                      <input
                        className={LIST_UI.input}
                        type="number"
                        inputMode="numeric"
                        min={TEMPLATE_LIMITS.sectionMinutesMin}
                        max={TEMPLATE_LIMITS.sectionMinutesMax}
                        value={s.minutes}
                        onChange={(e) => setSection(i, { minutes: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">{SECTION_KIND_DEFS[s.kind].hint}</p>
                  <label className="block text-xs font-semibold text-foreground">
                    {TEMPLATE_COPY.sectionPrompt}
                    <textarea className={`mt-1 ${TEXTBOX}`} rows={2} value={s.prompt} maxLength={TEMPLATE_LIMITS.prompt} onChange={(e) => setSection(i, { prompt: e.target.value })} />
                  </label>
                  <div className="flex flex-wrap items-center gap-1">
                    <button type="button" className={BTN_ICON} aria-label={TEMPLATE_COPY.moveUp} disabled={i === 0} onClick={() => moveSection(i, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" className={BTN_ICON} aria-label={TEMPLATE_COPY.moveDown} disabled={i === draft.flow.length - 1} onClick={() => moveSection(i, 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button type="button" className={BTN_QUIET} onClick={() => setDraft({ ...draft, flow: draft.flow.filter((_, k) => k !== i) })}>
                      {TEMPLATE_COPY.removeSection}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {draft.flow.length < TEMPLATE_LIMITS.sections && (
              <button
                type="button"
                className={LIST_UI.secondary}
                onClick={() => setDraft({ ...draft, flow: [...draft.flow, { key: `s${Date.now().toString(36)}`, kind: "round", title: "", prompt: "", minutes: 10 }] })}
              >
                {TEMPLATE_COPY.addSection}
              </button>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={LIST_UI.primary} disabled={busy}>
              {busy ? TEMPLATE_COPY.saving : TEMPLATE_COPY.save}
            </button>
            <button type="button" className={LIST_UI.secondary} disabled={busy} onClick={() => setDraft(null)}>
              {TEMPLATE_COPY.cancel}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <div key={g.category}>
            <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{g.category}</h3>
            <ul className="mt-2 space-y-2">{g.templates.map((t) => row(t, g.templates))}</ul>
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div className="mt-5">
          <button type="button" className={BTN_QUIET} aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {TEMPLATE_COPY.archivedHeading} ({archived.length})
          </button>
          {showArchived && <ul className="mt-2 space-y-2">{archived.map((t) => row(t, []))}</ul>}
        </div>
      )}
    </section>
  );
}
