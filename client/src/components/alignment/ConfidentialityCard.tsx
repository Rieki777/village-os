/**
 * THE CONFIDENTIALITY AGREEMENT ON /aligned (role journey L7).
 *
 * The village's own words, the version the page drew, and one Align button that
 * asks the identity re-confirm first (the alignments door's panel, reused by
 * AlignButton). A member already holding these exact words reads that they do;
 * one who aligned with earlier words reads that the words changed and is asked
 * again. A village that wrote no agreement shows nothing here.
 */
import { useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { ALIGN_WORDS } from "@shared/alignments";
import { CONFIDENTIALITY_WORDS } from "@shared/confidentiality";
import AlignButton from "./AlignButton";
import { alignConfidentiality, fetchConfidentiality, openAgreementDocument } from "./alignmentsApi";

type Agreement = { title: string; body: string; intent: string; version: string; document: { title: string; size: number; href: string } | null };

export default function ConfidentialityCard() {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [holds, setHolds] = useState(false);
  const [alignedAt, setAlignedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchConfidentiality().then((a) => {
      if (!alive || !a.ok) return;
      setAgreement(a.data.agreement);
      setHolds(!!a.data.you?.holds);
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  if (!agreement) return null;
  return (
    <section id="confidentiality" aria-labelledby="confidentiality-h" data-confidentiality="" className="mb-8 rounded-xl border border-border bg-card p-6 text-card-foreground">
      <h2 id="confidentiality-h" className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
        <ShieldCheck className="size-5 shrink-0 text-notice" aria-hidden="true" />
        {CONFIDENTIALITY_WORDS.heading(agreement.title)}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {CONFIDENTIALITY_WORDS.lede} {ALIGN_WORDS.waysOfSigning}
      </p>
      {agreement.document && (
        <div data-agreement-document="" className="mt-3">
          <button
            type="button"
            onClick={() => void openAgreementDocument(agreement.document!.href).then((ok) => !ok && setNotice(CONFIDENTIALITY_WORDS.unreadable))}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <FileText className="size-4" aria-hidden="true" />
            {CONFIDENTIALITY_WORDS.readDocument(agreement.document.title)}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{CONFIDENTIALITY_WORDS.documentNote}</p>
        </div>
      )}
      <details className="mt-3 rounded-lg border border-border bg-background p-3 text-sm text-foreground">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{agreement.title}</summary>
        <div className="mt-2 whitespace-pre-line break-words">{agreement.body}</div>
      </details>
      <div className="mt-4">
        {holds && !alignedAt ? (
          <p data-aligned="" className="text-sm font-semibold text-foreground">
            {CONFIDENTIALITY_WORDS.aligned}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">{CONFIDENTIALITY_WORDS.asYou}</p>
            <AlignButton
              sentence={agreement.intent}
              alignedAt={alignedAt}
              onAlign={async () => {
                const a = await alignConfidentiality(agreement.version);
                // The words moved while they read: show the new ones.
                if (!a.ok && a.status === 409) {
                  setNotice(CONFIDENTIALITY_WORDS.changed);
                  setReload((n) => n + 1);
                }
                return a;
              }}
              onDone={(d) => {
                setNotice("");
                setAlignedAt(typeof d?.alignedAt === "string" ? d.alignedAt : new Date().toISOString());
              }}
            />
          </>
        )}
        {notice && (
          <p role="status" className="mt-2 text-sm text-foreground">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
