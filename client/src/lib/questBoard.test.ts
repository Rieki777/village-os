import { describe, expect, it } from "vitest";
import {
  currentClaims,
  gateFix,
  gateLabel,
  hashString,
  linesToList,
  listToLines,
  nextQuestFor,
  questScene,
  relativeWhen,
  REVEAL_THRESHOLD,
  revealedFrom,
  ringFor,
  sceneGradient,
  statusIs,
  type BoardQuest,
} from "./questBoard";

const quest = (over: Partial<BoardQuest>): BoardQuest => ({
  id: "q-x",
  title: "X",
  gratitude: "10-20",
  status: "Open",
  ...over,
});

describe("ringFor", () => {
  it("a gate puts a quest in the further ring, whatever its difficulty", () => {
    expect(ringFor({ difficulty: "Beginner", minStage: "member" })).toBe("further");
    expect(ringFor({ difficulty: "Beginner", requiresRole: "greeter" })).toBe("further");
    expect(ringFor({ difficulty: "Advanced", minStage: "co-creator" })).toBe("further");
  });

  it("an ungated beginner quest is the way in", () => {
    expect(ringFor({ difficulty: "Beginner" })).toBe("welcome");
  });

  it("everything else is the body of the board", () => {
    expect(ringFor({ difficulty: "Intermediate" })).toBe("village");
    expect(ringFor({ difficulty: "Advanced" })).toBe("village");
    expect(ringFor({})).toBe("village");
  });
});

