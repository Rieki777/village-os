/**
 * THE ADOPT FRAME: the suggestions open on one canvas block, and the pen's
 * decision on each (plan 2.3, "Three pens"; Wave 3b, 2026-09-28).
 *
 * Every open suggestion shows who made it and when, what it would change,
 * what adopting it would do TODAY, and who decides. What adopting does
 * changes at the Birthing, and the frame says which side of it the village is
 * on: before it, a suggestion that names a setting writes the setting; after
 * it, a dial, module, exit-term or matrix suggestion is filed as a proposal in
 * its author's name, and only the author is offered that button
 * (`adoptEffect`, client/src/lib/canvasFramesCopy.ts).
 *
 * BUTTONS ONLY WHERE THEY WILL WORK. The server answers `pen.youMayAdopt` for
 * this viewer on each suggestion, and the page offers:
 *
 *   Adopt     where `youMayAdopt` is true
 *   Decline   to the pen acting alone, on somebody else's suggestion, with a
 *             note of at least two characters (the route's own rule)
 *   Withdraw  to the member who made it, at any time
 *
 * Every other viewer reads who decides and nothing to press. The write still
 * asks the real guard, and a refusal is printed in the server's own words.
 *
 * NOTES ARE PUBLIC (Rye, 2026-09-23), and the note box says so above itself,
 * before anybody types (for the four administrators' sections, who reads it
 * instead: `noteReaders`). A DECIDED suggestion stays readable: "Decided
 * lately" lists the block's decided suggestions with who decided each, when,
 * and the note, and the member who made one is told by a notice. Before that
 * list existed the note box promised readers the server never served (audit
 * of Wave 3b, 2026-09-28).
 */
