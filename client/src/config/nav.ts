/**
 * Header navigation config: the group tree and the account menu.
 *
 * One source for BOTH the desktop bar and the mobile drawer. Those were two
 * hand-written copies of the same seventeen links, and they had already drifted:
 * the drawer was missing the Launch Plan entry and rendered its preview badges
 * with different markup. A fork changes its menu by editing THIS file only.
 *
 * Shape rules that the Layout depends on:
 *  - A group renders nothing at all when every child is filtered out, so a fork
 *    with its optional modules off never gets an empty dropdown.
 *  - `module` hides a link unless that module is on for the viewer. Ids match
 *    shared/modules.ts, which is why they do not always match the label or the
 *    route (stays -> /stay, health -> /village-health, exchange -> /tokens).
 *  - `roles` hides a link unless the signed-in member holds one of them.
 */
import {
  TrendingUp,
  Users,
  Home as HomeIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { TASK_BOARD_PATH, TASK_COPY } from "@shared/sessionTasks";

export type NavLink = {
  href: string;
  label: string;
  /** Second line in the dropdown. Only the join paths use one. */
  subtitle?: string;
  icon?: LucideIcon;
  /** Module id from shared/modules.ts. Absent means always visible. */
  module?: string;
  /** Signed-in roles allowed to see this. Absent means everyone. */
  roles?: readonly string[];
  /**
   * One of the brochure pages (shared/brochure.ts). Shown only while this
   * village serves them, which a new village does not.
   */
  brochure?: true;
  /**
   * Amber treatment, for the two entries that lead into the village's own
   * working surfaces. It reads as "this is the machine room", not as "this is
   * the team's": the Launch Plan is open to every signed-in member and the
   * Command Centre is not, and they wear the same amber.
   */
  accent?: boolean;
  /**
   * This entry is named after a token, so what a member reads is whatever the
   * village calls that token (Admin → Tokens). Layout swaps `label` for the
   * live name; the `label` written here is the platform's own default word,
   * kept so this file still reads as a menu rather than a set of blanks.
   *
   * The HREF never moves. A village renaming its recognition token to Seeds
   * gets a menu entry that reads Seeds and still points at /gratitude, which
   * is where every link, bookmark and notification already goes.
   */
  token?: "recognition";
  /**
   * Shown only while this module is OFF. For a plain page that a module's
   * richer surface replaces in the menu: the separate Circles and Roles pages
   * fold into the map's "Circles & Roles" view, and come back as their own
   * entries on a village that runs no map, so neither page loses its door.
   */
  unlessModule?: string;
  /**
   * Draw a count beside the label. Only "tasks" exists: the member's own tasks
   * waiting on them, read for them alone and hidden at zero
   * (components/tasks/TaskCountBadge.tsx). Never anyone else's number.
   */
  count?: "tasks";
};

export type NavGroup = {
  label: string;
  items: readonly NavLink[];
};

export type NavEntry = NavLink | NavGroup;

export const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

/**
 * The bar, left to right. Seven entries plus the account menu (Rye,
 * 2026-10-09: the menu restructure).
 *
 * The width rule that produced this shape still governs it: at seventeen
 * TOP-LEVEL links the bar measured ~1250px and could only render from `xl`,
 * which left every viewport between 768px and ~1310px with no desktop
 * navigation at all. What costs bar width is an entry, not an item, because the
 * items live in a dropdown. So a page the menu never linked costs nothing to
 * add as an item, and the bar stays short.
 *
 * Each group answers one question, and runs 5-12 items so it stays readable:
 *   Community  who is here and what are they saying
 *   Village    the place, and what you can do in it (Quests live here now)
 *   Decide     how the village decides, and where to put something to it
 *   Join       ways in, and ways to put something in
 *   Guides     how to take part well
 *   About      what the village is
 *
 * A `module` gate is for a page that renders NotFound or a gate with its module
 * off, so an ungated link to it would be a dead end on a fresh fork.
 * Gratitude and Quests need none: both are `core` in shared/modules.ts.
 */
export const NAV: readonly NavEntry[] = [
  /*
   * No "Home" entry (Rye, 2026-10-09). The village name or logo at the left of
   * the bar is already the home link, and on a phone the bottom tab bar
   * carries Home. Its width paid for the Module Library below: with both, the
   * bar crowded the village name out of the header at 1024px.
   */
  /**
   * Top level, and worth the bar width.
   *
   * The map is the village's primary surface, and it spent a release buried
   * as the first item of a nine-item Village dropdown where nobody arriving
   * for the first time would find it. What costs bar width is an ENTRY, and
   * this is the one entry that earns it.
   */
  { href: "/map", label: "Living Map", module: "map" },
  /**
   * Top level, and the second entry to earn the bar width (Rye, 2026-10-09).
   * It took the slot of Home, which duplicated the village-name link.
   *
   * The library is the village's "what is possible here" window, and it sat
   * as the last item of Guides, under the rules-of-play pages, where nobody
   * looking for what the village could switch on would think to open. It is
   * ungated for the reason it always was (L1): public and read-only, the
   * platform's own page, so a visitor sees it too.
   */
  { href: "/modules", label: "Module Library" },
  {
    label: "Community",
    items: [
      { href: "/feed", label: "Feed", module: "feed" },
      { href: "/forum", label: "Forum", module: "forum" },
      { href: "/messages", label: "Messages", module: "messaging" },
      { href: "/introductions", label: "Introductions", module: "introductions" },
      { href: "/events", label: "Events", module: "events" },
      // The circle calls a member takes part in. It sat in the account menu,
      // where only a member already looking for it would find it. The
      // shortcuts button carries the other door (config/mobileNav.ts).
      { href: "/sessions", label: "Live Sessions", module: "sessions" },
      { href: "/gratitude", label: "Gratitude", token: "recognition" },
      { href: "/seasonal-festivals", label: "Seasonal Festivals" },
      { href: "/feedback", label: "Share Feedback" },
    ],
  },
  {
    label: "Village",
    items: [
      // Quests left the bar for here (Rye, 2026-10-09): they are something
      // you do in the village. Phones keep them in the bottom tab bar.
      { href: "/quests", label: "Quests" },
      // The org view. The plain Circles and Roles pages fold into it, and
      // return as their own entries only on a village with no map.
      { href: "/map/circles", label: "Circles & Roles", module: "map" },
      { href: "/circles", label: "Circles", unlessModule: "map" },
      { href: "/roles", label: "Roles", unlessModule: "map" },
      { href: "/places", label: "Places", module: "map" },
      { href: "/photographs", label: "Photographs", module: "map" },
      { href: "/stay", label: "Stay", module: "stays" },
      { href: "/housing", brochure: true, label: "Housing" },
      { href: "/library", label: "Library", module: "library" },
      { href: "/tools", label: "Tools", module: "tools" },
      { href: "/tokens", label: "The Exchange", module: "exchange" },
      { href: "/village-health", label: "Health", module: "health" },
    ],
  },
  {
    /**
     * How the village decides (Rye, 2026-10-09). Make a Proposal had no link
     * anywhere in the menu, and the review queue and the powers page sat in
     * the account menu, where they read as personal settings.
     */
    label: "Decide",
    items: [
      // The live surface, module-gated: /governance (under About) explains
      // how the village decides and is always there; /decisions shows what it
      // is deciding and exists only where the engine is switched on.
      { href: "/decisions", label: "Decisions", module: "governance" },
      // Season plans (RC1): everyone's plan for the season, by name. Members
      // read it (terms.read), so it is listed for the signed-in roles only.
      { href: "/season-plans", label: "Season Plans", module: "governance", roles: ["member", "admin", "founder"] },
      // Signed out, the page itself asks the visitor to sign in to write one.
      { href: "/propose", label: "Make a Proposal", module: "governance" },
      /**
       * 0140. What an outside service has proposed, waiting for somebody to
       * read it. Capability-gated in the page so that a steward who is not an
       * admin can keep this queue: a menu entry only admins could see would put
       * the capability straight back behind the panel it was written to
       * escape. Signed in only, because a stranger cannot hold the capability.
       */
      { href: "/review", label: "Review Queue", roles: ["member", "admin", "founder"] },
      // 0098. What the village looks after, and who holds each one: who do I
      // ask. Open to visitors, and the page says what signing in adds.
      { href: "/powers", label: "What We Look After" },
      /**
       * R12 opened this page to every member. `POST /api/dry-run` answers any
       * signed-in member, so a member could run the village test run and had
       * no way to find it short of being told the URL.
       *
       * SIGNED IN, NOT EVERYONE: `visible()` in Layout.tsx passes a link with
       * no `roles` to a stranger too, and this page meets a stranger with a
       * sign-in wall. `PUT /api/admin/users/:id/role` refuses any value outside
       * `["member", "admin", "founder"]`, so listing all three is the whole
       * signed-in population. A fourth role would have to be added here too.
       *
       * NO `module`. The dry-run route mounts outside `requireModule()`, so a
       * module gate here would hide a working page on every fresh fork.
       */
      {
        href: "/journey-to-launch",
        label: "🌳 Launch Plan",
        roles: ["member", "admin", "founder"],
        accent: true,
      },
      /**
       * /project-history is the Command Centre, not a public history page. Its
       * own gate auto-unlocks for admin and founder and shows everyone else a
       * sign-in wall, so an ungated entry would put a locked door in the public
       * menu. Same amber as the Launch Plan, because it is the same kind of
       * entry.
       */
      {
        href: "/project-history",
        brochure: true,
        label: "🛠 Command Centre",
        roles: ["admin", "founder"],
        accent: true,
      },
    ],
  },
  {
    label: "Join",
    items: [
      { href: "/investor", brochure: true, label: "Investor", subtitle: "Capital Contributor", icon: TrendingUp },
      { href: "/steward", brochure: true, label: "Village Steward", subtitle: "Co-Creator", icon: Users },
      { href: "/resident", brochure: true, label: "Resident", subtitle: "Co-Creator", icon: HomeIcon },
      { href: "/prosperity", brochure: true, label: "Prosperity Creator", subtitle: "Business Builder", icon: Sparkles },
      { href: "/opportunities", brochure: true, label: "Business Opportunities" },
      { href: "/visit", brochure: true, label: "Plan a Visit" },
      { href: "/love-letter", brochure: true, label: "Sign the Love Letter" },
      { href: "/work-with-us", brochure: true, label: "Work With Us" },
      // The two ways to put something in, beside the ways to come in.
      { href: "/contribute", label: "Contribute", module: "commerce" },
      /**
       * The crowdpool bridge. It shipped with no entry anywhere, so the only
       * link to /campaigns in the whole client sat on the campaign page,
       * reachable only from /campaigns: a closed loop with no door in.
       */
      { href: "/campaigns", label: "Our Raisings", module: "crowdpool" },
    ],
  },
  {
    /**
     * The reference shelf: what a member reads to take part well. Ordered as a
     * newcomer meets them: the guide, then the walk, then the rules of play,
     * then the two rights pages, then the one about leaving.
     */
    label: "Guides",
    items: [
      { href: "/co-creators-guide", brochure: true, label: "Co-Creators Guide" },
      // Founders and admins only (R47): every stop stands on a practice
      // example and the page ends at the settings, so it is the team tour.
      { href: "/first-walk", label: "Your First Walk", roles: ["admin", "founder"] },
      { href: "/game-mechanics", label: "Game Mechanics" },
      // Every email the village sends and when, read-only, with a door to propose a change (comms build spec 5.13).
      { href: "/village-email", label: "Village Email", module: "comms" },
      { href: "/good-neighbor", brochure: true, label: "Good Neighbor" },
      { href: "/training", label: "Training" },
      { href: "/resident-rights", brochure: true, label: "Resident Rights" },
      { href: "/steward-rights", brochure: true, label: "Steward Rights" },
      { href: "/exit-policy", label: "Leaving Well" },
    ],
  },
  {
    label: "About",
    items: [
      { href: "/how-we-create", brochure: true, label: "How We Create" },
      { href: "/governance", label: "Governance" },
      { href: "/master-plan", brochure: true, label: "Master Plan" },
      { href: "/team", brochure: true, label: "Our Team" },
      // The other villages this one is linked with: part of what it is.
      { href: "/network", label: "Village Network", module: "network" },
    ],
  },
];

/**
 * The signed-in avatar menu. Sign out is NOT here: it is rendered separately at
 * the foot of the dropdown, below a divider, because it is the one entry that
 * ends the session on every device and it used to sit twelve pixels from the
 * profile link in the open bar.
 *
 * Wallet points into the profile page, which is where a member's own balances
 * live. The village exchange keeps its own page under Village.
 */
export const ACCOUNT_MENU: readonly NavLink[] = [
  { href: "/profile", label: "My Profile" },
  // A member's own pages, so it lives beside their profile. The shortcuts
  // button carries the other door (config/mobileNav.ts); both hide while the
  // journal module is off for this viewer.
  { href: "/journal", label: "Journal", module: "journal" },
  { href: "/profile#wallet", label: "Wallet", module: "exchange" },
  // The live-session task board on the profile, with the member's own count
  // of what waits on them beside it. The shortcuts button carries the other
  // door (config/mobileNav.ts).
  { href: TASK_BOARD_PATH, label: TASK_COPY.menu.label, module: "sessions", count: "tasks" },
  { href: "/badges", label: "Badges", module: "badges" },
  { href: "/admin", label: "Village Settings", roles: ["admin", "founder"] },
];
