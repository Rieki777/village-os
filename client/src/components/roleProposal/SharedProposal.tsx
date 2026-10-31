/**
 * THE SHARED VIEW of a role proposal, at its share link (role proposals PR C).
 *
 * The card the proposal would make, read only, with changed words in gold,
 * drawn at the tier the server read it at (`you.tier`): a member of the
 * village reads it as a member reads an application, terms included; anyone
 * else with an "anyone with the link" link reads the roles and their words,
 * and never the terms, the season words or the feedback. The page draws only
 * what arrived, so a public read has no terms to draw.
 *
 * A member may leave feedback while it is a draft, and reads back only their
 * own. Once it is submitted, a member reads where the circle's consent stands
 * (role proposals PR D), in counts and role titles, never names. The owner reading their own link sees every comment and a way back to
 * the steps.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PlayerRoleCardView } from "@/components/playerCard/PlayerRoleCard";
import { COMMENT_MAX } from "@shared/roleProposals";
import { civilDayWords } from "@shared/seasonPlans";
import { fetchSharedComments, postSharedComment, type CommentOut, type SharedOut } from "./proposalApi";
import { RP_WORDS } from "./proposalWords";
import { changedSections } from "./roleWords";
import { FeedbackList } from "./StepShare";
import { ConsentSummary } from "./CircleConsent";
import { INPUT, LEDE, PANEL, PRIMARY, QUIET } from "./parts";

export default function SharedProposal({ token, shared }: { token: string; shared: SharedOut }) {
  const { proposal, card, you } = shared;
  const [comments, setComments] = useState<CommentOut[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const readsFeedback = you.tier === "member";

  useEffect(() => {
    if (!readsFeedback) return;
    let alive = true;
    void fetchSharedComments(token).then((r) => {
      if (alive) setComments(r.ok ? r.data.comments : []);
    });
    return () => {
      alive = false;
    };
  }, [token, readsFeedback]);

  const send = async () => {
    setBusy(true);
    setSaid(null);
    const r = await postSharedComment(token, text);
    setBusy(false);
    if (r.ok) {
      setComments(r.data.comments);
      setText("");
      setSaid({ ok: true, text: RP_WORDS.feedbackSent });
    } else setSaid({ ok: false, text: r.error });
  };

  const target = proposal.target;
  return (
    <div className="grid gap-5" data-shared-tier={you.tier}>
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-bold text-stone-900">{RP_WORDS.sharedTitle}</h1>
        <p className={LEDE}>{target ? RP_WORDS.forSeason(target.name, civilDayWords(target.startsOn)) : proposal.targetWords}</p>
        {you.isOwner && (
          <p className="text-sm text-stone-800">
            {RP_WORDS.yourOwn}{" "}
            <Link href={`/role-proposals/${encodeURIComponent(proposal.id)}`} className={`${QUIET} px-0`}>
              {RP_WORDS.editYourOwn}
            </Link>
          </p>
        )}
      </header>

      {card && <PlayerRoleCardView data={card} mode="proposal" changed={changedSections(proposal)} />}

      {/* Where a submitted proposal stands, for a member reading it by its link (PR D). The public tier gets no consent. */}
      {readsFeedback && proposal.status === "submitted" && proposal.consent && <ConsentSummary consent={proposal.consent} decided={proposal.decided} />}

      {you.tier === "public" && <p className={LEDE}>{RP_WORDS.readOnly}</p>}

      {you.mayComment && !you.isOwner && (
        <section aria-labelledby="rp-shared-feedback" className={`${PANEL} grid gap-2`} data-comment-box="">
          <h2 id="rp-shared-feedback" className="font-semibold text-stone-900">
            {RP_WORDS.feedbackLabel}
          </h2>
          <label className="grid gap-1 text-sm text-stone-700">
            {RP_WORDS.feedbackHelp}
            <textarea rows={4} maxLength={COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} className={INPUT} aria-label={RP_WORDS.feedbackLabel} />
          </label>
          <div>
            <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className={PRIMARY}>
              {RP_WORDS.sendFeedback}
            </button>
          </div>
          {said && (
            <p role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-teal-deep" : "text-coral"}`}>
              {said.text}
            </p>
          )}
        </section>
      )}
      {readsFeedback && !you.mayComment && proposal.status === "submitted" && <p className={LEDE}>{RP_WORDS.submittedNoFeedback}</p>}
      {readsFeedback && (you.isOwner ? <FeedbackList comments={comments} /> : comments && comments.length > 0 ? <OwnFeedback comments={comments} /> : null)}
    </div>
  );
}

function OwnFeedback({ comments }: { comments: readonly CommentOut[] }) {
  return (
    <section aria-labelledby="rp-own-feedback" className={`${PANEL} grid gap-2`}>
      <h2 id="rp-own-feedback" className="font-semibold text-stone-900">
        {RP_WORDS.yourFeedback}
      </h2>
      <ul className="grid gap-2">
        {comments.map((c) => (
          <li key={c.id} className="rounded-lg border border-stone-200 p-3">
            <p className="whitespace-pre-line break-words text-stone-900">{c.text}</p>
            <p className="mt-1 text-xs text-stone-600">{c.writtenOn}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
