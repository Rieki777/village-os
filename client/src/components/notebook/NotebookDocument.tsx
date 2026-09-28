/**
 * ONE OPEN DOCUMENT: read it, and for its owner, share it or delete it; for
 * anybody who may read a text document, draft canvas words from it (plan 5.5).
 *
 * The text renders as text in a pre-wrapped block, never as HTML, so a
 * document cannot put markup on the page.
 *
 * "Draft from this document" shows what the splitter (or, with the owner's
 * yes, a model) would suggest for each block, and files only the blocks the
 * member leaves ticked. The server files its own copy of the words, so what
 * is filed is exactly what was drafted.
 */
import { useCallback, useEffect, useState } from "react";
import { CANVAS_BLOCKS, CANVAS_ORDER, isCanvasBlockId, type CanvasBlockId } from "@shared/governanceCanvas";
import { servesPurposeScoped } from "@shared/canvasFrames";
import { KIND_LABELS, STANDING_WORDS } from "@shared/villageDocuments";
import { NOTEBOOK_WORDS, call, dayWords, downloadStored, type DraftAnswer, type OpenDocument } from "@/lib/notebookCopy";

const quiet = "text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50 disabled:opacity-40";
const solid = "text-sm font-medium rounded-lg px-3 py-1.5 text-white bg-teal-deep hover:bg-teal-deep-dark disabled:opacity-40";
const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

type Said = { ok: boolean; text: string } | null;

function Note({ said }: { said: Said }) {
  if (!said) return null;
  return (
    <p role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-stone-700" : "text-red-700"}`}>
      {said.text}
    </p>
  );
}

