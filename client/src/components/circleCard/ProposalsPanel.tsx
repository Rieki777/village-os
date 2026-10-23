/**
 * "PROPOSED, WAITING FOR CONSENT": each open proposal for the circle's words,
 * and the doors that adopt it, on the card itself. The doors are the shared
 * `DecideDoors` (client/src/components/review/DecideDoors.tsx), which the
 * player card draws beside a role's proposals too.
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
import DecideDoors, { type DecideDoorWords } from "@/components/review/DecideDoors";
import { BOX, EYEBROW, SECTION } from "@/components/playerCard/cardParts";
import type { ProposalOut } from "@shared/circleCard";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";

/** The circle card's words for the doors every org draft has. */
const DOOR_WORDS: DecideDoorWords = {
  adopt: W.adopt,
  adoptConfirm: W.adoptConfirm,
  adoptYes: W.adoptYes,
  putToVillage: W.putToVillage,
  putConfirm: W.putConfirm,
  putYes: W.putYes,
  voting: W.voting,
  waitingHolder: W.waitingHolder,
  waitingVillage: W.waitingVillage,
  blocked: W.blocked,
  adopted: W.adopted,
  putDone: W.putDone,
  cancel: W.cancel,
  failed: W.proposeFailed,
};

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
          <DecideDoors draftId={p.draftId} reload={reload} words={DOOR_WORDS} />
        </div>
      ))}
    </section>
  );
}
