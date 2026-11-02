import Layout from "@/components/Layout";
import GameDashboard from "@/components/GameDashboard";
import ProfileJourney from "@/components/ProfileJourney";
import NeedCard from "@/components/NeedCard";
import NotifyPrefsPanel from "@/components/NotifyPrefsPanel";
import YourAgentPanel from "@/components/YourAgentPanel";
import ProfileSheet from "@/components/ProfileSheet";
import ProfileHero from "@/components/ProfileHero";
import OnchainCard from "@/components/OnchainCard";
import WalletCard from "@/components/WalletCard";
import SendTokensCard from "@/components/SendTokensCard";
import RedemptionPanel from "@/components/RedemptionPanel";
import CashOwedPanel from "@/components/CashOwedPanel";
import SeasonSummarySection from "@/components/seasonSummary/SeasonSummarySection";
import MaturityLadder from "@/components/profile/MaturityLadder";
import PowersMap from "@/components/profile/PowersMap";
import PathsPanel, { type PathTile } from "@/components/profile/PathsPanel";
import InvitePanel from "@/components/profile/InvitePanel";
import StartHereCard from "@/components/profile/StartHereCard";
import type { MembershipSigning } from "@shared/membershipSigning";
import PathFacts from "@/components/profile/PathFacts";
import InventoryCard from "@/components/profile/InventoryCard";
import QuietSection from "@/components/profile/QuietSection";
import { SHEET_SECTIONS } from "@/components/profile/sheetSections";
import SeasonPlanSection from "@/components/profile/SeasonPlanSection";
import AlignedSection from "@/components/profile/AlignedSection";
import YourRolesSection from "@/components/profile/YourRolesSection";
import PlayerRoleCard from "@/components/playerCard/PlayerRoleCard";
import ProposeBanner from "@/components/roleProposal/ProposeBanner";
import ProposeRolesEntry from "@/components/roleProposal/ProposeRolesEntry";
import SurfacedBanner from "@/components/profile/SurfacedBanner";
import { useSurfaced } from "@/components/profile/useSurfaced";
import TheVessel from "@/components/profile/TheVessel";
import TaskBoard from "@/components/profile/TaskBoard";
import TasksWaitingCard from "@/components/profile/TasksWaitingCard";
import ProfileJournalCard from "@/components/journal/ProfileJournalCard";
import { ProfileGeneKeysCard } from "@/components/geneKeys/ProfileGeneKeys";
import { TASK_BOARD_ANCHOR } from "@shared/sessionTasks";
import MoonDock from "@/components/profile/MoonDock";
import NightMotes from "@/components/profile/NightMotes";
import { useAuth } from "@/contexts/AuthContext";
import { useModule, useModuleOn } from "@/modules/ModuleProvider";
import { authToken, fetchGameMe, gameFetch, useGameConfig, type GameMe, type ProgressionCapability } from "@/lib/gameApi";
import { m, AnimatePresence } from "framer-motion";
import { Heart, Edit2, LogOut, ArrowRight, CheckCircle2, UserPlus } from "lucide-react";
import { useTokenName } from "@/hooks/useTokenNames";
import { usePathLadders } from "@/hooks/usePathLadders";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { onProfileRefresh } from "@/lib/profileRefresh";
import { useStoryPageShown } from "@/lib/brochure";
import { roleWithHolders } from "@shared/roleHolderLabel";
import type { StageAdvance } from "@/components/StageAdvanced";
import StatRow from "@/components/profileDash/StatRow";
import StagePanel from "@/components/profileDash/StagePanel";
import TodayStrip from "@/components/profileDash/TodayStrip";
import AsksPanel from "@/components/asks/AsksPanel";
import YourCompanions from "@/components/profileDash/YourCompanions";
import TreasuryPanel from "@/components/profileDash/TreasuryPanel";
import LevelUpMoment from "@/components/profileDash/LevelUpMoment";
import ProfileTabs, { phoneTab, type ProfileTab } from "@/components/profileDash/ProfileTabs";
import { useDashData } from "@/components/profileDash/useDashData";
import PartiesCard from "@/components/profileDash/PartiesCard";
import { abilitiesAtStage, nextRungProgress, pickTokens, stagePill } from "@/components/profileDash/dashModel";
import { BTN_GOLD, BTN_LINE, H2, KICKER, LINK } from "@/components/profileDash/dashUi";

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
 * ── THE GAME DASHBOARD (Rye approved the design on 2026-10-30) ──────────────
 *
 * The page now reads top to bottom as the approved character sheet: the hero,
 * the stat row, Stage reached, Today, the treasury, then two columns (the
 * quest log on the left, roles and powers on the right) and the settings
 * band. The sections under components/profileDash/ are new; everything below
 * them is the section it always was, moved and not rewritten. On a phone the
 * same sections split across five tabs (profileDash/ProfileTabs.tsx).
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
  const storyShown = useStoryPageShown();
  const [, navigate] = useLocation();
  const tokenName = useTokenName("Recognition");
  const { user, logout, loading, updateProfile } = useAuth();
  const redemptionModule = useModule("redemption");
  const sessionsOn = useModuleOn("sessions");
  const governanceOn = useModuleOn("governance");
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState(user?.bio || "");
  const [savingBio, setSavingBio] = useState(false);
  const [bioError, setBioError] = useState("");
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [pathError, setPathError] = useState("");
  const config = useGameConfig();
  /** The phone's tab (profileDash/ProfileTabs.tsx). A desktop shows every section whatever this holds. */
  const [tab, setTab] = useState<ProfileTab>("today");
  /** A crossing GameDashboard claimed, played as the full-screen moment. */
  const [advance, setAdvance] = useState<StageAdvance | null>(null);
  /** Every read the dashboard takes, once for the page. */
  const dash = useDashData(user?.id ?? null);

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
    /** This member's signed letter and the village's answer (shared/membershipSigning.ts). */
    signing?: MembershipSigning | null;
    /** The roles this member holds (`rolesFor`), named "Role (FirstName)" in the hero. */
    roles?: Array<{ id: string; name: string }>;
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
    // Signed out there is no progression to read and the route answers 401,
    // which every browser logs as a failure on the page itself. `authToken`
    // reads a blocked store as no session, so it cannot throw here.
    if (!authToken()) return;
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
          : e?.message || "That didn't save. Try again.",
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
      setBioError(e?.message || "That didn't save. Try again.");
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
          <m.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity }}>
            <Heart className="h-12 w-12 text-teal-deep" />
          </m.div>
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
      // A path whose page is switched off keeps its tile and loses the link.
      route: storyShown(p.route) ? p.route : "",
      offered: true,
    })),
    ...user.paths
      .filter((id) => !offeredPaths.some((p) => p.id === id))
      .map((id) => ({ id, label: id, role: "", route: "", offered: false })),
  ];

  const stages = config?.stages ?? null;
  const stageIndex = prog?.stageIndex ?? null;
  const nextRung = stages && stageIndex !== null ? (stages[stageIndex + 1] ?? null) : null;
  const progress = nextRungProgress(nextRung, { consentedQuests: prog?.consentedQuests ?? null, training: prog?.training ?? null });
  const rolesLine = (prog?.roles ?? []).map((r) => roleWithHolders(r.name, [user.name])).join(", ");
  const { village: villageToken } = pickTokens(dash.wallet ?? [], config?.currency?.value?.slug);
  const seasonWords = dash.season
    ? [dash.season.name, dash.season.day !== null && dash.season.of !== null ? `day ${Math.min(dash.season.day, dash.season.of)} of ${dash.season.of}` : ""].filter(Boolean).join(" · ")
    : null;
  const claimedQuests = (me?.quests ?? []).filter((q) => q.status === "claimed" || q.status === "submitted");
  const tabOf = (mine: ProfileTab | readonly ProfileTab[]) => phoneTab(tab, mine);

  return (
    <Layout>
      {/*
        `sheet-night` is the whole theme change. It redeclares the semantic
        colour tokens and the display face on THIS element, so every descendant
        that already reads `bg-card`, `text-muted-foreground`, `border-border`
        and the rest resolves them against the night world instead of the app's
        light or dark one. The dashboard's own `dash-*` tokens live beside them
        in client/src/index.css.

        NightMotes is `absolute inset-0` and needs this element to be what it
        measures. MoonDock is `fixed` and placed last for source order: a
        keyboard reaches the member's own page before it reaches an ornament.
      */}
      <div className="relative sheet-night min-h-screen bg-background pb-20 pt-4 sm:py-10">
        <NightMotes />
        <div className="relative mx-auto max-w-[1300px] px-4 sm:px-10">
          <ProfileTabs tab={tab} onTab={setTab} />
          <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 sm:gap-8">
            {/* WHO YOU ARE PLAYING, FIRST. The ladder position comes from the
                page's own reads (`prog.stageIndex`, `config.stages`), never a
                second fetch inside the hero. */}
            <div className={tabOf("today")}>
              <ProfileHero
                name={user.name}
                handle={user.handle}
                stageIndex={stageIndex}
                stageCount={stages?.length ?? null}
                stageLabel={stagePill(stages, stageIndex)}
                season={seasonWords}
                rolesLine={rolesLine || null}
                badges={dash.badgeList}
                maxFeatured={dash.maxFeatured}
                actions={
                  <div className="hidden items-center gap-3 sm:flex">
                    <a href="#invite" className={BTN_GOLD}>
                      <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
                      Invite a friend
                    </a>
                    <button type="button" onClick={() => logout()} className={BTN_LINE}>
                      Sign out
                    </button>
                  </div>
                }
                about={
                  <div className="hidden flex-col gap-2.5 sm:flex">
                    <p className="m-0 max-w-[620px] text-[15px] text-foreground/85">
                      {user.bio ? `"${user.bio}" ` : "No about line yet. "}
                      <a href="#about" className={`${LINK} text-sm`}>
                        {user.bio ? "Edit about me and links" : "Write one"}
                      </a>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Paths</span>
                      {user.paths.map((id, i) => (
                        <span
                          key={id}
                          className={`rounded-full border px-3 py-1 text-[13px] ${i === 0 ? "border-dash-gold bg-dash-gold text-dash-gold-ink" : "border-border text-foreground"}`}
                        >
                          {offeredPaths.find((p) => p.id === id)?.label ?? id}
                        </span>
                      ))}
                      <a href="#sheet-paths" className={`${LINK} text-[13px]`}>
                        {user.paths.length ? "Walk another path" : "Choose a path"}
                      </a>
                    </div>
                  </div>
                }
                footer={
                  nextRung ? (
                    <div className="mt-1 flex w-full max-w-[640px] flex-col gap-2 sm:mt-3.5">
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="font-semibold text-dash-gold-lit">Next: {nextRung.name}</span>
                        {progress ? (
                          <span className="text-muted-foreground">
                            {progress.done} of {progress.total} steps
                            <span className="hidden sm:inline"> · {progress.total - progress.done} left</span>
                          </span>
                        ) : null}
                      </div>
                      {progress ? (
                        <div
                          role="progressbar"
                          aria-label={`Toward ${nextRung.name}`}
                          aria-valuemin={0}
                          aria-valuemax={progress?.total ?? 1}
                          aria-valuenow={progress?.done ?? 0}
                          className="h-2.5 overflow-hidden rounded-md border border-dash-edge bg-dash-track sm:h-3.5"
                        >
                          <div
                            className="h-full bg-[linear-gradient(90deg,var(--color-dash-gold),var(--color-dash-gold-lit))] shadow-[0_0_14px_color-mix(in_srgb,var(--color-dash-gold-lit)_60%,transparent)]"
                            style={{ width: `${progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0}%` }}
                          />
                        </div>
                      ) : (
                        /* A rung that is one act (a grant, being paid, signing)
                           has no fraction to draw, so it says what opens it. */
                        <p className="m-0 text-[13px] text-muted-foreground">{nextRung.description}</p>
                      )}
                      <a href="#invite" className={`${BTN_GOLD} mt-1.5 w-full sm:hidden`}>
                        Invite a friend
                      </a>
                    </div>
                  ) : null
                }
              />
            </div>

            <div className={tabOf("today")}>
              <StatRow
                stats={[
                  { key: "paths", glyph: "◎", value: user.paths.length, label: "Paths walked", short: "Paths", phone: true },
                  { key: "quests", glyph: "✦", value: prog?.consentedQuests ?? null, label: "Quests done", short: "Quests", phone: true },
                  { key: "badges", glyph: "❖", value: dash.badges, label: "Badges", short: "Badges", phone: true },
                  {
                    key: "tokens",
                    glyph: "◐",
                    value: villageToken ? villageToken.heldUnits / Math.pow(10, Math.max(0, villageToken.decimals)) : null,
                    label: "Tokens",
                    short: "Tokens",
                    phone: true,
                  },
                  { key: "powers", glyph: "☾", value: prog ? prog.capabilityCatalogue.filter((c) => c.held).length : null, label: "Powers open", short: "Powers", phone: false },
                ]}
              />
            </div>

            {stages && prog ? (
              <div className={tabOf("today")}>
                <StagePanel
                  stages={stages}
                  stageIndex={prog.stageIndex}
                  abilities={abilitiesAtStage(prog.capabilityCatalogue ?? [], stages[prog.stageIndex]?.id ?? "")}
                  nextAction={me?.nextAction ?? null}
                  progress={progress}
                  progressUnit={nextRung?.rule.type === "training-complete" ? "lessons" : "quests consented"}
                  nextRuleWords={nextRung?.description ?? null}
                />
              </div>
            ) : null}

            <div className={tabOf("today")}>
              <TodayStrip data={dash} />
            </div>

            {/* ASKED OF YOU: what other members asked this member, and what they asked (shared/memberAsks.ts). */}
            <div id="waiting" className={`scroll-mt-28 ${tabOf("today")}`}>
              <AsksPanel />
            </div>

            {/* YOUR COMPANIONS, beside the tasks on a desktop and on the Quests tab on a phone. */}
            <div className={tabOf("quests")}>
              <YourCompanions />
            </div>

            <div className={tabOf("treasury")}>
              <TreasuryPanel
                data={dash}
                claimedQuests={claimedQuests}
                particulars={particulars ?? null}
                redeemOn={!!redemptionModule}
                seasonName={dash.season?.name ?? null}
              />
            </div>

            {/* THE TWO COLUMNS: what is on your plate, and your character. */}
            <div className="flex flex-wrap items-start gap-6 sm:gap-8">
              <div className="flex min-w-0 flex-[999_1_660px] flex-col gap-6 sm:gap-8">
                <p aria-live="polite" className="sr-only">
                  {surfacedSection && surfacedLabel ? `${surfacedLabel} is newly open to you.` : ""}
                </p>
                {surfacedSection && surfacedLabel ? (
                  <div className={tabOf("today")}>
                    <SurfacedBanner
                      title={surfacedLabel}
                      because={surfacedSection.quiet.replace(/, once you walk.*$/, ".")}
                      onGo={() => {
                        surfaced.acknowledge(surfacedSection.id);
                        setTab("sheet");
                        (document.getElementById(`sheet-${surfacedSection.id}`) ??
                          document.getElementById("sheet-paths"))?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  </div>
                ) : null}

                {/* START HERE: the one next step from joining to proposing, owner only.
                    It heads the quest log: the stage panel above carries the
                    server's next step, and the design has nothing between it and Today.
                    `undefined` signing means the progression read has not landed. */}
                <div className={tabOf("quests")}>
                  <StartHereCard ownerId={user.id} me={me} signing={prog ? (prog.signing ?? null) : undefined} config={config} catalogue={prog?.capabilityCatalogue} />
                </div>
                {/* The quest log: every task taken on in a live session, what
                    this member's roles hold, and what waits on a power they
                    hold. Emails and notices land on #my-tasks. */}
                <div className={tabOf(["today", "quests"])}>
                  <TasksWaitingCard enabled={sessionsOn} />
                </div>
                {(sessionsOn || governanceOn) && (
                  <div id={TASK_BOARD_ANCHOR} className={`scroll-mt-28 ${tabOf("quests")}`}>
                    <TaskBoard sessions={sessionsOn} />
                  </div>
                )}
                <div className={tabOf("quests")}>
                  <GameDashboard me={me} meFailed={meFailed} showNextStep={false} onAdvance={setAdvance} />
                </div>
                {/* Deeds: stage turns, firsts, recognition flows, the ledger. */}
                <div id="ledger" className={`scroll-mt-28 ${tabOf("treasury")}`}>
                  <ProfileJourney />
                </div>
                <div className={tabOf("sheet")}>
                  <AlignedSection />
                </div>
              </div>

              <aside aria-label="Your character" className="flex min-w-0 flex-[1_1_360px] flex-col gap-6 sm:gap-8">
                <div className={`empty:hidden ${tabOf("quests")}`}>
                  <PartiesCard data={dash} />
                </div>
                <div id="roles" className={`scroll-mt-28 flex flex-col gap-6 ${tabOf("roles")}`}>
                  <YourRolesSection />
                  <ProposeBanner />
                  <ProposeRolesEntry />
                  <PlayerRoleCard />
                  <SeasonPlanSection />
                </div>
                {config && prog ? (
                  <div className={tabOf("roles")}>
                    <PowersMap
                      catalogue={prog.capabilityCatalogue ?? []}
                      stages={config.stages}
                      stageIndex={prog.stageIndex}
                      consentedQuests={prog.consentedQuests}
                      training={prog.training ?? null}
                    />
                  </div>
                ) : null}
                <div id="my-needs" className={tabOf("sheet")}>
                  <NeedCard />
                </div>
                <div className={`scroll-mt-28 ${tabOf("sheet")}`}>
                  <ProfileJournalCard />
                </div>
                <div className={`scroll-mt-28 ${tabOf("sheet")}`}>
                  <ProfileGeneKeysCard owner={user?.id ? String(user.id) : null} />
                </div>
              </aside>
            </div>

            {/* THE SHEET: about you, your paths and the settings, as the design's
                last band. Each one is the section it always was. */}
            <div className={`flex flex-col gap-6 sm:gap-8 ${tabOf("sheet")}`}>
              <div>
                <p className={KICKER}>Settings</p>
                <h2 className={H2}>How your sheet works for you</h2>
              </div>
              {/* ABOUT YOU IS A DAY-ONE ACT. The bio Save is the whole point:
                  the editor used to discard every word on close, silently. */}
              <m.section
                id="about"
                aria-labelledby="bio-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="scroll-mt-28 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <h2 id="bio-h" className="font-display text-2xl font-bold text-card-foreground">
                    About you
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
                      {/* `border border-border`: the fill is the village's own
                          colour, dark by construction, so the button takes an
                          edge to clear 3:1 on the night panel. */}
                      <button
                        onClick={saveBio}
                        disabled={savingBio}
                        className="min-h-11 rounded-lg border border-border bg-teal-deep px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {savingBio ? "Saving…" : "Save"}
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
                    <p aria-live="polite" role="status" className="sr-only">
                      {savingBio ? "Saving your bio." : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-lg leading-relaxed text-muted-foreground">
                    {user.bio || "No bio yet. Add one to help other villagers know you."}
                  </p>
                )}
              </m.section>

              {/* The anchor the surfaced banner and "Walk another path" point at. */}
              <div id="sheet-paths" className="scroll-mt-28">
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

              {config && prog ? (
                <MaturityLadder showNext={false} stages={config.stages} stageIndex={prog.stageIndex} consentedQuests={prog.consentedQuests} />
              ) : null}

              {/* BORROWED AND BOOKED: loans, stays and homes asked about, live only.
                  Homes are listed once: on the Resident path card when walked. */}
              <InventoryCard lotsOnPath={user.paths.includes("resident")} />

              {/* THE PATH BAND: a walked path's particulars, an unwalked one's quiet line. */}
              {SHEET_SECTIONS.filter((sec) => sec.band === "path" && sec.path && user.paths.includes(sec.path)).map((sec) => (
                <PathFacts
                  key={sec.id}
                  pathId={sec.path ?? ""}
                  title={offeredPaths.find((p) => p.id === sec.path)?.label ?? sec.path ?? ""}
                  particulars={particulars}
                  unavailable={laddersFailed}
                />
              ))}
              {SHEET_SECTIONS.filter((sec) => sec.band === "path" && sec.path && !user.paths.includes(sec.path)).map((sec) => {
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

              {/* Contributions */}
              <m.section
                aria-labelledby="contrib-h"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <h2 id="contrib-h" className="mb-6 font-display text-2xl font-bold text-card-foreground">
                  Your contributions
                </h2>
                {recentContributions.length === 0 ? (
                  /* R47: say what is missing, then point at the one door. */
                  storyShown("/work-with-us") ? (
                    <p className="text-muted-foreground">
                      No contributions yet. Propose one through{" "}
                      <Link href="/work-with-us" className="font-medium text-foreground underline underline-offset-2">
                        Work With Us
                      </Link>
                      .
                    </p>
                  ) : (
                    <p className="text-muted-foreground">No contributions yet.</p>
                  )
                ) : (
                  <ul className="space-y-4">
                    <AnimatePresence>
                      {recentContributions.map((contrib, idx) => (
                        <m.li
                          key={contrib.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-muted p-4"
                        >
                          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold break-words text-foreground">{contrib.description}</p>
                            <p className="text-sm text-muted-foreground">{contrib.type}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-lg font-semibold text-foreground">
                              {contrib.paid?.length
                                ? contrib.paid.map((p) => `+${p.amount} ${p.name}`).join(", ")
                                : contrib.recognitionEarned > 0
                                  ? `+${contrib.recognitionEarned}`
                                  : null}
                            </p>
                            <p className="text-xs text-muted-foreground">{new Date(contrib.date).toLocaleDateString()}</p>
                          </div>
                        </m.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </m.section>

              {/* Standing, gratitude and this moon, from /api/me/profile. */}
              <ProfileSheet />

              {/* INVITE SOMEBODY. The hero's "Invite a friend" lands here. */}
              <div id="invite" className="scroll-mt-28">
                <InvitePanel />
              </div>

              {/* S16/S18: notification cadence + data rights */}
              <NotifyPrefsPanel onDeleted={logout} />

              {/* Round 4: your agent, the harness in every profile */}
              <div id="your-agent">
                <YourAgentPanel />
              </div>

              <button type="button" onClick={() => logout()} className={`${BTN_LINE} self-start sm:hidden`}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </div>

            {/*
              THE PURSES' OWN DOORS, on the Treasury tab. Each card is the one it
              always was; the treasury above summarises them and links down.

              The vessel is giving, beside the allowance it spends. WalletCard is
              /profile#wallet from the account menu. SendTokensCard is deliberately
              ungated, which is what proves the redemption panel below it still
              renders with the exchange off: `/wallet` sits behind the exchange
              module, so this is redemption's only member-facing door.
            */}
            <div className={`flex flex-col gap-6 sm:gap-8 ${tabOf("treasury")}`}>
              <TheVessel
                gratitude={me?.gratitude ?? null}
                here={me?.stage ?? null}
                next={me && me.stages ? (me.stages[me.stageIndex + 1] ?? null) : null}
                failed={meFailed}
                onGiven={reloadMe}
              />
              <WalletCard />
              <div id="send-tokens" className="scroll-mt-28">
                <SendTokensCard />
              </div>
              {user && redemptionModule && (
                <div id="redeem" className="scroll-mt-28">
                  <RedemptionPanel />
                </div>
              )}
              {user && <CashOwedPanel /> /* 0285: cash owed, and the books for whoever holds cash.pay */}
              {user && <SeasonSummarySection /> /* idea 4: your season summed up, shareable as a picture */}
              {/* S47: on-chain holdings, renders nothing until the village turns the economics section on */}
              <OnchainCard />
            </div>

            {/* Quick links, inside the SPA router. */}
            <m.nav
              aria-labelledby="links-h"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 ${tabOf("sheet")}`}
            >
              <h2 id="links-h" className="mb-4 font-display text-lg font-bold text-card-foreground">
                Quick links
              </h2>
              <ul className="space-y-2">
                {[
                  { href: "/quests", label: "Quests" },
                  { href: "/circles", label: "Circles" },
                  { href: "/housing", label: "Housing" },
                ]
                  .filter((l) => storyShown(l.href))
                  .map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="flex min-h-11 items-center justify-between rounded-lg p-3 hover:bg-muted">
                        <span className="text-sm font-medium text-foreground">{l.label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </m.nav>
          </m.div>
        </div>
        <MoonDock />
      </div>
      {advance && stages ? (
        <LevelUpMoment
          advance={advance}
          stages={stages}
          name={user.name}
          portrait={null}
          onClose={() => setAdvance(null)}
        />
      ) : null}
    </Layout>
  );
}
