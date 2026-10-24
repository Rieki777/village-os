/**
 * WHERE A SUBMITTED PROPOSAL STANDS (role proposals PR C), from part B's
 * consent state, in plain words: waiting on the circle with the window's last
 * day, an objection taken to the circle's next meeting, consented by the
 * circle and waiting for a holder of the power to record it, or adopted with
 * the decision record (which names a role, never a person). The server's own
 * sentence for the state is drawn under its heading, and the reasons for an
 * objection are listed as sent: they name nobody. Under it, the tally (PR D):
 * how many holders were asked, consented and objected, with their roles'
 * titles, never their names.
 */
import { Link } from "wouter";
import { civilDayWords } from "@shared/seasonPlans";
import type { ProposalOut } from "./proposalApi";
import { ConsentTally } from "./CircleConsent";
import { ADOPTED_HEADING, RP_WORDS, STATE_HEADINGS } from "./proposalWords";
import { LEDE, PANEL, QUIET } from "./parts";

export default function ProposalState({ proposal }: { proposal: ProposalOut }) {
  const consent = proposal.consent;
  const adopted = !!proposal.decided;
  const heading = adopted ? ADOPTED_HEADING : consent ? STATE_HEADINGS[consent.state] : null;
  return (
    <section aria-labelledby="rp-state" className={`${PANEL} grid gap-2`} data-proposal-state={adopted ? "adopted" : consent?.state ?? "submitted"}>
      <h2 id="rp-state" className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {RP_WORDS.stateHeading}
      </h2>
      {heading && <p className="font-display text-2xl font-bold text-stone-900">{heading}</p>}
      {adopted ? (
        <p className="text-stone-800">{proposal.decided}</p>
      ) : consent ? (
        <>
          <p className="text-stone-800">{consent.words}</p>
          {/* Who was asked, who consented, who objected: counts and role titles, never a name (PR D). */}
          <ConsentTally consent={consent} />
          {consent.objections.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
              {consent.objections.map((o, i) => (
                <li key={i} className="break-words">
                  {o}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {proposal.submittedAt && <p className={LEDE}>{RP_WORDS.submittedOn(civilDayWords(proposal.submittedAt.slice(0, 10)))}</p>}
      {proposal.application && (
        <Link href={proposal.application.href} className={`${QUIET} w-fit px-0`}>
          {RP_WORDS.seeApplication}
        </Link>
      )}
      {/* The share link outlives the draft: the owner can still open what readers see. */}
      {proposal.share?.on && proposal.share.token && (
        <Link href={`/role-proposals/shared/${encodeURIComponent(proposal.share.token)}`} className={`${QUIET} w-fit px-0`}>
          {RP_WORDS.openShared}
        </Link>
      )}
    </section>
  );
}
