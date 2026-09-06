/**
 * Which admin tabs exist, as data. Moved out of client/src/pages/Admin.tsx
 * unchanged.
 *
 * This is the file a module contributor has to edit to give their module an
 * admin tab, and until now that meant opening an 11,000-line page to add one
 * line to a list. It is the other half of the split client/src/lib/adminNav.ts
 * already describes: this is everything the panel CAN show, and
 * `filterNavByModules` there decides what this village DOES show. The two stay
 * separate on purpose, so keeping the pure filter testable without rendering
 * anything still costs nothing.
 *
 * It began as a verbatim extraction from that page. It is not one any more:
 * c9a4535 regrouped and reordered every row so the rail reads top to bottom
 * as the order a village is actually set up in, and renamed all of the groups
 * in the process. No tab KEY changed, so every deep link survives; the shape
 * around them did.
 */
import type { LucideIcon } from "lucide-react";
import { Activity, BarChart3, Calendar, Circle, Coins, FileText, GraduationCap, Handshake, HardDrive, HelpCircle, Home, Inbox, KeyRound, LogOut, Mail, MessageSquare, Moon, Scale, Sparkles, ToggleLeft, TrendingUp, Users, Users2 } from "lucide-react";
import type { TabBadge } from "@/lib/adminNav";
import { CONTENT_SECTIONS } from "./contentSections";

/**
 * The admin nav, as data.
 *
 * It used to be ~11k characters of hand-copied <button> blocks, which is why
 * it could only ever be one width: every one of the thirty-odd items would
 * have had to learn about collapsing separately. One list renders once, and
 * the rail below decides how wide to draw it.
 *
 * `setup` moves: a front door while the village is still being set up, an
 * ordinary settings row once it is done.
 */
/**
 * The group that holds the Module Library, named once.
 *
 * Seven "module is off" messages in Admin.tsx spelled the old group title
 * into their copy, so renaming the groups sent every one of them to a heading
 * that no longer existed: a founder read "top of The Game menu" while the
 * rail in front of them said something else. Interpolating this means the
 * next reorder cannot leave the copy behind.
 */
export const MODULES_GROUP_TITLE = "What your village runs";

/** The group that holds Integrations, named once, for the same reason. */
export const CONNECTIONS_GROUP_TITLE = "Connections";

export type NavItem = { key: string; label: string; icon: LucideIcon; badge?: TabBadge };
export type NavGroup = { title: string; items: NavItem[] };

