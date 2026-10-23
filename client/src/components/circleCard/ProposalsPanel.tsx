/**
 * "PROPOSED, WAITING FOR CONSENT": each open proposal for the circle's words,
 * and the doors that adopt it, on the card itself.
 *
 * A proposal is an org draft with one `update_circle` change. It is adopted
 * the way every org draft is (server/routes/orgDraftDecide.ts), and this panel
 * asks the server which of those doors this reader may use
 * (`GET /api/org/drafts/:id/decide`) instead of deciding it here:
 *
 *   Adopt these words      a live holder of the power to change the structure
 *                          (publish-by-power), or an admin before the village
 *                          has launched by vote (the admin panel's publish);
 *   Put it to the village  a village vote, for whoever the server says may
 *                          open one;
 *
 * and anybody else reads who decides it. Each step asks once before it acts,
 * and a refusal is the server's own sentence.
 */
import { useCallback, useEffect, useState } from "react";
import { BOX, EYEBROW, QUIET_BUTTON, SECTION, TAP } from "@/components/playerCard/cardParts";
import { gameFetch } from "@/lib/gameApi";
import type { ProposalOut } from "@shared/circleCard";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";
import { formatDay } from "@shared/roleSheet";

interface DecideAnswer {
  status: string;
  blocked: number;
  blockedLines: Array<{ reads: string; blocked: string }>;
  youMayPublish: boolean;
  youMayPutToVillage: boolean;
  adminMayPublish: boolean;
  ballotNeeded: boolean;
  ballot: { id: string; closesAt: string } | null;
}

type Step = { kind: "idle" } | { kind: "confirm-adopt" } | { kind: "confirm-put" } | { kind: "busy" };

async function post(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await gameFetch(path, { method: "POST", body: "{}" });
    if (res.ok) return { ok: true };
    const out = await res.json().catch(() => null);
    return { ok: false, error: String(out?.message ?? out?.error ?? W.proposeFailed) };
  } catch {
    return { ok: false, error: W.proposeFailed };
  }
}

function Doors({ draftId, reload }: { draftId: string; reload: () => void }) {
  const [answer, setAnswer] = useState<DecideAnswer | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [said, setSaid] = useState<string | null>(null);

  const read = useCallback(() => {
    let alive = true;
    void gameFetch(`/api/org/drafts/${encodeURIComponent(draftId)}/decide`)
      .then(async (res) => (res.ok ? ((await res.json()) as DecideAnswer) : null))
      .then((a) => alive && setAnswer(a))
      .catch(() => alive && setAnswer(null));
    return () => {
      alive = false;
    };
  }, [draftId]);
  useEffect(() => read(), [read]);

  if (!answer) return null;
  const mayAdopt = answer.youMayPublish || answer.adminMayPublish;
  const adoptPath = answer.youMayPublish
    ? `/api/org/drafts/${encodeURIComponent(draftId)}/publish-by-power`
    : `/api/admin/org/drafts/${encodeURIComponent(draftId)}/publish`;

  const act = async (path: string, done: string) => {
    setStep({ kind: "busy" });
    const r = await post(path);
    setStep({ kind: "idle" });
    if (r.ok) {
      setSaid(done);
      reload();
      read();
    } else setSaid(r.error);
  };

  return (
    <div className="grid gap-2" data-proposal-doors={draftId}>
      {answer.blocked > 0 ? (
        <div className="text-sm">
          <p className="font-medium">{W.blocked}</p>
          <ul className="list-disc pl-5">
            {answer.blockedLines.map((l, i) => (
              <li key={i}>{l.blocked}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.ballot ? <p className="text-sm">{W.voting(formatDay(answer.ballot.closesAt) ?? "")}</p> : null}
      {step.kind === "confirm-adopt" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{W.adoptConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void act(adoptPath, W.adopted)} className={`${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`}>
              {W.adoptYes}
            </button>
            <button type="button" onClick={() => setStep({ kind: "idle" })} className={QUIET_BUTTON}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : step.kind === "confirm-put" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{W.putConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void act(`/api/org/drafts/${encodeURIComponent(draftId)}/put-to-village`, W.putDone)}
              className={`${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`}
            >
              {W.putYes}
            </button>
            <button type="button" onClick={() => setStep({ kind: "idle" })} className={QUIET_BUTTON}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : mayAdopt || answer.youMayPutToVillage ? (
        <div className="flex flex-wrap gap-2">
          {mayAdopt ? (
            <button type="button" disabled={step.kind === "busy"} onClick={() => setStep({ kind: "confirm-adopt" })} className={`${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`}>
              {W.adopt}
            </button>
          ) : null}
          {answer.youMayPutToVillage ? (
            <button type="button" disabled={step.kind === "busy"} onClick={() => setStep({ kind: "confirm-put" })} className={QUIET_BUTTON}>
              {W.putToVillage}
            </button>
          ) : null}
        </div>
      ) : answer.ballot ? null : (
        <p className="text-sm text-muted-foreground">{answer.ballotNeeded ? W.waitingVillage : W.waitingHolder}</p>
      )}
      {said ? (
        <p role="status" className="text-sm">
          {said}
        </p>
      ) : null}
    </div>
  );
}

export default function ProposalsPanel({ proposals, reload }: { proposals: ProposalOut[]; reload: () => void }) {
  if (!proposals.length) return null;
  return (
    <section aria-label={W.pending} className={`${SECTION} grid gap-4`} data-circle-proposals="">
      <h2 className="font-display text-xl font-bold text-card-foreground sm:text-2xl">{W.pending}</h2>
      {proposals.map((p) => (
        <div key={p.draftId} className={`${BOX} grid gap-3`}>
          <p className={EYEBROW}>{p.proposedOn}</p>
          {p.fields.map((f) => (
            <div key={f.key} className="grid gap-1">
              <p className="text-sm font-semibold">{f.label}</p>
              {f.lines.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {f.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{W.clears}</p>
              )}
            </div>
          ))}
          <Doors draftId={p.draftId} reload={reload} />
        </div>
      ))}
    </section>
  );
}
