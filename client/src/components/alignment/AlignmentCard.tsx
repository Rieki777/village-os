/**
 * ONE TEXT AND WHERE ITS PARTIES STAND (seat settings PR5).
 *
 * The exact words, as stored, then a chip per party, then what the reader can
 * do: Align when they are a party who has not, the date they aligned when
 * they have, and the receipt. Used on /seat-applications/:id and in the
 * profile's "What you have aligned with".
 *
 * An application from before PR5 has no text yet (`retrofit`): its words are
 * rendered from the stored, never-updated terms, and the candidate's Align
 * sends those words back so the server writes the text it showed.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { ALIGN_WORDS, intentSentence } from "@shared/alignments";
import AlignButton from "./AlignButton";
import { AlignedStamp, PartyChips, StateTag } from "./AlignmentMarks";
import { alignWithApplication, alignWithText, downloadReceipt, type ServedAlignment } from "./alignmentsApi";

export default function AlignmentCard({
  alignment,
  applicationId = null,
  onChanged,
  headingLevel = 2,
  showWords = true,
}: {
  alignment: ServedAlignment;
  applicationId?: string | null;
  onChanged?: () => void;
  headingLevel?: 2 | 3;
  showWords?: boolean;
}) {
  const [receiptError, setReceiptError] = useState("");
  const H = headingLevel === 2 ? "h2" : "h3";
  const a = alignment;
  const mayAlign = !!a.you?.mayAlign && (!!(a.textId && a.contentHash) || (!!a.retrofit && !!applicationId));

  return (
    <section data-alignment-card="" aria-label={a.title} className="sheet-night rounded-2xl border border-border bg-card p-5 text-card-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {/* The title takes its own line on a phone, so the state and the stamp never squeeze it to one word a line. */}
        <H className="min-w-0 basis-full font-display text-lg font-bold text-foreground sm:basis-auto sm:flex-1">{a.title}</H>
        <StateTag state={a.state} />
        {a.state === "in-force" && <AlignedStamp sealed={a.sealed} />}
      </div>
      {a.why && a.state !== "in-force" && <p className="mt-1 text-sm text-muted-foreground">{a.why}</p>}

      {showWords && (
        <pre
          data-alignment-words=""
          className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background/40 p-4 font-sans text-sm leading-relaxed text-foreground"
        >
          {a.body}
        </pre>
      )}

      <div className="mt-3">
        <PartyChips parties={a.parties} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {a.you && (a.you.aligned || mayAlign) && (
          <AlignButton
            sentence={intentSentence(a.seatNames)}
            alignedAt={a.you.aligned ? a.you.alignedAt : null}
            onAlign={() =>
              a.textId && a.contentHash ? alignWithText(a.textId, a.contentHash) : alignWithApplication(String(applicationId), a.body)
            }
            onDone={() => onChanged?.()}
          />
        )}
        {a.you && a.textId && (
          <button
            type="button"
            onClick={() => {
              setReceiptError("");
              void downloadReceipt(a.textId!).then((ok) => {
                if (!ok) setReceiptError("The receipt could not be downloaded. Try again.");
              });
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground underline underline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Download className="size-4" aria-hidden="true" />
            {ALIGN_WORDS.receipt}
          </button>
        )}
      </div>
      {receiptError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {receiptError}
        </p>
      )}
    </section>
  );
}
