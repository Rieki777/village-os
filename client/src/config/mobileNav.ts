/**
 * Mobile navigation config: the bottom tab bar slots and the FAB shortcut rows.
 *
 * Platform code reads this file and nothing else, so a custom game built on this
 * foundation changes its mobile nav by editing THIS file only. Keep route
 * strings, labels, and icons here; keep behaviour in the components.
 *
 * Ported from regen-civics (client/src/components/mobile/) with its adaptive,
 * behaviour-learning ranking removed. That version ranks slots from tRPC profile
 * data plus localStorage visit counts; this one is a static list, which is the
 * right trade until there are enough routes and enough members for ranking to
 * beat a considered order.
 */
import {
  Home,
  Scroll,
  Heart,
  Users,
  Menu,
  User,
  MessageCircle,
  UserPlus,
  PenLine,
  Shield,
  Compass,
  NotebookPen,
  Orbit,
} from "lucide-react";

/**
 * The FAB's closed-state glyph. Deliberately configurable: the brand PNGs in
 * /assets/images include the AMORA wordmark and are illegible at 32px, so the
 * default is a plain icon. Swap in a square brand glyph here when one exists,
 * without touching the component.
 */
export const FabTriggerIcon = Compass;

export type TabSlot = {
  /** Route to navigate to, or omit and set `event` to dispatch instead. */
  path?: string;
  /** Window event to dispatch on tap (used by the More slot). */
  event?: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Named after a token: the bar paints the village's word for it and keeps
   *  `path` exactly where it is. See NavLink.token in config/nav.ts. */
  token?: "recognition";
};

/**
 * Exactly five slots. Four routes plus More, which opens the existing header
 * drawer rather than duplicating it as a second full menu.
 */
export const TAB_SLOTS: TabSlot[] = [
  { path: "/", label: "Home", Icon: Home },
  { path: "/quests", label: "Quests", Icon: Scroll },
  { path: "/gratitude", label: "Gratitude", Icon: Heart, token: "recognition" },
  { path: "/circles", label: "Circles", Icon: Users },
  { event: "open-mobile-menu", label: "More", Icon: Menu },
];

/**
 * Routes that render no bottom bar and no FAB.
 *
 * A fixed bar owns the bottom 65px of the viewport at EVERY scroll position,
 * including the first paint, and a tap that lands there goes to the bar. On a
 * 390x664 Safari viewport (URL bar showing) the sign-in button sat at y579 to
 * y627 and the bar started at 599: two thirds of the only control on the page
 * navigated to Gratitude instead. Bottom padding cannot fix that — padding at
 * the END of a 2000px document does not move anything at scrollY 0.
 *
 * So these four screens do not render it. Each is a single focused task with
 * one primary control, reached before anyone is signed in, and none of them
 * loses navigation: the header keeps its full menu on mobile. This is also
 * what a native app does with a tab bar during sign-up.
 *
 * Matched as exact paths, query and trailing slash stripped.
 */
export const BARE_ROUTES: string[] = ["/login", "/register", "/set-password", "/forgot-password"];

export type FabAction = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  href?: string;
  event?: string;
  /** Only show when signed in (true) or only when signed out (false). */
  requiresAuth?: boolean;
  /**
   * Module id from shared/modules.ts. The row shows only while that module is
   * on for this viewer, by the same test the header menu uses (NavLink.module
   * in config/nav.ts). Absent means always shown.
   */
  module?: string;
  /**
   * When the user is already on this route prefix, the row is useless as
   * navigation, so it swaps to `insteadOf` instead of linking to the page the
   * person is already reading.
   */
  anchorPath?: string;
  insteadOf?: { label: string; href: string; Icon: React.ComponentType<{ className?: string }> };
};

/**
 * Rendered as a column that grows UPWARD from the trigger, so the LAST entry
 * lands closest to the thumb. Quests sits last on purpose: it is the core loop.
 * The Journal sits right above it, because it is the other thing a member
 * reaches for daily, and only while the journal module is on for them.
 */
export const FAB_ACTIONS: FabAction[] = [
  { key: "roles", label: "Roles", href: "/roles", Icon: Shield },
  { key: "profile", label: "Profile", href: "/profile", Icon: User, requiresAuth: true },
  { key: "signin", label: "Sign in", href: "/login", Icon: UserPlus, requiresAuth: false },
  { key: "work-with-us", label: "Work with us", href: "/work-with-us", Icon: MessageCircle },
  {
    // A call is something a member reaches for mid-week, a step further from
    // the thumb than the daily pair below it, and only while the module is on.
    key: "sessions",
    label: "Live sessions",
    href: "/sessions",
    Icon: Orbit,
    requiresAuth: true,
    module: "sessions",
    // On the list or inside a room, the row would link to where they already are.
    anchorPath: "/sessions",
  },
  {
    key: "journal",
    label: "Journal",
    href: "/journal",
    Icon: NotebookPen,
    requiresAuth: true,
    module: "journal",
    // On the journal itself the row would link to the page being read.
    anchorPath: "/journal",
  },
  {
    key: "quests",
    label: "Quests",
    href: "/quests",
    Icon: Scroll,
    anchorPath: "/quests",
    insteadOf: { label: "Propose a quest", href: "/propose-quest", Icon: PenLine },
  },
];
