/**
 * What a ReGen Civics file would set, and the exact bodies each kept part sends.
 *
 * The cards are ReGen Civics' own output (see regenFile.test.ts). The village
 * here is a fresh fork's: the eight councils `server/seeds/circles-seed.json`
 * seeds, no seats, nothing in scope, and a running season with an end date.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRegenFile } from "./regenFile";
import {
  accountabilitiesFor,
  afterPublishFor,
  defaultChoices,
  draftChangesFor,
  draftWordsFor,
  planImport,
  scopeBodyFor,
  type LiveVillage,
} from "./regenImport";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const fixture = (name: string): string => fs.readFileSync(path.join(HERE, "__fixtures__", name), "utf8");
const SEED = JSON.parse(fs.readFileSync(path.join(HERE, "..", "server", "seeds", "circles-seed.json"), "utf8")) as Array<{ id: string; name: string; aliases?: string[]; status?: string }>;

const profileOf = (name: string) => {
  const r = readRegenFile(fixture(name));
  if (!r.ok) throw new Error(r.error);
  return r.profile;
};

const FRESH: LiveVillage = {
  scope: [],
  circles: SEED.map((c) => ({ id: c.id, name: c.name, status: c.status ?? "active", isExample: false, aliases: c.aliases ?? [], decidesBy: null })),
  seats: [],
  seasonEnds: true,
};

describe("the needs", () => {
  it("sends the card's needs as the scope write's own body", () => {
    const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
    const body = scopeBodyFor(plan, defaultChoices(plan));
    expect(body).toEqual({
      needs: [
        { needKey: "love", depthTarget: "alive", breadthTargetPct: 60, sortOrder: 1 },
        { needKey: "vitality", depthTarget: "satisfied", breadthTargetPct: 100, sortOrder: 2 },
        { needKey: "honesty", depthTarget: "satisfied", breadthTargetPct: 100, sortOrder: 3 },
        { needKey: "custom:spiritual-practice", label: "Spiritual practice", depthTarget: "thriving", breadthTargetPct: 100, sortOrder: 4 },
      ],
    });
    expect(plan.needs[0].line).toBe("Love: Alive, for 60 percent of your people.");
  });

  it("offers a need named in Week 3 only on the founder's own tick", () => {
    const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
    expect(plan.ownNeeds.map((n) => n.needKey)).toEqual(["custom:wisdom"]);
    const choices = defaultChoices(plan);
    expect(choices.ownNeeds).toEqual([]);
    expect(scopeBodyFor(plan, { ...choices, ownNeeds: ["custom:wisdom"] })?.needs.at(-1)).toEqual({ needKey: "custom:wisdom", label: "wisdom", sortOrder: 5 });
    expect(scopeBodyFor(plan, { ...choices, needs: false })).toBeNull();
  });

  it("says when a need is already taken on, and at what", () => {
    const live: LiveVillage = { ...FRESH, scope: [{ needKey: "love", label: "Love", depthTarget: "satisfied", breadthTargetPct: 100, retired: false }] };
    const plan = planImport(profileOf("regen-card-riverbend.json"), live, { tag: "t1" });
    expect(plan.needs[0].line).toBe("Love: you have taken this one on at Satisfied for 100 percent. This sets Alive, for 60 percent of your people.");
  });

  it("offers the whole-village figure as it was typed", () => {
    const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
    expect(plan.totality?.pct).toBe(40);
  });
});

describe("the org draft built from a real card", () => {
  const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
  const changes = draftChangesFor(plan, defaultChoices(plan));

  it("makes every circle first, then the seats, then the holders, then rests the old councils", () => {
    expect(changes.map((c) => `${c.op} ${c.orgRoleId}`)).toEqual([
      "create_circle circle:living-water",
      "create_circle circle:love-cultivation",
      "create_circle circle:kitchen",
      "create_circle circle:trust-comms",
      "create_circle circle:festivals-rites",
      "create_seat water-keeper-t1",
      "create_seat river-voice-t1",
      "create_seat cook-t1",
      "create_seat heart-keeper-t1",
      "create_seat ceremony-holder-t1",
      "seat_holder water-keeper-t1",
      "seat_holder heart-keeper-t1",
      ...SEED.map((c) => `rest_circle circle:${c.id}`),
    ]);
  });

  it("maps a seat card onto the seat's own fields", () => {
    const keeper = changes.find((c) => c.orgRoleId === "water-keeper-t1" && c.op === "create_seat")!;
    expect(keeper.payload).toEqual({
      name: "Water keeper",
      circleId: "living-water",
      aim: "Living water for every household on the land",
      // The board asks what a circle decides on, so the seat carries its circle's answer.
      domain: "when we irrigate",
      accountabilities: ["The spring, the catchment, the water tests", "Contribution: 4 hours a week"],
      whyItMatters: "Meets Vitality",
      seats: 1,
      recruiting: false,
    });
  });

  it("makes an open seat recruiting, and a being's seat an open one that names the being", () => {
    const cook = changes.find((c) => c.orgRoleId === "cook-t1")!;
    expect(cook.payload).toMatchObject({ circleId: "kitchen", recruiting: true, accountabilities: ["The kitchen", "the pantry", "Contribution: two mornings a week"] });
    const river = changes.find((c) => c.orgRoleId === "river-voice-t1")!;
    expect(river.payload).toMatchObject({ recruiting: true, whyItMatters: "Meets Vitality. A being holds this seat: The river. It is open for someone to speak for it." });
    expect(changes.filter((c) => c.op === "seat_holder" && c.orgRoleId === "river-voice-t1")).toEqual([]);
  });

  it("writes a team holder as a name, for them to claim later", () => {
    expect(changes.find((c) => c.op === "seat_holder" && c.orgRoleId === "water-keeper-t1")?.payload).toEqual({ displayName: "Ana" });
  });

  it("titles the draft with where it came from", () => {
    expect(draftWordsFor(plan.profile).title).toBe("Started from Riverbend Farm's ReGen Civics profile");
  });
});

describe("after the draft is published", () => {
  const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
  const choices = defaultChoices(plan);

  it("declares how a circle decides when its cards agree, and asks when they do not", () => {
    const after = afterPublishFor(plan, choices, []);
    expect(after.decides).toEqual([{ circleId: "living-water", circleName: "Living Water", decidesBy: "consent", decidesByGloss: null }]);
    const love = plan.circles.find((c) => c.key === "love")!;
    expect(love.choices.map((c) => c.by)).toEqual(["consensus", "other"]);
    const picked = afterPublishFor(plan, { ...choices, decides: { ...choices.decides, love: love.choices[1] } }, []);
    expect(picked.decides.find((d) => d.circleId === "love-cultivation")).toEqual({
      circleId: "love-cultivation",
      circleName: "Love Cultivation",
      decidesBy: "other",
      decidesByGloss: "Elders listen, then the circle sits until it is clear",
    });
  });

  it("tags each seat with its own needs, and only needs the village will have taken on", () => {
    const after = afterPublishFor(plan, choices, []);
    expect(after.links.map((l) => `${l.subjectRef} ${l.needKey} ${l.weight}`)).toEqual([
      "water-keeper-t1 vitality partial",
      "river-voice-t1 vitality partial",
      "cook-t1 vitality partial",
      "heart-keeper-t1 love primary",
      "ceremony-holder-t1 custom:spiritual-practice primary",
    ]);
    const noNeeds = afterPublishFor(plan, { ...choices, needs: false }, ["love"]);
    expect(noNeeds.links.map((l) => l.needKey)).toEqual(["love"]);
  });

  it("puts the old councils into forming only when the founder picks that", () => {
    expect(afterPublishFor(plan, choices, []).forming).toEqual([]);
    const forming = { ...choices, oldCircles: "forming" as const };
    expect(afterPublishFor(plan, forming, []).forming).toHaveLength(SEED.length);
    expect(draftChangesFor(plan, forming).filter((c) => c.op === "rest_circle")).toEqual([]);
  });
});

describe("a village that is not fresh", () => {
  it("puts seats into a live circle of the same name, and makes none", () => {
    const live: LiveVillage = { ...FRESH, circles: [...FRESH.circles, { id: "water", name: "Living Water", status: "active", isExample: false, aliases: [], decidesBy: "majority" }] };
    const plan = planImport(profileOf("regen-card-riverbend.json"), live, { tag: "t1" });
    const water = plan.circles.find((c) => c.key === "water")!;
    expect(water).toMatchObject({ id: "water", reused: true, liveDecidesBy: "majority" });
    const choices = defaultChoices(plan);
    const changes = draftChangesFor(plan, choices);
    expect(changes.some((c) => c.orgRoleId === "circle:living-water")).toBe(false);
    expect(changes.find((c) => c.orgRoleId === "water-keeper-t1")?.payload.circleId).toBe("water");
    // It already decides its own way, so the file's way waits for the founder's pick.
    expect(afterPublishFor(plan, choices, []).decides.some((d) => d.circleId === "water")).toBe(false);
    expect(plan.oldCircles.some((c) => c.id === "water")).toBe(false);
  });

  it("leaves a live seat of the same name as it is, and seats its holder only once", () => {
    const live: LiveVillage = { ...FRESH, seats: [{ id: "wk", name: "water keeper", circleId: null, holders: ["Ana"] }, { id: "hk", name: "Heart keeper", circleId: null, holders: [] }] };
    const plan = planImport(profileOf("regen-card-riverbend.json"), live, { tag: "t1" });
    const changes = draftChangesFor(plan, defaultChoices(plan));
    expect(changes.filter((c) => c.op === "create_seat").map((c) => c.orgRoleId)).toEqual(["river-voice-t1", "cook-t1", "ceremony-holder-t1"]);
    expect(changes.filter((c) => c.op === "seat_holder")).toEqual([{ op: "seat_holder", orgRoleId: "hk", payload: { displayName: "Bo" } }]);
    expect(plan.seats.find((s) => s.id === "wk")?.lines[0]).toContain("leaves it as it is");
  });

  it("never rests a circle somebody's seat sits in", () => {
    const live: LiveVillage = { ...FRESH, seats: [{ id: "x", name: "Gardener", circleId: SEED[0].id, holders: [] }] };
    const plan = planImport(profileOf("regen-card-riverbend.json"), live, { tag: "t1" });
    const rested = draftChangesFor(plan, defaultChoices(plan)).filter((c) => c.op === "rest_circle").map((c) => c.orgRoleId);
    expect(rested).not.toContain(`circle:${SEED[0].id}`);
    expect(rested).toHaveLength(SEED.length - 1);
  });

  it("holds the holders back, in a sentence, when no season can end their holding", () => {
    const plan = planImport(profileOf("regen-card-riverbend.json"), { ...FRESH, seasonEnds: false }, { tag: "t1" });
    expect(plan.holdersWait).toContain("waits for a running season with an end date");
    const choices = defaultChoices(plan);
    expect(choices.holders).toBe(false);
    expect(draftChangesFor(plan, { ...choices, holders: true }).some((c) => c.op === "seat_holder")).toBe(false);
  });

  it("gives a new seat an id no earlier load can hold, whatever the tag", () => {
    const live: LiveVillage = { ...FRESH, seats: [{ id: "cook-t1", name: "Kitchen hand", circleId: null, holders: [] }] };
    const plan = planImport(profileOf("regen-card-riverbend.json"), live, { tag: "t1" });
    expect(plan.seats.find((s) => s.name === "Cook")?.id).toBe("cook-t1-2");
  });
});

describe("what a founder can untick", () => {
  const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });
  const choices = defaultChoices(plan);

  it("a seat left out sends nothing for it, its holder and its links included", () => {
    const kept = { ...choices, seats: choices.seats.filter((k) => plan.seats.find((s) => s.key === k)?.name !== "Water keeper") };
    const changes = draftChangesFor(plan, kept);
    expect(changes.some((c) => c.orgRoleId === "water-keeper-t1")).toBe(false);
    expect(afterPublishFor(plan, kept, []).links.some((l) => l.subjectRef === "water-keeper-t1")).toBe(false);
  });

  it("no structure sends no draft at all", () => {
    expect(draftChangesFor(plan, { ...choices, structure: false })).toEqual([]);
    expect(afterPublishFor(plan, { ...choices, structure: false }, []).decides).toEqual([]);
  });

  it("keeping the old councils rests none of them", () => {
    expect(draftChangesFor(plan, { ...choices, oldCircles: "keep" }).some((c) => c.op === "rest_circle")).toBe(false);
  });
});

describe("a second seat of the same name", () => {
  it("is left out with a sentence, never renamed", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    raw.seats.push({ ...raw.seats[0], circle: "food", circleLabel: "Food & Fertility" });
    const r = readRegenFile(raw);
    if (!r.ok) throw new Error(r.error);
    const plan = planImport(r.profile, FRESH, { tag: "t1" });
    const dup = plan.seats.at(-1)!;
    expect(dup.leftOut).toContain('A second seat called "Water keeper"');
    expect(draftChangesFor(plan, defaultChoices(plan)).filter((c) => c.op === "create_seat" && c.payload.name === "Water keeper")).toHaveLength(1);
  });
});

describe("the 1.0 file's own sections", () => {
  const plan = planImport(profileOf("regen-village-riverbend.json"), FRESH, { tag: "t1" });
  const reread = (edit: (raw: any) => void) => {
    const raw = JSON.parse(fixture("regen-village-riverbend.json"));
    edit(raw);
    const r = readRegenFile(raw);
    if (!r.ok) throw new Error(r.error);
    return planImport(r.profile, FRESH, { tag: "t1" });
  };

  it("prefills identity with what the stewards answered, and only that", () => {
    expect(plan.prefill.identity).toEqual({
      name: "Riverbend Farm",
      tagline: "A farm that feeds the valley",
      location: "Valle de la Luna, Costa Rica",
      memberName: "Neighbour",
      fiatCurrency: "CRC",
    });
  });

  it("puts nothing in the purpose box when the stewards wrote no statement", () => {
    expect(plan.prefill.purpose).toBeNull();
    expect(reread((raw) => (raw.purpose.statement = "This village exists for...")).prefill.purpose).toEqual({ text: "This village exists for...", fromFirstLine: false });
  });

  it("hands each editor field to its own editor, and saves none of them", () => {
    expect(plan.prefill.covenant).toBe("We tend the land, we keep our word, and we say what is true.");
    expect(plan.prefill.tokenName).toBe("Seeds");
    expect(plan.prefill.exitPolicy).toBe("Whoever leaves takes what they brought, and the village thanks them for what they built.");
    expect(plan.prefill.quests).toEqual([
      { quest: "Clear the spring", needLabel: "Vitality & Survival Needs" },
      { quest: "Cook for the work day", needLabel: "Love" },
    ]);
  });

  it("lists the stewards' notes as the founders' checklist, each with where it is set", () => {
    const keys = plan.notes.map((n) => n.key);
    expect(keys.slice(0, 8)).toEqual([
      "seats.nextHolder",
      "decide.founders",
      "membership.entry",
      "membership.greeter",
      "economy.poolToken",
      "legal.structure",
      "network.tools",
      "launch.address",
    ]);
    // The card's first step in is the same decision, so it is not listed twice.
    expect(keys.filter((k) => k === "membership.entry")).toHaveLength(1);
    expect(plan.notes.find((n) => n.key === "seats.nextHolder")).toEqual({
      key: "seats.nextHolder",
      label: "How the next holder of most seats is chosen",
      text: "The circle chooses",
      where: "Org Chart, on each seat",
    });
    expect(plan.notes.find((n) => n.key === "identity.timezone")?.text).toBe("America/Costa_Rica");
    expect(plan.notes.find((n) => n.key === "identity.hemisphere")?.text).toBe("Northern hemisphere");
  });

  it("never sets how the next holder is chosen on any seat", () => {
    const after = afterPublishFor(plan, defaultChoices(plan), []);
    expect(Object.keys(after).sort()).toEqual(["decides", "forming", "links"]);
    for (const c of draftChangesFor(plan, defaultChoices(plan))) expect(c.payload).not.toHaveProperty("howChosen");
  });

  it("names the modules by Village OS's registry, each after what it needs, and says the money modules stay off", () => {
    expect(plan.modules?.on.map((m) => m.id)).toEqual(["forum", "feed", "events", "map"]);
    expect(plan.modules?.order).toEqual([]);
    expect(plan.modules?.moneyLeftOff).toHaveLength(5);
    const alone = reread((raw) => (raw.modules.on = ["feed"]));
    expect(alone.modules?.on.map((m) => m.id)).toEqual(["feed"]);
    expect(alone.modules?.order[0]).toMatch(/needs .* on first.$/);
  });

  it("drops a money module, a core module and a name Village OS does not have, whatever the file says", () => {
    const m = reread((raw) => (raw.modules.on = ["map", "exchange", "stays", "crowdpool", "quests", "teleporter"])).modules;
    expect(m?.on.map((x) => x.id)).toEqual(["map"]);
    expect(m?.unknown).toEqual(["teleporter"]);
  });

  it("shows the stewards' issuance cap beside the launch decision, and sends it nowhere", () => {
    const cap = plan.notes.find((n) => n.key === "economy.issuanceCap");
    expect(cap?.text).toBe("Your stewards chose at most 5000 new tokens each lunar cycle.");
    expect(cap?.where).toContain("The Launch Plan");
    const everything = JSON.stringify([
      scopeBodyFor(plan, defaultChoices(plan)),
      draftChangesFor(plan, defaultChoices(plan)),
      afterPublishFor(plan, defaultChoices(plan), []),
    ]);
    expect(everything).not.toContain("5000");
    const declined = reread((raw) => (raw.economy.issuanceCap = "declined")).notes.find((n) => n.key === "economy.issuanceCap");
    expect(declined?.text).toContain("keep Village OS's own 10,000");
    expect(declined?.text).toContain("it uncaps nothing");
  });
});

describe("a Week 4 card's own words", () => {
  const plan = planImport(profileOf("regen-card-riverbend.json"), FRESH, { tag: "t1" });

  it("offers its first line as the start of a purpose statement", () => {
    expect(plan.prefill.purpose).toEqual({ text: "All this is for future generations", fromFirstLine: true });
  });

  it("keeps what the village decides together as a note", () => {
    expect(plan.notes.find((n) => n.key === "decide.together")?.text).toBe("Decided together: Who joins. First agreement: Circles decide what's theirs");
    expect(plan.modules).toBeNull();
  });
});

describe("a seat's answers-for, as a list", () => {
  it("splits on new lines and semicolons, and adds the contribution last", () => {
    const seat = profileOf("regen-card-riverbend.json").card.seats.find((s) => s.name === "Heart keeper")!;
    expect(accountabilitiesFor(seat)).toEqual(["Check-ins, the care circle", "Contribution: 6 hrs per week"]);
  });
});
