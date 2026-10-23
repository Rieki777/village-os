import { describe, expect, it } from "vitest";
import { buildCircleCard, holderCardHref, type CircleCardIn, type CircleSection } from "./circleCard";
import { charterFromRow, EMPTY_CHARTER, readStoredValues } from "./circleCharter";
import { CCOS_TERMS, CIRCLE_HEADINGS, CIRCLE_SECTION_KEYS } from "./circleCardWords";
import { ROLE_ANCHOR } from "./playerCard";

const base = (over: Partial<CircleCardIn> = {}): CircleCardIn => ({
  circle: { id: "c-garden", name: "Garden circle", purpose: "Grow food together.", status: "active", parent: { id: "c-root", name: "Coordinating circle" } },
  charter: { ...EMPTY_CHARTER, existsWhile: "the village eats from its own land", accountabilities: ["One", "Two", "Three"] },
  roles: [],
  adoptions: [],
  timeZone: "UTC",
  frameworkTerms: true,
  ...over,
});
const find = (sections: CircleSection[], key: string) => sections.find((s) => s.key === key)!;

describe("the circle card model", () => {
  it("draws every section in the card's order, each heading in plain words with its CCOS term", () => {
    const card = buildCircleCard(base());
    expect(card.sections.map((s) => s.key)).toEqual([...CIRCLE_SECTION_KEYS]);
    for (const s of card.sections) {
      expect(s.heading).toBe(CIRCLE_HEADINGS[s.key]);
      expect(s.term).toBe(`CCOS: ${CCOS_TERMS[s.key]}`);
    }
    expect(card.header.existsWhileTerm).toBe("CCOS: Purpose, while the circle is needed");
    expect(card.header.termsKey).toContain("CCOS term");
  });

  it("keeps the plain headings and drops every term when the village turns them off", () => {
    const card = buildCircleCard(base({ frameworkTerms: false }));
    expect(card.sections.every((s) => s.term === null)).toBe(true);
    expect(card.header.existsWhileTerm).toBeNull();
    expect(card.header.termsKey).toBeNull();
  });

  it("an unread charter draws nothing, an unwritten one draws its words", () => {
    const unread = buildCircleCard(base({ charter: undefined, roles: undefined, adoptions: undefined }));
    for (const key of ["accountabilities", "domains", "values", "roles", "adoption"]) {
      expect(find(unread.sections, key).slot).toEqual({ kind: "unread" });
    }
    expect(unread.header.existsWhile).toEqual({ kind: "unread" });
    const unwritten = buildCircleCard(base({ charter: null }));
    expect(find(unwritten.sections, "domains").slot).toEqual({ kind: "empty", words: "Not written yet" });
    expect(unwritten.header.existsWhile).toEqual({ kind: "empty", words: "not written yet" });
  });

  it("says the 3 to 6 floor once when fewer than three accountabilities are written", () => {
    const two = buildCircleCard(base({ charter: { ...EMPTY_CHARTER, accountabilities: ["One", "Two"] } }));
    const acc = find(two.sections, "accountabilities") as Extract<CircleSection, { kind: "list" }>;
    expect(acc.note).toBe("2 lines written. A circle answers for 3 to 6 things.");
    const three = buildCircleCard(base());
    expect((find(three.sections, "accountabilities") as Extract<CircleSection, { kind: "list" }>).note).toBeNull();
  });

  it("names each role by its full title, never a person, and links holders by handle only", () => {
    const card = buildCircleCard(
      base({
        roles: [
          { id: "r-1", name: "Water Keeper", capacity: 2, holderCount: 2, state: "filled", holderHandles: ["cai", "gil"] },
          { id: "r-2", name: "Seed Librarian", capacity: 1, holderCount: 0, state: "open", holderHandles: [] },
          { id: "r-3", name: "Example Role", capacity: 1, holderCount: 0, state: "open", isExample: true, holderHandles: [] },
        ],
      }),
    );
    const roles = find(card.sections, "roles") as Extract<CircleSection, { kind: "roles" }>;
    const rows = roles.slot.kind === "shown" ? roles.slot.value : [];
    expect(rows[0]!.holderCards.map((h) => h.ariaLabel)).toEqual([
      "See the card of holder 1 of Water Keeper",
      "See the card of holder 2 of Water Keeper",
    ]);
    expect(rows[0]!.href).toBe("/roles?seat=r-1");
    expect(rows[1]!.applyHref).toBe("/propose?type=role_application&seat=r-2");
    expect(rows[2]!.applyHref).toBeNull();
    expect(roles.note).toBeNull();
  });

  it("says once why a visitor's filled roles carry no card links", () => {
    const card = buildCircleCard(
      base({ roles: [{ id: "r-1", name: "Water Keeper", capacity: 1, holderCount: 1, state: "filled", holderHandles: undefined }] }),
    );
    const roles = find(card.sections, "roles") as Extract<CircleSection, { kind: "roles" }>;
    expect(roles.note).toBe("Sign in to open the holders' cards.");
  });

  it("lands a holder's link on that role's section of their player card", () => {
    expect(holderCardHref("cai", "r-1")).toBe(`/profile/cai#${ROLE_ANCHOR("r-1")}`);
  });

  it("orders the adoptions newest first and says which the village voted in", () => {
    const card = buildCircleCard(
      base({
        adoptions: [
          { draftId: "d-1", publishedAt: "2026-09-04T10:00:00Z", byVote: true, created: true },
          { draftId: "d-2", publishedAt: "2026-10-01T10:00:00Z", byVote: false, created: false },
        ],
      }),
    );
    const a = find(card.sections, "adoption") as Extract<CircleSection, { kind: "adoption" }>;
    expect(a.slot.kind === "shown" && a.slot.value.latest).toBe("Adopted by a direct decision on 1 Oct 2026");
    expect(a.slot.kind === "shown" && a.slot.value.lines.map((l) => l.how)).toEqual([
      "Adopted by a direct decision on 1 Oct 2026",
      "Adopted by a village vote on 4 Sep 2026",
    ]);
  });
});

describe("the stored charter, read back", () => {
  it("reads JSON text and parsed lists alike, and a malformed field as unwritten", () => {
    const c = charterFromRow({ exists_while: "  we are needed ", domains: '["A","  ","B"]', authorities: ["X"], tools: "not json" });
    expect(c.existsWhile).toBe("we are needed");
    expect(c.domains).toEqual(["A", "B"]);
    expect(c.authorities).toEqual(["X"]);
    expect(c.tools).toBeNull();
    expect(charterFromRow(null)).toEqual(EMPTY_CHARTER);
  });

  it("keeps at most two values, and only whole value and practice pairs", () => {
    expect(
      readStoredValues(
        JSON.stringify([
          { value: "Care", practice: "We check in first." },
          { value: "Half" },
          { value: "Play", practice: "We end with a song." },
          { value: "Third", practice: "Dropped." },
        ]),
      ),
    ).toEqual([
      { value: "Care", practice: "We check in first." },
      { value: "Play", practice: "We end with a song." },
    ]);
    expect(readStoredValues("[]")).toBeNull();
  });
});
