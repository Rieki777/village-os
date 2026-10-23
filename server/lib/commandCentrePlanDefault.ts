/**
 * THE COMMAND CENTRE'S DEFAULT PLAN: the build plan the tracker shipped with
 * until 2026-10-22, word for word, with every id it already had.
 *
 * Those ids are the keys `journey-state` stores ticks, kanban cards, notes and
 * decision answers under, so a village whose plan was never edited reads
 * exactly this and its stored state keeps matching. The first save writes the
 * whole plan into the document, after which this default no longer applies to
 * that village.
 *
 * IT LIVES ON THE SERVER ON PURPOSE. Compiled into the page, it shipped in a
 * lazy chunk any stranger can download (server/trackerPrivacy.test.ts holds
 * why that matters). Here it reaches a browser only through the admin-gated
 * `GET /api/journey/state`.
 *
 * `{village}` is filled with the village's own name at render
 * (shared/pageContent/resolve.ts `fillVars`), the way the compiled plan used
 * to interpolate it. The VILLAGE_OWNED rows used to carry a brand prefix in
 * their text as well; that prefix came out before this move and the owner
 * pill says it instead.
 */
import {
  VILLAGE_OWNED,
  type CommandCentrePlan,
} from "../../shared/commandCentrePlan";

const V = VILLAGE_OWNED;

