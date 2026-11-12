/**
 * /admin/proposals: every change an agent proposed, on one page (the lead, 11 Nov 2026).
 *
 * Grouped by batch and then by what it changes ("Lead Finance Steward card",
 * "Steward page"). Each proposal says in one sentence what it does, then shows
 * the change field by field: what is live now beside the proposed words, which
 * the person edits in place. Edits save to the server as they type, so
 * leaving and coming back keeps them. Tick some, "Accept selected" checks them
 * first (each field's problem shows on that field) and then runs each through
 * its own route as this person, in order. One that fails stays on the page
 * with its reason, ready to fix and accept again; the others land.
 *
 * Desktop: live and proposed side by side. Phone: stacked, with the accept bar
 * held at the bottom of the screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Trans, useLingui } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import { authToken } from "@/lib/gameApi";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, CHIP_SOFT, EYEBROW, FIELD, H1, HINT, LABEL, LEDE, LINK, WORLD } from "@/components/journey/look";
import { fieldLabel, valueAt } from "@shared/proposedChanges";

interface Proposal {
  id: string;
  batchId: string;
  kind: string;
  targetLabel: string;
  route: { method: string; path: string };
  summary: string;
  body: Record<string, unknown>;
  draft: Record<string, unknown> | null;
  live: unknown;
  labels: Record<string, string>;
  status: "proposed" | "failed";
  error: string | null;
  by: string;
  byKind: "agent" | "person";
  at: string;
}
interface Batch {
  id: string;
  title: string;
  by: string;
  at: string;
}
interface Decided {
  id: string;
  summary: string;
  targetLabel: string;
  status: string;
  by: string;
  at: string | null;
  edited: number;
}
interface Problem {
  error: string;
  field: string | null;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");
const isWordList = (v: unknown): v is Array<string | number | boolean | null> => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
const asText = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A copy of `value` with `path` set to `next`. */
function setAt(value: unknown, path: string[], next: unknown): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(head)] = setAt(copy[Number(head)], rest, next);
    return copy;
  }
  const o = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
  o[head] = setAt(o[head], rest, next);
  return o;
}

/** A blank row shaped like the list's first row, for "Add". */
function blankLike(v: unknown): unknown {
  if (typeof v === "string") return "";
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return [];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === "id" ? undefined : blankLike(x)]));
  return "";
}

