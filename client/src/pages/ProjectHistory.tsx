import { useAuth } from "@/contexts/AuthContext";
import { useVillageName } from "@/hooks/useVillageName";
import { authToken, useCatalyst } from "@/lib/gameApi";
import { villageMoonLabel } from "@shared/villageMoon";
import { useState, useEffect, FormEvent } from "react";
import Layout from "@/components/Layout";
import { Link } from "wouter";
import {
  CheckSquare,
  XSquare,
  Square,
  ExternalLink,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  FileText,
  Calendar,
  TreePine,
  Lock,
  Edit2,
  Save,
  LayoutGrid,
  StickyNote,
  ClipboardList,
  TrendingUp,
} from "lucide-react";

// ─── External Resource Links ─────────────────────────────────────────────────

/**
 * WHAT THIS LIST USED TO BE, and why it is now empty in the code.
 *
 * Four links lived here as a module constant: three unlisted working
 * documents and one project's own host. This page is admin-gated, so they
 * read as private. They were not.
 *
 * A route guard decides who the app will DRAW a page for. It decides nothing
 * about who can download the JavaScript that page was compiled from. This
 * page is a lazy chunk, its filename sits inside the entry bundle every
 * anonymous visitor downloads, and the assets directory answers anyone who
 * asks. Three requests and no account stood between a stranger and those
 * links, for as long as they were here.
 *
 * They are not deleted. They moved to `journey.resources`, which a founder
 * edits below and which is served only through the same admin gate the rest
 * of this page's state already passes. It ships EMPTY, so a village that
 * clones this platform inherits no link that belongs to somebody else.
 */
