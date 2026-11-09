/**
 * What a member without the review queue's key sees of the outside service's
 * differences (spec R38, the approved "What a member sees" board): the count,
 * who decides, and never a subject.
 *
 * THE VILLAGE'S DOOR (constitution 0.3). When nobody holds the power to decide
 * the chart, the village decides by vote, and the list's readers can only put
 * what they take into a draft. So once a draft from the list is open, the
 * member is offered "Put it to the village" on it, through the door every org
 * draft has (`POST /api/org/drafts/:id/put-to-village`). Whether that door is
 * theirs is the draft's own decide answer, never worked out here, so a role
 * that holds the power keeps it to its holders.
 */
import { useEffect, useId, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { headlineCount } from "@shared/seraWaiting";
import { whoDecidesWords } from "@shared/seraDecides";
import { changes, type CountAnswer } from "@/lib/seraReview";
import { draftDoors, errorWords, putDraftToVillage, type DraftDoors } from "@/lib/seraAnswer";
import { card, primary } from "@/components/review/seraStyles";

const dayMonth = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** The list's open draft, and the village's vote on it, for a member. */
function DraftToVillage({ draft }: { draft: { id: string; changes: number } }) {
  const { t } = useLingui();
  const [doors, setDoors] = useState<DraftDoors | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void draftDoors(draft.id).then(setDoors);
  }, [draft.id]);
  const n = draft.changes;
  const closes = doors?.ballot?.closesAt ? dayMonth(doors.ballot.closesAt) : null;
  const put = async () => {
    setBusy(true);
    const r = await putDraftToVillage(draft.id);
    setBusy(false);
    setSaid(r.ok ? t({ message: "The village is voting on it now.", context: "sera answers" }) : (errorWords(r) ?? t({ message: "The vote did not open.", context: "sera answers" })));
    setDoors(await draftDoors(draft.id));
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] leading-normal text-foreground">
        {n === 1 ? <Trans context="sera answers">1 of them is in a draft, waiting to be published.</Trans> : <Trans context="sera answers">{n} of them are in a draft, waiting to be published.</Trans>}
      </p>
      {doors?.ballot ? (
        <p className="text-[15px] leading-normal text-foreground">
          {closes ? <Trans context="sera answers">The village is voting on it until {closes}.</Trans> : <Trans context="sera answers">The village is voting on it.</Trans>}
        </p>
      ) : (
        doors?.youMayPutToVillage && (
          <button type="button" disabled={busy} onClick={() => void put()} className={`${primary} self-start`}>
            <Trans context="sera answers">Put it to the village</Trans>
          </button>
        )
      )}
      <p role="status" className={said ? "text-sm text-foreground" : "sr-only"}>
        {said}
      </p>
    </div>
  );
}

/** R38: the count, who decides, the village's door when nobody holds the power, and never a subject. */
export function SeraMember({ count, agent }: { count: CountAnswer; agent: string }) {
  const { t } = useLingui();
  const ids = useId();
  // The headline's own rule (shared/seraWaiting.ts), so a member and a moderator read one number.
  const n = headlineCount(count);
  const small = count.toDecide === 0;
  const nChanges = changes(n);
  const draft = (count.drafts ?? [])[0] ?? null;
  const heading =
    n > 0
      ? small
        ? n === 1
          ? t`${agent} suggests ${n} small change for the chart`
          : t`${agent} suggests ${n} small changes for the chart`
        : t`${agent} suggests ${nChanges} for the chart`
      : count.lastReadWhole && count.lastReadAt && !draft
        ? t`The chart and ${agent} are in step`
        : t`Nothing from ${agent} waits for the chart`;
  return (
    <section id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
      <div className={`${card} p-3.5 flex flex-col gap-2.5`}>
        <h2 id={`${ids}-h`} className="text-[19px] leading-snug font-bold text-foreground">{heading}</h2>
        {(n > 0 || draft) && count.decides && <p className="text-[15px] leading-normal text-foreground">{whoDecidesWords(count.decides, Math.max(n, 1))}</p>}
        {count.reader?.decides && (
          <p className="text-[15px] leading-normal text-foreground"><Trans>These reach you as a draft to publish, once someone who reads the list puts them in one.</Trans></p>
        )}
        {draft && <DraftToVillage draft={draft} />}
        <p className="text-sm leading-normal text-muted-foreground"><Trans>Small changes applying by themselves: off.</Trans></p>
      </div>
      <p className="text-[13px] leading-normal text-muted-foreground">
        <Trans>Members see how many changes wait and who decides them. The changes themselves are read by the people who decide.</Trans>
      </p>
    </section>
  );
}
