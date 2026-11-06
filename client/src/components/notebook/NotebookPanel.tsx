/**
 * YOUR NOTEBOOK, under the canvas (plan 5.5 and 5.6; Wave 4, 2026-09-28).
 *
 * A member's own documents, the ones the village shared, the ones waiting
 * on the viewer's decision when they hold the village's story, and "Take
 * the canvas with you". Lazy-loaded by CanvasView, so none of it weighs on
 * the main bundle.
 *
 * Every document a member adds is private. The page says so above the form,
 * in the server's own sentence, and every row says how it stands.
 *
 * Light only, by ruling.
 */
import { useCallback, useEffect, useState } from "react";
import { BookOpen, FileText } from "lucide-react";
import { KIND_LABELS, STANDING_WORDS, type DocumentSummary } from "@shared/villageDocuments";
import { NOTEBOOK_WORDS, STANDING_SHORT, call, dayWords, sizeWords, type NotebookList } from "@/lib/notebookCopy";
import { NotebookAdd } from "./NotebookAdd";
import { NotebookDocument } from "./NotebookDocument";
import { NotebookExport } from "./NotebookExport";

function Row({ doc, onOpen, showOwner }: { doc: DocumentSummary; onOpen: (id: number) => void; showOwner: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-deep shrink-0" aria-hidden="true" />
          <span className="wrap-anywhere">{doc.title}</span>
        </p>
        <p className="text-xs text-stone-600 mt-0.5">
          {KIND_LABELS[doc.kind]}, {sizeWords(doc.kind, doc.size)}, added {dayWords(doc.createdAt)}
          {showOwner && doc.ownerName ? `, from ${doc.ownerName}` : ""}
          {doc.yours ? (
            <>
              {". "}
              <span title={STANDING_WORDS[doc.standing]}>{STANDING_SHORT[doc.standing]}</span>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpen(doc.id)}
        aria-label={`Open ${doc.title}`}
        className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50"
      >
        Open
      </button>
    </li>
  );
}

export default function NotebookPanel() {
  const [list, setList] = useState<NotebookList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const got = await call<NotebookList>("GET", "/api/documents");
    if (got.ok) {
      setList(got.data);
      setError(null);
    } else {
      setError(got.error);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !list) {
    return (
      <section data-testid="notebook" className="bg-white border border-stone-200 rounded-xl p-5">
        <h2 className="font-display text-xl font-semibold text-stone-900">{NOTEBOOK_WORDS.heading}</h2>
        <p className="text-sm text-stone-700 mt-2">{error}</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section data-testid="notebook" className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-stone-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-teal-deep" aria-hidden="true" /> {NOTEBOOK_WORDS.heading}
          </h2>
          <p className="text-sm text-stone-700 mt-1">{NOTEBOOK_WORDS.intro}</p>
          {list && <p className="text-sm font-medium text-stone-900 mt-2" data-testid="notebook-private-note">{list.privateNote}</p>}
        </div>

        <NotebookAdd onAdded={load} />

        {openId !== null && (
          <NotebookDocument
            id={openId}
            onClose={() => setOpenId(null)}
            onChanged={load}
            onDeleted={() => {
              setOpenId(null);
              void load();
            }}
          />
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-900">Yours</h3>
          {!list ? (
            <p className="text-sm text-stone-600">Reading your notebook.</p>
          ) : list.mine.length ? (
            <ul className="space-y-2">{list.mine.map((d) => <Row key={d.id} doc={d} onOpen={setOpenId} showOwner={false} />)}</ul>
          ) : (
            <p className="text-sm text-stone-600">{NOTEBOOK_WORDS.empty}</p>
          )}
        </div>

        {list && list.toDecide.length > 0 && (
          <div className="space-y-2" data-testid="notebook-to-decide">
            <h3 className="text-sm font-semibold text-stone-900">{NOTEBOOK_WORDS.decideHeading}</h3>
            <p className="text-xs text-stone-600">{NOTEBOOK_WORDS.decideIntro}</p>
            <ul className="space-y-2">{list.toDecide.map((d) => <Row key={d.id} doc={d} onOpen={setOpenId} showOwner />)}</ul>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-900">{NOTEBOOK_WORDS.sharedHeading}</h3>
          {list && list.shared.length ? (
            <ul className="space-y-2">{list.shared.map((d) => <Row key={d.id} doc={d} onOpen={setOpenId} showOwner />)}</ul>
          ) : (
            <p className="text-sm text-stone-600">{NOTEBOOK_WORDS.sharedEmpty}</p>
          )}
        </div>
        {error && list && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>

      <NotebookExport />
    </div>
  );
}
