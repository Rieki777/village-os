/**
 * EVERY DEFAULT EMAIL'S WORDS, keyed and versioned (the comms build spec
 * section 5.5).
 *
 * PLACEHOLDERS, ON PURPOSE. The foundation lane fixes the KEYS and the
 * VERSIONS, because journeys, the Words screen and the post office all refer
 * to a template by its key, and a key that moves breaks all three. The real
 * words are written by the words lane (B3) in Rye's voice. Until then each
 * template says plainly and briefly what the email is for, and nothing more,
 * so a village that rehearses early reads something true.
 *
 * HOW A TEMPLATE IS READ. A village's own live row in `comms_templates` wins
 * when there is one, and this file answers otherwise. Turning a journey on or
 * saving an edit copies the default into the village's own table with
 * `platform_version` set, and from then on the village holds its own words.
 * Raising a `version` here never changes a village's words by itself: the
 * Words screen offers the improved default beside theirs and adopting it is
 * one click.
 *
 * NO VILLAGE NAME. Platform words carry `{{village.name}}`, and the brand
 * gate holds everything under `shared/` to that. Merge fields are the
 * catalogue in `shared/comms/mergeFields.ts` (lane B3); a field missing from
 * an email renders its declared fallback.
 */

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

const plain = (key: string, subject: string, bodyMd: string): DefaultTemplate => ({
  key,
  version: 1,
  subject,
  preheader: null,
  bodyMd,
  layout: "plain",
});

/**
 * One path's five emails. The same placeholder words for every path, with the
 * path's own name merged in, until the words lane writes each path its own.
 */
function pathTemplates(pathId: string): DefaultTemplate[] {
  return [
    plain(
      pathTemplateKey(pathId, "welcome"),
      "Welcome to the {{path.name}} path",
      "Hi {{person.firstName}}, you chose the {{path.name}} path with {{village.name}}. Over the next few weeks we will write a few times with the next steps.",
    ),
    plain(
      pathTemplateKey(pathId, "first_step"),
      "Your first step on the {{path.name}} path",
      "Here is the first step: {{path.nextStep}}. {{path.nextStepLink}}",
    ),
    plain(
      pathTemplateKey(pathId, "meet_us"),
      "Come and meet us",
      "The best way to know {{village.name}} is to come to a gathering and meet the people here.",
    ),
    plain(
      pathTemplateKey(pathId, "stories"),
      "What others on the {{path.name}} path found",
      "Here is what people on the {{path.name}} path have found so far.",
    ),
    plain(
      pathTemplateKey(pathId, "check_in"),
      "Three weeks on the {{path.name}} path",
      "Hi {{person.firstName}}, it has been three weeks. Reply to this email and {{path.contactName}} will write back.",
    ),
  ];
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  // ── Gatherings ──────────────────────────────────────────────────────────
  plain(
    "gathering.confirm",
    "{{gathering.title}}: you are coming",
    "You said yes to {{gathering.title}} on {{gathering.when}}. See you there.",
  ),
  plain(
    "gathering.guest_confirm",
    "Confirm your place at {{gathering.title}}",
    "You asked to come to {{gathering.title}} on {{gathering.when}}. Confirm with the link below and your place is held.",
  ),
  plain(
    "gathering.reminder_day",
    "{{gathering.title}} is tomorrow",
    "See you {{gathering.when}} at {{gathering.where}}.",
  ),
  plain(
    "gathering.reminder_soon",
    "{{gathering.title}} starts soon",
    "{{gathering.title}} starts at {{gathering.when}}, at {{gathering.where}}.",
  ),
  plain(
    "gathering.changed",
    "{{gathering.title}} has changed",
    "{{gathering.title}} is now {{gathering.when}} at {{gathering.where}}.",
  ),
  plain(
    "gathering.cancelled",
    "{{gathering.title}} is off",
    "{{gathering.title}} on {{gathering.when}} will not happen. We are sorry to miss you.",
  ),
  plain(
    "gathering.waitlisted",
    "You are on the waitlist for {{gathering.title}}",
    "{{gathering.title}} is full. You are on the waitlist, and we will write the moment a seat opens.",
  ),
  plain(
    "gathering.promoted",
    "A seat opened at {{gathering.title}}",
    "A seat opened at {{gathering.title}} on {{gathering.when}}, and it is yours.",
  ),
  plain(
    "gathering.host_nudge",
    "How did {{gathering.title}} go?",
    "Write the recap for {{gathering.title}} while it is fresh. The people who came will hear from you.",
  ),
  plain(
    "gathering.recap_came",
    "{{gathering.title}}: what we did",
    "Thank you for coming to {{gathering.title}}.\n\n{{recap.body}}",
  ),
  plain(
    "gathering.recap_missed",
    "{{gathering.title}}: what you missed",
    "We missed you at {{gathering.title}}.\n\n{{recap.body}}",
  ),

  // ── Time polls ──────────────────────────────────────────────────────────
  plain(
    "poll.invite",
    "Help pick a time for {{gathering.title}}",
    "Tick every time you can make for {{gathering.title}}.\n\n{{poll.options}}",
  ),
  plain(
    "poll.locked",
    "{{gathering.title}} is set for {{gathering.when}}",
    "The vote is in. {{gathering.title}} is on {{gathering.when}}.",
  ),
  plain(
    "poll.moved",
    "{{gathering.title}} moved to {{gathering.when}}",
    "The village voted, and {{gathering.title}} now meets {{gathering.when}}.",
  ),

  // ── Paths ───────────────────────────────────────────────────────────────
  ...DEFAULT_PATH_IDS.flatMap((id) => pathTemplates(id)),

  // ── Joining and membership ──────────────────────────────────────────────
  plain(
    "member.welcome.day0",
    "Welcome to {{village.name}}",
    "Hi {{person.firstName}}, your account is ready. Here is where to start.",
  ),
  plain(
    "member.welcome.first_quest",
    "Your first quest",
    "A quest is the simplest way to start. Pick one that suits you.",
  ),
  plain(
    "member.welcome.meet_us",
    "Come and meet us",
    "The next gathering is a good place to say hello.",
  ),
  plain(
    "member.welcome.check_in",
    "Two weeks in",
    "Hi {{person.firstName}}, how are your first two weeks going? Reply to this email and a person will write back.",
  ),
  plain(
    "joining.received",
    "We have your request to join {{village.name}}",
    "Thank you for asking to join. A person will read your request and write back.",
  ),
  plain(
    "joining.meet_us",
    "Come and meet us",
    "While your request is read, come to a gathering and meet the people here.",
  ),
  plain(
    "joining.check_in",
    "Your request to join {{village.name}}",
    "We still have your request. Reply to this email with any question and a person will answer.",
  ),

  // ── Letters and consent ─────────────────────────────────────────────────
  plain(
    "letters.confirm",
    "Confirm you want letters from {{village.name}}",
    "Press the link below to start getting letters from {{village.name}}. If you did not ask for them, you can ignore this email.",
  ),
  plain("letter.layout", "{{village.name}}", "{{letter.body}}"),
];

export const DEFAULT_TEMPLATES_BY_KEY: Readonly<Record<string, DefaultTemplate>> = Object.fromEntries(
  DEFAULT_TEMPLATES.map((t) => [t.key, t]),
);

/** The platform default for a key, or null when the platform has none. */
export function defaultTemplate(key: string): DefaultTemplate | null {
  return DEFAULT_TEMPLATES_BY_KEY[key] ?? null;
}
