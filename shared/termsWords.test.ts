/**
 * THE EIGHT SETTINGS AND THE COMMITMENT (joining lane PR 3).
 *
 * Each written setting is answered or the step is refused; commitment is required, 0 to 100 in
 * tens, no default; legacy proposals and roles with hours still read; commitment is read by no
 * pay or valuation code; and no copy in the joining flow says hours.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMITMENT_CHOICES, TERM_KEYS, judgeTermsStep, notesAsText, overallChoice, termsStepOf, writtenKeys } from "./termsWords";
import { parseSeatSettings } from "./seatSettings";
import { parseCard, cardOf, cardSummary } from "./openProposalCard";
import { parseApplicationAnswers, parseApplicationInput } from "./seatApplications";
import { roleCardView } from "./roleCardView";
import { roleCardGate } from "./roleParams";

const ROOT = path.resolve(import.meta.dirname, "..");
const accept = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, { choice: "accept", note: "" }]));

describe("the terms step", () => {
  it("refuses until every written setting is answered, and names the first one left", () => {
    const written = ["term", "clocks", "ending"] as const;
    const r = judgeTermsStep({ answers: accept(["term", "ending"]), commitmentPct: 50 }, written);
    expect(r).toMatchObject({ ok: false, key: "clocks" });
    expect(judgeTermsStep({ answers: accept(written), commitmentPct: 50 }, written).ok).toBe(true);
  });

  it("asks nothing of a setting the role has not written", () => {
    expect(judgeTermsStep({ answers: {}, commitmentPct: 0 }, []).ok).toBe(true);
    expect(writtenKeys([{ words: { term: "x", rhythm: "  " } }])).toEqual(["term"]);
    // A role that asks a commitment has written Clocks.
    expect(writtenKeys([{ commitmentPct: 100 }])).toEqual(["clocks"]);
  });

  it("answers each setting with accept or talk, and refuses anything else", () => {
    for (const k of TERM_KEYS) {
      expect(judgeTermsStep({ answers: { [k]: { choice: "maybe" } }, commitmentPct: 10 }, []).ok, k).toBe(false);
      expect(judgeTermsStep({ answers: { [k]: { choice: "talk", note: "x" } }, commitmentPct: 10 }, [k]).ok, k).toBe(true);
    }
  });

  it("makes commitment required: 0 to 100 in tens, no default", () => {
    for (const bad of [undefined, null, "", "50", 5, 55, -10, 110, NaN]) expect(judgeTermsStep({ answers: {}, commitmentPct: bad }, []).ok, String(bad)).toBe(false);
    for (const n of COMMITMENT_CHOICES) expect(judgeTermsStep({ answers: {}, commitmentPct: n }, []).ok, String(n)).toBe(true);
    expect(COMMITMENT_CHOICES).toHaveLength(11);
    // 0 is a choice, not an absence.
    expect(termsStepOf({ answers: {}, commitmentPct: 0 })?.commitmentPct).toBe(0);
    expect(termsStepOf({ answers: {} })).toBeNull();
  });

  it("reads talk notes as one line each, and the overall choice follows the answers", () => {
    const a = { term: { choice: "talk", note: "shorter trial" }, ending: { choice: "accept", note: "" }, bonus: { choice: "talk", note: "" } } as const;
    expect(overallChoice(a)).toBe("talk");
    expect(notesAsText(a)).toBe("Term: shorter trial\nBonus: let's talk");
    expect(overallChoice({ term: { choice: "accept", note: "" } })).toBe("accept");
  });
});

describe("a role's suggestions and commitment", () => {
  it("stores one wording per setting and a commitment in Clocks", () => {
    const ok = parseSeatSettings({ v: 1, clocks: { commitmentPct: 100 }, words: { term: "Each moon.", goals: "Three to five." } });
    expect(ok.ok).toBe(true);
    expect(ok.settings?.words?.goals).toBe("Three to five.");
    expect(ok.settings?.clocks?.commitmentPct).toBe(100);
  });
  it("refuses a commitment that is not a step of ten, and an unknown setting", () => {
    expect(parseSeatSettings({ v: 1, clocks: { commitmentPct: 45 } }).ok).toBe(false);
    expect(parseSeatSettings({ v: 1, words: { pay: "x" } }).ok).toBe(false);
  });
  it("points a commitment written outside Clocks to Clocks, in its own words", () => {
    const r = parseSeatSettings({ v: 1, commitmentPct: 40 });
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.message).toMatch(/set under Clocks/);
  });
  it("refuses payment details in a wording", () => {
    expect(parseSeatSettings({ v: 1, words: { allowance: "IBAN GB82WEST12345698765432" } }).ok).toBe(false);
  });
  it("shows Commitment on the role card, and the old hours text no longer shows", () => {
    const view = roleCardView({ timeCommitment: "40 hours a week", card: { commitmentPct: 60 } });
    expect(view.rows.find((r) => r.id === "commitment")?.lines).toEqual(["60%"]);
    expect(JSON.stringify(view)).not.toMatch(/hour/i);
    // Still readable: the stored text is untouched, and a card with no commitment shows no row.
    expect(roleCardView({ timeCommitment: "40 hours a week", card: {} }).rows).toEqual([]);
  });
  it("lets a stated commitment complete the card where the time text did", () => {
    const input = { aim: "a", domain: "d", accountabilities: ["x"], timeCommitment: null, track: "volunteer", payKind: null, hasRange: false, hasTerm: true, villageGoals: ["g"], selectionCriteria: ["c"], conversations: [] } as any;
    expect(roleCardGate(input).missing).toContain("hours");
    expect(roleCardGate({ ...input, commitmentPct: 100 }).missing).not.toContain("hours");
  });
});

describe("the open form's card", () => {
  const ctx = { roleIds: new Set(["r1"]), accountabilitiesOf: () => [], goalIds: new Set<string>() };
  const base = { roles: [{ roleId: "r1", moves: [], firstMoon: [{ quest: "Open the books", doneWhen: "every circle lead has read them" }] }], serves: [], agreed: { nda: true } };
  it("is refused without a commitment, or a written setting left unanswered", () => {
    expect(parseCard({ ...base, terms: { answers: {} } }, ctx)).toMatchObject({ ok: false, field: "terms" });
    expect(parseCard({ ...base, commitmentPct: 50, terms: { answers: {} } }, { ...ctx, writtenTerms: ["bonus"] })).toMatchObject({ ok: false, field: "terms" });
  });
  it("keeps the answers, derives the old choice and note, and sends no hours", () => {
    const r = parseCard({ ...base, hours: "40 hours a week", commitmentPct: 80, terms: { answers: { bonus: { choice: "talk", note: "the mix" }, term: { choice: "accept" } } } }, { ...ctx, writtenTerms: ["term", "bonus"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.commitmentPct).toBe(80);
    expect(r.card.hours).toBe("");
    expect(r.card.terms).toMatchObject({ choice: "talk", note: "Bonus: the mix" });
    expect(cardSummary(r.card, () => "R", () => "")).toContain("Commitment: 80%");
    expect(cardSummary(r.card, () => "R", () => "")).not.toMatch(/hour/i);
  });
  it("still reads a card sent with hours and a plain accept (a legacy proposal)", () => {
    const old = cardOf({ ...base, hours: "roughly 25 hours a week", terms: { choice: "accept", note: "" } });
    expect(old?.hours).toBe("roughly 25 hours a week");
    expect(old?.terms).toEqual({ choice: "accept", note: "" });
    expect(old?.commitmentPct).toBeUndefined();
  });
});

describe("the member door's answers", () => {
  it("keeps the answers and commitment, and reads an older application without them", () => {
    const a = parseApplicationAnswers({ aim: "x", terms: { choice: "talk", note: "n", answers: { term: { choice: "talk", note: "n" } }, commitmentPct: 70 } });
    expect(a?.terms).toMatchObject({ choice: "talk", commitmentPct: 70, answers: { term: { choice: "talk", note: "n" } } });
    expect(parseApplicationAnswers({ aim: "x", terms: { choice: "accept", note: "" } })?.terms).toEqual({ choice: "accept", note: "" });
  });
  it("refuses an answer set with no commitment", () => {
    const body = { seatIds: ["a"], answers: { terms: { choice: "accept", note: "", answers: { term: { choice: "accept" } } } } };
    expect(parseApplicationInput(body)).toMatchObject({ ok: false, field: "terms" });
    expect(parseApplicationInput({ ...body, answers: { terms: { ...body.answers.terms, commitmentPct: 30 } } }).ok).toBe(true);
  });
});

// ── No pay code reads it, and no joining copy says hours ───────────────────────

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const src = (dir: string) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).map((n) => `${dir}/${n}`);
const PAY = /(valuation|pricing|payee|payout|payment|workPay|rolePay|questPay|contributionPay|ledger|settle|exchange|economy|cyclePool|treasury)/i;

describe("commitment is a planning signal", () => {
  const payFiles = [...src("server/lib"), ...src("server/routes"), ...src("shared")].filter((f) => PAY.test(path.basename(f)));
  it("is read by no pay, valuation or ledger module", () => {
    expect(payFiles.length).toBeGreaterThan(20);
    for (const f of payFiles) {
      const code = read(f);
      expect(code, f).not.toMatch(/commitmentPct|termsWords|clocks\??\.commitment/);
    }
  });
  it("control: the scan sees a module that does read it", () => {
    expect(read("shared/termsWords.ts")).toMatch(/commitmentPct/);
    expect(PAY.test("valuationEngine.ts")).toBe(true);
  });
});

describe("no hours in the joining flow", () => {
  const copyOf = (f: string) =>
    // Strings and JSX text only: comments are not copy.
    read(f)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const FILES = [
    "client/src/components/openProposal/RoleCardBridge.tsx",
    "client/src/components/governance/TermsEight.tsx",
    "client/src/components/governance/TermsOnOfferField.tsx",
    "client/src/pages/ProposeARole.tsx",
    "shared/termsWords.ts",
  ];
  it("says nothing about hours in the open form, the role card or the terms step", () => {
    for (const f of FILES) {
      const hits = copyOf(f).match(/[^\n]*\bhours?\b[^\n]*/gi) ?? [];
      // The one allowed line is the hint that says commitment is never hours, and the open form's own 48-hour retention note.
      const bad = hits.filter((l) => !/never hours/i.test(l) && !/48 hours/i.test(l));
      expect(bad, f).toEqual([]);
    }
    expect(JSON.stringify(roleCardView({ card: { commitmentPct: 100 } }))).not.toMatch(/hour/i);
  });
  it("control: the scan would catch a line that did", () => {
    expect("Time: roughly 25 hours a week".match(/\bhours?\b/i)).not.toBeNull();
  });
});
