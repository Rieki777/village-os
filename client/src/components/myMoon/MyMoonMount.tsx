/**
 * The profile's one line for the end-of-moon review: My moon, and under it
 * the Moon reviews queue for whoever the server lets read it. Both load as
 * their own chunks, so a member whose village has the module off pays for
 * this file and nothing else, and each draws nothing when its door says no.
 *
 * The queue is asked for only when the reader holds a reviewing power
 * (batch 158): it asked for every member, and every non-reviewer's profile
 * logged a 403 for /api/moon-review/queue. The profile already reads which
 * powers the reader holds from /api/game/progression, the gate's own answer.
 */
import { lazy, Suspense } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
/** `MOON_REVIEW_MODULE` in shared/moonRecap.ts, spelled here so the profile chunk does not carry that file. */
const MOON_REVIEW_MODULE = "moon-review";

const MyMoon = lazy(() => import("./MyMoon"));
const ReviewQueue = lazy(() => import("./ReviewQueue"));

/** The powers the queue door answers to (server/routes/moonReview.ts): approvers and payers. */
const REVIEW_POWERS = ["moon.approve", "cash.pay"];

/** Whether the reader holds a reviewing power, from the progression's capability rows. Undefined while unknown. */
export function holdsReviewPower(rows: ReadonlyArray<{ key: string; held: boolean }> | null | undefined): boolean | undefined {
  if (!rows) return undefined;
  return rows.some((r) => r.held && REVIEW_POWERS.includes(r.key));
}

export default function MyMoonMount({ reviewer }: { reviewer?: boolean }) {
  const on = useModuleOn(MOON_REVIEW_MODULE);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <div id="my-moon" className="flex scroll-mt-28 flex-col gap-6">
        <MyMoon />
        {reviewer === true && <ReviewQueue />}
      </div>
    </Suspense>
  );
}
