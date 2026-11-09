/**
 * What a member without the review queue's key sees of the outside service's
 * differences (spec R38, the approved "What a member sees" board): the count,
 * who decides, and never a subject.
 *
 * EVERY DRAFT FROM THE LIST, AND ITS OWN DOORS (review 16, 21). Each open
 * draft the list's answers made is shown by its size, and offers what its own
 * decide answer says this reader may do: a holder of the power (or an admin
 * before launch) publishes it, sending the ids of the changes it was shown so a
 * draft that moved since is refused (review 12); with nobody holding the power
 * any member puts it to the village (constitution 0.3). A draft holding a take
 * that changed since it was taken is never published from here. Whether a door
 * is this reader's is the draft's own answer, never worked out here.
 *
 * ONE STORY ABOUT WHO DECIDES (review 30). When the reader may open the vote,
 * the page says the village decides, and never also that the admins do.
 */
import { useEffect, useId, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { headlineCount } from "@shared/seraWaiting";
import { NO_HOLDER_WORDS, whoDecidesWords } from "@shared/seraDecides";
import { changes, type CountAnswer, type CountDraft } from "@/lib/seraReview";
import { draftDoors, errorWords, publishDraftThrough, putDraftToVillage, type DraftDoors } from "@/lib/seraAnswer";
import { card, primary } from "@/components/review/seraStyles";

const dayMonth = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** One draft from the list, and what this reader may do with it. */
function MemberDraft({ draft, doors, onDone }: { draft: CountDraft; doors: DraftDoors | null; onDone: (words: string) => Promise<void> }) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const n = draft.changes;
  const closes = doors?.ballot?.closesAt ? dayMonth(doors.ballot.closesAt) : null;
  const mayPublish = !!doors && (doors.youMayPublish || doors.adminMayPublish) && !draft.hasChanged && !doors.ballot;
  const mayVote = !!doors && doors.youMayPutToVillage && !mayPublish && !draft.hasChanged && !doors.ballot;
  const act = async (what: "publish" | "vote") => {
    if (busy) return;
    setBusy(true);
    const r = what === "vote" ? await putDraftToVillage(draft.id) : await publishDraftThrough(draft.id, doors?.youMayPublish ? "power" : "admin", draft.changeIds);
    setBusy(false);
    await onDone(
      r.ok
        ? what === "vote"
          ? t({ message: "The village is voting on it now.", context: "sera answers" })
          : t({ message: "Published. The changes are on the chart now.", context: "sera answers" })
        : (errorWords(r) ?? t({ message: "That did not go through.", context: "sera answers" })),
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] leading-normal text-foreground">
        {n === 1 ? <Trans context="sera answers">1 change is in a draft, waiting to be published.</Trans> : <Trans context="sera answers">{n} changes are in a draft, waiting to be published.</Trans>}
      </p>
      {draft.hasChanged && (
        <p className="text-sm text-foreground"><Trans context="sera answers">Something in it changed since it was taken, so whoever reads the list sees to it first.</Trans></p>
      )}
      {doors?.ballot && (
        <p className="text-[15px] leading-normal text-foreground">
          {closes ? <Trans context="sera answers">The village is voting on it until {closes}.</Trans> : <Trans context="sera answers">The village is voting on it.</Trans>}
        </p>
      )}
      {mayPublish && (
        <button type="button" aria-disabled={busy || undefined} onClick={() => void act("publish")} className={`${primary} self-start`}>
          <Trans context="sera answers">Publish the draft</Trans>
        </button>
      )}
      {mayVote && (
        <button type="button" aria-disabled={busy || undefined} onClick={() => void act("vote")} className={`${primary} self-start`}>
          <Trans context="sera answers">Put it to the village</Trans>
        </button>
      )}
    </div>
  );
}

/** R38: the count, who decides, every draft from the list with its doors, and never a subject. */
export function SeraMember({ count, agent }: { count: CountAnswer; agent: string }) {
  const { t } = useLingui();
  const ids = useId();
  const drafts = count.drafts ?? [];
  const [doors, setDoors] = useState<Record<string, DraftDoors | null>>({});
  const [said, setSaid] = useState("");
  const draftKey = drafts.map((d) => `${d.id}:${d.changes}`).join("|");
  const readDoors = async () => {
    const out: Record<string, DraftDoors | null> = {};
    for (const d of drafts) out[d.id] = await draftDoors(d.id);
    setDoors(out);
  };
  useEffect(() => {
    void readDoors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // The headline's own rule (shared/seraWaiting.ts), so a member and a moderator read one number.
  const n = headlineCount(count);
  const small = count.toDecide === 0;
  const nChanges = changes(n);
  const heading =
    n > 0
      ? small
        ? n === 1
          ? t`${agent} suggests ${n} small change for the chart`
          : t`${agent} suggests ${n} small changes for the chart`
        : t`${agent} suggests ${nChanges} for the chart`
      : count.lastReadWhole && count.lastReadAt && drafts.length === 0
        ? t`The chart and ${agent} are in step`
        : t`Nothing from ${agent} waits for the chart`;
  // When this reader may open the village's vote, the village decides: never also "the admins decide them".
  const villageDecides = drafts.some((d) => doors[d.id]?.youMayPutToVillage && !doors[d.id]?.youMayPublish && !doors[d.id]?.adminMayPublish);
  const decides = villageDecides ? NO_HOLDER_WORDS : count.decides ? whoDecidesWords(count.decides, Math.max(n, 1)) : null;
  const onDone = async (words: string) => {
    await readDoors();
    // The ballot line says it once the vote is open; the status line says only what that line does not.
    setSaid(words);
    setTimeout(() => document.getElementById(`${ids}-said`)?.focus(), 0);
  };
  return (
    <section id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
      <div className={`${card} p-3.5 flex flex-col gap-2.5`}>
        <h2 id={`${ids}-h`} className="text-[19px] leading-snug font-bold text-foreground">{heading}</h2>
        {(n > 0 || drafts.length > 0) && decides && <p className="text-[15px] leading-normal text-foreground">{decides}</p>}
        {count.reader?.decides && drafts.length === 0 && (
          <p className="text-[15px] leading-normal text-foreground"><Trans>These reach you as a draft to publish, once someone who reads the list puts them in one.</Trans></p>
        )}
        {drafts.map((d) => (
          <MemberDraft key={d.id} draft={d} doors={doors[d.id] ?? null} onDone={onDone} />
        ))}
        <p className="text-sm leading-normal text-muted-foreground"><Trans>Small changes applying by themselves: off.</Trans></p>
      </div>
      <p id={`${ids}-said`} role="status" tabIndex={-1} className={said && !said.startsWith(t({ message: "The village is voting on it now.", context: "sera answers" })) ? "text-sm text-foreground" : "sr-only"}>
        {said}
      </p>
      <p className="text-[13px] leading-normal text-muted-foreground">
        <Trans>Members see how many changes wait and who decides them. The changes themselves are read by the people who decide.</Trans>
      </p>
    </section>
  );
}
