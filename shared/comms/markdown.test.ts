import { describe, expect, it } from "vitest";
import { composeEmail, NEUTRAL_STYLE, type EmailVillage } from "./letterHtml";
import { blocksHtml, blocksText, dropEmpty, expandFields, parseBlocks, type InlineContext } from "./markdown";
import { newTracker, resolveLink, safeUrl, type MergeValues } from "./mergeFields";

/**
 * The renderer: markdown into email HTML and its plain-text twin, with every
 * character an author types escaped and only the renderer's own tags written.
 */

const VILLAGE: EmailVillage = {
  name: "Test Village",
  url: "https://village.example",
  logoUrl: null,
  seed: null,
  character: null,
  postalAddress: "1 Lane, Somewhere",
};

const render = (bodyMd: string, values: MergeValues = {}, village: EmailVillage = VILLAGE) =>
  composeEmail({ words: { subject: "Hello", preheader: "Hi", bodyMd }, values, village, kind: "essential", templateKey: null });

/** The part of the document between the header and the footer. */
const bodyOf = (html: string) => html.slice(html.indexOf('<tr><td style="padding:8px'), html.indexOf('<tr><td style="padding:16px'));

const ctx = (values: MergeValues = {}): InlineContext => {
  const tracker = newTracker();
  return {
    style: NEUTRAL_STYLE,
    href: (raw) => resolveLink(raw, values, VILLAGE.url, tracker),
    src: () => null,
    attr: (raw) => raw,
  };
};

describe("markdown in an email", () => {
  it("renders a script tag or HTML in the words as text, never as markup", () => {
    const words = [
      "<script>alert('x')</script>",
      "Some <b>bold</b> and <img src=x onerror=alert(1)> and <a onclick=\"steal()\">a link</a>.",
      "[Click me](javascript:evil) and [data](data:text/html,hi).",
    ].join("\n\n");
    const email = render(words);
    const body = bodyOf(email.html);
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toContain("<b>");
    expect(body).not.toMatch(/<img src="x"/);
    expect(body).not.toMatch(/<a onclick/);
    expect(body).not.toMatch(/href="(javascript|data):/i);
    expect(body).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(body).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(body).toContain("&lt;a onclick=&quot;steal()&quot;&gt;a link&lt;/a&gt;");
    // The plain-text part has nothing to escape and shows the characters as typed.
    expect(email.text).toContain("<script>alert('x')</script>");
    // A refused address leaves its words, unlinked.
    expect(body).toContain("Click me and data.");
  });

  it("never lets emphasis reach inside a link's address", () => {
    const html = blocksHtml(parseBlocks("See [the page](https://village.example/a*b*c) now."), ctx());
    expect(html).toContain('href="https://village.example/a*b*c"');
    expect(html).not.toMatch(/href="[^"]*<em>/);
  });

  it("parses the block grammar the original letters used", () => {
    const blocks = parseBlocks(
      ["# Heading", "A paragraph that\nruns on.", "- one\n- two\n  - nested", "> a quote", "Important: read this", "---", "[Press me](https://x.example)", "![A barn](https://village.example/barn.webp)"].join("\n\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["h", "p", "list", "quote", "callout", "hr", "cta", "image"]);
    expect(blocks[1]).toEqual({ type: "p", text: "A paragraph that runs on." });
    expect(blocks[2]).toMatchObject({ type: "list", node: { items: [{ text: "one" }, { text: "two", children: { items: [{ text: "nested" }] } }] } });
  });

  it("makes a line that is only a link into one table-based button in the village's colour", () => {
    const html = blocksHtml(parseBlocks("[Confirm my place](https://village.example/go)"), ctx());
    expect(html).toMatch(/^<table role="presentation"/);
    expect(html).toContain(`bgcolor="${NEUTRAL_STYLE.brand}"`);
    expect(html).toContain('<a href="https://village.example/go"');
    expect(html).toContain(">Confirm my place</a>");
  });

  it("loads images only from the village's own site over https", () => {
    const own = render("![The barn](https://village.example/api/uploads/barn.webp)");
    expect(bodyOf(own.html)).toContain('<img src="https://village.example/api/uploads/barn.webp" alt="The barn"');
    const elsewhere = render("![A tracker](https://elsewhere.example/pixel.gif)");
    expect(bodyOf(elsewhere.html)).not.toContain("<img");
    expect(bodyOf(elsewhere.html)).toContain("A tracker");
  });

  it("carries every link of the HTML into the text part, written out", () => {
    const email = render(
      [
        "Read [the calendar]({{village.url}}/events) and [this](https://other.example/page?x=1&y=2).",
        "[Save me a seat]({{nextGathering.rsvpLink}})",
        "Or write to [us](mailto:hello@village.example).",
        "Bare: https://bare.example/path",
      ].join("\n\n"),
      { "nextGathering.rsvpLink": "https://village.example/email/a?t=abc", "nextGathering.title": "Supper" },
    );
    const hrefs = Array.from(email.html.matchAll(/href="([^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, "&"));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) expect(email.text, href).toContain(href);
    expect(email.text).toContain("Save me a seat: https://village.example/email/a?t=abc");
    expect(email.text).toContain("the calendar (https://village.example/events)");
  });

  it("turns a lone markdown field into blocks and a lone list field into links", () => {
    const values: MergeValues = {
      "recap.body": { markdown: "We planted beds.\n\n- Twelve came" },
      "recap.questions": { links: [{ label: "Yes", href: "https://village.example/a?t=1" }] },
    };
    const blocks = expandFields(parseBlocks("Intro.\n\n{{recap.body}}\n\n{{recap.questions}}"), values);
    expect(blocks.map((b) => b.type)).toEqual(["p", "p", "list", "links"]);
    const text = blocksText(blocks, ctx(values));
    expect(text).toContain("- Twelve came");
    expect(text).toContain("- Yes: https://village.example/a?t=1");
  });

  it("leaves out a line whose optional field is unknown, and the line that introduces it", () => {
    const tracker = newTracker();
    const blocks = dropEmpty(
      parseBlocks("Hello.\n\n- **When:** {{gathering.when}}\n- **Your time:** {{gathering.whenLocal}}\n\nTwo questions:\n\n{{recap.questions}}\n\nBye."),
      { "gathering.when": "Saturday at 10:00 AM" },
      tracker,
    );
    const text = blocksText(blocks, ctx());
    expect(text).toContain("When: {{gathering.when}}");
    expect(text).not.toContain("Your time");
    expect(text).not.toContain("Two questions");
    expect(text).toContain("Bye.");
    expect(Array.from(tracker.omitted).sort()).toEqual(["gathering.whenLocal", "recap.questions"]);
  });

  it("joins a site address and a path with one slash", () => {
    expect(safeUrl("https://village.example")).toBe("https://village.example");
    expect(resolveLink("{{village.url}}/events", { "village.url": "https://village.example" }, null, newTracker())).toBe(
      "https://village.example/events",
    );
  });
});
