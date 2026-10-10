/**
 * EVERY DEFAULT EMAIL'S WORDS, keyed and versioned (the comms build spec 5.5).
 *
 * These are the words every village is born with, so they are written for all
 * of them at once:
 *
 *   - THE NEXT STEP FIRST (R47, docs/COPY_STYLE_KEY.md "the four voices",
 *     approved 2026-10-05). After the greeting, an email names the one thing
 *     to do next. It says what happens, never how the village does it (no
 *     servers, admins, records, or how a thing is checked). Warmth goes where a
 *     reply reaches a person, and an email ends with at most one Lore line.
 *   - WARM, DIRECT, SPECIFIC. Second person to the reader, "we" for the
 *     village, contractions where a person would use them, short paragraphs.
 *   - ONE CLEAR BUTTON per email: a line that is only a link becomes the button,
 *     and every other link sits inside a sentence.
 *   - EVERY EMAIL SAYS WHY IT CAME. The opening line names what the reader did,
 *     and the footer says it again (`WHY_YOU_GOT_THIS` below).
 *   - GATHERINGS GIVE THE TIME TWICE when it helps: in the village's own zone,
 *     and in the reader's when we know it and it differs. A line holding a fact
 *     we do not have is left out of the email, never sent half empty.
 *   - PATHS SAY WHAT HAPPENS NEXT AND WHO WRITES BACK, and end with a person.
 *   - THE INVESTOR PATH IS INFORMATION ONLY: what the path is, the packet, a
 *     conversation with a person. No returns, no offers, no deadline. Its words
 *     need Rye's eyes or counsel's before the middle three emails go
 *     (`comms-settings.investorWordsReviewed`, 5.11).
 *   - NO VILLAGE NAME. `{{village.name}}` everywhere, and nothing that belongs
 *     to one village's own vocabulary. The brand gate holds `shared/` to that.
 *   - Under 150 words each, and every one passes the voice check. The words
 *     test (`shared/comms/defaults/words.test.ts`) renders each with sample
 *     data and holds it to all of the above.
 *
 * HOW A TEMPLATE IS READ. A village's own live row in `comms_templates` wins
 * when there is one, and this file answers otherwise. Turning a journey on or
 * saving an edit copies the default into the village's own table with
 * `platform_version` set, and from then on the village holds its own words.
 * Raising a `version` here never changes a village's words by itself: the
 * Words screen offers the improved default beside theirs, and adopting it is
 * one click.
 */
import type { EmailKind } from "../kinds";

/** How a template is laid out. `plain` is a single readable column. */
export const TEMPLATE_LAYOUTS = ["plain"] as const;
export type TemplateLayout = (typeof TEMPLATE_LAYOUTS)[number];

export interface DefaultTemplate {
  key: string;
  version: number;
  subject: string;
  preheader: string | null;
  /** Markdown, with `{{merge.fields}}`. */
  bodyMd: string;
  layout: TemplateLayout;
}

/** The four paths every village is born with, in the order a journey list shows them. */
export const DEFAULT_PATH_IDS = ["resident", "investor", "steward", "prosperity-creator"] as const;
export type DefaultPathId = (typeof DEFAULT_PATH_IDS)[number];

/** The five emails of a path journey, day 0, 2, 5, 10 and 21 (5.11). */
export const PATH_STEP_KEYS = ["welcome", "first_step", "meet_us", "stories", "check_in"] as const;
export type PathStepKey = (typeof PATH_STEP_KEYS)[number];

/** The template key for one email of one path's journey. */
export function pathTemplateKey(pathId: string, step: PathStepKey): string {
  return `path.${pathId}.${step}`;
}

// ── Pieces the words share ──────────────────────────────────────────────────

const words = (key: string, subject: string, preheader: string | null, ...paragraphs: string[]): DefaultTemplate => ({
  key,
  version: 1,
  subject,
  preheader,
  bodyMd: paragraphs.join("\n\n"),
  layout: "plain",
});

/**
 * Words rewritten in the R47 copy pass (docs/COPY_STYLE_KEY.md, "the four
 * voices", approved 2026-10-05), at version 2. Each one leads with its one next
 * step, says what happens and never how it is done, keeps a person's warmth for
 * the lines a reply can answer, and ends with at most one Lore line. Raising the
 * version is what shows a village "an improved version is available" on its
 * Words screen; nothing changes a village's own copy by itself.
 */
const revised = (key: string, subject: string, preheader: string | null, ...paragraphs: string[]): DefaultTemplate => ({
  ...words(key, subject, preheader, ...paragraphs),
  version: 2,
});

