/**
 * THE CANVAS IN PUBLIC: one line per block, on "How we work together"
 * (/governance; plan 2.3 "Content section canvas" and 4.6; 2026-09-28).
 *
 * Every block in canvas order, each with the canvas's own question, quoted
 * and credited, and the village's public line beneath it. A visitor reads
 * exactly that and nothing else: the lines come from GET /api/canvas/public,
 * which answers everybody alike.
 *
 * A signed-in member the village has admitted reads one thing more: the
 * village's words on each block that it keeps for its members, from
 * GET /api/canvas (`memberAnswers`). That door is members-only and also
 * carries the canvas's readings; this component never renders a reading, a
 * level or the radar, whoever is looking. The radar belongs to the Baseline
 * view alone (client/src/lib/canvasCopy.test.ts holds it there).
 *
 * Whoever holds the village's story (`mayRecord` on that same answer, the
 * gate's own decision) also gets a way to write each line. The server checks
 * every line for the names of people the village has admitted, and refuses
 * the line in words the form shows as they come.
 *
 * Held to the canvas's copy rules like every file in this directory: no
 * count of lines written, nothing combined across blocks, canvas order only.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { useAuth } from "@/contexts/AuthContext";
import type { CanvasPayload } from "@/lib/canvasCopy";
import { CANVAS_ORDER, type CanvasBlock, type CanvasBlockId } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_CREDIT, CANVAS_SOURCE_URL } from "@shared/governanceCanvasText";
import {
  CANVAS_PUBLIC_LINE_MAX,
  CANVAS_PUBLIC_PATH,
  parsePublicLine,
  type CanvasMemberAnswer,
  type CanvasPublicBlock,
} from "@shared/canvasPublicLines";

type LinesById = Partial<Record<CanvasBlockId, CanvasPublicBlock>>;
type AnswersById = Partial<Record<CanvasBlockId, CanvasMemberAnswer[]>>;

/** What a signed-in member's answer from GET /api/canvas adds to the page. */
interface MemberView {
  answers: AnswersById;
  mayWrite: boolean;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

function byId(blocks: readonly CanvasPublicBlock[]): LinesById {
  const out: LinesById = {};
  for (const b of blocks) out[b.id] = b;
  return out;
}

const BUTTON =
  "text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep bg-white hover:bg-stone-50 disabled:opacity-60";

function LineForm({
  block,
  current,
  onSaved,
  onCancel,
}: {
  block: CanvasBlock;
  current: string;
  onSaved: (saved: CanvasPublicBlock) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = `public-line-input-${block.id}`;
  const hintId = `public-line-hint-${block.id}`;

  const save = () => {
    const parsed = parsePublicLine({ line: text });
    if (!parsed.ok) return setError(parsed.error);
    setSaving(true);
    setError(null);
    fetch(`${CANVAS_PUBLIC_PATH}/${block.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ line: parsed.line }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d?.error === "string" && d.error ? d.error : "The line could not be saved just now.");
          return;
        }
        onSaved(d.block as CanvasPublicBlock);
      })
      .catch(() => setError("The line could not be saved just now."))
      .finally(() => setSaving(false));
  };

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      data-testid={`public-line-form-${block.id}`}
    >
      <label htmlFor={inputId} className="block text-sm font-medium text-stone-900">
        The public line for {block.name}
      </label>
      <p id={hintId} className="text-xs text-stone-600">
        Anyone can read this line, signed in or not. Name the role that does the work, never a person. Leave it
        empty and save to take the line down.
      </p>
      <input
        id={inputId}
        type="text"
        value={text}
        maxLength={CANVAS_PUBLIC_LINE_MAX}
        aria-describedby={hintId}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-deep"
      />
      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={BUTTON}>
          {saving ? "Saving" : "Save the line"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BlockLine({
  block,
  shown,
  answers,
  mayWrite,
  onSaved,
}: {
  block: CanvasBlock;
  shown: CanvasPublicBlock | undefined;
  answers: CanvasMemberAnswer[] | null;
  mayWrite: boolean;
  onSaved: (saved: CanvasPublicBlock) => void;
}) {
  const [writing, setWriting] = useState(false);
  const line = shown?.line ?? null;
  const withheld = !!shown?.withheld;

  return (
    <li
      className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5"
      data-testid={`public-line-${block.id}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Block {block.number}</p>
      <h3 className="font-display text-lg font-semibold text-teal-deep">{block.name}</h3>
      <blockquote cite={CANVAS_SOURCE_URL} className="mt-1 text-sm italic text-stone-700">
        {CANVAS_BLOCK_TEXT[block.id].question}
      </blockquote>

      {line ? (
        <p className="mt-3 text-stone-900 leading-relaxed border-l-2 border-teal-deep pl-3" data-testid={`public-line-text-${block.id}`}>
          {line}
        </p>
      ) : withheld ? (
        <p className="mt-3 text-sm text-stone-600">This block&apos;s public line is hidden for now.</p>
      ) : (
        <p className="mt-3 text-sm text-stone-600">Not written yet.</p>
      )}

      {withheld && mayWrite && (
        <p className="mt-2 text-xs text-stone-700" data-testid={`public-line-withheld-${block.id}`}>
          The line holds the name of someone in this village, so the public page hides it. Write it again with the role
          in place of the name.
        </p>
      )}

      {answers && answers[0] && (
        <details className="mt-3 text-sm" data-testid={`member-answers-${block.id}`}>
          <summary className="cursor-pointer font-medium text-teal-deep">What the village says to its members</summary>
          {answers.map((a) => (
            <div key={a.section} className="mt-2">
              <p className="text-xs font-medium text-stone-600">{a.title}</p>
              <p className="text-stone-800 whitespace-pre-line">{a.body}</p>
            </div>
          ))}
        </details>
      )}

      {mayWrite && !writing && (
        <button type="button" onClick={() => setWriting(true)} className={`mt-3 ${BUTTON}`}>
          {line || withheld ? "Change the public line" : "Write the public line"}
        </button>
      )}
      {mayWrite && writing && (
        <LineForm
          block={block}
          current={line ?? ""}
          onCancel={() => setWriting(false)}
          onSaved={(saved) => {
            setWriting(false);
            onSaved(saved);
          }}
        />
      )}
    </li>
  );
}

export default function CanvasPublicLines() {
  const { user } = useAuth();
  const [lines, setLines] = useState<LinesById | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [member, setMember] = useState<MemberView | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    fetch(CANVAS_PUBLIC_PATH)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.blocks)) {
          setFailed(typeof d?.error === "string" && d.error ? d.error : "The canvas's public lines could not be read just now.");
          return;
        }
        setLines(byId(d.blocks as CanvasPublicBlock[]));
      })
      .catch(() => setFailed("The canvas's public lines could not be read just now."));
  }, []);

  useEffect(load, [load]);

  // Only a signed-in person asks the members' door. A visitor's page never
  // calls it, so it cannot carry anything a visitor's browser would hold.
  useEffect(() => {
    if (!user) {
      setMember(null);
      return;
    }
    let alive = true;
    fetch("/api/canvas", { headers: headers() })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as CanvasPayload;
      })
      .then((payload) => {
        if (!alive || !payload) return;
        const answers: AnswersById = {};
        for (const b of payload.blocks) answers[b.id] = b.memberAnswers ?? [];
        setMember({ answers, mayWrite: !!payload.mayRecord });
      })
      .catch(() => {
        // The public lines still render; the members' words are simply absent.
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const saved = (block: CanvasPublicBlock) => setLines((prev) => ({ ...(prev ?? {}), [block.id]: block }));

  return (
    <div data-testid="canvas-public-lines">
      <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">Our Canvas, Block by Block</h2>
      <p className="text-stone-700 leading-relaxed">
        The Governance Canvas asks a group twelve questions about how it works together. Under each question is this
        village&apos;s answer in one public line. The lines name roles, never people.
      </p>
      <p className="mt-2 text-sm text-stone-600" data-testid="canvas-public-credit">
        The questions are quoted from the{" "}
        <a href={CANVAS_CREDIT.url} target="_blank" rel="noreferrer" className="font-medium text-stone-800 hover:underline">
          {CANVAS_CREDIT.text}
          <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
        </a>
        .
      </p>
      {member && (
        <p className="mt-2 text-sm text-stone-700" data-testid="canvas-member-note">
          You are signed in, so a block can also open the words the village keeps for its members. Visitors read the
          public lines only.
        </p>
      )}
      {member?.mayWrite && (
        <p className="mt-2 text-sm text-stone-700" data-testid="canvas-pen-note">
          You hold the village&apos;s story, so you can write these lines. Anyone can read them, signed in or not.
        </p>
      )}

      {failed ? (
        <div role="alert" className="mt-6 text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
          <p>{failed}</p>
          <button type="button" onClick={load} className={BUTTON}>
            Try again
          </button>
        </div>
      ) : !lines ? (
        <p className="mt-6 text-sm text-stone-600 py-4 text-center">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Reading the canvas
        </p>
      ) : (
        <ol className="mt-6 grid md:grid-cols-2 gap-4">
          {CANVAS_ORDER.map((block) => (
            <BlockLine
              key={block.id}
              block={block}
              shown={lines[block.id]}
              answers={member ? member.answers[block.id] ?? [] : null}
              mayWrite={!!member?.mayWrite}
              onSaved={saved}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
