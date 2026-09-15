import Layout from "@/components/Layout";
import GameDashboard from "@/components/GameDashboard";
import ProfileJourney from "@/components/ProfileJourney";
import NotifyPrefsPanel from "@/components/NotifyPrefsPanel";
import YourAgentPanel from "@/components/YourAgentPanel";
import ProfileSheet from "@/components/ProfileSheet";
import ProfileHero from "@/components/ProfileHero";
import OnchainCard from "@/components/OnchainCard";
import WalletCard from "@/components/WalletCard";
import SendTokensCard from "@/components/SendTokensCard";
import MaturityLadder from "@/components/profile/MaturityLadder";
import PowersMap from "@/components/profile/PowersMap";
import PathsPanel, { type PathTile } from "@/components/profile/PathsPanel";
import StandingRow from "@/components/profile/StandingRow";
import PathFacts from "@/components/profile/PathFacts";
import QuietSection from "@/components/profile/QuietSection";
import { SHEET_SECTIONS } from "@/components/profile/sheetSections";
import SurfacedBanner from "@/components/profile/SurfacedBanner";
import { useSurfaced } from "@/components/profile/useSurfaced";
import TheVessel from "@/components/profile/TheVessel";
import MoonDock from "@/components/profile/MoonDock";
import NightMotes from "@/components/profile/NightMotes";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGameMe, gameFetch, useGameConfig, type GameMe, type ProgressionCapability } from "@/lib/gameApi";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Edit2, LogOut, ArrowRight, CheckCircle2 } from "lucide-react";
import { useTokenName } from "@/hooks/useTokenNames";
import { usePathLadders } from "@/hooks/usePathLadders";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { onProfileRefresh } from "@/lib/profileRefresh";

/**
 * THE CHARACTER SHEET.
 *
 * The page this replaced answered "what data do we hold about this user". It
 * opened with settings, listed capability keys as identical chips, and gave
 * each path a card that could only ever say "Not recorded yet". A character
 * sheet answers three questions in order: who am I here, how far have I come
 * and what is next, and what can I do right now.
 *
 *   Hero        who am I here
 *   Next step   what is next, server-resolved, kept exactly as it was
 *   Paths       which parts of village life you are here for
 *   Maturity    how far you have come, and what opens the next rung
 *   Powers      what you can do right now, and where climbing leads
 *
 * ── EVERY FIGURE COMES OFF A PAYLOAD ────────────────────────────────────────
 *
 * There is no number on this page that this file computes, guesses or holds a
 * literal for. `stages` and `paths` come from `/api/game/config`, already
 * overlaid with this village's own variables. `stageIndex`, `consentedQuests`
 * and `capabilityCatalogue` come from `/api/game/progression`, from the same
 * reads that DECIDE the rung and the gate. A count that has no payload behind
 * it is not rendered at all.
 *
 * ── THE THEME MIGRATION, DONE AS PAIRS ──────────────────────────────────────
 *
 * The old page was theme-frozen, and that is what kept it safe: every card
 * paired a hardcoded surface (`bg-white`, `bg-gray-50`) with hardcoded
 * numbered-gray text, and neither half answers to `.dark`, so the pair held in
 * both themes. `--muted-foreground` IS theme-responsive, so dropping
 * `text-muted-foreground` onto a hardcoded `bg-gray-50` would measure 2.76:1
 * at night, a real AA failure invisible to anyone testing in daylight.
 *
 * So every card rebuilt here moved BOTH halves at once, to the semantic set:
 * `bg-card` / `text-card-foreground` / `text-muted-foreground` /
 * `border-border` / `bg-muted`. Those are the only foregrounds in this build
 * that are redefined under `.dark`. `--color-sage` and `--color-amber-ink` are
 * defined once in `@theme` and never redefined, so they are frozen dark inks
 * for light surfaces and are not used on any themed surface on this page.
 */

