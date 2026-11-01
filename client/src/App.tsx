import { documentTitle } from "@shared/pageTitles";
import { Toaster } from "@/components/ui/sonner";
import BreakGlass from "@/components/BreakGlass";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { MotionConfig } from "framer-motion";
import { lazy, Suspense, useEffect, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import ScrollToTop from "./components/ScrollToTop";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ModuleProvider } from "./modules/ModuleProvider";
import { chooseLanding, getPreference, recordVisit, wasMapAvailable } from "./lib/landing";
import { brochurePage, useBrochurePages } from "./lib/brochure";

/**
 * "/" means the welcome page, for everyone, every time. The map was going to
 * take over on the third visit and that promotion is TURNED OFF
 * (AUTO_LANDING_ENABLED in client/src/lib/landing.ts, which has the rules),
 * and no surface writes a landing preference while it is off, so nothing
 * reaches the redirect below today. The machinery stays because the map
 * becoming home is still where this is going.
 *
 * When it comes back: the redirect happens here, synchronously, before Home
 * renders — deciding after the module catalogue loads would flash the welcome
 * page and then yank it away. The price of deciding early is that map
 * availability is one visit stale (cached by the map page itself); the safe
 * direction is built in, because a stale "not available" just means the
 * welcome page.
 *
 * `useState` initialiser, not `useEffect`: the visit must be counted exactly
 * once per page load, before first paint, and effects run twice in dev
 * StrictMode.
 */
function useLanding(): "home" | "map" {
  const [landing] = useState(() => {
    const visits = recordVisit();
    return chooseLanding({ visits, preference: getPreference(), mapAvailable: wasMapAvailable() });
  });
  return landing;
}

/**
 * The brochure home belongs to the brochure pages (shared/brochure.ts): a
 * village that serves them gets it, and every other village gets the neutral
 * welcome page. Nothing renders until the switch is known, so neither one
 * flashes on the other's village.
 */
function LandingRoute() {
  const landing = useLanding();
  const brochure = useBrochurePages();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (landing === "map") navigate("/map", { replace: true });
  }, [landing, navigate]);
  if (landing !== "home" || brochure === null) return null;
  return brochure ? <Home /> : <VillageWelcome />;
}


/**
 * The old spelling of /role-applications/:id (Rye, 2026-10-21: members say role,
 * never seat). Emails and notices already sent carry it, so it stays mounted and
 * moves the visitor to the new address, keeping the query and the hash.
 */
function SeatApplicationsAlias() {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const to = location.replace(/^\/seat-applications\//, "/role-applications/");
    setLocation(to + window.location.search + window.location.hash, { replace: true });
  }, [location, setLocation]);
  return null;
}

function PageTitle() {
  const [location] = useLocation();
  const [village, setVillage] = useState<string>("");
  const [commitment, setCommitment] = useState<string>("");

  useEffect(() => {
    let alive = true;
    fetch("/api/game/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setVillage(d?.project?.name ?? "");
        setCommitment(d?.project?.commitmentName ?? "");
        // The tab ICON is identity too. index.html ships a neutral platform
        // favicon (a static file cannot know which village it serves); this
        // swaps in the village's own the moment config arrives, same
        // pattern as the title below.
        const favicon = String(d?.images?.favicon ?? "").trim();
        if (favicon) {
          for (const rel of ["icon", "apple-touch-icon"]) {
            let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
            if (!link) {
              link = document.createElement("link");
              link.rel = rel;
              document.head.appendChild(link);
            }
            link.href = favicon;
          }
        }
      })
      .catch(() => { /* keep whatever index.html shipped */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!village) return;
    document.title = documentTitle(location, village, { commitment });
  }, [location, village, commitment]);

  return null;
}
/**
 * ROUTE SPLITTING — the rule for anyone adding a page.
 *
 * The main bundle sat at 1382 KB against CI's 1400 KB ceiling: 18 KB of
 * headroom for a platform about to add a design system, an identity intake
 * and an art review queue. The CI gate says the right thing already — "split
 * a route rather than raising the budget" — so every page below the eager set
 * is `lazy()`.
 *
 * EAGER = what an arriving human sees before they choose anything: the home
 * page, the sign-in page a deep link bounces them to, and the 404. Everything
 * else is a chunk fetched on navigation and cached from then on.
 *
 * That trade is strictly good on the ~50 KB/s links this platform is built
 * for: today a visitor downloads all 26,000 lines of every page — including
 * Admin's 6,980 and Project History's 2,870, which most members never open —
 * before anything renders. After this they download the shell plus the one
 * page they asked for.
 *
 * New page? Add it to the lazy list. Only add to the eager set if it renders
 * on first paint for a signed-out visitor.
 */
