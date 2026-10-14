/**
 * ENDING ALIGNED TERMS, FROM THE CARD (seat settings PR8).
 *
 * What a party may do about terms in force: give notice, ask to end by
 * agreement, or take either back before it takes effect. The server says what
 * this reader may do (`you.acts`, and `village` for a live holder of the
 * seating power who is not the candidate); this draws only that, so a button
 * never appears for an act the server would refuse.
 *
 * Both acts ask once more before they land, with the sentence that says what
 * happens: notice ends the terms after their own notice days and unseats
 * nobody; agreement ends them once every party asks.
 */
import { useState } from "react";
import { ENDINGS_WORDS } from "@shared/alignments";
import { endByAgreement, giveNotice, takeBackEnding, type PartyActs } from "./alignmentsApi";

const button =
  "inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center rounded-lg bg-notice px-3 text-sm font-semibold text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const quiet = "inline-flex min-h-11 items-center px-2 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

function PartyEnding({
  textId,
  acts,
  noticeDays,
  asVillage,
  onDone,
}: {
  textId: string;
  acts: PartyActs;
  noticeDays: number;
  asVillage: boolean;
  onDone?: () => void;
}) {
  const [asking, setAsking] = useState<"notice" | "agreement" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (go: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError("");
    const a = await go();
    setBusy(false);
    if (!a.ok) {
      setError(a.error ?? "That did not go through. Try again.");
      return;
    }
    setAsking(null);
    onDone?.();
  };
  const result = (p: Promise<{ ok: true } | { ok: false; error: string }>) => p.then((a) => (a.ok ? { ok: true } : { ok: false, error: a.error }));

  if (!acts.notice && !acts.ask && !acts.mayGiveNotice && !acts.mayEndByAgreement) return null;
  return (
    <div data-ending-actions={asVillage ? "village" : "you"} className="space-y-2">
      {asVillage && <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{ENDINGS_WORDS.forTheVillage}</p>}

      {acts.notice && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">{asVillage ? ENDINGS_WORDS.villageNotice(acts.notice.endsOn) : ENDINGS_WORDS.yourNotice(acts.notice.endsOn)}</p>
          <button type="button" disabled={busy} className={quiet} onClick={() => void run(() => result(takeBackEnding(textId, acts.notice!.id, asVillage)))}>
            {ENDINGS_WORDS.takeBackNotice}
          </button>
        </div>
      )}
      {acts.ask && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">{asVillage ? ENDINGS_WORDS.villageAsked : ENDINGS_WORDS.youAsked}</p>
          <button type="button" disabled={busy} className={quiet} onClick={() => void run(() => result(takeBackEnding(textId, acts.ask!.id, asVillage)))}>
            {ENDINGS_WORDS.takeBackAsk}
          </button>
        </div>
      )}

      {asking === null && (acts.mayGiveNotice || acts.mayEndByAgreement) && (
        <div className="flex flex-wrap gap-2">
          {acts.mayGiveNotice && (
            <button type="button" className={button} onClick={() => setAsking("notice")}>
              {asVillage ? ENDINGS_WORDS.giveNoticeFor : ENDINGS_WORDS.giveNotice}
            </button>
          )}
          {acts.mayEndByAgreement && (
            <button type="button" className={button} onClick={() => setAsking("agreement")}>
              {asVillage ? ENDINGS_WORDS.endByAgreementFor : ENDINGS_WORDS.endByAgreement}
            </button>
          )}
        </div>
      )}

      {asking !== null && (
        <div role="group" aria-label={asking === "notice" ? ENDINGS_WORDS.giveNotice : ENDINGS_WORDS.endByAgreement} className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-sm text-foreground">{asking === "notice" ? ENDINGS_WORDS.noticeLine(noticeDays) : ENDINGS_WORDS.agreementLine}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={primary}
              onClick={() => void run(() => result(asking === "notice" ? giveNotice(textId, asVillage) : endByAgreement(textId, asVillage)))}
            >
              {asking === "notice" ? ENDINGS_WORDS.confirmNotice : ENDINGS_WORDS.endByAgreement}
            </button>
            <button type="button" disabled={busy} className={quiet} onClick={() => setAsking(null)}>
              {ENDINGS_WORDS.cancel}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The acts for the reader's own party, and for the village when they may act for it. */
export default function EndingActions({
  textId,
  you,
  village,
  noticeDays,
  onDone,
}: {
  textId: string;
  you: PartyActs | null | undefined;
  village: PartyActs | null | undefined;
  noticeDays: number;
  onDone?: () => void;
}) {
  if (!you && !village) return null;
  return (
    <div className="mt-4 space-y-3 border-t border-border/50 pt-3">
      {you && <PartyEnding textId={textId} acts={you} noticeDays={noticeDays} asVillage={false} onDone={onDone} />}
      {village && <PartyEnding textId={textId} acts={village} noticeDays={noticeDays} asVillage onDone={onDone} />}
    </div>
  );
}
