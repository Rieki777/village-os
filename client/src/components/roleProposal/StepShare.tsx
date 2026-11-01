/**
 * Step 6: SHARE AND SUBMIT (role proposals PR C).
 *
 * SHARE. The link is off until the member makes one. Once on, a toggle between
 * members of the village (the default: they read the terms and leave feedback)
 * and anyone with the link (the roles and their words only), a copy button,
 * a new link (the old one then opens nothing) and turning it off. Where the
 * village keeps governance to members, the server says so (`anyoneNote`) and
 * the step shows it under the toggle.
 *
 * FEEDBACK. Every comment on the draft, for the owner, with who wrote it by
 * first name and the day.
 *
 * SUBMIT. "Submit for next season" opens a confirm that says who approves it,
 * shows the exact words the member aligns with (`POST /:id/words`), and sends
 * them back, so nobody aligns with words they did not see. A draft that is
 * not ready says the server's own reason and cannot be submitted.
 */
import { useEffect, useState } from "react";
import { Copy, Link2, RefreshCw, Send } from "lucide-react";
import type { ShareAudience } from "@shared/roleProposals";
import {
  fetchComments,
  fetchSubmitWords,
  regenerateShare,
  setShare,
  shareOff,
  submitProposal,
  type CommentOut,
  type ProposalOut,
  type ShareOut,
} from "./proposalApi";
import { RP_WORDS } from "./proposalWords";
import { FOCUS, INPUT, LEDE, PANEL, PRIMARY, QUIET, SECONDARY } from "./parts";
import DownloadCardText from "./DownloadCardText";
import { cardTextUrl } from "./roleCardApi";
import { RC_WORDS } from "./roleCardWords";

const absolute = (link: string) => (typeof window !== "undefined" ? `${window.location.origin}${link}` : link);