export function navGroups(setupComplete: boolean): NavGroup[] {
  return [
    ...(setupComplete ? [] : [{
      title: "Start here",
      items: [{ key: "setup", label: "Make This Yours", icon: Sparkles }],
    }]),
    {
      // FIRST, because the two BLOCKING items at the top of the launch
      // journey (admin-identities and founder-appointed) both point here, and
      // both used to sit at position four of a twenty-eight item bucket
      // called The Game. A founder cannot delegate anything until the people
      // exist, so the people come first.
      title: "Who runs this village",
      items: [
        { key: "players", label: "Players", icon: Users },
        { key: "game-roles", label: "Game Roles", icon: Users2 },
        { key: "org-chart", label: "Org Chart", icon: Users2 },
        { key: "handover", label: "The Handover", icon: KeyRound },
        { key: "governance-weights", label: "Voting Weights", icon: Scale },
      ],
    },
    {
      // Everything the outside world reads. The village's own words about
      // itself, its law and its offers, gathered from two groups that were
      // called Content and Site Content and were never distinguishable.
      title: "Make it yours",
      items: [
        ...CONTENT_SECTIONS.map(s => ({ ...s })),
        { key: "work-with-us", label: "Work With Us", icon: Handshake },
        { key: "faqs", label: "FAQs", icon: HelpCircle },
        { key: "milestones", label: "Build Progress", icon: Activity },
        { key: "visit-config", label: "Visit Program", icon: Calendar },
        { key: "investor-summary", label: "Investor Summary", icon: BarChart3 },
      ],
    },
    {
      // INTEGRATIONS IS NOT A NOTIFICATION, and filing it under one was the
      // question that started this reorder. It holds the Stripe keys, the
      // session secret and the assistant key, and SEVEN of the seventeen
      // launch requirements point at it, more than any other tab. It was the
      // second row of a two-row group named after the other one. It leads
      // here, and email settings follow it, because a mail provider is one
      // connection among several rather than the category.
      title: CONNECTIONS_GROUP_TITLE,
      items: [
        { key: "integrations", label: "Integrations", icon: KeyRound },
        { key: "email-settings", label: "Email Settings", icon: Mail },
      ],
    },
    {
      // What the village DOES. Module Library first: it is the master switch
      // for which of these exist at all, and the dials that shape them follow
      // immediately, because a founder who has just turned something on wants
      // to tune it in the same visit.
      title: MODULES_GROUP_TITLE,
      items: [
        { key: "modules", label: "Module Library", icon: ToggleLeft },
        { key: "variables", label: "Game Mechanics", icon: Activity },
        { key: "season", label: "Season", icon: Circle },
        { key: "seasons-patterns", label: "Season Shapes", icon: Calendar },
        { key: "circles-map", label: "Circles & Map", icon: Circle },
        // Beside the map on purpose: a hamlet's homes are keyed by the same
        // structure key the map mints, and a gathering's structure keys are
        // what light the map's buildings.
        { key: "housing", label: "Housing & Reservations", icon: Home },
        { key: "events-admin", label: "Calendar", icon: Calendar },
        { key: "quests-admin", label: "Quests", icon: Sparkles },
        { key: "tools-admin", label: "Tools", icon: Handshake },
        { key: "library-admin", label: "Library", icon: Inbox },
        { key: "badges-admin", label: "Badges", icon: GraduationCap },
        { key: "stays-admin", label: "Stays & Payments", icon: Home },
        { key: "exchange-admin", label: "Exchange", icon: TrendingUp },
        { key: "crowdpool-admin", label: "Crowdpool", icon: Coins },
        { key: "calls-admin", label: "Calls", icon: Calendar },
        { key: "intents-admin", label: "Introductions", icon: Handshake },
        { key: "health-admin", label: "Village Health", icon: Activity },
      ],
    },
    {
      // The desks that move value, and the two documents that say what
      // happens to a person's share. Departures sits here rather than under
      // people because opening one is a settlement before it is anything
      // else, and Cycle Close is after the Ledger on purpose: it is the one
      // admin act that releases value, so it follows reading what is held.
      title: "Money and agreements",
      items: [
        { key: "tokens", label: "Tokens", icon: Coins },
        { key: "ledger", label: "Ledger", icon: BarChart3 },
        { key: "cycles", label: "Cycle Close", icon: Moon },
        { key: "products", label: "Payments", icon: Handshake },
        { key: "resources-admin", label: "How Resources Flow", icon: Coins },
        { key: "exits-admin", label: "Departures", icon: LogOut },
        { key: "settings", label: "Settings", icon: Coins },
      ],
    },
    {
      // The queues. Nothing here is setup, and all of it is a founder's
      // ordinary week, which is why it stopped being the first thing they
      // see. The guide's two surfaces are at the end of it, still together:
      // what she knows, and what she has asked for.
      title: "Day to day",
      items: [
        { key: "submissions", label: "All Forms", icon: Inbox },
        { key: "feedback", label: "Feedback", icon: HelpCircle },
        { key: "quest-claims", label: "Quest Claims", icon: Sparkles },
        { key: "forum-moderation", label: "Moderation", icon: Users2 },
        // Beside the forum queue on purpose: the same job, the same card, and
        // the two are the only places a flag from a member ever lands.
        { key: "message-reports", label: "Message Reports", icon: MessageSquare },
        { key: "drafts", label: "Her Drafts", icon: Inbox },
        { key: "brain", label: "Village Brain", icon: FileText },
      ],
    },
    {
      // Reference material, visited rarely and on purpose.
      title: "Library and files",
      items: [
        { key: "training-modules", label: "Training Modules", icon: GraduationCap },
        { key: "investor-vault", label: "Investor Vault", icon: FileText },
        { key: "uploaded-files", label: "Uploaded Files", icon: HardDrive },
      ],
    },
    ...(setupComplete ? [{
      title: "Settings",
      items: [{ key: "setup", label: "Project Settings", icon: Sparkles }],
    }] : []),
  ];
}
