/**
 * YOUR COMPANIONS: the army, each pet, today's questions, the drafts waiting
 * for a yes, and one companion's chat (approved design, 2026-10-30,
 * "Your companions", desktop and phone; the contract, section 8).
 *
 * Everything here reads and writes the caller's own rows through
 * /api/me/companions (server/routes/companions.ts). A yes never moves anything
 * from this file: it asks the server, which opens the draft's own door as the
 * member, and the card says what that door said.
 *
 * EVERY PART IS THE MEMBER'S: the name and look of each pet, how many
 * questions each may ask a day (up to the village's ceiling), which ones rest,
 * and the order of the army ("Customize this section").
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { gameFetch } from "@/lib/gameApi";
import {
  DONE_WORDS,
  DRAFT_KIND_LABEL,
  PET_KINDS,
  PET_TINTS,
  type CompanionItemView,
  type CompanionLook,
  type CompanionsPayload,
  type CompanionView,
} from "@shared/companionItems";
import CompanionPet, { PetDrawing } from "./CompanionPet";
import { BTN_GOLD, BTN_LINE, H2, KICKER, LINK, PANEL, RAISED } from "./dashUi";

const API = "/api/me/companions";

interface ChatLine {
  id: number;
  speaker: "member" | "companion";
  body: string;
}

async function send(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const r = await gameFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, json };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function doneLine(c: CompanionView): string {
  if (c.doneThisWeek.length === 0) return "Nothing done with your yes this week yet.";
  return `Done this week with your yes: ${c.doneThisWeek.map((d) => plural(d.count, DONE_WORDS[d.kind][0], DONE_WORDS[d.kind][1])).join(", ")}.`;
}

/** A due date as the member reads it: "Fri 31 Oct". A bare day, read as that day wherever the reader is. */
function dueWords(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const INPUT = "min-h-11 w-full rounded-xl border border-dash-edge bg-background px-3 text-[15px] text-foreground";

export default function YourCompanions() {
  const [data, setData] = useState<CompanionsPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookFor, setLookFor] = useState<CompanionView | null>(null);
  const [customizing, setCustomizing] = useState(false);

  const load = useCallback(async () => {
    const r = await send(API, "GET");
    if (r.status === 403 || r.status === 401) {
      setFailed(r.json?.error ?? "Companions open when you become a member of the village.");
      return;
    }
    if (!r.ok) {
      setFailed("Your companions could not be read just now.");
      return;
    }
    setFailed(null);
    setData(r.json as CompanionsPayload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const army = useMemo(() => (data?.companions ?? []).filter((c) => c.status === "active").sort((a, b) => a.sortOrder - b.sortOrder), [data]);
  const current = army.find((c) => c.id === selected) ?? army[0] ?? null;
  const openQ = army.reduce((n, c) => n + c.questions.filter((q) => q.status === "open").length, 0);
  const openD = army.reduce((n, c) => n + c.drafts.filter((d) => d.status === "open").length, 0);

  if (failed) {
    return (
      <section aria-labelledby="comp-h" className={`${PANEL} p-5 sm:p-7`}>
        <p className={KICKER}>Your companions</p>
        <h2 id="comp-h" className={H2}>
          Companions
        </h2>
        <p className="m-0 mt-2 text-sm text-muted-foreground">{failed}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section aria-labelledby="comp-h" aria-busy="true" className={`${PANEL} p-5 sm:p-7`}>
        <p className={KICKER}>Your companions</p>
        <h2 id="comp-h" className={H2}>
          Your companions are waking up
        </h2>
      </section>
    );
  }

  return (
    <section id="companions" aria-labelledby="comp-h" className={`${PANEL} flex scroll-mt-28 flex-col gap-4 p-4 sm:gap-[22px] sm:p-7`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className={KICKER}>Your companions · {army.length}</p>
          <h2 id="comp-h" className={H2}>
            {plural(openQ, "question", "questions")} and {plural(openD, "draft", "drafts")} wait for you
          </h2>
          <p className="m-0 text-sm text-muted-foreground">
            Nothing moves until you say yes.<span className="max-sm:hidden"> Each companion asks at most {data.ceiling} questions a day.</span>
          </p>
        </div>
        <div className="flex gap-2.5 max-sm:hidden">
          {current ? (
            <button type="button" className={BTN_LINE} onClick={() => setLookFor(current)}>
              Change a look
            </button>
          ) : null}
          <button type="button" className={BTN_LINE} aria-expanded={customizing} onClick={() => setCustomizing((v) => !v)}>
            Customize this section
          </button>
        </div>
      </div>

      {customizing ? <Customize data={data} onSaved={load} onClose={() => setCustomizing(false)} /> : null}

      <div role="list" aria-label="Your companions" className="flex gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-3.5 sm:overflow-visible lg:grid-cols-4">
        {army.map((c) => {
          const on = c.id === current?.id;
          const q = c.questions.filter((i) => i.status === "open").length;
          const d = c.drafts.filter((i) => i.status === "open").length;
          return (
            <div role="listitem" key={c.id} className="flex flex-none sm:flex-auto">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(c.id)}
                className={`flex w-full items-center gap-3.5 rounded-[18px] p-3 text-left max-sm:min-w-[104px] max-sm:flex-col max-sm:gap-1.5 max-sm:text-center sm:p-3.5 ${
                  on ? "border-2 border-dash-gold bg-dash-next" : "border border-dash-edge bg-dash-raised"
                }`}
              >
                <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-dash-chip sm:h-[84px] sm:w-[84px]">
                  <span className="sm:hidden">
                    <CompanionPet look={c.look} url={c.lookUrl} size={48} />
                  </span>
                  <span className="max-sm:hidden">
                    <CompanionPet look={c.look} url={c.lookUrl} size={72} />
                  </span>
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-sm font-semibold text-foreground sm:text-2xl">{c.name}</span>
                  <span className="text-[13px] text-foreground/80 max-sm:hidden">{c.scopeLine}</span>
                  <span className="self-start rounded-full border border-dash-edge bg-dash-chip px-2.5 py-0.5 text-xs text-foreground/80 max-sm:hidden">
                    {c.engineConnected ? c.engine : `${c.engine} · not connected yet`}
                  </span>
                  <span className="text-xs text-dash-gold-lit sm:text-[13px]">
                    <span className="sm:hidden">{q + d > 0 ? `${q + d} waiting` : "all clear"}</span>
                    <span className="max-sm:hidden">
                      {plural(q, "question", "questions")} · {plural(d, "draft", "drafts")}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {current ? (
        <div className="flex flex-wrap items-start gap-4 sm:gap-5">
          <CompanionCard key={current.id} c={current} ceiling={data.ceiling} onChanged={load} onLook={() => setLookFor(current)} />
          <ChatPanel key={`chat-${current.id}`} c={current} consent={data.consent} onChanged={load} />
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">Every companion is resting. Wake one in Customize this section.</p>
      )}

      {lookFor ? <LookEditor c={lookFor} onClose={() => setLookFor(null)} onSaved={load} /> : null}
    </section>
  );
}

// ── One companion's card ─────────────────────────────────────────────────

function CompanionCard({ c, ceiling, onChanged, onLook }: { c: CompanionView; ceiling: number; onChanged: () => Promise<void>; onLook: () => void }) {
  const shownToday = c.questions.length;
  return (
    <div className={`${RAISED} flex min-w-0 flex-[999_1_640px] flex-col gap-3.5 p-4 sm:gap-[18px] sm:p-6`}>
      <div className="flex items-center gap-3 sm:gap-4">
        <span className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full border-2 border-dash-gold-edge bg-dash-chip sm:h-24 sm:w-24">
          <span className="sm:hidden">
            <CompanionPet look={c.look} url={c.lookUrl} size={64} />
          </span>
          <span className="max-sm:hidden">
            <CompanionPet look={c.look} url={c.lookUrl} size={84} />
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="m-0 font-display text-[26px] font-semibold text-foreground sm:text-[30px]">{c.name}</h3>
          <p className="m-0 text-[13px] text-foreground/80 sm:text-sm">
            {c.scopeLine} · {c.engineConnected ? c.engine : `${c.engine}, not connected yet`}
          </p>
          <button type="button" onClick={onLook} className={`${LINK} self-start bg-transparent p-0 text-[13px] sm:hidden`}>
            Rename or restyle
          </button>
        </div>
        <button type="button" onClick={onLook} className={`${BTN_LINE} max-sm:hidden`}>
          Rename or restyle
        </button>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h4 className="m-0 font-body text-xs uppercase tracking-[0.14em] text-dash-gold-lit sm:text-[13px]">
          Today's questions · {shownToday} of {Math.min(c.dailyCap, ceiling)}
        </h4>
        {c.heldCount > 0 ? <span className="text-xs text-muted-foreground sm:text-[13px]">{plural(c.heldCount, "more waits", "more wait")} for tomorrow</span> : null}
      </div>
      {c.questions.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No questions today.</p> : null}
      {c.questions.map((it, i) => (
        <QuestionRow key={it.id} it={it} n={i + 1} of={Math.min(c.dailyCap, ceiling)} name={c.name} onChanged={onChanged} />
      ))}

      <h4 className="m-0 mt-1.5 font-body text-xs uppercase tracking-[0.14em] text-dash-gold-lit sm:text-[13px]">
        Drafts waiting for your yes · {c.drafts.filter((d) => d.status === "open").length}
      </h4>
      {c.drafts.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No drafts waiting.</p> : null}
      {c.drafts.map((it) => (
        <DraftRow key={it.id} it={it} name={c.name} onChanged={onChanged} />
      ))}

      <p className="m-0 border-t border-dash-edge pt-3 text-xs text-muted-foreground sm:text-[13px]">{doneLine(c)}</p>
    </div>
  );
}

function cardClass(it: CompanionItemView): string {
  const warm = it.blocking && it.status === "open";
  return `m-0 flex flex-col gap-2 rounded-2xl border p-3.5 sm:gap-2.5 sm:px-[18px] sm:py-4 ${warm ? "border-dash-gold-edge bg-dash-next" : "border-dash-edge bg-card"} ${
    it.status === "open" ? "" : "opacity-80"
  }`;
}

function QuestionRow({ it, n, of, name, onChanged }: { it: CompanionItemView; n: number; of: number; name: string; onChanged: () => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    const r = await send(`/api/me/companion-items/${encodeURIComponent(it.id)}/${path}`, "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.json?.error ?? "That did not go through.");
    await onChanged();
  };
  const inputId = `ans-${it.id}`;
  return (
    <article className={cardClass(it)}>
      <p className={`m-0 text-[11px] uppercase tracking-[0.12em] sm:text-xs ${it.blocking ? "text-dash-gold-lit" : "text-foreground/80"}`}>
        Question {n} of {of}
        {it.blocking ? " · someone is waiting on this" : ""}
      </p>
      <p className="m-0 text-base leading-snug text-foreground sm:text-[17px]">{it.title}</p>
      {it.body ? <p className="m-0 text-sm text-foreground/80">{it.body}</p> : null}
      <p className="m-0 text-xs leading-normal text-muted-foreground sm:text-[13px]">{it.source}</p>
      {it.status === "open" ? (
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="flex flex-[1_1_280px] flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] text-foreground/80">
              Your answer
            </label>
            <input id={inputId} type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} className={INPUT} />
          </div>
          <button type="button" disabled={busy || !answer.trim()} onClick={() => act("answer", { answer })} className={`${BTN_GOLD} max-sm:flex-1`}>
            Answer
          </button>
          <button type="button" disabled={busy} onClick={() => act("decline")} className={BTN_LINE}>
            Not mine
          </button>
        </div>
      ) : (
        <p className="m-0 text-sm text-dash-cash">
          {it.status === "answered" ? `Answered. ${name} has it.` : it.status === "declined" ? `Handed back. ${name} was told.` : `This question ${it.status}.`}
        </p>
      )}
      {error ? (
        <p role="alert" className="m-0 text-sm text-notice">
          {error}
        </p>
      ) : null}
    </article>
  );
}

const FIELD_LABEL: Record<string, string> = {
  status: "Your answer (going, maybe or declined)",
  amountMinor: "Amount",
  amount: "Amount",
  note: "Note",
  message: "Your words",
  body: "Message",
  title: "Title",
  description: "What it is",
  firstStep: "First step",
  subject: "Subject",
  text: "Text",
};
const NUMERIC = new Set(["amountMinor", "amount"]);

function DraftRow({ it, name, onChanged }: { it: CompanionItemView; name: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const startEdit = () => {
    const f: Record<string, string> = {};
    for (const k of it.editable) f[k] = it.payload?.[k] === undefined || it.payload?.[k] === null ? "" : String(it.payload[k]);
    setFields(f);
    setEditing(true);
  };
  const yes = async (withEdits: boolean) => {
    setBusy(true);
    setError("");
    const edits = withEdits ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, NUMERIC.has(k) ? Number(v) : v])) : undefined;
    const r = await send(`/api/me/companion-items/${encodeURIComponent(it.id)}/confirm`, "POST", edits ? { edits } : {});
    setBusy(false);
    if (!r.ok) return setError(r.json?.error ?? "That door said no.");
    if (typeof r.json?.mailto === "string") window.location.href = r.json.mailto;
    await onChanged();
  };
  const no = async () => {
    setBusy(true);
    const r = await send(`/api/me/companion-items/${encodeURIComponent(it.id)}/decline`, "POST");
    setBusy(false);
    if (!r.ok) return setError(r.json?.error ?? "That did not go through.");
    await onChanged();
  };
  return (
    <article className={cardClass(it)}>
      <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-foreground/80 sm:text-xs">
        {it.kind ? DRAFT_KIND_LABEL[it.kind] : "Draft"}
        {it.dueOn ? ` · due ${dueWords(it.dueOn)}` : ""}
      </p>
      <p className="m-0 text-base font-medium leading-snug text-foreground sm:text-[17px]">{it.title}</p>
      {it.detail ? <p className="m-0 whitespace-pre-line text-sm leading-normal text-foreground/80">{it.detail}</p> : null}
      {it.onYes ? (
        <p className="m-0 rounded-xl bg-dash-chip px-3 py-2.5 text-[13px] leading-normal text-foreground/80">
          <strong className="font-semibold text-foreground">On yes: </strong>
          {it.onYes}
        </p>
      ) : null}
      <p className="m-0 text-xs leading-normal text-muted-foreground sm:text-[13px]">{it.source}</p>
      {it.status === "open" && editing ? (
        <div className="flex flex-col gap-2.5">
          {it.editable.map((k) => (
            <label key={k} className="flex flex-col gap-1.5 text-[13px] text-foreground/80">
              {FIELD_LABEL[k] ?? k}
              <input
                type={NUMERIC.has(k) ? "number" : "text"}
                step={NUMERIC.has(k) ? 1 : undefined}
                min={NUMERIC.has(k) ? 1 : undefined}
                value={fields[k] ?? ""}
                onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                className={INPUT}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled={busy} onClick={() => yes(true)} className={`${BTN_GOLD} max-sm:basis-full`}>
              Yes, with my changes
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={`${BTN_LINE} max-sm:flex-1`}>
              Keep it as it was
            </button>
          </div>
        </div>
      ) : it.status === "open" ? (
        <div className="flex flex-wrap gap-2.5">
          <button type="button" disabled={busy} onClick={() => yes(false)} className={`${BTN_GOLD} max-sm:basis-full`}>
            {it.yesLabel ?? "Yes"}
          </button>
          {it.editable.length > 0 ? (
            <button type="button" disabled={busy} onClick={startEdit} className={`${BTN_LINE} max-sm:flex-1`}>
              Edit first
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={no} className={`${BTN_LINE} max-sm:flex-1`}>
            No
          </button>
        </div>
      ) : (
        <p className="m-0 text-sm text-dash-cash">
          {it.status === "confirmed" ? "Done. It went through its own door, with this source." : it.status === "declined" ? `Declined. Nothing happened, and ${name} was told.` : `This draft ${it.status}.`}
        </p>
      )}
      {error ? (
        <p role="alert" className="m-0 text-sm text-notice">
          {error}
        </p>
      ) : null}
    </article>
  );
}

// ── The chat ─────────────────────────────────────────────────────────────

function ChatPanel({ c, consent, onChanged }: { c: CompanionView; consent: CompanionsPayload["consent"]; onChanged: () => Promise<void> }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(Boolean(consent?.given));

  useEffect(() => {
    setAgreed(Boolean(consent?.given));
  }, [consent?.given]);
  useEffect(() => {
    let live = true;
    void send(`${API}/${encodeURIComponent(c.id)}/chat`, "GET").then((r) => {
      if (live && r.ok) setLines(r.json?.messages ?? []);
    });
    return () => {
      live = false;
    };
  }, [c.id]);

  const agree = async () => {
    if (!consent) return;
    const d = consent.disclosure;
    const r = await send(`${API}/consent`, "POST", { provider: d.provider, operator: d.operator, source: d.source });
    if (r.ok) setAgreed(true);
    else setNote(r.json?.error ?? "That did not save.");
  };

  const say = async () => {
    const words = text.trim();
    if (!words) return;
    setBusy(true);
    setNote("");
    const r = await send(`${API}/${encodeURIComponent(c.id)}/chat`, "POST", { message: words });
    setBusy(false);
    if (r.status === 409 && r.json?.error === "consent_required") {
      setAgreed(false);
      return;
    }
    if (!r.ok) return setNote(r.json?.error ?? "That did not send.");
    setText("");
    setLines(r.json?.messages ?? []);
    if (r.json?.refusal) setNote(r.json.refusal);
    if (r.json?.drafted) await onChanged();
  };

  const inputId = `chat-in-${c.id}`;
  return (
    <aside aria-labelledby={`chat-h-${c.id}`} className={`${RAISED} flex min-w-0 flex-[1_1_360px] flex-col gap-3 p-4 sm:gap-3.5 sm:p-5`}>
      <div className="flex items-center gap-2.5">
        <CompanionPet look={c.look} url={c.lookUrl} size={40} />
        <h3 id={`chat-h-${c.id}`} className="m-0 font-display text-[22px] font-semibold text-foreground sm:text-2xl">
          Talk to {c.name}
        </h3>
      </div>
      <p className="m-0 rounded-xl border border-dash-edge px-3 py-2.5 text-[13px] leading-normal text-foreground/80">
        {c.name} speaks through {c.chatEngine}, the village guide.
        {c.engineConnected ? "" : ` ${c.engine} is not connected yet, so ${c.chatEngine} answers for now.`}
        {consent && agreed ? ` ${consent.disclosure.sentence}` : ""}
      </p>
      {!consent ? (
        <p className="m-0 text-sm text-muted-foreground">{c.chatEngine} has no key in this village yet, so companions cannot talk in their own words.</p>
      ) : !agreed ? (
        <div className="flex flex-col gap-2 rounded-xl bg-dash-chip p-3">
          <p className="m-0 text-[13px] leading-normal text-foreground">{consent.disclosure.sentence}</p>
          <button type="button" onClick={agree} className={`${BTN_GOLD} self-start`}>
            Yes, that is fine
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2.5" aria-live="polite">
        {lines.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing said yet.</p> : null}
        {lines.map((m) => (
          <p
            key={m.id}
            className={`m-0 max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-sm leading-normal text-foreground ${m.speaker === "member" ? "self-end bg-dash-next" : "self-start bg-dash-chip"}`}
          >
            <span className="sr-only">{m.speaker === "member" ? "You: " : `${c.name}: `}</span>
            {m.body}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[13px] text-foreground/80">
          Message {c.name}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="text"
            value={text}
            maxLength={1000}
            disabled={!consent || !agreed}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void say();
            }}
            placeholder="Ask, or tell it what to draft"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button type="button" disabled={busy || !consent || !agreed || !text.trim()} onClick={say} className={BTN_GOLD}>
            Send
          </button>
        </div>
      </div>
      {note ? (
        <p role="status" className="m-0 text-[13px] text-notice">
          {note}
        </p>
      ) : null}
      <p className="m-0 text-xs leading-normal text-muted-foreground">Anything {c.name} drafts in chat lands in its card and waits for your yes.</p>
    </aside>
  );
}

// ── The look ─────────────────────────────────────────────────────────────

interface StudioPortrait {
  archetypeKey: string;
  url: string | null;
}

function LookEditor({ c, onClose, onSaved }: { c: CompanionView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(c.name);
  const [look, setLook] = useState<CompanionLook>(c.look);
  const [tab, setTab] = useState<"choose" | "forge" | "upload">(c.look.source);
  const [portraits, setPortraits] = useState<StudioPortrait[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab === "choose" || portraits) return;
    void send("/api/me/portraits", "GET").then((r) => setPortraits(r.ok ? ((r.json?.portraits ?? []) as StudioPortrait[]).filter((p) => p.url) : []));
  }, [tab, portraits]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const save = async () => {
    setError("");
    const r = await send(`${API}/${encodeURIComponent(c.id)}`, "PATCH", { name, look });
    if (!r.ok) return setError(r.json?.error ?? "That did not save.");
    await onSaved();
    onClose();
  };
  const chosenUrl = look.source !== "choose" ? (portraits?.find((p) => p.archetypeKey === look.portraitKey)?.url ?? c.lookUrl) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-background/80 p-4 pb-28 sm:items-center sm:pb-4">
      <div role="dialog" aria-modal="true" aria-labelledby="look-h" className={`${PANEL} flex w-full max-w-[460px] flex-col gap-4 p-5`}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} className={`${LINK} min-h-11 bg-transparent p-0 text-sm`}>
            Back
          </button>
          <p id="look-h" className={KICKER}>
            {c.scopeLine}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-[140px] w-[140px] items-center justify-center rounded-full border-2 border-dash-gold-edge bg-dash-chip">
            <CompanionPet look={look} url={chosenUrl} size={120} />
          </span>
          <label htmlFor={`look-name-${c.id}`} className="text-[13px] text-foreground/80">
            Name
          </label>
          <input
            id={`look-name-${c.id}`}
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 w-[220px] rounded-xl border border-dash-edge bg-card px-3 text-center font-display text-[22px] font-semibold text-foreground"
          />
        </div>
        <div role="tablist" aria-label="How to get a look" className="grid grid-cols-3 gap-1.5 rounded-[14px] border border-dash-edge bg-card p-1">
          {(["choose", "forge", "upload"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-[10px] ${tab === t ? "bg-dash-gold font-semibold text-dash-gold-ink" : "bg-transparent text-foreground"}`}
            >
              {t === "choose" ? "Choose" : t === "forge" ? "Forge" : "Upload"}
            </button>
          ))}
        </div>
        {tab === "choose" ? (
          <div className="grid grid-cols-4 gap-2">
            {PET_KINDS.flatMap((kind, i) =>
              PET_TINTS.map((_, j) => PET_TINTS[(i + j) % PET_TINTS.length]).map((tint) => {
                const on = look.source === "choose" && look.pet === kind && look.tint === tint;
                return (
                  <button
                    key={`${kind}-${tint}`}
                    type="button"
                    aria-label={`${tint} ${kind}`}
                    aria-pressed={on}
                    onClick={() => setLook({ source: "choose", pet: kind, tint })}
                    className={`flex min-h-[76px] items-center justify-center rounded-2xl ${on ? "border-2 border-dash-gold bg-dash-next" : "border border-dash-edge bg-dash-raised"}`}
                  >
                    <PetDrawing kind={kind} tint={tint} size={56} />
                  </button>
                );
              }),
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {portraits === null ? <p className="m-0 text-sm text-muted-foreground">Reading your portraits.</p> : null}
            {portraits && portraits.length === 0 ? <p className="m-0 text-sm text-muted-foreground">You have no portraits yet.</p> : null}
            <div className="grid grid-cols-4 gap-2">
              {(portraits ?? []).map((p) => {
                const on = look.source === tab && look.portraitKey === p.archetypeKey;
                return (
                  <button
                    key={p.archetypeKey}
                    type="button"
                    aria-label={`Your ${p.archetypeKey} portrait`}
                    aria-pressed={on}
                    onClick={() => setLook({ source: tab, portraitKey: p.archetypeKey })}
                    className={`flex min-h-[76px] items-center justify-center rounded-2xl ${on ? "border-2 border-dash-gold bg-dash-next" : "border border-dash-edge bg-dash-raised"}`}
                  >
                    <img src={p.url ?? ""} alt="" className="h-14 w-14 rounded-full object-cover" />
                  </button>
                );
              })}
            </div>
            <p className="m-0 text-[13px] text-foreground/80">
              {tab === "forge" ? "Forging spends one of your portrait grants." : "An upload costs nothing."} Make one in{" "}
              <Link href="/profile/characters" className={LINK}>
                the portrait studio
              </Link>
              , the same one your characters use, then choose it here.
            </p>
          </div>
        )}
        {c.scope === "role" ? <p className="m-0 text-[13px] text-muted-foreground">The look is yours. When the role passes on, the next holder picks their own.</p> : null}
        {error ? (
          <p role="alert" className="m-0 text-sm text-notice">
            {error}
          </p>
        ) : null}
        <button type="button" onClick={save} className={`${BTN_GOLD} min-h-12 text-base`}>
          Keep this look
        </button>
      </div>
    </div>
  );
}

// ── Customize this section ───────────────────────────────────────────────

function Customize({ data, onSaved, onClose }: { data: CompanionsPayload; onSaved: () => Promise<void>; onClose: () => void }) {
  const [error, setError] = useState("");
  const all = [...data.companions].sort((a, b) => a.sortOrder - b.sortOrder);
  const patch = async (c: CompanionView, body: Record<string, unknown>) => {
    setError("");
    const r = await send(`${API}/${encodeURIComponent(c.id)}`, "PATCH", body);
    if (!r.ok) setError(r.json?.error ?? "That did not save.");
    await onSaved();
  };
  const move = async (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= all.length) return;
    const order = all.map((c) => c.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (let k = 0; k < order.length; k++) {
      const c = all.find((x) => x.id === order[k])!;
      if (c.sortOrder !== k) await send(`${API}/${encodeURIComponent(c.id)}`, "PATCH", { sortOrder: k });
    }
    await onSaved();
  };
  return (
    <div className={`${RAISED} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 font-display text-xl font-semibold text-foreground">Customize this section</h3>
        <button type="button" onClick={onClose} className={BTN_LINE}>
          Done
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {all.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-dash-edge bg-card p-3">
            <CompanionPet look={c.look} url={c.lookUrl} size={36} />
            <span className="min-w-[140px] flex-1 text-sm text-foreground">
              {c.name} <span className="text-muted-foreground">· {c.scopeLine}</span>
            </span>
            <label className="flex items-center gap-2 text-[13px] text-foreground/80">
              Questions a day
              <select
                value={c.dailyCap}
                onChange={(e) => patch(c, { dailyQuestionCap: Number(e.target.value) })}
                className="min-h-11 rounded-lg border border-dash-edge bg-background px-2 text-foreground"
              >
                {Array.from({ length: data.ceiling + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {c.scope !== "personal" ? (
              <label className="flex items-center gap-2 text-[13px] text-foreground/80">
                Engine
                <select
                  value={c.provider}
                  onChange={(e) => patch(c, { provider: e.target.value })}
                  className="min-h-11 rounded-lg border border-dash-edge bg-background px-2 text-foreground"
                >
                  <option value="village">{c.chatEngine}</option>
                  <option value="saberra">Sera, not connected yet</option>
                </select>
              </label>
            ) : null}
            <label className="flex min-h-11 items-center gap-2 text-[13px] text-foreground/80">
              <input type="checkbox" checked={c.status === "resting"} onChange={(e) => patch(c, { status: e.target.checked ? "resting" : "active" })} />
              Resting
            </label>
            <span className="flex gap-1">
              <button type="button" aria-label={`Move ${c.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)} className={`${BTN_LINE} px-3`}>
                ↑
              </button>
              <button type="button" aria-label={`Move ${c.name} later`} disabled={i === all.length - 1} onClick={() => move(i, 1)} className={`${BTN_LINE} px-3`}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="m-0 text-sm text-notice">
          {error}
        </p>
      ) : null}
    </div>
  );
}
