/**
 * "BRING IN A CARD", inside the editor (role journey, PR-B): paste the words,
 * choose a file (.docx, .pdf, .md, .txt) or link a Google Doc shared as "anyone
 * with the link", all in the "Amora role card v1" format. The server reads it
 * against THIS role and keeps nothing (server/routes/roleEdit.ts). What differs
 * from the role as it stands is listed with a tick on each line; "Fill the
 * editor" puts the ticked lines in the form above in gold. Nothing is saved
 * until the person presses save there.
 */
import { useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileUp, Link2, ClipboardPaste } from "lucide-react";
import { FOCUS, INPUT, LEDE, PRIMARY, SECONDARY } from "@/components/roleProposal/parts";
import type { WordValue } from "@shared/roleProposals";
import { importFile, importText, type Imported } from "./roleEditApi";

/** What a ticked card fills: words as text, and the form's other fields by name. */
export interface Fill {
  words: Record<string, string>;
  form: Record<string, unknown>;
}

type Mode = "paste" | "file" | "link";

const asText = (v: WordValue | undefined): string => (Array.isArray(v) ? v.join("\n") : (v ?? ""));
const show = (v: unknown): string => (v === null || v === undefined ? "-" : Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A card's parameter, as the editor's form holds it. */
function formPatch(key: string, after: unknown): Record<string, unknown> {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join("\n") : "");
  switch (key) {
    case "listed":
    case "alwaysChecked":
    case "recruiting":
      return { [key]: after === true };
    case "track":
    case "heldBy":
    case "conversationMode":
    case "whereWorked":
    case "budgetLine":
    case "fundedFrom":
    case "bookingUrl":
      return { [key]: after === null || after === undefined ? "" : String(after) };
    case "reviewAfterDays":
      return { reviewAfterDays: after === null || after === undefined ? "" : String(after) };
    case "languages":
    case "villageGoals":
    case "selectionCriteria":
    case "accessBundle":
      return { [key]: list(after) };
    case "conversations":
      return { interviewers: Array.isArray(after) ? after : [] };
    default:
      return {};
  }
}

