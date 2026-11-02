/**
 * The top of your own profile: who you are playing, before anything else.
 *
 * The character comes FIRST because it is the answer to "whose sheet is this".
 * A profile that opens with settings and mentions your characters two screens
 * down is a settings page wearing a character sheet's name. The primary
 * character's art is the hero, the rest of the party sits directly under it,
 * and switching who fronts the sheet is one tap from the top of the page.
 *
 * Medallion when there is no art, and never a broken image: the server returns
 * null for an avatar it does not have rather than a path that might 404, and
 * the img carries onError as well, because a file can go missing after the
 * server answered.
 */
import { useEffect, useState, type ReactNode } from "react";
import { m } from "framer-motion";
import { authToken, useGameConfig } from "@/lib/gameApi";
import { Link } from "wouter";
import { announceProfileChange, onProfileRefresh } from "@/lib/profileRefresh";
import { moonsOnLandPhrase } from "@shared/villageMoon";
import { MyGeneKeysSeal } from "@/components/geneKeys/ProfileGeneKeys";
import BadgeFlower, { type FlowerBadge } from "@/components/badges/BadgeFlower";
import BadgeRoster from "@/components/badges/BadgeRoster";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

interface Character {
  id: string;
  archetypeKey: string;
  avatar: string | null;
  isPrimary: boolean;
}

interface Archetype {
  key: string;
  name: string;
  subtitle: string;
}

/**
 * THE ARC IS THE LADDER, DRAWN ROUND THE FACE.
 *
 * `stageIndex` and `stageCount` are passed in rather than fetched, because
 * Profile.tsx already holds both: `stageIndex` off /api/game/me and `stages`
 * off /api/game/config. A second read here would be a second opinion about
 * the same fact, and the two would disagree for one render every time the
 * page refreshed after a rung turned.
 *
 * Both are optional and the arc simply does not draw without them. A hero that
 * renders a zero-length arc while it waits says "you have got nowhere", which
 * is a lie told confidently; drawing nothing says nothing.
 */
/** The ring's own circumference, at the radius the viewBox is drawn for. */
const RING_R = 124;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

