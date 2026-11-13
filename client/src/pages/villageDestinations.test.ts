import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * No page may carry a destination belonging to one particular village.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT check-brand-refs.mjs. That guard exempts
 * the SHOPFRONT pages on purpose: a village's own prose is its own, and
 * policing thirteen pages for their own name taught nobody anything. The
 * exemption is right for names and wrong for destinations, and this is the
 * gap it left. Every mailto and every outbound link that shipped hardcoded
 * lived in a file that guard cannot see, so the whole defect class was
 * invisible to CI while looking fully covered.
 *
 * The harm is asymmetric, which is why the mail rule is the strict one. A
 * wrong URL is visibly wrong the moment somebody clicks it. A wrong mailto
 * opens an ordinary mail composer addressed to a village the visitor has
 * never heard of: they send their investment enquiry, see no error, and the
 * founder whose site it was never learns the lead existed.
 *
 * The fix these rules protect: identity lives in shared/gameConfig.ts, is
 * overlaid per village through the brand document, and is read at render
 * through useVillageLinks() in client/src/lib/gameApi.ts, which returns ""
 * for anything the village has not set so the control hides rather than
 * pointing somewhere else.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Hosts that are a platform dependency rather than any one village's
 * property. Adding to this list is a deliberate act: it says "every village
 * that ever ships from this codebase should reach this host", which is true
 * of the DAO tooling and of nothing that belongs to a single community.
 */
const PLATFORM_HOSTS = ["app.hypha.earth"];

/**
 * The webmail doors in `components/fireflyPath/stones.ts`: "Check your email"
 * opens the applicant's own provider. They belong to the person's address,
 * never to a village, so every village ships the same list.
 */
const WEBMAIL_HOSTS = [
  "mail.google.com",
  "outlook.live.com",
  "mail.yahoo.com",
  "www.icloud.com",
  "mail.proton.me",
  "www.gmx.com",
  "mail.aol.com",
];

/** mailto: followed by a real address, rather than `mailto:${expression}`. */
const LITERAL_MAILTO = /mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** An absolute URL literal used AS a destination: href=, href:, or link:. */
const LITERAL_DESTINATION = /\b(?:href|link)\s*[=:]\s*"(https?:\/\/[^"]+)"/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(ROOT);
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

describe("no page carries one village's destination", () => {
  it("scans a plausible number of files, so a broken walk cannot pass as clean", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no mailto to a literal address", () => {
    const found: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const hit = line.match(LITERAL_MAILTO);
        if (hit) found.push(`${rel(file)}:${i + 1} ${hit[0]}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("has no absolute outbound destination outside the platform hosts", () => {
    const found: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const hit of line.matchAll(LITERAL_DESTINATION)) {
          const host = new URL(hit[1]).host;
          if (!PLATFORM_HOSTS.includes(host) && !WEBMAIL_HOSTS.includes(host)) found.push(`${rel(file)}:${i + 1} ${hit[1]}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});

/**
 * A guard nobody has watched fail is a guard that might match nothing at all.
 * These feed the two detectors the exact SHAPES that shipped, with a neutral
 * host so this file itself carries no village's name.
 */
describe("the detectors fire on the shape that shipped", () => {
  it("catches a hardcoded enquiry address", () => {
    expect(LITERAL_MAILTO.test('href="mailto:invest@one-village.test?subject=Investor%20Pack"')).toBe(true);
    expect(LITERAL_MAILTO.test('href="mailto:business@one-village.test"')).toBe(true);
  });

  it("leaves a config-driven mailto alone", () => {
    expect(LITERAL_MAILTO.test("href={mailTo(PACKET_SUBJECT)}")).toBe(false);
    expect(LITERAL_MAILTO.test("<a href={`mailto:${res.email}`}>")).toBe(false);
  });

  it("catches a hardcoded outbound link, in JSX and in a data array", () => {
    const jsx = [...'href="https://one-village.test/event/webinar-qa/"'.matchAll(LITERAL_DESTINATION)];
    const data = [...'link: "https://one-village.test/events/",'.matchAll(LITERAL_DESTINATION)];
    expect(jsx).toHaveLength(1);
    expect(data).toHaveLength(1);
  });

  it("leaves a config-driven link and an in-app route alone", () => {
    expect([...'href={eventsUrl}'.matchAll(LITERAL_DESTINATION)]).toHaveLength(0);
    expect([...'link: "/work-with-us",'.matchAll(LITERAL_DESTINATION)]).toHaveLength(0);
  });
});
