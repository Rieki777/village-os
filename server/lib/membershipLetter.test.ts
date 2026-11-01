/**
 * THE MEMBERSHIP LETTER IN THE ALIGNMENT STORE (seat settings PR9).
 *
 * A signed-in member's Love Letter signing aligns them with the letter's
 * words, in the signing's own transaction. Against the S5 scratch schema with
 * a real submissions collection (the spec server/index.ts keeps) and the
 * alignment routes mounted over real HTTP. What is pinned:
 *
 *   - ONE TRANSACTION: a new signing writes the signing row, the text keyed by
 *     the letter's version, both parties and the member's `click` alignment
 *     together, and a failure inside it rolls the signing back too, the
 *     collection's cache included;
 *   - THE WORDS SHOWN: the stored body is the letter the page drew, and a
 *     signing whose version is not the letter as it stands, or that names
 *     none, is refused with nothing written;
 *   - LEGACY: a signing from before PR9 is never listed as an alignment, by
 *     the profile, another member's list or the register, and stays in the
 *     journey; a new signing moves the member's letter out of the journey;
 *   - THE REGISTER: "Membership letter" is a kind a member reads, filterable,
 *     and a guest gets 401;
 *   - A HASH MISMATCH is refused (409), as for any text;
 *   - ERASURE: the departed member's name is in none of the alignment tables
 *     afterwards, and the seal still verifies;
 *   - PARTY LEFT ends the letter, through the same erasure sweep; notice and
 *     ending by agreement refuse a letter;
 *   - signing again supersedes the letter in force; the sweep seals and tells
 *     nobody; a letter written while the village cannot sign is sealed by the
 *     sweep once it can, and a sealed letter is never swept again.
 *
 * Every name is fake.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { userParty, VILLAGE_PARTY } from "../../shared/alignments";
import {
  letterBody,
  LETTER_PAGE_SECTION,
  letterParts,
  letterSourceFrom,
  LETTER_VERSION,
  MEMBERSHIP,
  membershipRef,
  readMembershipRef,
  renderMembershipLetter,
  type LetterSource,
} from "../../shared/membershipLetter";
import { SIGNING_TYPE } from "../../shared/membershipSigning";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { dbCollection } from "../repos/store-db";
import { alignmentsOf, endingsOf, partiesOf, readText, sealsOf, textsForParty, textsToSettle } from "../repos/alignments";
import { usersRepo } from "../repos/users";
import { contentHashOf, settleAll, viewText } from "./alignmentSubjects";
import { giveNotice, recordPartyLeft } from "./alignmentEndings";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { currentLetter, judgeSigning, legacySigningOf, letterVersionOf } from "./membershipLetter";
import { landPublicSubmission } from "./publicForms";
import { ensureSigningKey, resetSigningKeyForTests, signingKey, verifyDocument } from "./villageExport";
import { register as registerAlignments } from "../routes/alignments";
import { register as registerLetter } from "../routes/membershipLetter";

const LADDER = ["visitor", "guest", "member"];

const PEOPLE: Record<string, { id: string; name: string; handle: string; email: string }> = {
  "u-tam": { id: "u-tam", name: "Tamsin Reedwarbler", handle: "tamr", email: "tam@examples.invalid" },
  "u-oro": { id: "u-oro", name: "Oro Pellucid", handle: "orop", email: "oro@examples.invalid" },
  "u-old": { id: "u-old", name: "Odile Firstsigner", handle: "odilef", email: "odile@examples.invalid" },
  "u-guest": { id: "u-guest", name: "Gale Visitor", handle: "galev", email: "gale@examples.invalid" },
};

const CALENDAR: SeatCalendar = { seasons: [{ id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" }], currentSeasonId: "s-now", timezone: "UTC" };

/** The village's inputs, as `mergedConfig()` and the content document hold them. The covenant names a founding member. */
const CONFIG = { project: { name: "Fernhollow", commitmentName: "Love Letter" }, currency: { name: "Seeds" } };
const CONTENT = {
  covenant: { opening: "Tamsin Reedwarbler planted the first grove here, and the rest of us followed." },
  legal: { membership: { entityLabel: "Fernhollow Commons", contributionParagraph: "Contributions are agreed with the village, in kind or in coin." } },
};
const SOURCE: LetterSource = letterSourceFrom(CONFIG, CONTENT);

/** The submissions collection, with the spec server/index.ts keeps. */
const SUBMISSIONS_SPEC = {
  table: "submissions",
  orderBy: "`submitted_at`, `id`",
  columns: [
    { js: "id", db: "id" },
    { js: "type", db: "type" },
    { js: "status", db: "status" },
    { js: "data", db: "data", kind: "json" as const },
    { js: "rewarded", db: "rewarded", kind: "bool" as const },
    { js: "userId", db: "user_id" },
    { js: "userName", db: "user_name" },
    { js: "submittedAt", db: "submitted_at", kind: "time" as const },
  ],
};

