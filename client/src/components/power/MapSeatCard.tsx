/**
 * THE MAP'S SEAT CARD: the role card, fed from `/api/map`, with the map's door.
 *
 * Takes the props the map's seat panel always passed (`seat`, `circle`,
 * `data`, `onPickPerson`), so `VillageMap` swaps one name for another. It
 * reads the seat into the card's input (`fromMapSeat`), reads the clock's
 * season and the village's class names (both cached reads, so the map's two
 * mounts of this card cost one request each, and neither is a members-only
 * route), and renders:
 *
 *   1. the card, with `SeatAction` in its slot (the map offers a raised hand
 *      and the contact relay);
 *   2. the Hypha DHO link when the circle decides there (P7), in the lens's
 *      own ink, outside the night card;
 *   3. the seat's history, outside the card for the same reason. An example
 *      seat's history is seeded demo rows, so it is left off rather than
 *      presented as a village's own record.
 *
 * `data-power-card` is on this wrapper as well as on the card, so the map's
 * print rule still hides every button under it, the history's included.
 */
import { ExternalLink } from "lucide-react";
import { authToken, useSeason } from "@/lib/gameApi";
import { useHypha } from "@/modules/ModuleProvider";
import { fromMapSeat, seasonForSheet } from "@shared/roleSheetInputs";
import SeatAction from "./SeatAction";
import SeatHistory from "./SeatHistory";
import SeatTradingCard from "./SeatTradingCard";
import type { PowerCircle, PowerData, PowerSeat } from "./types";
import { useClassNames } from "./useClassNames";

export default function MapSeatCard({
  seat,
  circle,
  data,
  onPickPerson,
}: {
  seat: PowerSeat;
  circle: PowerCircle | null;
  data: PowerData;
  /** A holder tap filters the map to that person's seats. */
  onPickPerson?: (holderKey: string, name: string | null) => void;
}) {
  const season = useSeason();
  const classNames = useClassNames();
  const hypha = useHypha();
  const input = fromMapSeat(seat, data, { signedIn: !!authToken() });
  const method = circle?.decidesBy ?? data.power?.decidesBy ?? null;

  return (
    <div data-power-card>
      <SeatTradingCard
        input={input}
        ctx={{ now: new Date(), season: seasonForSheet(season), classNames }}
        onPickPerson={onPickPerson}
        action={<SeatAction circleId={circle?.id ?? null} />}
      />
      {method === "hypha" && hypha.configured && (
        <p className="mt-3 px-1">
          <a
            href={hypha.links["map"] ?? hypha.orgUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-teal-deep/10 px-2 py-0.5 text-xs font-medium text-teal-deep hover:bg-teal-deep/20"
          >
            Binding record: Hypha DHO <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </p>
      )}
      {!seat.isExample && (
        <div className="mt-4 border-t border-border pt-3">
          <SeatHistory roleId={seat.id} canSeePeople={data.viewer.viewPeople} />
        </div>
      )}
    </div>
  );
}