function ShareForm({ id, onShared }: { id: number; onShared: () => void }) {
  const [blockId, setBlockId] = useState<CanvasBlockId | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  const send = async () => {
    if (!blockId) return setSaid({ ok: false, text: "Say which block of the canvas this document speaks to." });
    setBusy(true);
    const got = await call<{ message: string }>("POST", `/api/documents/${id}/share`, { blockId, note });
    setBusy(false);
    if (!got.ok) return setSaid({ ok: false, text: got.error });
    setSaid({ ok: true, text: got.data.message });
    onShared();
  };
  return (
    <details className="rounded-lg border border-stone-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-teal-deep">Share with the village</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-stone-600">{NOTEBOOK_WORDS.shareIntro}</p>
        <label className="block text-sm font-medium text-stone-900">
          The block it speaks to
          <select className={field} value={blockId} onChange={(e) => setBlockId(isCanvasBlockId(e.target.value) ? e.target.value : "")}>
            <option value="">Choose a block</option>
            {CANVAS_ORDER.map((b) => (
              <option key={b.id} value={b.id}>
                {b.number}. {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-stone-900">
          A note for whoever decides (optional)
          <textarea className={`${field} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={solid} disabled={busy} onClick={send}>
            Ask to share it
          </button>
          <Note said={said} />
        </div>
      </div>
    </details>
  );
}

function DraftView({ id, open }: { id: number; open: OpenDocument }) {
  const [answer, setAnswer] = useState<DraftAnswer | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [lines, setLines] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  const model = open.model;

  const draft = async (mode: "words" | "model") => {
    setSaid(null);
    setBusy(true);
    const got = await call<DraftAnswer>("POST", `/api/documents/${id}/draft`, mode === "model" && consent ? { mode, consent: true } : { mode });
    setBusy(false);
    if (!got.ok) {
      if (got.data?.needsConsent) setDisclosure(String(got.data.disclosure ?? ""));
      return setSaid({ ok: false, text: got.error });
    }
    setAnswer(got.data);
    setChosen(Object.fromEntries(got.data.draft.items.map((i) => [i.blockId, true])));
    if (mode === "model" && !got.data.read) setSaid({ ok: false, text: "The model's answer could not be read, so nothing was drafted. The words-only draft still works." });
  };

  const file = async () => {
    if (!answer) return;
    const blocks = answer.draft.items.filter((i) => chosen[i.blockId]).map((i) => i.blockId);
    if (!blocks.length) return setSaid({ ok: false, text: "Tick at least one block to file." });
    setBusy(true);
    const got = await call<{ filed: Array<{ blockId: string }>; refused: Array<{ blockId: string; error: string }> }>(
      "POST",
      `/api/documents/${id}/draft/file`,
      { blocks, draftId: answer.draftId ?? undefined, servesPurpose: lines },
    );
    setBusy(false);
    const data = got.ok ? got.data : got.data;
    const filed = (data?.filed ?? []).map((f: { blockId: string }) => CANVAS_BLOCKS[f.blockId as CanvasBlockId]?.name ?? f.blockId);
    const refused = (data?.refused ?? []).map((r: { blockId: string; error: string }) => `${CANVAS_BLOCKS[r.blockId as CanvasBlockId]?.name ?? r.blockId}: ${r.error}`);
    if (!got.ok && !refused.length) return setSaid({ ok: false, text: got.error });
    setSaid({
      ok: filed.length > 0,
      text: [filed.length ? `Filed as suggestions on ${filed.join(", ")}. Each waits on its block's Adopt frame.` : "", ...refused].filter(Boolean).join(" "),
    });
  };

  const showDisclosure = model?.available && !model.consented ? disclosure ?? model.sentence : null;

  return (
    <details className="rounded-lg border border-stone-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-teal-deep">Draft canvas words from this document</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-stone-600">{NOTEBOOK_WORDS.draftIntro}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={quiet} disabled={busy} onClick={() => void draft("words")}>
            Draft with words only
          </button>
          {model?.available && (
            <button type="button" className={quiet} disabled={busy || (!model.consented && !consent)} onClick={() => void draft("model")}>
              Draft with a model
            </button>
          )}
        </div>
        {showDisclosure && (
          <label className="flex items-start gap-2 text-sm text-stone-900" data-testid="notebook-model-disclosure">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>{showDisclosure} Yes, send this document's text.</span>
          </label>
        )}
        {answer && (
          <div className="space-y-3" data-testid="notebook-draft">
            {answer.draft.items.length === 0 && <p className="text-sm text-stone-700">Nothing in this document matched a block of the canvas.</p>}
            {answer.draft.items.map((item) => {
              const scoped = servesPurposeScoped(item.blockId, "words");
              return (
                <div key={item.blockId} className="rounded-lg bg-stone-50 px-3 py-2 space-y-1">
                  <label className="flex items-center gap-2 text-sm font-medium text-stone-900">
                    <input
                      type="checkbox"
                      checked={!!chosen[item.blockId]}
                      onChange={(e) => setChosen((c) => ({ ...c, [item.blockId]: e.target.checked }))}
                    />
                    {CANVAS_BLOCKS[item.blockId].number}. {CANVAS_BLOCKS[item.blockId].name}
                  </label>
                  <p className="text-xs text-stone-600">{item.why}</p>
                  <details>
                    <summary className="cursor-pointer text-xs text-teal-deep">Read the drafted words</summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-stone-800 max-h-60 overflow-y-auto">{item.body}</p>
                  </details>
                  {scoped && answer.purposeWritten && (
                    <label className="block text-xs font-medium text-stone-900">
                      How this serves the village's purpose, in one line
                      <input className={field} value={lines[item.blockId] ?? ""} onChange={(e) => setLines((l) => ({ ...l, [item.blockId]: e.target.value }))} />
                    </label>
                  )}
                </div>
              );
            })}
            {answer.draft.gaps.length > 0 && (
              <div className="text-xs text-stone-700 space-y-1">
                <p className="font-medium text-stone-900">What the document does not answer yet</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {answer.draft.gaps.map((g) => (
                    <li key={g.blockId}>
                      {CANVAS_BLOCKS[g.blockId].name}: {g.questions.join(" ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {answer.draft.noSection.length > 0 && (
              <p className="text-xs text-stone-600">
                {answer.draft.noSection.map((b) => CANVAS_BLOCKS[b].name).join(", ")} has no section of words to suggest into yet.
              </p>
            )}
            {answer.draft.items.length > 0 && (
              <button type="button" className={solid} disabled={busy} onClick={() => void file()}>
                File the ticked ones as suggestions
              </button>
            )}
          </div>
        )}
        <Note said={said} />
      </div>
    </details>
  );
}

export function NotebookDocument({
  id,
  onClose,
  onChanged,
  onDeleted,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState<OpenDocument | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const got = await call<OpenDocument>("GET", `/api/documents/${id}`);
    if (got.ok) setOpen(got.data);
    else setSaid({ ok: false, text: got.error });
  }, [id]);
  useEffect(() => {
    setOpen(null);
    setSaid(null);
    setConfirming(false);
    void load();
  }, [load]);

  const remove = async () => {
    const got = await call("DELETE", `/api/documents/${id}`);
    if (!got.ok) return setSaid({ ok: false, text: got.error });
    onDeleted();
  };

  const doc = open?.document;
  return (
    <article className="rounded-lg border border-teal-deep/40 p-4 space-y-3" data-testid="notebook-document" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-stone-900 wrap-anywhere">{doc?.title ?? "Opening the document"}</h3>
          {doc && (
            <p className="text-xs text-stone-600">
              {KIND_LABELS[doc.kind]}, added {dayWords(doc.createdAt)}. {doc.yours ? STANDING_WORDS[doc.standing] : doc.standing === "shared" ? STANDING_WORDS.shared : "Its owner asked to share it."}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className={quiet}>
          Close
        </button>
      </div>
      {open && open.body !== null && (
        <div className="whitespace-pre-wrap text-sm text-stone-800 max-h-96 overflow-y-auto rounded-lg bg-stone-50 px-3 py-2" data-testid="notebook-document-body">
          {open.body}
        </div>
      )}
      {open && open.body === null && doc && (
        <button
          type="button"
          className={quiet}
          onClick={async () => {
            const problem = await downloadStored(doc.id, open.fileName ?? `document.${doc.kind}`);
            if (problem) setSaid({ ok: false, text: problem });
          }}
        >
          Save the file to this device
        </button>
      )}
      {open && doc && doc.yours && doc.standing === "private" && (
        <ShareForm
          id={doc.id}
          onShared={() => {
            void load();
            void onChanged();
          }}
        />
      )}
      {open && open.body !== null && <DraftView id={id} open={open} />}
      {open && doc?.yours && (
        <div className="flex flex-wrap items-center gap-3">
          {!confirming ? (
            <button type="button" className={quiet} onClick={() => setConfirming(true)}>
              Delete this document
            </button>
          ) : (
            <>
              <button type="button" className="text-sm font-medium rounded-lg px-3 py-1.5 text-white bg-red-700 hover:bg-red-800" onClick={() => void remove()}>
                Delete it for good
              </button>
              <button type="button" className={quiet} onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <p className="text-xs text-stone-600">
                {doc.standing === "shared" ? "It leaves the village's notebook too." : "Nobody can bring it back."}
              </p>
            </>
          )}
        </div>
      )}
      <Note said={said} />
    </article>
  );
}
