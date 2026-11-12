/**
 * "In a draft, not live yet" (spec R13, R38; the approved "Waiting for you"
 * board): what a person took from the outside service's list, in the draft it
 * went into, with that draft's doors.
 *
 * IT SAYS WHAT THE DRAFT HOLDS. The card is built from the stored answers and
 * the draft's real changes (review 3): its count is the draft's own, nested
 * roles included, and a take whose difference has gone, or moved since it was
 * taken, shows as changed with Undo and, where it still differs, Take it again.
 * A draft holding such a take is never published from here. An edit shows as
 * the words it will write and whose they are (review 11), never as the
 * service's suggestion.
 *
 * THE DOORS ARE THE DRAFT'S OWN. Who may publish is read from the draft's
 * decide answer (`GET /api/org/drafts/:id/decide`), the same one the structure
 * review reads: a live holder of `org.decide` publishes by power, an admin
 * through the admin panel before launch, and with nobody holding the power any
 * member may put it to the village (constitution 0.3). A publish sends the ids
 * of the changes the card showed, and refuses a draft holding others (review
 * 12). Withdrawing goes through the review queue's own withdraw; while the
 * village votes on the draft that ends the vote, so the button says so and
 * asks first (review 27).
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { InDraftGroup, InDraftItem } from "@/lib/seraReview";
import { draftDoors, errorWords, publishDraftThrough, putDraftToVillage, withdrawDraftThere, type DraftDoors } from "@/lib/seraAnswer";
import type { SeraActs } from "@/components/review/useSeraActs";
import { card, inlineLink, primary, secondary } from "@/components/review/seraStyles";

const dayMonth = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** Whose words an edit is, as the card says it: "Your words", "Ops lead's words", or "Words written here". */
function EditedWords({ item }: { item: InDraftItem }) {
  const { t } = useLingui();
  const whose = item.by === "you" ? t({ message: "Your words", context: "sera answers" }) : item.by ? t({ message: `${item.by}'s words`, context: "sera answers" }) : t({ message: "Words written here", context: "sera answers" });
  const about = item.about ?? t({ message: "this role", context: "sera answers" });
  const what = item.field === "name" ? t({ message: `for ${about}'s name`, context: "sera answers" }) : t({ message: `for ${about}'s purpose`, context: "sera answers" });
  return (
    <>
      <span className="font-semibold text-foreground">{`${whose} ${what}:`}</span>{" "}
      <span className="whitespace-pre-line">{item.value}</span>
    </>
  );
}

