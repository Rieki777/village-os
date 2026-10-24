/**
 * "DESIGN MY ROLE WITH MY OWN AI": the copy-and-paste prompt (Rye,
 * 2026-10-24), versioned and deterministic. The same inputs always give the
 * same prompt, word for word.
 *
 * A member copies it into whatever AI they use. It tells that AI every
 * heading of the role card format (shared/roleCardText.ts) and its limit in
 * plain words, shows the founder's own card as the worked example, has the AI
 * interview the member one question at a time about anything missing, and
 * makes its last reply one role card and nothing else. The member pastes that
 * reply back into "Bring in a description of your role", and the one reader
 * fills their proposal.
 *
 * THE WORKED EXAMPLE IS THE FOUNDER'S CARD, written by `writeRoleCard` from
 * the data below, so the example is in the format by construction and can
 * never drift from what the reader reads. People are named by their role
 * ("the founder", "the Operations role"), per Rye's rule. The village's own
 * name is a parameter, so a village running this platform under another
 * name sees its own name in the example and in the header.
 *
 * Bump `ROLE_CARD_PROMPT_VERSION` whenever the words change.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { MAX_PROPOSAL_ROLES } from "./roleProposals";
import { ROLE_CARD_FIELDS, roleCardHeader, writeRoleCard, type RoleCardDoc } from "./roleCardText";

export const ROLE_CARD_PROMPT_VERSION = 1;

/** The circle the worked example's roles sit in. */
export const EXAMPLE_CIRCLE = "General Coordinating Circle";

/** The village goals the worked example serves, as that season wrote them. */
export const EXAMPLE_ORG_GOALS = ["Clear organisation and governance structures", "A thriving community: potlucks, calls and land tours", "Investor ready"] as const;

/**
 * THE FOUNDER'S CARD, three roles in one proposal, as approved on 2026-10-22
 * and drafted on production on 2026-10-23 (the seating authority split in
 * two lines to keep each under 200 characters). `v` is the village's name.
 */