import Home from "./pages/Home";
import Login from "./pages/Login";

const lazyPage = (loader: () => Promise<{ default: React.ComponentType<any> }>) => lazy(loader);
const VillageWelcome = lazyPage(() => import("./pages/VillageWelcome"));

const InvestorJourney = brochurePage(() => import("./pages/InvestorJourney"));
const StewardJourney = brochurePage(() => import("./pages/StewardJourney"));
const ResidentJourney = brochurePage(() => import("./pages/ResidentJourney"));
const ProsperityJourney = brochurePage(() => import("./pages/ProsperityJourney"));
const LoveLetter = brochurePage(() => import("./pages/LoveLetter"));
const Circles = lazyPage(() => import("./pages/Circles"));
const CircleCardPage = lazyPage(() => import("./pages/CircleCardPage"));
const Places = lazyPage(() => import("./pages/Places"));
const PlacePhotos = lazyPage(() => import("./pages/PlacePhotos"));
const Photographs = lazyPage(() => import("./pages/Photographs"));
const Quests = lazyPage(() => import("./pages/Quests"));
const QuestDetail = lazyPage(() => import("./pages/QuestDetail"));
const ProposeQuest = lazyPage(() => import("./pages/ProposeQuest"));
const Roles = lazyPage(() => import("./pages/Roles"));
const HowWeCreate = brochurePage(() => import("./pages/HowWeCreate"));
const CoCreatorsGuide = brochurePage(() => import("./pages/CoCreatorsGuide"));
const Housing = brochurePage(() => import("./pages/Housing"));
const ReserveHome = lazyPage(() => import("./pages/ReserveHome"));
const Opportunities = brochurePage(() => import("./pages/Opportunities"));
const MasterPlan = brochurePage(() => import("./pages/MasterPlan"));
const Team = brochurePage(() => import("./pages/Team"));
const Admin = lazyPage(() => import("./pages/Admin"));
const Profile = lazyPage(() => import("./pages/Profile"));
const Characters = lazyPage(() => import("./pages/Characters"));
const GeneKeys = lazyPage(() => import("./pages/GeneKeys"));
const Mint = lazyPage(() => import("./pages/Mint"));
const PublicProfile = lazyPage(() => import("./pages/PublicProfile"));
const Register = lazyPage(() => import("./pages/Register"));
const SetPassword = lazyPage(() => import("./pages/SetPassword"));
// Three pages an email links to, from ONE module: the bundler keeps one chunk.
const EmailPreferences = lazyPage(() => import("./pages/EmailPages").then((m) => ({ default: m.EmailPreferences })));
const EmailUnsubscribe = lazyPage(() => import("./pages/EmailPages").then((m) => ({ default: m.EmailUnsubscribe })));
const EmailAction = lazyPage(() => import("./pages/EmailPages").then((m) => ({ default: m.EmailAction })));
const ForgotPassword = lazyPage(() => import("./pages/ForgotPassword"));
const GameMechanics = lazyPage(() => import("./pages/GameMechanics"));
const VillageEmail = lazyPage(() => import("./pages/VillageEmail"));
const GoodNeighbor = brochurePage(() => import("./pages/GoodNeighbor"));
const JourneyToLaunch = lazyPage(() => import("./pages/JourneyToLaunch"));
const SetupGame = lazyPage(() => import("./pages/SetupGame"));
const ProjectHistory = brochurePage(() => import("./pages/ProjectHistory"));
const Bootstrap = lazyPage(() => import("./pages/Bootstrap"));
const Feedback = lazyPage(() => import("./pages/Feedback"));
const Network = lazyPage(() => import("./pages/Network"));
const Contribute = lazyPage(() => import("./pages/Contribute"));
const SeasonalFestivals = lazyPage(() => import("./pages/SeasonalFestivals"));
const StewardRights = brochurePage(() => import("./pages/StewardRights"));
const ResidentRights = brochurePage(() => import("./pages/ResidentRights"));
const Training = lazyPage(() => import("./pages/Training"));
const Governance = lazyPage(() => import("./pages/Governance"));
const Decisions = lazyPage(() => import("./pages/Decisions"));
const Decision = lazyPage(() => import("./pages/Decision"));
const Propose = lazyPage(() => import("./pages/Propose"));
const SeatApplication = lazyPage(() => import("./pages/SeatApplication"));
// One chunk for the three role proposal routes (role proposals PR C).
const RoleProposal = lazyPage(() => import("./pages/RoleProposal"));
const NewRoleProposal = lazyPage(() => import("./pages/RoleProposal").then((m) => ({ default: m.NewRoleProposal })));
const SharedRoleProposal = lazyPage(() => import("./pages/RoleProposal").then((m) => ({ default: m.SharedRoleProposal })));
const SeasonPlans = lazyPage(() => import("./pages/SeasonPlans"));
const Aligned = lazyPage(() => import("./pages/Aligned"));
const MySeason = lazyPage(() => import("./pages/MySeason"));
const Visit = brochurePage(() => import("./pages/Visit"));
const GratitudeWall = lazyPage(() => import("./pages/GratitudeWall"));
const WorkWithUs = brochurePage(() => import("./pages/WorkWithUs"));
const ToolsHub = lazyPage(() => import("./pages/ToolsHub"));
const VillageMap = lazyPage(() => import("./pages/VillageMap"));
const LivingMap = lazyPage(() => import("./pages/LivingMap"));
const Events = lazyPage(() => import("./pages/Events"));
const FirstWalk = lazyPage(() => import("./pages/FirstWalk"));
const Forum = lazyPage(() => import("./pages/Forum"));
const Messages = lazyPage(() => import("./pages/Messages"));
const Introductions = lazyPage(() => import("./pages/Introductions"));
const RequestMembership = lazyPage(() => import("./pages/RequestMembership"));
const ProposeARole = lazyPage(() => import("./pages/ProposeARole"));
const ConfirmProposal = lazyPage(() => import("./pages/ProposeARole").then((m) => ({ default: m.ConfirmProposal })));
const Feed = lazyPage(() => import("./pages/Feed"));
const Stay = lazyPage(() => import("./pages/Stay"));
const Wallet = lazyPage(() => import("./pages/Wallet"));
const Badges = lazyPage(() => import("./pages/Badges"));
const Powers = lazyPage(() => import("./pages/Powers"));
const Review = lazyPage(() => import("./pages/Review"));
const CashPayouts = lazyPage(() => import("./pages/CashPayouts"));
const StructureReview = lazyPage(() => import("./pages/StructureReview"));
const Library = lazyPage(() => import("./pages/Library"));
const VillageHealth = lazyPage(() => import("./pages/VillageHealth"));
const ExitPolicy = lazyPage(() => import("./pages/ExitPolicy"));
const Modules = lazyPage(() => import("./pages/Modules"));
const ModuleDetail = lazyPage(() => import("./pages/ModuleDetail"));
const Crowdpool = lazyPage(() => import("./pages/Crowdpool"));
const CrowdpoolCampaign = lazyPage(() => import("./pages/CrowdpoolCampaign"));
const Journal = lazyPage(() => import("./pages/Journal"));
const Sessions = lazyPage(() => import("./pages/Sessions"));
const SessionRoom = lazyPage(() => import("./pages/SessionRoom"));
const SessionSeason = lazyPage(() => import("./pages/SessionSeason"));

