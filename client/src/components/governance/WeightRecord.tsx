/**
 * WHAT EVERYONE WEIGHS, WHO CHANGED IT, AND WHICH OF IT IS YOURS.
 *
 * `governance_weight_changes` is append-only and `GET /api/governance/weights`
 * serves it to any signed-in member, which is deliberate. The constitution's
 * line is "Voting weight is on the record... Weight is power, and this game
 * holds no hidden power", and a record only an admin can read is not a record.
 *
 * THIS IS THE ONLY WEIGHT TRAIL ON THE PAGE NOW. `MyStanding` used to print
 * the viewer's own rows under a heading of its own, and those rows are a
 * subset of this list, held in less detail: the same table, the same helper,
 * the same reasons, minus the name of whoever made the change. The reason
 * that second list existed is a good one and it is written down in the card
 * it came from: a member should not have to hunt for their first name in a
 * village-wide table. The answer is to stop making them hunt. A row that
 * belongs to the viewer reads "You" and stands where it happened, so the near
 * question and the village's question are answered by one list read once.
 *
 * WHICH ROWS ARE THE VIEWER'S IS DECIDED FAIL-CLOSED. This route serves first
 * names only, so a namesake is indistinguishable, and this is a surface about
 * who holds power: telling a member that somebody else's change was theirs is
 * worse than telling them nothing. `GET /api/governance/standing` hands the
 * viewer their own rows out of the same table through the same helper, so a
 * village row is claimed only when its (moment, from, to, reason) tuple is one
 * the viewer's own rows carry AND it matches exactly one row in this list. An
 * ambiguous pair stays unmarked and simply reads as itself.
 *
 * The allocation list above the trail is NOT marked, for the same reason
 * inverted: a current allocation carries no moment and no reason, so the only
 * thing to match on is a first name and a number, and two members on the same
 * weight are ordinary. An unmarked list of holders is honest; a wrong "You"
 * on it would not be.
 *
 * It shows itself only where it says something. Under one-person-one-vote
 * with nothing ever allocated there is no record to read, and a card that
 * printed "nothing here" beside a live vote would be furniture.
 */
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { weightText } from "./voteBars";
import type { Standing, WeightRecord as WeightRecordData } from "./governanceApi";

/** How many changes show before a member asks for the rest. */
const FIRST_PAGE = 5;

/**
 * How far the collapsed list will stretch to reach the viewer's own newest
 * change. Far enough that a member usually finds their own row without asking
 * for the rest, and bounded so that a village which allocated to eighty people
 * last week does not hand every arrival the whole ledger.
 */
const REACH_FOR_MINE = 20;

/**
 * A change, keyed by the four things the two routes agree on exactly. Both
 * read `governance_weight_changes` through `weightHistory`, so `at` is the
 * same ISO string on both sides and not two renderings of one timestamp.
 */
const rowKey = (h: { at: string; oldWeight: number | null; newWeight: number; note: string }) =>
  `${h.at}|${h.oldWeight ?? "unset"}|${h.newWeight}|${h.note}`;

export default function WeightRecord({
  record,
  mine,
}: {
  record: WeightRecordData;
  /** The viewer's own rows, straight from `GET /api/governance/standing`. */
  mine: Standing["history"];
}) {
  const [showAll, setShowAll] = useState(false);

  /** True at index i when this village row is provably the viewer's own. */
  const isMine = useMemo(() => {
    const claimed = new Set(mine.map(rowKey));
    const seen = new Map<string, number>();
    for (const h of record.history) {
      const k = rowKey(h);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return record.history.map((h) => {
      const k = rowKey(h);
      return claimed.has(k) && seen.get(k) === 1;
    });
  }, [record.history, mine]);

  const holding = record.allocations.filter((a) => a.weight > 0);
  if (record.mode !== "custom" && record.history.length === 0) return null;
  if (holding.length === 0 && record.history.length === 0) return null;

  const newestMine = isMine.indexOf(true);
  const cut =
    newestMine >= 0 && newestMine < REACH_FOR_MINE ? Math.max(FIRST_PAGE, newestMine + 1) : FIRST_PAGE;
  const shown = showAll ? record.history : record.history.slice(0, cut);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
        <History className="w-4 h-4 text-notice" aria-hidden="true" />
        The weight record
        <InfoTip
          tip="Every change to anyone's voting weight is kept with its reason and its author, and every member can read it."
          label="What the weight record is"
        />
      </h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        {record.mode === "custom"
          ? `${holding.length} ${holding.length === 1 ? "member holds" : "members hold"} voting weight in this village.`
          : "This village does not allocate weight by hand today. What it did allocate is kept here."}
      </p>

      {holding.length > 0 && (
        <ul className="mt-3 space-y-1">
          {holding.map((a, i) => (
            <li key={`${a.member}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground">{a.member}</span>
              <span className="font-medium tabular-nums text-foreground">{weightText(a.weight)}</span>
            </li>
          ))}
        </ul>
      )}

      {record.history.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-sm font-semibold text-foreground">Every change, and who made it</h4>
          <ul className="mt-2 space-y-2.5">
            {/* `shown` is always a prefix of `record.history`, so i indexes
                `isMine` as well. */}
            {shown.map((h, i) => (
              <li key={`${h.at}-${i}`} className="text-sm">
                <span className={isMine[i] ? "font-semibold text-notice" : "font-medium text-foreground"}>
                  {isMine[i] ? "You" : h.member}
                </span>
                <span className="tabular-nums text-foreground">
                  {h.oldWeight === null ? " set to " : ` ${weightText(h.oldWeight)} to `}
                  {weightText(h.newWeight)}
                </span>
                <span className="text-muted-foreground">
                  {" by "}
                  {h.by} on{" "}
                  {new Date(h.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                </span>
                <p className="text-muted-foreground leading-relaxed">{h.note}</p>
              </li>
            ))}
          </ul>
          {record.history.length > cut && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-notice hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
            >
              {showAll ? "Show fewer changes" : `Show all ${record.history.length} changes`}
            </button>
          )}
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Append-only. Nothing on this list can be edited or removed, by anyone.
          </p>
        </div>
      )}
    </section>
  );
}
