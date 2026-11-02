import { describe, expect, it } from "vitest";
import { sitePageMeta, spliceMeta } from "./pageMeta";
import { documentTitle } from "../../shared/pageTitles";

const config = {
  project: { name: "Willowbrook", tagline: "Roots and rivers", commitmentName: "Village Pledge", location: "" },
  images: { hero: "/uploads/hero.webp" },
};
const SHELL = `<html><head>
    <title>Village</title>
    <meta name="description" content="A coordination platform" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Village" />
  </head><body></body></html>`;

describe("what a shared link shows", () => {
  it("names the page and the village, and falls back to the Tagline and homepage picture", () => {
    const meta = sitePageMeta("/visit", "https://willow.example", config, null);
    expect(meta.title).toBe("Visit · Willowbrook");
    expect(meta.description).toBe("Roots and rivers");
    expect(meta.image).toBe("https://willow.example/uploads/hero.webp");
    expect(meta.url).toBe("https://willow.example/visit");
    expect(meta.siteName).toBe("Willowbrook");
  });

  it("uses the village's own share sentence and picture from Admin, Pages, Whole site", () => {
    const content = { "page-site": { share: { description: "A valley that remembers.", image: "/uploads/share.webp" } } };
    const meta = sitePageMeta("/", "https://willow.example", config, content);
    expect(meta.title).toBe("Willowbrook");
    expect(meta.description).toBe("A valley that remembers.");
    expect(meta.image).toBe("https://willow.example/uploads/share.webp");
  });

  it("calls the commitment page by the village's own word for it", () => {
    expect(documentTitle("/love-letter", "Willowbrook", { commitment: "Village Pledge" })).toBe("Village Pledge · Willowbrook");
    expect(documentTitle("/forum/123", "Willowbrook")).toBe("Forum · Willowbrook");
  });

  it("draws no picture it cannot address absolutely", () => {
    const meta = sitePageMeta("/", "", config, null);
    expect(meta.image).toBe("");
    expect(meta.url).toBe("");
  });

  it("replaces the neutral tags rather than adding a second set", () => {
    const html = spliceMeta(SHELL, sitePageMeta("/team", "https://willow.example", config, null));
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Team · Willowbrook</title>");
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:image" content="https://willow.example/uploads/hero.webp" />');
    expect(html).not.toContain("A coordination platform");
  });

  it("escapes what a village typed", () => {
    const html = spliceMeta(SHELL, { ...sitePageMeta("/", "", config, null), title: `Willow "&" <brook>` });
    expect(html).toContain("<title>Willow &quot;&amp;&quot; &lt;brook&gt;</title>");
  });
});

describe("the share card of a story page this village switched off", () => {
  it("names the village alone, no address of its own, and asks search engines to leave it out", () => {
    const meta = sitePageMeta("/housing", "https://willow.example", config, null, true);
    expect(meta.title).toBe("Willowbrook");
    expect(meta.url).toBe("");
    const html = spliceMeta(SHELL, meta);
    expect(html).toContain("<title>Willowbrook</title>");
    expect(html).not.toContain("Housing");
    expect(html).not.toContain("/housing");
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });

  it("is the ordinary card while the page is served, the control for the case above", () => {
    const html = spliceMeta(SHELL, sitePageMeta("/housing", "https://willow.example", config, null));
    expect(html).toContain("<title>Housing · Willowbrook</title>");
    expect(html).toContain('<link rel="canonical" href="https://willow.example/housing" />');
    expect(html).not.toContain("noindex");
  });
});

describe("the names of the story pages in the menu and footer", () => {
  it("serves every story page's name, with the village's commitment word, and marks none as changed by default", async () => {
    const { siteWords } = await import("./pageMeta");
    const words = siteWords(null, config);
    expect(words.menu["/visit"]).toEqual({ label: "Plan a Visit", subtitle: "" });
    expect(words.menu["/love-letter"].label).toBe("Sign the Village Pledge");
    expect(words.menuChanged).toEqual([]);
  });

  it("marks only the pages the village renamed, so the footer keeps its own wording for the rest", async () => {
    const { siteWords } = await import("./pageMeta");
    const words = siteWords({ "page-site": { menu: { pages: [{ id: "/visit", label: "Come Stay" }] } } }, config);
    expect(words.menu["/visit"].label).toBe("Come Stay");
    expect(words.menuChanged).toEqual(["/visit"]);
  });
});