let n = 0;
/** A signing as the form door builds it: `${Date.now()}-<five>`, attributed when a member is signed in. */
const signing = (userId: string | null, data: Record<string, unknown> = {}, id?: string) => {
  n += 1;
  const entry: any = {
    id: id ?? `${1760000000000 + n}-t${String(n).padStart(4, "0")}`,
    type: SIGNING_TYPE,
    data: { paths: ["steward"], why: "The grove.", monthlyContribution: "33", acknowledgedGoodNeighbor: true, acknowledgedCommitments: true, ...data },
    status: "new",
    rewarded: false,
    submittedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
  };
  if (userId) {
    entry.userId = userId;
    entry.userName = PEOPLE[userId]?.name ?? userId;
  }
  return entry;
};

describe("the letter's words: one rendering for the page and the store", () => {
  it("every part is in the body, in the order the page draws them, and nothing else is", () => {
    const parts = letterParts(SOURCE);
    const body = letterBody(parts);
    const order = [parts.greeting, parts.opening, parts.joining, parts.commitLead, ...parts.commitments, parts.inReturn, parts.governance, parts.contribution!, parts.closing, parts.signature];
    let at = -1;
    for (const p of order) {
      const i = body.indexOf(p, at + 1);
      expect(i, p).toBeGreaterThan(at);
      at = i;
    }
    // Nothing but the parts: strip them out and only spacing is left.
    let rest = body;
    for (const p of order) rest = rest.replace(p, "");
    expect(rest.trim()).toBe("");
    expect(parts.greeting).toBe("Dear friend of Fernhollow,");
    expect(parts.commitLead).toBe("As a member of Fernhollow Commons, you commit to:");
    // Rye, 2026-10-22: the letter names no token's economy any more.
    expect(parts.inReturn).not.toMatch(/economy/);
  });

  it("the title is what the village calls it; the version is a fingerprint of the words", () => {
    const a = currentLetter(SOURCE);
    expect(a.title).toBe("Love Letter");
    expect(a.intent).toBe("I align with the Love Letter.");
    expect(a.version).toMatch(LETTER_VERSION);
    expect(currentLetter(SOURCE).version).toBe(a.version);
    expect(letterVersionOf(renderMembershipLetter(SOURCE))).toBe(a.version);
    // A word of the covenant changes the version; the platform's own name for the letter titles one that is unnamed.
    expect(currentLetter({ ...SOURCE, covenant: { opening: "Somebody else planted it." } }).version).not.toBe(a.version);
    expect(currentLetter(letterSourceFrom({ project: { name: "Fernhollow" } }, null)).title).toBe("Membership agreement");
  });

  it("a member's signing must name the version it drew; a visitor's aligns nobody", () => {
    const now = currentLetter(SOURCE);
    expect(judgeSigning(signing(null), SOURCE)).toEqual({ align: false });
    expect(judgeSigning({ type: "work-with-us", userId: "u-tam" }, SOURCE)).toEqual({ align: false });
    expect(judgeSigning(signing("u-tam", { letterVersion: now.version }), SOURCE)).toEqual({ align: true, letter: now });
    const none = judgeSigning(signing("u-tam"), SOURCE);
    expect("refused" in none && none.refused.error).toBe("letter_changed");
    const stale = judgeSigning(signing("u-tam", { letterVersion: "lv-0000000000000000" }), SOURCE);
    expect("refused" in stale && stale.refused.letter?.version).toBe(now.version);
    // With nothing to render from, a member's signing is refused: nothing could say what they read.
    expect("refused" in judgeSigning(signing("u-tam", { letterVersion: now.version }), null)).toBe(true);
  });

  it("the ref is keyed by the letter's version and unique by the signing", () => {
    expect(membershipRef("lv-0123456789abcdef", "1760000000001-abcde")).toBe("lv-0123456789abcdef:1760000000001-abcde");
    expect(readMembershipRef("lv-0123456789abcdef:1760000000001-abcde")).toEqual({ letterVersion: "lv-0123456789abcdef", signingId: "1760000000001-abcde" });
    expect(readMembershipRef("sa-0123456789abcdef")).toBeNull();
  });
});

/**
 * THE LETTER'S WORDS BECAME PAGE FIELDS (2026-10-22), AND A VILLAGE THAT KEPT
 * THEM KEEPS ITS LETTER VERSION (2026-10-23).
 *
 * The greeting, the joining paragraph, the commitments, "In return...", the
 * closing and the signature are fields of Admin, Pages, Membership letter
 * (shared/pageContent/loveLetter.ts), read by the server from the stored
 * `page-love-letter` section. A member aligns with a fingerprint of the words.
 *
 * On 2026-10-23 the defaults became a neutral starter letter, so every village
 * that had written none of these fields got a new letter version. The first
 * village did not: it adopted its words first, so its `page-love-letter` and
 * `covenant` sections hold the old letter. That is what this block proves,
 * with the first village's own record (server/seeds/amora/pages/) standing in
 * for its database: fed the adopted page and the old covenant paragraphs, the
 * letter comes out byte for byte as the code rendered it at 1698f40, under the
 * fingerprints taken from that code then.
 *
 * BEFORE is two things taken from the code as it stood at 1698f40: the
 * fingerprints themselves, computed by running the old `currentLetter` over
 * each source below, and the old rendering, kept here verbatim as `oldParts`.
 * Both are compared, so a drift in the fingerprint function cannot hide a
 * drift in the words, nor the other way round.
 */