export default function Profile() {
  const [, navigate] = useLocation();
  const tokenName = useTokenName("Recognition");
  const { user, logout, loading, updateProfile } = useAuth();
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState(user?.bio || "");
  const [savingBio, setSavingBio] = useState(false);
  const [bioError, setBioError] = useState("");
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [pathError, setPathError] = useState("");
  const config = useGameConfig();

  /**
   * The progression read, once for the page.
   *
   * Null until it lands, and null means UNKNOWN: Maturity and Powers stay away
   * until there is something true to draw, and never render a zero standing in
   * for an answer that has not arrived.
   */
  const [prog, setProg] = useState<{
    stageIndex: number;
    consentedQuests: number;
    /** Mandatory-module progress, absent on a server that predates the field. */
    training?: { done: number; required: number };
    capabilityCatalogue: ProgressionCapability[];
  } | null>(null);
  /*
   * ONE READ OF /api/game/me, AND IT IS WHAT MAKES THE BALANCE CORRECT.
   *
   * `user.recognitionBalance` is the cached MINOR-UNIT column and this page
   * printed it raw at 5xl, so a token with two decimals read a hundred times
   * too large. This payload carries the balance AND its scale together, which
   * is the only pair that can be formatted honestly, and it also carries the
   * budget the vessel needs and the stage the multiplier sentence needs.
   * Read once here and passed down rather than fetched per card.
   */
  const [me, setMe] = useState<GameMe | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  /*
   * A FAILED RE-READ NEVER ERASES WHAT IS ALREADY IN HAND.
   *
   * `fetchGameMe` answers null for a non-ok response WITHOUT throwing, so a 500
   * arrived down the SUCCESS path and ran setMe(null). After a give that really
   * happened, that unmounted the vessel, the balance and the "Sent."
   * confirmation together, leaving a member one plausible retry away from
   * sending twice. `if (d)` is the whole fix, and it protects the standing row
   * as well, which a guard inside the vessel could never have reached.
   */
  const reloadMe = () => {
    fetchGameMe()
      .then((d) => {
        if (d) { setMe(d); setMeFailed(false); } else setMeFailed(true);
      })
      .catch(() => setMeFailed(true));
  };
  useEffect(reloadMe, []);
  /*
   * ONE READ, AND IT RE-READS FOR EVERYBODY.
   *
   * GameDashboard kept its own /api/game/me and its own refresh listener, so
   * the profile fetched that payload twice on every mount, and a give updated
   * the two cards on two different round trips. The page owns the read now and
   * hands it down, which halves the requests AND means the vessel and the
   * dashboard can no longer disagree about a balance for the width of one
   * fetch.
   */
  useEffect(() => onProfileRefresh(reloadMe), []);

  useEffect(() => {
    let live = true;
    gameFetch("/api/game/progression")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setProg(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /**
   * Where this member stands on each path they walk.
   *
   * Called before the early returns below, because a hook has to be. Null until
   * it lands and null means UNKNOWN, the same contract `prog` above holds: no
   * ladder is drawn until there is one to draw. A member who walks no path
   * makes no request at all, and claiming a path re-reads.
   */
  const { ladders, particulars, failed: laddersFailed } = usePathLadders(user?.paths ?? []);

  /**
   * Take a path or let one go.
   *
   * The tile never draws its own conclusion. `updateProfile` reads the
   * Response, throws on a refusal, and replaces the member from the body the
   * server sent, so the tile is showing what was SAVED and not what was
   * clicked. A 400 from claimPaths lands in `pathError` and the tile stays as
   * it was, which is the honest picture of a claim that did not land.
   */
  const togglePath = async (pathId: string) => {
    if (savingPath || !user) return;
    setSavingPath(pathId);
    setPathError("");
    const next = user.paths.includes(pathId)
      ? user.paths.filter((p) => p !== pathId)
      : [...user.paths, pathId];
    try {
      await updateProfile({ paths: next });
    } catch (e: any) {
      // `updateProfile` rethrows the server's own `error` field, and one of
      // them is a machine code: a revoked or expired token answers
      // "auth_required", which was reaching the member verbatim. The 400 from
      // claimPaths is already a sentence and is shown as it stands.
      setPathError(
        e?.message === "auth_required"
          ? "Your session ended. Sign in again to change your paths."
          : e?.message || "Could not save, try again",
      );
    } finally {
      setSavingPath(null);
    }
  };

  const saveBio = async () => {
    setSavingBio(true);
    setBioError("");
    try {
      await updateProfile({ bio: bioText });
      setEditingBio(false);
    } catch (e: any) {
      setBioError(e?.message || "Could not save, try again");
    } finally {
      setSavingBio(false);
    }
  };

  /*
   * ── THIS BLOCK SITS ABOVE THE EARLY RETURNS, AND HAS TO ────────────────
   *
   * `useSurfaced` is a hook, and the two guards below this point return before
   * the rest of the component runs. Called after them, it runs on some renders
   * and not others, and React counts hooks per render: the count changed and
   * the page threw "Rendered more hooks than during the previous render".
   *
   * It was invisible in testing for a reason worth recording. This route is
   * lazy, so on a normal load the chunk usually arrives AFTER AuthContext has
   * flipped `loading` to false, and the first render already runs the hook.
   * The deterministic break is SIGN OUT: `user` goes null, the second guard
   * returns, the hook count drops, and the profile throws on the way out. No
   * QA pass that never signs out can see it.
   *
   * Nothing here may read `user` without a guard of its own, because at this
   * point in the render `user` is still allowed to be null.
   */
  const offerKnown = config !== null;
  /*
   * WHAT IS OPEN TO THIS MEMBER, in the sheet's own declared order, which is
   * the order the surfacing queue meets them in.
   *
   * A path section counts as open the moment the path is walked. The bands that
   * are always present are not candidates at all: "newly open" has to mean
   * something a member did not have before, and a section every member has had
   * since their first minute has never opened for anybody.
   */
  const walkedPaths = user?.paths ?? [];
  const openSections = SHEET_SECTIONS.filter(
    (sec) => sec.band === "path" && sec.path && walkedPaths.includes(sec.path),
  ).map((sec) => sec.id);
  const surfaced = useSurfaced(openSections, offerKnown);

  if (loading) {
    return (
      <Layout>
        <div className="sheet-night flex min-h-screen items-center justify-center bg-background">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity }}>
            <Heart className="h-12 w-12 text-teal-deep" />
          </motion.div>
        </div>
      </Layout>
    );
  }

  if (!user) {
    navigate("/login");
    return null;
  }

  const recentContributions = (user.contributions ?? []).slice(-5).reverse();

  /**
   * Every path this member can act on: what the village offers, then anything
   * they already hold that the offer no longer names. `config` is null until
   * /api/game/config answers, and null means UNKNOWN: the offer is left out
   * until it arrives instead of being guessed at, so a fork's own paths are
   * never briefly overwritten by this build's four.
   *
   * The union is the point. The server agrees, and says so in claimPaths: an
   * id you already hold stays claimable however the offer moves, so a member
   * can always see a retired path and let it go.
   */
  const offeredPaths = config?.paths ?? [];

  const surfacedSection = SHEET_SECTIONS.find((sec) => sec.id === surfaced.sectionId);
  const surfacedLabel = surfacedSection?.path
    ? (offeredPaths.find((p) => p.id === surfacedSection.path)?.label ?? "")
    : "";

  const pathTiles: PathTile[] = [
    ...offeredPaths.map((p) => ({
      id: p.id,
      label: p.label,
      role: p.role,
      route: p.route,
      offered: true,
    })),
    ...user.paths
      .filter((id) => !offeredPaths.some((p) => p.id === id))
      .map((id) => ({ id, label: id, role: "", route: "", offered: false })),
  ];

  return (
    <Layout>
      {/*
        `sheet-night` is the whole theme change. It redeclares the semantic
        colour tokens and the display face on THIS element, so every descendant
        that already reads `bg-card`, `text-muted-foreground`, `border-border`
        and the rest resolves them against the night world instead of the app's
        light or dark one. No component under here needed an edit; the block
        and the reasoning live in client/src/index.css.

        It is the same class on the loading branch above, so the page does not
        flash a daylight ground before the member lands.
      */}
      {/*
        THE AIR AND THE MOON.

        `relative` is new and it is load-bearing: NightMotes is
        `absolute inset-0` and needs this element to be what it measures, or it
        fills the viewport and scrolls away from the page it belongs to.

        The motes sit BEFORE the container and behind it, so nothing on the
        sheet has to know they exist. MoonDock is `fixed` and renders its own
        layer, so it is placed last for source order: a keyboard reaches the
        member's own page before it reaches an ornament.
      */}
      <div className="relative sheet-night min-h-screen bg-background py-12">
        <NightMotes />
        <div className="relative container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {/*
              WHO YOU ARE PLAYING, FIRST.

              `flex justify-between` with no column breakpoint put a 5xl
              heading and a Sign Out button on one row at 375px, which is how
              a long name produced scrolling in two dimensions. Stacked below
              `sm`, and the button sits after the identity in source order so
              a keyboard reaches the name first.
            */}
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                {/* The ladder position comes from HERE and not from a second
                    fetch inside the hero: `prog.stageIndex` is /api/game/me and
                    `config.stages` is /api/game/config, both already read above.
                    Two reads of one fact disagree for one render every time a
                    rung turns. Null while either is loading, and the arc draws
                    nothing rather than drawing zero. */}
                <ProfileHero
                  name={user.name}
                  handle={user.handle}
                  stageIndex={prog?.stageIndex ?? null}
                  stageCount={config?.stages?.length ?? null}
                />
                {/*
                  WHERE YOU STAND, under the identity and above everything else.

                  `held` is the balance AND its scale, from /api/game/me, which
                  is the only pair that can be formatted honestly. It is null
                  while that read is in flight, and the figure is simply absent
                  until it lands rather than flashing a wrong number.

                  Powers open is counted from the catalogue's held flags, which
                  is the same set PowersMap draws from, so the figure and the
                  section below it can never disagree.
                */}
                <StandingRow
                  standing={{
                    held: me ? { units: Number(me.gratitude.balance ?? 0), decimals: Number(me.gratitude.decimals ?? 0) } : null,
                    powersOpen: prog ? prog.capabilityCatalogue.filter((c) => c.held).length : null,
                    pathsWalked: user.paths.length,
                    questsDone: prog?.consentedQuests ?? null,
                  }}
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => logout()}
                className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </motion.button>
            </div>

            {/* WHAT IS NEXT. Server-resolved, and the only element on this page
                that answers a question without making the member assemble it.
                Untouched: the banner, its label, its href and its wrapping all
                stay exactly as they were. */}
            <div className="mb-8">
              {/* The page's own /api/game/me read, handed down. Rendered bare,
                  GameDashboard fetches the same thing again, so one failure had
                  two different remedies on one screen and the member met
                  whichever retry they scrolled to first. */}
              <GameDashboard me={me} meFailed={meFailed} />
            </div>

            <div className="space-y-8">
              {/* WHO YOU ARE HERE. */}
              {/*
                THE ONE PLACE THE FIXED ORDER BENDS, and it bends by a signpost
                rather than by moving anything.

                A section that has just opened is named here for a visit or two
                and then settles. The section itself never leaves its home: this
                points DOWN at it. Rendering the section up here instead would
                put the same thing on the page twice and leave a member unsure
                whether they were looking at two things or one.
              */}
              {/*
                THE ANNOUNCEMENT, in a region that is always mounted.

                The banner below is inserted complete, text and all, so a live
                region ON it announces nothing: assistive technology watches an
                existing region for a CHANGE, and a node that arrives already
                carrying its message is not a change. This paragraph is here on
                every render and empty until there is something to say.
              */}
              <p aria-live="polite" className="sr-only">
                {surfacedSection && surfacedLabel ? `${surfacedLabel} is newly open to you.` : ""}
              </p>

              {surfacedSection && surfacedLabel ? (
                <SurfacedBanner
                  title={surfacedLabel}
                  because={surfacedSection.quiet.replace(/, once you walk.*$/, ".")}
                  onGo={() => {
                    surfaced.acknowledge(surfacedSection.id);
                    /* Every surfaceable section today is a path section, and a
                       path's content lives in PathsPanel, so that is the anchor.
                       Falling back to the section's own id keeps this correct
                       for whatever surfaces next without another edit here. */
                    (document.getElementById(`sheet-${surfacedSection.id}`) ??
                      document.getElementById("sheet-paths"))?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              ) : null}

              {/*
                ABOUT YOU IS A DAY-ONE ACT, so it reads in the day-one band.

                It was eleven sections down, below Powers and the whole record,
                which put one of the two things a brand-new member can actually
                DO on arrival past everything they cannot. Writing a bio and
                choosing a character are the acts available before anything has
                been earned; the character picker already sits in the hero, and
                this belongs beside it.
              */}
              <motion.section
                aria-labelledby="bio-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h2 id="bio-h" className="font-display text-2xl font-bold text-card-foreground">
                    About You
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setBioText(user.bio || "");
                      setEditingBio(!editingBio);
                    }}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                    aria-label={editingBio ? "Stop editing your bio" : "Edit your bio"}
                  >
                    <Edit2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </button>
                </div>
                {editingBio ? (
                  <>
                    <label htmlFor="profile-bio" className="sr-only">
                      Your bio
                    </label>
                    <textarea
                      id="profile-bio"
                      value={bioText}
                      onChange={(e) => setBioText(e.target.value)}
                      placeholder="Tell us about yourself..."
                      className="w-full rounded-lg border border-border bg-background p-4 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      rows={4}
                    />
                    {bioError && (
                      <p role="alert" className="mt-2 text-sm text-destructive">
                        {bioError}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      {/* This Save is the whole point: the editor used to
                          discard every word on close, silently.

                          `border border-border` is the one thing `sheet-night`
                          could not fix from the token layer. The fill is
                          `--tone-brand`, which is the VILLAGE's colour and is
                          derived to clear AA against WHITE, so it is dark by
                          construction: measured on the night panel it is
                          1.58:1 as a shape, against a 3:1 floor, for the
                          platform default and for any seed a village picks.
                          Retinting it would overwrite the brand, so the button
                          takes an edge instead. `--border` on `--card`
                          measures 3.94:1, the label stays white on the
                          village's own colour at 10.37:1, and the boundary is
                          now seed-independent. */}
                      <button
                        onClick={saveBio}
                        disabled={savingBio}
                        className="min-h-11 rounded-lg border border-border bg-teal-deep px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {savingBio ? "Saving" : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setBioText(user.bio || "");
                          setEditingBio(false);
                          setBioError("");
                        }}
                        className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                    {/* The page carried no aria-live at all, so a save landed
                        in silence for anyone not watching the button. */}
                    <p aria-live="polite" role="status" className="sr-only">
                      {savingBio ? "Saving your bio." : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-lg leading-relaxed text-muted-foreground">
                    {user.bio || "No bio yet. Add one to help other villagers know you."}
                  </p>
                )}
              </motion.section>

              {/*
                THE VESSEL SITS IN THE "NOW" BAND, and a subject stays whole.

                Giving is a day-one act: a member has a sending allowance from
                the moment they arrive, before they have walked a path or
                claimed a quest. The gratitude LEDGER inside this panel is empty
                for months, and the gradient would put that low, but splitting a
                subject to satisfy an ordering is how the six sections happened
                in the first place. A subject sits at the height of its most
                actionable part and its history rides inside it.
              */}
              {/*
                THE VESSEL, WHERE SIX SECTIONS USED TO BE.

                This span was the raw-balance card: a MINOR-unit column printed
                at 5xl with no scale, which is a hundred times too large for any
                token with two decimals. It is gone rather than patched, because
                the same number was also on ProfileSheet and in the dashboard
                card, and patching one of three is how a defect survives.
              */}
              <TheVessel
                gratitude={me?.gratitude ?? null}
                here={me?.stage ?? null}
                next={me && me.stages ? (me.stages[me.stageIndex + 1] ?? null) : null}
                failed={meFailed}
                onGiven={reloadMe}
              />
              {/*
                THE ANCHOR THE SURFACED BANNER POINTS AT.

                A walked path's ladder renders inside PathsPanel, so this is
                where "take a look" lands. The banner names the path and this is
                the thing it means; a second surface for a walked path would be
                the duplicate the whole consolidation exists to avoid.
              */}
              <div id="sheet-paths" className="scroll-mt-6">
              <PathsPanel
                tiles={pathTiles}
                claimedIds={user.paths}
                offerKnown={offerKnown}
                saving={savingPath}
                error={pathError}
                onToggle={togglePath}
                ladders={ladders}
              />
              </div>

              {/* HOW FAR YOU HAVE COME. Both halves wait for their payload:
                  `config` carries the ladder with every rule already overlaid,
                  and `prog` carries where this member stands on it. */}
              {config && prog ? (
                <MaturityLadder
                  /*
                    THE VESSEL SAYS THE ALLOWANCE SENTENCE NOW, SO THE LADDER
                    MUST NOT. `showNext` was added with a default of true and
                    then never passed, which meant the whole next-rung block,
                    the allowance-multiplier line included, printed in both
                    places. A member reading the same sentence twice on one
                    page assumes they are two different facts. The prop existed
                    for exactly this and was not used, which is worse than not
                    having added it.
                  */
                  showNext={false}
                  stages={config.stages}
                  stageIndex={prog.stageIndex}
                  consentedQuests={prog.consentedQuests}
                />
              ) : null}

              {/* WHAT YOU CAN DO RIGHT NOW. */}
              {config && prog ? (
                <PowersMap
                  catalogue={prog.capabilityCatalogue ?? []}
                  stages={config.stages}
                  stageIndex={prog.stageIndex}
                  consentedQuests={prog.consentedQuests}
                  training={prog.training ?? null}
                />
              ) : null}

              {/* About you */}

              {/*
                GRATITUDE HELD.

                This card was `text-white` on a `--tone-sun` gradient. That
                token is DERIVED to carry dark ink, so the pairing measured
                between 1.48:1 and 2.25:1, and `index.css` documents two
                earlier shipments of the same bug. It also had no heading
                element at all, and its 48px number had no accessible name, so
                a screen reader read a bare integer.

                Rebuilt on the semantic pair, with a real heading and a
                labelled figure. The amber survives as the icon only, which
                carries no information and is hidden from the reader.
              */}

              {/* Contributions */}
              <motion.section
                aria-labelledby="contrib-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <h2
                  id="contrib-h"
                  className="mb-6 font-display text-2xl font-bold text-card-foreground"
                >
                  Your Contributions
                </h2>
                {recentContributions.length === 0 ? (
                  /*
                    Name the mechanic, then point at the one door. A row lands
                    here from `POST /api/profile/contribution`, which no client
                    calls, or from an admin accepting a Work With Us proposal.
                    So the card says the second one and links it.
                  */
                  <p className="text-muted-foreground">
                    Nothing here yet. A contribution is recorded when the village accepts an offer
                    you made through{" "}
                    <Link href="/work-with-us" className="font-medium text-foreground underline underline-offset-2">
                      Work With Us
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="space-y-4">
                    <AnimatePresence>
                      {recentContributions.map((contrib, idx) => (
                        <motion.li
                          key={contrib.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-muted p-4"
                        >
                          <CheckCircle2
                            className="mt-1 h-5 w-5 shrink-0 text-foreground"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold break-words text-foreground">
                              {contrib.description}
                            </p>
                            <p className="text-sm text-muted-foreground">{contrib.type}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            {/* The amount was `text-amber` as a foreground,
                                which measures about 1.42:1. `text-amber-ink`
                                exists for exactly this and clears 5.60:1, and
                                it is the right answer on a hardcoded white
                                card. This card is themed, and amber-ink is
                                frozen, so the amount takes the theme's own
                                foreground and the amber stays on the icon. */}
                            <p className="text-lg font-semibold text-foreground">
                              +{contrib.recognitionEarned}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(contrib.date).toLocaleDateString()}
                            </p>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </motion.section>

              {/* Deeds: stage turns, firsts, recognition flows, the ledger */}
              <ProfileJourney />

              {/* Standing, gratitude and this moon, from /api/me/profile */}
              <ProfileSheet />

              {/*
                THE PATH BAND: present, and not yet yours.

                Each path opens its own section, and an UNWALKED path's section
                is quiet rather than absent. Filtering was the first idea and it
                breaks on the case this redesign exists for: a new member has no
                paths, so a filtered sheet shows them nothing on the page they
                land on straight after signing up.

                Marked instead, a day-one member sees the whole map, quiet, and
                every quiet line is an argument for claiming a path. That makes
                the day-one act obvious without a tutorial, and it finally gives
                `user.paths` an observable consequence: claiming one visibly
                grows your sheet.

                It expands IMMEDIATELY and costs no round trip, because
                `updateProfile` writes the new user back into AuthContext, so
                `user.paths` has already changed by the time the await returns.
                The quiet line vanishes on that same render.

                EACH PATH APPEARS ONCE, IN ONE OF TWO STATES. Unwalked, it is
                a single quiet line naming what walking it would open. Walked,
                it is that path's own PARTICULARS: the investor's dated facts,
                a member's ventures, their reservations, their seatings.

                The ladder is a different thing and stays where it is, inside
                PathsPanel up in the "now" band. A ladder says WHERE somebody
                stands on a path; this says WHAT the path holds. Reading the
                second off the first is what was impossible before: `laddersFor`
                narrows every row to the dated fields a rung needs and drops
                the venture's name, so the profile could show that a venture had
                been opened and never which one. Both projections now come off
                the same fetch and the same four queries.
              */}
              {SHEET_SECTIONS.filter(
                (sec) => sec.band === "path" && sec.path && user.paths.includes(sec.path),
              ).map((sec) => (
                <PathFacts
                  key={sec.id}
                  pathId={sec.path ?? ""}
                  title={offeredPaths.find((p) => p.id === sec.path)?.label ?? sec.path ?? ""}
                  particulars={particulars}
                  unavailable={laddersFailed}
                />
              ))}

              {SHEET_SECTIONS.filter(
                (sec) => sec.band === "path" && sec.path && !user.paths.includes(sec.path),
              ).map((sec) => {
                const label = offeredPaths.find((p) => p.id === sec.path)?.label ?? sec.path ?? "";
                return (
                  <QuietSection
                    key={sec.id}
                    title={label}
                    quiet={sec.quiet}
                    action={`Walk the ${label} path`}
                    busy={savingPath === sec.path}
                    onAction={() => sec.path && void togglePath(sec.path)}
                  />
                );
              })}

              {/* The member's own token balances. Target of /profile#wallet from
                  the account menu, and renders nothing when the exchange module
                  is off. The village exchange itself stays on /tokens. */}
              <WalletCard />

              {/* 0092: sending credits to another member. Not module-gated: a
                  village running only the core four still has credits arriving
                  from the cycle pool, and this is where they can go. */}
              <SendTokensCard />

              {/* S47: on-chain holdings, renders nothing until the village
                  turns the economics section on */}
              <OnchainCard />

              {/* S16/S18: notification cadence + data rights */}
              <NotifyPrefsPanel onDeleted={logout} />

              {/* Round 4: your agent, the harness in every profile */}
              <div id="your-agent">
                <YourAgentPanel />
              </div>

              {/* Quick links. These were raw `<a href>` inside a wouter SPA, so
                  each one threw away the running application and reloaded the
                  whole document to reach a page the router already holds. */}
              <motion.nav
                aria-labelledby="links-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <h2 id="links-h" className="mb-4 font-display text-lg font-bold text-card-foreground">
                  Quick Links
                </h2>
                <ul className="space-y-2">
                  {[
                    { href: "/quests", label: "Quests" },
                    { href: "/circles", label: "Circles" },
                    { href: "/housing", label: "Housing" },
                  ].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="flex min-h-11 items-center justify-between rounded-lg p-3 hover:bg-muted"
                      >
                        <span className="text-sm font-medium text-foreground">{l.label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </motion.nav>
            </div>
          </motion.div>
        </div>
        <MoonDock />
      </div>
    </Layout>
  );
}
