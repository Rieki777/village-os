/**
 * THE VILLAGE'S OWN ONBOARDING PATH, in the Org chart tab (Admin, Onboarding path).
 *
 * The path a new holder gets opens from this document: the village's phases and
 * steps, each circle's defaults, and which role holds each owner key
 * (onboarding, access, memory, appointer). A path already opened keeps the
 * steps it was opened with; a step's link is looked up live, so a mended
 * address reaches paths already open.
 *
 * TWO WAYS TO EDIT ONE DOCUMENT (Phase B, 11 Nov 2026). The form writes the
 * phases, steps, owners, check-in days and the switch, field by field, so a
 * steward never has to read JSON to move a step to day 3. The whole document
 * stays one disclosure away for what the form does not draw (each circle's own
 * steps) and for pasting a village's seed. Both edit the same text, so the
 * floating save bar counts one set of changes, and saving checks every row on
 * the server and names the one that is wrong.
 *
 * The switch is OFF until a founder ticks it and saves: onboarding needs the
 * circle's consent. Its own file because OrgChartTab carries one line for it.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import SaveBar, { type SaveResult } from "@/components/SaveBar";
import { docChangeCount } from "@/lib/unsavedChanges";
// Types only: a value import of shared/onboardingPath here makes it a chunk two
// lazy pages share, and that regroups the first page's chunks (guard-boot-set).
import type { OwnerKey } from "@shared/onboardingPath";

const WORDS = {
  heading: "Onboarding path",
  intro:
    "The path every newly seated holder sees on their profile: the first fourteen days as a strip of days, then any later phases as a list. Each step has a title, who it waits on, the day it is due (day 1 is the day the role starts), when it is done and, if you like, a link: a page of this site such as /training/steward, or an https address. Paths already opened keep the steps they opened with.",
  on: "Switched on: new holders get this path. Tick only once the circle has consented.",
  title: "Title on the profile",
  owners: "Who holds each part",
  ownersHint: "The name of the role, exactly as it reads on the org chart. Its holders tick the steps that wait on it.",
  checkins: "Check-in days",
  checkinsHint: "Days the holder files a short check-in, separated by commas (for example 14).",
  phases: "Phases and steps",
  phase: (n: number) => `Phase ${n}`,
  phaseName: "Name",
  fromDay: "From day",
  toDay: "To day",
  step: (n: number) => `Step ${n}`,
  stepTitle: "Title",
  owner: "Waits on",
  dueDay: "Due by day",
  doneWhen: "Done when",
  linkLabel: "Link words (optional)",
  linkHref: "Link address (optional)",
  addStep: "Add a step",
  addPhase: "Add a phase",
  removeStep: (n: number) => `Remove step ${n}`,
  removePhase: (n: number) => `Remove phase ${n}`,
  noPhases: "No phases yet, so new holders get the platform's three neutral steps. Add a phase to write your own.",
  json: "The whole document (JSON), for each circle's own steps or to paste a seed",
  label: "Onboarding path document (JSON)",
  badJsonForm: "The document below is not valid JSON, so the form is paused until it reads again.",
  notSaved: "The onboarding path did not save.",
  badJson: "That is not valid JSON.",
  failed: "The onboarding path did not load.",
  ownerNames: {
    holder: "The new holder",
    buddy: "Their buddy",
    onboarding: "Onboarding",
    access: "Access",
    memory: "Memory",
    appointer: "Appointer",
  } satisfies Record<OwnerKey, string>,
} as const;

/** Every owner key, in the platform's order; `ownerNames` above is keyed by the union, so the compiler holds this list whole. */
const OWNER_KEYS = Object.keys(WORDS.ownerNames) as OwnerKey[];
/** The owner keys that name a role (holder and buddy are people). */
export const ROLE_OWNER_KEYS = OWNER_KEYS.filter((k) => k !== "holder" && k !== "buddy");

type Doc = Record<string, unknown>;
type Step = { key?: string; kind?: string; title?: string; owner?: string; dueDay?: number; doneWhen?: string; link?: { label?: string; href?: string } };
type PhaseRow = { key?: string; name?: string; fromDay?: number; toDay?: number; items?: Step[] };

const asPhases = (d: Doc | null): PhaseRow[] => (Array.isArray(d?.phases) ? (d!.phases as PhaseRow[]) : []);
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Math.trunc(Number(v)));