describe("a village that kept its letter's words keeps every member's letter version", () => {
  // The first village's adopted page, read from its record in the repository.
  const ADOPTED = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/amora/pages/page-love-letter.json"), "utf8")); // brand-ok: the first village's own record, read to prove its letter version held
  /** The covenant paragraphs the platform supplied until 2026-10-23, which a village that adopted its letter also kept. */
  const OLD_OPENING =
    "Something in you called you here. Maybe it was the land itself, alive with possibility. Maybe it was the vision of a village where all beings belong and thrive. Maybe it was simply the feeling that the world you want to live in needs to be built.";
  const OLD_GOVERNANCE =
    "How residents govern themselves, and how we steward this land together, will be co-created by the first residents. Nothing here is handed down. You are not joining a finished system; you are helping write it.";
  const LL = (name: string, token = "Seeds") => ({ project: { name, commitmentName: "Love Letter" }, currency: { name: token } });
  const CASES: Array<[string, unknown, Record<string, any> | null, string]> = [
    ["covenant, entity and contribution", LL("Fernhollow"), CONTENT, "lv-6c3a84231463c518"],
    ["nothing written", LL("Fernhollow"), null, "lv-325212c91db9e647"],
    ["an entity only", LL("Willowbrook", "Thanks"), { legal: { membership: { entityLabel: "Willowbrook Land Trust" } } }, "lv-25cfd7db11e5c2ed"],
    [
      "names holding braces and dollar signs",
      LL("Saint-Clair & Co. $& {token}", "$1 Gratitude"),
      { legal: { membership: { entityLabel: "The {village} Trust $$" } }, covenant: { governance: "We decide together." } },
      "lv-40493f31d67ede2e",
    ],
    ["names with spaces around them", LL("  Fernhollow  ", "  Seeds "), { covenant: { opening: "  An opening.  " } }, "lv-4a90d6f48d4aaec7"],
    ["no name at all", { project: { commitmentName: "Love Letter" } }, null, "lv-83b0b71bf339ecea"],
    ["the letter's name with spaces around it", { project: { name: "Fernhollow", commitmentName: "  Love Letter " }, currency: { name: "Seeds" } }, null, "lv-325212c91db9e647"],
  ];

  /** What the village holds once it kept its words: the adopted page, and the covenant it was reading. */
  const kept = (content: Record<string, any> | null) => ({
    ...(content ?? {}),
    covenant: {
      opening: content?.covenant?.opening ?? OLD_OPENING,
      governance: content?.covenant?.governance ?? OLD_GOVERNANCE,
    },
    [LETTER_PAGE_SECTION]: ADOPTED,
  });

  /** The letter as the old code wrote it, kept verbatim so the comparison is with the code, never with a memory of it. */
  const oldParts = (src: LetterSource) => {
    const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const village = src.villageName;
    const entity = t(src.legal?.membership?.entityLabel) || village;
    return {
      greeting: `Dear Future ${village} Family Member,`,
      opening: t(src.covenant?.opening) || OLD_OPENING,
      joining:
        "By signing this Love Letter, you are not just joining a community. You are becoming a co-creator of the most beautiful village we can imagine together. You are saying yes to regeneration, of the land, of community, of yourself.",
      commitLead: `As a member of ${entity}, you commit to:`,
      commitments: [
        "Treat all beings with respect, compassion, and authentic communication",
        "Participate in community governance through our sociocratic circles",
        "Contribute to the regeneration of the land and ecosystem",
        "Support fellow community members in their growth and wellbeing",
        `Honor the values and agreements of the ${village} community`,
        "Practice Nonviolent Communication and authentic relating",
        "Meet financial obligations as agreed with the community",
        "Show up for community life, circles, celebrations, and shared care",
      ],
      // The ONE sentence that changed on purpose: Rye, 2026-10-22, "remove token
      // economy" (copy never says what a token does). Every other word is the old code's.
      inReturn: `In return, you become a full member of ${entity}, gaining access to community spaces, governance participation, and the opportunity to deepen your involvement through roles, residency, or business creation.`,
      governance: t(src.covenant?.governance) || OLD_GOVERNANCE,
      contribution: t(src.legal?.membership?.contributionParagraph) || null,
      closing: "With love and anticipation,",
      signature: `The ${village} Community`,
    };
  };

  it.each(CASES)("%s: the old code's words, less the one token sentence Rye ruled out, and a pinned fingerprint", (_label, config, content, before) => {
    const src = letterSourceFrom(config, kept(content));
    const now = currentLetter(src);
    expect(now.version).toBe(before);
    expect(letterParts(src)).toEqual(oldParts(src));
    expect(now.body).toBe(letterBody(oldParts(src)));
  });

  it("the first village's own letter, rendered from its records here, is the version it serves (read 2026-10-31)", () => {
    // Its kept page, its covenant and its legal membership section, as the
    // repository records them; production served lv-a14aa38acde23a57 on
    // 2026-10-31, and this branch renders the same words to the same version.
    const record = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/amora", f), "utf8")); // brand-ok: the first village's own records
    const config = { project: { name: "Amora", commitmentName: "Love Letter", memberName: "Amorian" }, currency: { name: "Gratitude" } }; // brand-ok: the first village's settings as production serves them
    const src = letterSourceFrom(config, {
      covenant: record("pages-covenant-seed.json"),
      legal: record("brochure-legal-seed.json"),
      [LETTER_PAGE_SECTION]: record("pages/page-love-letter.json"),
    });
    expect(currentLetter(src).version).toBe("lv-a14aa38acde23a57");
  });

  it("CONTROL: the same village without its kept words reads the starter letter, under a new version", () => {
    const [, config, content, before] = CASES[1];
    const starter = currentLetter(letterSourceFrom(config, content));
    expect(starter.version).not.toBe(before);
    expect(starter.parts.greeting).not.toBe(oldParts(letterSourceFrom(config, kept(content))).greeting);
  });

  it("CONTROL: the fingerprint does move when the stored page changes one word of the letter", () => {
    const [, config, content, before] = CASES[0];
    const edited = letterSourceFrom(config, { ...kept(content), [LETTER_PAGE_SECTION]: { ...ADOPTED, letter: { ...ADOPTED.letter, closing: "With love," } } });
    expect(currentLetter(edited).version).not.toBe(before);
    expect(currentLetter(edited).parts.closing).toBe("With love,");
    // A part the page does not store (the covenant's opening) is untouched.
    expect(currentLetter(edited).parts.opening).toBe(currentLetter(letterSourceFrom(config, kept(content))).parts.opening);
  });
});

