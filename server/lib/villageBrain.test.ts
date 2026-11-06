/**
 * Pure-function tests for the village brain (S74).
 *
 * The rendering half is where the privacy rules actually land: `people` names
 * members and `legal` names title holders, and a markdown endpoint written
 * without an audience filter would have shipped both to anyone signed in.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BRIEF_SECTIONS, MINIMUM_BRIEF } from "../../shared/villageBrief";
import {
  STRANGER_READABLE_SECTIONS,
  briefAudienceFromBody,
  briefRowsForViewer,
  capMarkdown,
  decisionOccurredAt,
  decisionToRecord,
  estimateTokens,
  renderIndexMarkdown,
  renderSectionMarkdown,
  slugify,
  type BriefRow,
  type DecisionThreadRow,
  type RecordSummary,
} from "./villageBrain";

const brief = (over: Partial<BriefRow>): BriefRow => ({
  id: "brief-aims",
  section: "aims",
  title: "What this project is for",
  body: "Food sovereignty, water security, and a place guests can arrive into.",
  audience: "member",
  source: "session0",
  status: "confirmed",
  confirmedBy: "rye",
  confirmedAt: "2026-08-14T09:22:00.000Z",
  revision: 2,
  updatedAt: "2026-08-14T09:22:00.000Z",
  ...over,
});

describe("the brain never leaves the fork", () => {
  // The spec promises this as a test and not a comment, because the guarantee
  // is what makes a founder willing to write "who holds the land title" into
  // it. Every path that sends anything OUTWARD is checked for any mention of
  // the brain's tables. Source-level on purpose: a runtime assertion only
  // covers the payloads a test happens to build, and this covers the code.
  const OUTWARD = [
    "server/lib/feedback.ts", // relays to the ReGen hub
    "server/lib/network.ts", // publishes to peer villages
    "server/lib/villageExport.ts", // the signed public documents
  ];
  const BRAIN = ["village_brief", "village_record", "village_brief_revisions", "briefAll", "recordSummaries"];

  it("no outward-facing module references the brain at all", () => {
    const root = path.join(__dirname, "..", "..");
    let checked = 0;
    for (const rel of OUTWARD) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue; // a module that does not exist cannot leak
      checked += 1;
      const src = fs.readFileSync(file, "utf8");
      for (const token of BRAIN) {
        expect(src, `${rel} must not touch ${token}: the brain is fork-local`).not.toContain(token);
      }
    }
    // Without this the sweep passes by checking nothing at all.
    expect(checked, "no outward-facing module was found to check").toBeGreaterThanOrEqual(2);
  });
});

describe("the section registry", () => {
  it("names a minimum viable brain of exactly three sections", () => {
    // A first session targets these and stops. A founder must be able to leave
    // with a usable game, so this is not the whole registry by design.
    expect(MINIMUM_BRIEF).toEqual(["work", "people", "constraints"]);
  });

  it("keeps the sections that name people admin-only", () => {
    const byId = Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.id, s.audience]));
    expect(byId.people).toBe("admin");
    expect(byId.legal).toBe("admin");
    expect(byId.constraints).toBe("admin");
    expect(byId.economy).toBe("admin");
  });

  it("gives every section an ask, so a blank one can be filled in conversation", () => {
    for (const s of BRIEF_SECTIONS) {
      expect(s.ask.length).toBeGreaterThan(30);
      expect(s.feeds.length).toBeGreaterThan(20);
    }
  });

  it("has unique ids", () => {
    expect(new Set(BRIEF_SECTIONS.map((s) => s.id)).size).toBe(BRIEF_SECTIONS.length);
  });
});

describe("what may ever reach a stranger", () => {
  // Pinned as a literal on purpose. Widening this list is how a village's dues
  // or its decision-makers reach the public guide, so it should take an edit
  // here that a reviewer reads, and never happen as a side effect of adding a
  // section to the registry.
  it("is exactly the four sections a village says to anybody", () => {
    expect([...STRANGER_READABLE_SECTIONS].sort()).toEqual(["aims", "language", "values", "vision"]);
  });

  it("names only sections that exist, so a rename cannot quietly empty the public guide", () => {
    // Widened to string: the allowlist is a set of strings, and BRIEF_SECTIONS
    // ids became literals (BriefSectionId) when the canvas sections joined them.
    const ids = new Set<string>(BRIEF_SECTIONS.map((s) => s.id));
    for (const id of STRANGER_READABLE_SECTIONS) expect(ids.has(id), `${id} is not a brief section`).toBe(true);
  });

  it("names only sections that default to members, so the two lists cannot disagree on a fresh fork", () => {
    const byId = Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.id, s.audience]));
    for (const id of STRANGER_READABLE_SECTIONS) expect(byId[id], id).toBe("member");
  });
});

describe("briefAudienceFromBody", () => {
  it("accepts both directions, so an admin can close what they opened", () => {
    expect(briefAudienceFromBody("member")).toBe("member");
    expect(briefAudienceFromBody("admin")).toBe("admin");
  });

  it("reads anything else as leave it alone, never as a widening", () => {
    for (const v of [undefined, null, "", "public", "Member", "ADMIN", 1, true, {}, ["member"]]) {
      expect(briefAudienceFromBody(v), JSON.stringify(v)).toBeUndefined();
    }
  });
});

describe("briefRowsForViewer", () => {
  // Every section as a member-audience row: what the member query returns
  // once the canvas has opened all of them.
  const opened = BRIEF_SECTIONS.map((s) => brief({ id: `brief-${s.id}`, section: s.id, audience: "member" }));

  it("hands a signed-in account the village has not admitted the allowlist and nothing else", () => {
    const seen = briefRowsForViewer(opened, { admin: false, member: false }).map((r) => r.section).sort();
    expect(seen, "an unadmitted account read a section a stranger may not").toEqual([...STRANGER_READABLE_SECTIONS].sort());
    for (const id of ["economy", "decisions", "membership"]) expect(seen).not.toContain(id);
  });

  it("hands a member and an admin exactly the rows their audience query returned", () => {
    expect(briefRowsForViewer(opened, { admin: false, member: true })).toEqual(opened);
    expect(briefRowsForViewer(opened, { admin: true, member: false })).toEqual(opened);
  });
});

describe("slugify", () => {
  it("keeps only lowercase, digits and hyphens", () => {
    expect(slugify("Water Rights: the Well (2026)")).toBe("water-rights-the-well-2026");
  });

  it("cannot produce a path", () => {
    // This becomes an export filename. A slug built from typed text is a path
    // traversal waiting for someone to notice.
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a/b\\c")).toBe("a-b-c");
  });

  it("falls back when the input has nothing usable", () => {
    expect(slugify("!!!", "entry")).toBe("entry");
    expect(slugify("")).toBe("entry");
  });

  it("bounds the length", () => {
    expect(slugify("x".repeat(400)).length).toBeLessThanOrEqual(100);
  });
});

describe("capMarkdown", () => {
  it("leaves a short document alone", () => {
    expect(capMarkdown("# Small\n\nbody", 400)).toBe("# Small\n\nbody");
  });

  it("cuts on a line boundary and says it cut", () => {
    const long = Array.from({ length: 300 }, (_, i) => `- line number ${i}`).join("\n");
    const out = capMarkdown(long, 100);
    expect(estimateTokens(out)).toBeLessThanOrEqual(100);
    expect(out).toContain("[truncated]");
    expect(out).not.toMatch(/- line number \d+\[truncated\]/);
  });
});

describe("renderSectionMarkdown", () => {
  it("states how far to trust the section, before its body", () => {
    const md = renderSectionMarkdown(brief({ section: "work", status: "proposed", source: "intake", confirmedBy: null }));
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("section: work");
    expect(md).toContain("status: proposed");
    expect(md).toContain("source: intake");
    expect(md).not.toContain("confirmed_by:");
  });

  it("names the confirming human when there is one", () => {
    expect(renderSectionMarkdown(brief({}))).toContain("confirmed_by: rye");
  });
});

describe("renderIndexMarkdown", () => {
  it("lists blank sections, because the blanks are the point", () => {
    const md = renderIndexMarkdown([brief({})], [], "admin");
    expect(md).toContain("**membership**");
    expect(md).toContain("not yet written");
    expect(md).toContain("Still blank:");
  });

  it("says which sections are confirmed and which are only proposed", () => {
    const md = renderIndexMarkdown(
      [brief({ section: "aims", status: "confirmed" }), brief({ section: "work", status: "proposed" })],
      [],
      "admin",
    );
    expect(md).toMatch(/\*\*aims\*\*[^\n]*confirmed/);
    expect(md).toMatch(/\*\*work\*\*[^\n]*proposed, not yet confirmed/);
  });

  it("never shows a member the sections that name people", () => {
    const md = renderIndexMarkdown([brief({ section: "people", audience: "admin" })], [], "member");
    expect(md).not.toContain("**people**");
    expect(md).not.toContain("**legal**");
    expect(md).toContain("**aims**");
  });

  it("rolls the record up to counts, so a year of history cannot blow the budget", () => {
    const records: RecordSummary[] = [
      { section: "calls", entries: 214, recent: ["Water rights", "Dues", "Guest policy"] },
    ];
    const md = renderIndexMarkdown([brief({})], records, "admin");
    expect(md).toContain("214 entries");
    expect(md).toContain("Water rights");
    expect(estimateTokens(md)).toBeLessThan(400);
  });

  it("says entry, singular, for one", () => {
    const md = renderIndexMarkdown([], [{ section: "calls", entries: 1, recent: ["Water rights"] }], "admin");
    expect(md).toContain("1 entry");
  });

  it("fits the always-present budget on a fresh fork", () => {
    // Every section blank is the worst case for the index, and it is also the
    // state every new village starts in.
    expect(estimateTokens(renderIndexMarkdown([], [], "admin"))).toBeLessThanOrEqual(400);
  });
});

describe("a decided thread becomes a record entry", () => {
  const CREATED = "2026-03-01T10:00:00.000Z";
  const thread = (over: Partial<DecisionThreadRow> = {}): DecisionThreadRow => ({
    id: "thr-1",
    title: "Proposal: quiet hours from 9pm to 7am",
    body: "Raised at three consecutive circle meetings.",
    meta: { status: "decided", outcome: "Adopted, with an exception for harvest week." },
    created_at: CREATED,
    last_reply_at: null,
    ...over,
  });

  it("files into a real section, from a real source, keyed to the thread", () => {
    const r = decisionToRecord(thread());
    expect(r.section).toBe("decisions");
    expect(r.source).toBe("decision");
    // With `source`, the idempotency key: a rerun must not file it twice.
    expect(r.sourceRef).toBe("thr-1");
  });

  it("leads with what was decided, then the case that was made", () => {
    const r = decisionToRecord(thread());
    expect(r.body).toContain("Adopted, with an exception for harvest week.");
    expect(r.body).toContain("Raised at three consecutive circle meetings.");
    expect(r.body.indexOf("Adopted")).toBeLessThan(r.body.indexOf("Raised"));
  });

  it("takes decidedAt when a person recorded one", () => {
    const r = decisionToRecord(thread({ meta: { status: "decided", decidedAt: "2026-06-15T12:00:00.000Z" } }));
    expect((r.occurredAt as Date).toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("falls back to created_at, never to now, when decidedAt is absent", () => {
    // The examples seed carries exactly this shape: status decided, no
    // decidedBy and no decidedAt. A fallback of "now" would date every
    // historical decision to the morning the job first ran.
    const r = decisionToRecord(thread({ meta: { status: "decided", outcome: "Adopted." } }));
    expect((r.occurredAt as Date).toISOString()).toBe(CREATED);
  });

  it("refuses a date outside the timestamp column's range", () => {
    // `meta` is unvalidated client JSON, and occurred_at is a MySQL timestamp
    // whose range ends in 2038. A typed year of 9999 is not a wrong date, it
    // is a failed INSERT that stops the whole job on its first bad row.
    for (const bad of ["9999-01-01T00:00:00.000Z", "1200-01-01T00:00:00.000Z", "not a date", "", 0, null]) {
      const r = decisionToRecord(thread({ meta: { status: "decided", decidedAt: bad } }));
      expect((r.occurredAt as Date).toISOString(), String(bad)).toBe(CREATED);
    }
  });

  it("keeps the boundary years and rejects the ones past them", () => {
    // UTC on both sides. Read in local time, 1990-01-01Z is 1989 west of
    // Greenwich, and the same instant would be kept or dropped depending on
    // where the server sits.
    expect(decisionOccurredAt({ decidedAt: "1990-01-01T00:00:00.000Z" }, CREATED).getUTCFullYear()).toBe(1990);
    expect(decisionOccurredAt({ decidedAt: "2037-12-31T00:00:00.000Z" }, CREATED).getUTCFullYear()).toBe(2037);
    expect(decisionOccurredAt({ decidedAt: "1989-12-31T00:00:00.000Z" }, CREATED).toISOString()).toBe(CREATED);
    expect(decisionOccurredAt({ decidedAt: "2038-06-01T00:00:00.000Z" }, CREATED).toISOString()).toBe(CREATED);
  });

  it("survives a thread with no title at all", () => {
    const r = decisionToRecord(thread({ title: null }));
    expect(r.title).toBe("A decision with no title");
    expect(slugify(r.title)).not.toBe("");
  });

  it("survives an all-punctuation title, which slugify would empty", () => {
    const r = decisionToRecord(thread({ title: "!!! ??? ..." }));
    expect(slugify(r.title, "entry")).toBe("entry");
  });

  it("survives a title far past the column width", () => {
    // The column is varchar(200) and recordAppend does the slicing, so what
    // matters here is that nothing throws on the way.
    const r = decisionToRecord(thread({ title: "x".repeat(400) }));
    expect(r.title).toHaveLength(400);
    expect(slugify(r.title).length).toBeLessThanOrEqual(100);
  });

  it("survives a thread with no body and no outcome", () => {
    const r = decisionToRecord(thread({ body: null, meta: { status: "decided" } }));
    expect(r.body.length).toBeGreaterThan(0);
  });
});
