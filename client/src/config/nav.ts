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
};

export type NavGroup = {
  label: string;
  items: readonly NavLink[];
};

export type NavEntry = NavLink | NavGroup;

export const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

/**
 * The bar, left to right. Seven entries plus the account menu.
 *
 * The width rule that produced this shape still governs it: at seventeen
 * TOP-LEVEL links the bar measured ~1250px and could only render from `xl`,
 * which left every viewport between 768px and ~1310px with no desktop
 * navigation at all. What costs bar width is an entry, not an item — a group
 * of nine costs exactly what a group of four costs, because the items live in
 * a dropdown. So the seventeen pages the app had mounted and never linked from
 * the header cost nothing here; they are items, and the bar stays short.
 *
 * Groups run 6-9 items each on purpose. A group past ~10 is a list nobody
 * reads, which is why the reference docs split off into Guides rather than
 * making About fourteen entries long: About is what the village IS, Guides is
 * how to take part in it.
 *
 * Two links carry a `module` because their pages render NotFound when that
 * module is off (Network, Contribute) — an ungated link to either would be a
 * dead end on a fresh fork. Everything else added here is ungated core content.
 * Gratitude needs no gate for the same reason Quests does not: both are `core`
 * in shared/modules.ts and cannot be turned off in v1.
 */