/**
 * THE STARTER LETTER (2026-10-23): what every village reads, and aligns with,
 * until it writes its own. Neutral words, true of any village, claiming
 * nothing about its land, its prices or how it decides. Pinned word for word
 * and by fingerprint, so a reworded default is a decision somebody makes on
 * purpose: it is a new letter version for every village that has not written
 * its own.
 */
describe("the starter letter", () => {
  const LL = (name: string, token = "Seeds") => ({ project: { name, commitmentName: "Love Letter" }, currency: { name: token } });
  const CASES: Array<[string, unknown, Record<string, unknown> | null, string]> = [
    ["covenant, entity and contribution", LL("Fernhollow"), CONTENT, "lv-3865b9aefb4d42e1"],
    ["nothing written", LL("Fernhollow"), null, "lv-8b2b6eb8ed0075a0"],
    ["an entity only", LL("Willowbrook", "Thanks"), { legal: { membership: { entityLabel: "Willowbrook Land Trust" } } }, "lv-cf82ed27eeb4dc5c"],
    ["no name for the letter", { project: { name: "Fernhollow" }, currency: { name: "Seeds" } }, null, "lv-444b9d49125ed882"],
  ];

  const starterParts = (src: LetterSource) => {
    const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const village = src.villageName;
    const entity = t(src.legal?.membership?.entityLabel) || village;
    return {
      greeting: `Dear friend of ${village},`,
      opening:
        t(src.covenant?.opening) ||
        "Something in you called you here. Maybe it was the land, or the people you met. Maybe it was simply the feeling that the world you want to live in needs to be built, and that you could help build it.",
      joining: `By signing this ${src.commitmentName}, you become part of ${village}. You are saying yes to the people here, to caring for this place, and to building the village together.`,
      commitLead: `As a member of ${entity}, you commit to:`,
      commitments: [
        "Treat everyone here with respect, care, and honest communication",
        `Take part in how ${village} makes its decisions`,
        "Care for the land and the places we share",
        "Support the people around you in their growth and wellbeing",
        `Honor the values and agreements of the ${village} community`,
        "Meet financial obligations as agreed with the community",
        "Show up for community life, celebrations, and shared care",
      ],
      inReturn: `In return, you become a full member of ${entity}, gaining access to community spaces, governance participation, and the opportunity to deepen your involvement through roles, residency, or business creation.`,
      governance:
        t(src.covenant?.governance) ||
        "How we govern ourselves, and how we care for this place together, is decided by the people who live and work here. Nothing here is handed down, and you will help shape what comes next.",
      contribution: t(src.legal?.membership?.contributionParagraph) || null,
      closing: "With a warm welcome,",
      signature: `The ${village} Community`,
    };
  };

  it.each(CASES)("%s: the starter words, and a pinned fingerprint", (_label, config, content, version) => {
    const src = letterSourceFrom(config, content);
    const now = currentLetter(src);
    expect(letterParts(src)).toEqual(starterParts(src));
    expect(now.body).toBe(letterBody(starterParts(src)));
    expect(now.version).toBe(version);
  });

  it("names no place, price, person or way of deciding that belongs to one village", () => {
    const body = currentLetter(letterSourceFrom(LL("Fernhollow"), null)).body;
    expect(body).not.toMatch(/\d|\$|%/);
    for (const word of ["Costa Rica", "jungle", "sociocra", "Nonviolent", "all beings", "most beautiful", "Family Member"]) {
      expect(body, word).not.toContain(word);
    }
  });

  it("CONTROL: a village with no name for its letter reads the platform's name where the letter says it", () => {
    const parts = letterParts(letterSourceFrom({ project: { name: "Fernhollow" }, currency: { name: "Seeds" } }, null));
    expect(parts.joining.startsWith("By signing this membership agreement, you become")).toBe(true);
  });
});

/**
 * THE SERVER READS THE VILLAGE'S OWN LETTER WORDS, so the letter it serves and
 * stores is the letter the page draws (the page renders the same parts from the
 * same section while the server's copy is on its way).
 */