interface ResourceLink {
  label: string;
  url: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/*
 * The two parties on every row: the build side and the VILLAGE side.
 *
 * "collab" = both working on it together; "amora" = the village's own action.
 *
 * THE STORED VALUE STAYS `"amora"` DELIBERATELY. It is a persisted status,
 * written into `app_config['journey-state']` by every press of the dropdown,
 * so renaming the token would silently reclassify every saved row as the
 * default. What a founder READS is their own village's name, resolved at
 * render; what the server STORES is this id, forever.
 */
type DeliveryStatus = "done" | "amora" | "collab" | "pending";

interface Deliverable {
  id: string;
  text: string;
  status: DeliveryStatus;
}

interface Week {
  id: string;
  label: string;
  goal: string;
  deliverables: Deliverable[];
}

// ─── Timeline Data ────────────────────────────────────────────────────────────

/*
 * The build plan this village is working through.
 *
 * Still one specific engagement's six weeks, with its own dates and its own
 * deliverables, and still compiled in: see the S3 pages lane report for why
 * moving the PLAN itself to runtime content is a bigger job than moving its
 * NAME (every `id` here is a key the server stores checkbox, kanban and
 * decision state against, so the list cannot change shape without carrying
 * that state with it). What is fixed here is the name: a founder reading
 * this tracker sees their own village named, not the platform's first one.
 */
const buildWeeks = (villageName: string): Week[] => [
  {
    id: "w1",
    label: "Week 1 | Mar 17-23",
    goal: "Build the Village Steward and Resident co-creator journeys from end to end. Get all linked pages, CTAs, and interactive elements working.",
    deliverables: [
      { id: "w1-1", text: "Landing page - full copy and structure (welcome section, 5 journey paths)", status: "done" },
      { id: "w1-2", text: "Landing page - Attend, Experience, Co-Create, Integrate, Commit flow written and laid out", status: "done" },
      { id: "w2-17", text: "Pages: Investor, Village Steward, Resident, How We Create, Quests - copy delivered", status: "done" },
      { id: "w2-1", text: "Village Steward Space - Rights and Responsibilities page linked and drafted", status: "done" },
      { id: "w2-2", text: "Village Steward Journey - Community Connection Calls CTA live", status: "pending" },
      { id: "w2-3", text: "Village Steward Journey - Potluck, Events, Workshops, Village Weaving links live", status: "pending" },
      { id: "w2-6", text: "Village Steward Journey - Explore Quests section linked", status: "pending" },
      { id: "w2-7", text: `Village Steward Journey - ${villageName} Game Guide linked (Roles, Co-Creator criteria)`, status: "pending" },
      { id: "w2-8", text: "Village Steward Journey - Role Application for Upcoming Season CTA live", status: "pending" },
      { id: "w2-9", text: "Resident Space - Rights and Responsibilities page linked and drafted", status: "done" },
      { id: "w2-10", text: "Resident Journey - Community Call and Discovery Call CTA live", status: "pending" },
      { id: "wt-1", text: "Decision needed - name the community contribution token (currently 'Gratitude'): tracks contributions to be resolved as debt, equity, or community currency, with a percentage split for early contributors", status: "amora" },
      // The "AMORA:" prefix these three carried said the same thing as their
      // own `status: "amora"`, which already draws the village's name as the
      // owner pill next to the row. One of the two was a village's brand
      // welded into the text; the other follows the config. Kept the pill.
      { id: "w1-6", text: "Provide brand kit assets (colors, fonts, logos)", status: "amora" },
    ],
  },
  {
    id: "w2",
    label: "Week 2 | Mar 24-30",
    goal: `Build the Roles and Circles infrastructure. Publish the ${villageName} Game Guide as a navigable resource. Wire all governance links and role application flows.`,
    deliverables: [
      { id: "w4-11", text: "Pages: Governance Roles, Circles, Team - copy delivered", status: "done" },
      { id: "w4-1", text: `${villageName} Game Guide - published as linked resource with Co-Creator criteria section`, status: "pending" },
      { id: "w4-2", text: "Roles section - all initial roles documented (Community Engagement, Land Liaison, Marketing, Operations, Visionary, Financial Mgmt)", status: "pending" },
      { id: "w4-3", text: "Investor Journey - Request Investor Pack drop-down and Pack created", status: "pending" },
      { id: "w4-4", text: "Circles section - Explore Roles page complete", status: "pending" },
      { id: "w2-18", text: "Circles cards - all role titles, descriptions, and links accurate", status: "pending" },
      { id: "w4-5", text: "Co-Creator Right of Passage - description and process documented and live", status: "pending" },
      { id: "w4-6", text: "Seasonal Festivals - description page live", status: "pending" },
      { id: "w4-7", text: "Guide and Sage progression - criteria and Voice gains documented", status: "pending" },
      { id: "w4-8", text: "Resident progression stages - documented with year thresholds", status: "pending" },
      { id: "w4-10", text: "All internal hyperlinks audit - every bold link in all 4 journeys verified as working", status: "pending" },
      { id: "w1-4", text: "Roles section - role application workflow live", status: "pending" },
      { id: "am-7", text: "Add Hypha page link to How We Create and Co-Creators Guide", status: "pending" },
      { id: "am-8", text: "Launch all Hypha tools - governance platform live and linked from site", status: "pending" },
      { id: "w4-12", text: "Finalize Role descriptions and Season structure for publication", status: "collab" },
      { id: "am-2", text: "Complete the investor memo for the landholder - terms, vision, and deal structure written and ready to share", status: "collab" },
      { id: "am-3", text: "Establish the ministry - 508(c)(1)(a) structure formalised and membership framework confirmed", status: "collab" },
    ],
  },
  {
    id: "w3",
    label: "Week 3 | Mar 31-Apr 6",
    goal: "Deliver and wire the community identity pages - Love Letter, Co-Creators Guide, Good Neighbor, and Seasonal Festivals. Get all membership flows and CTAs live.",
    deliverables: [
      { id: "w1-5", text: "Pages: Home, Love Letter, Co-Creators Guide, Good Neighbor - copy delivered", status: "done" },
      { id: "w1-3", text: "Investor Journey - Schedule a Call drop-down and CTA button wired up", status: "pending" },
      { id: "w2-4", text: "Village Steward Journey - Village Weaving Immersion description and CTA live", status: "pending" },
      { id: "w2-12", text: "Love Letter membership page linked (Steward and Resident journeys)", status: "pending" },
      { id: "w2-15", text: "Resident Journey - Good Neighbor criteria linked", status: "pending" },
    ],
  },
  {
    id: "w4",
    label: "Week 4 | Apr 7-13",
    goal: "Complete the Investor and Prosperity Creator journeys with all supporting content, interactive elements, and linked resources in place.",
    deliverables: [
      { id: "w3-5", text: "Pages: Prosperity Journey - copy delivered", status: "done" },
      { id: "w3-1", text: "Investor Journey - full financial details and CTA flow complete", status: "pending" },
      { id: "w3-2", text: "Investor Journey - Request Investor Pack drop-down and CTA wired up", status: "pending" },
      { id: "w3-3", text: "Prosperity Journey - full ARI tier details and business paths documented", status: "pending" },
      { id: "w3-4", text: "Prosperity Journey - business proposal submission flow live", status: "pending" },
      { id: "w3-6", text: "Confirm ARI tiers and Voice allocations for Prosperity journey", status: "collab" },
      { id: "w3-7", text: "Confirm Investor Pack structure and financial projections", status: "collab" },
      { id: "am-1", text: "Complete token design - name, function, and economic rules for the community contribution token (currently 'Gratitude') finalised", status: "collab" },
      { id: "am-4", text: "Secure the land + clear agreement with the landholder - ownership or access terms signed and confirmed", status: "collab" },
      { id: "am-5", text: "Regen Development Fund path clear - funding vehicle, terms, and first close strategy confirmed", status: "collab" },
      { id: "am-6", text: "Business plan clear and complete - full plan covering operations, revenue model, and development phases ready to share", status: "collab" },
      { id: "w2-19", text: "Deliver Investor Pack content (terms, structure, documents)", status: "collab" },
    ],
  },
  {
    id: "w5",
    label: "Week 5 | Apr 14-20",
    goal: `Polish all pages, complete event CTAs. If the retainer is confirmed, begin scoping the backend and CRM integration. Final content review with the ${villageName} team.`,
    deliverables: [
      { id: "w5-10", text: "Pages: Master Plan, Opportunities, Housing - copy delivered", status: "done" },
      { id: "w2-11", text: "Resident Journey - Housing Options page linked", status: "pending" },
      { id: "w2-13", text: "Resident Journey - Waitlist sign-up and $NNN/month fee placeholder live", status: "pending" },
      { id: "w2-14", text: "Resident Journey - Children's Play Day CTA live", status: "pending" },
      { id: "w2-16", text: "Resident Journey - Land Share Agreement page linked", status: "pending" },
      { id: "w5-1", text: "Events section - Potluck, Village Weaving, Land Tour, Children's Play Day CTAs live", status: "pending" },
      { id: "w5-2", text: "Webinar section - slide show, email flow, recording share process documented", status: "pending" },
      { id: "w5-3", text: "Email nurture flow - basic flow outlined and handed off or implemented in CRM", status: "pending" },
      { id: "w5-4", text: "Social media - post structure and follow-up structure documented", status: "pending" },
      { id: "w5-5", text: "Love Letter page - final design and membership dues confirmed", status: "pending" },
      { id: "w5-6", text: "Waitlist page - final design and fee structure confirmed", status: "pending" },
      { id: "w5-7", text: "Mobile responsiveness - full site tested on mobile", status: "pending" },
      { id: "w5-8", text: `Content audit - all placeholder values resolved by ${villageName}`, status: "pending" },
      { id: "w5-9", text: "Backend and CRM scoping - if retainer confirmed, spec document drafted", status: "pending" },
      { id: "w5-11", text: "Final content approval pass (all journeys, roles, game guide)", status: "amora" },
      { id: "w5-12", text: "Confirm retainer decision for ongoing updates and CRM build", status: "amora" },
    ],
  },
  {
    id: "w6",
    label: "Week 6 | Apr 21-28",
    goal: `Complete final quality checks, fix any remaining issues, and deliver a fully functional site. If not on retainer, make sure ${villageName} has full admin access before the engagement ends.`,
    deliverables: [
      { id: "w6-1", text: "Full site QA - all pages, links, forms, and drop-downs tested", status: "pending" },
      { id: "w6-2", text: "Bug fixes - all outstanding visual and functional issues resolved", status: "pending" },
      { id: "w6-3", text: "Cross-browser test - Chrome, Safari, Firefox verified", status: "pending" },
      { id: "w6-4", text: `${villageName} admin access - site control transferred if not on retainer`, status: "pending" },
      { id: "w6-5", text: `Handoff documentation - editing guide delivered to the ${villageName} team`, status: "pending" },
      { id: "w6-6", text: "LAUNCH - site goes live for interested parties", status: "pending" },
      { id: "w6-7", text: "Post-launch check-in call scheduled", status: "pending" },
      { id: "w6-8", text: "Retainer and next-phase agreement signed (if continuing)", status: "pending" },
    ],
  },
];

// ─── Quick Links ──────────────────────────────────────────────────────────────

/*
 * WHAT THIS LIST USED TO BE.
 *
 * `PAGES` carried nineteen pages of section-by-section site copy plus a list
 * of unresolved placeholders per page, and the editor over it wrote every
 * edit into `app_config['journey-state'].copy` under a `<page>-<n>` key. No
 * page on this site has ever read one of those keys: the copy shipped inside
 * the page components, so the tracker was a second copy of the site that
 * drifted from the first the moment anybody typed in it. The placeholder
 * sheet counted the same fiction and reported progress against it.
 *
 * What survives is the part that always worked: a link to each live page.
 * The old list also hid /seasonal-festivals behind a filter saying the route
 * did not exist yet. It exists (App.tsx), so it is here with the rest.
 */
const buildQuickLinks = (villageName: string): { emoji: string; title: string; url: string }[] => [
  { emoji: "🏠", title: "Home", url: "/" },
  { emoji: "💌", title: "Love Letter", url: "/love-letter" },
  { emoji: "📖", title: `${villageName} Game Guide`, url: "/co-creators-guide" },
  { emoji: "🤝", title: "Good Neighbor", url: "/good-neighbor" },
  { emoji: "💰", title: "Investor Journey", url: "/investor" },
  { emoji: "🌿", title: "Village Steward", url: "/steward" },
  { emoji: "⚖️", title: "Steward Rights & Responsibilities", url: "/steward-rights" },
  { emoji: "🏡", title: "Resident Journey", url: "/resident" },
  { emoji: "🛡️", title: "Resident Rights & Responsibilities", url: "/resident-rights" },
  { emoji: "⚙️", title: "How We Create", url: "/how-we-create" },
  { emoji: "⚔️", title: "Community Quests", url: "/quests" },
  { emoji: "🎉", title: "Seasonal Festivals", url: "/seasonal-festivals" },
  { emoji: "🌱", title: "Prosperity Journey", url: "/prosperity" },
  { emoji: "📋", title: "Governance Roles", url: "/roles" },
  { emoji: "🔵", title: "Circles", url: "/circles" },
  { emoji: "👥", title: "Team", url: "/team" },
  { emoji: "🗺️", title: "Master Plan", url: "/master-plan" },
  { emoji: "💼", title: "Opportunities", url: "/opportunities" },
  { emoji: "🏘️", title: "Housing", url: "/housing" },
];

// ─── Decision Log Data ────────────────────────────────────────────────────────

const buildDecisions = (villageName: string): DecisionDef[] => [
  {
    id: "dec-token-name",
    title: "Name the community contribution token",
    description: "The token currently called 'Gratitude' needs a final name. It tracks contributions that will later be resolved as debt, equity, or community currency, with a percentage split for early contributors.",
    linkedItem: "wt-1",
    suggestedOptions: ["Gratitude", "Seeds", "Roots", "Sparks", "Threads", "Commons"],
  },
  {
    id: "dec-token-design",
    title: "Token economic design",
    description: "Define the full economic rules: percentage splits for debt vs equity vs community currency, conversion ratios, and how tokens will be distributed to early contributors.",
    linkedItem: "am-1",
  },
  {
    id: "dec-ministry",
    title: "Ministry structure and membership framework",
    description: "Confirm the 508(c)(1)(a) structure details, membership tiers, and how the ministry framework integrates with village governance and the legal entity.",
    linkedItem: "am-3",
  },
  {
    id: "dec-investor-memo",
    title: "Investor memo structure and terms",
    description: "Finalize the investor memo for the landholder: investment structure, debt vs equity ratios, interest rates, IRR projections, and Phase 1 raise target.",
    linkedItem: "am-2",
  },
  /*
   * This entry's id changed. It used to be the landholder's first name, which
   * put a private counterparty into every downloaded copy of this page's
   * chunk. Anything already recorded under the old id is NOT lost: the
   * Decisions view below renders any stored entry whose id this list no
   * longer ships, under "Carried over", with whatever was written in it.
   */
  {
    id: "dec-land-agreement",
    title: "Land agreement with the landholder",
    description: "Confirm the ownership or access terms with the landholder, including conditions, timelines, and contingencies that affect the development plan.",
    linkedItem: "am-4",
  },
  {
    id: "dec-regen-fund",
    title: "Regen Development Fund vehicle",
    description: "Confirm the legal vehicle, contribution terms, and first close strategy for the Regen Development Fund.",
    linkedItem: "am-5",
  },
  {
    id: "dec-ari-tiers",
    title: "ARI tier names and criteria",
    description: `Define the ${villageName} Regenerative Impact tier system: names, specific metrics, Voice allocations, and how businesses progress through tiers.`,
    linkedItem: "w3-6",
  },
  {
    id: "dec-roles",
    title: "Role descriptions and Season structure",
    description: "Finalize all initial role descriptions (Community Engagement, Land Liaison, Marketing, Operations, Visionary, Financial Management) and the Season structure.",
    linkedItem: "w4-12",
  },
  {
    id: "dec-resident-dues",
    title: "Monthly resident dues amount",
    description: "Confirm the monthly dues amount that covers HOA, utilities, maintenance, and community services (currently shown as $NNN/month on site).",
    linkedItem: "w2-13",
  },
  {
    id: "dec-retainer",
    title: "Retainer and next-phase agreement",
    description: "Decide whether to continue on retainer for ongoing updates and CRM build after the initial 6-week engagement.",
    linkedItem: "w5-12",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

type KanbanColumn = "assigned" | "actioning" | "needs-support" | "completed";

interface KanbanEntry {
  column: KanbanColumn;
  assignee: string;
}

interface DecisionEntry {
  status: "open" | "decided";
  chosen: string;
  notes: string;
}

interface DecisionDef {
  id: string;
  title: string;
  description: string;
  linkedItem?: string; // timeline deliverable id
  suggestedOptions?: string[];
}

type ViewId = "timeline" | "kanban" | "decisions" | "discussion" | "economics";

const API_BASE = "";

interface JourneyState {
  checkboxes: Record<string, 0 | 1 | 2>;
  copy: Record<string, string>;
  kanban: Record<string, KanbanEntry>;
  decisions: Record<string, DecisionEntry>;
  /** The founding team's own working documents, written here, never shipped. */
  resources: ResourceLink[];
}

function getDefaultCheckboxState(d: Deliverable): 0 | 1 | 2 {
  return d.status === "done" ? 1 : 0;
}

function getEffectiveState(
  id: string,
  d: Deliverable,
  serverCheckboxes: Record<string, 0 | 1 | 2>
): 0 | 1 | 2 {
  return id in serverCheckboxes ? serverCheckboxes[id] : getDefaultCheckboxState(d);
}

type BucketId = "urgent" | "in-motion" | "completed" | "amora-call";

function getEffectiveStatus(
  d: Deliverable,
  overrides: Record<string, DeliveryStatus>
): DeliveryStatus {
  return overrides[d.id] ?? d.status;
}

function getBucket(
  d: Deliverable,
  state: 0 | 1 | 2,
  overrides: Record<string, DeliveryStatus>
): BucketId {
  if (state === 2) return "completed";
  const s = getEffectiveStatus(d, overrides);
  if (s === "amora" || s === "collab") return "amora-call";
  if (s === "done" || state === 1) return "in-motion";
  return "urgent";
}

const buildBuckets = (villageName: string): { id: BucketId; emoji: string; label: string; goal: string; tone: string }[] => [
  { id: "urgent", emoji: "🔴", label: "Urgent", goal: "Pending items that need attention now.", tone: "bg-red-50 border-red-200 text-red-700" },
  { id: "in-motion", emoji: "🟡", label: "In Motion", goal: `Currently in progress. Delivered, awaiting ${villageName}.`, tone: "bg-amber-50 border-amber-200 text-amber-800" },
  { id: "completed", emoji: "🟢", label: "Completed", goal: `Done and confirmed by ${villageName}.`, tone: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  { id: "amora-call", emoji: "🔵", label: `${villageName}'s Call`, goal: `Decisions or actions for the ${villageName} team to lead.`, tone: "bg-violet-50 border-violet-200 text-violet-700" },
];

// Two axes, read at a glance: WHO owns an item (from the status dropdown) and
// WHAT STAGE it's at (from the checkbox). The pills below derive from those.
function ownerMeta(status: DeliveryStatus, villageName: string): { label: string; cls: string } {
  if (status === "amora") return { label: villageName, cls: "bg-amber/20 text-amber-800 border-amber/40" };
  if (status === "collab") return { label: "Both", cls: "bg-violet-100 text-violet-700 border-violet-200" };
  return { label: "ReGen", cls: "bg-teal-deep/10 text-teal-deep border-teal-deep/20" };
}
function stageMeta(state: 0 | 1 | 2, status: DeliveryStatus): { label: string; cls: string } {
  if (state === 2) return { label: "Confirmed", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (state === 1 || status === "done") return { label: "In progress", cls: "bg-teal/10 text-teal-700 border-teal/20" };
  return { label: "To do", cls: "bg-stone-100 text-stone-500 border-stone-200" };
}

interface DiscussionTopic {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

// ─── Password Gate ────────────────────────────────────────────────────────────

/**
 * S2: the Command Centre rides the same admin identities as /admin. The second
 * shared password is retired; this gate auto-unlocks for a signed-in admin or
 * founder, and points everyone else at the admin sign-in.
 *
 * ── IT USED TO BE A TWO-STEP DEAD END ────────────────────────────────────
 *
 * Three things went wrong on one screen and they compounded:
 *
 *   1. `fixed inset-0` with no `<Layout>`, so the site shell was gone. The
 *      page carried ONE link in total.
 *   2. That link went to `/admin`, which signed out carries zero links of
 *      its own. So the only way forward ended somewhere with no way forward.
 *   3. The heading read "Journey to Launch", which is a DIFFERENT page in
 *      this router (`/journey-to-launch`). A visitor was told the name of
 *      somewhere they were not.
 *
 * `/journey-to-launch` gates the same area correctly and is the model this
 * now follows: keep the site shell, so a visitor who followed a shared link
 * always has the header, the footer and the tab bar to leave by. The heading
 * says where they actually are.
 */
function PasswordGate({ onUnlock }: { onUnlock: (pw: string) => void }) {
  const { user, loading } = useAuth();
  const isAdmin = !!user && (user.role === "admin" || user.role === "founder");

  useEffect(() => {
    if (isAdmin) {
      const token = authToken();
      if (token) onUnlock(token);
    }
  }, [isAdmin, onUnlock]);

  return (
    <Layout>
      <div className="py-24 flex justify-center px-4">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm w-full">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-teal-deep/10 rounded-full flex items-center justify-center">
              <Lock className="w-6 h-6 text-teal-deep" />
            </div>
            <div className="text-center">
              {/* The name the page gives itself once it opens (its own h1),
                  so the gate and the page behind it agree. */}
              <h2 className="font-display text-xl font-bold text-teal-deep">Command Centre</h2>
              <p className="text-stone-500 text-sm mt-1">
                {loading || isAdmin
                  ? "Checking your access…"
                  : user
                  ? `Signed in as ${user.name}, but this area is for the founding team.`
                  : "The Command Centre is for the founding team."}
              </p>
            </div>
          </div>
          {!loading && !isAdmin && (
            <a
              href="/admin"
              className="block w-full bg-teal-deep text-white py-3 rounded-xl font-semibold text-sm hover:bg-teal transition-colors text-center"
            >
              Sign in with an admin account
            </a>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ─── Economics view (S48) ─────────────────────────────────────────────────────
// Founder economics on the ONE command centre: the settlement report the
// founders carry to Hypha (hearts and acknowledgments never blended), module
// health, the consent queue, milestones going quiet, and the ledger's own
// invariants. Read-and-steer: every action lives on its existing surface.

export function EconomicsView({ headers }: { headers: (extra?: Record<string, string>) => Record<string, string> }) {
  const catalyst = useCatalyst();
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [copiedCycle, setCopiedCycle] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/command-centre", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyForHypha = (cycle: any) => {
    const lines = [
      `${villageMoonLabel(cycle.moon)} settlement (closed ${cycle.closedAt ? new Date(cycle.closedAt).toLocaleDateString() : "date not recorded"})`,
      ...cycle.totals.map((t: any) =>
        `${t.name}: ${t.received} received (${t.receivedHearts} gratitude + ${t.receivedAcks} acknowledgments) from ${t.distinctSenders} member(s)` +
        (t.credited ? ` → ${t.credited} ${cycle.poolToken ?? ""} credited` : ""),
      ),
      `Pool released: ${cycle.poolCredited} ${cycle.poolToken ?? ""}`,
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopiedCycle(cycle.cycleNumber);
    setTimeout(() => setCopiedCycle(null), 2000);
  };

  if (failed || !data) return <p className="text-sm text-stone-400 italic py-6 text-center">{failed ? `Could not load. Are you signed in as ${catalyst.aName}?` : "Loading…"}</p>;

  const invariantsOk = !!data.reconciliation?.invariants?.ok;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Ledger invariants: the same checks boot enforces, on the desk. */}
      <div className={`rounded-xl border px-5 py-4 ${invariantsOk ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-300"}`}>
        <p className="text-sm font-semibold text-stone-700">
          {invariantsOk
            ? "The economy conserves: every token sums to zero, no drift, no illegal negatives."
            : "LEDGER INVARIANTS BROKEN. The next deploy will refuse to boot:"}
        </p>
        {!invariantsOk && (
          <ul className="mt-2 text-xs text-red-700 list-disc pl-5">
            {(data.reconciliation.invariants.problems ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
      </div>

      {/* The settlement report — the one the founders carry to Hypha. */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Cycle settlement report</h3>
        <p className="text-xs text-stone-400 mb-4">
          Closed lunations only. A member's share of the open cycle is unknowable before close, on purpose.
          Gratitude and written acknowledgments are never blended into one number.
        </p>
        {data.settlement.length === 0 && <p className="text-sm text-stone-400 italic">No cycle has closed yet.</p>}
        <div className="space-y-5">
          {data.settlement.map((c: any) => (
            <div key={c.cycleId}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
                <p className="text-sm font-semibold text-stone-700">{villageMoonLabel(c.moon)}
                  <span className="text-stone-400 font-normal"> · closed {c.closedAt ? new Date(c.closedAt).toLocaleDateString() : "date not recorded"}</span>
                  {c.poolCredited > 0 && <span className="text-teal-deep font-normal"> · pool released {c.poolCredited} {c.poolToken}</span>}
                </p>
                <button onClick={() => copyForHypha(c)} className="text-xs text-teal-deep font-medium hover:underline">
                  {copiedCycle === c.cycleNumber ? "Copied ✓" : "Copy for Hypha"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400">
                    <th className="py-1 pr-3">Member</th><th className="py-1 pr-3">Received</th>
                    <th className="py-1 pr-3">Gratitude</th><th className="py-1 pr-3">Acks</th>
                    <th className="py-1 pr-3">From</th><th className="py-1 pr-3">Credited</th>
                  </tr></thead>
                  <tbody>
                    {c.totals.map((t: any) => (
                      <tr key={t.userId} className="border-t border-stone-100">
                        <td className="py-1.5 pr-3 font-medium text-stone-700">{t.name}</td>
                        <td className="py-1.5 pr-3">{t.received}</td>
                        <td className="py-1.5 pr-3 text-rose-500">{t.receivedHearts}</td>
                        <td className="py-1.5 pr-3 text-teal-deep">{t.receivedAcks}</td>
                        <td className="py-1.5 pr-3 text-stone-500">{t.distinctSenders}</td>
                        <td className="py-1.5 pr-3">{t.credited > 0 ? `${t.credited} ${c.poolToken ?? ""}` : "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Module health */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Module health</h3>
          <p className="text-xs text-stone-400 mb-3">
            Turn modules on in{" "}
            <Link href="/admin?tab=modules" className="text-teal-deep underline">Admin → Module Library</Link>.
          </p>
          <div className="space-y-1.5">
            {data.modules.map((m: any) => (
              <div key={m.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">{m.name}{m.core && <span className="text-[10px] text-stone-400 ml-1">core</span>}</span>
                  <span>
                    {m.demotedBecause ? (
                      <span className="text-xs text-red-600 font-semibold">serving OFF, needs {m.demotedBecause.join(", ")}</span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${m.served === "off" ? "bg-stone-100 text-stone-400" : m.served === "public" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {m.served}
                      </span>
                    )}
                  </span>
                </div>
                {/* Who answers for this one. This is the screen a founder opens
                    when something is dark, so it is where "whose problem is
                    this" has to be legible without a second click. */}
                {m.support?.party === "vendor" && (
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    {m.support.vendorName} answers for the service.{" "}
                    <a href={m.support.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Support</a>
                    {m.credentialPresent === false ? " · no key set, so this module answers 503" : ""}
                  </p>
                )}
                {m.tier === "managed" && (
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Whoever runs this deployment answers for this one.
                    {m.credentialPresent === false ? " The platform key is not provisioned here yet, so it answers 503." : ""}
                  </p>
                )}
                {(m.health ?? []).map((h: any) => (
                  <p key={h.operation} className={`text-[11px] mt-0.5 ${h.verdict === "failing" || h.verdict === "stale" ? "text-red-600" : "text-stone-400"}`}>
                    {h.operation}: {h.detail}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Pending consents */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Waiting on consent</h3>
          <p className="text-xs text-stone-400 mb-3">Submitted work waiting for the human gate. Act in Admin → Quest Claims.</p>
          {data.pendingConsents.length === 0 ? (
            <p className="text-sm text-stone-400 italic">Nothing waiting.</p>
          ) : (
            <div className="space-y-1.5">
              {data.pendingConsents.map((p: any) => (
                <p key={p.id} className="text-sm text-stone-600">
                  <span className="font-medium text-stone-700">{p.userName}</span> · {p.questTitle}
                  {p.submittedAt && <span className="text-xs text-stone-400"> · {new Date(p.submittedAt).toLocaleDateString()}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stale milestones */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Milestones going quiet</h3>
        <p className="text-xs text-stone-400 mb-3">Not completed and untouched for 14+ days. Update them in Admin → Build Progress.</p>
        {data.staleMilestones.length === 0 ? (
          <p className="text-sm text-stone-400 italic">Everything has been touched recently.</p>
        ) : (
          <div className="space-y-1.5">
            {data.staleMilestones.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-stone-600">{m.title} <span className="text-xs text-stone-400">({m.status})</span></span>
                <span className="text-xs text-amber-700 font-semibold">{m.daysStale}d quiet</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProjectHistory() {
  const catalyst = useCatalyst();
  const villageName = useVillageName();
  const buckets = buildBuckets(villageName);
  const WEEKS = buildWeeks(villageName);
  const QUICK_LINKS = buildQuickLinks(villageName);
  const DECISIONS = buildDecisions(villageName);
  const [authenticated, setAuthenticated] = useState(false);
  const [journeyPassword, setJourneyPassword] = useState<string>("");
  const journeyHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${journeyPassword}`,
    ...extra,
  });
  const [activeView, setActiveView] = useState<ViewId>("timeline");
  const [serverState, setServerState] = useState<JourneyState>({ checkboxes: {}, copy: {}, kanban: {}, decisions: {}, resources: [] });
  /** What the last journey write actually did. Empty while everything lands. */
  const [writeNote, setWriteNote] = useState("");
  const [loadingState, setLoadingState] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingDecision, setEditingDecision] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<{ chosen: string; notes: string }>({ chosen: "", notes: "" });
  const [editingResources, setEditingResources] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceLink[]>([]);

  // Command Centre additions: status overrides and discussion topics (localStorage)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, DeliveryStatus>>({});
  const [discussions, setDiscussions] = useState<DiscussionTopic[]>([]);
  const [newTopic, setNewTopic] = useState("");

  useEffect(() => {
    try {
      const overridesRaw = localStorage.getItem("amora-timeline-overrides");
      if (overridesRaw) setStatusOverrides(JSON.parse(overridesRaw));
      const discRaw = localStorage.getItem("amora-discussions");
      if (discRaw) setDiscussions(JSON.parse(discRaw));
    } catch {
      // ignore
    }
  }, []);

  const setItemStatus = (id: string, status: DeliveryStatus) => {
    const next = { ...statusOverrides, [id]: status };
    setStatusOverrides(next);
    try { localStorage.setItem("amora-timeline-overrides", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const saveDiscussions = (next: DiscussionTopic[]) => {
    setDiscussions(next);
    try { localStorage.setItem("amora-discussions", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const addTopic = () => {
    const text = newTopic.trim();
    if (!text) return;
    const entry: DiscussionTopic = {
      id: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    saveDiscussions([entry, ...discussions]);
    setNewTopic("");
  };

  const toggleTopicResolved = (id: string) => {
    saveDiscussions(discussions.map((t) => (t.id === id ? { ...t, resolved: !t.resolved } : t)));
  };

  const deleteTopic = (id: string) => {
    saveDiscussions(discussions.filter((t) => t.id !== id));
  };

  // S2: no stored secret to restore — the gate auto-unlocks for admins.

  // Load server state once the gate opens (S2: reads are auth-gated now too —
  // the tracker was publicly readable while only writes checked auth).
  useEffect(() => {
    if (!authenticated) return;
    fetch(`${API_BASE}/api/journey/state`, { headers: journeyHeaders() })
      .then((r) => r.json())
      .then((data: Partial<JourneyState>) => {
        setServerState({
          checkboxes: data.checkboxes ?? {},
          copy: data.copy ?? {},
          kanban: data.kanban ?? {},
          decisions: data.decisions ?? {},
          // A village that has written no links has none, rather than
          // inheriting the ones this page used to carry in its own code.
          resources: Array.isArray(data.resources) ? data.resources : [],
        });
        setLoadingState(false);
      })
      .catch(() => setLoadingState(false));
    // journeyPassword is set together with `authenticated`, so this re-fires
    // exactly once, when the gate opens.
  }, [authenticated]);

  /**
   * A journey write that reports what the server actually said.
   *
   * Every write on this page moved the screen first and rolled back inside a
   * `catch`. `fetch` resolves on a 401 and on a 500, so that rollback only
   * ever ran for a dead network: an expired journey password refused all six
   * writes with a 401 and the founding team's tracker went on showing ticks,
   * notes, cards and decisions that were never written down. Nothing on the
   * page said so, and a reload was the only way to find out.
   *
   * Returns whether it landed, so each caller does its own rollback and the
   * one at the top of the page says a single sentence about it.
   *
   * IT ONLY EVER SETS. Clearing on success looked right and was the same
   * defect again: moving a card to "completed" and deciding a linked decision
   * both fire two writes at once, so a checkbox refused with a 401 wrote its
   * sentence and the kanban write that succeeded a moment later wiped it. The
   * four handlers below clear the slot as they start, which is one clean slate
   * per thing a person does, and a failure from either write survives.
   */
  const journeyWrite = async (path: string, body: unknown): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: journeyHeaders(),
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      // A refusal often says exactly what was wrong with it. Reporting only
      // the status number throws that sentence away and leaves somebody
      // guessing at a form they could have fixed in one edit.
      const said = await res
        .json()
        .then((body: any) => String(body?.error ?? "").trim())
        .catch(() => "");
      setWriteNote(
        res.status === 401
          ? "The tracker did not save that. Your journey password is no longer accepted, so reload the page and sign in again."
          : said
          ? `The tracker did not save that: ${said}`
          : `The tracker did not save that (${res.status}). What you see is back to what the server holds.`,
      );
    } catch {
      setWriteNote("The tracker did not reach the server. What you see is back to what the server holds.");
    }
    return false;
  };

  const cycleCheckbox = async (d: Deliverable) => {
    setWriteNote("");
    const current = getEffectiveState(d.id, d, serverState.checkboxes);
    const next: 0 | 1 | 2 = current === 0 ? 1 : current === 1 ? 2 : 0;
    // Optimistic update
    setServerState((prev) => ({
      ...prev,
      checkboxes: { ...prev.checkboxes, [d.id]: next },
    }));
    if (!(await journeyWrite("/api/journey/checkbox", { id: d.id, state: next }))) {
      setServerState((prev) => ({
        ...prev,
        checkboxes: { ...prev.checkboxes, [d.id]: current },
      }));
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEditNote = (id: string) => {
    setNoteDraft(serverState.copy[`note-${id}`] ?? "");
    setEditingNote(id);
  };

  const saveNote = async (deliverableId: string) => {
    setWriteNote("");
    const sectionId = `note-${deliverableId}`;
    const draft = noteDraft;
    const before = serverState.copy[sectionId];
    setServerState((prev) => ({
      ...prev,
      copy: { ...prev.copy, [sectionId]: draft },
    }));
    setEditingNote(null);
    if (!(await journeyWrite("/api/journey/copy", { sectionId, content: draft }))) {
      // The editor is put back with the text still in it, so a refused save
      // never costs somebody the paragraph they just wrote.
      setServerState((prev) => ({
        ...prev,
        copy: { ...prev.copy, [sectionId]: before ?? "" },
      }));
      setNoteDraft(draft);
      setEditingNote(deliverableId);
    }
  };

  const updateKanban = async (id: string, column: KanbanColumn, assignee: string) => {
    setWriteNote("");
    const before = serverState.kanban[id];
    // Optimistic update
    setServerState((prev) => ({
      ...prev,
      kanban: { ...prev.kanban, [id]: { column, assignee } },
    }));
    // If moved to completed, also mark checkbox as state 2
    if (column === "completed") {
      const d = WEEKS.flatMap((w) => w.deliverables).find((x) => x.id === id);
      if (d) {
        const wasChecked = serverState.checkboxes[id];
        setServerState((prev) => ({
          ...prev,
          checkboxes: { ...prev.checkboxes, [id]: 2 },
        }));
        void journeyWrite("/api/journey/checkbox", { id, state: 2 }).then((landed) => {
          if (!landed) {
            setServerState((prev) => {
              const checkboxes = { ...prev.checkboxes };
              if (wasChecked === undefined) delete checkboxes[id];
              else checkboxes[id] = wasChecked;
              return { ...prev, checkboxes };
            });
          }
        });
      }
    }
    if (!(await journeyWrite("/api/journey/kanban", { id, column, assignee }))) {
      setServerState((prev) => {
        const kanban = { ...prev.kanban };
        if (before === undefined) delete kanban[id];
        else kanban[id] = before;
        return { ...prev, kanban };
      });
    }
  };

  const updateDecision = async (id: string, status: "open" | "decided", chosen: string, notes: string) => {
    setWriteNote("");
    const before = serverState.decisions[id];
    setServerState((prev) => ({
      ...prev,
      decisions: { ...prev.decisions, [id]: { status, chosen, notes } },
    }));
    // If decided and has a linked timeline item, mark it as state 1 (delivered)
    const def = DECISIONS.find((decDef) => decDef.id === id);
    if (status === "decided" && def?.linkedItem) {
      const linkedD = WEEKS.flatMap((w) => w.deliverables).find((x) => x.id === def.linkedItem);
      if (linkedD) {
        const current = getEffectiveState(linkedD.id, linkedD, serverState.checkboxes);
        if (current === 0) {
          const linkedId = def.linkedItem;
          const wasChecked = serverState.checkboxes[linkedId];
          setServerState((prev) => ({
            ...prev,
            checkboxes: { ...prev.checkboxes, [linkedId]: 1 },
          }));
          void journeyWrite("/api/journey/checkbox", { id: linkedId, state: 1 }).then((landed) => {
            if (!landed) {
              setServerState((prev) => {
                const checkboxes = { ...prev.checkboxes };
                if (wasChecked === undefined) delete checkboxes[linkedId];
                else checkboxes[linkedId] = wasChecked;
                return { ...prev, checkboxes };
              });
            }
          });
        }
      }
    }
    if (await journeyWrite("/api/journey/decision", { id, status, chosen, notes })) {
      setEditingDecision(null);
      return;
    }
    // The editor stays open on a refusal, holding what was typed, because
    // closing it is the page's way of saying the decision was recorded.
    setServerState((prev) => {
      const decisions = { ...prev.decisions };
      if (before === undefined) delete decisions[id];
      else decisions[id] = before;
      return { ...prev, decisions };
    });
  };

  /**
   * The working documents this team keeps outside the site.
   *
   * Written here and stored behind the same admin gate as everything else on
   * this page, because they used to be compiled into the page's own chunk and
   * a chunk is public whatever the route guard says. The editor rolls back on
   * a refusal and keeps the rows on screen, the same shape the note editor
   * uses: a save the server declined never costs somebody what they typed.
   */
  const saveResources = async () => {
    setWriteNote("");
    const cleaned = resourceDraft
      .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.label || r.url);
    const before = serverState.resources;
    setServerState((prev) => ({ ...prev, resources: cleaned }));
    if (await journeyWrite("/api/journey/resources", { resources: cleaned })) {
      setEditingResources(false);
      return;
    }
    setServerState((prev) => ({ ...prev, resources: before }));
    setResourceDraft(cleaned);
    setEditingResources(true);
  };

  // Known assignees for auto-suggest
  const knownAssignees = Array.from(
    new Set(
      Object.values(serverState.kanban)
        .map((e) => e.assignee)
        .filter(Boolean)
    )
  );

  // Progress: weighted - delivered (state 1) = 50%, village-confirmed (state 2) = 100%
  const allDeliverables = WEEKS.flatMap((w) => w.deliverables);
  const deliveryScore = allDeliverables.reduce((acc, d) => {
    const state = getEffectiveState(d.id, d, serverState.checkboxes);
    return acc + (state === 1 ? 0.5 : state === 2 ? 1 : 0);
  }, 0);
  const progressPct = Math.round((deliveryScore / allDeliverables.length) * 100);
  const confirmedCount = allDeliverables.filter(
    (d) => getEffectiveState(d.id, d, serverState.checkboxes) === 2
  ).length;
  const deliveredCount = allDeliverables.filter(
    (d) => getEffectiveState(d.id, d, serverState.checkboxes) === 1
  ).length;

  if (!authenticated) {
    return <PasswordGate onUnlock={(pw) => { setJourneyPassword(pw); setAuthenticated(true); }} />;
  }

  return (
    <Layout>
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="bg-teal-band text-white py-8">
        <div className="container">
          <div className="flex items-center gap-3 mb-2">
            <TreePine className="w-6 h-6 text-amber-on-band" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase">Internal Tool</span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">
            Command Centre
          </h1>
          <p className="text-white text-sm max-w-2xl mb-6">
            It holds the original build tracker: the six weeks that made this
            site, kept whole. For what's left before launch, see{" "}
            <Link href="/journey-to-launch" className="text-amber-on-band underline">Journey to Launch</Link>.
          </p>

          {/* Working documents, written by an admin and stored behind the
              admin gate. Empty until somebody adds one, so a fresh village
              inherits nobody else's links. */}
          <div className="mb-6">
            {editingResources ? (
              <div className="bg-white rounded-xl p-4 max-w-2xl">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
                  Working documents
                </p>
                <p className="text-xs text-stone-500 mb-3">
                  Sheets, docs and boards this team works from. They are stored with the rest of this tracker and shown
                  only to whoever is signed in as {catalyst.aName}. Nothing here is built into the site, so a village that clones this platform starts with an empty list.
                </p>
                <div className="space-y-2">
                  {resourceDraft.map((r, i) => (
                    <div key={`resource-row-${i}`} className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={r.label}
                        placeholder="What it is"
                        aria-label={`Name for link ${i + 1}`}
                        onChange={(e) =>
                          setResourceDraft((prev) =>
                            prev.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)),
                          )
                        }
                        className="sm:w-48 shrink-0 text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                      />
                      <input
                        type="url"
                        value={r.url}
                        placeholder="https://"
                        aria-label={`Web address for link ${i + 1}`}
                        onChange={(e) =>
                          setResourceDraft((prev) =>
                            prev.map((row, j) => (j === i ? { ...row, url: e.target.value } : row)),
                          )
                        }
                        className="flex-1 text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                      />
                      <button
                        onClick={() => setResourceDraft((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 px-3 py-2 text-xs rounded-lg bg-stone-100 text-stone-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                        aria-label={`Remove ${r.label || "this link"}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => setResourceDraft((prev) => [...prev, { label: "", url: "" }])}
                    className="text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                  >
                    Add a link
                  </button>
                  <button
                    onClick={saveResources}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-deep text-white hover:bg-teal transition-colors"
                  >
                    <Save className="w-3 h-3" />
                    Save links
                  </button>
                  <button
                    onClick={() => setEditingResources(false)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {serverState.resources.map((r, i) => (
                  <a
                    key={`resource-${i}-${r.url}`}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/15 text-white hover:bg-white/25 transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    {r.label}
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                ))}
                {/* Held back until the server has answered. An admin whose
                    village HAS links would otherwise be told, for a moment,
                    that it has none. */}
                {!loadingState && (
                  <button
                    onClick={() => {
                      setResourceDraft(
                        serverState.resources.length > 0
                          ? serverState.resources.map((r) => ({ ...r }))
                          : [{ label: "", url: "" }],
                      );
                      setEditingResources(true);
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-white/40 text-white hover:bg-white/15 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    {serverState.resources.length > 0 ? "Edit links" : "Add the documents this team works from"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Progress Bar - weighted: delivered=50%, confirmed=100% */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-white text-xs">Launch progress</span>
            <div className="flex-1 max-w-xs bg-white/20 rounded-full h-2 min-w-24">
              <div
                className="bg-amber h-2 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-amber-on-band text-sm font-semibold">{progressPct}%</span>
            <span className="text-white text-xs">
              {deliveredCount} with {villageName} · {confirmedCount} confirmed
            </span>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row min-h-screen bg-stone-50">

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        {/* A fixed 224px rail beside the content leaves about 145px at 393px, and
            the content column then wrapped every word onto its own line and cut
            text mid-word: "Pending items that need attentio", "WHAT ST". It is an
            internal tool, and it was still the one route on the site where content
            was unreadable. Below md the rail becomes a full-width strip that
            scrolls sideways on its own, and the content gets the whole viewport. */}
          <aside className="w-full md:w-56 shrink-0 bg-white border-b md:border-b-0 md:border-r border-stone-200 md:sticky md:top-0 md:h-screen overflow-y-auto">
          {/* Timeline nav */}
          <div className="p-3 space-y-1">
            <button
              onClick={() => setActiveView("timeline")}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeView === "timeline"
                  ? "bg-teal-deep text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              <span>Timeline</span>
              {activeView === "timeline" && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
            <button
              onClick={() => setActiveView("kanban")}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeView === "kanban"
                  ? "bg-teal-deep text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              <span>Kanban</span>
              {activeView === "kanban" && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
            <button
              onClick={() => setActiveView("decisions")}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeView === "decisions"
                  ? "bg-teal-deep text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span>Decisions</span>
              {activeView === "decisions" ? (
                <ChevronRight className="w-3 h-3 ml-auto" />
              ) : (
                (() => {
                  const openCount = DECISIONS.filter(
                    (dec) => !serverState.decisions[dec.id] || serverState.decisions[dec.id]?.status === "open"
                  ).length;
                  return openCount > 0 ? (
                    <span className="ml-auto text-xs bg-amber-400 text-white font-bold px-1.5 py-0.5 rounded-full">
                      {openCount}
                    </span>
                  ) : null;
                })()
              )}
            </button>
            <button
              onClick={() => setActiveView("discussion")}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeView === "discussion"
                  ? "bg-teal-deep text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <StickyNote className="w-4 h-4 shrink-0" />
              <span>Discussion</span>
              {activeView === "discussion" ? (
                <ChevronRight className="w-3 h-3 ml-auto" />
              ) : (
                (() => {
                  const openCount = discussions.filter((t) => !t.resolved).length;
                  return openCount > 0 ? (
                    <span className="ml-auto text-xs bg-teal text-white font-bold px-1.5 py-0.5 rounded-full">
                      {openCount}
                    </span>
                  ) : null;
                })()
              )}
            </button>
            <button
              onClick={() => setActiveView("economics")}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeView === "economics"
                  ? "bg-teal-deep text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <TrendingUp className="w-4 h-4 shrink-0" />
              <span>Economics</span>
              {activeView === "economics" && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
          </div>

          {/* Quick Links to live pages */}
          <div className="px-3 pb-1 mt-2">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest px-1 mb-2">
              Quick Links
            </p>
          </div>
          <div className="px-3 mb-4 space-y-0.5">
            {QUICK_LINKS.map((p) => (
              <a
                key={`quicklink-${p.url}`}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-stone-600 hover:bg-stone-100 transition-colors"
              >
                <span>{p.emoji}</span>
                <span className="text-left leading-tight truncate flex-1">{p.title}</span>
                <ExternalLink className="w-3 h-3 text-stone-300 shrink-0" />
              </a>
            ))}
          </div>

        </aside>

        {/* ── Main Content ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto p-6 md:p-8">
          {/* Sits above every view, because a write can be started from any of
              them and the sentence has to survive a view switch. */}
          {writeNote && (
            <div
              role="alert"
              className="max-w-4xl mx-auto mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <span className="flex-1">{writeNote}</span>
              <button
                onClick={() => setWriteNote("")}
                className="shrink-0 text-red-400 hover:text-red-700"
                aria-label="Dismiss this message"
              >
                ×
              </button>
            </div>
          )}
          {loadingState ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-stone-400 text-sm">Loading...</div>
            </div>
          ) : (
            <>
              {/* ── TIMELINE VIEW ───────────────────────────────────────── */}
              {activeView === "timeline" && (
                <div className="max-w-4xl mx-auto">
                  {/* Legend — two things to read on every row: who owns it, and what stage it's at */}
                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 mb-6 text-xs text-stone-600">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="flex-1">
                        <p className="font-semibold text-stone-500 uppercase tracking-wide mb-2">Who owns it</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-teal-deep/10 text-teal-deep border-teal-deep/20">ReGen</span>
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-amber/20 text-amber-800 border-amber/40">{villageName}</span>
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-violet-100 text-violet-700 border-violet-200">Both</span>
                          <span className="text-stone-400">(set with the dropdown on each row)</span>
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-stone-500 uppercase tracking-wide mb-2">What stage</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-stone-100 text-stone-500 border-stone-200">To do</span>
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-teal/10 text-teal-700 border-teal/20">In progress</span>
                          <span className="px-2 py-0.5 rounded-full border font-semibold bg-emerald-100 text-emerald-700 border-emerald-200">Confirmed</span>
                          <span className="text-stone-400">(advance with the checkbox)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const allItems = WEEKS.flatMap((w) => w.deliverables);
                    return buckets.map((bucket) => {
                      const bucketItems = allItems.filter((d) => {
                        const st = getEffectiveState(d.id, d, serverState.checkboxes);
                        return getBucket(d, st, statusOverrides) === bucket.id;
                      });
                      return (
                      <div key={bucket.id} className="mb-8 bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
                        {/* Bucket header */}
                        <div className={`border-b border-stone-200 px-5 py-4 ${bucket.tone}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl leading-none">{bucket.emoji}</span>
                              <div>
                                <h2 className="font-display font-bold text-lg">{bucket.label}</h2>
                                <p className="text-stone-600 text-sm mt-0.5">{bucket.goal}</p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-stone-800 font-bold text-sm">{bucketItems.length}</span>
                              <p className="text-stone-500 text-xs">items</p>
                            </div>
                          </div>
                        </div>

                        {/* Deliverables */}
                        <div className="divide-y divide-stone-100">
                          {bucketItems.length === 0 && (
                            <p className="text-center text-xs text-stone-400 py-6 italic">Nothing here right now.</p>
                          )}
                          {bucketItems.map((d) => {
                            const effStatus = getEffectiveStatus(d, statusOverrides);
                            const isVillageOwned = effStatus === "amora";
                            const isCollab = effStatus === "collab";
                            const state = getEffectiveState(d.id, d, serverState.checkboxes);
                            const isExpanded = expandedItems.has(d.id);
                            const isEditingThisNote = editingNote === d.id;
                            const noteContent = serverState.copy[`note-${d.id}`];
                            const assigneeName = serverState.kanban[d.id]?.assignee;
                            return (
                              <div key={d.id}>
                                {/* Main row */}
                                <div
                                  className={`flex items-start gap-3 px-5 py-3 transition-colors ${
                                    isVillageOwned
                                      ? "bg-amber/5"
                                      : isCollab
                                      ? "bg-violet-50/30"
                                      : state === 2
                                      ? "bg-emerald-50/50"
                                      : state === 1
                                      ? "bg-teal-deep/5"
                                      : "hover:bg-stone-50"
                                  }`}
                                >
                                  {/* 3-state checkbox */}
                                  <button
                                    onClick={() => cycleCheckbox(d)}
                                    className="mt-0.5 shrink-0"
                                    title={
                                      state === 0
                                        ? "Click to advance to In progress"
                                        : state === 1
                                        ? "Click to mark Confirmed"
                                        : "Click to reset to To do"
                                    }
                                  >
                                    {state === 2 ? (
                                      <XSquare className="w-5 h-5 text-emerald-600" />
                                    ) : state === 1 ? (
                                      <CheckSquare className="w-5 h-5 text-teal" />
                                    ) : (
                                      <Square className="w-5 h-5 text-stone-300 hover:text-teal transition-colors" />
                                    )}
                                  </button>

                                  <span
                                    className={`flex-1 text-sm leading-relaxed ${
                                      isVillageOwned
                                        ? "text-amber-800 font-medium"
                                        : isCollab
                                        ? "text-violet-800 font-medium"
                                        : state === 2
                                        ? "text-stone-400 line-through"
                                        : state === 1
                                        ? "text-stone-600"
                                        : "text-stone-700"
                                    }`}
                                  >
                                    {d.text}
                                  </span>

                                  {/* At-a-glance: who owns it + what stage it's at */}
                                  {(() => {
                                    const owner = ownerMeta(effStatus, villageName);
                                    const stage = stageMeta(state, effStatus);
                                    return (
                                      <>
                                        <span className={`shrink-0 hidden sm:inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${owner.cls}`} title="Who owns this item">
                                          {owner.label}
                                        </span>
                                        <span className={`shrink-0 hidden sm:inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${stage.cls}`} title="What stage this item is at">
                                          {stage.label}
                                        </span>
                                      </>
                                    );
                                  })()}

                                  {/* Inline status dropdown — sets the owner / bucket (saved to server) */}
                                  <select
                                    value={effStatus}
                                    onChange={(e) => setItemStatus(d.id, e.target.value as DeliveryStatus)}
                                    title="Set who owns this item"
                                    className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded border outline-none cursor-pointer ${
                                      isVillageOwned
                                        ? "bg-amber text-foreground border-amber"
                                        : isCollab
                                        ? "bg-violet-100 text-violet-700 border-violet-200"
                                        : effStatus === "done"
                                        ? "bg-teal-deep/10 text-teal-deep border-teal-deep/20"
                                        : "bg-stone-100 text-stone-600 border-stone-200"
                                    }`}
                                  >
                                    <option value="pending">ReGen · to do</option>
                                    <option value="done">ReGen · in motion</option>
                                    <option value="amora">{villageName}'s call</option>
                                    <option value="collab">Collab (both)</option>
                                  </select>
                                  {assigneeName && (
                                    <span className="shrink-0 text-xs bg-stone-100 text-stone-600 font-medium px-2 py-0.5 rounded-full border border-stone-200">
                                      {assigneeName}
                                    </span>
                                  )}

                                  {/* Expand toggle */}
                                  <button
                                    onClick={() => toggleExpanded(d.id)}
                                    className="shrink-0 text-stone-300 hover:text-stone-500 transition-colors ml-1"
                                    title={isExpanded ? "Collapse" : "Expand notes"}
                                  >
                                    <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`} />
                                  </button>
                                </div>

                                {/* Expandable notes panel */}
                                {isExpanded && (
                                  <div className="px-5 py-3 bg-stone-50 border-t border-stone-100">
                                    <div className="flex items-center gap-2 mb-2">
                                      <StickyNote className="w-3.5 h-3.5 text-stone-400" />
                                      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Notes</span>
                                    </div>

                                    {isEditingThisNote ? (
                                      <div className="space-y-2">
                                        <textarea
                                          value={noteDraft}
                                          onChange={(e) => setNoteDraft(e.target.value)}
                                          autoFocus
                                          placeholder="Add notes, decisions, or context here..."
                                          className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none resize-y min-h-20 focus:border-teal-deep font-sans"
                                        />
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => saveNote(d.id)}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-deep text-white hover:bg-teal transition-colors"
                                          >
                                            <Save className="w-3 h-3" />
                                            Save
                                          </button>
                                          <button
                                            onClick={() => setEditingNote(null)}
                                            className="text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-sm text-stone-500 whitespace-pre-wrap leading-relaxed min-h-8">
                                          {noteContent || <span className="italic text-stone-300">No notes yet.</span>}
                                        </p>
                                        <button
                                          onClick={() => startEditNote(d.id)}
                                          className="flex items-center gap-1.5 text-xs mt-2 px-2.5 py-1 rounded-md bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                                        >
                                          <Edit2 className="w-3 h-3" />
                                          {noteContent ? "Edit notes" : "Add notes"}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    });
                  })()}

                  <p className="text-stone-400 text-xs text-center mt-4">
                    The <strong>checkbox</strong> advances the stage: To do → In progress → Confirmed → back to To do. The <strong>dropdown</strong> sets who owns it (the build side, {villageName}, or both), which sorts it into the buckets above. Everything is shared and synced to the server.
                  </p>
                </div>
              )}

              {/* ── KANBAN VIEW ─────────────────────────────────────────── */}
              {activeView === "kanban" && (() => {
                const kanbanCols: { id: KanbanColumn; label: string; color: string; headerColor: string }[] = [
                  { id: "assigned", label: "Assigned", color: "bg-stone-50", headerColor: "bg-stone-200 text-stone-700" },
                  { id: "actioning", label: "Actioning", color: "bg-blue-50", headerColor: "bg-blue-200 text-blue-800" },
                  { id: "needs-support", label: "Needs Support", color: "bg-red-50", headerColor: "bg-red-200 text-red-800" },
                  { id: "completed", label: "Completed", color: "bg-emerald-50", headerColor: "bg-emerald-200 text-emerald-800" },
                ];
                return (
                  <div className="max-w-full">
                    <div className="mb-6">
                      <h2 className="font-display text-2xl font-bold text-teal-deep">Kanban Board</h2>
                      <p className="text-stone-500 text-sm mt-1">
                        Assign tasks to team members and track progress. Moving a card to Completed auto-marks the timeline item as confirmed.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                      {kanbanCols.map((col) => {
                        const colCards = WEEKS.flatMap((w) =>
                          w.deliverables.map((d) => ({ ...d, weekLabel: w.label }))
                        ).filter((d) => {
                          const entry = serverState.kanban[d.id];
                          return entry ? entry.column === col.id : col.id === "assigned";
                        });
                        return (
                          <div key={col.id} className={`rounded-xl border border-stone-200 ${col.color} flex flex-col`}>
                            <div className={`flex items-center justify-between px-4 py-2.5 rounded-t-xl ${col.headerColor}`}>
                              <span className="font-semibold text-sm">{col.label}</span>
                              <span className="text-xs font-normal opacity-70">{colCards.length}</span>
                            </div>
                            <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-screen">
                              {colCards.length === 0 && (
                                <p className="text-center text-xs text-stone-400 py-4 italic">No tasks here</p>
                              )}
                              {colCards.map((d) => {
                                const entry = serverState.kanban[d.id];
                                const isVillageOwned = d.status === "amora";
                                const isCollab = d.status === "collab";
                                return (
                                  <div
                                    key={d.id}
                                    className={`bg-white rounded-lg border shadow-sm p-3 ${
                                      isVillageOwned
                                        ? "border-l-4 border-l-amber border-r border-t border-b border-stone-200"
                                        : isCollab
                                        ? "border-l-4 border-l-violet-400 border-r border-t border-b border-stone-200"
                                        : "border-stone-200"
                                    }`}
                                  >
                                    <p className="text-xs text-stone-700 leading-relaxed mb-2">{d.text}</p>
                                    <div className="text-xs text-stone-400 mb-2">{d.weekLabel}</div>
                                    {isVillageOwned && (
                                      <span className="inline-block text-xs bg-amber text-foreground font-semibold px-1.5 py-0.5 rounded mb-2">
                                        {villageName}
                                      </span>
                                    )}
                                    {isCollab && (
                                      <span className="inline-block text-xs bg-violet-100 text-violet-700 font-semibold px-1.5 py-0.5 rounded mb-2">
                                        Collab
                                      </span>
                                    )}
                                    <div className="flex flex-col gap-1.5 mt-1">
                                      <input
                                        type="text"
                                        list="assignee-suggestions"
                                        placeholder="Assignee name"
                                        value={entry?.assignee ?? ""}
                                        onChange={(e) =>
                                          updateKanban(d.id, entry?.column ?? "assigned", e.target.value)
                                        }
                                        className="text-xs px-2 py-1 border border-stone-200 rounded-md w-full outline-none focus:border-teal-deep"
                                      />
                                      <select
                                        value={entry?.column ?? "assigned"}
                                        onChange={(e) =>
                                          updateKanban(d.id, e.target.value as KanbanColumn, entry?.assignee ?? "")
                                        }
                                        className="text-xs px-2 py-1 border border-stone-200 rounded-md w-full outline-none focus:border-teal-deep bg-white"
                                      >
                                        <option value="assigned">Assigned</option>
                                        <option value="actioning">Actioning</option>
                                        <option value="needs-support">Needs Support</option>
                                        <option value="completed">Completed</option>
                                      </select>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Datalist for assignee auto-suggest */}
                    <datalist id="assignee-suggestions">
                      {knownAssignees.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                );
              })()}

              {/* ── DECISIONS VIEW ──────────────────────────────────────── */}
              {activeView === "decisions" && (
                <div className="max-w-3xl mx-auto">
                  <div className="mb-6">
                    <h2 className="font-display text-2xl font-bold text-teal-deep">Decision Log</h2>
                    <p className="text-stone-500 text-sm mt-1">
                      Track key decisions for the {villageName} launch. Marking a decision as decided will reflect on the timeline.
                    </p>
                  </div>

                  {/* Summary stats */}
                  <div className="flex gap-4 mb-6">
                    <div className="bg-white border border-stone-200 rounded-xl px-5 py-4 flex-1 text-center shadow-sm">
                      <p className="text-2xl font-bold text-teal-deep">
                        {DECISIONS.filter((dec) => serverState.decisions[dec.id]?.status === "decided").length}
                      </p>
                      <p className="text-stone-400 text-xs mt-0.5">Decided</p>
                    </div>
                    <div className="bg-white border border-stone-200 rounded-xl px-5 py-4 flex-1 text-center shadow-sm">
                      <p className="text-2xl font-bold text-amber-600">
                        {DECISIONS.filter((dec) => !serverState.decisions[dec.id] || serverState.decisions[dec.id]?.status === "open").length}
                      </p>
                      <p className="text-stone-400 text-xs mt-0.5">Open</p>
                    </div>
                    <div className="bg-white border border-stone-200 rounded-xl px-5 py-4 flex-1 text-center shadow-sm">
                      <p className="text-2xl font-bold text-stone-400">{DECISIONS.length}</p>
                      <p className="text-stone-400 text-xs mt-0.5">Total</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {DECISIONS.map((dec) => {
                      const entry = serverState.decisions[dec.id];
                      const isDecided = entry?.status === "decided";
                      const isEditing = editingDecision === dec.id;
                      const linkedDeliverable = dec.linkedItem
                        ? WEEKS.flatMap((w) => w.deliverables).find((x) => x.id === dec.linkedItem)
                        : null;
                      const linkedState = linkedDeliverable
                        ? getEffectiveState(linkedDeliverable.id, linkedDeliverable, serverState.checkboxes)
                        : null;

                      return (
                        <div
                          key={dec.id}
                          className={`bg-white border rounded-xl overflow-hidden shadow-sm ${
                            isDecided ? "border-emerald-200" : "border-stone-200"
                          }`}
                        >
                          <div className={`px-5 py-4 border-b ${isDecided ? "border-emerald-100 bg-emerald-50/50" : "border-stone-100 bg-stone-50"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                    isDecided
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-700"
                                  }`}>
                                    {isDecided ? "Decided" : "Open"}
                                  </span>
                                  {linkedDeliverable && (
                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                      linkedState === 2
                                        ? "bg-emerald-100 text-emerald-600"
                                        : linkedState === 1
                                        ? "bg-teal-deep/10 text-teal-deep"
                                        : "bg-stone-100 text-stone-500"
                                    }`}>
                                      Timeline: {linkedDeliverable.text.slice(0, 40)}{linkedDeliverable.text.length > 40 ? "..." : ""}
                                    </span>
                                  )}
                                </div>
                                <h3 className="font-semibold text-stone-800 text-sm">{dec.title}</h3>
                              </div>
                              <button
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingDecision(null);
                                  } else {
                                    setEditingDecision(dec.id);
                                    setDecisionDraft({
                                      chosen: entry?.chosen ?? "",
                                      notes: entry?.notes ?? "",
                                    });
                                  }
                                }}
                                className={`shrink-0 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                                  isEditing
                                    ? "bg-stone-200 text-stone-600 hover:bg-stone-300"
                                    : "bg-teal-deep text-white hover:bg-teal"
                                }`}
                              >
                                {isEditing ? "Cancel" : isDecided ? "Edit" : "Resolve"}
                              </button>
                            </div>
                          </div>

                          <div className="px-5 py-4">
                            <p className="text-stone-500 text-sm mb-3">{dec.description}</p>

                            {dec.suggestedOptions && dec.suggestedOptions.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1.5">Suggested options</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {dec.suggestedOptions.map((opt) => (
                                    <button
                                      key={opt}
                                      onClick={() => {
                                        if (!isEditing) {
                                          setEditingDecision(dec.id);
                                          setDecisionDraft({
                                            chosen: opt,
                                            notes: entry?.notes ?? "",
                                          });
                                        } else {
                                          setDecisionDraft((prev) => ({ ...prev, chosen: opt }));
                                        }
                                      }}
                                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                        (isEditing ? decisionDraft.chosen : entry?.chosen) === opt
                                          ? "bg-teal-deep text-white border-teal-deep"
                                          : "border-stone-200 text-stone-600 hover:border-teal hover:text-teal"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {isEditing ? (
                              <div className="space-y-3">
                                <div>
                                  <label className="text-xs font-semibold text-stone-500 block mb-1">Decision chosen</label>
                                  <input
                                    type="text"
                                    value={decisionDraft.chosen}
                                    onChange={(e) => setDecisionDraft((prev) => ({ ...prev, chosen: e.target.value }))}
                                    placeholder="What was decided?"
                                    autoFocus
                                    className="w-full text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-semibold text-stone-500 block mb-1">Notes / rationale</label>
                                  <textarea
                                    value={decisionDraft.notes}
                                    onChange={(e) => setDecisionDraft((prev) => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Context, rationale, or next steps..."
                                    className="w-full text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none resize-y min-h-20 focus:border-teal-deep font-sans"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => updateDecision(dec.id, "decided", decisionDraft.chosen, decisionDraft.notes)}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    Mark as Decided
                                  </button>
                                  <button
                                    onClick={() => updateDecision(dec.id, "open", decisionDraft.chosen, decisionDraft.notes)}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                                  >
                                    Save as Open
                                  </button>
                                </div>
                              </div>
                            ) : isDecided ? (
                              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                                <p className="text-xs font-semibold text-emerald-700 mb-0.5">Decision</p>
                                <p className="text-sm text-emerald-800 font-medium">{entry.chosen || "No decision text recorded"}</p>
                                {entry.notes && (
                                  <p className="text-xs text-emerald-600 mt-1.5 whitespace-pre-wrap">{entry.notes}</p>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Anything recorded against a decision this page no longer
                      ships. One id changed when a counterparty's name came out
                      of the code, and a founder's written decision must not
                      disappear because a key was renamed underneath it. */}
                  {(() => {
                    const known = new Set(DECISIONS.map((dec) => dec.id));
                    const carried = Object.entries(serverState.decisions).filter(
                      ([id, entry]) => !known.has(id) && (entry?.chosen || entry?.notes),
                    );
                    if (carried.length === 0) return null;
                    return (
                      <div className="mt-6 bg-white border border-stone-200 rounded-xl p-5">
                        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">
                          Carried over
                        </h3>
                        <p className="text-xs text-stone-400 mb-3">
                          Written against a decision that has since been renamed. Kept here so
                          nothing anyone recorded is lost.
                        </p>
                        <div className="space-y-3">
                          {carried.map(([id, entry]) => (
                            <div key={`carried-${id}`} className="border-t border-stone-100 pt-3 first:border-0 first:pt-0">
                              <p className="text-sm text-stone-700 font-medium">
                                {entry.chosen || "No decision text recorded"}
                              </p>
                              {entry.notes && (
                                <p className="text-xs text-stone-500 mt-1 whitespace-pre-wrap">{entry.notes}</p>
                              )}
                              <p className="text-xs text-stone-400 mt-1">
                                Recorded as {entry.status === "decided" ? "decided" : "open"}
                                {" · "}
                                {/* The stored key, which is data rather than
                                    code: it reaches this screen through the
                                    admin gate and never through the bundle. */}
                                <span className="font-mono">{id}</span>
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── DISCUSSION VIEW ─────────────────────────────────────── */}
              {activeView === "discussion" && (
                <div className="max-w-3xl mx-auto">
                  <div className="mb-6">
                    <h2 className="font-display text-2xl font-bold text-teal-deep">Team Discussion</h2>
                    <p className="text-stone-500 text-sm mt-1">
                      Surface topics for the team to align on. Saved locally in your browser. Share important threads in the Decision Log too.
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 mb-6">
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2 block">Add a topic</label>
                    <textarea
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      placeholder="What needs to be discussed?"
                      rows={3}
                      className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep resize-y"
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={addTopic}
                        disabled={!newTopic.trim()}
                        className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal disabled:opacity-50 transition-colors"
                      >
                        Add Topic
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const open = discussions.filter((t) => !t.resolved);
                    const resolved = discussions.filter((t) => t.resolved);
                    return (
                      <>
                        <div className="space-y-2 mb-6">
                          {open.length === 0 && (
                            <p className="text-center text-sm text-stone-400 italic py-6">No open topics. Add one above.</p>
                          )}
                          {open.map((t) => (
                            <div key={t.id} className="bg-white rounded-xl border border-stone-200 shadow-sm px-5 py-3 flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-stone-700 whitespace-pre-wrap">{t.text}</p>
                                <p className="text-xs text-stone-400 mt-1">{new Date(t.createdAt).toLocaleString()}</p>
                              </div>
                              <button
                                onClick={() => toggleTopicResolved(t.id)}
                                className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-teal-deep/10 text-teal-deep hover:bg-teal-deep hover:text-white transition-colors font-medium"
                              >
                                Resolve
                              </button>
                              <button
                                onClick={() => deleteTopic(t.id)}
                                className="shrink-0 text-stone-300 hover:text-red-500 transition-colors text-xs"
                                title="Delete"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>

                        {resolved.length > 0 && (
                          <details className="bg-stone-50 rounded-xl border border-stone-200 px-5 py-3">
                            <summary className="cursor-pointer text-sm font-semibold text-stone-500 select-none">
                              Resolved ({resolved.length})
                            </summary>
                            <div className="space-y-2 mt-3">
                              {resolved.map((t) => (
                                <div key={t.id} className="flex items-start gap-3 py-1">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-stone-500 line-through whitespace-pre-wrap">{t.text}</p>
                                    <p className="text-xs text-stone-400 mt-0.5">{new Date(t.createdAt).toLocaleString()}</p>
                                  </div>
                                  <button
                                    onClick={() => toggleTopicResolved(t.id)}
                                    className="shrink-0 text-xs text-stone-400 hover:text-teal-deep"
                                  >
                                    Reopen
                                  </button>
                                  <button
                                    onClick={() => deleteTopic(t.id)}
                                    className="shrink-0 text-stone-300 hover:text-red-500 transition-colors text-xs"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ── ECONOMICS VIEW (S48): founder economics, read-and-steer ── */}
              {activeView === "economics" && <EconomicsView headers={journeyHeaders} />}
            </>
          )}
        </main>
      </div>
    </Layout>
  );
}
