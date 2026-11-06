/**
 * The village brief: what this village is for, as data (S74).
 *
 * The platform knew a village's configuration and never knew its purpose.
 * `app_config` holds content, faqs, brand, settings, visit-config and the rest,
 * all of it configuration and copy, and nothing held the aims. So the assistant
 * could describe what a module does and could not say which seat this village
 * is missing, because seats come from work that has to be held and nothing
 * recorded the work.
 *
 * One row per section, human-confirmed, fork-local, and never published. This
 * registry is the shape; `server/lib/villageBrain.ts` is the data layer.
 *
 * Audience is a column and not a convention: `people` names members and `legal`
 * names title holders, so neither may render to a member because a markdown
 * endpoint was easier to write without a filter.
 */

export type BriefAudience = "admin" | "member";

export interface BriefSection {
  id: string;
  /** Heading in the rendered markdown. */
  title: string;
  audience: BriefAudience;
  /** What this section makes possible. Shown to admins in the editor. */
  feeds: string;
  /** How the assistant asks for it when the section is blank. */
  ask: string;
  /**
   * Part of the minimum viable brain. These three unblock role and circle
   * drafting, seat sizing, and the safety rail, so a first session targets
   * them and stops. A founder must be able to leave with a usable game.
   */
  minimum?: boolean;
}

export const BRIEF_SECTIONS: BriefSection[] = [
  {
    id: "work",
    title: "What has to happen here",
    audience: "admin",
    feeds: "Role and circle proposals. The single most important section.",
    ask: "What has to happen on your land, week to week and season to season? A rough list is fine: the watering, the animals, the bookkeeping, the guest who arrives on Tuesday.",
    minimum: true,
  },
  {
    id: "people",
    title: "Who is already carrying this",
    audience: "admin",
    feeds: "Role sizing and assignment proposals. Without it every role is a guess.",
    ask: "Who is already carrying this project, and what does each of them hold? Three names is a real answer. We size the game to the people you have.",
    minimum: true,
  },
  {
    id: "constraints",
    title: "Red lines",
    audience: "admin",
    feeds: "The assistant's safety rail. What it must never propose.",
    ask: "What must this never become? Anything that has failed here already, or that you have watched fail elsewhere and refuse to repeat.",
    minimum: true,
  },
  {
    id: "aims",
    title: "What this project is for",
    audience: "member",
    feeds: "Which roles earn their place, and which aims nothing currently covers.",
    ask: "What is this project actually trying to achieve? Three or four aims, in your own words.",
  },
  {
    id: "vision",
    title: "The long picture",
    audience: "member",
    feeds: "Copy, quests, and how the game frames itself.",
    ask: "Where does this go if it works? And how did it start?",
  },
  {
    id: "values",
    title: "What you will not trade away",
    audience: "member",
    feeds: "Tone, and the limits on what gets suggested.",
    ask: "What do you hold to even when it costs you something?",
  },
  {
    id: "language",
    title: "How you speak here",
    audience: "member",
    feeds: "Every string in the game, and which language it is written in first.",
    ask: "What language does your community coordinate in? And what do you call your members, your land, your gatherings?",
  },
  {
    id: "land",
    title: "The land and what is on it",
    audience: "admin",
    feeds: "The map, the material library, stays, and half the quest library.",
    ask: "What is the land, and what is on it today? Water, structures, tools, vehicles, and what is planned against what is built.",
  },
  {
    id: "decisions",
    title: "Who decides what",
    audience: "admin",
    feeds: "Circles and their domains, and the forum's categories.",
    ask: "Which decisions actually come up here, and who holds each one today? Include the ones that get made by nobody deciding.",
  },
  {
    id: "economy",
    title: "How value moves",
    audience: "admin",
    feeds: "Tokens, the cycle budget, the exchange, and payment products.",
    ask: "How does money and value move here? Dues, rents, wages, gifts, barter, and what a contribution earns.",
  },
  {
    id: "membership",
    title: "How someone becomes one of you",
    audience: "admin",
    feeds: "Stages, progression, and which class carries which rights.",
    ask: "How does someone go from visiting to belonging? What it costs, what it requires, and whether there are classes of membership.",
  },
  {
    id: "rhythm",
    title: "The rhythm of the year",
    audience: "admin",
    feeds: "Cycle length, scheduler cadence, and when quests should land.",
    ask: "When do you meet, and when does the work peak? Seasons, cycles, and the beat of an ordinary week.",
  },
  {
    id: "legal",
    title: "What exists on paper",
    audience: "admin",
    feeds: "Legal counsel, and whether the 508(c)(1)(A) warnings arrive in time.",
    ask: "What exists on paper right now, and where? Who holds the land title? Nothing yet is a fine answer.",
  },
  {
    id: "tools",
    title: "What you already use",
    audience: "admin",
    feeds: "The tools hub, integrations, and what the game should leave alone.",
    ask: "What do you coordinate with today, and what do you want to keep? The chat, the documents, the spreadsheets.",
  },
];

export const BRIEF_SECTION_IDS = BRIEF_SECTIONS.map((s) => s.id);

export const BRIEF_BY_ID: Record<string, BriefSection> = Object.fromEntries(
  BRIEF_SECTIONS.map((s) => [s.id, s]),
);

/** The three a first session targets. Everything else fills over weeks. */
export const MINIMUM_BRIEF = BRIEF_SECTIONS.filter((s) => s.minimum).map((s) => s.id);

/** Where a record entry came from. Derived from tables that already exist. */
export const RECORD_SOURCES = ["call", "decision", "cycle", "mechanics", "concierge", "module", "draft"] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];