/** The check-in days typed as "7, 14" become [7, 14]; anything that is not a whole day is dropped. */
export function readDays(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((x) => Math.trunc(Number(x)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 365);
}

/** A step's link from its two fields: both empty means no link at all. */
export function linkFrom(label: string, href: string): { label: string; href: string } | undefined {
  return label.trim() === "" && href.trim() === "" ? undefined : { label, href };
}

// A JSON document in a text box reads in a fixed-width face.
const JSON_BOX = "mt-1 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground"; // design-ok: JSON document box
const FIELD = "mt-1 w-full min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const LABEL = "block text-sm font-medium text-card-foreground";
const SMALL_BTN = "inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted";

export default function OnboardingPathEditor({ password }: { password: string }) {
  const [text, setText] = useState("");
  // What the server holds, so the floating save bar knows when this differs.
  const [savedText, setSavedText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [, setBusy] = useState(false);
  const parsed = (() => {
    try {
      const d = JSON.parse(text);
      return d && typeof d === "object" && !Array.isArray(d) ? (d as Doc) : null;
    } catch {
      return null;
    }
  })();
  /** One field changed: the form writes the whole document back to the one text both editors share. */
  const write = (next: Doc) => setText(JSON.stringify(next, null, 2));
  const phases = asPhases(parsed);
  const setPhases = (next: PhaseRow[]) => parsed && write({ ...parsed, phases: next });
  const setPhase = (i: number, patch: Partial<PhaseRow>) => setPhases(phases.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const setStep = (i: number, j: number, patch: Partial<Step>) =>
    setPhase(i, { items: (phases[i].items ?? []).map((s, k) => (k === j ? { ...s, ...patch } : s)) });
  const owners = (parsed?.owners && typeof parsed.owners === "object" ? parsed.owners : {}) as Record<string, string>;
  const [checkinText, setCheckinText] = useState<string | null>(null);
  const checkinShown = checkinText ?? (Array.isArray(parsed?.checkins) ? (parsed!.checkins as number[]).join(", ") : "");

  useEffect(() => {
    let live = true;
    void fetch(`${API_BASE}/admin/onboarding-path`, { headers: authHeaders(password) })
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) {
          setText(JSON.stringify(out.doc ?? {}, null, 2));
          setSavedText(JSON.stringify(out.doc ?? {}, null, 2));
          setLoaded(true);
        } else toast.error(refusal(out, WORDS.failed));
      })
      .catch(() => live && toast.error(WORDS.failed));
    return () => {
      live = false;
    };
  }, [password]);

  async function save(): Promise<SaveResult> {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, reason: WORDS.badJson };
    }
    setBusy(true);
    const res = await fetch(`${API_BASE}/admin/onboarding-path`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ doc }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      const now = JSON.stringify(out.doc ?? doc, null, 2);
      setText(now);
      setSavedText(now);
      setCheckinText(null);
      return { ok: true };
    }
    return { ok: false, reason: refusal(out, WORDS.notSaved) };
  }

  const form = loaded && parsed;
  return (
    <section aria-labelledby="onb-editor-h" data-onboarding-editor="" className="rounded-xl border border-border bg-card p-4">
      <h3 id="onb-editor-h" className="font-semibold text-card-foreground">{WORDS.heading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{WORDS.intro}</p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-card-foreground">
        <input
          type="checkbox"
          checked={parsed?.enabled === true}
          disabled={!form}
          onChange={(e) => parsed && write({ ...parsed, enabled: e.target.checked })}
          className="h-5 w-5"
        />
        {WORDS.on}
      </label>
      {loaded && !parsed ? (
        <p role="status" className="mt-2 text-sm text-destructive">{WORDS.badJsonForm}</p>
      ) : null}

      {form ? (
        <div className="mt-3 flex flex-col gap-4">
          <label className={LABEL}>
            {WORDS.title}
            <input className={FIELD} value={typeof parsed.title === "string" ? parsed.title : ""} maxLength={80} onChange={(e) => write({ ...parsed, title: e.target.value })} />
          </label>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-card-foreground">{WORDS.owners}</legend>
            <p className="text-xs text-muted-foreground">{WORDS.ownersHint}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {ROLE_OWNER_KEYS.map((k) => (
                <label key={k} className={LABEL}>
                  {WORDS.ownerNames[k]}
                  <input
                    className={FIELD}
                    value={owners[k] ?? ""}
                    maxLength={120}
                    data-owner={k}
                    onChange={(e) => write({ ...parsed, owners: { ...owners, [k]: e.target.value } })}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label className={LABEL}>
            {WORDS.checkins}
            <input
              className={FIELD}
              value={checkinShown}
              inputMode="numeric"
              onChange={(e) => {
                setCheckinText(e.target.value);
                write({ ...parsed, checkins: readDays(e.target.value) });
              }}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{WORDS.checkinsHint}</span>
          </label>

          <div>
            <p className="text-sm font-semibold text-card-foreground">{WORDS.phases}</p>
            {phases.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">{WORDS.noPhases}</p> : null}
            <ol className="mt-2 flex flex-col gap-4">
              {phases.map((ph, i) => (
                <li key={i} data-phase-row={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <p className="w-full text-sm font-semibold text-card-foreground">{WORDS.phase(i + 1)}</p>
                    <label className={`${LABEL} min-w-0 flex-[2_1_14rem]`}>
                      {WORDS.phaseName}
                      <input className={FIELD} value={ph.name ?? ""} maxLength={80} onChange={(e) => setPhase(i, { name: e.target.value })} />
                    </label>
                    <label className={`${LABEL} w-24`}>
                      {WORDS.fromDay}
                      <input className={FIELD} type="number" min={1} max={365} value={ph.fromDay ?? ""} onChange={(e) => setPhase(i, { fromDay: num(e.target.value) })} />
                    </label>
                    <label className={`${LABEL} w-24`}>
                      {WORDS.toDay}
                      <input className={FIELD} type="number" min={1} max={365} value={ph.toDay ?? ""} onChange={(e) => setPhase(i, { toDay: num(e.target.value) })} />
                    </label>
                    <button type="button" className={SMALL_BTN} onClick={() => setPhases(phases.filter((_, k) => k !== i))}>
                      {WORDS.removePhase(i + 1)}
                    </button>
                  </div>
                  <ol className="mt-3 flex flex-col gap-3">
                    {(ph.items ?? []).map((st, j) => (
                      <li key={j} data-step-row={`${i}-${j}`} className="rounded-lg bg-muted p-3">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{WORDS.step(j + 1)}</p>
                        <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem]">
                          <label className={LABEL}>
                            {WORDS.stepTitle}
                            <input className={FIELD} value={st.title ?? ""} maxLength={160} onChange={(e) => setStep(i, j, { title: e.target.value })} />
                          </label>
                          <label className={LABEL}>
                            {WORDS.owner}
                            <select className={FIELD} value={OWNER_KEYS.includes(st.owner as OwnerKey) ? st.owner : "holder"} onChange={(e) => setStep(i, j, { owner: e.target.value })}>
                              {OWNER_KEYS.map((k) => (
                                <option key={k} value={k}>
                                  {k === "holder" || k === "buddy" ? WORDS.ownerNames[k] : owners[k] || WORDS.ownerNames[k]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={LABEL}>
                            {WORDS.dueDay}
                            <input className={FIELD} type="number" min={1} max={365} value={st.dueDay ?? ""} onChange={(e) => setStep(i, j, { dueDay: num(e.target.value) })} />
                          </label>
                        </div>
                        <label className={`${LABEL} mt-2`}>
                          {WORDS.doneWhen}
                          <input className={FIELD} value={st.doneWhen ?? ""} maxLength={200} onChange={(e) => setStep(i, j, { doneWhen: e.target.value })} />
                        </label>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <label className={LABEL}>
                            {WORDS.linkLabel}
                            <input className={FIELD} value={st.link?.label ?? ""} maxLength={60} onChange={(e) => setStep(i, j, { link: linkFrom(e.target.value, st.link?.href ?? "") })} />
                          </label>
                          <label className={LABEL}>
                            {WORDS.linkHref}
                            <input className={FIELD} value={st.link?.href ?? ""} maxLength={500} onChange={(e) => setStep(i, j, { link: linkFrom(st.link?.label ?? "", e.target.value) })} />
                          </label>
                        </div>
                        <button
                          type="button"
                          className={`${SMALL_BTN} mt-2`}
                          onClick={() => setPhase(i, { items: (ph.items ?? []).filter((_, k) => k !== j) })}
                        >
                          {WORDS.removeStep(j + 1)}
                        </button>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    className={`${SMALL_BTN} mt-3`}
                    onClick={() => setPhase(i, { items: [...(ph.items ?? []), { title: "", owner: "holder", dueDay: ph.toDay ?? 14, doneWhen: "" }] })}
                  >
                    {WORDS.addStep}
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={`${SMALL_BTN} mt-3`}
              onClick={() => {
                const from = phases.length ? Math.min(365, (phases[phases.length - 1].toDay ?? 14) + 1) : 1;
                setPhases([...phases, { name: "", fromDay: from, toDay: Math.min(365, from + 13), items: [] }]);
              }}
            >
              {WORDS.addPhase}
            </button>
          </div>
        </div>
      ) : null}

      <details className="mt-4" open={loaded && !parsed}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-card-foreground">{WORDS.json}</summary>
        <label className="mt-1 block text-sm font-medium text-card-foreground">
          {WORDS.label}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCheckinText(null);
            }}
            disabled={!loaded}
            rows={16}
            spellCheck={false}
            className={JSON_BOX}
          />
        </label>
      </details>
      <SaveBar count={loaded ? docChangeCount(savedText, text) : 0} onSave={save} onDiscard={() => { setText(savedText); setCheckinText(null); }} what={WORDS.heading} />
    </section>
  );
}
