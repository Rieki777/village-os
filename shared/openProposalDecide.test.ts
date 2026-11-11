import { describe, expect, it } from "vitest";
import {
  applicantUpdate,
  replyPromise,
  adoptedAccountLetter,
  adoptedInviteLetter,
  declinedLetter,
  DECIDE_WORDS,
  greetingName,
  openInviteId,
  openProposalHref,
  OPEN_PROPOSAL_ID,
  proposalOfInvite,
  whyNotSent,
} from "./openProposalDecide";
import { readWaiting } from "./waitingOnYou";
import { agreedTerms, seatCountLine, SEAT_OPENS_WORDS, ADOPT_MORE } from "./openProposalDecide";
import { withAgreedWords } from "./termsWords";
import { NOT_SET, settingsWords } from "./seatSettings";

const ID = "op-0123456789abcdef0123";

describe("open proposals, the decision: the pure half", () => {
  it("names the invitation after the proposal, and reads the proposal back off only that shape", () => {
    expect(OPEN_PROPOSAL_ID.test(ID)).toBe(true);
    expect(openInviteId(ID)).toBe(`inv-open-${ID}`);
    expect(proposalOfInvite(openInviteId(ID))).toBe(ID);
    expect(proposalOfInvite(`inv-join-${ID}`)).toBeNull();
    expect(proposalOfInvite("inv-open-rp-0123456789abcdef")).toBeNull();
    expect(openProposalHref(ID)).toBe(`/open-proposals/${ID}`);
  });

  it("greets by first name, and by nobody when the name is an address or too long", () => {
    expect(greetingName("Rowan Field")).toBe("Rowan");
    expect(greetingName("rowan@example.test")).toBeNull();
    expect(greetingName("  ")).toBeNull();
    expect(greetingName("x".repeat(41))).toBeNull();
  });

  it("says why an email did not go", () => {
    expect(whyNotSent({ reason: "not_configured" })).toBe("not_set_up");
    expect(whyNotSent({ reason: "no_api_key" })).toBe("not_set_up");
    expect(whyNotSent({ reason: "bad_address" })).toBe("bad_address");
    expect(whyNotSent({ reason: "provider_error" })).toBe("failed");
    expect(DECIDE_WORDS.adoptedNotEmailed("not_set_up")).toBe("Adopted. Email is not set up yet, so nothing went out. Copy their invitation below and send it to them yourself.");
  });

  it("the letters name the village, the roles and the next step", () => {
    const base = { firstName: "Rowan", village: "Test Village", roleNames: ["Gate Keeper", "Well Keeper"], season: "Season of Roots", startsOn: "1 January 2099" };
    const yes = adoptedInviteLetter({ ...base, link: "https://v.test/register?invite=abc", days: 14 });
    expect(yes.subject).toBe("Test Village adopted your proposal");
    expect(yes.text).toContain("Hi Rowan,");
    expect(yes.text).toContain("Test Village adopted your proposal to hold Gate Keeper and Well Keeper next season.");
    expect(yes.text).toContain("https://v.test/register?invite=abc");
    expect(yes.text).toContain("It works once and lasts 14 days. Your roles start when Season of Roots begins, on 1 January 2099.");
    const account = adoptedAccountLetter({ ...base, firstName: null, season: null, signIn: "https://v.test/profile" });
    expect(account.text.startsWith("Hi,\n")).toBe(true);
    expect(account.text).toContain("Your roles start when next season begins, on 1 January 2099.");
    expect(account.text).not.toContain("invite");
    const no = declinedLetter({ firstName: "Rowan", village: "Test Village", roleNames: ["Gate Keeper"], site: "https://v.test" });
    expect(no.subject).toBe("Your proposal to Test Village");
    expect(no.text).toContain("Thank you for proposing to hold Gate Keeper in Test Village. We can't say yes this time.");
  });

  it("the task board reads its open proposal rows, and a server without them reads as none", () => {
    const row = { id: ID, href: `/open-proposals/${ID}`, roles: ["Gate Keeper"], circles: ["Land Circle"], proposer: "Rowan", ask: "consent", closesOn: "2099-01-03", confirmedOn: "2099-01-01" };
    const read = readWaiting({ applications: [], drafts: [], openProposals: [row, { id: 3 }, { ...row, id: "op-x", ask: "vote" }] });
    expect(read?.openProposals).toEqual([row]);
    expect(readWaiting({ applications: [], drafts: [] })?.openProposals).toEqual([]);
  });

  it("the reply promise carries the village's number, and the kind no carries no reasons of its own", () => {
    expect(replyPromise(7)).toBe("We reply within 7 days.");
    expect(replyPromise(1)).toBe("We reply within 1 day.");
    const no = declinedLetter({ firstName: null, village: "Test Village", roleNames: ["Gate Keeper"], site: "https://v.test" });
    expect(no.text).toContain("https://v.test/quests");
    expect(no.text).not.toMatch(/because|unfortunately|reason/i);
    const u = applicantUpdate("first_reply", { firstName: "Rowan", village: "Test Village", roleNames: ["Gate Keeper"], replyDays: 5 });
    expect(u.text).toContain("We reply within 5 days.");
  });
});