/**
 * Shown while a page chunk arrives. Deliberately quiet: on a slow link this
 * appears for a second or two, and a spinner that shouts is worse than one
 * that waits. `min-h` holds the viewport so the footer does not jump up and
 * back down as the chunk lands.
 */
function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground/60"
      />
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <>
    <ScrollToTop />
      <PageTitle />
    <ErrorBoundary key={location}>
    <Suspense fallback={<PageLoading />}>
    <Switch>
      <Route path="/" component={LandingRoute} />
      <Route path="/journey-to-launch" component={JourneyToLaunch} />
      <Route path="/setup-game" component={SetupGame} />
      <Route path="/project-history" component={ProjectHistory} />
      <Route path="/claim" component={Bootstrap} />
      <Route path="/feedback" component={Feedback} />
      <Route path="/network" component={Network} />
      <Route path="/contribute" component={Contribute} />
      <Route path="/seasonal-festivals" component={SeasonalFestivals} />
      <Route path="/investor" component={InvestorJourney} />
      <Route path="/steward" component={StewardJourney} />
      <Route path="/resident" component={ResidentJourney} />
      <Route path="/prosperity" component={ProsperityJourney} />
      <Route path="/love-letter" component={LoveLetter} />
      <Route path="/circles" component={Circles} />
      {/* One circle's card, its home page (server/routes/circleCard.ts). */}
      <Route path="/circles/:id" component={CircleCardPage} />
      <Route path="/quests" component={Quests} />
      <Route path="/quests/:id" component={QuestDetail} />
      <Route path="/tools" component={ToolsHub} />
      {/* The Module Library: public, read-only, the whole platform on five
          shelves. The Material Library keeps /library; the two never trade
          names. */}
      <Route path="/modules" component={Modules} />
      <Route path="/modules/:id" component={ModuleDetail} />
      {/* The crowdpool bridge: the list of raisings, then one campaign told
          in the map's language. Both behind ModuleGate("crowdpool"). */}
      <Route path="/campaigns" component={Crowdpool} />
      <Route path="/campaign/:slug" component={CrowdpoolCampaign} />
      {/* The geographic map is what /map means now. The nested-circles org
          view keeps its own address: it holds the concierge, the contact
          relay and raise-your-hand, which read live data behind the
          capability gate and have no equivalent in the artifact. */}
      <Route path="/map" component={LivingMap} />
      {/* The photographs of the land, beside the map rather than inside it.
          The list route is declared before the detail route for the reason
          /decisions gives: wouter takes the first match, and a :key above the
          shelf would swallow it. */}
      <Route path="/places" component={Places} />
      <Route path="/places/:key" component={PlacePhotos} />
      {/* Every photograph in the village on one page, so a person who wants a
          picture of themselves down can find it without knowing which place
          it was filed under. Top level and not under /places for the reason
          PAGE_TITLES gives. */}
      <Route path="/photographs" component={Photographs} />
      <Route path="/map/circles" component={VillageMap} />
      <Route path="/events" component={Events} />
      <Route path="/first-walk" component={FirstWalk} />
      <Route path="/feed" component={Feed} />
      <Route path="/stay" component={Stay} />
      <Route path="/tokens" component={Wallet} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/badges" component={Badges} />
      <Route path="/powers" component={Powers} />
      <Route path="/review/structure/:batchId" component={StructureReview} />
      <Route path="/review" component={Review} />
      {/* The treasurer's payout list, for a finance role holding cash.pay without admin */}
      <Route path="/cash-payouts" component={CashPayouts} />
      <Route path="/library" component={Library} />
      {/* /village-health, not /health: the server owns /health as the ops probe */}
      <Route path="/village-health" component={VillageHealth} />
      <Route path="/exit-policy" component={ExitPolicy} />
      <Route path="/forum" component={Forum} />
      <Route path="/forum/:id" component={Forum} />
      <Route path="/messages" component={Messages} />
      <Route path="/messages/:id" component={Messages} />
      <Route path="/introductions" component={Introductions} />
      <Route path="/propose-quest" component={ProposeQuest} />
      <Route path="/roles" component={Roles} />
      <Route path="/how-we-create" component={HowWeCreate} />
      <Route path="/co-creators-guide" component={CoCreatorsGuide} />
      <Route path="/housing" component={Housing} />
      <Route path="/reserve" component={ReserveHome} />
      <Route path="/opportunities" component={Opportunities} />
      <Route path="/master-plan" component={MasterPlan} />
      <Route path="/team" component={Team} />
      <Route path="/admin" component={Admin} />
      {/* The Mint has its own route rather than a tab inside Admin: that file
          is 5,000 lines and shared, and this surface reads in one screen. */}
      <Route path="/admin/mint" component={Mint} />
      <Route path="/profile" component={Profile} />
      {/* The class select. Under /profile because a party is part of who you
          are here, not a separate account setting. */}
      <Route path="/profile/characters" component={Characters} />
      <Route path="/profile/gene-keys" component={GeneKeys} />
      {/* AFTER /profile/characters, and that order is the whole point: wouter
          takes the first match, so a :handle route above it would turn the
          class select into a lookup for a member called "characters". */}
      <Route path="/profile/:handle" component={PublicProfile} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/request-membership" component={RequestMembership} />
      {/* Confirm before :token, so the email's link is never read as a link made for one person. */}
      <Route path="/propose-a-role/confirm" component={ConfirmProposal} />
      <Route path="/propose-a-role/:token" component={ProposeARole} />
      <Route path="/propose-a-role" component={ProposeARole} />
      <Route path="/set-password" component={SetPassword} />
      <Route path="/email/preferences" component={EmailPreferences} />
      <Route path="/email/unsubscribe" component={EmailUnsubscribe} />
      <Route path="/email/a" component={EmailAction} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/game-mechanics" component={GameMechanics} />
      <Route path="/village-email" component={VillageEmail} />
      <Route path="/good-neighbor" component={GoodNeighbor} />
      <Route path="/steward-rights" component={StewardRights} />
      <Route path="/resident-rights" component={ResidentRights} />
      <Route path="/training" component={Training} />
      <Route path="/governance" component={Governance} />
      {/* The live surfaces sit BESIDE the explainer, never inside it: /governance
          says how the village decides, /decisions shows what it is deciding.
          The list route is declared before the detail route for the same reason
          /profile/characters precedes /profile/:handle — wouter takes the first
          match, and a :id above the list would swallow it. */}
      <Route path="/decisions" component={Decisions} />
      <Route path="/decisions/:id" component={Decision} />
      <Route path="/propose" component={Propose} />
      {/* One application to hold roles, on terms. Members only, behind terms.read. */}
      <Route path="/role-applications/:id" component={SeatApplication} />
      <Route path="/seat-applications/:id" component={SeatApplicationsAlias} />
      {/* Propose my roles for next season. /new and /shared/:token before /:id, which would take them. */}
      <Route path="/role-proposals/new" component={NewRoleProposal} />
      <Route path="/role-proposals/shared/:token" component={SharedRoleProposal} />
      <Route path="/role-proposals/:id" component={RoleProposal} />
      {/* Your season: your own plan, then the village's page of everyone's, by name. */}
      <Route path="/season-plans/mine" component={MySeason} />
      <Route path="/season-plans" component={SeasonPlans} />
      <Route path="/aligned" component={Aligned} />
      <Route path="/visit" component={Visit} />
      <Route path="/gratitude" component={GratitudeWall} />
      {/* A member's own practice, behind ModuleGate("journal") and sign-in. */}
      <Route path="/journal" component={Journal} />
      {/* A circle's live calls: the list, then one room. Both behind
          ModuleGate("sessions") and sign-in; members only, no guests. The
          list is declared before the room for the reason /decisions gives. */}
      <Route path="/sessions" component={Sessions} />
      <Route path="/sessions/season" component={SessionSeason} />
      <Route path="/sessions/:id" component={SessionRoom} />
      <Route path="/work-with-us" component={WorkWithUs} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </ErrorBoundary>
    </>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      {/*
       * "reduce" has to be honoured HERE, not only in CSS. index.css already
       * carries a prefers-reduced-motion block and it was measured doing nothing
       * on 19 routes: it caps animation-duration and transition-duration, and
       * Framer Motion does not use either. It drives inline transform and
       * opacity from JS, frame by frame, so a CSS rule has nothing to bite on.
       *
       * `reducedMotion="user"` makes every motion component in the tree read the
       * OS setting: transform, layout and scroll animations stop, opacity and
       * colour still cross-fade because neither triggers vestibular symptoms.
       * That keeps the reveals from stranding an element at opacity 0, which is
       * the failure mode the CSS block's 1ms transition was written to avoid.
       *
       * The two Level A cases this closes are the loops rather than the reveals:
       * the scroll dot on Home and the rotating tile on the investor journey both
       * run `repeat: Infinity` and never stopped for anyone.
       */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
        <ModuleProvider>
          <TooltipProvider>
            <Toaster />
            {/*
              * The handle on the break-glass. Draws nothing until a route
              * answers 409 with a power this village holds, and then asks
              * before anything is sent a second time.
              */}
            <BreakGlass />
            <Router />
          </TooltipProvider>

        </ModuleProvider>
        </AuthProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}

export default App;