export default function BringInCard({ roleId, onFill }: { roleId: string; onFill: (f: Fill) => void }) {
  const { t } = useLingui();
  const [mode, setMode] = useState<Mode>("paste");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Imported | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = (r: Awaited<ReturnType<typeof importText>>) => {
    setBusy(false);
    if (!r.ok) {
      setRead(null);
      return setError(r.error);
    }
    setError(null);
    setRead(r.data);
    const blocked = new Set((r.data.problems ?? []).filter((p) => p.blocks).map((p) => p.field));
    const on = new Set<string>();
    if (r.data.renamed) on.add("name");
    for (const k of Object.keys(r.data.words ?? {})) on.add(`word:${k}`);
    for (const k of Object.keys(r.data.parameters ?? {})) on.add(`param:${k}`);
    if (r.data.pay) on.add("pay");
    if (blocked.has("parameters")) for (const k of Array.from(on)) if (k.startsWith("param:") || k === "pay") on.delete(k);
    setTicked(on);
  };

  const readIt = async () => {
    setBusy(true);
    if (mode === "file") {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setBusy(false);
        return setError(t({ message: "Choose the file to bring in.", context: "role editor card" }));
      }
      return finish(await importFile(roleId, file));
    }
    if (mode === "link") return finish(await importText(roleId, { link }));
    return finish(await importText(roleId, { text: pasted }));
  };

  const toggle = (k: string) => setTicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const fill = () => {
    if (!read) return;
    const words: Record<string, string> = {};
    let form: Record<string, unknown> = {};
    if (read.renamed && ticked.has("name")) words.name = read.renamed.after;
    for (const [k, w] of Object.entries(read.words ?? {})) if (ticked.has(`word:${k}`)) words[k] = asText(w.after);
    for (const [k, p] of Object.entries(read.parameters ?? {})) if (ticked.has(`param:${k}`)) form = { ...form, ...formPatch(k, p.after) };
    if (read.pay && ticked.has("pay")) form = { ...form, pay: read.pay.after };
    onFill({ words, form });
  };

  const rows = read?.matched
    ? [
        ...(read.renamed ? [{ id: "name", label: t({ message: "Role title", context: "role editor card" }), before: read.renamed.before, after: read.renamed.after }] : []),
        ...Object.entries(read.words ?? {}).map(([k, w]) => ({ id: `word:${k}`, label: w.label, before: asText(w.before) || "-", after: asText(w.after) })),
        ...Object.entries(read.parameters ?? {}).map(([k, p]) => ({ id: `param:${k}`, label: p.label, before: show(p.before), after: show(p.after) })),
        ...(read.pay ? [{ id: "pay", label: read.pay.label, before: show(read.pay.before), after: show(read.pay.after) }] : []),
      ]
    : [];
  const blocking = (read?.problems ?? []).filter((p) => p.blocks);

  const modeButton = (m: Mode, icon: React.ReactNode, label: string) => (
    <button type="button" className={mode === m ? PRIMARY : SECONDARY} aria-pressed={mode === m} onClick={() => setMode(m)}>
      {icon} {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className={LEDE}>
        <Trans context="role editor card">Bring in a card written in the role card v1 format. The words are read and not kept. Nothing changes until you save.</Trans>
      </p>
      <div className="flex flex-wrap gap-2">
        {modeButton("paste", <ClipboardPaste className="size-4" />, t({ message: "Paste", context: "role editor card" }))}
        {modeButton("file", <FileUp className="size-4" />, t({ message: "File", context: "role editor card" }))}
        {modeButton("link", <Link2 className="size-4" />, t({ message: "Google Doc", context: "role editor card" }))}
      </div>
      {mode === "paste" && <textarea className={`${INPUT} min-h-[140px]`} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label={t({ message: "The card's words", context: "role editor card" })} />}
      {mode === "file" && <input ref={fileRef} type="file" accept=".docx,.pdf,.md,.txt" className={`${INPUT} py-2 ${FOCUS}`} aria-label={t({ message: "Choose a file", context: "role editor card" })} />}
      {mode === "link" && <input className={INPUT} inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} aria-label={t({ message: "Link to a Google Doc shared with anyone who has the link", context: "role editor card" })} />}
      <button type="button" className={PRIMARY} disabled={busy} onClick={() => void readIt()}>
        <Trans context="role editor card">Read the card</Trans>
      </button>
      {error && <p role="alert" className="text-sm font-semibold text-coral">{error}</p>}
      {read && !read.isCard && <p role="status" className={LEDE}><Trans context="role editor card">That is not a role card. A role card starts with the line Role card v1.</Trans></p>}
      {read?.isCard && !read.matched && read.sentence && <p role="status" className="text-sm text-foreground">{read.sentence}</p>}
      {read?.matched && (
        <div className="space-y-2">
          {rows.length === 0 && <p role="status" className={LEDE}><Trans context="role editor card">The card says what the role already says. Nothing to fill.</Trans></p>}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-dash-gold bg-dash-gold/10 p-3 text-sm" data-changed="true">
                <label className="flex min-h-[44px] items-start gap-2">
                  <input type="checkbox" className="mt-1 size-5 shrink-0 accent-dash-gold" checked={ticked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span>
                    <span className="block font-semibold text-foreground">{r.label}</span>
                    <span className="block whitespace-pre-wrap text-foreground">{r.after}</span>
                    <span className="block whitespace-pre-wrap text-muted-foreground"><Trans context="role editor card">Now:</Trans> {r.before}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {(read.problems ?? []).map((p) => (
            <p key={`${p.field}:${p.sentence}`} className={`text-sm ${p.blocks ? "font-semibold text-coral" : "text-muted-foreground"}`}>{p.sentence}</p>
          ))}
          <button type="button" className={PRIMARY} disabled={ticked.size === 0 || blocking.length > 0} onClick={fill}>
            <Trans context="role editor card">Fill the editor</Trans>
          </button>
        </div>
      )}
    </div>
  );
}