function SharePanel({ proposal, onShare }: { proposal: ProposalOut; onShare: (share: ShareOut) => void }) {
  const share = proposal.share;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!share) return null;

  const run = async (act: () => ReturnType<typeof setShare>, done: string | null = null): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    const r = await act();
    setBusy(false);
    if (r.ok) {
      onShare(r.data.share);
      setSaid(done);
      return true;
    }
    setSaid(r.error);
    return false;
  };

  const copy = async () => {
    if (!share.link) return;
    try {
      await navigator.clipboard.writeText(absolute(share.link));
      setSaid(RP_WORDS.copied);
    } catch {
      setSaid(RP_WORDS.copyFailed);
    }
  };

  const audiences: Array<{ key: ShareAudience; label: string; line: string }> = [
    { key: "members", label: RP_WORDS.membersOnlyTier, line: RP_WORDS.membersOnlyLine },
    { key: "anyone", label: RP_WORDS.anyoneTier, line: RP_WORDS.anyoneLine },
  ];

  return (
    <section aria-labelledby="rp-share" className={`${PANEL} grid gap-3`} data-share={share.on ? share.audience : "off"}>
      <h3 id="rp-share" className="font-semibold text-stone-900">
        {RP_WORDS.shareHeading}
      </h3>
      <p className={LEDE}>{RP_WORDS.shareLede}</p>
      {!share.on ? (
        <>
          <p className="text-sm text-stone-700">{RP_WORDS.shareOff}</p>
          <div>
            <button type="button" disabled={busy} onClick={() => void run(() => setShare(proposal.id, share.audience))} className={PRIMARY}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {RP_WORDS.makeLink}
            </button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-stone-800">{RP_WORDS.whoReads}</legend>
            {audiences.map((a) => (
              <label key={a.key} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3 ${share.audience === a.key ? "border-teal-deep bg-teal-deep/5" : "border-stone-200"}`}>
                <input
                  type="radio"
                  name="rp-audience"
                  value={a.key}
                  checked={share.audience === a.key}
                  disabled={busy}
                  onChange={() => {
                    // The toggle moves at once; the server's answer then confirms it, or puts it back.
                    const before = share;
                    onShare({ ...share, audience: a.key });
                    void run(() => setShare(proposal.id, a.key)).then((ok) => {
                      if (!ok) onShare(before);
                    });
                  }}
                  className={`mt-0.5 size-5 shrink-0 accent-teal-deep ${FOCUS}`}
                />
                <span className="grid gap-0.5">
                  <span className="font-medium text-stone-900">{a.label}</span>
                  <span className="text-sm text-stone-600">{a.line}</span>
                </span>
              </label>
            ))}
            {share.audience === "anyone" && share.anyoneNote && <p className="text-sm text-stone-700">{share.anyoneNote}</p>}
          </fieldset>
          {share.link && (
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {RP_WORDS.theLink}
              <input readOnly value={absolute(share.link)} onFocus={(e) => e.currentTarget.select()} className={`min-h-[44px] ${INPUT} text-sm`} data-share-link="" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className={SECONDARY}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {RP_WORDS.copyLink}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(() => regenerateShare(proposal.id, share.audience), RP_WORDS.regenerated)} className={SECONDARY}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {RP_WORDS.regenerate}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(() => shareOff(proposal.id))} className={QUIET}>
              {RP_WORDS.turnOff}
            </button>
          </div>
          {share.token && (
            <a href={`/role-proposals/shared/${encodeURIComponent(share.token)}`} target="_blank" rel="noopener noreferrer" className={`${QUIET} w-fit px-0`}>
              {RP_WORDS.openShared}
            </a>
          )}
        </>
      )}
      {said && (
        <p role="status" className="text-sm text-stone-800">
          {said}
        </p>
      )}
    </section>
  );
}

export function FeedbackList({ comments }: { comments: readonly CommentOut[] | null }) {
  return (
    <section aria-labelledby="rp-feedback" className={`${PANEL} grid gap-2`} data-feedback="">
      <h3 id="rp-feedback" className="font-semibold text-stone-900">
        {RP_WORDS.feedbackHeading}
      </h3>
      {comments === null ? null : comments.length === 0 ? (
        <p className="text-sm text-stone-600">{RP_WORDS.noFeedback}</p>
      ) : (
        <ul className="grid gap-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-stone-200 p-3">
              <p className="whitespace-pre-line break-words text-stone-900">{c.text}</p>
              <p className="mt-1 text-xs text-stone-600">{c.from ? RP_WORDS.fromWho(c.from, c.writtenOn) : c.writtenOn}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubmitPanel({ proposal, beforeSubmit, onSubmitted }: { proposal: ProposalOut; beforeSubmit: () => Promise<boolean>; onSubmitted: (p: ProposalOut | null) => void }) {
  const [asking, setAsking] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  // Who adopts it in this village, as the server read it from who holds the power (E8).
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const blocked = proposal.submitBlocked ?? null;

  const open = async () => {
    setSaid(null);
    setBusy(true);
    const saved = await beforeSubmit();
    if (!saved) {
      setBusy(false);
      setSaid(RP_WORDS.notSaved);
      return;
    }
    const w = await fetchSubmitWords(proposal.id);
    setBusy(false);
    if (!w.ok) {
      setSaid(w.error);
      return;
    }
    setWords(w.data.body);
    setWho(typeof w.data.whoApproves === "string" && w.data.whoApproves.trim() ? w.data.whoApproves : null);
    setAsking(true);
  };

  const confirm = async () => {
    setBusy(true);
    setSaid(null);
    const r = await submitProposal(proposal.id, words ?? undefined);
    setBusy(false);
    if (r.ok) {
      setAsking(false);
      onSubmitted(r.data.proposal);
      return;
    }
    // The words moved under the member: show the new ones and ask again.
    if (r.body?.error === "words_changed" && typeof r.body.body === "string") setWords(r.body.body);
    setSaid(r.error);
  };

  return (
    <section aria-labelledby="rp-submit" className={`${PANEL} grid gap-3`} data-submit="">
      <h3 id="rp-submit" className="font-semibold text-stone-900">
        {RP_WORDS.submitHeading}
      </h3>
      {blocked && (
        <p className="text-sm font-medium text-stone-800" data-submit-blocked="">
          {blocked}
        </p>
      )}
      {!asking ? (
        <div>
          <button type="button" disabled={busy || !!blocked} onClick={() => void open()} className={PRIMARY}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {RP_WORDS.submit}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-teal-deep bg-teal-deep/5 p-3" data-submit-confirm="">
          <p className="font-medium text-stone-900">{who ?? RP_WORDS.whoApproves}</p>
          {words && (
            <div className="grid gap-1">
              <p className="text-sm text-stone-700">{RP_WORDS.youAlign}</p>
              <p className="whitespace-pre-line break-words rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-800" data-aligned-words="">
                {words}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void confirm()} className={PRIMARY}>
              {RP_WORDS.confirm}
            </button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)} className={SECONDARY}>
              {RP_WORDS.notYet}
            </button>
          </div>
        </div>
      )}
      {said && (
        <p role="alert" className="text-sm text-coral">
          {said}
        </p>
      )}
    </section>
  );
}

export default function StepShare({
  proposal,
  onShare,
  beforeSubmit,
  onSubmitted,
}: {
  proposal: ProposalOut;
  onShare: (share: ShareOut) => void;
  beforeSubmit: () => Promise<boolean>;
  onSubmitted: (p: ProposalOut | null) => void;
}) {
  const [comments, setComments] = useState<CommentOut[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchComments(proposal.id).then((r) => {
      if (alive) setComments(r.ok ? r.data.comments : []);
    });
    return () => {
      alive = false;
    };
  }, [proposal.id]);
  return (
    <div className="grid gap-4">
      <SharePanel proposal={proposal} onShare={onShare} />
      <section aria-label={RC_WORDS.download} className={`${PANEL} grid gap-2`} data-card-text="">
        <p className={LEDE}>{RC_WORDS.downloadLine}</p>
        <div>
          <DownloadCardText url={cardTextUrl(proposal.id)} className={SECONDARY} />
        </div>
      </section>
      <FeedbackList comments={comments} />
      <SubmitPanel proposal={proposal} beforeSubmit={beforeSubmit} onSubmitted={onSubmitted} />
    </div>
  );
}