const list = (...items: string[]): string => items.map((item) => `- ${item}`).join("\n");

const HI = "Hi {{person.firstName}},";

/** The facts of a gathering. Each line goes when its fact is unknown. */
const DETAILS = list(
  "**When:** {{gathering.when}}",
  "**Your time:** {{gathering.whenLocal}}",
  "**Where:** {{gathering.where}}",
  "**Online:** {{gathering.joinLink}}",
);

/** The same, for an email whose sentence already says when. */
const PLACE = list("**Your time:** {{gathering.whenLocal}}", "**Where:** {{gathering.where}}", "**Online:** {{gathering.joinLink}}");

const SEE_GATHERING = "[See the gathering]({{gathering.url}})";
const SAVE_A_SEAT = "[Save me a seat]({{nextGathering.rsvpLink}})";
const NEXT_GATHERING = "Our next public gathering is {{nextGathering.title}}, {{nextGathering.when}}. You're welcome to come.";
const EVERY_GATHERING = "You'll find every gathering on [the calendar]({{village.url}}/events).";
const PATH_PAGE = "[Read about the {{path.name}} path]({{path.pageUrl}})";
/** The investor path's closing line, kept word for word until its words are reviewed (5.11). */
const LAST_EMAIL =
  "It's been three weeks since you chose the {{path.name}} path, and this is the last email in the series. From here, a person takes over.";
/** Every other path's closing line, after the next step it leads with. */
const LAST_OF_SERIES = "This is the last email in the series. Three weeks on the {{path.name}} path, and from here a person takes over.";
/** The one Lore line the platform's words carry, on the emails that show the Gratitude wall. */
const LORE_GRATITUDE = "Naming what is good is how a village grows more of it.";
const GRATITUDE_WALL = "[Read the Gratitude wall]({{village.url}}/gratitude)";

// ── The words ───────────────────────────────────────────────────────────────

const GATHERINGS: DefaultTemplate[] = [
  revised(
    "gathering.confirm",
    "You're coming to {{gathering.title}}",
    "{{gathering.when}}. Your seat is saved.",
    HI,
    "Your seat at {{gathering.title}} is saved. Next: put it in your calendar with the file attached.",
    DETAILS,
    "You can also add it to {{gathering.calendarLinks}}.",
    SEE_GATHERING,
    "If your plans change, [tell us you can't make it]({{gathering.cantMakeIt}}) and your seat goes to someone else.",
  ),
  revised(
    "gathering.guest_confirm",
    "Confirm your place at {{gathering.title}}",
    "One click and you're on the list.",
    HI,
    "Press the button to confirm your seat at {{gathering.title}}.",
    DETAILS,
    "[Confirm my place]({{links.confirm}})",
    "If it's full by then, you go on the waitlist, and we'll write the moment a seat opens.",
    "The link works for two days. If you didn't ask for this, ignore this email and nothing happens.",
  ),
  words(
    "gathering.reminder_day",
    "Tomorrow: {{gathering.title}}",
    "{{gathering.when}}. Everything you need is inside.",
    HI,
    "A reminder that {{gathering.title}} is tomorrow, and you said you're coming.",
    DETAILS,
    SEE_GATHERING,
    "If something's come up, [let us know you can't make it]({{gathering.cantMakeIt}}) and we'll free your seat for someone else.",
  ),
  words(
    "gathering.reminder_soon",
    "Starting soon: {{gathering.title}}",
    "{{gathering.when}}. See you there.",
    HI,
    "{{gathering.title}} starts soon. Here's what you need:",
    DETAILS,
    SEE_GATHERING,
    "If you can't make it after all, [tell us]({{gathering.cantMakeIt}}) so nobody waits for you.",
  ),
  revised(
    "gathering.changed",
    "Changed: {{gathering.title}}",
    "Here's the new plan. Your seat is still saved.",
    HI,
    "{{gathering.title}} has a new plan, and your seat is still saved. Here it is:",
    DETAILS,
    "The file attached updates your calendar.",
    SEE_GATHERING,
    "If the new plan doesn't work for you, [tell us you can't make it]({{gathering.cantMakeIt}}) and your seat goes to someone else.",
  ),
  revised(
    "gathering.cancelled",
    "Cancelled: {{gathering.title}}",
    "We're sorry. You don't need to do anything.",
    HI,
    "{{gathering.title}}, planned for {{gathering.when}}, is cancelled. We're sorry to call it off.",
    "You don't need to do anything: the file attached takes it out of your calendar. If it gets a new date, you'll find it on the calendar.",
    "[See what's coming up]({{village.url}}/events)",
  ),
  revised(
    "gathering.waitlisted",
    "You're on the waitlist for {{gathering.title}}",
    "We'll write the moment a seat opens.",
    HI,
    "{{gathering.title}} is full right now, so you're on the waitlist. You don't need to check back: the moment a seat is yours, we'll email you.",
    DETAILS,
    SEE_GATHERING,
  ),
  words(
    "gathering.promoted",
    "A seat opened at {{gathering.title}}",
    "It's yours. Here are the details.",
    HI,
    "Good news: a seat opened at {{gathering.title}}, and it's yours.",
    DETAILS,
    SEE_GATHERING,
    "If you can't make it any more, [give the seat back]({{gathering.cantMakeIt}}) and it goes to the next person waiting.",
  ),
  revised(
    "gathering.host_nudge",
    "Write the recap for {{gathering.title}}",
    "A few lines while it's fresh. Everyone who said yes will hear from you.",
    HI,
    "Thank you for hosting {{gathering.title}}. Next: write the recap while it's fresh.",
    "A few lines are plenty: what happened, anything people should know, and the recording if there is one. Tick who came first, and the people who missed it get their own version.",
    "[Write the recap]({{gathering.recapLink}})",
  ),
  words(
    "gathering.recap_came",
    "{{gathering.title}}: the recap",
    "What happened, and what's next.",
    HI,
    "Thank you for saying yes to {{gathering.title}}. Here's the recap from {{gathering.hostName}}.",
    "{{recap.body}}",
    "The recording is here: {{recap.recording}}",
    "Two quick questions, if you have a minute:",
    "{{recap.questions}}",
    "**Next up:** {{nextGathering.title}}, {{nextGathering.when}}.",
    SAVE_A_SEAT,
  ),
  words(
    "gathering.recap_missed",
    "{{gathering.title}}: what you missed",
    "The recap, so you're caught up.",
    HI,
    "We missed you at {{gathering.title}}. Here's the recap from {{gathering.hostName}}, so you're caught up.",
    "{{recap.body}}",
    "{{recap.missedNote}}",
    "The recording is here: {{recap.recording}}",
    "Two quick questions, if you have a minute:",
    "{{recap.questions}}",
    "**Next up:** {{nextGathering.title}}, {{nextGathering.when}}. We'd love to see you there.",
    SAVE_A_SEAT,
  ),
];

