/**
 * Where every admin tab lives, in six plain areas.
 *
 * Home is the start page unless this device has turned it off. An old
 * `?tab=` link still opens that tab. The names and the one-line help are
 * the words a new steward reads.
 */
import { storedText, writeStored } from "@/lib/safeStorage";

export const HOME_SWITCH_KEY = "admin.homeBase";

export type AreaId = "today" | "inbox" | "people" | "village" | "events" | "connections";

export interface AdminArea {
  id: AreaId;
  name: string;
  plain: string;
  help: string;
}

export const ADMIN_AREAS: AdminArea[] = [
  { id: "today", name: "Today", plain: "What needs you now", help: "Start here. It shows what is waiting and where to go next." },
  { id: "inbox", name: "Inbox", plain: "Everything people sent you", help: "Requests, notes and things waiting for an answer." },
  { id: "people", name: "People", plain: "Members and players", help: "Who is here, and the roles they hold." },
  { id: "village", name: "Your village", plain: "How the village is set up", help: "The pages, the rules and the parts you can turn on." },
  { id: "events", name: "Events and messages", plain: "What you tell people", help: "The calendar and the mail the village sends." },
  { id: "connections", name: "Connections", plain: "Outside services the village uses", help: "Email, payments and the other services the village connects to." },
];

export interface AdminTabEntry {
  key: string;
  area: AreaId;
  name: string;
  help: string;
}

const entry = (key: string, area: AreaId, name: string, help: string): AdminTabEntry => ({ key, area, name, help });