// ── Audit B2, B3, P11 (11 Nov 2026) ──────────────────────────────────────────

describe("what was agreed is what is signed", () => {
  const base = { term: "We renew each moon.", ending: "One moon's notice." };
  const rev = (n: number, changes: Array<{ key: any; from: string | null; to: string | null }>) => ({ n, at: "2026-11-11T00:00:00.000Z", byId: "u", by: "U", changes });

  it("takes the latest revision's words, the accepted commitment, and the reply to each changed setting", () => {
    const co = { revisions: [rev(1, [{ key: "ending", from: "One moon's notice.", to: "Two moons' notice." }, { key: "commitment", from: "60", to: "80" }])], replies: { ending: { choice: "accept" as const, note: "", rev: 1, at: "" }, commitment: { choice: "accept" as const, note: "", rev: 1, at: "" } } };
    const a = agreedTerms({ base, answers: { term: { choice: "accept", note: "" }, ending: { choice: "talk", note: "Two would suit me." } }, theirs: 60, co });
    expect(a.words).toEqual({ term: "We renew each moon.", ending: "Two moons' notice." });
    expect(a.commitmentPct).toBe(80);
    expect(a.answers.ending).toEqual({ choice: "accept", note: "" });
    expect(a.answers.term).toEqual({ choice: "accept", note: "" });
    expect(a.open).toEqual([]);
  });

  it("a changed setting nobody answered stays a talk, and is listed open", () => {
    const co = { revisions: [rev(1, [{ key: "ending", from: "One moon's notice.", to: "Two moons' notice." }])], replies: {} };
    const a = agreedTerms({ base, answers: { ending: { choice: "accept", note: "" } }, theirs: 50, co });
    expect(a.answers.ending?.choice).toBe("talk");
    expect(a.open).toEqual(["ending"]);
    expect(a.commitmentPct).toBe(50);
  });

  it("the rows the holder aligns with carry the agreed words and the commitment, so nothing reads as unset", () => {
    const rows = withAgreedWords(settingsWords({ v: 1, clocks: { commitmentPct: 80 }, words: { ending: "Two moons' notice.", goals: "Three a moon." } }), { ending: "Two moons' notice.", goals: "Three a moon." }, 80, NOT_SET);
    const by = (g: string) => rows.find((r) => r.group === g)!;
    expect(by("ending")).toMatchObject({ set: true, headline: "Two moons' notice." });
    expect(by("quests")).toMatchObject({ set: true, headline: "Three a moon." });
    expect(by("clocks")).toMatchObject({ set: true, headline: "Commitment: 80%" });
    expect(by("pay").set).toBe(false);
  });
});

describe("a role with every place filled", () => {
  it("says the count, and the holder's words never promise the hour", () => {
    expect(seatCountLine({ name: "Lead Financial Steward", seats: 1, taken: 1 })).toBe("Lead Financial Steward has room for 1 person, and that place is filled");
    expect(DECIDE_WORDS.seatsFull([{ name: "Cook", seats: 2, taken: 2 }])).toContain("Cook has room for 2 people, and both places are filled.");
    expect(SEAT_OPENS_WORDS.after(["Cook"])).not.toMatch(/within the hour/);
    const base = { firstName: "Ana", village: "Test Village", roleNames: ["Cook"], season: null, startsOn: "1 May 2099", moon: { from: "1 May", to: "29 May" } };
    for (const lang of ["en", "es"] as const) {
      const yes = adoptedInviteLetter({ ...base, lang, link: "https://x.test/i", days: 7, waitsForSeat: true });
      expect(yes.text).toContain(ADOPT_MORE[lang].seatOpens("Cook"));
      expect(yes.text).not.toContain("1 May");
      const acc = adoptedAccountLetter({ ...base, lang, signIn: "https://x.test/profile" });
      expect(acc.text).toContain(ADOPT_MORE[lang].nextHeading);
      expect(acc.text).toContain(ADOPT_MORE[lang].stepSignIn);
    }
  });
});