const TIME_VOTES: DefaultTemplate[] = [
  revised(
    "poll.invite",
    "Help choose a time for {{gathering.title}}",
    "Pick every time you could make. It takes a minute.",
    HI,
    "Pick every time you could make for {{gathering.title}}:",
    "{{poll.options}}",
    "The time with the most votes wins. Until the vote closes, the gathering shows whichever time is ahead, so it may move as people vote.",
    "Right now the leader is {{poll.leading}}.",
    "You can change your answers until the vote closes on {{poll.closesAt}}.",
    "[See the vote]({{gathering.url}})",
  ),
  words(
    "poll.locked",
    "{{gathering.title}} is set for {{gathering.when}}",
    "The vote is in, and the calendar file is attached.",
    HI,
    "The vote is in. {{gathering.title}} will be on {{gathering.when}}.",
    PLACE,
    "Thank you for helping choose. The file attached puts it in your calendar.",
    SEE_GATHERING,
    "If you haven't said you're coming yet, you can do it from the gathering page.",
  ),
  words(
    "poll.moved",
    "New time for {{gathering.title}}",
    "The vote moved it to {{gathering.when}}.",
    HI,
    "The vote has moved {{gathering.title}}. It now meets {{gathering.when}}.",
    PLACE,
    "Reminders from here on follow the new time.",
    SEE_GATHERING,
    "If the new time doesn't work for you, you can change your answer on the gathering page.",
  ),
];

