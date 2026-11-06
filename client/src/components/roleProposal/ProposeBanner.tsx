/**
 * "Propose your roles for next season", on the member's own profile (role
 * proposals PR B).
 *
 * It shows only while a nudge is due for the member, and says which one: the
 * window is open, a review is due, or the window closes in 2 business days.
 * The server works that out (`GET /api/governance/role-proposals/nudge`, from
 * the same facts the bell's sweep reads), so the banner and the bell never
 * disagree about why. Anything it cannot read, a failed read, or the
 * governance module being off, and it draws nothing: a banner that guesses is
 * worse than none.
 *
 * The link is the payload's own `href`: /role-proposals/new, the proposal
 * steps (PR C), which open the member's draft when they already have one.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Sprout } from "lucide-react";
import { authToken, gameFetch } from "@/lib/gameApi";
import { readNudge, type NudgePayload } from "@shared/roleProposalConsent";

export const NUDGE_URL = "/api/governance/role-proposals/nudge";

export default function ProposeBanner() {
  const [nudge, setNudge] = useState<NudgePayload | null>(null);

  useEffect(() => {
    // Members only: nobody signed in is asked anything (pages/membersOnlyReads.test.tsx).
    if (!authToken()) return;
    let live = true;
    gameFetch(NUDGE_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live) setNudge(readNudge(body));
      })
      .catch(() => {
        if (live) setNudge(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!nudge || !nudge.show || !nudge.reasonWords) return null;
  return (
    <aside
      aria-label={nudge.heading}
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-notice/60 bg-notice/10 px-5 py-4"
    >
      <Sprout className="h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold leading-snug text-card-foreground">{nudge.heading}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{nudge.reasonWords}</p>
      </div>
      <Link
        href={nudge.href}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-notice px-4 py-2 font-medium text-background"
      >
        {nudge.linkWords}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
