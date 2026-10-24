/**
 * "BRING IN A DESCRIPTION OF YOUR ROLE" (Rye, 2026-10-24), on the words step.
 *
 * A file (.docx, .pdf, .md, .txt), pasted words, or a Google Doc shared as
 * "anyone with the link". The server pulls the words out and keeps nothing
 * (server/routes/roleCardImport.ts), and the page says so.
 *
 *   A ROLE CARD   the one reader's answer, as a list of what it fills, one
 *                 line per word with a tick on each. Lines a problem blocks
 *                 cannot be ticked until the card is fixed and read again; a
 *                 new role whose circle the card did not match gets a pick.
 *                 "Fill my draft" sends only what is ticked through the
 *                 ordinary PUT, so changed words then show in gold as always.
 *   ANYTHING ELSE the words go to the guide through `aiHelpStatus("words")`
 *                 (./aiHelp.ts, the guide lane's): `bringIn(text)` with the
 *                 words as a plain string, never stored, from this step, and
 *                 the page says "{guide} will read it". `guideFor` reads that
 *                 file through a wrapper, so the older shape still on main,
 *                 or no such export at all, reads as not configured. Not
 *                 configured, the page says the village reads the role card
 *                 format directly and points at the prompt below, with a
 *                 button that copies the prompt and the member's own words
 *                 together.
 *
 * Nothing is saved until the member presses "Fill my draft".
 */
import { useMemo, useRef, useState } from "react";
import { FileUp, Link2, ClipboardPaste } from "lucide-react";
import { useVillageName } from "@/hooks/useVillageName";
import { acceptOnly, isBlocked, type RoleCardChange } from "@shared/roleCardApply";
import type { RoleCardProblem, RoleCardRead } from "@shared/roleCardText";
import type { ProposalBody } from "@shared/roleProposals";
import * as aiHelp from "./aiHelp";
import { saveProposal, type ProposalOut, type ProposalUpdate } from "./proposalApi";
import { importRoleFile, importRoleText, type ImportOut } from "./roleCardApi";
import type { OrgView } from "./StepRoles";
import { copyText, promptFor } from "./OwnAiPrompt";
import { RC_WORDS } from "./roleCardWords";
import { FOCUS, INPUT, LEDE, PANEL, PRIMARY, QUIET, SECONDARY } from "./parts";

type Mode = "file" | "paste" | "link";

/** What the reader said, kept for the member to tick through. */
interface Reading {
  read: RoleCardRead;
  changes: RoleCardChange[];
  current: ProposalBody;
}

const under = (path: string) => (p: RoleCardProblem) => p.field === path || p.field.startsWith(`${path}.`);

/** The guide, when one is connected for this step: its name, and where the words go. */
export interface GuideHandoff {
  guide: string;
  bringIn: (text: string) => void;
}

/**
 * THE HAND-OFF, read through a wrapper. The guide lane's `aiHelpStatus(step)`
 * answers `{ configured: true, guide, bringIn }` or "not configured". The
 * older shape on main (`suggest`), a missing export, or a throw all read as
 * no guide, so this page works with either side of that lane landing first.
 */
export async function guideFor(step: "words"): Promise<GuideHandoff | null> {
  const status = (aiHelp as Record<string, unknown>).aiHelpStatus;
  if (typeof status !== "function") return null;
  try {
    const s = (await status(step)) as { configured?: unknown; guide?: unknown; bringIn?: unknown } | null;
    if (!s || s.configured !== true || typeof s.bringIn !== "function") return null;
    const bringIn = s.bringIn as (text: string) => void;
    return { guide: typeof s.guide === "string" && s.guide.trim() ? s.guide.trim() : RC_WORDS.theGuide, bringIn: (text) => bringIn(text) };
  } catch {
    return null;
  }
}

