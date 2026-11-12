/**
 * TODAY, beside the circles map (Phase D, D2): which circles meet today, what
 * the fireflies on the map mean, and the member's own light with the one door
 * to change it.
 *
 * It names circles and never people. A count of lights is never printed; the
 * map shows them and this card says what they are. Shown to a signed-in
 * member only: the page passes null for a visitor and the card is not drawn.
 *
 * Phone: under the map, within the thumb's reach. Desktop: at the top of the
 * standing panel beside the map, so the words stay in view while the eye is
 * on the hearths.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "wouter";
import type { HearthsPayload } from "@shared/mapLight";
import { EYEBROW, LINK, TILE } from "@/components/journey/look";

/** Where the member's own setting lives: the profile's settings, at the control itself. */
export const MY_LIGHT_HREF = "/profile#map-light";

export interface TodayOnTheMapProps {
  today: HearthsPayload;
  /** Circle names by id, the village's own words. */
  circleName: (id: string) => string;
  className?: string;
}

export default function TodayOnTheMap({ today, circleName, className = "" }: TodayOnTheMapProps) {
  const { t, i18n } = useLingui();
  const meeting = today.hearths.filter((h) => h.meetsToday).map((h) => circleName(h.circleId));
  let names = meeting.join(", ");
  try {
    names = new Intl.ListFormat(i18n.locale || "en", { style: "long", type: "conjunction" }).format(meeting);
  } catch {
    /* An engine without ListFormat keeps the commas. */
  }

  return (
    <section data-today-on-map aria-label={t({ context: "circles map, today card", message: "Today on the map" })} className={`${TILE} space-y-2 ${className}`.trim()}>
      <p className={EYEBROW}>
        <Trans context="circles map, today card eyebrow">Today</Trans>
      </p>
      <p className="text-sm text-foreground" data-meeting-today>
        {meeting.length > 0 ? (
          <Trans context="circles map, today card">Meeting today: {names}.</Trans>
        ) : (
          <Trans context="circles map, today card">No circle meets today.</Trans>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans context="circles map, today card">
          Fireflies gather at a circle&apos;s hearth when people meet there. A light shows only for members who turned theirs on, and never with a name.
        </Trans>
      </p>
      <p className="text-sm text-muted-foreground" data-my-light={today.myLight ? "on" : "off"}>
        {today.myLight ? (
          <Trans context="circles map, today card">Your light is on.</Trans>
        ) : (
          <Trans context="circles map, today card">Your light is off.</Trans>
        )}{" "}
        <Link href={MY_LIGHT_HREF} className={`${LINK} inline-flex min-h-11 items-center`}>
          <Trans context="circles map, today card link to the setting">Change it</Trans>
        </Link>
      </p>
    </section>
  );
}