export function workedExample(v: string): RoleCardDoc {
  return {
    village: v,
    roles: [
      {
        title: "Human Operations & Onboarding Lead Steward",
        circle: EXAMPLE_CIRCLE,
        words: {
          aim: `Everyone who comes to ${v} finds a clear way in and a role that fits.`,
          existsWhile: "people are still arriving and need a clear way in. Once onboarding runs on its own through the guide and the runbooks, this role folds into the others.",
          domain: "The onboarding process: how a newcomer is welcomed, invited and helped into a role. The circle decides who joins.",
          authorities: ["Manage applicant onboarding, intake workflows and role invitations.", "Front operations questions in investor and partner discussions."],
          accountabilities: [
            "The applicant pipeline, role invitations and community intake, designed and run.",
            "Coaching circle members on sociocratic process and governance.",
            "Operational facilitation, and fronting operations questions on team, investor and partner calls and community inquiries.",
            "Matching applicants and members to roles that fit.",
          ],
          responsibilities: ["Answer role applications within 2 business days.", "Run onboarding calls with newcomers.", "Front operations questions on team, investor and partner calls."],
          bringMe: ["Someone who wants to join or help.", "A role that needs a person.", "A team member stuck on how we decide."],
          notMine: ["Hiring or onboarding anyone without a consent process, binding legal or financial commitments, and holding bank or escrow credentials"],
          signsStretched: "Applications waiting longer than 2 business days. Newcomers going quiet after their first week.",
          flowsBack: "A first fit by feel from the founder before hand-off. Runbooks and the intake agent from the Operations role.",
          stepBack: "Name it at the Friday check-in. Onboarding calls pause before anything else does.",
          timeCommitment: "Part of a full-time season",
        },
      },
      {
        title: "Front-End & Game Platform Steward",
        circle: EXAMPLE_CIRCLE,
        words: {
          aim: `Members see ${v} clearly and play it from one place.`,
          existsWhile: `members need one place to see and play ${v}. Once the platform has a team keeping it, this role narrows to stewardship.`,
          domain: "How the app looks and plays, and how a newcomer's way in works inside it.",
          authorities: ["Lead front-end interface development and game platform integrations.", "Ship changes to how the app looks and plays, through reviewed releases."],
          accountabilities: [
            "The front end and the community interface that reduces our reliance on WhatsApp.",
            "Integration with Saberra's memory and agents, on the front-end side.",
            "The org chart, role proposals and game mechanics showing accurately for members.",
            "Game design, member interactions and front-end development.",
            `The ${v} guide, the assistant that welcomes players into the app.`,
          ],
          responsibilities: [
            "Release fixes and features, and check the live site after each one.",
            "Bring what members say about the app to the Monday meeting.",
            "Keep the org chart and role proposals showing accurately.",
          ],
          bringMe: [`Something on ${v} that is confusing or broken.`, "An idea for the game or the app.", "Anything the org chart shows wrong."],
          notMine: ["Sole administrator or IT help desk", "back end, database and hosting (the Operations role)"],
          signsStretched: "Fixes waiting more than a week. Releases skipping review.",
          flowsBack: "Back end and memory from the Operations role. Priorities and data handling approvals from the founder.",
          stepBack: "New features pause before fixes do. Name it at the Friday check-in.",
          timeCommitment: "Part of a full-time season",
        },
      },
      {
        title: "Organizational Design & Governance Facilitator",
        circle: EXAMPLE_CIRCLE,
        words: {
          aim: `${v}'s structure is written down, consented to and held by more than one person.`,
          existsWhile: `${v}'s structure is still being written down and taught. Once every circle keeps its own charter by consent, this role becomes a light review.`,
          domain: "The shape of circle charters and role cards put forward for consent, and how circle syncs run.",
          authorities: [
            "Draft and propose governance documents, role cards and circle charters for team consent.",
            "Facilitate circle syncs and coach team members on self-organisation.",
            "Record role changes and publish chart changes after the circle consents, shared with the Operations role and the founder's role.",
            "Act alone only to fix an error, and bring it to the circle at its next meeting. Never approve its own holder.",
          ],
          accountabilities: [
            "Co-designing governance structures, circle charters and role cards with the Operations role and the founder.",
            "Facilitating the Monday full team meeting, alternating with the Operations role.",
            "Facilitation and meeting tools: agendas, consent rounds and decision records the team uses in every call.",
          ],
          responsibilities: [
            "Facilitate the Monday full team meeting, alternating with the Operations role.",
            "Review role and circle drafts within 2 business days.",
            "Coach circle members on consent decision making.",
          ],
          bringMe: ["A tension about who decides what.", "A new role or circle someone wants.", "A role card that needs writing or reviewing."],
          notMine: ["Investor relationships (the founder's role)", "books, tax, legal advice and filings (professionals)"],
          signsStretched: "Drafts waiting longer than 2 business days. Meetings running without an agenda or recorded decisions.",
          flowsBack: "Co-facilitation from the Operations role. Consent from the team on every draft.",
          stepBack: "Hand a facilitation to the Operations role. Name it at the Friday check-in.",
          timeCommitment: "Part of a full-time season",
        },
      },
    ],
    measures: [
      "New members active within 7 days.",
      "Role applications answered within 2 business days.",
      "Season plans filed.",
      `Members active on ${v} this moon.`,
      "Community quests claimed and finished through the app.",
      "Roles with a full card and a term.",
      "Chart drafts reviewed within 2 business days.",
      "Gatherings held on time, decisions recorded.",
    ],
    season: {
      aim: `Every person who arrives at ${v} finds a clear way in and a role that fits, every human role has a ratified card, and the structure is held by more than one person.`,
      seasonalGoals: [
        {
          title: "Ready to grow the team to 30",
          doneWhen: `Onboarding, memory, roles and governance can take in 30 people: a clear way in for each newcomer, team memory they can find and add to, every role with a card and a holder or an open invitation, and decisions made and recorded in ${v}.`,
        },
      ],
      servesGoals: [
        { goal: EXAMPLE_ORG_GOALS[0], howItHelps: "every role written down, consented to and reviewed on time." },
        { goal: EXAMPLE_ORG_GOALS[1], howItHelps: "newcomers become active members within a week." },
        { goal: EXAMPLE_ORG_GOALS[2], howItHelps: "operations questions answered on investor calls, and the org chart ready to show." },
      ],
    },
  };
}

export interface RoleCardPromptInput {
  /** The village's name, as the header and the example print it. */
  village: string;
  /** The village's live circles, by name. */
  circles: readonly string[];
  /** The goals of the season the proposal is for, as written. Empty when none are set. */
  orgGoals: readonly string[];
  /** The member's card as it stands, written by `writeRoleCard`, so the AI starts from what the village knows. */
  knownCard?: string | null;
  /** At most this many roles in one proposal. */
  maxRoles?: number;
}