/** Every path the editor draws a field or a group for, so a problem on one of them shows there and any other shows on top. */
function nodePaths(value: unknown, prefix = "", out: Set<string> = new Set()): Set<string> {
  if (prefix) out.add(prefix);
  if (value && typeof value === "object" && !isWordList(value)) {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) nodePaths(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const rowsFor = (s: string) => Math.min(18, Math.max(2, s.split("\n").length + Math.floor(s.length / 70)));

/** What is live now, as plain reading text. */
function LiveText({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) {
    return (
      <p className="text-sm italic text-muted-foreground">
        <Trans context="proposed changes">Nothing set yet</Trans>
      </p>
    );
  }
  if (isWordList(value)) {
    return (
      <ul className="max-w-prose list-disc space-y-1 pl-5 text-base leading-relaxed text-foreground">
        {value.map((x, i) => (
          <li key={i} className="whitespace-pre-wrap break-words">{asText(x)}</li>
        ))}
      </ul>
    );
  }
  return <p className="max-w-prose whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">{asText(value)}</p>;
}

interface FieldProps {
  path: string;
  value: unknown;
  proposed: unknown;
  live: unknown;
  labels: Record<string, string>;
  problems: Problem[];
  onChange: (path: string, next: unknown) => void;
  depth: number;
}

/** One field, or a group of fields, of a proposal's body. Never raw JSON: words are boxes, lists are rows. */
function Field({ path, value, proposed, live, labels, problems, onChange, depth }: FieldProps) {
  const { t } = useLingui();
  const label = labels[path] ?? fieldLabel(path.split(".").slice(-2).join("."));
  const mine = problems.filter((p) => p.field === path && path !== "");
  const id = `f-${path.replace(/[^A-Za-z0-9]/g, "-")}`;

  // A group: an object, or a list of objects. Its children each get their own row.
  if (value && typeof value === "object" && !isWordList(value)) {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>).filter(([k]) => k !== "id");
    return (
      <fieldset className={depth > 0 ? "space-y-4 rounded-xl border border-border/60 p-3 sm:p-4" : "space-y-5"}>
        {depth > 0 && <legend className={`${LABEL} px-1`}>{label}</legend>}
        {mine.map((p, i) => (
          <p key={i} role="alert" className="text-sm font-medium text-destructive">
            {p.error}
          </p>
        ))}
        {entries.map(([k, v]) => (
          <div key={k} className="space-y-2">
            <Field
              path={path ? `${path}.${k}` : k}
              value={v}
              proposed={valueAt(proposed, k)}
              live={valueAt(live, k)}
              labels={labels}
              problems={problems}
              onChange={onChange}
              depth={depth + 1}
            />
            {Array.isArray(value) && (
              <button type="button" className={`${BTN_SECONDARY} min-h-9`} onClick={() => onChange(path, value.filter((_, i) => String(i) !== k))}>
                <Trans context="proposed changes">Remove this one</Trans>
              </button>
            )}
          </div>
        ))}
        {Array.isArray(value) && (
          <button type="button" className={BTN_SECONDARY} onClick={() => onChange(path, [...value, blankLike(value[0] ?? "")])}>
            <Trans context="proposed changes">Add one</Trans>
          </button>
        )}
      </fieldset>
    );
  }

  const edited = JSON.stringify(value ?? null) !== JSON.stringify(proposed ?? null);
  let editor: React.ReactNode;
  if (typeof value === "boolean") {
    editor = (
      <label className="flex min-h-11 items-center gap-3 text-foreground">
        <input id={id} type="checkbox" className="size-5 accent-notice" checked={value} onChange={(e) => onChange(path, e.target.checked)} />
        {value ? <Trans context="proposed changes">On</Trans> : <Trans context="proposed changes">Off</Trans>}
      </label>
    );
  } else if (typeof value === "number") {
    editor = <input id={id} type="number" className={FIELD} value={String(value)} onChange={(e) => onChange(path, e.target.value === "" ? 0 : Number(e.target.value))} />;
  } else if (isWordList(value)) {
    editor = (
      <div className="space-y-2">
        {value.map((x, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              aria-label={t({ message: `${label}, line ${i + 1}`, context: "proposed changes" })}
              className={`${FIELD} leading-relaxed [field-sizing:content] min-h-20`}
              rows={rowsFor(asText(x))}
              value={asText(x)}
              onChange={(e) => onChange(path, value.map((y, j) => (j === i ? e.target.value : y)))}
            />
            <button
              type="button"
              className={`${BTN_SECONDARY} shrink-0`}
              aria-label={t({ message: `Remove line ${i + 1}`, context: "proposed changes" })}
              onClick={() => onChange(path, value.filter((_, j) => j !== i))}
            >
              <Trans context="proposed changes">Remove</Trans>
            </button>
          </div>
        ))}
        <button type="button" className={BTN_SECONDARY} onClick={() => onChange(path, [...value, ""])}>
          <Trans context="proposed changes">Add a line</Trans>
        </button>
      </div>
    );
  } else {
    const text = asText(value);
    editor = <textarea id={id} className={`${FIELD} leading-relaxed [field-sizing:content] min-h-20`} rows={rowsFor(text)} value={text} onChange={(e) => onChange(path, e.target.value)} />;
  }

  return (
    <div className="space-y-2" data-field={path}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={LABEL}>{label}</label>
        {edited && (
          <span className={CHIP_SOFT}>
            <Trans context="proposed changes">Edited</Trans>
          </span>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Trans context="proposed changes">Live now</Trans>
          </p>
          <LiveText value={live} />
        </div>
        <div className="rounded-xl border border-notice/60 p-3 sm:p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-notice">
            <Trans context="proposed changes">Proposed</Trans>
          </p>
          {editor}
        </div>
      </div>
      {mine.map((p, i) => (
        <p key={i} role="alert" className="text-sm font-medium text-destructive">
          {p.error}
        </p>
      ))}
    </div>
  );
}

export default function ProposedChanges() {
  const { t } = useLingui();
  const auth = useOptionalAuth();
  const signedOut = !!auth && !auth.loading && !auth.user;
  const [state, setState] = useState<"loading" | "ok" | "refused" | "failed">("loading");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [changes, setChanges] = useState<Proposal[]>([]);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, Problem[]>>({});
  const [json, setJson] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<string, "saving" | "saved" | "failed">>({});
  const [outcome, setOutcome] = useState<{ landed: string[]; failed: number } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/proposals", { headers: headers() });
      if (r.status === 401 || r.status === 403) return setState("refused");
      if (!r.ok) throw new Error("read failed");
      const d = (await r.json()) as { batches: Batch[]; changes: Proposal[]; decided: Decided[] };
      setBatches(d.batches);
      setChanges(d.changes);
      setDecided(d.decided);
      setEdits(Object.fromEntries(d.changes.map((c) => [c.id, c.draft ?? c.body])));
      setState("ok");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    if (auth?.loading || signedOut) return;
    void load();
  }, [auth?.loading, signedOut, load]);

  /** Save one proposal's edits as a draft, a moment after the last keystroke. */
  const saveDraft = useCallback((id: string, body: Record<string, unknown>) => {
    clearTimeout(timers.current[id]);
    setSaved((s) => ({ ...s, [id]: "saving" }));
    timers.current[id] = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/proposals/${encodeURIComponent(id)}/draft`, { method: "PUT", headers: headers(), body: JSON.stringify({ body }) });
        setSaved((s) => ({ ...s, [id]: r.ok ? "saved" : "failed" }));
      } catch {
        setSaved((s) => ({ ...s, [id]: "failed" }));
      }
    }, 700);
  }, []);

  const change = (id: string, path: string, next: unknown) => {
    setEdits((all) => {
      const body = setAt(all[id] ?? {}, path ? path.split(".") : [], next) as Record<string, unknown>;
      saveDraft(id, body);
      return { ...all, [id]: body };
    });
    setProblems((p) => ({ ...p, [id]: [] }));
  };

  const grouped = useMemo(
    () =>
      batches.map((b) => {
        const mine = changes.filter((c) => c.batchId === b.id);
        const targets: Array<{ label: string; items: Proposal[] }> = [];
        for (const c of mine) {
          const at = targets.find((x) => x.label === c.targetLabel);
          if (at) at.items.push(c);
          else targets.push({ label: c.targetLabel, items: [c] });
        }
        return { batch: b, items: mine, targets };
      }),
    [batches, changes],
  );

  const selected = changes.filter((c) => picked[c.id]);

  const accept = async () => {
    if (!selected.length) return;
    setBusy(true);
    setOutcome(null);
    try {
      const items = selected.map((c) => ({ id: c.id, body: edits[c.id] ?? c.body }));
      // The dry run first: each change read by its own validator. A problem shows on its own field and nothing is accepted.
      const check = await fetch("/api/admin/proposals/check", { method: "POST", headers: headers(), body: JSON.stringify({ items }) });
      const cd = (await check.json().catch(() => ({}))) as { results?: Array<{ id: string; ok: boolean; error?: string; field?: string | null }> };
      if (!check.ok) {
        setProblems({ _page: [{ error: t({ message: "The check could not run. Reload and try again.", context: "proposed changes" }), field: null }] });
        return;
      }
      const bad = (cd.results ?? []).filter((r) => !r.ok);
      if (bad.length) {
        setProblems(Object.fromEntries(bad.map((r) => [r.id, [{ error: r.error ?? "", field: r.field ?? null }]])));
        return;
      }
      const r = await fetch("/api/admin/proposals/accept", { method: "POST", headers: headers(), body: JSON.stringify({ items }) });
      const d = (await r.json().catch(() => ({}))) as { results?: Array<{ id: string; ok: boolean; error?: string; field?: string | null }> };
      const results = d.results ?? [];
      const landed = results.filter((x) => x.ok).map((x) => changes.find((c) => c.id === x.id)?.summary ?? x.id);
      const failed = results.filter((x) => !x.ok);
      setOutcome({ landed, failed: failed.length });
      setProblems(Object.fromEntries(failed.map((x) => [x.id, [{ error: x.error ?? "", field: x.field ?? null }]])));
      setPicked(Object.fromEntries(failed.map((x) => [x.id, true])));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/proposals/discard", { method: "POST", headers: headers(), body: JSON.stringify({ ids: selected.map((c) => c.id) }) });
      if (!r.ok) {
        setProblems({ _page: [{ error: t({ message: "Those could not be discarded. Reload and try again.", context: "proposed changes" }), field: null }] });
        return;
      }
      setPicked({});
      setOutcome(null);
      setProblems({});
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className={`${WORLD} pb-4 pt-8 sm:pt-12`}>
        <div className="mx-auto max-w-6xl space-y-6 px-4">
          <header className="space-y-3">
            <p className={EYEBROW}>
              <Trans context="proposed changes">Review</Trans>
            </p>
            <h1 className={H1}>
              <Trans context="proposed changes">Proposed changes</Trans>
            </h1>
            <p className={LEDE}>
              <Trans context="proposed changes">
                Nothing here is live until you accept it. Edit any proposed text in place; your edits are saved as you type. Accepting runs each change through its own page, as you.
              </Trans>
            </p>
          </header>

          {signedOut && (
            <p className={HINT}>
              <Link href="/login" className={LINK}>
                <Trans context="proposed changes">Sign in to review proposed changes</Trans>
              </Link>
            </p>
          )}
          {state === "refused" && (
            <p className={HINT} data-testid="proposals-refused">
              <Trans context="proposed changes">This page is for admins and for the people who hold the powers these changes need.</Trans>
            </p>
          )}
          {state === "failed" && (
            <p className={HINT}>
              <Trans context="proposed changes">The proposed changes could not be read. Reload to try again.</Trans>
            </p>
          )}

          {outcome && (
            <div className={`${CARD} space-y-2`} role="status" data-testid="accept-outcome">
              <p className="font-display text-xl font-bold text-card-foreground">
                {outcome.failed ? (
                  <Trans context="proposed changes">{outcome.landed.length} accepted, {outcome.failed} did not land</Trans>
                ) : (
                  <Trans context="proposed changes">{outcome.landed.length} accepted</Trans>
                )}
              </p>
              {outcome.landed.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {outcome.landed.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
              {outcome.failed > 0 && (
                <p className={HINT}>
                  <Trans context="proposed changes">The ones that did not land are still below, each with its reason. Fix them and accept again.</Trans>
                </p>
              )}
            </div>
          )}
          {(problems._page ?? []).map((p, i) => (
            <p key={i} role="alert" className="text-sm font-medium text-destructive">{p.error}</p>
          ))}

          {state === "ok" && changes.length === 0 && (
            <div className={CARD}>
              <p className={HINT}>
                <Trans context="proposed changes">Nothing is waiting. When an agent proposes a change, it appears here.</Trans>
              </p>
            </div>
          )}

          {grouped.map(({ batch, items, targets }) => {
            const all = items.length > 0 && items.every((c) => picked[c.id]);
            return (
              <section key={batch.id} className={`${CARD} space-y-6`} aria-labelledby={`batch-${batch.id}`} data-testid={`batch-${batch.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 id={`batch-${batch.id}`} className="font-display text-2xl font-bold text-card-foreground">{batch.title}</h2>
                    <p className={HINT}>
                      <Trans context="proposed changes">Proposed by {batch.by} on {day(batch.at)}</Trans>
                    </p>
                  </div>
                  <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      className="size-5 accent-notice"
                      checked={all}
                      onChange={(e) => setPicked((p) => ({ ...p, ...Object.fromEntries(items.map((c) => [c.id, e.target.checked])) }))}
                    />
                    <Trans context="proposed changes">Select all</Trans>
                  </label>
                </div>
                {targets.map((g) => (
                  <div key={g.label} className="space-y-4">
                    <h3 className="border-b border-border pb-2 font-display text-xl text-card-foreground">{g.label}</h3>
                    {g.items.map((c) => {
                      const body = edits[c.id] ?? c.body;
                      const mine = problems[c.id] ?? [];
                      const shown = nodePaths(body);
                      const loose = mine.filter((p) => !p.field || !shown.has(p.field));
                      return (
                        <article key={c.id} className="space-y-4 rounded-xl border border-border p-4 sm:p-5" data-proposal={c.id} data-testid={`proposal-${c.id}`}>
                          <div className="flex items-start gap-3">
                            <label className="-m-3 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                className="size-5 accent-notice"
                                checked={!!picked[c.id]}
                                onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))}
                                aria-label={c.summary}
                              />
                            </label>
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="max-w-prose text-lg font-semibold leading-snug text-card-foreground">{c.summary}</p>
                              <p className={HINT}>
                                {c.byKind === "agent" ? (
                                  <Trans context="proposed changes">Proposed by {c.by}'s agent</Trans>
                                ) : (
                                  <Trans context="proposed changes">Proposed by {c.by}</Trans>
                                )}
                                {saved[c.id] === "saving" && (
                                  <span>
                                    {" · "}
                                    <Trans context="proposed changes">Saving your edits</Trans>
                                  </span>
                                )}
                                {saved[c.id] === "saved" && (
                                  <span>
                                    {" · "}
                                    <Trans context="proposed changes">Edits saved</Trans>
                                  </span>
                                )}
                                {saved[c.id] === "failed" && (
                                  <span className="text-destructive">
                                    {" · "}
                                    <Trans context="proposed changes">Edits not saved</Trans>
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          {c.status === "failed" && c.error && !mine.length && (
                            <p role="alert" className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive">
                              <Trans context="proposed changes">Last try did not land: {c.error}</Trans>
                            </p>
                          )}
                          {loose.map((p, i) => (
                            <p key={i} role="alert" className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive">{p.error}</p>
                          ))}
                          {c.kind === "faq_remove" ? (
                            <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                <Trans context="proposed changes">Taken down if you accept</Trans>
                              </p>
                              <LiveText value={asText(valueAt(c.live, "question"))} />
                            </div>
                          ) : (
                            <Field path="" value={body} proposed={c.body} live={c.live} labels={c.labels} problems={mine} onChange={(p, v) => change(c.id, p, v)} depth={0} />
                          )}
                          <button type="button" className={`${LINK} inline-flex min-h-11 items-center text-sm`} onClick={() => setJson((j) => ({ ...j, [c.id]: !j[c.id] }))}>
                            {json[c.id] ? <Trans context="proposed changes">Hide JSON</Trans> : <Trans context="proposed changes">Show JSON</Trans>}
                          </button>
                          {json[c.id] && (
                            <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                              {`${c.route.method} ${c.route.path}\n${JSON.stringify(body, null, 2)}`}
                            </pre>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ))}
              </section>
            );
          })}

          {decided.length > 0 && (
            <section className="space-y-2" aria-labelledby="decided-heading">
              <h2 id="decided-heading" className="font-display text-xl text-foreground">
                <Trans context="proposed changes">Recently decided</Trans>
              </h2>
              <ul className="space-y-1">
                {decided.map((d) => (
                  <li key={d.id} className="rounded-xl border border-border/60 px-4 py-3 text-sm">
                    <span className="text-foreground">{d.summary}</span>
                    <span className="block text-muted-foreground">
                      {d.status === "accepted" ? (
                        d.edited ? (
                          <Trans context="proposed changes">Accepted by {d.by} on {day(d.at)}, edited before accepting</Trans>
                        ) : (
                          <Trans context="proposed changes">Accepted by {d.by} on {day(d.at)}</Trans>
                        )
                      ) : (
                        <Trans context="proposed changes">Discarded by {d.by} on {day(d.at)}</Trans>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {changes.length > 0 && (
          <div className="sticky bottom-[var(--tabbar-h)] z-20 mt-6 border-t border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur" data-testid="accept-bar" data-step-bar>
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <Trans context="proposed changes">{selected.length} of {changes.length} selected</Trans>
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_SECONDARY} disabled={busy || !selected.length} onClick={() => void discard()}>
                  <Trans context="proposed changes">Discard</Trans>
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={busy || !selected.length} onClick={() => void accept()} data-testid="accept-selected">
                  {busy ? <Trans context="proposed changes">Working</Trans> : <Trans context="proposed changes">Accept selected</Trans>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
