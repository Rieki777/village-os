/**
 * The member's role proposals, under My applications on their own live card
 * (role proposals PR C): each submitted one with where it stands, linked to
 * its page, and the draft, linked to carry on with it. Drawn only for the
 * card's owner (the card mounts it so), from the same `GET /mine` read the
 * profile button makes. A failed read, or none written, draws nothing.
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
  useEffect(() => {
    if (!authToken()) return;
    let alive = true;
    void fetchMine().then((r) => {
      if (alive && r.ok && Array.isArray(r.data.proposals)) setList(r.data.proposals);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!list || !list.length) return null;
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 p-4" data-proposal-links="">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{RP_WORDS.myProposals}</p>
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
    </div>
  );
}
