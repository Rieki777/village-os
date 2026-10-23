/**
 * THE DOORS THAT ADOPT ONE ORG DRAFT, for a card that lists its own proposals.
 *
 * A draft opened from a card (a circle's words, a role's words) is listed on
 * no review page: `/review` lists only the drafts its own queue made. So each
 * card lists its open proposals itself and draws these doors beside each one,
 * asking the server which this reader may use (`GET /api/org/drafts/:id/decide`)
 * instead of deciding it here:
 *
 *   adopt        a live holder of the power to change the structure
 *                (publish-by-power), or an admin before the village has
 *                launched by vote (the admin panel's publish);
 *   put to vote  for whoever the server says may open the village's vote;
 *
 * and anybody else reads who decides it. Each step asks once before it acts,
 * and a refusal is the server's own sentence. The words are the card's, handed
 * in, so each card says what changes in its own terms.
 */
import { useCallback, useEffect, useState } from "react";
import { QUIET_BUTTON, TAP } from "@/components/playerCard/cardParts";
import { gameFetch } from "@/lib/gameApi";
import { formatDay } from "@shared/roleSheet";

export interface DecideDoorWords {
  adopt: string;
  adoptConfirm: string;
  adoptYes: string;
  putToVillage: string;
  putConfirm: string;
  putYes: string;
  voting: (day: string) => string;
  waitingHolder: string;
  waitingVillage: string;
  blocked: string;
  adopted: string;
  putDone: string;
  cancel: string;
  failed: string;
}

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

type Step = "idle" | "confirm-adopt" | "confirm-put" | "busy";

async function post(path: string, failed: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await gameFetch(path, { method: "POST", body: "{}" });
    if (res.ok) return { ok: true };
    const out = await res.json().catch(() => null);
    return { ok: false, error: String(out?.message ?? out?.error ?? failed) };
  } catch {
    return { ok: false, error: failed };
  }
}

export default function DecideDoors({ draftId, reload, words: W }: { draftId: string; reload: () => void; words: DecideDoorWords }) {
  const [answer, setAnswer] = useState<DecideAnswer | null>(null);
  const [step, setStep] = useState<Step>("idle");
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
    setStep("busy");
    const r = await post(path, W.failed);
    setStep("idle");
    if (r.ok) {
      setSaid(done);
      reload();
      read();
    } else setSaid(r.error);
  };
  const go = `${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`;

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
      {step === "confirm-adopt" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{W.adoptConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void act(adoptPath, W.adopted)} className={go}>
              {W.adoptYes}
            </button>
            <button type="button" onClick={() => setStep("idle")} className={QUIET_BUTTON}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : step === "confirm-put" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{W.putConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void act(`/api/org/drafts/${encodeURIComponent(draftId)}/put-to-village`, W.putDone)} className={go}>
              {W.putYes}
            </button>
            <button type="button" onClick={() => setStep("idle")} className={QUIET_BUTTON}>
              {W.cancel}
            </button>
          </div>
        </div>
      ) : mayAdopt || answer.youMayPutToVillage ? (
        <div className="flex flex-wrap gap-2">
          {mayAdopt ? (
            <button type="button" disabled={step === "busy"} onClick={() => setStep("confirm-adopt")} className={go}>
              {W.adopt}
            </button>
          ) : null}
          {answer.youMayPutToVillage ? (
            <button type="button" disabled={step === "busy"} onClick={() => setStep("confirm-put")} className={QUIET_BUTTON}>
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