const list = (xs: readonly string[]) => xs.map((x) => x.trim()).filter(Boolean).join("; ");

/** THE PROMPT, word for word. PURE. */
export function roleCardPrompt(input: RoleCardPromptInput): string {
  const v = input.village.trim() || "the village";
  const header = roleCardHeader(input.village.trim() || null);
  const max = input.maxRoles ?? MAX_PROPOSAL_ROLES;
  const circles = list(input.circles);
  const goals = list(input.orgGoals);
  const spec = (key: string) => ROLE_CARD_FIELDS.find((f) => f.key === key)!;
  const line = (level: "##" | "###", key: string, extra = "") => `${level} ${spec(key).heading}\n   ${spec(key).limit}${extra ? ` ${extra}` : ""}`;
  const known = input.knownCard && input.knownCard.trim() ? input.knownCard.trim() : null;

  return [
    `Role card prompt, version ${ROLE_CARD_PROMPT_VERSION}, for ${v}.`,
    "",
    `You are helping one member of ${v} write the card for the role or roles they will hold next season. ${v} reads one format, the role card, version 1, and fills the member's role proposal from it directly. Your last reply must be one role card in that format and nothing else.`,
    "",
    "HOW TO WORK",
    "1. Read what the member gives you: a description of their role, notes, an old job description, or nothing yet.",
    "2. Fill every heading you can from it. Keep the member's own words where you can, in plain language.",
    "3. Then ask about anything missing or unclear, ONE question at a time, and wait for each answer before the next. Ask in plain words, for example: What can you decide on your own, without asking anyone?",
    "4. When every heading has an answer, or the member says they are done, reply with the card and nothing else. No greeting, no notes, no code fence.",
    "",
    "THE RULES",
    `- Name the role, never the person. Write "the founder" or "the Operations role", never a person's name. If the member names someone, write the title of the role that person holds, and ask the member for it if you do not know it.`,
    "- Never write bank, card or account numbers anywhere in the card.",
    "- Plain words and short sentences. Join phrases with commas or full stops, never with long dashes.",
    "- Keep to the limits below. When something runs over, ask the member which parts matter most.",
    `- One "## Role title" section for each role, at most ${max} roles.`,
    '- A list is lines that each start with "- ", one item per line.',
    "- Leave out a heading you have nothing for. A heading left out keeps what the village already holds.",
    '- A role the village already knows has a "Role id:" line under its title. Keep that line exactly as it is, and never write one yourself.',
    "",
    "THE FORMAT",
    "The card starts with this line, exactly:",
    header,
    "",
    "Then, for each role, these headings in this order:",
    line("##", "name"),
    line("###", "circle", circles ? `The village's circles are: ${circles}.` : ""),
    line("###", "aim"),
    line("###", "existsWhile", 'Write only the end of the sentence, starting in lower case, for example: people are still arriving and need a clear way in.'),
    line("###", "domain"),
    line("###", "authorities"),
    line("###", "accountabilities"),
    line("###", "responsibilities"),
    line("###", "bringMe"),
    line("###", "notMine"),
    line("###", "signsStretched"),
    line("###", "flowsBack"),
    line("###", "stepBack"),
    line("###", "timeCommitment"),
    "",
    "After the last role, once for all of them:",
    line("##", "measures"),
    "",
    "Then the member's own season:",
    "## My season",
    line("###", "seasonAim"),
    line("###", "seasonalGoals", 'Write each goal as "- " and its title, with "  Done when: " on the next line.'),
    line(
      "###",
      "servesGoals",
      goals
        ? `Next season's goals are: ${goals}. Write each one exactly as it is written here, with "  How it helps: " on the next line.`
        : "The village has not set next season's goals yet, so leave this heading out.",
    ),
    "",
    ...(known
      ? ["WHAT THE VILLAGE ALREADY KNOWS", "This is the member's card as it stands. Start from it, and change only what the member wants changed:", "", known, ""]
      : []),
    "A WORKED EXAMPLE",
    `This is a real card from ${v}, in the format, for three roles one person holds. Its season served these goals: ${list(EXAMPLE_ORG_GOALS)}.`,
    "",
    writeRoleCard(workedExample(v)).trim(),
    "",
    "Begin by asking the member to share their role description, or by asking your first question.",
  ].join("\n");
}
