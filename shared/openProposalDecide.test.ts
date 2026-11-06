import { describe, expect, it } from "vitest";
import {
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
    const no = declinedLetter({ firstName: "Rowan", village: "Test Village", roleNames: ["Gate Keeper"] });
    expect(no.subject).toBe("Your proposal to Test Village");
    expect(no.text).toContain("Thank you for proposing to hold Gate Keeper in Test Village. We can't say yes this time.");
  });

  it("the task board reads its open proposal rows, and a server without them reads as none", () => {
    const row = { id: ID, href: `/open-proposals/${ID}`, roles: ["Gate Keeper"], circles: ["Land Circle"], proposer: "Rowan", ask: "consent", closesOn: "2099-01-03", confirmedOn: "2099-01-01" };
    const read = readWaiting({ applications: [], drafts: [], openProposals: [row, { id: 3 }, { ...row, id: "op-x", ask: "vote" }] });
    expect(read?.openProposals).toEqual([row]);
    expect(readWaiting({ applications: [], drafts: [] })?.openProposals).toEqual([]);
  });
});