/** `say` puts the outcome in the list's one status strip and focuses it (R30, R32, review 23). */
export function InDraftCard({ group, onChanged, say, acts }: { group: InDraftGroup; onChanged: () => Promise<void>; say: (words: string) => void; acts: SeraActs }) {
  const { t } = useLingui();
  const id = useId();
  const [doors, setDoors] = useState<DraftDoors | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const read = useCallback(async () => setDoors(await draftDoors(group.draftId)), [group.draftId]);
  useEffect(() => {
    void read();
  }, [read, group.changes]);

  const voting = !!doors?.ballot;
  const act = async (what: "publish" | "vote" | "withdraw") => {
    if (busy) return;
    setBusy(true);
    const r =
      what === "withdraw"
        ? await withdrawDraftThere(group.draftId)
        : what === "vote"
          ? await putDraftToVillage(group.draftId)
          : await publishDraftThrough(group.draftId, doors?.youMayPublish ? "power" : "admin", group.changeIds);
    setBusy(false);
    setConfirming(false);
    if (!r.ok) {
      say(errorWords(r) ?? t({ message: "That did not go through.", context: "sera answers" }));
      return;
    }
    const endedVote = what === "withdraw" && typeof r.body?.ballotWithdrawn === "string";
    say(
      what === "withdraw"
        ? endedVote
          ? t({ message: "Withdrawn, and the village's vote on it ended. Each change waits in the list again.", context: "sera answers" })
          : t({ message: "Withdrawn. Each change waits in the list again.", context: "sera answers" })
        : what === "vote"
          ? t({ message: "The village is voting on it now.", context: "sera answers" })
          : t({ message: "Published. The changes are on the chart now.", context: "sera answers" }),
    );
    await onChanged();
    await read();
  };

  const n = group.changes;
  const closes = doors?.ballot?.closesAt ? dayMonth(doors.ballot.closesAt) : null;
  const mayPublish = !!doors && (doors.youMayPublish || doors.adminMayPublish) && !group.hasChanged && !voting;
  const nested = group.with;
  return (
    <section aria-labelledby={`${id}-h`} className={`${card} p-3.5 flex flex-col gap-2.5`}>
      <h3 id={`${id}-h`} className="text-base font-bold text-foreground">
        {n === 1 ? <Trans context="sera answers">In a draft, not live yet: 1 change</Trans> : <Trans context="sera answers">In a draft, not live yet: {n} changes</Trans>}
        {nested > 0 && (
          <span className="font-normal text-muted-foreground">
            {" "}
            {nested === 1 ? <Trans context="sera answers">(including 1 role inside a new circle)</Trans> : <Trans context="sera answers">(including {nested} roles inside a new circle)</Trans>}
          </span>
        )}
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm leading-normal text-muted-foreground [overflow-wrap:anywhere]">
        {group.items.map((item) => (
          <li key={item.key} data-draft-item={item.key} className="flex flex-col gap-1">
            <span>{item.answer === "edited" && item.value ? <EditedWords item={item} /> : item.sentence}</span>
            {item.changed && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded-lg bg-notice/10 text-notice px-2 py-0.5 text-[13px] font-semibold">
                  {item.now ? <Trans context="sera answers">Changed since it was taken</Trans> : <Trans context="sera answers">No longer suggested</Trans>}
                </span>
                {item.now && (
                  <button type="button" aria-disabled={acts.busy || undefined} onClick={() => !acts.busy && void acts.takeAgain(item.now!)} className={`min-h-[44px] text-sm font-semibold ${inlineLink}`}>
                    <Trans context="sera answers">Take it again</Trans>
                  </button>
                )}
                <button type="button" aria-disabled={acts.busy || undefined} onClick={() => !acts.busy && void acts.undo([item.key])} className={`min-h-[44px] text-sm font-semibold ${inlineLink}`}>
                  <Trans context="sera answers">Undo</Trans>
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {group.hasChanged && (
        <p className="text-sm text-foreground">
          <Trans context="sera answers">Something here changed since it was taken. Undo it or take it again before this draft is published.</Trans>
        </p>
      )}
      {voting && (
        <p className="text-sm text-foreground">
          {closes ? <Trans context="sera answers">The village is voting on it until {closes}.</Trans> : <Trans context="sera answers">The village is voting on it.</Trans>}
        </p>
      )}
      {doors && doors.blocked > 0 && doors.firstBlocked && (
        <p className="text-sm text-foreground">{t({ message: `It cannot be published yet: ${doors.firstBlocked}.`, context: "sera answers" })}</p>
      )}
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground">
            <Trans context="sera answers">Withdrawing it ends the village's vote on it, and the votes cast so far are set aside.</Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-disabled={busy || undefined} onClick={() => void act("withdraw")} className={primary}>
              <Trans context="sera answers">Withdraw it and end the vote</Trans>
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={secondary}>
              <Trans context="sera answers">Keep the vote</Trans>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {mayPublish && (
            <button type="button" aria-disabled={busy || undefined} onClick={() => void act("publish")} className={primary}>
              <Trans context="sera answers">Publish the draft</Trans>
            </button>
          )}
          {!mayPublish && !voting && !group.hasChanged && doors?.youMayPutToVillage && (
            <button type="button" aria-disabled={busy || undefined} onClick={() => void act("vote")} className={primary}>
              <Trans context="sera answers">Put it to the village</Trans>
            </button>
          )}
          <button type="button" aria-disabled={busy || undefined} onClick={() => (voting ? setConfirming(true) : void act("withdraw"))} className={secondary}>
            {voting ? <Trans context="sera answers">Withdraw it and end the vote</Trans> : <Trans context="sera answers">Withdraw it</Trans>}
          </button>
        </div>
      )}
    </section>
  );
}
