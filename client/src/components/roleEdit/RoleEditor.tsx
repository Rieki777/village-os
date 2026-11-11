/**
 * "EDIT THIS ROLE": the one editor for a role card (role journey, PR-B).
 *
 * Loaded as its OWN CHUNK by ./EditRoleButton.tsx, so a visitor, or a member
 * without the power to decide the structure, never downloads it.
 *
 * One editor holds every card word, the listing details this village's roles
 * carry, the order of the interviewers (each with minutes and a final approval
 * flag), the pay group of the terms on offer, and the characters the role suits.
 * A field that differs from the role as it stands sits in a gold frame, with the
 * words as they stand a tap away. SAVE writes one human org draft and publishes
 * it at once by the editor's power (server/lib/roleEdit.ts); nothing else in this
 * file writes. "Use Sera's range" and "Take Sera's words" only FILL THE FORM.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ROLE_CARD_FIELDS } from "@shared/roleCardText";
import { CONVERSATION_MODES, interviewMinutesTotal, TRACKS, TRACK_WORDS, WHERE_WORKED, type Interviewer } from "@shared/roleParameters";
import { PAY_KINDS, type PaySettings } from "@shared/seatSettings";
import type { HeldBy } from "@shared/agentHolders";
import type { WordValue } from "@shared/roleProposals";
import { FOCUS, INPUT, LEDE, PANEL, PRIMARY, QUIET, SECONDARY } from "@/components/roleProposal/parts";
import { openEditor, saveEditor, type EditorOpen, type EditorState, type SaveBody } from "./roleEditApi";
import BringInCard from "./BringInCard";
import SeraPanel from "./SeraPanel";
import HistoryPanel from "./HistoryPanel";
import CharacterTags from "./CharacterTags";
import SectionsFields, { sectionsFormOf, sectionsOf, type SectionsForm } from "./SectionsFields";

const text = (v: WordValue | undefined): string => (Array.isArray(v) ? v.join("\n") : (v ?? ""));
const lines = (s: string): string[] => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The card words the editor draws, in the card's own order and headings. */
const WORD_SPECS = ROLE_CARD_FIELDS.filter((f) => !String(f.key).startsWith("param:") && !["circle", "roleId", "measures", "season", "seasonAim", "seasonalGoals", "servesGoals"].includes(String(f.key)));

interface Form {
  words: Record<string, string>;
  listed: boolean;
  alwaysChecked: boolean;
  /** Who may hold it (0374): "" is a card that has not said, which reads as either. */
  heldBy: "" | HeldBy;
  recruiting: boolean;
  track: string;
  whereWorked: string;
  languages: string;
  villageGoals: string;
  budgetLine: string;
  fundedFrom: string;
  reviewAfterDays: string;
  selectionCriteria: string;
  accessBundle: string;
  bookingUrl: string;
  interviewers: Interviewer[];
  conversationMode: string;
  pay: PaySettings | null;
  tags: string[];
  /** The founding sections, as the editor holds them (lines as text). */
  sections: SectionsForm;
}

function formOf(s: EditorState): Form {
  const p = s.parameters;
  return {
    words: Object.fromEntries(Object.entries(s.words).map(([k, v]) => [k, text(v)])),
    listed: p.listed ?? true,
    alwaysChecked: p.alwaysChecked ?? false,
    heldBy: p.heldBy ?? "",
    recruiting: p.recruiting ?? false,
    track: p.track ?? "",
    whereWorked: p.whereWorked ?? "",
    languages: (p.languages ?? []).join("\n"),
    villageGoals: (p.villageGoals ?? []).join("\n"),
    budgetLine: p.budgetLine ?? "",
    fundedFrom: p.fundedFrom ?? "",
    reviewAfterDays: p.reviewAfterDays ? String(p.reviewAfterDays) : "",
    selectionCriteria: (p.selectionCriteria ?? []).join("\n"),
    accessBundle: (p.accessBundle ?? []).join("\n"),
    bookingUrl: p.bookingUrl ?? "",
    interviewers: (p.conversations ?? []).map((x) => ({ ...x })),
    conversationMode: p.conversationMode ?? "",
    pay: s.pay,
    tags: [...s.archetypes],
    sections: sectionsFormOf(s.sections),
  };
}

