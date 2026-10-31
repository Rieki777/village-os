/**
 * A CIRCLE'S SESSIONS, on its card (`/circles/:id`): the decision log and
 * this season's pulse for this one circle, mounted below the card by
 * client/src/pages/CircleCardPage.tsx.
 *
 * They are the /sessions sections themselves (`CircleDecisions`,
 * `CirclePulse`), handed this circle alone, so neither draws a circle chooser
 * and every rule they keep (who may set a review date, counts only and never
 * a name) is the same in both places.
 *
 * "Coming up" is not repeated here. The card's own "How we meet" already reads
 * the same summary through Live Sessions' door (`circleSummary`, read by
 * server/lib/circleCardData.ts), so the rhythm, the next meeting and the last
 * one are written once on the page.
 *
 * WHO SEES IT: the circle's members by standing, and admins, the audience the
 * decision log and the pulse are kept for (`mayKeepRhythm`), read off the
 * summary's `canKeep`. Nothing is asked unless the card says Live Sessions is
 * open to this reader (`viewer.sessionsOn`, server/routes/circleCard.ts), so a
 * visitor, or a village with the module off, sends no request at all. For
 * anyone who does not keep the circle, or when the summary does not answer,
 * this draws nothing: no heading, no loading line and no error, so the card
 * stands as it is.
 */
import { useEffect, useState } from "react";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";
import { circleSummaryUrl, type CircleSessionsSummary } from "@shared/sessionRhythm";
import { gameFetch } from "@/lib/gameApi";
import CircleDecisions from "./CircleDecisions";
import CirclePulse from "./CirclePulse";

/** Does this reader keep this circle? Anything but a clear yes is a no. */
async function readKeeps(circleId: string): Promise<boolean> {
  try {
    const res = await gameFetch(circleSummaryUrl(circleId), { method: "GET" });
    if (!res.ok) return false;
    const out = (await res.json().catch(() => null)) as Partial<CircleSessionsSummary> | null;
    return out?.canKeep === true;
  } catch {
    return false;
  }
}

export default function CircleSessions({ circleId, circleName, sessionsOn }: { circleId: string; circleName: string; sessionsOn: boolean }) {
  const [keeps, setKeeps] = useState(false);

  useEffect(() => {
    setKeeps(false);
    if (!sessionsOn || !circleId) return;
    let live = true;
    void readKeeps(circleId).then((yes) => live && setKeeps(yes));
    return () => {
      live = false;
    };
  }, [circleId, sessionsOn]);

  if (!keeps) return null;
  const circles = [{ id: circleId, name: circleName }];
  const only = [circleId];
  return (
    <div className="grid gap-8 pt-4">
      <CircleDecisions circles={circles} keepCircleIds={only} myCircleIds={only} lede={W.decisionsLede} />
      <CirclePulse circles={circles} keepCircleIds={only} myCircleIds={only} lede={W.pulseLede} />
    </div>
  );
}