describe("the letter's own words, from the stored page", () => {
  const PAGE = {
    letter: {
      greeting: "Dear neighbour of {village},",
      joining: "Signing this {commitment} makes you one of us, under {entity}.",
      commitLead: "With {entity}, you promise to:",
      commitments: [{ text: "Plant one tree a {member} can sit under" }, { text: "  " }, { text: "Keep {village} kind" }],
      inReturn: "You hold {token} with everyone else.",
      closing: "Warmly,",
      signature: "Everyone at {village}",
    },
  };
  const src = letterSourceFrom({ ...CONFIG, project: { ...CONFIG.project, memberName: "Fernling" } }, { ...CONTENT, [LETTER_PAGE_SECTION]: PAGE });

  it("fills every field with the village's words, the entity included, and drops a blank commitment", () => {
    const p = letterParts(src);
    expect(p.greeting).toBe("Dear neighbour of Fernhollow,");
    expect(p.joining).toBe("Signing this Love Letter makes you one of us, under Fernhollow Commons.");
    expect(p.commitLead).toBe("With Fernhollow Commons, you promise to:");
    expect(p.commitments).toEqual(["Plant one tree a Fernling can sit under", "Keep Fernhollow kind"]);
    expect(p.inReturn).toBe("You hold Seeds with everyone else.");
    expect(p.closing).toBe("Warmly,");
    expect(p.signature).toBe("Everyone at Fernhollow");
    // The covenant and legal paragraphs still come from their own sections.
    expect(p.opening).toBe(CONTENT.covenant.opening);
    expect(p.contribution).toBe(CONTENT.legal.membership.contributionParagraph);
  });

  it("a member who drew the old words is refused once the village changes them, and handed the new letter", () => {
    const before = currentLetter(SOURCE);
    const judged = judgeSigning(signing("u-tam", { letterVersion: before.version }), src);
    expect("refused" in judged && judged.refused.letter?.parts.closing).toBe("Warmly,");
  });

  it("with no commitments, the line leading into them goes too, from the body as from the page", () => {
    const none = letterSourceFrom(CONFIG, { [LETTER_PAGE_SECTION]: { letter: { commitments: [] } } });
    const p = letterParts(none);
    expect(p.commitments).toEqual([]);
    expect(letterBody(p)).not.toContain(p.commitLead);
  });
});

