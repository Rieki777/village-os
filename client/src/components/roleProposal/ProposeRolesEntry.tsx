/**
 * The role proposal card on the member's own profile.
 *
 * It reads `GET /api/governance/role-proposals/mine` once. With no draft it
 * says "Propose your role" and starts one. With a draft it says "Continue
 * your role proposal" and shows how much is written. Once the newest one is
 * submitted, it says where that one stands. A guest or a village with
 * governance off gets nothing: a card that leads to a refusal is worse than
 * none. Nobody signed out is asked anything.
 *
 * Beside the door, "Download my card as text" stays: the draft when one is
 * open, or the current card.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { draftFill } from "@shared/roleProposalProgress";
import { BTN_GOLD, KICKER, PANEL } from "@/components/profileDash/dashUi";
import { fetchMine, type MineOut, type ProposalOut } from "./proposalApi";
import { ADOPTED_HEADING, RP_WORDS, STATE_HEADINGS } from "./proposalWords";
import DownloadCardText from "./DownloadCardText";
import { MY_CARD_TEXT_URL } from "./roleCardApi";

const standingLine = (p: ProposalOut): string => (p.decided ? ADOPTED_HEADING : p.consent ? STATE_HEADINGS[p.consent.state] : RP_WORDS.submitted);

export default function ProposeRolesEntry() {
  const [mine, setMine] = useState<MineOut | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!authToken()) return;
    let alive = true;
    void fetchMine().then((r) => {
      if (!alive) return;
      if (r.ok) {
        setMine(r.data);
        setFailed(false);
      } else if (r.status !== 403 && r.status !== 404) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [attempt]);
  if (failed && !mine) {
    return (
      <article className={`${PANEL} p-5 sm:p-6`} data-propose-entry="failed">
        <p className="text-sm text-foreground">{RP_WORDS.profileFailed}</p>
        <button type="button" className={`${BTN_GOLD} mt-3`} onClick={() => setAttempt((n) => n + 1)}>
          {RP_WORDS.tryAgain}
        </button>
      </article>
    );
  }
  if (!mine) return null;

  const proposals = mine.proposals ?? [];
  const draftId = mine.draftId;
  const draft = draftId ? (proposals.find((p) => p.id === draftId) ?? null) : null;
  const submitted = proposals.find((p) => p.status === "submitted") ?? null;
  // A submitted proposal for an earlier season does not stand in for this one.
  const nextId = mine.nextSeason?.seasonId ?? null;
  const standing = submitted && (!nextId || !submitted.target?.seasonId || submitted.target.seasonId === nextId) ? submitted : null;
  const fill = draftId
    ? draftFill({
        roleCount: (draft?.roles.length ?? 0) + (draft?.newRoles.length ?? 0),
        love: draft?.season?.ownWords?.love,
        offer: draft?.season?.ownWords?.offer,
        why: draft?.season?.ownWords?.why,
        aim: draft?.season?.aim,
        goalCount: draft?.season?.seasonalGoals?.length ?? 0,
      })
    : null;
  const href = draftId
    ? `/role-proposals/${encodeURIComponent(draftId)}`
    : standing
      ? `/role-proposals/${encodeURIComponent(standing.id)}`
      : "/role-proposals/new";
  const title = draftId ? RP_WORDS.profileContinue : standing ? RP_WORDS.profileSubmitted : RP_WORDS.profilePropose;
  const line = fill ? fill.line : standing ? standingLine(standing) : RP_WORDS.profileProposeLine;
  const action = draftId ? RP_WORDS.profileContinue : standing ? RP_WORDS.profileSee : RP_WORDS.profilePropose;
  const kind = draftId ? "continue" : standing ? "submitted" : "propose";
  const width = fill ? Math.round((fill.done / fill.total) * 100) : 0;

  return (
    <article className={`${PANEL} p-5 sm:p-6`} data-propose-entry={kind} aria-labelledby="propose-role-title">
      <p className={KICKER}>{RP_WORDS.profileKicker}</p>
      <h2 id="propose-role-title" className="mt-1 font-display text-xl font-bold text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{line}</p>
      {fill && (
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-md border border-dash-edge bg-dash-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={fill.total}
          aria-valuenow={fill.done}
          aria-label={fill.line}
        >
          <div className="h-full bg-dash-gold" style={{ width: `${width}%` }} />
        </div>
      )}
      {mine.nextSeasonWords && <p className="mt-2 text-sm text-muted-foreground">{mine.nextSeasonWords}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href={href} className={BTN_GOLD}>
          {action}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        {submitted && !standing && (
          <Link href={`/role-proposals/${encodeURIComponent(submitted.id)}`} className="inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2">
            {RP_WORDS.profileSee}
          </Link>
        )}
        <DownloadCardText url={MY_CARD_TEXT_URL} />
      </div>
    </article>
  );
}