export default function BringInRole({
  proposal,
  org,
  beforeImport,
  onFilled,
}: {
  proposal: ProposalOut;
  org: OrgView | null | "failed";
  /** Saves whatever is typed first, so the card is read over the draft as it stands. */
  beforeImport: () => Promise<boolean>;
  /** The draft the PUT answered, once the member has filled it. */
  onFilled: (p: ProposalOut) => void;
}) {
  const village = useVillageName("This village");
  const [mode, setMode] = useState<Mode>("file");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [fallback, setFallback] = useState<{ words: string } | null>(null);
  const [handedTo, setHandedTo] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const circles = org && org !== "failed" ? org.circles.filter((c) => !c.isExample && c.status !== "retired") : [];
  const answered = useMemo(() => new Set(Object.keys(picks).filter((k) => picks[k]).map((k) => `${k}.circleId`)), [picks]);

  const show = (out: ImportOut) => {
    if (!out.read || !out.changes || !out.current) return;
    setReading({ read: out.read, changes: out.changes, current: out.current });
    setTicked(new Set(out.changes.filter((c) => !isBlocked(c.path, out.read!.problems)).map((c) => c.path)));
    setPicks({});
  };

  /** Words that are not a card: to the guide when one is connected, the prompt when none is. */
  const notACard = async (words: string) => {
    const guide = await guideFor("words");
    if (guide) {
      guide.bringIn(words);
      return setHandedTo(guide.guide);
    }
    setFallback({ words });
  };

  const bringIn = async (send: () => ReturnType<typeof importRoleText>) => {
    setBusy(true);
    setError(null);
    setReading(null);
    setFallback(null);
    setHandedTo(null);
    setSaid(null);
    await beforeImport();
    const r = await send();
    if (!r.ok) setError(r.error);
    else if (r.data.isCard) show(r.data);
    else await notACard(r.data.text);
    setBusy(false);
  };

  const fill = async () => {
    if (!reading) return;
    setBusy(true);
    setError(null);
    // A tick on a line a problem still blocks is never sent, whatever the box last said.
    const kept = new Set(Array.from(ticked).filter((p) => !isBlocked(p, reading.read.problems, answered)));
    const put = acceptOnly(reading.read.proposalBody, kept, reading.current, picks);
    const r = await saveProposal(proposal.id, put as ProposalUpdate);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onFilled(r.data.proposal);
    setReading(null);
    setSaid(RC_WORDS.filled);
  };

  const toggle = (path: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const hasRoles = proposal.roles.length + proposal.newRoles.length > 0;
  const tab = (m: Mode, label: string, Icon: typeof FileUp) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${FOCUS} ${
        mode === m ? "border-teal-deep bg-teal-deep text-white" : "border-stone-300 bg-white text-stone-800"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );

  // Problems no line of the list carries: the card as a whole, or a role it could not place.
  const loose = reading ? reading.read.problems.filter((p) => !reading.changes.some((c) => under(c.path)(p))) : [];

  return (
    <details className={`${PANEL} grid gap-3`} open={!hasRoles} data-bring-in="">
      <summary className={`flex min-h-[44px] cursor-pointer items-center font-display text-lg font-bold text-stone-900 ${FOCUS}`}>{RC_WORDS.bringIn}</summary>
      <div className="mt-2 grid gap-3">
        <p className={LEDE}>{RC_WORDS.bringInLede}</p>
        <p className="text-sm font-medium text-stone-800" data-keeps-nothing="">
          {RC_WORDS.keepsNothing(village)}
        </p>
        <div className="flex gap-2" role="group" aria-label={RC_WORDS.how}>
          {tab("file", RC_WORDS.fromFile, FileUp)}
          {tab("paste", RC_WORDS.fromPaste, ClipboardPaste)}
          {tab("link", RC_WORDS.fromLink, Link2)}
        </div>

        {mode === "file" && (
          <div className="grid gap-1">
            <div>
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={SECONDARY}>
                <FileUp className="h-4 w-4" aria-hidden="true" />
                {RC_WORDS.chooseFile}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".docx,.pdf,.md,.txt,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              data-role-file=""
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void bringIn(() => importRoleFile(proposal.id, file));
              }}
            />
            <p className="text-xs text-stone-600">{RC_WORDS.fileHint}</p>
          </div>
        )}
        {mode === "paste" && (
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {RC_WORDS.pasteLabel}
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} className={`${INPUT} font-mono text-sm`} data-role-paste="" />
            </label>
            <div>
              <button type="button" disabled={busy || !pasted.trim()} onClick={() => void bringIn(() => importRoleText(proposal.id, { text: pasted }))} className={PRIMARY}>
                {RC_WORDS.read}
              </button>
            </div>
          </div>
        )}
        {mode === "link" && (
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {RC_WORDS.linkLabel}
              <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/document/d/..." className={INPUT} data-role-link="" />
            </label>
            <p className="text-xs text-stone-600">{RC_WORDS.linkHint}</p>
            <div>
              <button type="button" disabled={busy || !link.trim()} onClick={() => void bringIn(() => importRoleText(proposal.id, { link }))} className={PRIMARY}>
                {RC_WORDS.fetchLink}
              </button>
            </div>
          </div>
        )}

        <div role="status" aria-live="polite" className="text-sm text-stone-700">
          {busy ? RC_WORDS.reading : said}
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-coral" data-import-error="">
            {error}
          </p>
        )}

        {handedTo && (
          <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-800" data-handed-to="">
            {RC_WORDS.guideReads(handedTo)}
          </p>
        )}
        {fallback && (
          <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3" data-ai-fallback="">
            <p className="text-sm text-stone-800">{RC_WORDS.fallback(village)}</p>
            <div>
              <button
                type="button"
                className={QUIET}
                onClick={async () => setSaid((await copyText(`${promptFor(proposal, org, village)}\n\n---\n\n${fallback.words}`)) ? RC_WORDS.copied : RC_WORDS.copyFailed)}
              >
                {RC_WORDS.copyBoth}
              </button>
            </div>
          </div>
        )}

        {reading && (
          <section aria-labelledby="rc-fills" className="grid gap-3" data-card-preview="">
            <h3 id="rc-fills" className="font-display text-lg font-bold text-stone-900">
              {RC_WORDS.whatFills}
            </h3>
            {loose.length > 0 && (
              <div role="alert" className="grid gap-1 rounded-xl border border-coral/40 bg-coral/5 p-3 text-sm" data-loose-problems="">
                <p className="font-semibold text-stone-900">{RC_WORDS.checkFirst}</p>
                <ul className="grid list-disc gap-1 pl-5">
                  {loose.map((p, i) => (
                    <li key={`${p.field}-${i}`} className="break-words text-stone-800">
                      {p.sentence}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reading.read.ignored.length > 0 && <p className="text-sm text-stone-600">{RC_WORDS.notRead(reading.read.ignored.join(", "))}</p>}
            {reading.changes.length === 0 ? (
              <p className={LEDE}>{RC_WORDS.nothingNew}</p>
            ) : (
              <>
                <p className={LEDE}>{RC_WORDS.fillsLede}</p>
                <ul className="grid gap-2">
                  {reading.changes.map((c) => {
                    const problems = reading.read.problems.filter(under(c.path));
                    const blocked = isBlocked(c.path, reading.read.problems, answered);
                    const circleAsked = c.kind === "role" && c.path.startsWith("newRoles.") && problems.some((p) => p.kind === "circle");
                    const on = ticked.has(c.path) && !blocked;
                    const title = c.roleTitle && c.kind !== "role" ? `${c.roleTitle}: ${c.label}` : c.label;
                    return (
                      <li key={c.path} data-change={c.path} data-ticked={on ? "true" : "false"} className={`min-w-0 rounded-xl border p-3 ${on ? "border-notice border-l-4 bg-notice/10" : "border-stone-200 bg-white"}`}>
                        <label className="flex min-h-[44px] items-start gap-3">
                          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-teal-deep" checked={on} disabled={blocked} onChange={() => toggle(c.path)} aria-label={RC_WORDS.keep(title)} />
                          <span className="grid min-w-0 gap-1">
                            <span className="break-words font-semibold text-stone-900">{title}</span>
                            {c.kind === "role" ? (
                              <>
                                <span className="text-xs font-semibold uppercase tracking-wide text-notice">{RC_WORDS.addsRole}</span>
                                {(c.words ?? [])
                                  .filter((w) => !w.path.endsWith(".name"))
                                  .map((w) => (
                                    <span key={w.path} className="grid gap-0.5 text-sm">
                                      <span className="font-medium text-stone-700">{w.label}</span>
                                      <span className="whitespace-pre-line break-words text-stone-800">{w.value}</span>
                                    </span>
                                  ))}
                              </>
                            ) : (
                              <span className="whitespace-pre-line break-words text-sm text-stone-800">{c.value ?? RC_WORDS.backToPosted}</span>
                            )}
                          </span>
                        </label>
                        {circleAsked && (
                          <label className="mt-2 grid gap-1 text-sm font-medium text-stone-800">
                            {RC_WORDS.pickCircle}
                            <select
                              value={picks[c.path] ?? ""}
                              onChange={(e) => {
                                const id = e.target.value;
                                setPicks((p) => ({ ...p, [c.path]: id }));
                                if (id) setTicked((t) => new Set(t).add(c.path));
                              }}
                              className={`${INPUT} min-h-[44px]`}
                            >
                              <option value="">{RC_WORDS.pickCircle}</option>
                              {circles.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {problems
                          .filter((p) => !(circleAsked && p.kind === "circle" && picks[c.path]))
                          .map((p, i) => (
                            <p key={`${p.field}-${i}`} className={`mt-2 break-words text-sm ${p.blocks ? "font-medium text-coral" : "text-stone-700"}`}>
                              {p.sentence}
                              {p.blocks && p.kind !== "circle" ? ` ${RC_WORDS.fix}` : ""}
                            </p>
                          ))}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || ticked.size === 0} onClick={() => void fill()} className={PRIMARY} data-fill-draft="">
                {RC_WORDS.fill}
              </button>
              <button type="button" onClick={() => setReading(null)} className={SECONDARY}>
                {RC_WORDS.notNow}
              </button>
            </div>
          </section>
        )}
      </div>
    </details>
  );
}