/** The resident path: somebody thinking about living here. First step: a housing request or a visit. */
const RESIDENT: DefaultTemplate[] = [
  revised(
    "path.resident.welcome",
    "Welcome to the {{path.name}} path",
    "Start with the path page. Here's what happens next.",
    HI,
    "Start with the {{path.name}} path page. It shows how living here works and what it asks of you.",
    PATH_PAGE,
    "You chose this path with {{village.name}}, so you're thinking about living here. We're glad you're looking.",
    "What happens next: over the next three weeks we'll send a few short emails with a first step, a gathering where you can meet people, and a look at daily life here. Then {{path.contactName}} writes to you personally.",
  ),
  revised(
    "path.resident.first_step",
    "Your first step toward living here",
    "Tell us what you're looking for. A person reads it and writes back.",
    HI,
    "Your next step: tell us what you're looking for. When you'd like to come, for how long, and who'd come with you. It commits you to nothing.",
    "[Tell us what you're looking for]({{path.nextStepLink}})",
    "To see the place first, [ask about a visit]({{village.url}}/visit). Either way, a person reads what you send and writes back.",
  ),
  revised(
    "path.resident.meet_us",
    "Come and meet us",
    "Save a seat at the next gathering.",
    HI,
    "Your next step: come and meet the people who live here. It's the best way to know whether {{village.name}} is right for you.",
    NEXT_GATHERING,
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  revised(
    "path.resident.stories",
    "What daily life here looks like",
    "People here thank each other in public. It's the clearest picture we have.",
    HI,
    "Spend ten minutes on the Gratitude wall. People here thank each other there in public for the work they do: a fence mended, a meal cooked, a meeting run well. It's the clearest picture we have of daily life in {{village.name}}.",
    GRATITUDE_WALL,
    "If a question comes up while you read, reply to this email. A person will answer.",
    LORE_GRATITUDE,
  ),
  revised(
    "path.resident.check_in",
    "Three weeks on the {{path.name}} path",
    "From here, a person takes over.",
    HI,
    "{{path.contactName}} will write to you in the next few days. To start sooner, reply and tell us where you're at: still curious, ready to visit, or ready to talk about moving.",
    "[See the {{path.name}} path]({{path.pageUrl}})",
    LAST_OF_SERIES,
  ),
];

/**
 * The investor path. INFORMATION ONLY: what the path is, the packet, a
 * conversation with a person. Nothing here names a return, makes an offer or
 * sets a deadline, and the words test holds them to that.
 */
const INVESTOR: DefaultTemplate[] = [
  words(
    "path.investor.welcome",
    "About the {{path.name}} path",
    "What the path is, and what happens next.",
    HI,
    "You chose the {{path.name}} path with {{village.name}}. This email explains what the path is and what happens next.",
    "The path is for people who want to understand how the village is organised and funded. It has three parts: an information packet, a conversation with a person from our team, and time for your questions. Reading, asking and talking commit you to nothing.",
    "Over the next three weeks we may send a few short emails with more information. After that, {{path.contactName}} will write to you personally.",
    PATH_PAGE,
  ),
  words(
    "path.investor.first_step",
    "The information packet",
    "What it is, and how to ask for it.",
    HI,
    "The first part of the {{path.name}} path is the information packet: the documents {{village.name}} shares with everyone on this path.",
    "Ask for it below and a person from our team will send it to you.",
    "[Ask for the packet]({{path.nextStepLink}})",
    "These emails share information only and make no offer. If anything in the packet raises a question, reply to this email and a person will answer it.",
  ),
  words(
    "path.investor.meet_us",
    "Meet the people running {{village.name}}",
    "A gathering is the simplest way to see how the village works.",
    HI,
    "Documents only go so far. A gathering is the simplest way to see how {{village.name}} works and to meet the people who run it day to day.",
    NEXT_GATHERING,
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  words(
    "path.investor.stories",
    "Three questions worth asking",
    "Questions to put to any project, this one included.",
    HI,
    "Before anyone decides anything, three questions are worth putting to any project, this one included:",
    "1. How are decisions made, and who makes them?\n2. How is money held, and who can see the accounts?\n3. What happens if you step away?",
    "You can ask us any of them. Reply to this email and a person from our team will answer in writing.",
    PATH_PAGE,
  ),
  words(
    "path.investor.check_in",
    "Three weeks on the {{path.name}} path",
    "From here, a person takes over.",
    HI,
    LAST_EMAIL,
    "{{path.contactName}} will write to you in the next few days to answer your questions and, if you'd like one, arrange a conversation. There's no deadline for any of it.",
    "If you'd rather start the conversation yourself, reply to this email.",
    PATH_PAGE,
  ),
];

/** The steward path: somebody who wants to help run the village. First step: a hand raised for a seat. */
const STEWARD: DefaultTemplate[] = [
  revised(
    "path.steward.welcome",
    "Welcome to the {{path.name}} path",
    "Start with the path page. Here's what happens next.",
    HI,
    "Start with the {{path.name}} path page. It shows what holding a seat here involves.",
    PATH_PAGE,
    "You chose this path with {{village.name}}, so you'd like to help run the place. Thank you: that's how a village keeps going.",
    "Stewards hold seats: real responsibilities, like keeping the water running or the calendar full, held for a term and then handed on.",
    "What happens next: over the next three weeks we'll send a few short emails on raising your hand for a seat, meeting the people you'd work with, and what the work looks like. Then {{path.contactName}} writes to you personally.",
  ),
  revised(
    "path.steward.first_step",
    "Raise your hand for a seat",
    "Find a seat that fits and tell us you're interested.",
    HI,
    "Your next step: find a seat that fits you and raise your hand for it. That says you're interested, and what follows is a conversation.",
    "Each seat says what it's responsible for and how long the term runs, so you know what you'd take on before you ask.",
    "[Find a seat]({{path.nextStepLink}})",
    "If none of them fit yet, reply and tell us what you're good at. New seats open as the village grows.",
  ),
  revised(
    "path.steward.meet_us",
    "Meet the people you'd work with",
    "Save a seat at the next gathering.",
    HI,
    "Your next step: come and meet the people you'd work with. Stewarding is work you do together, so it helps to meet first.",
    "Our next public gathering is {{nextGathering.title}}, {{nextGathering.when}}. Say hello, and ask the people who hold seats now what the work is like.",
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  revised(
    "path.steward.stories",
    "What holding a seat looks like",
    "The work is public, and so is the thanks.",
    HI,
    "Spend ten minutes on the Gratitude wall. When someone does a seat's work, people thank them there in public, and it shows the shape of stewarding here better than any description.",
    GRATITUDE_WALL,
    LORE_GRATITUDE,
  ),
  revised(
    "path.steward.check_in",
    "Three weeks on the {{path.name}} path",
    "From here, a person takes over.",
    HI,
    "{{path.contactName}} will write to you in the next few days. To start sooner, reply with the seat you have your eye on, or with what you'd like to help with.",
    "[See the seats]({{path.nextStepLink}})",
    LAST_OF_SERIES,
  ),
];

/** The prosperity creator path: somebody with work to bring. First step: a proposal. */
const PROSPERITY: DefaultTemplate[] = [
  revised(
    "path.prosperity-creator.welcome",
    "Welcome to the {{path.name}} path",
    "Start with the path page. Here's what happens next.",
    HI,
    "Start with the {{path.name}} path page. It shows how bringing your work here goes.",
    PATH_PAGE,
    "You chose this path with {{village.name}}, so you have something to bring: a business, a service, a craft or an idea. We'd like to hear it.",
    "What happens next: over the next three weeks we'll send a few short emails on sending us a proposal, a gathering where you can meet people, and what others already do here. Then {{path.contactName}} writes to you personally.",
  ),
  revised(
    "path.prosperity-creator.first_step",
    "Tell us what you'd like to bring",
    "A short proposal is the first step.",
    HI,
    "Your next step: send a short proposal. What you'd like to bring, what you'd need from the village, and what you'd like in return. A few honest paragraphs are plenty.",
    "[Send a proposal]({{path.nextStepLink}})",
    "A person reads every proposal and writes back.",
  ),
  revised(
    "path.prosperity-creator.meet_us",
    "Come and meet us",
    "Save a seat at the next gathering.",
    HI,
    "Your next step: come and meet the people who'd use your work, share it or work beside you. It's the quickest way to know whether it fits {{village.name}}.",
    NEXT_GATHERING,
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  revised(
    "path.prosperity-creator.stories",
    "What people already do here",
    "The Gratitude wall shows the work, and who it helped.",
    HI,
    "Spend ten minutes on the Gratitude wall. When someone's work helps the village, people say so there in public. It shows what's needed here, what's valued, and who you might work with.",
    GRATITUDE_WALL,
    "If it sparks an idea, reply to this email. A person will answer.",
    LORE_GRATITUDE,
  ),
  revised(
    "path.prosperity-creator.check_in",
    "Three weeks on the {{path.name}} path",
    "From here, a person takes over.",
    HI,
    "{{path.contactName}} will write to you in the next few days. To start sooner, reply and tell us what you're working on and what you'd need to bring it here.",
    PATH_PAGE,
    LAST_OF_SERIES,
  ),
];

const MEMBERS: DefaultTemplate[] = [
  revised(
    "member.welcome.day0",
    "Welcome to {{village.name}}",
    "You're in. First step: finish your profile.",
    HI,
    "You're in. Your first step: finish your profile. A photo and a few lines about you help people know who they're meeting.",
    "[Finish your profile]({{village.url}}/profile)",
    "Welcome to {{village.name}}. We're glad you're here. Over the next two weeks we'll send a few short emails to help you settle in: a first Quest, a gathering to come to, and a check-in from a person.",
  ),
  revised(
    "member.welcome.first_quest",
    "Your first Quest",
    "The simplest way in is a small piece of real work.",
    HI,
    "Your next step: take a Quest that fits the time you have this week. A Quest is a piece of work the village needs, small or large, and when it's done, people thank you for it.",
    "[Find a Quest]({{village.url}}/quests)",
    "Real work, beside people becoming your people.",
  ),
  revised(
    "member.welcome.meet_us",
    "Come to a gathering",
    "Save a seat at the next gathering.",
    HI,
    "Your next step: come to a gathering and say hello. It's the quickest way to know people here.",
    "Our next gathering is {{nextGathering.title}}, {{nextGathering.when}}.",
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  revised(
    "member.welcome.check_in",
    "Two weeks in",
    "Tell us how it's going. A person reads every reply.",
    HI,
    "Reply to this email and tell us how it's going: what's been good, what's been confusing, what you'd like to do next. A person reads every reply and writes back.",
    "You've been in {{village.name}} for two weeks now, and we'd like to know.",
    "[Open {{village.name}}]({{village.url}})",
  ),
  words(
    "joining.received",
    "We have your request to join {{village.name}}",
    "A person reads every request. Here's what happens next.",
    HI,
    "Thank you for asking to join {{village.name}}. We have your request.",
    "A person reads every request. They may write with a question or two, and either way they'll tell you the answer.",
    "While you wait, you're welcome at our public gatherings.",
    "[See what's coming up]({{village.url}}/events)",
  ),
  revised(
    "joining.meet_us",
    "Come and meet us while you wait",
    "A gathering is a good way to meet the people reading your request.",
    HI,
    "While you wait, come and meet the people here. It's the best way to know {{village.name}}, and your request is still with us.",
    NEXT_GATHERING,
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  words(
    "joining.check_in",
    "Your request to join {{village.name}}",
    "It's still with us, and a person will answer any question.",
    HI,
    "Your request to join {{village.name}} is still with us, and we haven't forgotten you.",
    "If you have a question, or something to add to your request, reply to this email. A person will answer.",
    "[See what's coming up]({{village.url}}/events)",
  ),
];

const LETTERS: DefaultTemplate[] = [
  revised(
    "letters.confirm",
    "Confirm your letters from {{village.name}}",
    "One click to say yes. Ignore this if it wasn't you.",
    HI,
    "Press the button to start letters from {{village.name}}: our news, written by the people here.",
    // `links.lettersConfirm` is the signed confirm link the people lane posts
    // this email with (the letters double opt-in). It is the email's one button.
    "[Yes, send me village news]({{links.lettersConfirm}})",
    "Someone asked for them at this address. If it wasn't you, ignore this email and nothing changes: no letters come until the button is pressed.",
  ),
  // The frame around every letter. The letter brings its own subject, preview
  // line and words; a letter with no preview line opens with its first words.
  words("letter.layout", "{{letter.subject}}", "{{letter.preheader}}", "{{letter.body}}"),
];

/**
 * A step up a path's ladder (5.11, rung emails). Sent only where a village
 * turns rung emails on for a path, and only for a move up.
 */
const PATH_RUNG: DefaultTemplate[] = [
  words(
    "path.rung",
    "You reached {{path.rung}} on the {{path.name}} path",
    "Here's the next step.",
    HI,
    "You've reached {{path.rung}} on the {{path.name}} path. Here's the next step: {{path.nextStep}}.",
    "[Take the next step]({{path.nextStepLink}})",
    "If a question comes up, reply to this email and {{path.contactName}} will write back.",
  ),
];

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  ...GATHERINGS,
  ...TIME_VOTES,
  ...RESIDENT,
  ...INVESTOR,
  ...STEWARD,
  ...PROSPERITY,
  ...MEMBERS,
  ...LETTERS,
  ...PATH_RUNG,
];

export const DEFAULT_TEMPLATES_BY_KEY: Readonly<Record<string, DefaultTemplate>> = Object.fromEntries(
  DEFAULT_TEMPLATES.map((t) => [t.key, t]),
);

/** The platform default for a key, or null when the platform has none. */
export function defaultTemplate(key: string): DefaultTemplate | null {
  return DEFAULT_TEMPLATES_BY_KEY[key] ?? null;
}

// ── A path a fork adds of its own ───────────────────────────────────────────

const GENERIC_PATH: Record<PathStepKey, Omit<DefaultTemplate, "key">> = {
  welcome: revised(
    "",
    "Welcome to the {{path.name}} path",
    "Start with the path page. Here's what happens next.",
    HI,
    "Start with the {{path.name}} path page. It shows what the path asks of you and where it leads.",
    PATH_PAGE,
    "You chose this path with {{village.name}}. We're glad you did.",
    "What happens next: over the next three weeks we'll send a few short emails with a first step, a gathering where you can meet people, and a look at life here. Then {{path.contactName}} writes to you personally.",
  ),
  first_step: revised(
    "",
    "Your first step on the {{path.name}} path",
    "One thing to do this week.",
    HI,
    "Your next step: {{path.nextStep}}.",
    "[Take the first step]({{path.nextStepLink}})",
    "If you get stuck, reply to this email. A person will answer.",
  ),
  meet_us: revised(
    "",
    "Come and meet us",
    "Save a seat at the next gathering.",
    HI,
    "Your next step: come and meet the people here. It's the best way to know {{village.name}}.",
    NEXT_GATHERING,
    SAVE_A_SEAT,
    EVERY_GATHERING,
  ),
  stories: revised(
    "",
    "A look at life in {{village.name}}",
    "People here thank each other in public. It's the clearest picture we have.",
    HI,
    "Spend ten minutes on the Gratitude wall. People here thank each other there in public for the work they do, and it's the clearest picture we have of life in {{village.name}}.",
    GRATITUDE_WALL,
    "If a question comes up while you read, reply to this email. A person will answer.",
    LORE_GRATITUDE,
  ),
  check_in: revised(
    "",
    "Three weeks on the {{path.name}} path",
    "From here, a person takes over.",
    HI,
    "{{path.contactName}} will write to you in the next few days. To start sooner, reply to this email.",
    PATH_PAGE,
    LAST_OF_SERIES,
  ),
};

const PATH_KEY = /^path\.([a-z0-9][a-z0-9-]{0,62})\.(welcome|first_step|meet_us|stories|check_in)$/;

/**
 * The words for a path the platform does not ship (a fork's own), or null for
 * any other key. Journeys give every path five emails
 * (shared/comms/defaults/journeys.ts), so every path needs five sets of words;
 * these say the same things as the four shipped paths without claiming
 * anything about a path the platform has never seen.
 */
export function genericPathTemplate(key: string): DefaultTemplate | null {
  const m = String(key ?? "").match(PATH_KEY);
  if (!m) return null;
  return { ...GENERIC_PATH[m[2] as PathStepKey], key };
}

/** The platform's words for a key: its own default, or the generic path words. */
export function platformTemplate(key: string): DefaultTemplate | null {
  return defaultTemplate(key) ?? genericPathTemplate(key);
}

// ── Why the reader got it ───────────────────────────────────────────────────

/**
 * The footer's line saying why this email came, one per kind of email. The
 * opening line of each email says it too, in the email's own words; this is
 * the line that is always there, whatever a village does to its words.
 */
export const WHY_YOU_GOT_THIS = {
  gathering: "You're getting this because you said yes to a gathering at {{village.name}}.",
  seat: "You're getting this because you asked for a seat at a gathering at {{village.name}}.",
  host: "You're getting this because you're hosting a gathering at {{village.name}}.",
  guest: "You're getting this because someone asked for a seat at a gathering at {{village.name}} with this address.",
  poll: "You're getting this because you said yes to a gathering at {{village.name}} or voted on its time.",
  path: "You're getting this because you chose a path with {{village.name}}.",
  member: "You're getting this because you joined {{village.name}}.",
  joining: "You're getting this because you asked to join {{village.name}}.",
  lettersConfirm: "You're getting this because someone asked for letters from {{village.name}} with this address.",
  letter: "You're getting this because you said yes to letters from {{village.name}}.",
  essential: "You're getting this because you asked for it at {{village.name}}.",
  notices: "You're getting this because your account at {{village.name}} sends you notifications by email.",
} as const;

export type WhyKey = keyof typeof WHY_YOU_GOT_THIS;

/** Which reason fits an email, by its template when it has one and by its kind when not. */
export function whyKeyFor(templateKey: string | null, kind: EmailKind): WhyKey {
  const key = String(templateKey ?? "");
  if (key === "gathering.host_nudge") return "host";
  if (key === "gathering.guest_confirm") return "guest";
  if (key === "gathering.waitlisted" || key === "gathering.promoted" || key === "gathering.cancelled") return "seat";
  if (key.startsWith("gathering.")) return "gathering";
  if (key.startsWith("poll.")) return "poll";
  if (key.startsWith("path.")) return "path";
  if (key.startsWith("member.")) return "member";
  if (key.startsWith("joining.")) return "joining";
  if (key === "letters.confirm") return "lettersConfirm";
  if (key.startsWith("letter.")) return "letter";
  if (kind === "events") return "gathering";
  if (kind === "paths") return "path";
  if (kind === "letters") return "letter";
  if (kind === "notices") return "notices";
  return "essential";
}

/** The footer's reason line for an email, with `{{village.name}}` still in it. */
export function whyYouGotThis(templateKey: string | null, kind: EmailKind): string {
  return WHY_YOU_GOT_THIS[whyKeyFor(templateKey, kind)];
}

// ── How the Words screen lists them ─────────────────────────────────────────

export interface TemplateGroup {
  id: string;
  title: string;
  /** The journey that sends these, when one does, for the Journeys screen's link. */
  journeyKey: string | null;
  keys: string[];
}

const pathSteps = (pathId: string): string[] => PATH_STEP_KEYS.map((s) => pathTemplateKey(pathId, s));

/** A path's own name in a list: `prosperity-creator` reads "Prosperity creator". */
export function pathTitle(pathId: string): string {
  const name = String(pathId ?? "").split("-").filter(Boolean).join(" ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

/**
 * The templates grouped the way a founder thinks about them: by the journey
 * that sends them, and by moment where no journey does. A path a fork adds
 * gets its own group from `templateGroups`.
 */
export function templateGroups(pathIds: readonly string[] = DEFAULT_PATH_IDS): TemplateGroup[] {
  return [
    { id: "gathering.going", title: "Saying yes to a gathering", journeyKey: "gathering.going", keys: ["gathering.confirm", "gathering.reminder_day", "gathering.reminder_soon"] },
    { id: "gathering.changes", title: "When a gathering changes", journeyKey: null, keys: ["gathering.changed", "gathering.cancelled"] },
    { id: "gathering.waitlist", title: "The waitlist", journeyKey: null, keys: ["gathering.waitlisted", "gathering.promoted"] },
    { id: "gathering.guests", title: "Guests", journeyKey: null, keys: ["gathering.guest_confirm"] },
    { id: "gathering.host", title: "Hosts and recaps", journeyKey: "gathering.host", keys: ["gathering.host_nudge", "gathering.recap_came", "gathering.recap_missed"] },
    { id: "polls", title: "Time votes", journeyKey: null, keys: ["poll.invite", "poll.locked", "poll.moved"] },
    ...pathIds.map((id) => ({ id: `path.${id}`, title: `${pathTitle(id)} path`, journeyKey: `path.${id}`, keys: pathSteps(id) })),
    { id: "member.welcome", title: "New members", journeyKey: "member.welcome", keys: ["member.welcome.day0", "member.welcome.first_quest", "member.welcome.meet_us", "member.welcome.check_in"] },
    { id: "joining.request", title: "Asking to join", journeyKey: "joining.request", keys: ["joining.received", "joining.meet_us", "joining.check_in"] },
    { id: "path.rung", title: "A step up a path", journeyKey: null, keys: ["path.rung"] },
    { id: "letters", title: "Letters", journeyKey: null, keys: ["letters.confirm", "letter.layout"] },
  ];
}

/** A template's short name in a list. */
export function templateLabel(key: string): string {
  const fixed: Record<string, string> = {
    "gathering.confirm": "Confirmation",
    "gathering.reminder_day": "The day before",
    "gathering.reminder_soon": "Starting soon",
    "gathering.changed": "Changed",
    "gathering.cancelled": "Cancelled",
    "gathering.waitlisted": "On the waitlist",
    "gathering.promoted": "A seat opened",
    "gathering.guest_confirm": "A guest confirms",
    "gathering.host_nudge": "Nudge the host",
    "gathering.recap_came": "Recap, for people who came",
    "gathering.recap_missed": "Recap, for people who missed it",
    "poll.invite": "Invitation to vote",
    "poll.locked": "The time is set",
    "poll.moved": "The time moved",
    "member.welcome.day0": "Day 0, welcome",
    "member.welcome.first_quest": "Day 3, a first quest",
    "member.welcome.meet_us": "Day 7, come to a gathering",
    "member.welcome.check_in": "Day 14, a person checks in",
    "joining.received": "Day 0, request received",
    "joining.meet_us": "Day 5, come and meet us",
    "joining.check_in": "Day 14, still with us",
    "letters.confirm": "Confirm letters",
    "letter.layout": "Every letter",
    "path.rung": "A step up a path",
  };
  if (fixed[key]) return fixed[key];
  const step = key.match(PATH_KEY)?.[2] as PathStepKey | undefined;
  const steps: Record<PathStepKey, string> = {
    welcome: "Day 0, welcome",
    first_step: "Day 2, the first step",
    meet_us: "Day 5, come and meet us",
    stories: "Day 10, a look at life here",
    check_in: "Day 21, a person takes over",
  };
  return step ? steps[step] : key;
}
