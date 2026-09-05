/**
 * WHAT THE FOUNDING TEAM'S TRACKER SHIPS TO A STRANGER.
 *
 * `/project-history` is the founders' internal tracker and it is admin-gated.
 * The gate is on the ROUTE. The JavaScript the route renders from is a lazy
 * chunk, its filename sits in the entry bundle every anonymous visitor
 * downloads, and `dist/public/assets` is served to anyone who asks. So a route
 * guard decides who the app will DRAW a page for. It decides nothing at all
 * about who can read the strings the page was compiled from.
 *
 * Measured at `a9f55de`, before the fix that this file guards: the tracker
 * chunk carried three links to private working documents and named one real
 * person outside the village five times. The chunk's own filename appeared
 * twice inside `index-*.js`, so the path from "load the site" to "read the
 * founder's private references" was three requests long and needed no account.
 *
 * THE HARM METRIC THIS FILE HOLDS, in one sentence:
 *
 *   Nothing a founder pasted into an internal tracker ships inside a file a
 *   stranger can download.
 *
 * ── WHY THIS ASSERTS A CLASS AND NEVER AN INSTANCE ────────────────────────
 *
 * `server/forkPublish.e2e.test.ts` writes its regression strings out in full,
 * and it is right to: those people and figures were already published on a
 * live public site, so listing them costs nothing that was not already spent.
 *
 * The strings here are the opposite case. They are private: a counterparty's
 * name and three unlisted document links. Writing them into a repository that
 * every fork clones would move the leak rather than close it, so this file
 * matches SHAPES. A Google document id has a shape. A mail address has a
 * shape. A hardcoded external origin inside the tracker's own chunk has a
 * shape. Any future paste of the same kind trips the same assertion, and
 * nobody has to be named a second time for that to work.
 *
 * ── WHAT THIS CANNOT SEE, so nobody reads its green as full coverage ──────
 *
 * A PERSON'S NAME IN PLAIN PROSE. "Confirm the terms with Alex" carries no
 * shape a regex can hold apart from every other sentence on the page, and a
 * heuristic that fires on a capitalised word after a preposition matches the
 * product's own nouns on the very same rows. The name that started this file
 * is gone from the source and no automated check here would notice it coming
 * back. That one is on the reviewer, and it is written down rather than
 * quietly hoped for.
 *
 * IT READS THE BUILT ARTIFACT. `pnpm build` runs before `pnpm test` in CI, so
 * `dist/public/assets` is current there. Run a build first when running this
 * by hand, or it fails on the missing directory, which is the correct answer
 * rather than a hollow green.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ASSETS = path.resolve(process.cwd(), "dist/public/assets");

/**
 * Hosts that serve one person's private working document behind a link. A
 * link to one of these in a client chunk is somebody's unlisted document,
 * readable by whoever downloads the chunk.
 */
const PRIVATE_DOCUMENT_HOSTS = [
  "docs.google.com",
  "drive.google.com",
  "sheets.google.com",
  "notion.so",
  "airtable.com",
  "dropbox.com",
];

/** The shape of a Google document, sheet, slide or file id inside a link. */
const DOCUMENT_ID = /\/(?:document|spreadsheets|presentation|file)\/d\/[A-Za-z0-9_-]{20,}/;

/** A mail address, which is a person even when no name sits beside it. */
const MAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|org|net|earth|cr|io|co)\b/;

function chunkFiles(): string[] {
  expect(
    fs.existsSync(ASSETS),
    `${ASSETS} is missing. Run \`pnpm build\` before this suite.`,
  ).toBe(true);
  return fs.readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
}

function readChunk(name: string): string {
  return fs.readFileSync(path.join(ASSETS, name), "utf8");
}

/** The one chunk the tracker page compiles into. */
function trackerChunk(): { name: string; text: string } {
  const name = chunkFiles().find((f) => f.startsWith("ProjectHistory-"));
  expect(name, "the tracker page must compile to its own chunk").toBeTruthy();
  return { name: name!, text: readChunk(name!) };
}

describe("the founders' tracker ships nothing private in its chunk", () => {
  it("finds the tracker chunk and reads it (a hollow pass would prove nothing)", () => {
    const { text } = trackerChunk();
    expect(text.length, "the tracker chunk must have content").toBeGreaterThan(10_000);
    expect(text, "and it must be the tracker, not some other chunk").toContain("Kanban Board");
  });

  it("is reachable from the entry bundle, which is what makes the rest of this matter", () => {
    const { name } = trackerChunk();
    /*
     * THE ENTRY IS THE ONE index.html LOADS, not the first file whose name
     * begins with "index-".
     *
     * That heuristic held only while exactly one such chunk existed. Rollup
     * names a shared chunk after its source module, and several dependencies
     * ship theirs as `index.mjs`, so the moment one of them becomes shared
     * between two lazy routes the build emits a second `index-<hash>.js`.
     * `readdirSync` sorts, so a 1 KB helper chunk can sort ahead of the real
     * 500 KB entry and this assertion then reads the wrong file and fails
     * with a diff full of somebody else's minified code.
     *
     * That is exactly what happened when an admin dialog began sharing a
     * Radix helper: `index-BEomxUtR.js` (1160 bytes) sorted ahead of
     * `index-W29OFxcX.js` (519281 bytes). Nothing about the tracker had
     * changed. index.html names the real entry, which is what a browser
     * loads and therefore what "reachable by an anonymous visitor" means.
     */
    const html = fs.readFileSync(path.resolve(process.cwd(), "dist/public/index.html"), "utf8");
    const entry = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
    expect(entry, "index.html must name an entry chunk").toBeTruthy();
    expect(
      chunkFiles(),
      "the entry named by index.html must exist on disk",
    ).toContain(entry!);
    expect(
      readChunk(entry!),
      "an anonymous visitor learns the tracker chunk's name from the entry bundle",
    ).toContain(name.replace(/\.js$/, ""));
  });

  it("links to no private working document from any client chunk", () => {
    const offenders: string[] = [];
    for (const chunk of chunkFiles()) {
      const text = readChunk(chunk);
      for (const host of PRIVATE_DOCUMENT_HOSTS) {
        if (text.includes(host)) offenders.push(`${chunk} links to ${host}`);
      }
    }
    expect(offenders, "a private document link belongs in admin-authored data").toEqual([]);
  });

  it("carries no document id in any client chunk", () => {
    const offenders: string[] = [];
    for (const chunk of chunkFiles()) {
      if (DOCUMENT_ID.test(readChunk(chunk))) offenders.push(chunk);
    }
    expect(offenders, "a document id is the document, and it ships to strangers").toEqual([]);
  });

  it("hardcodes no external address in the tracker chunk", () => {
    const { text } = trackerChunk();
    const found = text.match(/https?:\/\/[^"'`\s)]+/g) ?? [];
    expect(
      found,
      "every address this page shows comes from what an admin wrote, never from the build",
    ).toEqual([]);
  });

  it("carries no mail address in the tracker chunk", () => {
    const { text } = trackerChunk();
    const hit = text.match(MAIL_ADDRESS);
    expect(hit?.[0] ?? null, "a mail address in a bundle is a person in a bundle").toBeNull();
  });
});
