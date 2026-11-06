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

  it("a visitor or a guest is offered the door with no membership to refuse them: propose a role, with that role picked (2026-10-31)", () => {
    const roles = [
      { id: "r-1", name: "Water Keeper", capacity: 2, holderCount: 2, state: "filled", holderHandles: undefined },
      { id: "r-2", name: "Seed Librarian", capacity: 1, holderCount: 0, state: "open", holderHandles: undefined },
      { id: "r 3", name: "Gate Keeper", capacity: 2, holderCount: 1, state: "partial", holderHandles: undefined },
      { id: "r-4", name: "Example Role", capacity: 1, holderCount: 0, state: "open", isExample: true, holderHandles: undefined },
    ];
    const rowsFor = (readerMayApply?: boolean) => {
      const card = buildCircleCard(base({ roles, ...(readerMayApply === undefined ? {} : { readerMayApply }) }));
      const section = find(card.sections, "roles") as Extract<CircleSection, { kind: "roles" }>;
      return section.slot.kind === "shown" ? section.slot.value : [];
    };
    expect(rowsFor(false).map((r) => r.applyHref)).toEqual([null, "/propose-a-role?role=r-2", "/propose-a-role?role=r%203", null]);
    // A member, and a caller that says nothing, keep the member door.
    expect(rowsFor(true).map((r) => r.applyHref)).toEqual([null, "/propose?type=role_application&seat=r-2", "/propose?type=role_application&seat=r%203", null]);
    expect(rowsFor().map((r) => r.applyHref)).toEqual(rowsFor(true).map((r) => r.applyHref));
  });

  it("carries each role's pay beside its Apply link, and none where the reader may not read it (2026-10-30)", () => {
    const pay = { value: null, lines: [{ token: "village-voice", name: "Village Voice", amount: 5, voice: true }], source: "own" as const, cadence: "cycle" as const };
    const card = buildCircleCard(
      base({
        roles: [
          { id: "r-1", name: "Seed Librarian", capacity: 1, holderCount: 0, state: "open", holderHandles: [], pay },
          { id: "r-2", name: "Water Keeper", capacity: 1, holderCount: 0, state: "open", holderHandles: [] },
        ],
      }),
    );
    const roles = find(card.sections, "roles") as Extract<CircleSection, { kind: "roles" }>;
    const rows = roles.slot.kind === "shown" ? roles.slot.value : [];
    expect(rows[0]!.pay).toEqual(pay);
    expect("pay" in rows[1]!).toBe(false);
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

describe("the live parts, which the platform reads and nobody types", () => {
  const counted = (key: "circle-met" | "decisions-recorded" | "roles-with-card-and-term", n: number, of?: number, trend?: any): any => ({
    kind: "counted",
    key,
    label: key,
    countedFrom: `Counted from ${key}.`,
    now: { n, ...(of === undefined ? {} : { of }), source: "t" },
    trend: trend ?? null,
  });

  it("prints each sign as its count, its trend, or Not counted yet", () => {
    const card = buildCircleCard(
      base({
        live: {
          signs: [
            counted("circle-met", 2, undefined, { kind: "compare", before: { n: 1, source: "t" }, direction: "up" }),
            { kind: "not-counted", key: "decisions-recorded", words: "Not counted yet" } as any,
            counted("roles-with-card-and-term", 1, 2, { kind: "later", words: "trend from next moon" }),
          ],
          lastMetAt: "2026-10-20T15:00:00Z",
          openTensions: 2,
          sessionsOn: true,
        },
      }),
    );
    const signs = find(card.sections, "signs") as Extract<CircleSection, { kind: "signs" }>;
    expect(signs.slot.kind === "shown" && signs.slot.value.map((s) => [s.label, s.value, s.trend])).toEqual([
      ["circle-met", "2", "Up on last moon"],
      ["Decisions recorded", null, "Not counted yet"],
      ["roles-with-card-and-term", "1 of 2", "Trend from next moon"],
    ]);
    const facts = (key: string) => {
      const s = find(card.sections, key) as Extract<CircleSection, { kind: "facts" }>;
      return s.slot.kind === "shown" ? s.slot.value.lines : null;
    };
    expect(facts("meet")).toEqual(["Meeting rhythm: not set yet", "Last met on 20 Oct 2026"]);
    expect(facts("tensions")?.[0]).toBe("2 open tensions on this circle's roles");
  });

  it("reads the rhythm, the next meeting and what waits in Live Sessions' own words", () => {
    const card = buildCircleCard(
      base({
        live: {
          signs: [],
          lastMetAt: null,
          openTensions: 0,
          sessionsOn: true,
          rhythm: "Every Thursday at 18:00",
          next: "Tomorrow at 18:00",
          waiting: 2,
        },
      }),
    );
    const meet = find(card.sections, "meet") as Extract<CircleSection, { kind: "facts" }>;
    expect(meet.slot.kind === "shown" && meet.slot.value.lines).toEqual([
      "Meeting rhythm: Every Thursday at 18:00",
      "Next meeting: Tomorrow at 18:00",
      "Has not met yet",
      "2 items waiting for the next meeting",
    ]);
  });

  it("draws no meeting section while Live Sessions is off, and nothing live below the member tier", () => {
    const off = buildCircleCard(base({ live: { signs: [], lastMetAt: null, openTensions: 0, sessionsOn: false } }));
    expect(find(off.sections, "meet").slot).toEqual({ kind: "unread" });
    expect(find(off.sections, "wholeness").slot).toEqual({ kind: "unread" });
    expect((find(off.sections, "tensions") as any).slot.value.lines[0]).toBe("No open tensions on this circle's roles");
    const visitor = buildCircleCard(base());
    for (const key of ["signs", "meet", "wholeness", "tensions"]) expect(find(visitor.sections, key).slot).toEqual({ kind: "unread" });
  });

  it("is due for review on the season's last day, and says when the words last changed", () => {
    const card = buildCircleCard(
      base({ reviewOn: "2026-12-21", adoptions: [{ draftId: "d-1", publishedAt: "2026-10-01T10:00:00Z", byVote: false, created: false }] }),
    );
    expect(find(card.sections, "review").slot).toEqual({
      kind: "shown",
      value: { lines: ["Due for review on 21 Dec 2026, the last day of this season.", "Last changed by consent on 1 Oct 2026."], links: [] },
    });
    expect(find(buildCircleCard(base({ reviewOn: null })).sections, "review").slot).toEqual({
      kind: "shown",
      value: { lines: ["No season is set, so there is no review date yet."], links: [] },
    });
  });
});
