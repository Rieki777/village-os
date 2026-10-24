/**
 * The homepage (brochure villages), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, so switching the page onto this spec changes nothing a
 * visitor sees. A village replaces them in Admin, Pages, Home.
 *
 * LIMITS were set from the layout, not the current copy: each is what its box
 * holds at 375px and at 1280px before it wraps into something that no longer
 * looks designed. The headline is the tightest (text-5xl on a phone, about
 * twelve characters a line).
 */
import type { PageSpec } from "./types";

export const HOME_PATH_IDS = ["investor", "steward", "resident", "prosperity"] as const;

export const HOME_PAGE: PageSpec = {
  id: "home",
  label: "Home",
  path: "/",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The first thing a visitor sees, over your homepage picture.",
      fields: [
        {
          key: "badge",
          label: "Small label above the headline",
          help: "A few words in a rounded pill. Leave blank for none.",
          kind: "text",
          max: 32,
          default: "",
          optional: true,
        },
        {
          key: "headline",
          label: "Headline",
          help: "The biggest words on the site. {tagline} is your Tagline from Identity, so changing it there changes it here.",
          kind: "text",
          max: 48,
          default: "{tagline}",
        },
        {
          key: "highlight",
          label: "Word to show in gold",
          help: "A word or phrase from the headline, exactly as it appears there. Leave blank for none.",
          kind: "text",
          max: 24,
          default: "Beautiful",
          optional: true,
        },
        {
          key: "subline",
          label: "Sentence under the headline",
          help: "{in-location} becomes \" in\" plus your Location, or nothing when Location is blank. Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 200,
          default: "A regenerative village{in-location} where all beings **belong** and **thrive**. Start here: pick your path.",
        },
      ],
    },
    {
      id: "journey",
      label: "From first visit to home",
      shows: "The row of stages just under the top of the page.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "From First Visit to Home" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 220,
          default:
            "Each stage is a chance to get to know each other. You figure out if {village} fits your life; we figure out if you're a good fit for the village.",
        },
      ],
      lists: [
        {
          key: "stages",
          label: "Stages",
          help: "Three to six, read left to right. Each gets the next icon in a fixed set.",
          itemLabel: "Stage",
          titleKey: "name",
          minItems: 1,
          maxItems: 6,
          fields: [
            { key: "name", label: "Name", kind: "text", max: 16, default: "" },
            { key: "description", label: "Short line", kind: "text", max: 28, default: "" },
          ],
          default: [
            { name: "Align", description: "Discover our values" },
            { name: "Experience", description: "Visit & participate" },
            { name: "Co-Create", description: "Join our circles" },
            { name: "Integrate", description: "Become a member" },
            { name: "Home", description: "Make it home" },
          ],
        },
      ],
    },
    {
      id: "paths",
      label: "Choose your path",
      shows: "The four picture cards, each leading to its journey page.",
      hideable: true,
      fields: [
        { key: "eyebrow", label: "Small label above the heading", kind: "text", max: 32, default: "What brought you here?" },
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Choose your path" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Four ways into {village}. Pick the one that fits you today. You can add more later.",
        },
      ],
      lists: [
        {
          key: "cards",
          label: "Cards",
          help: "One per journey page, in this order. The pictures are set in Make This Yours, Pictures.",
          itemLabel: "Card",
          titleKey: "title",
          fixed: HOME_PATH_IDS,
          maxItems: 4,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 22, default: "" },
            { key: "subtitle", label: "Second line beside the title", kind: "text", max: 24, default: "" },
            { key: "description", label: "Description", kind: "long", max: 170, default: "" },
          ],
          default: [
            {
              title: "Investor",
              subtitle: "Capital Contributor",
              description:
                "Plant capital in a project built to last. The village grows, community ownership stays intact, and returns and values move in the same direction.",
            },
            {
              title: "Village Steward",
              subtitle: "Co-Creator",
              description: "Hold a role, join a circle, and keep the whole village running.",
            },
            {
              title: "Resident",
              subtitle: "Co-Creator",
              description: "Make {village} your home. Find a place to live, join the waitlist, and belong.",
            },
            {
              title: "Prosperity Creator",
              subtitle: "Business Builder",
              description: "Launch or grow your business inside the village, and share in what you build.",
            },
          ],
        },
      ],
    },
    {
      id: "personas",
      label: "Who comes here",
      shows: "The cards describing the kinds of people your village draws.",
      hideable: true,
      fields: [
        { key: "eyebrow", label: "Small label above the heading", kind: "text", max: 32, default: "People like you" },
        { key: "heading", label: "Heading", kind: "text", max: 48, default: "Who Comes to {village}?" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 180,
          default: "{village} attracts people who are done half-living. Here are some of the souls who find their way here.",
        },
        {
          key: "footer",
          label: "Line under the cards",
          kind: "text",
          max: 90,
          default: "See yourself here? There's a path with your name on it.",
        },
      ],
      lists: [
        {
          key: "items",
          label: "People",
          help: "Up to nine. Each gets the next icon and colour in a fixed set.",
          itemLabel: "Person",
          titleKey: "label",
          maxItems: 9,
          fields: [
            { key: "label", label: "Who they are", kind: "text", max: 32, default: "" },
            { key: "tagline", label: "In their own words (shown in quotes)", kind: "text", max: 60, default: "" },
            { key: "body", label: "Description", kind: "long", max: 220, default: "" },
          ],
          default: [
            {
              label: "Digital Nomad Couple",
              tagline: "We want roots without walls.",
              body: "Location-independent professionals ready to stop bouncing between Airbnbs and plant themselves somewhere with depth, community, and a reason to stay.",
            },
            {
              label: "Worldschooling Family",
              tagline: "Our kids deserve a village.",
              body: "Families who want their children raised by a community, surrounded by nature, multi-generational wisdom, and real-world learning instead of a system.",
            },
            {
              label: "Retiree & Snowbird",
              tagline: "Finally, a second chapter worth living.",
              body: "Post-career dreamers who want warmth, beauty, belonging, and a role that still matters, not a golf course.",
            },
            {
              label: "Longevity Seeker",
              tagline: "I want to live well, not just long.",
              body: "Health-conscious individuals chasing clean air, organic food, movement, community, and purpose as medicine: building a life designed to thrive.",
            },
            {
              label: "Remote Exec & Founder",
              tagline: "I built the life. Now I want meaning.",
              body: "High-achievers who want their next chapter to matter: contributing capital, skills, or leadership to something regenerative and lasting.",
            },
            {
              label: "Regional Changemaker",
              tagline: "I want to build something here.",
              body: "Local and regional changemakers who see {village} as the proving ground for a regenerative future in their own part of the world, and want to help shape it.",
            },
          ],
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The last section of the page. Its buttons go to your Events page URL and hide when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 48, default: "Ready to Begin Your Journey?" },
        {
          key: "body",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "Join our next community call to learn about the basics and ask any questions. It's the perfect first step on any path.",
        },
        { key: "primaryLabel", label: "First button", kind: "text", max: 28, default: "Join Community Call" },
        {
          key: "secondaryLabel",
          label: "Second button",
          help: "Leave blank for one button.",
          kind: "text",
          max: 28,
          default: "View All Events",
          optional: true,
        },
      ],
    },
  ],
};