export const DEFAULT_COMMAND_CENTRE_PLAN: CommandCentrePlan = {
  revision: 0,
  intro:
    "It holds the original build tracker: the six weeks that made this site, kept whole.",
  partnerName: "ReGen",
  weeks: [
    {
      id: "w1",
      label: "Week 1 | Mar 17-23",
      goal: "Build the Village Steward and Resident co-creator journeys from end to end. Get all linked pages, CTAs, and interactive elements working.",
      tasks: [
        {
          id: "w1-1",
          text: "Landing page - full copy and structure (welcome section, 5 journey paths)",
          status: "done",
        },
        {
          id: "w1-2",
          text: "Landing page - Attend, Experience, Co-Create, Integrate, Commit flow written and laid out",
          status: "done",
        },
        {
          id: "w2-17",
          text: "Pages: Investor, Village Steward, Resident, How We Create, Quests - copy delivered",
          status: "done",
        },
        {
          id: "w2-1",
          text: "Village Steward Space - Rights and Responsibilities page linked and drafted",
          status: "done",
        },
        {
          id: "w2-2",
          text: "Village Steward Journey - Community Connection Calls CTA live",
          status: "pending",
        },
        {
          id: "w2-3",
          text: "Village Steward Journey - Potluck, Events, Workshops, Village Weaving links live",
          status: "pending",
        },
        {
          id: "w2-6",
          text: "Village Steward Journey - Explore Quests section linked",
          status: "pending",
        },
        {
          id: "w2-7",
          text: "Village Steward Journey - {village} Game Guide linked (Roles, Co-Creator criteria)",
          status: "pending",
        },
        {
          id: "w2-8",
          text: "Village Steward Journey - Role Application for Upcoming Season CTA live",
          status: "pending",
        },
        {
          id: "w2-9",
          text: "Resident Space - Rights and Responsibilities page linked and drafted",
          status: "done",
        },
        {
          id: "w2-10",
          text: "Resident Journey - Community Call and Discovery Call CTA live",
          status: "pending",
        },
        {
          id: "wt-1",
          text: "Decision needed - name the community contribution token (currently 'Gratitude'): tracks contributions to be resolved as debt, equity, or community currency, with a percentage split for early contributors",
          status: V,
        },
        {
          id: "w1-6",
          text: "Provide brand kit assets (colors, fonts, logos)",
          status: V,
        },
      ],
    },
    {
      id: "w2",
      label: "Week 2 | Mar 24-30",
      goal: "Build the Roles and Circles infrastructure. Publish the {village} Game Guide as a navigable resource. Wire all governance links and role application flows.",
      tasks: [
        {
          id: "w4-11",
          text: "Pages: Governance Roles, Circles, Team - copy delivered",
          status: "done",
        },
        {
          id: "w4-1",
          text: "{village} Game Guide - published as linked resource with Co-Creator criteria section",
          status: "pending",
        },
        {
          id: "w4-2",
          text: "Roles section - all initial roles documented (Community Engagement, Land Liaison, Marketing, Operations, Visionary, Financial Mgmt)",
          status: "pending",
        },
        {
          id: "w4-3",
          text: "Investor Journey - Request Investor Pack drop-down and Pack created",
          status: "pending",
        },
        {
          id: "w4-4",
          text: "Circles section - Explore Roles page complete",
          status: "pending",
        },
        {
          id: "w2-18",
          text: "Circles cards - all role titles, descriptions, and links accurate",
          status: "pending",
        },
        {
          id: "w4-5",
          text: "Co-Creator Right of Passage - description and process documented and live",
          status: "pending",
        },
        {
          id: "w4-6",
          text: "Seasonal Festivals - description page live",
          status: "pending",
        },
        {
          id: "w4-7",
          text: "Guide and Sage progression - criteria and Voice gains documented",
          status: "pending",
        },
        {
          id: "w4-8",
          text: "Resident progression stages - documented with year thresholds",
          status: "pending",
        },
        {
          id: "w4-10",
          text: "All internal hyperlinks audit - every bold link in all 4 journeys verified as working",
          status: "pending",
        },
        {
          id: "w1-4",
          text: "Roles section - role application workflow live",
          status: "pending",
        },
        {
          id: "am-7",
          text: "Add Hypha page link to How We Create and Co-Creators Guide",
          status: "pending",
        },
        {
          id: "am-8",
          text: "Launch all Hypha tools - governance platform live and linked from site",
          status: "pending",
        },
        {
          id: "w4-12",
          text: "Finalize Role descriptions and Season structure for publication",
          status: "collab",
        },
        {
          id: "am-2",
          text: "Complete the investor memo for the landholder - terms, vision, and deal structure written and ready to share",
          status: "collab",
        },
        {
          id: "am-3",
          text: "Establish the ministry - 508(c)(1)(a) structure formalised and membership framework confirmed",
          status: "collab",
        },
      ],
    },
    {
      id: "w3",
      label: "Week 3 | Mar 31-Apr 6",
      goal: "Deliver and wire the community identity pages - Love Letter, Co-Creators Guide, Good Neighbor, and Seasonal Festivals. Get all membership flows and CTAs live.",
      tasks: [
        {
          id: "w1-5",
          text: "Pages: Home, Love Letter, Co-Creators Guide, Good Neighbor - copy delivered",
          status: "done",
        },
        {
          id: "w1-3",
          text: "Investor Journey - Schedule a Call drop-down and CTA button wired up",
          status: "pending",
        },
        {
          id: "w2-4",
          text: "Village Steward Journey - Village Weaving Immersion description and CTA live",
          status: "pending",
        },
        {
          id: "w2-12",
          text: "Love Letter membership page linked (Steward and Resident journeys)",
          status: "pending",
        },
        {
          id: "w2-15",
          text: "Resident Journey - Good Neighbor criteria linked",
          status: "pending",
        },
      ],
    },
    {
      id: "w4",
      label: "Week 4 | Apr 7-13",
      goal: "Complete the Investor and Prosperity Creator journeys with all supporting content, interactive elements, and linked resources in place.",
      tasks: [
        {
          id: "w3-5",
          text: "Pages: Prosperity Journey - copy delivered",
          status: "done",
        },
        {
          id: "w3-1",
          text: "Investor Journey - full financial details and CTA flow complete",
          status: "pending",
        },
        {
          id: "w3-2",
          text: "Investor Journey - Request Investor Pack drop-down and CTA wired up",
          status: "pending",
        },
        {
          id: "w3-3",
          text: "Prosperity Journey - full ARI tier details and business paths documented",
          status: "pending",
        },
        {
          id: "w3-4",
          text: "Prosperity Journey - business proposal submission flow live",
          status: "pending",
        },
        {
          id: "w3-6",
          text: "Confirm ARI tiers and Voice allocations for Prosperity journey",
          status: "collab",
        },
        {
          id: "w3-7",
          text: "Confirm Investor Pack structure and financial projections",
          status: "collab",
        },
        {
          id: "am-1",
          text: "Complete token design - name, function, and economic rules for the community contribution token (currently 'Gratitude') finalised",
          status: "collab",
        },
        {
          id: "am-4",
          text: "Secure the land + clear agreement with the landholder - ownership or access terms signed and confirmed",
          status: "collab",
        },
        {
          id: "am-5",
          text: "Regen Development Fund path clear - funding vehicle, terms, and first close strategy confirmed",
          status: "collab",
        },
        {
          id: "am-6",
          text: "Business plan clear and complete - full plan covering operations, revenue model, and development phases ready to share",
          status: "collab",
        },
        {
          id: "w2-19",
          text: "Deliver Investor Pack content (terms, structure, documents)",
          status: "collab",
        },
      ],
    },
    {
      id: "w5",
      label: "Week 5 | Apr 14-20",
      goal: "Polish all pages, complete event CTAs. If the retainer is confirmed, begin scoping the backend and CRM integration. Final content review with the {village} team.",
      tasks: [
        {
          id: "w5-10",
          text: "Pages: Master Plan, Opportunities, Housing - copy delivered",
          status: "done",
        },
        {
          id: "w2-11",
          text: "Resident Journey - Housing Options page linked",
          status: "pending",
        },
        {
          id: "w2-13",
          text: "Resident Journey - Waitlist sign-up and $NNN/month fee placeholder live",
          status: "pending",
        },
        {
          id: "w2-14",
          text: "Resident Journey - Children's Play Day CTA live",
          status: "pending",
        },
        {
          id: "w2-16",
          text: "Resident Journey - Land Share Agreement page linked",
          status: "pending",
        },
        {
          id: "w5-1",
          text: "Events section - Potluck, Village Weaving, Land Tour, Children's Play Day CTAs live",
          status: "pending",
        },
        {
          id: "w5-2",
          text: "Webinar section - slide show, email flow, recording share process documented",
          status: "pending",
        },
        {
          id: "w5-3",
          text: "Email nurture flow - basic flow outlined and handed off or implemented in CRM",
          status: "pending",
        },
        {
          id: "w5-4",
          text: "Social media - post structure and follow-up structure documented",
          status: "pending",
        },
        {
          id: "w5-5",
          text: "Love Letter page - final design and membership dues confirmed",
          status: "pending",
        },
        {
          id: "w5-6",
          text: "Waitlist page - final design and fee structure confirmed",
          status: "pending",
        },
        {
          id: "w5-7",
          text: "Mobile responsiveness - full site tested on mobile",
          status: "pending",
        },
        {
          id: "w5-8",
          text: "Content audit - all placeholder values resolved by {village}",
          status: "pending",
        },
        {
          id: "w5-9",
          text: "Backend and CRM scoping - if retainer confirmed, spec document drafted",
          status: "pending",
        },
        {
          id: "w5-11",
          text: "Final content approval pass (all journeys, roles, game guide)",
          status: V,
        },
        {
          id: "w5-12",
          text: "Confirm retainer decision for ongoing updates and CRM build",
          status: V,
        },
      ],
    },
    {
      id: "w6",
      label: "Week 6 | Apr 21-28",
      goal: "Complete final quality checks, fix any remaining issues, and deliver a fully functional site. If not on retainer, make sure {village} has full admin access before the engagement ends.",
      tasks: [
        {
          id: "w6-1",
          text: "Full site QA - all pages, links, forms, and drop-downs tested",
          status: "pending",
        },
        {
          id: "w6-2",
          text: "Bug fixes - all outstanding visual and functional issues resolved",
          status: "pending",
        },
        {
          id: "w6-3",
          text: "Cross-browser test - Chrome, Safari, Firefox verified",
          status: "pending",
        },
        {
          id: "w6-4",
          text: "{village} admin access - site control transferred if not on retainer",
          status: "pending",
        },
        {
          id: "w6-5",
          text: "Handoff documentation - editing guide delivered to the {village} team",
          status: "pending",
        },
        {
          id: "w6-6",
          text: "LAUNCH - site goes live for interested parties",
          status: "pending",
        },
        {
          id: "w6-7",
          text: "Post-launch check-in call scheduled",
          status: "pending",
        },
        {
          id: "w6-8",
          text: "Retainer and next-phase agreement signed (if continuing)",
          status: "pending",
        },
      ],
    },
  ],
  decisions: [
    {
      id: "dec-token-name",
      title: "Name the community contribution token",
      description:
        "The token currently called 'Gratitude' needs a final name. It tracks contributions that will later be resolved as debt, equity, or community currency, with a percentage split for early contributors.",
      linkedItem: "wt-1",
      options: ["Gratitude", "Seeds", "Roots", "Sparks", "Threads", "Commons"],
    },
    {
      id: "dec-token-design",
      title: "Token economic design",
      description:
        "Define the full economic rules: percentage splits for debt vs equity vs community currency, conversion ratios, and how tokens will be distributed to early contributors.",
      linkedItem: "am-1",
      options: [],
    },
    {
      id: "dec-ministry",
      title: "Ministry structure and membership framework",
      description:
        "Confirm the 508(c)(1)(a) structure details, membership tiers, and how the ministry framework integrates with village governance and the legal entity.",
      linkedItem: "am-3",
      options: [],
    },
    {
      id: "dec-investor-memo",
      title: "Investor memo structure and terms",
      description:
        "Finalize the investor memo for the landholder: investment structure, debt vs equity ratios, interest rates, IRR projections, and Phase 1 raise target.",
      linkedItem: "am-2",
      options: [],
    },
    /*
     * This entry's id changed before the plan became data. It used to be the
     * landholder's first name, which put a private counterparty into every
     * downloaded copy of the page's chunk. Anything recorded under the old id
     * still renders under "Carried over" on the Decisions view.
     */
    {
      id: "dec-land-agreement",
      title: "Land agreement with the landholder",
      description:
        "Confirm the ownership or access terms with the landholder, including conditions, timelines, and contingencies that affect the development plan.",
      linkedItem: "am-4",
      options: [],
    },
    {
      id: "dec-regen-fund",
      title: "Regen Development Fund vehicle",
      description:
        "Confirm the legal vehicle, contribution terms, and first close strategy for the Regen Development Fund.",
      linkedItem: "am-5",
      options: [],
    },
    {
      id: "dec-ari-tiers",
      title: "ARI tier names and criteria",
      description:
        "Define the {village} Regenerative Impact tier system: names, specific metrics, Voice allocations, and how businesses progress through tiers.",
      linkedItem: "w3-6",
      options: [],
    },
    {
      id: "dec-roles",
      title: "Role descriptions and Season structure",
      description:
        "Finalize all initial role descriptions (Community Engagement, Land Liaison, Marketing, Operations, Visionary, Financial Management) and the Season structure.",
      linkedItem: "w4-12",
      options: [],
    },
    {
      id: "dec-resident-dues",
      title: "Monthly resident dues amount",
      description:
        "Confirm the monthly dues amount that covers HOA, utilities, maintenance, and community services (currently shown as $NNN/month on site).",
      linkedItem: "w2-13",
      options: [],
    },
    {
      id: "dec-retainer",
      title: "Retainer and next-phase agreement",
      description:
        "Decide whether to continue on retainer for ongoing updates and CRM build after the initial 6-week engagement.",
      linkedItem: "w5-12",
      options: [],
    },
  ],
};
