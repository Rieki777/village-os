/**
 * THE CONFIDENTIALITY AGREEMENT'S DOCUMENT, IN ADMIN (role journey L7).
 *
 * Beside the agreement's words, the PDF the agreement is: a title and a file.
 * The title is the village's own: blank takes the file's own name. Attaching a
 * new file is new words, so every holder is asked to align again; the panel
 * says so before anybody presses the button.
 *
 * The file never reaches a public door. It is kept outside the uploads volume
 * and read only by a signed-in member at the step where they align
 * (server/routes/confidentiality.ts).
 */
import { useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { API_BASE, authHeaders, refusal } from "./adminApi";

type Attached = { title: string; sha256: string; size: number } | null;

export default function AgreementDocumentUpload({ password }: { password: string }) {
  const { t } = useLingui();
  const [doc, setDoc] = useState<Attached>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/admin/confidentiality/document`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setDoc(d.document ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [password]);

  const attach = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("file", file);
      const res = await fetch(`${API_BASE}/admin/confidentiality/document`, { method: "POST", headers: authHeaders(password), body: form });
      const d = await res.json().catch(() => null);
      const status = res.status;
      if (!res.ok) setError(refusal(d, t`The document was not attached (${status}). Nothing changed.`));
      else {
        setDoc(d?.document ?? null);
        setFile(null);
        setTitle("");
        setMessage(t`Attached. Every holder is asked to align again with the agreement as it reads now.`);
      }
    } catch {
      setError(t`This upload did not reach the server. Nothing changed.`);
    }
    setBusy(false);
  };

  const docTitle = doc?.title ?? "";
  const kb = doc ? Math.max(1, Math.round(doc.size / 1024)) : 0;
  return (
    <section aria-labelledby="agreement-doc-h" data-agreement-document="" className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h3 id="agreement-doc-h" className="flex items-center gap-2 text-sm font-bold text-gray-900">
        <FileText className="size-4" aria-hidden="true" />
        {t({ message: "The agreement's document", context: "admin confidentiality section" })}
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        {doc ? t({ message: `Attached: ${docTitle} (${kb} KB).`, context: "admin confidentiality section" }) : t`No document attached yet.`} {t`Members read it only when they are signed in to align. It is never on a public page.`}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="agreement-doc-title" className="mb-1 block text-xs font-medium text-gray-900">
            {t({ message: "Document title", context: "admin confidentiality section" })}
          </label>
          <input
            id="agreement-doc-title"
            type="text"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={file ? file.name.replace(/\.pdf$/i, "") : t`Blank takes the file's name`}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
        </div>
        <div>
          <label htmlFor="agreement-doc-file" className="mb-1 block text-xs font-medium text-gray-900">
            {t({ message: "The PDF", context: "admin confidentiality section" })}
          </label>
          <input id="agreement-doc-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-600">{t`Attaching a new document changes the agreement, so everybody who aligned is asked to align again.`}</p>
      <button
        type="button"
        onClick={() => void attach()}
        disabled={busy || !file}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-deep px-4 text-sm font-medium text-white hover:bg-teal-deep-dark disabled:opacity-50"
      >
        <Upload className="size-4" aria-hidden="true" />
        {busy ? t({ message: "Attaching...", context: "admin confidentiality section" }) : doc ? t`Attach a new document` : t({ message: "Attach the document", context: "admin confidentiality section" })}
      </button>
      {message && (
        <p role="status" className="mt-2 text-sm text-gray-900">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