/** The save body: the words as written, and only the listing details this database holds. */
function bodyOf(f: Form, s: EditorState): SaveBody {
  const has = (k: string) => (s.parameterKeys as string[]).includes(k);
  const parameters: Record<string, unknown> = { recruiting: f.recruiting };
  if (has("listed")) parameters.listed = f.listed;
  if (has("alwaysChecked")) parameters.alwaysChecked = f.alwaysChecked;
  if (has("heldBy")) parameters.heldBy = f.heldBy || null;
  if (has("track")) parameters.track = f.track || null;
  if (has("whereWorked")) parameters.whereWorked = f.whereWorked || null;
  if (has("languages")) parameters.languages = lines(f.languages);
  if (has("villageGoals")) parameters.villageGoals = lines(f.villageGoals);
  if (has("budgetLine")) parameters.budgetLine = f.budgetLine.trim() || null;
  if (has("fundedFrom")) parameters.fundedFrom = f.fundedFrom || null;
  if (has("reviewAfterDays")) parameters.reviewAfterDays = f.reviewAfterDays.trim() ? Number(f.reviewAfterDays) : null;
  if (has("selectionCriteria")) parameters.selectionCriteria = lines(f.selectionCriteria);
  if (has("accessBundle")) parameters.accessBundle = lines(f.accessBundle);
  if (has("bookingUrl")) parameters.bookingUrl = f.bookingUrl.trim() || null;
  if (has("conversations")) parameters.conversations = f.interviewers;
  if (has("conversationMode")) parameters.conversationMode = f.conversationMode || null;
  // The sections go only to a server that sent them, so an older server never meets a key it refuses.
  return { words: f.words, parameters, pay: f.pay, archetypes: f.tags, ...(s.sections ? { sections: sectionsOf(f.sections) } : {}) };
}

