/**
 * "In a draft, not live yet" (spec R13, R38; the approved "Waiting for you"
 * board): what a person took from the outside service's list, in the draft it
 * went into, with that draft's doors.
 *
 * THE DOORS ARE THE DRAFT'S OWN. Who may publish is read from the draft's
 * decide answer (`GET /api/org/drafts/:id/decide`), the same one the structure
 * review reads: a live holder of `org.decide` publishes by power, an admin
 * through the admin panel before launch, and with nobody holding the power any
 * member may put it to the village (constitution 0.3). Withdrawing goes through
 * the review queue's own withdraw, and every answer in the draft waits in the
 * list again. A vote running on the draft freezes it, and the card says until
 * when.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { InDraftGroup } from "@/lib/seraReview";
import { draftDoors, errorWords, publishDraftThrough, putDraftToVillage, withdrawDraftThere, type DraftDoors } from "@/lib/seraAnswer";
import { card, primary, secondary } from "@/components/review/seraStyles";

const dayMonth = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** `say` puts the outcome in the list's one status strip (R30, R32). */
export function InDraftCard({ group, onChanged, say }: { group: InDraftGroup; onChanged: () => Promise<void>; say: (words: string) => void }) {
  const { t } = useLingui();
  const id = useId();
  const [doors, setDoors] = useState<DraftDoors | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => setDoors(await draftDoors(group.draftId)), [group.draftId]);
  useEffect(() => {
    void read();
  }, [read, group.items.length]);

  const act = async (what: "publish" | "vote" | "withdraw") => {
    setBusy(true);
    const r =
      what === "withdraw"
        ? await withdrawDraftThere(group.draftId)
        : what === "vote"
          ? await putDraftToVillage(group.draftId)
          : await publishDraftThrough(group.draftId, doors?.youMayPublish ? "power" : "admin");
    setBusy(false);
    if (!r.ok) {
      say(errorWords(r) ?? t({ message: "That did not go through.", context: "sera answers" }));
      return;
    }
    say(
      what === "withdraw"
        ? t({ message: "Withdrawn. Each change waits in the list again.", context: "sera answers" })
        : what === "vote"
          ? t({ message: "The village is voting on it now.", context: "sera answers" })
          : t({ message: "Published. The changes are on the chart now.", context: "sera answers" }),
    );
    await onChanged();
    await read();
  };

  const n = group.items.length;
  const closes = doors?.ballot?.closesAt ? dayMonth(doors.ballot.closesAt) : null;
  const mayPublish = !!doors && (doors.youMayPublish || doors.adminMayPublish);
  return (
    <section aria-labelledby={`${id}-h`} className={`${card} p-3.5 flex flex-col gap-2.5`}>
      <h3 id={`${id}-h`} className="text-base font-bold text-foreground">
        {n === 1 ? <Trans context="sera answers">In a draft, not live yet: 1 change</Trans> : <Trans context="sera answers">In a draft, not live yet: {n} changes</Trans>}
      </h3>
      <p className="text-sm leading-normal text-muted-foreground [overflow-wrap:anywhere]">{group.items.map((i) => i.sentence).join(" ")}</p>
      {doors?.ballot && (
        <p className="text-sm text-foreground">
          {closes ? <Trans context="sera answers">The village is voting on it until {closes}.</Trans> : <Trans context="sera answers">The village is voting on it.</Trans>}
        </p>
      )}
      {doors && doors.blocked > 0 && doors.firstBlocked && (
        <p className="text-sm text-foreground">{t({ message: `It cannot be published yet: ${doors.firstBlocked}.`, context: "sera answers" })}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {mayPublish && (
          <button type="button" disabled={busy} onClick={() => void act("publish")} className={primary}>
            <Trans context="sera answers">Publish the draft</Trans>
          </button>
        )}
        {!mayPublish && doors?.youMayPutToVillage && (
          <button type="button" disabled={busy} onClick={() => void act("vote")} className={primary}>
            <Trans context="sera answers">Put it to the village</Trans>
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void act("withdraw")} className={secondary}>
          <Trans context="sera answers">Withdraw it</Trans>
        </button>
      </div>
    </section>
  );
}
