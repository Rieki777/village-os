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
import MoonDock from "@/components/profile/MoonDock";
import NightMotes from "@/components/profile/NightMotes";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch, useGameConfig, type ProgressionCapability } from "@/lib/gameApi";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Edit2, LogOut, ArrowRight, CheckCircle2 } from "lucide-react";
import { useTokenName } from "@/hooks/useTokenNames";
import { usePathLadders } from "@/hooks/usePathLadders";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

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
    capabilityCatalogue: ProgressionCapability[];
  } | null>(null);

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
  const ladders = usePathLadders(user?.paths ?? []);

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
  const offerKnown = config !== null;
  const offeredPaths = config?.paths ?? [];
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
                <ProfileHero name={user.name} handle={user.handle} />
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
              <GameDashboard />
            </div>

            <div className="space-y-8">
              {/* WHO YOU ARE HERE. */}
              <PathsPanel
                tiles={pathTiles}
                claimedIds={user.paths}
                offerKnown={offerKnown}
                saving={savingPath}
                error={pathError}
                onToggle={togglePath}
                ladders={ladders}
              />

              {/* HOW FAR YOU HAVE COME. Both halves wait for their payload:
                  `config` carries the ladder with every rule already overlaid,
                  and `prog` carries where this member stands on it. */}
              {config && prog ? (
                <MaturityLadder
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
                />
              ) : null}

              {/* About you */}
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
              <motion.section
                aria-labelledby="gratitude-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-2">
                  <Heart className="h-6 w-6 shrink-0 text-amber" aria-hidden="true" />
                  <h2
                    id="gratitude-h"
                    className="font-display text-2xl font-bold text-card-foreground"
                  >
                    {tokenName} held
                  </h2>
                </div>
                <p className="mt-4 font-display text-5xl font-bold text-foreground">
                  <span className="sr-only">{tokenName} held: </span>
                  {user.recognitionBalance}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Total earned across all contributions. Yours to keep, never spent.
                </p>
              </motion.section>

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
