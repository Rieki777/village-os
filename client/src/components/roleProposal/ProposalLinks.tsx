/**
 * The member's role proposals, under My applications on their own live card
 * (role proposals PR C): each submitted one with where it stands, linked to
 * its page, and the draft, linked to carry on with it. With no draft open it
 * also offers to start one, the profile button's door, so the steps are
 * reached from the card too. Drawn only for the card's owner (the card mounts
 * it so), from the same `GET /mine` read the profile button makes. A failed
 * read draws nothing.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { authToken } from "@/lib/gameApi";
import { fetchMine, type ProposalOut } from "./proposalApi";
import { ADOPTED_HEADING, RP_WORDS, STATE_HEADINGS } from "./proposalWords";

const stateOf = (p: ProposalOut): string =>
  p.status === "draft" ? RP_WORDS.draftWords : p.decided ? ADOPTED_HEADING : p.consent ? STATE_HEADINGS[p.consent.state] : "";

export default function ProposalLinks() {
  const [list, setList] = useState<ProposalOut[] | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  useEffect(() => {
    if (!authToken()) return;
    let alive = true;
    void fetchMine().then((r) => {
      if (alive && r.ok && Array.isArray(r.data.proposals)) {
        setList(r.data.proposals);
        setDraftOpen(!!r.data.draftId);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!list) return null;
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 p-4" data-proposal-links="">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{RP_WORDS.myProposals}</p>
      {list.length > 0 && (
        <ul className="grid gap-2">
          {list.map((p) => (
            <li key={p.id}>
              <Link
                href={`/role-proposals/${encodeURIComponent(p.id)}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="font-semibold">{p.target ? RP_WORDS.proposalFor(p.target.name) : RP_WORDS.proposalNoSeason}</span>
                <span className="text-sm text-notice">{stateOf(p)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!draftOpen && (
        <Link href="/role-proposals/new" className="inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
          {RP_WORDS.propose}
        </Link>
      )}
    </div>
  );
}