const configured = testDbConfigured();
if (!configured) console.warn("[membershipLetter] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("the membership letter, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  const state = { viewer: null as { id: string; stage: string } | null };
  const notices: string[] = [];
  let submissions: ReturnType<typeof dbCollection>;

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };

  const sign = async (userId: string | null, letterVersion: string | null = currentLetter(SOURCE).version, id?: string) =>
    landPublicSubmission(submissions, pool, signing(userId, letterVersion ? { letterVersion } : {}, id), SOURCE);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    resetSigningKeyForTests();
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "c".repeat(64) });
    submissions = dbCollection(pool, SUBMISSIONS_SPEC);
    await submissions.load();

    const app = express();
    app.use(express.json());
    const member = (id: string) => ({ ...(PEOPLE[id] ?? { id, name: "Someone", handle: id }), tokenVersion: 0, passwordHash: "x", prefs: {} });
    const guardCapability = async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
      const ctx = { stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (x: string) => LADDER.indexOf(x), roleCapabilities: [] } as unknown as CapabilityCtx;
      if (state.viewer && hasCapability(cap, ctx)) return true;
      res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
      return false;
    };
    registerAlignments(app, {
      authedUser: async () => (state.viewer ? member(state.viewer.id) : null),
      guardCapability,
      getPool: () => pool,
      notify: async (input: any) => {
        notices.push(input.dedupeKey);
        return { inserted: true } as any;
      },
      notifyAdmins: async (_t: string, _title: string, key: string) => {
        notices.push(key);
      },
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null, update: async () => null } as any,
      confirmIdentity: async () => ({ ok: false, body: { error: "not here" } }),
      googleAvailable: () => false,
      authSecret: "test-secret",
      seatCalendar: () => CALENDAR,
      idForHandle: async (h: string) => Object.values(PEOPLE).find((p) => p.handle === h)?.id ?? null,
    } as any);
    registerLetter(app, { letterSource: () => SOURCE });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    state.viewer = { id: "u-tam", stage: "member" };
    notices.length = 0;
  });

  const membershipTexts = async (userId: string) => (await textsForParty(pool, userId)).filter((t) => t.subjectType === MEMBERSHIP);
  const signingRow = async (id: string) => {
    const [rows] = await pool.query<any[]>("SELECT id, user_id, status FROM submissions WHERE id = ?", [id]); // module-review-ok: fixture read of the S5 scratch schema
    return rows[0] ?? null;
  };

  it("GET /api/membership-letter serves the letter and its version to anybody, words and all", async () => {
    state.viewer = null;
    const r = await call("GET", "/api/membership-letter");
    expect(r.status).toBe(200);
    expect(r.body).toEqual(JSON.parse(JSON.stringify(currentLetter(SOURCE))));
  });

  it("ONE TRANSACTION: a new signing writes the row, the text keyed by the letter's version, both parties and the member's click", async () => {
    const letter = currentLetter(SOURCE);
    const entry = signing("u-tam", { letterVersion: letter.version });
    const out = await landPublicSubmission(submissions, pool, entry, SOURCE);
    expect(out.refused).toBeUndefined();
    expect(out.aligned?.textId).toMatch(/^at-[0-9a-f]{16}$/);
    expect((await signingRow(entry.id))?.user_id).toBe("u-tam");

    const text = (await readText(pool, out.aligned!.textId))!;
    expect(text.subjectType).toBe(MEMBERSHIP);
    expect(text.subjectRef).toBe(`${letter.version}:${entry.id}`);
    expect(text.version).toBe(1);
    expect(text.title).toBe("Love Letter");
    // The exact words the page drew, and no typed name: the signer's own name is nowhere in them.
    expect(text.body).toBe(letter.body);
    expect(text.body).not.toContain("u-tam");
    expect(text.settings).toBeNull();
    expect(text.salt).toMatch(/^[0-9a-f]{64}$/);

    const parties = await partiesOf(pool, [text.id]);
    expect(parties.map((p) => [p.partyKey, p.userId, p.capacity, p.required]).sort()).toEqual([
      [userParty("u-tam"), "u-tam", "individually", true],
      [VILLAGE_PARTY, null, "for the village", false],
    ]);
    // The salted hash over the stored words and parties, as every text in the store.
    expect(contentHashOf({ ...text, parties })).toBe(text.contentHash);

    const rows = await alignmentsOf(pool, [text.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partyKey: userParty("u-tam"), userId: "u-tam", method: "click", contentHash: text.contentHash, intentText: "I align with the Love Letter.", authorityRef: null });

    // In force at the member's own click; sealed at once, since this village can sign.
    const v = (await viewText(pool, text.id, "2026-10-14"))!;
    expect(v.derived.state).toBe("in-force");
    expect(v.sealed).toBe(true);
    expect(verifyDocument(v.receipt!, signingKey().publicKeyPem)).toBe(true);
    // The collection's cache knows the row it committed.
    expect(submissions.all().some((s: any) => s.id === entry.id)).toBe(true);
  });

  it("CONTROL, ROLLBACK: a failure inside the transaction takes the signing back with it, cache included", async () => {
    const letter = currentLetter(SOURCE);
    const before = (await membershipTexts("u-oro")).length;
    // A signing id this long cannot name its letter in a 64-character ref: the throw lands after the row was written.
    const longId = `${"9".repeat(45)}-rollback`;
    const entry = signing("u-oro", { letterVersion: letter.version }, longId);
    await expect(landPublicSubmission(submissions, pool, entry, SOURCE)).rejects.toMatchObject({ code: "ML_REF_TOO_LONG" });
    expect(await signingRow(longId)).toBeNull();
    expect(submissions.all().some((s: any) => s.id === longId)).toBe(false);
    expect((await membershipTexts("u-oro")).length).toBe(before);
    // CONTROL: the same signing with an ordinary id lands, so the refusal above was the rollback and not a broken door.
    const ok = await landPublicSubmission(submissions, pool, signing("u-oro", { letterVersion: letter.version }), SOURCE);
    expect(ok.aligned?.textId).toBeTruthy();
    expect((await membershipTexts("u-oro")).length).toBe(before + 1);
  });

  it("THE WORDS SHOWN: a stale version, or none, is refused and nothing is written", async () => {
    const before = (await membershipTexts("u-guest")).length;
    for (const version of ["lv-0000000000000000", null]) {
      const entry = signing("u-guest", version ? { letterVersion: version } : {});
      const out = await landPublicSubmission(submissions, pool, entry, SOURCE);
      expect(out.refused?.error).toBe("letter_changed");
      expect(await signingRow(entry.id)).toBeNull();
    }
    expect((await membershipTexts("u-guest")).length).toBe(before);
    // A visitor's signing names nobody, aligns nobody, and is stored as it always was.
    const stranger = signing(null);
    const out = await landPublicSubmission(submissions, pool, stranger, SOURCE);
    expect(out).toEqual({ proposal: null });
    expect((await signingRow(stranger.id))?.user_id).toBeNull();
  });

  it("LEGACY: a signing from before PR9 is never listed as an alignment, and stays in the journey", async () => {
    // Odile signed before PR9: the row as it was written then, with no text and no hash.
    const legacy = signing("u-old");
    await submissions.insert(legacy);
    expect(await membershipTexts("u-old")).toEqual([]);

    state.viewer = { id: "u-old", stage: "member" };
    expect((await call("GET", "/api/profile/alignments")).body.alignments).toEqual([]);
    state.viewer = { id: "u-tam", stage: "member" };
    expect((await call("GET", "/api/alignments?party=odilef")).body.alignments).toEqual([]);
    const reg = await call("GET", "/api/aligned?kind=membership");
    expect(reg.body.rows.some((r: any) => r.parties.some((p: any) => p.partyKey === userParty("u-old")))).toBe(false);
    // The journey keeps showing it, as a signing.
    expect(await legacySigningOf(pool, submissions.all(), "u-old")).toEqual({ at: legacy.submittedAt, answer: "waiting" });

    // CONTROL: Tam's signing aligned her, so her journey shows nothing and her profile lists the letter.
    expect(await legacySigningOf(pool, submissions.all(), "u-tam")).toBeNull();
    const mine = (await call("GET", "/api/profile/alignments")).body.alignments;
    expect(mine.map((a: any) => [a.kind, a.title, a.state, a.answer])).toEqual([[MEMBERSHIP, "Love Letter", "in-force", "waiting"]]);
    expect(mine[0].intent).toBe("I align with the Love Letter.");
    // No notice and no ask on a letter: it ends when she leaves.
    expect(mine[0].you.acts).toEqual({ mayGiveNotice: false, notice: null, mayEndByAgreement: false, ask: null });
    // And once Odile aligns, her newest signing leaves the journey for the profile.
    await sign("u-old");
    expect(await legacySigningOf(pool, submissions.all(), "u-old")).toBeNull();
  });

  it("THE REGISTER: a member reads the Membership letter kind; a guest and a visitor get 401", async () => {
    const r = await call("GET", "/api/aligned");
    expect(r.status).toBe(200);
    expect(r.body.kinds).toEqual([
      { id: "seat_terms", label: "Role terms" },
      { id: "membership", label: "Membership letter" },
    ]);
    const letters = await call("GET", "/api/aligned?kind=membership");
    expect(letters.body.rows.length).toBeGreaterThan(0);
    for (const row of letters.body.rows) {
      expect(row.kind).toBe(MEMBERSHIP);
      expect(row.kindLabel).toBe("Membership letter");
      expect(row.title).toBe("Love Letter");
      // The village need not align, so nobody reads it as waiting, and no vote or holder is invented for it.
      expect(row.parties.find((p: any) => p.partyKey === VILLAGE_PARTY)).toMatchObject({ required: false, aligned: false, capacity: "for the village" });
      expect(row.village).toBeNull();
      // The village's answer to a signing is the member's own business.
      expect(row).not.toHaveProperty("answer");
    }
    // Tam's own row carries her hash; Oro's, read by Tam, does not.
    expect(letters.body.rows.find((x: any) => x.parties.some((p: any) => p.partyKey === userParty("u-oro"))).contentHash).toBeNull();
    // A search finds a letter by its words.
    const found = await call("GET", "/api/aligned?q=grove");
    expect(found.body.rows.some((x: any) => x.kind === MEMBERSHIP)).toBe(true);

    for (const viewer of [null, { id: "u-guest", stage: "guest" }]) {
      state.viewer = viewer;
      for (const url of ["/api/aligned", "/api/aligned?kind=membership", "/api/aligned?q=grove"]) {
        const refused = await call("GET", url);
        expect(refused.status, `${viewer?.stage ?? "visitor"} ${url}`).toBe(401);
        expect(refused.body).not.toHaveProperty("rows");
      }
    }
  });

  it("A HASH MISMATCH is refused, as for any text, and the one the text carries is already aligned", async () => {
    const [t] = await membershipTexts("u-tam");
    const wrong = await call("POST", "/api/profile/alignments", { textId: t.id, contentHash: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe("hash_mismatch");
    // CONTROL: the right hash is answered, and changes nothing: she aligned at the signing.
    const right = await call("POST", "/api/profile/alignments", { textId: t.id, contentHash: t.contentHash });
    expect(right.status).toBe(200);
    expect(right.body.already).toBe(true);
    expect(await alignmentsOf(pool, [t.id])).toHaveLength(1);
  });

  it("notice and ending by agreement refuse a letter: it ends when its member leaves", async () => {
    const [t] = await membershipTexts("u-tam");
    for (const url of [`/api/profile/alignments/${t.id}/notice`, `/api/profile/alignments/${t.id}/end-by-agreement`]) {
      const r = await call("POST", url);
      expect(r.status, url).toBe(409);
      expect(r.body.error).toBe("ends_on_leaving");
    }
    const direct = await giveNotice(pool, { textId: t.id, partyKey: userParty("u-tam"), actorId: "u-tam", now: new Date(), timezone: "UTC" });
    expect(direct.ok).toBe(false);
    expect(await endingsOf(pool, [t.id])).toEqual([]);
  });

  it("signing again supersedes the letter in force, in the same transaction; the sweep seals and tells nobody", async () => {
    const before = await membershipTexts("u-oro");
    expect(before).toHaveLength(1);
    const [first] = before;
    const again = await sign("u-oro");
    const second = (await readText(pool, again.aligned!.textId))!;
    expect(second.version).toBe(first.version + 1);
    expect(second.supersedesId).toBe(first.id);
    expect(again.aligned?.superseded).toBe(first.id);
    expect((await endingsOf(pool, [first.id])).map((e) => [e.kind, e.refersTo])).toEqual([["superseded", second.id]]);
    expect((await viewText(pool, first.id, "2026-10-14"))!.derived.state).toBe("ended");
    expect((await viewText(pool, second.id, "2026-10-14"))!.derived.state).toBe("in-force");

    // The hourly sweep: nothing to tell anybody about a letter, and every letter is sealed.
    const deps = { getPool: () => pool, notify: async (i: any) => void notices.push(i.dedupeKey), notifyAdmins: async (_t: string, _x: string, k: string) => void notices.push(k), today: () => "2026-10-14" };
    await settleAll(deps as any);
    expect(notices.filter((k) => k.includes(second.id) || k.includes(first.id))).toEqual([]);
    expect((await sealsOf(pool, [first.id, second.id])).length).toBe(2);
  });

  it("a letter written while the village cannot sign is in force unsealed, and the sweep seals it once the key is back; a sealed letter is never swept again", async () => {
    resetSigningKeyForTests();
    const out = await sign("u-guest");
    const v = (await viewText(pool, out.aligned!.textId, "2026-10-14"))!;
    expect(v.derived.state).toBe("in-force");
    expect(v.sealed).toBe(false);
    expect(await textsToSettle(pool)).toContain(v.text.id);
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "c".repeat(64) });
    const told: string[] = [];
    await settleAll({
      getPool: () => pool,
      notify: async (i: any) => void told.push(i.dedupeKey),
      notifyAdmins: async (_t: string, _x: string, k: string) => void told.push(k),
      today: () => "2026-10-14",
    } as any);
    // The sweep read it, sealed it, and told nobody: not the member, and not every admin through the village party.
    expect(told.filter((k) => k.includes(v.text.id))).toEqual([]);
    const [seal] = await sealsOf(pool, [v.text.id]);
    expect(verifyDocument(seal.receipt, signingKey().publicKeyPem)).toBe(true);
    // Sealed, in force, nobody to tell: nothing left for the hourly sweep to read.
    expect(await textsToSettle(pool)).not.toContain(v.text.id);
  });

  it("ERASURE AND PARTY LEFT: leaving ends Tam's letter, her name is in no alignment table, and every seal still verifies", async () => {
    await pool.query("INSERT INTO users (id, name, email, password_hash, handle) VALUES (?,?,?, 'x', ?)", ["u-tam", PEOPLE["u-tam"].name, PEOPLE["u-tam"].email, "tamr"]); // module-review-ok: the leaver's user row in the S5 scratch schema
    const [hers] = await membershipTexts("u-tam");
    // Oro's letter in force: his second. Two signings in one second tie on created_at, so pick by version.
    const oros = (await membershipTexts("u-oro")).sort((a, b) => b.version - a.version)[0];
    // Oro's own copy of his words, as he downloaded it before Tam left.
    const orosCopy = { ...oros, parties: await partiesOf(pool, [oros.id]) };

    const tables = ["alignment_texts", "alignment_parties", "alignments", "alignment_seals", "alignment_endings"];
    const everything = async () => {
      const parts: string[] = [];
      for (const t of tables) {
        const [rows] = await pool.query<any[]>(`SELECT * FROM ${t}`); // module-review-ok: fixture read of the S5 scratch schema, the whole point of an erasure assertion
        parts.push(JSON.stringify(rows));
      }
      return parts.join("\n");
    };
    // CONTROL: the covenant named her, so every letter's words carry her name before she leaves.
    expect(hers.body).toContain("Tamsin Reedwarbler");
    expect(oros.body).toContain("Tamsin Reedwarbler");

    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "village-letter-"));
    clearMemberDrivers();
    const deps: ErasureDeps = {
      members: { byId: (id: string) => usersRepo(pool).byId(id), update: (id: string, fn: (u: any) => void) => usersRepo(pool).update(id, fn) },
      submissionsRepo: { all: () => [], replaceAll: async () => {} },
      roleHoldersRepo: { remove: async () => {} },
      withRoleHolderLock: (fn) => fn(),
      loadRoleHolders: () => [],
      uploadsDir: uploads,
    };
    try {
      await anonymizeMember(pool, await usersRepo(pool).byId("u-tam"), null, deps);
    } finally {
      fs.rmSync(uploads, { recursive: true, force: true });
    }

    // PARTY LEFT: the erasure sweep ended her letter, and only hers.
    expect((await endingsOf(pool, [hers.id])).map((e) => [e.kind, e.partyKey])).toEqual([["party_left", userParty("u-tam")]]);
    const v = (await viewText(pool, hers.id, "2026-10-14", "UTC", new Date()))!;
    expect(v.derived.state).toBe("ended");
    expect(v.derived.ending?.kind).toBe("party_left");
    expect((await viewText(pool, oros.id, "2026-10-14"))!.derived.state).toBe("in-force");
    // A resumed sweep writes nothing twice.
    expect(await recordPartyLeft(pool, "u-tam", new Date())).toEqual([]);

    // ERASURE: her name and handle are in none of the five tables.
    const after = await everything();
    expect(after).not.toContain("Reedwarbler");
    expect(after.toLowerCase()).not.toMatch(/\btamr\b/);
    // The words stay, de-attributed, and the hashes and seals are untouched.
    for (const t of [hers, oros]) {
      const now = (await readText(pool, t.id))!;
      expect(now.body).toContain("a former member planted the first grove");
      expect(now.redactedAt).not.toBeNull();
      expect(now.contentHash).toBe(t.contentHash);
      const [seal] = await sealsOf(pool, [t.id]);
      expect(verifyDocument(seal.receipt, signingKey().publicKeyPem)).toBe(true);
      expect(seal.receipt.contentHash).toBe(t.contentHash);
    }
    // Oro's own copy of the words still hashes to the hash he aligned with.
    expect(contentHashOf(orosCopy)).toBe(oros.contentHash);
  });
});
