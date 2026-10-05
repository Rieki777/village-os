import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeEmail, type EmailVillage } from "../letterHtml";
import { fieldProblems, kindForTemplate, sampleValues, type MergeValues } from "../mergeFields";
import { voiceLint, voiceLintWords } from "../voiceLint";
import {
  DEFAULT_TEMPLATES,
  genericPathTemplate,
  PATH_STEP_KEYS,
  platformTemplate,
  templateGroups,
  WHY_YOU_GOT_THIS,
  type DefaultTemplate,
} from "./templates";

/**
 * EVERY DEFAULT EMAIL, rendered and read (the comms build spec 5.5).
 *
 * These are the words every village is born with, so each one is held to the
 * brief they were written against: it renders with sample data and nothing
 * left unfilled, passes the voice check, names no village, stays under 150
 * words, carries one clear button, and says why the reader got it. The
 * investor path is held to information only.
 */

const VILLAGE: EmailVillage = {
  name: "Sample Village",
  url: "https://sample.example",
  logoUrl: null,
  seed: "#3b6e8f",
  character: "civic",
  postalAddress: "1 Sample Lane",
};

/** Every template there is: the platform's own, and the generic words a fork's path gets. */
const ALL: DefaultTemplate[] = [
  ...DEFAULT_TEMPLATES,
  ...PATH_STEP_KEYS.map((step) => genericPathTemplate(`path.beekeeper.${step}`)!),
];

function render(t: DefaultTemplate, extra: MergeValues = {}) {
  const values: MergeValues = {
    ...sampleValues({ villageUrl: VILLAGE.url, firstName: "Ada", fullName: "Ada Lovelace", pathUrl: `${VILLAGE.url}/resident` }),
    "path.name": "Resident",
    ...extra,
  };
  return composeEmail({ words: t, values, village: VILLAGE, kind: kindForTemplate(t.key), templateKey: t.key });
}

/**
 * The brand gate's own list of village names, read out of the gate so this
 * test never has to spell one: test files sit in that gate's ratchet zone.
 */
function bannedNames(): string[] {
  const src = fs.readFileSync(path.resolve(process.cwd(), "scripts/check-brand-refs.mjs"), "utf8");
  const list = src.match(/const BANNED = \[([\s\S]*?)\];/);
  if (!list) throw new Error("could not read BANNED from scripts/check-brand-refs.mjs");
  const names = Array.from(list[1].matchAll(/"([^"]+)"/g)).map((m) => m[1].toLowerCase());
  expect(names.length, "the gate's list was read").toBeGreaterThan(2);
  return names;
}

/** Words that belong to one village's own story and not to every village's email. */
const ONE_VILLAGES_VOCABULARY = [/infinite game/i, /great work/i, /\bregen/i, /renaissance/i, /\bcatalyst\b/i, /\bquest card/i];

/** The number of words in a body, a merge token counting as one. */
const wordCount = (md: string): number => md.replace(/\{\{[^}]+\}\}/g, "X").split(/\s+/).filter(Boolean).length;

/** Buttons in the body: the table-based button's cell. */
const buttons = (html: string): number => (html.match(/<td align="center" bgcolor=/g) ?? []).length;