/** A field's gold frame: it differs from the role as it stands, and the words as they stand are a tap away. */
function Frame({ changed, posted, label, children }: { changed: boolean; posted?: string; label: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${changed ? "border-dash-gold bg-dash-gold/10" : "border-border"}`} data-changed={changed ? "true" : "false"}>
      <label className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <span>{label}</span>
        {changed && (
          <span className="rounded bg-dash-gold px-1.5 text-xs font-semibold text-dash-gold-ink">
            <Trans context="role editor, a field that differs from the role as it stands">Changed</Trans>
          </span>
        )}
      </label>
      {children}
      {changed && posted !== undefined && (
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className={`min-h-[44px] cursor-pointer py-2 ${FOCUS}`}>
            <Trans context="role editor, shows the words the role has now">The words now</Trans>
          </summary>
          <p className="whitespace-pre-wrap">{posted || "-"}</p>
        </details>
      )}
    </div>
  );
}

const AREA = `${INPUT} min-h-[96px] resize-y`;

export default function RoleEditor({ roleId, onClose, onSaved }: { roleId: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState<EditorOpen | null>(null);
  const [base, setBase] = useState<EditorState | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<"card" | "sera" | "history" | null>(null);

  const load = useCallback(async () => {
    const r = await openEditor(roleId);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(r.data);
    setBase(r.data.state);
    setForm(formOf(r.data.state));
  }, [roleId]);
  useEffect(() => {
    void load();
  }, [load]);

  const start = useMemo(() => (base ? formOf(base) : null), [base]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setWord = (key: string, value: string) => setForm((f) => (f ? { ...f, words: { ...f.words, [key]: value } } : f));

  if (error && !open) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogTitle><Trans context="role editor">Edit this role</Trans></DialogTitle>
          <DialogDescription>{error}</DialogDescription>
          <button type="button" className={SECONDARY} onClick={onClose}><Trans context="role editor">Close</Trans></button>
        </DialogContent>
      </Dialog>
    );
  }
  if (!open || !base || !form || !start) return null;

  const has = (k: string) => (base.parameterKeys as string[]).includes(k);
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const changedWord = (k: string) => (form.words[k] ?? "") !== (start.words[k] ?? "");

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await saveEditor(roleId, bodyOf(form, base));
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(t({ message: "Saved. The role is updated.", context: "role editor" }));
    setBase(r.data.state);
    setForm(formOf(r.data.state));
    onSaved?.();
  };

  const proposePay = (g: PaySettings | null) => set("pay", g);
  const fillWords = (fill: Record<string, string>) => setForm((f) => (f ? { ...f, words: { ...f.words, ...fill } } : f));

  const moveInterviewer = (i: number, by: -1 | 1) => {
    const next = [...form.interviewers];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set("interviewers", next);
  };
  const pay = form.pay;
  const setPay = (patch: Partial<PaySettings>) => set("pay", { ...(pay ?? { kind: "range" }), ...patch } as PaySettings);
  const money = (n: number | undefined) => (n === undefined ? "" : String(n / 100));
  const minor = (s: string): number | undefined => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Math.round(Number(s) * 100));
  const minutes = interviewMinutesTotal(form.interviewers);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto bg-card text-foreground">
        <DialogTitle className="font-display text-xl">
          <Trans context="role editor">Edit this role</Trans>: {base.name}
        </DialogTitle>
        <DialogDescription className={LEDE}>
          <Trans context="role editor">Changes show in gold. Saving updates the role at once and is kept in its history, where the newest change can be put back.</Trans>
        </DialogDescription>

        <div className="flex flex-wrap gap-2">
          {(["card", "sera", "history"] as const).map((p) => (
            <button key={p} type="button" className={panel === p ? PRIMARY : SECONDARY} aria-pressed={panel === p} onClick={() => setPanel(panel === p ? null : p)}>
              {p === "card" ? <Trans context="role editor">Bring in a card</Trans> : p === "sera" ? <Trans context="role editor">See Sera's version</Trans> : <Trans context="role editor">History</Trans>}
            </button>
          ))}
        </div>
        {panel === "card" && (
          <BringInCard
            roleId={roleId}
            onFill={(r) => {
              setForm((f) => (f ? ({ ...f, ...r.form, words: { ...f.words, ...r.words } } as Form) : f));
              setPanel(null);
            }}
          />
        )}
        {panel === "sera" && <SeraPanel roleId={roleId} onTake={(field, value) => fillWords({ [field]: value })} />}
        {panel === "history" && <HistoryPanel roleId={roleId} onReverted={(s) => { setBase(s); setForm(formOf(s)); onSaved?.(); }} />}

        <section className={`${PANEL} space-y-3`} aria-labelledby="re-words">
          <h3 id="re-words" className="font-display text-lg"><Trans context="role editor">The card's words</Trans></h3>
          {WORD_SPECS.filter((s) => String(s.key) in base.words).map((s) => {
            const key = String(s.key);
            return (
              <Frame key={key} label={s.heading} changed={changedWord(key)} posted={start.words[key]}>
                {s.oneLine ? (
                  <input className={INPUT} value={form.words[key] ?? ""} onChange={(e) => setWord(key, e.target.value)} aria-label={s.heading} />
                ) : (
                  <textarea className={AREA} value={form.words[key] ?? ""} onChange={(e) => setWord(key, e.target.value)} aria-label={s.heading} />
                )}
                <p className="mt-1 text-xs text-muted-foreground">{s.limit}</p>
              </Frame>
            );
          })}
        </section>

        <section className={`${PANEL} space-y-3`} aria-labelledby="re-door">
          <h3 id="re-door" className="font-display text-lg"><Trans context="role editor">Listing and the door</Trans></h3>
          {has("listed") && (
            <Frame label={t({ message: "Listed", context: "role editor" })} changed={form.listed !== start.listed}>
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="size-5 accent-dash-gold" checked={form.listed} onChange={(e) => set("listed", e.target.checked)} />
                <span><Trans context="role editor">Visitors and members can find this role</Trans></span>
              </label>
              {open.lacksToList.length > 0 && !form.listed && (
                <p className="text-sm text-muted-foreground"><Trans context="role editor">Still to write before it can be listed:</Trans> {open.lacksToList.join(", ")}.</p>
              )}
            </Frame>
          )}
          {has("alwaysChecked") && (
            <Frame label={t({ message: "Background check", context: "role editor" })} changed={form.alwaysChecked !== start.alwaysChecked}>
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="size-5 accent-dash-gold" checked={form.alwaysChecked} onChange={(e) => set("alwaysChecked", e.target.checked)} />
                <span><Trans context="role editor">Always background-checked, whatever the references say (roles that hold money or work near children)</Trans></span>
              </label>
            </Frame>
          )}
          {has("heldBy") && (
            <Frame label={t({ message: "Who can hold it", context: "role editor" })} changed={form.heldBy !== start.heldBy}>
              <select className={INPUT} value={form.heldBy} onChange={(e) => set("heldBy", e.target.value as Form["heldBy"])} aria-label={t({ message: "Who can hold it", context: "role editor" })}>
                <option value="">{t({ message: "Not said (a person or an agent)", context: "role editor: who can hold a role" })}</option>
                <option value="person">{t({ message: "A person", context: "role editor: who can hold a role" })}</option>
                <option value="agent">{t({ message: "An agent", context: "role editor: who can hold a role" })}</option>
                <option value="either">{t({ message: "A person or an agent", context: "role editor: who can hold a role" })}</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground"><Trans context="role editor">An agent is proposed by the member who keeps it, and the circle decides by consent, as for a person.</Trans></p>
            </Frame>
          )}
          <Frame label={t({ message: "Door", context: "role editor" })} changed={form.recruiting !== start.recruiting}>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" className="size-5 accent-dash-gold" checked={form.recruiting} onChange={(e) => set("recruiting", e.target.checked)} />
              <span><Trans context="role editor">The door is open: this role is looking for someone</Trans></span>
            </label>
          </Frame>
          {has("bookingUrl") && (
            <Frame label={t({ message: "Booking link", context: "role editor" })} changed={form.bookingUrl !== start.bookingUrl} posted={start.bookingUrl}>
              <input className={INPUT} inputMode="url" value={form.bookingUrl} onChange={(e) => set("bookingUrl", e.target.value)} aria-label={t({ message: "Booking link", context: "role editor" })} />
            </Frame>
          )}
        </section>

        {(has("track") || has("selectionCriteria") || has("conversations")) && (
          <section className={`${PANEL} space-y-3`} aria-labelledby="re-params">
            <h3 id="re-params" className="font-display text-lg"><Trans context="role editor">Details on the card</Trans></h3>
            {has("track") && (
              <Frame label={t({ message: "Track", context: "role editor" })} changed={form.track !== start.track}>
                <select className={INPUT} value={form.track} onChange={(e) => set("track", e.target.value)} aria-label={t({ message: "Track", context: "role editor" })}>
                  <option value="">{"-"}</option>
                  {TRACKS.map((k) => <option key={k} value={k}>{TRACK_WORDS[k]}</option>)}
                </select>
              </Frame>
            )}
            {has("whereWorked") && (
              <Frame label={t({ message: "Where it is worked", context: "role editor" })} changed={form.whereWorked !== start.whereWorked}>
                <select className={INPUT} value={form.whereWorked} onChange={(e) => set("whereWorked", e.target.value)} aria-label={t({ message: "Where it is worked", context: "role editor" })}>
                  <option value="">{"-"}</option>
                  {WHERE_WORKED.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </Frame>
            )}
            {([
              ["languages", t({ message: "Languages", context: "role editor" })],
              ["villageGoals", t({ message: "Village goals this role serves", context: "role editor" })],
              ["selectionCriteria", t({ message: "Selection criteria (3 to 5 lines)", context: "role editor" })],
              ["accessBundle", t({ message: "Access bundle", context: "role editor" })],
            ] as const).filter(([k]) => has(k)).map(([k, label]) => (
              <Frame key={k} label={label} changed={form[k] !== start[k]} posted={start[k]}>
                <textarea className={AREA} value={form[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} />
              </Frame>
            ))}
            {([
              ["budgetLine", t({ message: "Budget line", context: "role editor" }), "text"],
              ["fundedFrom", t({ message: "Funded from", context: "role editor" }), "date"],
              ["reviewAfterDays", t({ message: "Review after (days)", context: "role editor" }), "number"],
            ] as const).filter(([k]) => has(k)).map(([k, label, type]) => (
              <Frame key={k} label={label} changed={form[k] !== start[k]} posted={start[k]}>
                <input className={INPUT} type={type} value={form[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} />
              </Frame>
            ))}
          </section>
        )}

        {has("conversations") && (
          <section className={`${PANEL} space-y-3`} aria-labelledby="re-interview">
            <h3 id="re-interview" className="font-display text-lg"><Trans context="role editor">Interviewers, in order</Trans></h3>
            <p className={LEDE}><Trans context="role editor">One role can give the final approval. The interviews take {minutes} minutes in all.</Trans></p>
            {has("conversationMode") && (
              <Frame label={t({ message: "How the conversations are held", context: "role editor" })} changed={form.conversationMode !== start.conversationMode}>
                <select className={INPUT} value={form.conversationMode} onChange={(e) => set("conversationMode", e.target.value)} aria-label={t({ message: "How the conversations are held", context: "role editor" })}>
                  <option value="">{"-"}</option>
                  {CONVERSATION_MODES.map((k) => (
                    <option key={k} value={k}>{k === "block" ? t({ message: "As a block, one sitting", context: "role editor" }) : t({ message: "Separately, one at a time", context: "role editor" })}</option>
                  ))}
                </select>
              </Frame>
            )}
            <Frame label={t({ message: "Who interviews", context: "role editor" })} changed={!same(form.interviewers, start.interviewers)}>
              <ol className="space-y-2">
                {form.interviewers.map((x, i) => (
                  <li key={x.roleId} className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-sm text-muted-foreground">{i + 1}</span>
                    <select className={`${INPUT} flex-1`} value={x.roleId} aria-label={t({ message: "Interviewer role", context: "role editor" })} onChange={(e) => set("interviewers", form.interviewers.map((y, n) => (n === i ? { ...y, roleId: e.target.value } : y)))}>
                      {open.roles.concat(base ? [{ id: base.id, name: base.name }] : []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input className={`${INPUT} w-24`} type="number" min={5} max={240} value={x.minutes} aria-label={t({ message: "Minutes", context: "role editor" })} onChange={(e) => set("interviewers", form.interviewers.map((y, n) => (n === i ? { ...y, minutes: Number(e.target.value) } : y)))} />
                    <label className="flex min-h-[44px] items-center gap-1 text-sm">
                      <input type="checkbox" className="size-5 accent-dash-gold" checked={x.final} onChange={(e) => set("interviewers", form.interviewers.map((y, n) => ({ ...y, final: n === i ? e.target.checked : false })))} />
                      <Trans context="role editor">Final approval</Trans>
                    </label>
                    <button type="button" className={SECONDARY} aria-label={t({ message: "Move up", context: "role editor" })} onClick={() => moveInterviewer(i, -1)}><ArrowUp className="size-4" /></button>
                    <button type="button" className={SECONDARY} aria-label={t({ message: "Move down", context: "role editor" })} onClick={() => moveInterviewer(i, 1)}><ArrowDown className="size-4" /></button>
                    <button type="button" className={SECONDARY} aria-label={t({ message: "Remove", context: "role editor" })} onClick={() => set("interviewers", form.interviewers.filter((_, n) => n !== i))}><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ol>
              <button type="button" className={`${SECONDARY} mt-2`} disabled={form.interviewers.length >= 6} onClick={() => {
                const taken = new Set(form.interviewers.map((y) => y.roleId));
                const next = open.roles.find((r) => !taken.has(r.id));
                if (next) set("interviewers", [...form.interviewers, { roleId: next.id, minutes: 20, final: false }]);
              }}>
                <Plus className="size-4" /> <Trans context="role editor">Add an interviewer</Trans>
              </button>
            </Frame>
          </section>
        )}

        <section className={`${PANEL} space-y-3`} aria-labelledby="re-pay">
          <h3 id="re-pay" className="font-display text-lg"><Trans context="role editor">Pay on offer</Trans></h3>
          <Frame label={t({ message: "The pay group of the terms", context: "role editor" })} changed={!same(form.pay, start.pay)} posted={start.pay ? JSON.stringify(start.pay) : ""}>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={INPUT} value={pay?.kind ?? ""} aria-label={t({ message: "Kind of pay", context: "role editor" })} onChange={(e) => (e.target.value ? setPay({ kind: e.target.value as PaySettings["kind"] }) : set("pay", null))}>
                <option value="">{t({ message: "No pay on offer", context: "role editor" })}</option>
                {PAY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className={INPUT} value={pay?.currency ?? ""} maxLength={3} aria-label={t({ message: "Currency", context: "role editor" })} onChange={(e) => setPay({ currency: e.target.value.toUpperCase() || undefined })} />
              {pay?.kind === "range" ? (
                <>
                  <input className={INPUT} inputMode="decimal" value={money(pay.minMinor)} aria-label={t({ message: "Lowest amount", context: "role editor" })} onChange={(e) => setPay({ minMinor: minor(e.target.value) })} />
                  <input className={INPUT} inputMode="decimal" value={money(pay.maxMinor)} aria-label={t({ message: "Highest amount", context: "role editor" })} onChange={(e) => setPay({ maxMinor: minor(e.target.value) })} />
                </>
              ) : pay && pay.kind !== "none" && pay.kind !== "honorary" ? (
                <input className={INPUT} inputMode="decimal" value={money(pay.amountMinor)} aria-label={t({ message: "Amount", context: "role editor" })} onChange={(e) => setPay({ amountMinor: minor(e.target.value) })} />
              ) : null}
              <select className={INPUT} value={pay?.per ?? ""} aria-label={t({ message: "Per", context: "role editor" })} onChange={(e) => setPay({ per: (e.target.value || undefined) as PaySettings["per"] })}>
                <option value="">{"-"}</option>
                <option value="month">{t({ message: "per month", context: "role editor" })}</option>
                <option value="moon">{t({ message: "per moon", context: "role editor" })}</option>
              </select>
              <input className={`${INPUT} sm:col-span-2`} value={pay?.note ?? ""} aria-label={t({ message: "Note", context: "role editor" })} placeholder={t({ message: "Funding-dependent, if so", context: "role editor" })} onChange={(e) => setPay({ note: e.target.value || undefined })} />
            </div>
            {open.mayReadTerms && <UseSeraRange roleId={roleId} onPropose={proposePay} />}
          </Frame>
        </section>

        {base.sections && <SectionsFields value={form.sections} start={start.sections} onChange={(v) => set("sections", v)} />}

        {/* SLOT FOR LANE A4 (PR 1193): RootPicker (1 to 3 roots) replaces CharacterTags here; same value and onChange. */}
        <CharacterTags value={form.tags} onChange={(v) => set("tags", v)} changed={!same([...form.tags].sort(), [...start.tags].sort())} />

        {error && <p role="alert" className="text-sm font-semibold text-coral">{error}</p>}
        <div className="sticky bottom-0 flex flex-wrap gap-2 bg-card py-2">
          <button type="button" className={PRIMARY} disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Trans context="role editor">Saving</Trans> : <Trans context="role editor">Save and update the role</Trans>}
          </button>
          <button type="button" className={QUIET} onClick={() => setForm(formOf(base))} disabled={!dirty}>
            <Trans context="role editor">Undo my edits</Trans>
          </button>
          <button type="button" className={SECONDARY} onClick={onClose}><Trans context="role editor">Close</Trans></button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Use Sera's range": reads Sera's figures and puts a group in the form above. Writes nothing; the save does. */
function UseSeraRange({ roleId, onPropose }: { roleId: string; onPropose: (g: PaySettings | null) => void }) {
  const { t } = useLingui();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className={SECONDARY}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { readSera } = await import("./roleEditApi");
          const r = await readSera(roleId);
          setBusy(false);
          if (!r.ok) return setNote(r.error);
          if (!r.data.pay) return setNote(t({ message: "Sera has sent no figures for this role to go on.", context: "role editor" }));
          onPropose(r.data.pay);
          setNote(t({ message: "Sera's range is in the form. Read it, change it if you like, then save.", context: "role editor" }));
        }}
      >
        <Trans context="role editor">Use Sera's range</Trans>
      </button>
      {note && <p role="status" className="mt-1 text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
