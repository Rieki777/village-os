/**
 * Choose who you will be.
 *
 * WHY THIS WAS REWRITTEN, so nobody reintroduces it: the first version was
 * styled for a dark screen this site does not have. It put cream text
 * (`text-amber-100`) on cards it assumed were near-black, and `Layout` renders
 * on the light parchment skin, so the page's own heading measured 1.00:1
 * against the background. Not low contrast. The same luminance. Invisible.
 *
 * index.css says it directly: the `-light` tokens are BACKGROUNDS for dark
 * text, and anything rendering on a light surface picks from the dark set
 * instead. So every string here is teal-deep, sage or a grey, and there is no
 * cream text anywhere on this page.
 *
 * NOT gold, and that is the second lesson. This comment used to say gold at
 * "6.2:1 on white", copied from the token's own comment, and both were wrong:
 * gold measures 4.55 on white and 4.07 on the #f2f2f2 body, so moving headings
 * to it shipped a REGRESSION from the 4.30 teal they replaced. sage is 5.95 and
 * 5.32. Anything on the page background is measured against #f2f2f2, never
 * against white, because the body is not white.
 *
 * The arrangement follows the same correction. A character select shows you
 * the CAST:
 *   - the portrait is the first thing on the page, not the last. It was below
 *     the fold and clipped by the bottom nav, which is the most valuable asset
 *     on the site arriving last;
 *   - the rail is FACES, not letters in circles. A letter is a placeholder for
 *     a face, and thirty faces already exist;
 *   - the heading is small. Two lines of display type in the palest colour
 *     took 40% of the first screen above a picture nobody could see, and
 *     fixing the contrast alone would have made the loudest thing on screen
 *     also the largest. You arrive here by choosing to; the page does not need
 *     to announce itself.
 */
import Layout from "@/components/Layout";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { announceProfileChange } from "@/lib/profileRefresh";
import { Star, X } from "lucide-react";
import PortraitStudio, { type StudioPayload } from "@/components/characters/PortraitStudio";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

interface Archetype {
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
}

interface Character {
  id: string;
  archetypeKey: string;
  presentation: "f" | "m";
  tone: "deep" | "olive" | "light";
  /** The member's own portrait when they have one, and the stock art otherwise. */
  avatar: string | null;
  /** The stock art on its own, so a surface can still show the village face. */
  stockAvatar: string | null;
  portrait: { source: "forged" | "uploaded"; published: boolean } | null;
  isPrimary: boolean;
}

interface Paths {
  roles: Array<{ id: string; name: string; recruiting: boolean; color: string | null }>;
  questCount: number;
}

const TONES: Array<{ key: Character["tone"]; label: string; swatch: string }> = [
  { key: "deep", label: "Deep", swatch: "#5B3A21" },
  { key: "olive", label: "Olive", swatch: "#A9743F" },
  { key: "light", label: "Light", swatch: "#E3B58C" },
];

/** The thirty assets are named by class, presentation and tone. */
const art = (key: string, p: string, t: string) => `/images/avatars/${key}-${p}-${t}.webp`;

/**
 * ARROW KEYS INSIDE A RADIOGROUP, because saying `role="radio"` is a promise.
 *
 * A group that announces itself as radios and then behaves like a row of
 * buttons is worse than the row of buttons was: a screen reader user is told
 * to expect arrow-key selection and does not get it. So the two groups below
 * carry the whole pattern, which is this handler plus a roving tabindex
 * (`tabIndex={selected ? 0 : -1}`), the same shape the ARIA authoring
 * practices describe. Both groups always have exactly one selected value, so
 * the roving index can never leave the group unreachable.
 *
 * Focus moves by index within the group's own DOM, so it does not care which
 * of the two groups it is in or how many options that one has.
 */
function radioArrows<T>(
  values: readonly T[],
  current: T,
  pick: (v: T) => void,
): (e: React.KeyboardEvent<HTMLButtonElement>) => void {
  return (e) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    const at = values.indexOf(current);
    const nextAt = (at + (forward ? 1 : -1) + values.length) % values.length;
    pick(values[nextAt]);
    const group = e.currentTarget.closest("[role='radiogroup']");
    const radios = group ? Array.from(group.querySelectorAll<HTMLElement>("[role='radio']")) : [];
    radios[nextAt]?.focus();
  };
}