describe("every default email", () => {
  it.each(ALL.map((t) => [t.key, t] as const))("%s renders with sample data, passes the voice check and names no village", (_key, t) => {
    const email = render(t);
    expect(email.unknown, "a token that names no field").toEqual([]);
    expect(email.missing, "a field the sample has no value for").toEqual([]);
    expect(fieldProblems(t.key, `${t.subject}\n${t.preheader ?? ""}\n${t.bodyMd}`)).toEqual({ unknown: [], unavailable: [] });

    expect(voiceLintWords(t), "the words as written").toEqual([]);
    expect(voiceLint(email.text, "rendered"), "the words as sent").toEqual([]);

    const everything = `${t.subject}\n${t.preheader ?? ""}\n${t.bodyMd}`;
    for (const name of bannedNames()) expect(everything.toLowerCase(), `names ${name}`).not.toContain(name);
    for (const word of ONE_VILLAGES_VOCABULARY) expect(everything, String(word)).not.toMatch(word);
    // The village is named only through its field: the only proper noun is the sample's own.
    expect(email.text).not.toMatch(/\bvillage\.name\b/);
  });

  it.each(ALL.map((t) => [t.key, t] as const))("%s stays under 150 words, carries one clear button and says hello", (_key, t) => {
    expect(wordCount(t.bodyMd)).toBeLessThan(150);
    const email = render(t);
    // The frame around a letter carries whatever button the letter writes.
    if (t.key !== "letter.layout") {
      expect(buttons(email.html), "one clear button").toBe(1);
      expect(t.bodyMd.startsWith("Hi {{person.firstName}},"), "it greets the reader").toBe(true);
    }
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject.length).toBeLessThanOrEqual(70);
    expect(email.preheader.length).toBeGreaterThan(0);
  });

  it.each(ALL.map((t) => [t.key, t] as const))("%s carries every link of its HTML in its text part", (_key, t) => {
    const email = render(t);
    const hrefs = Array.from(email.html.matchAll(/href="([^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, "&"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(email.text, href).toContain(href);
  });

  it("says in the footer why the reader got it, naming only the village", () => {
    for (const t of ALL) {
      const email = render(t);
      expect(email.text, t.key).toMatch(/You're getting this because .+ Sample Village/);
    }
    for (const [key, line] of Object.entries(WHY_YOU_GOT_THIS)) {
      expect(voiceLint(line), key).toEqual([]);
      expect(line, key).toContain("{{village.name}}");
    }
  });

  it("gives a gathering's time in the village's zone and, when it differs, in the reader's own", () => {
    const withBoth = render(platformTemplate("gathering.confirm")!, {
      "gathering.when": "Saturday, October 4 at 10:00 AM",
      "gathering.whenLocal": "Saturday, October 4 at 5:00 PM",
    });
    expect(withBoth.text).toContain("- When: Saturday, October 4 at 10:00 AM");
    expect(withBoth.text).toContain("- Your time: Saturday, October 4 at 5:00 PM");
    const villageOnly = render(platformTemplate("gathering.confirm")!, { "gathering.whenLocal": "" });
    expect(villageOnly.text).not.toContain("Your time");
    for (const key of ["gathering.confirm", "gathering.reminder_day", "gathering.reminder_soon", "gathering.changed", "gathering.promoted"]) {
      expect(platformTemplate(key)!.bodyMd, key).toContain("{{gathering.whenLocal}}");
    }
  });

  it("tells a path's reader what happens next and that a person writes back", () => {
    for (const t of ALL.filter((x) => x.key.startsWith("path."))) {
      if (t.key.endsWith(".welcome")) expect(t.bodyMd, t.key).toMatch(/what happens next|next three weeks/i);
      if (t.key.endsWith(".check_in")) expect(t.bodyMd, t.key).toContain("{{path.contactName}} will write to you");
    }
  });

  it("keeps the investor path to information: no returns, no offers, no urgency", () => {
    const forbidden = [
      /\breturns?\b/i, /\byields?\b/i, /\bprofits?\b/i, /\bdividends?\b/i, /\bguarantee/i, /\bopportunit/i,
      /\bhurry\b/i, /\blimited\b/i, /\bact now\b/i, /\bdon't miss\b/i, /\blast chance\b/i, /\bexclusive\b/i,
      /\d+\s?%/, /\bgrowth\b/i, /\bearn/i, /\bspots?\b/i,
    ];
    const investor = DEFAULT_TEMPLATES.filter((t) => t.key.startsWith("path.investor."));
    expect(investor).toHaveLength(5);
    for (const t of investor) {
      const words = `${t.subject}\n${t.preheader}\n${t.bodyMd}`;
      for (const re of forbidden) expect(words, `${t.key}: ${re}`).not.toMatch(re);
      // "Offer" appears once, saying there is none.
      expect(words.replace("make no offer", ""), t.key).not.toMatch(/\boffer/i);
    }
  });

  it("makes the letters confirmation's one button the signed link the people lane posts as links.lettersConfirm", () => {
    const link = "https://sample.example/email/a?t=letters-token";
    const email = render(platformTemplate("letters.confirm")!, { "links.lettersConfirm": link });
    const buttonHrefs = Array.from(email.html.matchAll(/<td align="center" bgcolor=[^>]*><a href="([^"]+)"/g)).map((m) => m[1]);
    expect(buttonHrefs).toEqual([link]);
    expect(email.text).toContain(`Yes, send me village news: ${link}`);
    expect(platformTemplate("letters.confirm")!.bodyMd).toContain("({{links.lettersConfirm}})");
    expect(platformTemplate("letters.confirm")!.bodyMd).not.toContain("{{links.confirm}}");
  });

  it("lists every default in exactly one group of the Words screen", () => {
    const grouped = templateGroups().flatMap((g) => g.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(DEFAULT_TEMPLATES.map((t) => t.key).sort());
  });

  it("gives a path a fork adds its own five sets of words, and nothing else a key it does not know", () => {
    expect(genericPathTemplate("path.beekeeper.first_step")?.key).toBe("path.beekeeper.first_step");
    expect(platformTemplate("path.beekeeper.check_in")?.bodyMd).toContain("{{path.contactName}}");
    expect(platformTemplate("path.resident.welcome")?.bodyMd).toContain("thinking about living here");
    expect(platformTemplate("gathering.nonsense")).toBeNull();
    expect(genericPathTemplate("path.beekeeper.sixth")).toBeNull();
  });
});
