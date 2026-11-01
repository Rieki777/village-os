/**
 * "LET AI HELP ME WITH THIS" on the words and season steps (Rye, 2026-10-24).
 *
 * It draws only when a guide can answer (GET /api/guide), and it always says
 * which guide is answering, with the other one a tap away when both can.
 *
 * A press, or a document brought in, asks the guide for one turn. Every
 * suggestion is marked Suggested and shows the sentence it came from; nothing
 * goes into a field until the member presses Use this, which puts the words
 * there exactly as typing does, so the member's own autosave keeps them. Leave
 * it drops a suggestion. Then the guide asks one question at a time, and an
 * answer asks the next turn. The guide never saves or submits, and the page
 * says the document is not kept.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import GuidePicker from "@/components/guide/GuidePicker";
import { fetchGuide } from "@/lib/guideApi";
import type { GuideState } from "@shared/guideChoice";
import { GUIDE_ANSWER_MAX, ROLE_GUIDE_WORDS, type GuideLine, type GuideSuggestion, type RoleGuideStep } from "@shared/roleGuide";
import type { GuideFlag } from "@shared/roleGuideChecks";
import { askGuide } from "./roleGuideApi";
import { EDIT_FIELDS } from "./roleWords";
import { INPUT, LEDE, PANEL, QUIET, SECONDARY } from "./parts";

const labelOf = (field: string): string =>
  EDIT_FIELDS.find((f) => f.field === field)?.label ?? (field === "seasonalGoals" ? "Season goals" : field === "aim" ? "Aim" : field);

const show = (w: string | string[]) => (Array.isArray(w) ? w.join("\n") : w);

export default function RoleGuidePanel({
  proposalId,
  step,
  villageName,
  document,
  accepts,
  onAccept,
}: {
  proposalId: string;
  step: RoleGuideStep;
  villageName: string;
  /** Text brought in from the member's document, when there is one. Never stored. */
  document?: string | null;
  /** Whether this place on the page can take a suggestion: the role on show, or the season's aim. */
  accepts: (s: GuideSuggestion) => boolean;
  /** The member pressed Use this: put the words where `path` says. */
  onAccept: (s: GuideSuggestion) => void;
}) {
  const [guide, setGuide] = useState<GuideState | null>(null);
  const [suggestions, setSuggestions] = useState<GuideSuggestion[]>([]);
  const [flags, setFlags] = useState<GuideFlag[]>([]);
  const [conversation, setConversation] = useState<GuideLine[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [answerName, setAnswerName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchGuide().then((g) => alive && setGuide(g));
    return () => {
      alive = false;
    };
  }, []);

  const turn = async (lines: GuideLine[], doc: string | null) => {
    setBusy(true);
    setError(null);
    const r = await askGuide(proposalId, { step, document: doc, conversation: lines });
    setBusy(false);
    setAsked(true);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAnswerName(r.answer.guide.name);
    setNote(r.answer.note);
    setSuggestions(r.answer.suggestions);
    setFlags(r.answer.flags);
    setQuestion(r.answer.question);
    setConversation(r.answer.question ? [...lines, { from: "guide", text: r.answer.question }] : lines);
  };

  // A document brought in asks at once, and is sent with that one turn only.
  useEffect(() => {
    if (document && guide?.answering) void turn([], document);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, guide?.answering]);

  if (!guide?.answering) return null;
  const name = guide.options.find((o) => o.id === guide.answering)?.name ?? "";
  const shared = guide.answering === "saberra" ? ROLE_GUIDE_WORDS.sharedWith.saberra(name) : ROLE_GUIDE_WORDS.sharedWith.village(name);

  const shown = suggestions.filter(accepts);

  const send = () => {
    const text = reply.trim().slice(0, GUIDE_ANSWER_MAX);
    if (!text) return;
    setReply("");
    void turn([...conversation, { from: "member", text }], null);
  };

  return (
    <section className={`${PANEL} grid gap-3`} data-role-guide={step} aria-label={ROLE_GUIDE_WORDS.open}>
      <GuidePicker state={guide} onChange={setGuide} />
      <p className={LEDE}>
        {shared} {ROLE_GUIDE_WORDS.kept(villageName)}
      </p>
      {!asked && (
        <div>
          <button type="button" className={QUIET} disabled={busy} onClick={() => void turn([], null)}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {ROLE_GUIDE_WORDS.open}
          </button>
        </div>
      )}
      {busy && (
        <p className="text-sm text-stone-600" role="status">
          {ROLE_GUIDE_WORDS.thinking(answerName ?? name)}
        </p>
      )}
      {error && (
        <p className="text-sm text-stone-700" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-sm text-stone-700">{note}</p>}

      {flags.length > 0 && (
        <ul className="grid gap-1 text-sm text-stone-700" data-guide-flags>
          {flags.map((f, i) => (
            <li key={`${f.kind}-${i}`} className="rounded-lg bg-amber-50 px-3 py-2">
              {f.sentence}
            </li>
          ))}
        </ul>
      )}

      {shown.length > 0 && (
        <ul className="grid gap-2" data-guide-suggestions>
          {shown.map((s) => (
            <li key={s.path} className="grid gap-1.5 rounded-lg border border-stone-200 bg-white p-3 text-sm" data-suggestion={s.path}>
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <span className="rounded-full bg-teal-deep/10 px-2 py-0.5 text-teal-deep">{ROLE_GUIDE_WORDS.suggested}</span>
                {s.role ? `${s.role}: ` : ""}
                {labelOf(s.field)}
              </p>
              <p className="whitespace-pre-line break-words text-stone-900">{show(s.words)}</p>
              <p className="text-xs text-stone-600">
                {s.source ? (
                  <>
                    {ROLE_GUIDE_WORDS.from} <q>{s.source}</q>
                  </>
                ) : (
                  ROLE_GUIDE_WORDS.fromKnown
                )}
              </p>
              {s.problem && <p className="text-xs font-medium text-coral">{s.problem}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={QUIET}
                  disabled={!!s.problem}
                  onClick={() => {
                    onAccept(s);
                    setSuggestions((list) => list.filter((x) => x.path !== s.path));
                  }}
                >
                  {ROLE_GUIDE_WORDS.accept}
                </button>
                <button type="button" className={QUIET} onClick={() => setSuggestions((list) => list.filter((x) => x.path !== s.path))}>
                  {ROLE_GUIDE_WORDS.leave}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {asked && !busy && !error && !question && shown.length === 0 && <p className={LEDE}>{ROLE_GUIDE_WORDS.nothingMissing}</p>}

      {question && (
        <div className="grid gap-2" data-guide-question>
          <p className="text-sm font-medium text-stone-900">
            {ROLE_GUIDE_WORDS.asks(answerName ?? name)} {question}
          </p>
          <label className="grid gap-1 text-sm text-stone-700">
            {ROLE_GUIDE_WORDS.answer}
            <textarea className={INPUT} rows={3} value={reply} maxLength={GUIDE_ANSWER_MAX} onChange={(e) => setReply(e.target.value)} />
          </label>
          <div>
            <button type="button" className={SECONDARY} disabled={busy || !reply.trim()} onClick={send}>
              {ROLE_GUIDE_WORDS.send}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