export default function Characters() {
  const { user } = useAuth();
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [party, setParty] = useState<Character[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [presentation, setPresentation] = useState<Character["presentation"]>("f");
  const [tone, setTone] = useState<Character["tone"]>("olive");
  const [paths, setPaths] = useState<Paths | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /**
   * THREE READS, THREE STATES EACH.
   *
   * Every fetch on this page ended `.catch(() => {})`, so a failure was
   * indistinguishable from an empty answer: a dropped paths read left the
   * word "Looking." on screen permanently, and a dropped party read told a
   * member who plays six characters that they play none, and offered them
   * "Walk this path" for a class they already walk. An empty state is a
   * claim about the member, so it waits until there is an answer to make it
   * from.
   */
  const [castStatus, setCastStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [partyStatus, setPartyStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [pathsStatus, setPathsStatus] = useState<"loading" | "ready" | "failed">("loading");
  /** The one polite region for this page. Set in every mutation handler. */
  const [said, setSaid] = useState("");
  /** The character whose Leave is armed, if any. An unconfirmed DELETE. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioPayload | null>(null);

  const firstRun = useMemo(
    () => new URLSearchParams(window.location.search).get("first") === "1",
    [],
  );

  const loadCast = () => {
    setCastStatus("loading");
    fetch("/api/archetypes")
      .then((r) => {
        if (!r.ok) throw new Error(`archetypes ${r.status}`);
        return r.json();
      })
      .then((list: Archetype[]) => {
        const cast = Array.isArray(list) ? list : [];
        setArchetypes(cast);
        if (cast.length) setActiveKey((k) => k || cast[0].key);
        setCastStatus("ready");
      })
      .catch(() => setCastStatus("failed"));
  };
  useEffect(loadCast, []);

  const loadParty = () => {
    if (!user) return;
    setPartyStatus("loading");
    fetch("/api/me/characters", { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(`me/characters ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setParty(d?.party ?? []);
        setPartyStatus("ready");
      })
      .catch(() => setPartyStatus("failed"));
  };
  useEffect(loadParty, [user?.id]);

  const loadPaths = (key: string) => {
    setPaths(null);
    setPathsStatus("loading");
    fetch(`/api/archetypes/${encodeURIComponent(key)}/paths`)
      .then((r) => {
        if (!r.ok) throw new Error(`paths ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setPaths(d ?? null);
        setPathsStatus("ready");
      })
      .catch(() => setPathsStatus("failed"));
  };
  /*
   * The studio is its own read and not part of the party payload.
   *
   * The party is what a class LOOKS like and is fetched on four other
   * surfaces; the budget is a fact about this member's gifts and belongs to
   * this page alone. Putting the counters on the party would have shipped them
   * to every profile that renders a party rail, including a stranger's.
   */
  useEffect(() => {
    if (!user) return;
    fetch("/api/me/portraits", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStudio(d as StudioPayload))
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!activeKey) return;
    const mine = party.find((c) => c.archetypeKey === activeKey);
    if (mine) {
      setPresentation(mine.presentation);
      setTone(mine.tone);
    }
    loadPaths(activeKey);
  }, [activeKey, party.length]);

  const active = useMemo(() => archetypes.find((a) => a.key === activeKey) ?? null, [archetypes, activeKey]);
  const playing = useMemo(() => party.some((c) => c.archetypeKey === activeKey), [party, activeKey]);
  const stockSrc = activeKey ? art(activeKey, presentation, tone) : "";
  /*
   * A member who has made their own face for this class sees THEIR face on the
   * stage, not the village's. The presentation and tone controls below still
   * drive the stock art, which is what they are for, and the two swatch rows
   * keep working for every class with no portrait.
   */
  const ownPortrait = studio?.portraits?.find((p) => p.archetypeKey === activeKey)?.url ?? null;
  const heroSrc = ownPortrait ?? stockSrc;
  const heroBroken = broken[`${activeKey}-${presentation}-${tone}`] && !ownPortrait;

  /** A class's face for the rail: yours if you made one, the one you play, or a default to meet. */
  const faceFor = (key: string) => {
    const own = studio?.portraits?.find((p) => p.archetypeKey === key)?.url;
    if (own) return own;
    const mine = party.find((c) => c.archetypeKey === key);
    return mine?.avatar ?? art(key, "f", "olive");
  };

  const walk = async () => {
    if (!activeKey || busy) return;
    const label = active?.name ?? activeKey;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/me/characters", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ archetypeKey: activeKey, presentation, tone }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        const message = b.error || "That did not save. Try again.";
        setError(message);
        setSaid(message);
        return;
      }
      loadParty();
      setSaid(playing ? `${label} saved.` : `${label} joined your party.`);
      announceProfileChange();
    } catch {
      // The `await fetch` here had no try at all, so a dropped connection
      // threw out of a click handler: no message, no state change, and the
      // button left disabled by a `setBusy(false)` that never ran.
      const message = "That did not save. Try again.";
      setError(message);
      setSaid(message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * One party write, and WHAT TO SAY EITHER WAY.
   *
   * This had no else branch: a refused or dropped DELETE produced no message
   * and no state change, so the card stayed exactly as it was and the member
   * had no way to tell a successful leave from a failed one. Failures now
   * reach the same `role="alert"` the save error uses, and both outcomes go
   * through the live region.
   */
  const act = async (path: string, method: string, done: string, failed: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, { method, headers: headers() });
      if (!res.ok) throw new Error(`${method} ${res.status}`);
      const d = await res.json().catch(() => null);
      if (d?.party) setParty(d.party);
      else loadParty();
      setSaid(done);
      // The hero, the quest chips and the journey on /profile all describe
      // this party and all read once on mount. See lib/profileRefresh.ts.
      announceProfileChange();
    } catch {
      setError(failed);
      setSaid(failed);
    } finally {
      setBusy(false);
      setLeaving(null);
    }
  };

  if (!user) {
    return (
      <Layout>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-3xl font-display font-bold text-teal-deep">Choose who you will be</h1>
          <p className="mt-4 text-gray-700">Sign in to pick your paths.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-teal-deep/5 to-amber/5 pb-24 pt-6">
        <div className="container">
          {/* Small, because the picture is the headline. */}
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-sm font-semibold uppercase tracking-widest text-sage">
              Choose who you will be
            </h1>
            <p className="text-sm text-gray-700">
              Play as many as you like. Every door stays open to every hand.
            </p>
            {firstRun ? (
              <a href="/profile" className="min-h-11 py-3 text-sm font-medium text-teal-deep underline">
                Skip for now
              </a>
            ) : null}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[6rem_minmax(0,1fr)_20rem]">
            {/* THE STAGE, first in the DOM so a phone meets the character
                immediately. The rail follows it on small screens and moves
                left on wide ones. */}
            <section className="order-1 lg:order-2">
              <div className="relative overflow-hidden rounded-2xl bg-white shadow-lg">
                <div className="mx-auto aspect-[3/4] w-full max-w-sm">
                  {active && !heroBroken ? (
                    <img
                      src={heroSrc}
                      alt={active.name}
                      onError={() => setBroken((b) => ({ ...b, [`${activeKey}-${presentation}-${tone}`]: true }))}
                      className="h-full w-full object-cover motion-safe:animate-[breathe_7s_ease-in-out_infinite]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-teal-deep/10 to-amber/10">
                      <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-sage/50 text-4xl font-semibold text-teal-deep">
                        {active ? active.name.replace(/^The\s+/i, "").slice(0, 1) : "?"}
                      </div>
                    </div>
                  )}
                </div>
                {/*
                  Name over the art, the way a select screen names its cast.

                  THE SCRIM IS THE ONLY THING HOLDING THIS TEXT UP, and the
                  art behind it is thirty different portraits, so the worst
                  case has to be measured against WHITE. `from-black/75
                  to-transparent` fell linearly to nothing over the whole box,
                  so the scrim behind the top of the name was down to 30% and
                  the name measured 2.11:1 there. Holding the stop at
                  70% until 60% of the height keeps the whole text block above
                  the floor and leaves the fade where the art is. Measured in
                  Chromium over a pure-white portrait, on the real 120px box:
                  the name's worst pixel goes 2.11:1 to 8.53:1 and the
                  subtitle's 3.15:1 to 11.49:1. Even if the position stop were
                  ignored the via would land at 50% and the worst pixel would
                  be 4.94:1, so this cannot regress below AA.

                  The subtitle was `text-white/90`, which is the one line that
                  sits highest in the old gradient and the one that was
                  faded. Full white, and the size difference carries the
                  hierarchy on its own.
                */}
                {active ? (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/70 via-60% to-transparent px-5 pb-4 pt-12">
                    <h2 className="text-3xl font-display font-bold text-white">{active.name}</h2>
                    <p className="text-sm text-white">{active.subtitle}</p>
                  </div>
                ) : null}
              </div>

              {/*
                TWO CHOICES THAT SAID NOTHING ABOUT THEMSELVES.

                Both groups conveyed which option was live by COLOUR ALONE:
                no aria-pressed, no role, no grouping, so a screen reader
                heard six unrelated buttons and could not tell which
                presentation or which tone was selected either before or
                after pressing. They are what a radio group is for, and the
                only thing missing was saying so. The swatches also carried
                bare colour names as their whole accessible name, so "Deep"
                arrived with nothing to say what it was deep about, and they
                were 40px where every sibling control on this page already
                enforces the 44px floor.
              */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-5">
                <div role="radiogroup" aria-label="Presentation" className="flex items-center gap-2">
                  {(["f", "m"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={presentation === p}
                      tabIndex={presentation === p ? 0 : -1}
                      onKeyDown={radioArrows(["f", "m"] as const, presentation, setPresentation)}
                      onClick={() => setPresentation(p)}
                      className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium ${
                        presentation === p
                          ? "border-teal-deep bg-teal-deep text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {p === "f" ? "She" : "He"}
                    </button>
                  ))}
                </div>
                <div role="radiogroup" aria-label="Skin tone" className="flex items-center gap-3">
                  {TONES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="radio"
                      aria-checked={tone === t.key}
                      aria-label={`${t.label} skin tone`}
                      tabIndex={tone === t.key ? 0 : -1}
                      onKeyDown={radioArrows(
                        TONES.map((x) => x.key),
                        tone,
                        setTone,
                      )}
                      onClick={() => setTone(t.key)}
                      style={{ background: t.swatch }}
                      className={`h-11 w-11 rounded-full border-2 ${
                        tone === t.key ? "border-teal-deep ring-2 ring-teal-deep/40" : "border-gray-300"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={walk}
                  disabled={busy}
                  className="min-h-11 rounded-xl bg-teal-deep px-8 py-3 font-semibold text-white shadow hover:bg-teal-deep-dark disabled:opacity-50"
                >
                  {playing ? "Save this look" : "Walk this path"}
                </button>
                {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
              </div>
            </section>

            {/*
              THE CAST. Faces, not letters.

              THIRTY BUTTONS NAMED "S", "W" AND "H". Each button took its
              accessible name from its contents, and the contents are the
              image's `alt`, so the rail read correctly right up until a
              portrait failed to load. `onError` replaces the image with a
              single letter, and `title` is only consulted when there is no
              content at all, so a broken sprite sheet silently renamed every
              button in the rail to one letter. The name belongs on the
              button, where it does not depend on whether a file arrived.

              The star is the only signal that a class is already in the
              party, and an icon carries no text. It is described rather than
              folded into the name so the name stays the class, exactly as
              the visible title does, and the note is read after it.
            */}
            <nav aria-label="Classes" className="order-2 min-w-0 lg:order-1">
              {castStatus === "failed" ? (
                /*
                  THIS LINE SITS ON THE PAGE, NOT ON A CARD, so it takes the
                  semantic pair. Every card on this page is a hardcoded
                  `bg-white` holding a frozen ink, which is safe because
                  neither half answers to `.dark`. The page background does
                  answer to it, and the frozen inks measure about 2.9:1
                  (red-700) and 1.8:1 (teal-deep) there. Measured in Chromium
                  on the semantic pair: 6.98 light / 6.49 dark, and 16.01 /
                  14.73 for the control.
                  No new `text-gray-*` anywhere in this edit either: that
                  ratchet is at 1224 of 1224.
                */
                <p role="status" className="text-sm text-muted-foreground">
                  The cast did not load.{" "}
                  <button
                    type="button"
                    onClick={loadCast}
                    className="min-h-11 font-medium text-foreground underline underline-offset-2"
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              <ul className="flex flex-wrap justify-center gap-3 lg:flex-nowrap lg:flex-col lg:justify-start">
                {archetypes.map((a) => {
                  const chosen = party.some((c) => c.archetypeKey === a.key);
                  const isActive = a.key === activeKey;
                  const src = faceFor(a.key);
                  return (
                    <li key={a.key} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveKey(a.key);
                          setSaid(`${a.name} is on the stage.`);
                        }}
                        aria-current={isActive ? "true" : undefined}
                        aria-label={a.name}
                        aria-describedby={chosen ? `in-party-${a.key}` : undefined}
                        title={a.name}
                        className={`relative block h-20 w-20 overflow-hidden rounded-xl border-2 bg-white transition ${
                          isActive
                            ? "border-teal-deep ring-2 ring-teal-deep/30"
                            : "border-gray-200 hover:border-teal-deep/50"
                        }`}
                      >
                        {broken[src] ? (
                          <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-teal-deep">
                            {a.name.replace(/^The\s+/i, "").slice(0, 1)}
                          </span>
                        ) : (
                          <img
                            src={src}
                            alt={a.name}
                            onError={() => setBroken((b) => ({ ...b, [src]: true }))}
                            className="h-full w-full object-cover object-top"
                          />
                        )}
                        {chosen ? (
                          <>
                            <Star
                              className="absolute right-1 top-1 h-4 w-4 fill-gold text-sage drop-shadow"
                              aria-hidden="true"
                            />
                            <span id={`in-party-${a.key}`} className="sr-only">
                              In your party
                            </span>
                          </>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* The class card. */}
            <aside className="order-3 rounded-2xl bg-white p-6 shadow-lg">
              {active ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-sage">{active.subtitle}</p>
                  <p className="mt-2 text-gray-800">{active.blurb}</p>
                  {active.examples.length ? (
                    <ul className="mt-4 space-y-1.5">
                      {active.examples.map((e) => (
                        <li key={e} className="text-sm text-gray-700">
                          {e}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-teal-deep">
                    Open paths
                  </h3>
                  {/*
                    "Looking." WAS ALSO WHAT FAILURE LOOKED LIKE. The word was
                    gated on `paths === null`, and the read set null on every
                    outcome it did not like, so a 500 or a dropped connection
                    left the panel looking for something it had already
                    stopped looking for, permanently. The word now belongs to
                    the loading state alone, and a failure says so and offers
                    the one control that can help.
                  */}
                  {pathsStatus === "loading" ? (
                    <p role="status" className="mt-2 text-sm text-gray-600">Looking.</p>
                  ) : pathsStatus === "failed" ? (
                    <p role="status" className="mt-2 text-sm text-red-700">
                      The open paths did not load.{" "}
                      <button
                        type="button"
                        onClick={() => loadPaths(activeKey)}
                        className="min-h-11 font-medium text-teal-deep underline"
                      >
                        Retry
                      </button>
                    </p>
                  ) : !paths || paths.roles.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-700">
                      No roles carry this tag yet. Every role is still open to you.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {paths.roles.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: r.color || "#a06b1c" }}
                          />
                          <span className="flex-1 text-sm text-gray-800">{r.name}</span>
                          {r.recruiting ? (
                            <span className="rounded-full bg-sage-light px-2 py-0.5 text-xs font-medium text-sage">
                              Open
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {paths ? (
                    <p className="mt-4 text-sm text-gray-700">
                      {paths.questCount === 0
                        ? "The whole quest board is open to you."
                        : `${paths.questCount} quests on the land welcome these hands.`}
                    </p>
                  ) : null}
                </>
              ) : null}
            </aside>
          </div>

          {/* Your own face for this class. Below the stage, because the class
              is what you came here to choose and the portrait is what you do
              once you have chosen one. */}
          {active ? (
            <PortraitStudio
              archetypeKey={active.key}
              archetypeName={active.name}
              presentation={presentation}
              tone={tone}
              stockArt={stockSrc}
              studio={studio}
              onChanged={(next) => {
                setStudio(next);
                // The party carries the portrait too, so a change here changes
                // what the rail and the party row draw.
                loadParty();
              }}
              authHeaders={headers}
            />
          ) : null}

                    {/*
            Your party.

            The section is drawn whenever the read landed OR failed, because
            "you have no party" and "we could not find out" are different
            things and only the first of them is safe to render as silence.
          */}
          {partyStatus === "failed" ? (
            <section className="mt-10">
              <h2 className="text-lg font-display font-bold text-sage">Your party</h2>
              {/* On the page background, so the semantic pair. See the cast
                  failure line above for the measurements. */}
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                Your party did not load, so nothing here is the whole story.{" "}
                <button
                  type="button"
                  onClick={loadParty}
                  className="min-h-11 font-medium text-foreground underline underline-offset-2"
                >
                  Retry
                </button>
              </p>
            </section>
          ) : party.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-lg font-display font-bold text-sage">Your party</h2>
              <ul className="mt-3 flex flex-wrap gap-3">
                {party.map((c) => {
                  const a = archetypes.find((x) => x.key === c.archetypeKey);
                  const label = a?.name ?? c.archetypeKey;
                  return (
                    <li
                      key={c.id}
                      className={`relative w-28 overflow-hidden rounded-xl border-2 bg-white ${
                        c.isPrimary ? "border-teal-deep" : "border-gray-200"
                      }`}
                    >
                      <div className="aspect-[3/4] w-full bg-gray-50">
                        {c.avatar && !broken[c.avatar] ? (
                          <img
                            src={c.avatar}
                            alt={label}
                            onError={() => setBroken((b) => ({ ...b, [c.avatar as string]: true }))}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-teal-deep">
                            {label.replace(/^The\s+/i, "").slice(0, 1)}
                          </span>
                        )}
                      </div>
                      <p className="truncate px-2 py-1.5 text-xs font-medium text-gray-800">{label}</p>
                      {/*
                        THE SECOND TAP THAT DID NOT EXIST.

                        Leaving a character is a DELETE and it is not
                        reversible: the row goes, and walking the path again
                        starts a new character. It fired on the first tap of a
                        28x28 target sitting four pixels from its Front twin,
                        which is a mis-tap away from destroying something on
                        every phone. The first tap now ARMS and the destructive
                        control is a full-width labelled button underneath, so
                        the irreversible act is never the one nearest the
                        member's thumb. Both corner controls take the
                        `pointer-coarse` floor `StageAdvanced` already uses.
                      */}
                      <button
                        type="button"
                        aria-label={`Front ${label}`}
                        aria-pressed={c.isPrimary}
                        onClick={() =>
                          act(
                            `/api/me/characters/${c.id}/primary`,
                            "POST",
                            `${label} now fronts your sheet.`,
                            `${label} could not be fronted. Try again.`,
                          )
                        }
                        className="absolute left-1 top-1 inline-flex items-center justify-center rounded-full bg-white/90 p-1.5 shadow pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      >
                        <Star
                          className={`h-4 w-4 ${c.isPrimary ? "fill-gold text-sage" : "text-gray-500"}`}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={leaving === c.id ? `Keep ${label}` : `Leave ${label}`}
                        onClick={() => setLeaving((id) => (id === c.id ? null : c.id))}
                        className="absolute right-1 top-1 inline-flex items-center justify-center rounded-full bg-white/90 p-1.5 shadow pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      >
                        <X className="h-4 w-4 text-gray-600" aria-hidden="true" />
                      </button>
                      {leaving === c.id ? (
                        <div className="px-2 pb-2">
                          <p className="text-xs text-red-700">
                            Leaving removes {label} from your party for good.
                          </p>
                          <div className="mt-1.5 flex gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  `/api/me/characters/${c.id}`,
                                  "DELETE",
                                  `${label} left your party.`,
                                  `${label} could not leave. Try again.`,
                                )
                              }
                              className="min-h-11 flex-1 rounded-lg bg-red-700 px-2 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Leave
                            </button>
                            <button
                              type="button"
                              onClick={() => setLeaving(null)}
                              className="min-h-11 flex-1 rounded-lg border border-gray-300 px-2 text-xs font-semibold text-teal-deep"
                            >
                              Keep
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/*
            ONE POLITE REGION FOR THE PAGE, and the page needed one badly:
            picking a class swaps the entire stage, walking a path adds a card
            to a section that may not even be on screen, and leaving one takes
            a card away. All of it was silent. The region is always mounted so
            a change to its text is spoken; a region inserted with its text
            already in it announces nothing.
          */}
          <p aria-live="polite" className="sr-only">
            {said}
          </p>
        </div>
      </div>
    </Layout>
  );
}