export const ADMIN_TABS: AdminTabEntry[] = [
  entry("home", "today", "Home", "What needs you now, and the six areas."),
  entry("submissions", "inbox", "All forms", "Requests people sent, such as a visit or a wish to join."),
  entry("feedback", "inbox", "Feedback", "Notes people sent about the village."),
  entry("quest-claims", "inbox", "Quest claims", "Finished quests waiting for a witness."),
  entry("forum-moderation", "inbox", "Moderation", "Forum posts a member asked you to look at."),
  entry("message-reports", "inbox", "Message reports", "Messages a member asked you to look at."),
  entry("drafts", "inbox", "Her drafts", "Drafts waiting for a person to send or drop."),
  entry("brain", "inbox", "Village brain", "What the assistant has learned for this village."),
  entry("failures", "inbox", "What is failing", "Work that did not go through, and what to do next."),
  entry("players", "people", "Players", "Everyone in the village game, and how far they have come."),
  entry("game-roles", "people", "Power groups", "Groups of permissions you can hand to people."),
  entry("org-chart", "people", "Org chart", "The circles and the roles on the chart."),
  entry("role-discover", "people", "Role discovery", "Which characters a Human Design type or a Gene Keys line points toward."),
  entry("handover", "people", "The handover", "Who receives the village when stewards change."),
  entry("governance-weights", "people", "Voting weights", "How much each voice counts in a vote."),
  entry("team", "people", "Team page", "The public cards for the people who show the village."),
  entry("setup", "village", "Make this yours", "The village name, colours and pictures."),
  entry("pages", "village", "Pages", "The words on the public pages."),
  entry("paths-stages", "village", "Paths and stages", "The paths a newcomer can take, and the stages they climb."),
  entry("legal", "village", "Legal notices", "The legal words this village publishes."),
  entry("covenant", "village", "Covenant", "The two covenant paragraphs that are this village's own."),
  entry("money", "village", "Money claims", "The money figures this village publishes."),
  entry("confidentiality", "village", "Confidentiality agreement", "The words and the PDF members align with before private records and before a role starts."),
  entry("work-with-us", "village", "Work with us", "The roles the village is asking for help with."),
  entry("faqs", "village", "FAQs", "Answers people can read before they ask."),
  entry("milestones", "village", "Build progress", "What has been built, and what is still ahead."),
  entry("visit-config", "village", "Visit program", "How a visit works, in this village's words."),
  entry("investor-summary", "village", "Investor summary", "The short page for people looking at the venture."),
  entry("modules", "village", "Module library", "The extra parts of the village, and which ones are on."),
  entry("needs-admin", "village", "What this village is for", "The needs the village has taken on."),
  entry("variables", "village", "Game mechanics", "The dials that change how the village behaves."),
  entry("season", "village", "Season", "The season that is running, and the next one."),
  entry("seasons-patterns", "village", "Season shapes", "The pattern of seasons the village repeats."),
  entry("circles-map", "village", "Circles and map", "The map of circles and the land."),
  entry("land", "village", "Where the land is", "The place this village sits."),
  entry("housing", "village", "Housing and reservations", "Homes and the reservations on them."),
  entry("quests-admin", "village", "Quests", "The quests people can take."),
  entry("tools-admin", "village", "Tools", "Tools the village lends or lists."),
  entry("library-admin", "village", "Library", "The material library."),
  entry("badges-admin", "village", "Badges", "Badges people can earn."),
  entry("stays-admin", "village", "Stays and payments", "Stays, and the payments that go with them."),
  entry("exchange-admin", "village", "Exchange", "The exchange, if this village has turned it on."),
  entry("crowdpool-admin", "village", "Crowdpool", "The pool people can contribute to."),
  entry("calls-admin", "village", "Calls", "Scheduled calls."),
  entry("intents-admin", "village", "Introductions", "Introductions between people."),
  entry("health-admin", "village", "Village health", "A reading of how the village is doing."),
  entry("tokens", "village", "Tokens", "The tokens this village uses."),
  entry("ledger", "village", "Ledger", "Where value moved."),
  entry("cash-payouts", "village", "Cash to pay out", "Cash the village owes, and what has been paid."),
  entry("pricing-desk", "village", "Pricing desk", "Every open quest beside the engine's suggestion, priced by the Treasurer."),
  entry("cycles", "village", "Cycle close", "Closing a cycle, which is a human act."),
  entry("products", "village", "Payments", "Products and the payments around them."),
  entry("resources-admin", "village", "How resources flow", "How resources move through the village."),
  entry("exits-admin", "village", "Departures", "What happens when someone leaves."),
  entry("settings", "village", "Settings", "Settings that are not on another page."),
  entry("training-modules", "village", "Training modules", "Training a member can open."),
  entry("investor-vault", "village", "Investor vault", "Files kept for investors."),
  entry("uploaded-files", "village", "Uploaded files", "Files people have uploaded."),
  entry("events-admin", "events", "Calendar", "Events on the village calendar."),
  entry("comms-overview", "events", "Overview", "A short reading of the village mail."),
  entry("comms-journeys", "events", "Journeys", "The series of messages a person can receive."),
  entry("comms-words", "events", "Words", "The words those messages use."),
  entry("comms-people", "events", "People", "Who is on a journey."),
  entry("comms-letters", "events", "Letters", "Letters you can send."),
  entry("comms-sent", "events", "Sent mail", "Mail that has already gone out."),
  entry("comms-settings", "events", "Mail settings", "How the village sends mail."),
  entry("email-settings", "events", "Mail settings", "The old address for mail settings. It opens the same page."),
  entry("integrations", "connections", "Integrations", "Outside services, and whether each one is connected."),
];

const BY_KEY = new Map(ADMIN_TABS.map((tab) => [tab.key, tab]));

export function tabEntry(key: string): AdminTabEntry | undefined {
  return BY_KEY.get(key);
}

export function tabsInArea(area: AreaId): AdminTabEntry[] {
  return ADMIN_TABS.filter((tab) => tab.area === area);
}

export function homeBaseOn(): boolean {
  return storedText("local", HOME_SWITCH_KEY) !== "0";
}

export function setHomeBaseOn(on: boolean): void {
  writeStored("local", HOME_SWITCH_KEY, on ? "1" : "0");
}

/** The tab to open when the address does not name one. */
export function fallbackAdminTab(): string {
  return homeBaseOn() ? "home" : "submissions";
}

/** An explicit `?tab=` wins. A bare /admin uses the device's start page. */
export function tabFromSearch(search: string): string {
  const named = new URLSearchParams(search).get("tab");
  return named && named.trim() ? named : fallbackAdminTab();
}