describe("revealedFrom", () => {
  const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q-${i}` }));

  it("shows a small pool whole, so a young board never looks emptier than it is", () => {
    const p = pool(REVEAL_THRESHOLD);
    expect(revealedFrom(p, "u-1", 0)).toHaveLength(REVEAL_THRESHOLD);
    expect(revealedFrom(p, "u-1", 0)).toEqual(p);
  });

  it("reveals two at a time once the pool is big enough to paralyse", () => {
    const p = pool(20);
    expect(revealedFrom(p, "u-1", 0)).toHaveLength(2);
    expect(revealedFrom(p, "u-1", 1)).toHaveLength(4);
    expect(revealedFrom(p, "u-1", 3)).toHaveLength(8);
  });

  it("never reveals more than the pool holds", () => {
    expect(revealedFrom(pool(10), "u-1", 99)).toHaveLength(10);
  });

  it("is stable for one member across calls", () => {
    const p = pool(20);
    expect(revealedFrom(p, "u-1", 2)).toEqual(revealedFrom(p, "u-1", 2));
    expect(revealedFrom(p, "u-1", 9)).toEqual(revealedFrom(p, "u-1", 9));
  });

  it("walks a different order for different members", () => {
    // Compared over a wide slice: any two members can draw the same first pair
    // by chance, so a 2-item comparison would be a coin flip dressed as a test.
    const p = pool(20);
    const order = (u: string) => revealedFrom(p, u, 8).map((q) => q.id).join();
    const orders = new Set(["u-1", "u-2", "u-3", "u-4"].map(order));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("a signed-out visitor still gets a stable order rather than a crash", () => {
    const p = pool(20);
    expect(revealedFrom(p, null, 0)).toEqual(revealedFrom(p, undefined, 0));
  });

  it("treats a negative completion count as none", () => {
    expect(revealedFrom(pool(20), "u-1", -5)).toHaveLength(2);
  });
});

describe("statusIs", () => {
  it("compares status without caring about case or padding", () => {
    expect(statusIs({ status: "Seasonal" }, "seasonal")).toBe(true);
    expect(statusIs({ status: "seasonal" }, "Seasonal")).toBe(true);
    expect(statusIs({ status: "  OPEN  " }, "open")).toBe(true);
    expect(statusIs({ status: "Closed" }, "open")).toBe(false);
  });

  it("treats a missing status as matching nothing", () => {
    expect(statusIs({ status: undefined as any }, "open")).toBe(false);
  });
});

describe("currentClaims", () => {
  const claim = (
    questId: string,
    status: string,
    claimedAt: string,
  ) => ({ questId, status, claimedAt });

  it("keeps live work over finished work on the same quest", () => {
    // The order claims arrive in: oldest first, which is what the board gets.
    const map = currentClaims([
      claim("q-1", "consented", "2026-01-01T00:00:00Z"),
      claim("q-1", "claimed", "2026-06-01T00:00:00Z"),
    ]);
    expect(map["q-1"].status).toBe("claimed");
  });

  it("keeps the later claim when two share a rank", () => {
    const map = currentClaims([
      claim("q-1", "claimed", "2026-01-01T00:00:00Z"),
      claim("q-1", "submitted", "2026-06-01T00:00:00Z"),
    ]);
    expect(map["q-1"].status).toBe("submitted");
  });

  it("a declined claim loses to anything else, whatever the order", () => {
    expect(
      currentClaims([
        claim("q-1", "declined", "2026-06-01T00:00:00Z"),
        claim("q-1", "consented", "2026-01-01T00:00:00Z"),
      ])["q-1"].status,
    ).toBe("consented");
    expect(
      currentClaims([
        claim("q-1", "consented", "2026-01-01T00:00:00Z"),
        claim("q-1", "declined", "2026-06-01T00:00:00Z"),
      ])["q-1"].status,
    ).toBe("consented");
  });

  it("keeps quests apart and survives junk dates", () => {
    const map = currentClaims([
      claim("q-1", "claimed", "not a date"),
      claim("q-2", "consented", "2026-02-02T00:00:00Z"),
    ]);
    expect(Object.keys(map).sort()).toEqual(["q-1", "q-2"]);
    expect(map["q-1"].status).toBe("claimed");
  });

  it("returns nothing for an empty list", () => {
    expect(currentClaims([])).toEqual({});
  });
});

describe("questScene", () => {
  it("is deterministic: the same circle always paints the same scene", () => {
    expect(questScene("Governance")).toEqual(questScene("governance"));
    expect(questScene("Governance")).toEqual(questScene("  Governance  "));
  });

  it("spreads distinct circles across more than one scene", () => {
    const circles = [
      "Community Development", "Regenerative Agriculture", "Land Stewardship",
      "Governance", "Tourism & Retreat", "Arts & Culture", "Education",
      "Technology", "Wellness",
    ];
    const distinct = new Set(circles.map((c) => questScene(c).from));
    expect(distinct.size).toBeGreaterThan(2);
  });

  it("handles a missing circle without throwing", () => {
    expect(questScene(null).from.length).toBeGreaterThan(0);
    expect(sceneGradient(questScene(undefined))).toContain("linear-gradient");
  });

  it("hashString is stable across calls", () => {
    expect(hashString("wellness")).toBe(hashString("wellness"));
  });
});

describe("nextQuestFor", () => {
  const board = [
    quest({ id: "q-adv", title: "Hard", difficulty: "Advanced", order: 1 }),
    quest({ id: "q-beg", title: "Gentle", difficulty: "Beginner", order: 5 }),
    quest({ id: "q-beg-first", title: "Gentle, earlier", difficulty: "Beginner", order: 2 }),
    quest({ id: "q-gated", title: "Gated", difficulty: "Beginner", order: 0, minStage: "member" }),
    quest({ id: "q-ex", title: "Example", difficulty: "Beginner", order: 0, isExample: true }),
    quest({ id: "q-closed", title: "Closed", difficulty: "Beginner", order: 0, status: "Closed" }),
  ];

  it("continuing a held quest beats starting anything new", () => {
    const s = nextQuestFor(board, [{ questId: "q-adv", status: "claimed" }]);
    expect(s?.reason).toBe("continue");
    expect(s?.quest.id).toBe("q-adv");
  });

  it("suggests the gentlest open ungated quest by difficulty then board order", () => {
    const s = nextQuestFor(board, []);
    expect(s?.reason).toBe("begin");
    expect(s?.quest.id).toBe("q-beg-first");
  });

  it("never suggests examples, closed, gated, or already-touched quests", () => {
    const s = nextQuestFor(board, [
      { questId: "q-beg-first", status: "consented" },
      { questId: "q-beg", status: "consented" },
    ]);
    expect(s?.quest.id).toBe("q-adv");
  });

  it("a declined claim leaves the quest suggestible again", () => {
    const s = nextQuestFor(
      [quest({ id: "q-1", difficulty: "Beginner" })],
      [{ questId: "q-1", status: "declined" }],
    );
    expect(s?.quest.id).toBe("q-1");
  });

  it("returns null when nothing fits, so the caller renders no card", () => {
    expect(nextQuestFor([quest({ id: "q-g", minStage: "member" })], [])).toBeNull();
  });
});

describe("gateFix", () => {
  const stages = [
    { id: "guest", rule: { type: "account" as const } },
    { id: "participant", rule: { type: "training-complete" as const } },
    { id: "member", rule: { type: "membership" as const } },
    { id: "quest-seeker", rule: { type: "quests" as const, min: 3 } },
    { id: "co-creator", rule: { type: "granted" as const } },
    { id: "contributor", rule: { type: "tokens" as const } },
  ];

  it("names the one step that reaches the stage, in the village's own word for its agreement", () => {
    expect(gateFix(quest({ minStage: "guest" }), stages)).toBe("Create your account to get there.");
    expect(gateFix(quest({ minStage: "participant" }), stages)).toBe("Finish community training to get there.");
    expect(gateFix(quest({ minStage: "member" }), stages, "Love Letter")).toBe("Sign the Love Letter to get there.");
    expect(gateFix(quest({ minStage: "member" }), stages)).toBe("Sign the membership agreement to get there.");
    expect(gateFix(quest({ minStage: "quest-seeker" }), stages)).toBe("Complete 3 Quests to get there.");
    expect(gateFix(quest({ minStage: "co-creator" }), stages)).toBe("The village grants this stage.");
  });

  it("names nothing it cannot stand behind", () => {
    expect(gateFix(quest({ minStage: "contributor" }), stages)).toBeNull();
    expect(gateFix(quest({ minStage: "elder" }), stages)).toBeNull();
    expect(gateFix(quest({}), stages)).toBeNull();
  });
});

describe("gateLabel", () => {
  const stages = [{ id: "member", name: "Member" }];

  it("names the stage from config, with the raw id as fallback", () => {
    expect(gateLabel(quest({ minStage: "member" }), stages)).toBe("Opens at Member");
    expect(gateLabel(quest({ minStage: "elder" }), stages)).toBe("Opens at elder");
  });

  it("prefers the village's own role prose for a role gate", () => {
    expect(gateLabel(quest({ requiresRole: "practitioners", roleRequired: "Trained practitioner" }), stages))
      .toBe("Held for: Trained practitioner");
    expect(gateLabel(quest({ requiresRole: "practitioners" }), stages))
      .toBe("Held for a village role");
  });

  it("display-only prose still shows, and an ungated quest shows nothing", () => {
    expect(gateLabel(quest({ roleRequired: "Green thumb" }), stages)).toBe("Asks for: Green thumb");
    expect(gateLabel(quest({}), stages)).toBeNull();
  });
});

describe("lines <-> list", () => {
  it("round-trips non-blank lines and drops blanks on the way in", () => {
    expect(linesToList(" a \n\n b\n")).toEqual(["a", "b"]);
    expect(listToLines(["a", "b"])).toBe("a\nb");
    expect(linesToList(listToLines(["one step", "two step"]))).toEqual(["one step", "two step"]);
  });
});

describe("relativeWhen", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("renders today, yesterday, and day counts", () => {
    expect(relativeWhen("2026-08-10T09:00:00Z", now)).toBe("today");
    expect(relativeWhen("2026-08-09T09:00:00Z", now)).toBe("yesterday");
    expect(relativeWhen("2026-08-01T09:00:00Z", now)).toBe("9 days ago");
  });

  it("renders nothing for junk, never NaN", () => {
    expect(relativeWhen("not-a-date", now)).toBe("");
    expect(relativeWhen(null, now)).toBe("");
  });
});
