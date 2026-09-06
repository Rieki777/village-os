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
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { authToken } from "@/lib/gameApi";
import { Link } from "wouter";
import { Star } from "lucide-react";
import { announceProfileChange, onProfileRefresh } from "@/lib/profileRefresh";

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

export default function ProfileHero({ name, handle }: { name: string; handle?: string | null }) {
  const [party, setParty] = useState<Character[]>([]);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [moons, setMoons] = useState<number | null>(null);
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
      setSaid(`${label} could not be fronted. Try again.`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {/* The hero. Tall card, so a three-quarter body portrait reads as a
            character rather than as an avatar thumbnail. */}
        <div className="h-56 w-44 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
          {primary?.avatar && !broken[primary.id] ? (
            <img
              src={primary.avatar}
              alt={nameOf(primary.archetypeKey)}
              onError={() => setBroken((b) => ({ ...b, [primary.id]: true }))}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-border text-3xl font-semibold text-foreground">
                {primary ? initial(primary.archetypeKey) : name.slice(0, 1)}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="mb-2 font-display text-3xl font-bold break-words text-foreground sm:text-4xl lg:text-5xl">{name}</h1>
          {primary ? (
            <p className="text-lg font-medium break-words text-foreground">
              {nameOf(primary.archetypeKey)}
              {subtitleOf(primary.archetypeKey) ? ` · ${subtitleOf(primary.archetypeKey)}` : ""}
            </p>
          ) : status === "loading" ? (
            <p role="status" className="text-lg text-muted-foreground">
              Reading your paths…
            </p>
          ) : status === "failed" ? (
            /* The failure branch that used to be the empty branch. Retry, and
               never the sentence that tells a member with six characters that
               they have none. */
            <p role="status" className="text-lg text-muted-foreground">
              Couldn't load your paths.{" "}
              <button
                type="button"
                onClick={() => load()}
                className="min-h-11 font-medium text-foreground underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="text-lg text-muted-foreground">
              No path chosen yet.{" "}
              <Link href="/profile/characters" className="font-medium text-foreground underline underline-offset-2">
                Choose who you will be
              </Link>
            </p>
          )}
          {title ? <p className="mt-1 font-medium break-words text-foreground">{title}</p> : null}
          <p className="mt-2 break-words text-muted-foreground">
            {handle ? `@${handle} · ` : ""}
            {moons === null ? "" : moons === 0 ? "New on the land" : `${moons} moons on the land`}
          </p>
        </div>
      </div>

      {/* The rest of the party, directly under the hero. Multi-class is the
          point, so every path a member walks is visible without scrolling. */}
      {party.length > 0 ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            {party.map((c) => (
              /* The name is on the BUTTON, not inherited from the image's
                 `alt`. `onError` two lines down replaces that image with a
                 single letter, and `title` is only consulted when there is no
                 content at all, so a portrait that failed to load used to
                 rename this control to "S". Same defect the class rail on
                 /profile/characters carried across thirty buttons. */
              <button
                key={c.id}
                type="button"
                onClick={() => front(c.id)}
                aria-label={`Front ${nameOf(c.archetypeKey)}`}
                aria-pressed={c.isPrimary}
                title={`Front ${nameOf(c.archetypeKey)}`}
                className={`relative w-20 shrink-0 overflow-hidden rounded-xl border bg-card transition ${
                  c.isPrimary ? "border-foreground ring-2 ring-ring" : "border-border hover:border-foreground"
                }`}
              >
                <span className="block aspect-[3/4] w-full bg-muted">
                  {c.avatar && !broken[c.id] ? (
                    <img
                      src={c.avatar}
                      alt={nameOf(c.archetypeKey)}
                      onError={() => setBroken((b) => ({ ...b, [c.id]: true }))}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-lg text-foreground">
                      {initial(c.archetypeKey)}
                    </span>
                  )}
                </span>
                {c.isPrimary ? (
                  <Star className="absolute left-1 top-1 h-4 w-4 fill-foreground text-foreground" aria-hidden="true" />
                ) : null}
              </button>
            ))}
            <Link
              href="/profile/characters"
              className="flex min-h-11 items-center rounded-xl border border-dashed border-border px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Add a path
            </Link>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Tap a character to front your sheet. Play as many as you like.
          </p>
        </div>
      ) : null}

      {/* ONE POLITE REGION FOR THIS PAGE. Fronting a character swaps the hero
          art, the name and the subtitle, and none of that was announced. The
          region is always in the DOM so a change to its text is spoken;
          rendering it only when there is something to say gives a reader
          nothing, because an inserted live region announces nothing. */}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </motion.div>
  );
}