import { useState } from "react";
import { Link } from "wouter";
import { Trans, useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import {
  adoptEffect,
  adoptIntro,
  adoptLabel,
  changeLines,
  decidedLine,
  dialOf,
  mayAdopt as mayAdoptHere,
  mayDecline,
  noteReaders,
  opensPurposeVote,
  penSentences,
  proposalHeadline,
  refusalText,
  sectionTitlesOf,
  suggestedLine,
  type BlockFramesPayload,
  type DecidedView,
  type FrameId,
  type ProposalView,
} from "@/lib/canvasFramesCopy";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** The purpose statement's change vote is opened from the proposal wizard. */
const PURPOSE_CHANGE_DOOR = "/api/governance/purpose-changes";

export function CanvasFrameAdopt({
  payload,
  onChanged,
  onGoTo,
}: {
  payload: BlockFramesPayload;
  onChanged: (message?: string) => void;
  onGoTo: (frame: FrameId) => void;
}) {
  const { t } = useLingui();
  const name = payload.block.name;
  const titles = sectionTitlesOf(payload.answer.sections);
  const pens = penSentences(payload.pens);
  return (
    <section aria-label={t({ message: `Adopt: suggestions on ${name}`, context: "the Adopt frame of a canvas block" })} className="space-y-4 text-sm">
      <p className="text-stone-800" data-testid="canvas-adopt-moment">
        {adoptIntro(payload.birthed)}
      </p>
      {pens.length > 0 && (
        <div>
          <h4 className="font-semibold text-stone-900">
            <Trans>Who adopts on this block</Trans>
          </h4>
          <ul className="mt-1 space-y-1 list-disc pl-5 text-stone-700">
            {pens.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {payload.proposals.length > 0 ? (
        <ul className="space-y-3" data-testid="canvas-adopt-proposals">
          {payload.proposals.map((p) => (
            <li key={p.id}>
              <ProposalCard p={p} payload={payload} titles={titles} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          <p className="text-stone-700">
            <Trans>No suggestions are open on {name}.</Trans>
          </p>
          <button
            type="button"
            onClick={() => onGoTo("say")}
            className="text-sm font-medium rounded-lg px-3 min-h-[44px] text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
          >
            <Trans>Suggest one under Say</Trans>
          </button>
        </div>
      )}

      {payload.decided.length > 0 && (
        <div className="space-y-2 border-t border-stone-200 pt-3">
          <h4 className="font-semibold text-stone-900">
            <Trans context="heading over the latest decisions on a canvas block">Decided lately</Trans>
          </h4>
          <p className="text-xs text-stone-600">
            <Trans>The newest decisions on {name}, with the note each was decided with, where one was written.</Trans>
          </p>
          <ul className="space-y-3" data-testid="canvas-adopt-decided">
            {payload.decided.map((d) => (
              <li key={d.id}>
                <DecidedCard d={d} payload={payload} titles={titles} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DecidedCard({ d, payload, titles }: { d: DecidedView; payload: BlockFramesPayload; titles: Record<string, string> }) {
  const lines = changeLines(d, dialOf(d, payload.doors));
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-1" data-testid={`canvas-decided-${d.id}`}>
      <h5 className="font-medium text-stone-900">{proposalHeadline(d, titles)}</h5>
      <p className="text-xs text-stone-600">{suggestedLine(d)}</p>
      <p className="text-stone-800">{decidedLine(d)}</p>
      {d.decisionNote && (
        <p className="text-stone-800">
          <span className="font-medium">
            <Trans context="label before a decision's note">The note:</Trans>
          </span> {d.decisionNote}
        </p>
      )}
      <details className="text-stone-800">
        <summary className="cursor-pointer min-h-[32px] text-sm text-teal-deep">
          <Trans context="a decided suggestion's own words">What it said</Trans>
        </summary>
        {lines.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 whitespace-pre-wrap border-l-2 border-stone-300 pl-3">{d.body}</p>
      </details>
    </article>
  );
}

function ProposalCard({
  p,
  payload,
  titles,
  onChanged,
}: {
  p: ProposalView;
  payload: BlockFramesPayload;
  titles: Record<string, string>;
  onChanged: (message?: string) => void;
}) {
  const { t } = useLingui();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "adopt" | "decline" | "withdraw">("");
  const [error, setError] = useState<{ text: string; toProposals: boolean } | null>(null);

  const mayAdopt = mayAdoptHere(p);
  const declines = mayDecline(p);
  const withdraws = p.youProposedIt;
  const acts = mayAdopt || declines || withdraws;
  const dial = dialOf(p, payload.doors);
  const lines = changeLines(p, dial);
  const pen = p.pen.sentence;

  const decide = async (what: "adopt" | "decline" | "withdraw") => {
    setError(null);
    if (what === "decline" && note.trim().length < 2) {
      setError({ text: t`Say in a sentence why this is declined. The note is public, like the suggestion.`, toProposals: false });
      return;
    }
    setBusy(what);
    try {
      const path = what === "adopt" ? "adopt" : "decline";
      const r = await fetch(`/api/canvas/proposals/${p.id}/${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError({ text: refusalText(d, t({ message: "Nothing was decided.", context: "fallback when adopting or declining a canvas suggestion is refused" })), toProposals: d?.door === PURPOSE_CHANGE_DOOR });
        return;
      }
      onChanged(
        what === "adopt"
          ? String(d?.message ?? t({ message: "Adopted.", context: "a canvas suggestion was adopted" }))
          : what === "withdraw"
            ? t`Your suggestion is withdrawn. It is listed under Decided lately on this block.`
            : t`Declined. The suggestion and your note are listed under Decided lately on this block, and the member who made it is told.`,
      );
    } catch {
      setError({ text: t`That did not reach the server, so nothing was decided.`, toProposals: false });
    } finally {
      setBusy("");
    }
  };

  return (
    <article className="rounded-lg border border-stone-200 p-3 space-y-2" data-testid={`canvas-proposal-${p.id}`}>
      <h4 className="font-semibold text-stone-900">{proposalHeadline(p, titles)}</h4>
      <p className="text-xs text-stone-600">{suggestedLine(p)}</p>
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-stone-800">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="whitespace-pre-wrap text-stone-900 border-l-2 border-stone-300 pl-3">{p.body}</p>
      {p.servesPurpose && (
        <p className="text-stone-800">
          <span className="font-medium">
            <Trans>How it serves the purpose:</Trans>
          </span> {p.servesPurpose}
        </p>
      )}
      <p className="text-stone-800" data-testid={`canvas-proposal-effect-${p.id}`}>
        {adoptEffect(p, payload.birthed, titles, dial, payload.careDoorByAgreement ?? true)}
      </p>
      <p className="text-xs text-stone-600">
        <Trans context="who may adopt a canvas suggestion">Who decides: {pen}</Trans>
      </p>
      {opensPurposeVote(p) && (
        <Link href="/propose" className="inline-block text-sm font-medium text-teal-deep hover:underline">
          <Trans>Start a proposal to change the statement</Trans>
        </Link>
      )}

      {acts && (
        <div className="space-y-2 border-t border-stone-100 pt-2">
          <label className="block text-sm">
            <span className="font-medium text-stone-900">
              {declines ? (mayAdopt ? t`Your note (optional to adopt, needed to decline)` : t`Your note (needed to decline)`) : t({ message: "Your note (optional)", context: "label of the note box on a canvas suggestion" })}
            </span>
            <span className="block text-xs text-stone-600">{noteReaders(p, payload.notesArePublic)}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={2}
              className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {mayAdopt && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void decide("adopt")}
                className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy === "adopt" ? t({ message: "Adopting", context: "a suggestion is being adopted" }) : adoptLabel(p)}
              </button>
            )}
            {declines && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void decide("decline")}
                className="min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
              >
                {busy === "decline"
                  ? t({ message: "Declining", context: "a suggestion is being declined" })
                  : t({ message: "Decline", context: "decline a suggestion" })}
              </button>
            )}
            {withdraws && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void decide("withdraw")}
                className="min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
              >
                {busy === "withdraw" ? t({ message: "Withdrawing", context: "a suggestion is being withdrawn" }) : t({ message: "Withdraw my suggestion", context: "button on a canvas suggestion its author made" })}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 space-y-1">
          <p>{error.text}</p>
          {error.toProposals && (
            <Link href="/propose" className="font-medium text-teal-deep hover:underline">
              <Trans>Start a proposal to change the statement</Trans>
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