export const NAV: readonly NavEntry[] = [
  { href: "/", label: "Home" },
  { href: "/quests", label: "Quests" },
  /**
   * Top level, and worth the bar width.
   *
   * The map is the village's primary surface, and it spent a release buried
   * as the first item of a nine-item Village dropdown where nobody arriving
   * for the first time would find it. What costs bar width is an ENTRY, and
   * this is the one entry that earns it.
   */
  { href: "/map", label: "Living Map", module: "map" },
  {
    label: "Community",
    items: [
      { href: "/feed", label: "Feed", module: "feed" },
      { href: "/forum", label: "Forum", module: "forum" },
      { href: "/messages", label: "Messages", module: "messaging" },
      { href: "/introductions", label: "Introductions", module: "introductions" },
      { href: "/circles", label: "Circles" },
      { href: "/roles", label: "Roles" },
      { href: "/gratitude", label: "Gratitude", token: "recognition" },
      { href: "/events", label: "Events", module: "events" },
      { href: "/seasonal-festivals", label: "Seasonal Festivals" },
      { href: "/feedback", label: "Share Feedback" },
    ],
  },
  {
    label: "Village",
    items: [
      // The map itself is a top-level entry now; this is the org view.
      { href: "/map/circles", label: "Circles & Roles", module: "map" },
      { href: "/places", label: "Places", module: "map" },
      { href: "/photographs", label: "Photographs", module: "map" },
      { href: "/stay", label: "Stay", module: "stays" },
      { href: "/library", label: "Library", module: "library" },
      { href: "/tools", label: "Tools", module: "tools" },
      { href: "/village-health", label: "Health", module: "health" },
      { href: "/tokens", label: "The Exchange", module: "exchange" },
      { href: "/housing", label: "Housing" },
      { href: "/network", label: "Village Network", module: "network" },
      { href: "/contribute", label: "Contribute", module: "commerce" },
      /**
       * The crowdpool bridge. It shipped with no entry here and none in the
       * footer, so the only link to /campaigns in the whole client sat on the
       * campaign page, which is reachable only from /campaigns: a closed loop
       * with no door from outside it. It sits next to Contribute because both
       * answer "how do I put something in".
       */
      { href: "/campaigns", label: "Our Raisings", module: "crowdpool" },
    ],
  },
  {
    label: "Join",
    items: [
      { href: "/investor", label: "Investor", subtitle: "Capital Contributor", icon: TrendingUp },
      { href: "/steward", label: "Village Steward", subtitle: "Co-Creator", icon: Users },
      { href: "/resident", label: "Resident", subtitle: "Co-Creator", icon: HomeIcon },
      { href: "/prosperity", label: "Prosperity Creator", subtitle: "Business Builder", icon: Sparkles },
      { href: "/opportunities", label: "Business Opportunities" },
      { href: "/visit", label: "Plan a Visit" },
      { href: "/love-letter", label: "Sign the Love Letter" },
      { href: "/work-with-us", label: "Work With Us" },
    ],
  },
  {
    /**
     * The reference shelf: what a member reads to take part well. Ordered as a
     * newcomer meets them — the guide, then the walk, then the rules of play,
     * then the two rights pages, then the one about leaving. Rights sit here
     * rather than under Join because they matter most AFTER someone has joined.
     */
    label: "Guides",
    items: [
      { href: "/co-creators-guide", label: "Co-Creators Guide" },
      { href: "/first-walk", label: "Your First Walk" },
      { href: "/game-mechanics", label: "Game Mechanics" },
      { href: "/good-neighbor", label: "Good Neighbor" },
      { href: "/training", label: "Training" },
      { href: "/resident-rights", label: "Resident Rights" },
      { href: "/steward-rights", label: "Steward Rights" },
      { href: "/exit-policy", label: "Leaving Well" },
      // Ungated on purpose (L1): the library is public and read-only, the
      // platform's own "what a village can be" page.
      { href: "/modules", label: "Module Library" },
    ],
  },
  {
    label: "About",
    items: [
      { href: "/how-we-create", label: "How We Create" },
      { href: "/governance", label: "Governance" },
      // The live surface, module-gated: /governance explains how the village
      // decides and is always there, /decisions shows what it is deciding and
      // exists only where the engine is switched on.
      { href: "/decisions", label: "Decisions", module: "governance" },
      { href: "/master-plan", label: "Master Plan" },
      { href: "/team", label: "Our Team" },
      /**
       * R12 opened this page to every member, and the menu was the last door
       * still shut. `POST /api/dry-run` answers any signed-in member ("any
       * member as all members may suggest upgrades and will need to run models
       * and tests"), the page renders a test-run card for one, and the admin
       * door it used to sit behind is gone. So a member could run the village's
       * test run and had no way to find it short of being told the URL.
       *
       * SIGNED IN, NOT EVERYONE, and the three roles are how this file says
       * that. `visible()` in Layout.tsx passes a link with no `roles` to a
       * stranger too, and this page meets a stranger with a sign-in wall, which
       * is the locked-door-in-a-public-menu defect the Command Centre entry
       * below was written to avoid. `PUT /api/admin/users/:id/role` refuses any
       * value outside `["member", "admin", "founder"]`, so listing all three is
       * the whole signed-in population and not a guess. A fourth role would
       * have to be added here as well as there.
       *
       * NO `module`. The dry-run route mounts outside `requireModule()`, so a
       * module gate here would hide a working page on every fork that has that
       * module off, which is every fresh fork.
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
       * sign-in wall — signed out it renders 94 characters and no heading — so
       * an ungated entry here would have put a locked door in the public menu.
       * Same roles and the same amber as the Launch Plan above it, because it
       * is the same kind of entry.
       */
      {
        href: "/project-history",
        label: "🛠 Command Centre",
        roles: ["admin", "founder"],
        accent: true,
      },
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
  { href: "/profile#wallet", label: "Wallet", module: "exchange" },
  { href: "/badges", label: "Badges", module: "badges" },
  // 0098. What the village looks after, and who holds each one. In the
  // account menu rather than under Village because it answers a question a
  // member asks about themselves as often as about the place: who do I ask.
  { href: "/powers", label: "What we look after" },
  // 0140. What an outside service has proposed, waiting for somebody to read
  // it. Deliberately carries NO `roles` filter, which is the whole point of
  // the page: it is capability-gated so that a steward who is not an admin can
  // keep this queue, and a menu entry only admins could see would put the
  // capability straight back behind the panel it was written to escape. A
  // member who opens it without the capability is told so in a sentence.
  { href: "/review", label: "Review queue" },
  { href: "/admin", label: "Village Settings", roles: ["admin", "founder"] },
];