export default function ProfileHero({
  name,
  handle,
  stageIndex,
  stageCount,
  stageLabel,
  season,
  rolesLine,
  actions,
  about,
  footer,
  badges,
  maxFeatured,
}: {
  name: string;
  handle?: string | null;
  stageIndex?: number | null;
  stageCount?: number | null;
  /** "Stage 5 · Member", off the ladder the page already holds. Absent, the pill counts the rung instead. */
  stageLabel?: string | null;
  /** "Season of Roots · day 41 of 92", added after the village's name when the season is known. */
  season?: string | null;
  /** The roles held, each as "Role (FirstName)". */
  rolesLine?: string | null;
  /** Invite and sign out, beside the eyebrow (approved design, 2026-10-30). */
  actions?: ReactNode;
  /** The about line and the path chips, under the identity. */
  about?: ReactNode;
  /** The next-rung bar, under the party. */
  footer?: ReactNode;
  /** Every badge held, featured first, drawn as the flower round the portrait. Off /api/badges/of, which the page already reads. */
  badges?: FlowerBadge[] | null;
  /** The featured cap that came with them, for the roster's picker. */
  maxFeatured?: number | null;
}) {
  const [party, setParty] = useState<Character[]>([]);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [moons, setMoons] = useState<number | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const village = useGameConfig()?.project;

  /*
   * THE FRACTION, AND WHY IT IS NOT stageIndex / stageCount.
   *
   * A member standing on the first rung has index 0, and 0/12 draws an empty
   * ring around somebody who has in fact arrived and been counted. The rungs
   * are the GAPS between positions, so a twelve-rung ladder has eleven of
   * them, and standing on the first means one position reached out of twelve.
   * `(index + 1) / count` is what makes the ring read as "where I am" instead
   * of "how much I have not done".
   */
  const known = typeof stageIndex === "number" && typeof stageCount === "number" && stageCount > 0;
  const arc = known ? Math.max(0, Math.min(1, (stageIndex + 1) / stageCount)) : null;
  // R47: progress is a number, and the ladder's name is the Path of Growth,
  // so the chip names the stage and never "Maturity".
  const rung = stageLabel || (known ? `Stage ${stageIndex + 1}/${stageCount}` : "");

  /*
   * THE VILLAGE'S NAME, AND NOT ITS TAGLINE.
   *
   * This joined name and tagline, the way the mockup did. The platform's
   * DEFAULT tagline is "healing the land and ourselves, together"
   * (shared/gameConfig.ts) and it is not empty, so every fork that had not
   * written its own printed Amora's words across the top of its members'
   * profiles. The QA screenshot said "UNNAMED VILLAGE - HEALING THE LAND AND
   * OURSELVES, TOGETHER", a village with no name of its own wearing somebody
   * else's motto, and it took an adversarial reader to notice.
   *
   * The name is always the village's own. A tagline is marketing copy and this
   * is an identity line, so dropping it costs nothing and leaks nothing.
   */
  const eyebrow = [String(village?.name ?? "").trim(), season ?? ""].filter(Boolean).join(" · ");

  /*
   * "Joined March 2026". Month and year, never a day: the exact date is not
   * something anybody needs off a profile, and a bare month reads as a season
   * rather than as a record.
   */
  const joinedLine = (() => {
    if (!joined) return "";
    const d = new Date(joined);
    if (!Number.isFinite(d.getTime())) return "";
    try {
      return `Joined ${new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d)}`;
    } catch {
      return "";
    }
  })();
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  /**
   * AN EMPTY PARTY IS A CLAIM, so it waits for an answer.
   *
   * `party` starts `[]` and the sentence under the name reads off its length,
   * so before the fetch landed, and forever after it failed, a member with
   * six characters was told "No path chosen yet. Choose who you will be." The
   * empty state is now gated on `status === "ready"`, and a failure says it
   * failed. Same three-state shape as WalletCard.
   */
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [roster, setRoster] = useState(false);
  const flower = badges ?? [];
  /** One polite region for this page's mutations. See `front` below. */
  const [said, setSaid] = useState("");

  // `quiet` re-reads without blanking what is already drawn, which is what a
  // refresh after a write wants: the sheet is correct, it is just one write
  // behind. Only the first read, and an explicit Retry, show the loading line.
  const load = (quiet = false) => {
    if (!quiet) setStatus("loading");
    fetch("/api/me/profile", { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(`me/profile ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setParty(d?.party ?? []);
        setTitle(d?.title ?? null);
        setMoons(typeof d?.moonsOnTheLand === "number" ? d.moonsOnTheLand : null);
        // Already in this payload and never read until now: server/lib/profile.ts
        // puts `joinedAt` in the profile lens. No new request for the join line.
        setJoined(typeof d?.joinedAt === "string" ? d.joinedAt : null);
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
  };
  useEffect(() => {
    load();
  }, []);
  // A character walked or left on /profile/characters, or fronted here.
  useEffect(() => onProfileRefresh(() => load(true)), []);
  useEffect(() => {
    fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : []))
      .then(setArchetypes)
      .catch(() => {});
  }, []);

  const nameOf = (key: string) => archetypes.find((a) => a.key === key)?.name ?? key;
  const subtitleOf = (key: string) => archetypes.find((a) => a.key === key)?.subtitle ?? "";
  const initial = (key: string) => nameOf(key).replace(/^The\s+/i, "").slice(0, 1);

  const primary = party.find((c) => c.isPrimary) ?? party[0] ?? null;

  /**
   * Fronting swaps the hero art, the name and the subtitle at once, and did
   * it in complete silence for a screen reader. It also had no else branch,
   * so a refusal changed nothing and said nothing.
   */
  const front = async (id: string) => {
    const label = nameOf(party.find((c) => c.id === id)?.archetypeKey ?? "");
    try {
      const res = await fetch(`/api/me/characters/${id}/primary`, { method: "POST", headers: headers() });
      if (!res.ok) throw new Error(`primary ${res.status}`);
      const d = await res.json().catch(() => null);
      if (d?.party) setParty(d.party);
      else load();
      setSaid(`${label} now fronts your sheet.`);
      // The quest chips, the balance and the journey below all describe this
      // profile, and all three read once on mount. See lib/profileRefresh.ts.
      announceProfileChange();
    } catch {
      setSaid("That didn't go through. Try again.");
    }
  };

  /* A character's art, or its initial when there is none or the file went missing. */
  const portrait = (size: "hero" | "card", c: Character | null) =>
    c?.avatar && !broken[c.id] ? (
      <img
        src={c.avatar}
        alt={nameOf(c.archetypeKey)}
        onError={() => setBroken((b) => ({ ...b, [c.id]: true }))}
        className="h-full w-full object-cover object-top"
      />
    ) : (
      <span className={`flex h-full w-full items-center justify-center font-display text-foreground ${size === "hero" ? "text-5xl" : "text-lg"}`}>
        {c ? initial(c.archetypeKey) : name.slice(0, 1)}
      </span>
    );

  return (
    <m.section aria-labelledby="hero-name" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:gap-9 sm:text-left">
        {/*
          THE PORTRAIT, ROUND, INSIDE THE LADDER (approved design, 2026-10-30).

          `object-top` is load-bearing. Every portrait in this system is 3:4
          body art, and a circle centred on a 3:4 figure is a crop of their
          torso. Anchoring to the top puts the head in the circle, which is the
          same crop server/lib/characterPortraits.ts applies to the bytes.

          The ring is one circle with `stroke-dasharray` set to its whole
          circumference and the offset carrying the fraction, rotated so it
          starts at twelve o'clock. The track behind it is always whole, so the
          shape reads as "this much of that" and never as a broken ring.
        */}
        {/*
          THE BADGE FLOWER (Rye, 2026-10-30) sits behind the ring and the face,
          its petals overhanging the square, so the square gains a margin while
          there are petals to hold. The ring and the portrait let a click fall
          through to it, and the seal and the stage chip stay on top.
        */}
        <div className={`relative h-[150px] w-[150px] shrink-0 sm:h-[236px] sm:w-[236px] ${flower.length ? "my-7 sm:m-11" : ""}`}>
          <div className="absolute inset-0 rounded-full shadow-[0_0_40px_color-mix(in_srgb,var(--color-dash-gold)_25%,transparent)]" aria-hidden="true" />
          <BadgeFlower
            badges={flower}
            label={`Your badges, ${flower.length} held. Open the roster and pick which show on your card.`}
            onOpen={() => setRoster(true)}
          />
          {arc !== null && (
            <svg viewBox="0 0 260 260" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <circle cx="130" cy="130" r={RING_R} fill="none" stroke="var(--color-dash-track)" strokeWidth="12" />
              <circle
                cx="130" cy="130" r={RING_R} fill="none"
                stroke="var(--color-dash-gold)" strokeWidth="12"
                transform="rotate(-90 130 130)"
                strokeDasharray={CIRCUMFERENCE.toFixed(1)}
                strokeDashoffset={(CIRCUMFERENCE * (1 - arc)).toFixed(1)}
              />
            </svg>
          )}
          <div className="pointer-events-none absolute inset-[6px] overflow-hidden rounded-full border-4 border-background bg-muted">
            {portrait("hero", primary)}
          </div>
          {/* Their Gene Keys seal, top right, opposite the stage chip. Nothing while the module is off or nothing is saved. */}
          <MyGeneKeysSeal />
          {rung && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-[3px] border-background bg-dash-gold px-3 py-0.5 text-xs font-bold text-dash-gold-ink sm:bottom-1.5 sm:px-3.5 sm:py-1 sm:text-sm">
              {rung}
            </span>
          )}
        </div>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {/* The village's own name, and the season when it is known. A fork reads its own, or nothing. */}
            {eyebrow ? (
              <p className="m-0 hidden text-[13px] uppercase tracking-[0.23em] text-muted-foreground sm:block sm:flex-1">{eyebrow}</p>
            ) : (
              <span className="hidden sm:block sm:flex-1" />
            )}
            {actions}
          </div>
          <h1 id="hero-name" className="m-0 break-words font-display text-[44px] leading-none text-foreground sm:text-[72px] sm:leading-[0.95]">
            {name}
          </h1>
          {primary ? (
            <p className="m-0 break-words text-[15px] font-medium text-dash-gold-lit sm:text-[21px]">
              {nameOf(primary.archetypeKey)}
              {subtitleOf(primary.archetypeKey) ? ` · ${subtitleOf(primary.archetypeKey)}` : ""}
            </p>
          ) : status === "loading" ? (
            <p role="status" className="m-0 text-lg text-muted-foreground">
              Reading your characters…
            </p>
          ) : status === "failed" ? (
            /* The failure branch that used to be the empty branch. Retry, and
               never the sentence that tells a member with six characters that
               they have none. */
            <p role="status" className="m-0 text-lg text-muted-foreground">
              Your characters didn't load.{" "}
              <button
                type="button"
                onClick={() => load()}
                className="min-h-11 font-medium text-foreground underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="m-0 text-lg text-muted-foreground">
              No character chosen yet.{" "}
              <Link href="/profile/characters" className="font-medium text-foreground underline underline-offset-2">
                Choose who you will be
              </Link>
            </p>
          )}
          {title ? <p className="m-0 font-medium break-words text-foreground">{title}</p> : null}
          <p className="m-0 hidden break-words text-base text-muted-foreground sm:block">
            {/* Every part is optional and the separators are joined, so a
                missing join date never leaves a stray middle dot. */}
            {[handle ? `@${handle}` : "", joinedLine, moonsOnLandPhrase(moons), rolesLine ?? ""].filter(Boolean).join(" · ")}
          </p>
          {about}

          {/* The party, under the identity. Multi-class is the point, so every
              character a member plays is visible without scrolling. On a phone
              the party lives on the Sheet tab instead. */}
          {party.length > 0 ? (
            <div className="mt-2 hidden flex-wrap items-center gap-3 sm:flex">
              {party.map((c) => (
                /* The name is on the BUTTON, not inherited from the image's
                   `alt`. `onError` replaces that image with a single letter,
                   and `title` is only consulted when there is no content at
                   all, so a portrait that failed to load used to rename this
                   control to "S". */
                <button
                  key={c.id}
                  type="button"
                  onClick={() => front(c.id)}
                  aria-label={`Front ${nameOf(c.archetypeKey)}`}
                  aria-pressed={c.isPrimary}
                  title={`Front ${nameOf(c.archetypeKey)}`}
                  className={`relative h-24 w-[76px] shrink-0 overflow-hidden rounded-[14px] border-[3px] bg-muted p-0 transition ${
                    c.isPrimary
                      ? "border-dash-gold shadow-[0_0_18px_color-mix(in_srgb,var(--color-dash-gold)_60%,transparent)]"
                      : "border-foreground hover:border-dash-gold"
                  }`}
                >
                  {portrait("card", c)}
                </button>
              ))}
              <Link
                href="/profile/characters"
                className="flex h-24 flex-col items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-border px-[18px] text-sm font-medium text-foreground hover:bg-muted"
              >
                Forge a character
                <span className="text-xs text-muted-foreground">Play as many as you like</span>
              </Link>
            </div>
          ) : null}
          {footer}
        </div>
      </div>

      {/* ONE POLITE REGION FOR THIS PAGE. Fronting a character swaps the hero
          art, the name and the subtitle, and none of that was announced. The
          region is always in the DOM so a change to its text is spoken;
          rendering it only when there is something to say gives a reader
          nothing, because an inserted live region announces nothing. */}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <BadgeRoster
        open={roster}
        onOpenChange={setRoster}
        badges={flower}
        maxFeatured={maxFeatured ?? null}
        whose={null}
        editable
        onChanged={announceProfileChange}
      />
    </m.section>
  );
}
