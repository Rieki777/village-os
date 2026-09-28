/**
 * Adding to the notebook: paste text, or pick a file (plan 5.5).
 *
 * Pasted text goes as JSON; a file goes as a multipart form, whatever its
 * kind, and the server reads a `.md` or `.txt` as text and keeps a PDF or
 * Word file as it is. The form checks a pasted document with the SAME
 * validator the server runs, so a person meets one refusal for one mistake.
 */
import { useRef, useState, type FormEvent } from "react";
import {
  DOCUMENT_FILE_MAX_BYTES,
  DOCUMENT_WORDS,
  kindFromFileName,
  parseTextDocument,
} from "@shared/villageDocuments";
import { call } from "@/lib/notebookCopy";

const button =
  "text-sm font-medium rounded-lg px-3 py-1.5 text-white bg-teal-deep hover:opacity-90 disabled:opacity-40";
const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

export function NotebookAdd({ onAdded }: { onAdded: () => void | Promise<void> }) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const done = async (text: string) => {
    setSaid({ ok: true, text });
    setTitle("");
    setBody("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    await onAdded();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaid(null);
    if (mode === "paste") {
      const parsed = parseTextDocument({ kind: "paste", title, body });
      if (!parsed.ok) return setSaid({ ok: false, text: parsed.error });
      setBusy(true);
      const got = await call("POST", "/api/documents", { kind: "paste", title, body });
      setBusy(false);
      if (!got.ok) return setSaid({ ok: false, text: got.error });
      return done("Added. It is private: only you can read it.");
    }
    if (!file) return setSaid({ ok: false, text: "Pick a file to add." });
    if (!kindFromFileName(file.name)) return setSaid({ ok: false, text: DOCUMENT_WORDS.kindUnknown });
    if (file.size > DOCUMENT_FILE_MAX_BYTES) return setSaid({ ok: false, text: DOCUMENT_WORDS.fileTooBig });
    const form = new FormData();
    form.append("title", title);
    form.append("file", file, file.name);
    setBusy(true);
    const got = await call("POST", "/api/documents/file", form);
    setBusy(false);
    if (!got.ok) return setSaid({ ok: false, text: got.error });
    return done("Added. It is private: only you can read it.");
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-stone-200 p-4 space-y-3" data-testid="notebook-add">
      <fieldset className="flex flex-wrap gap-4 text-sm text-stone-900">
        <legend className="sr-only">How to add it</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="notebook-add-mode" checked={mode === "paste"} onChange={() => setMode("paste")} /> Paste text
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="notebook-add-mode" checked={mode === "file"} onChange={() => setMode("file")} /> Add a file
        </label>
      </fieldset>
      <label className="block text-sm font-medium text-stone-900">
        Title{mode === "file" ? " (leave it empty to use the file's name)" : ""}
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      {mode === "paste" ? (
        <label className="block text-sm font-medium text-stone-900">
          The text
          <textarea className={`${input} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      ) : (
        <label className="block text-sm font-medium text-stone-900">
          A Markdown, text, PDF or Word (.docx) file, up to {DOCUMENT_FILE_MAX_BYTES / (1024 * 1024)} MB
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx"
            className="mt-1 block w-full text-sm text-stone-700"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Adding" : "Add to my notebook"}
        </button>
        {said && (
          <p role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-stone-700" : "text-red-700"}`}>
            {said.text}
          </p>
        )}
      </div>
    </form>
  );
}
