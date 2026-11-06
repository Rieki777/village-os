/**
 * Reading a file from ReGen Civics: the two shapes, the refusals, and what a
 * bad entry turns into.
 *
 * The fixtures in __fixtures__ were made by ReGen Civics' own card builder
 * (`toVillageOsCard`, shared/villageOsCard.ts in that repository), from the
 * rows its own test uses for "the card for Village OS", so a change on that
 * side that this reader cannot follow shows up here first. Only `from.site`
 * was changed, to keep a brand name out of this tree.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REGEN_CARD_SCHEMA, REGEN_FILE_SCHEMA, readRegenFile } from "./regenFile";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const fixture = (name: string): string => fs.readFileSync(path.join(HERE, "__fixtures__", name), "utf8");

const read = (input: unknown) => {
  const r = readRegenFile(input);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
};

describe("which files it reads", () => {
  it("reads the Week 4 card as the board copies it", () => {
    const p = read(fixture("regen-card-temple.json"));
    expect(p.kind).toBe("card");
    expect(p.schema).toBe(REGEN_CARD_SCHEMA);
    expect(p.village).toBeNull();
    expect(p.from).toEqual({ site: "regen-civics.example", project: "Templeofroots.com", applicationId: null, weeks: [3, 4] });
    expect(p.leftOut).toEqual([]);
  });

  it("reads the 1.0 file, with the card riding inside it", () => {
    const p = read(fixture("regen-village-riverbend.json"));
    expect(p.kind).toBe("village");
    expect(p.schema).toBe(REGEN_FILE_SCHEMA);
    expect(p.from.applicationId).toBe(1231543);
    expect(p.card.seats.map((s) => s.name)).toEqual(["Water keeper", "River voice", "Cook", "Heart keeper", "Ceremony holder"]);
    expect(p.village?.identity).toEqual({
      name: "Riverbend Farm",
      tagline: "A farm that feeds the valley",
      location: "Valle de la Luna, Costa Rica",
      memberWord: "Neighbour",
      timezone: "America/Costa_Rica",
      hemisphere: "north",
      currency: "CRC",
    });
    expect(p.village?.economy.issuanceCap).toBe(5000);
    expect(p.village?.quests.tokenName).toBe("Seeds");
    expect(p.village?.notes.map((n) => n.key)).toEqual([
      "seats.nextHolder",
      "decide.founders",
      "membership.entry",
      "membership.greeter",
      "economy.poolToken",
      "legal.structure",
      "network.tools",
      "launch.address",
    ]);
    expect(p.village?.status["needs.scope"]).toEqual({ status: "yours", from: "Your stewards" });
    expect(p.leftOut).toEqual([]);
  });

  it("reads an object as well as the text", () => {
    const p = read(JSON.parse(fixture("regen-card-temple.json")));
    expect(p.card.needs.length).toBeGreaterThan(0);
  });

  it("reads a full-width at sign in the schema as the ordinary one", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    raw.schema = "regen-civics/village-card＠1";
    expect(read(raw).schema).toBe(REGEN_CARD_SCHEMA);
  });
});

describe("what it refuses, whole", () => {
  const refusal = (input: unknown): string => {
    const r = readRegenFile(input);
    if (r.ok) throw new Error("expected a refusal");
    return r.error;
  };

  it("an unknown schema, naming the two it reads", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    raw.schema = "regen-civics/village-card@2";
    const e = refusal(raw);
    expect(e).toContain('"regen-civics/village-card@2"');
    expect(e).toContain(REGEN_CARD_SCHEMA);
    expect(e).toContain(REGEN_FILE_SCHEMA);
    expect(e).toContain("Nothing was read.");
  });

  it("a file that names no schema", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    delete raw.schema;
    expect(refusal(raw)).toContain("does not say what kind of file it is");
  });

  it("text that is not JSON, a list, and nothing at all", () => {
    expect(refusal("{ needs: [")).toContain("could not be read as a file from ReGen Civics");
    expect(refusal("[1,2,3]")).toContain("could not be read as a file from ReGen Civics");
    expect(refusal("   ")).toContain("Paste the file");
  });

  it("a file far larger than a profile can be", () => {
    expect(refusal(`{"schema":"${REGEN_CARD_SCHEMA}","x":"${"a".repeat(600_000)}"}`)).toContain("larger than");
  });
});

describe("what one bad entry becomes", () => {
  it("is left out with a sentence, and the rest still reads", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    raw.needs.push({ needKey: "Not A Key", depthTarget: "alive" });
    raw.seats.push({ name: "", circle: "water" }, { name: "Floater", circle: "nowhere" });
    raw.circles.push({ circle: "water", label: "Living Water again" }, { circle: "attic", label: "Attic" });
    raw.circles[0].decidesBy = "coin_toss";
    const p = read(raw);
    expect(p.card.needs.map((n) => n.needKey)).not.toContain("Not A Key");
    expect(p.card.seats.map((s) => s.name)).toEqual(["Water keeper", "Initiation guide"]);
    expect(p.card.circles.filter((c) => c.key === "water")).toHaveLength(1);
    expect(p.card.circles.find((c) => c.key === "water")?.decidesBy).toBeNull();
    expect(p.leftOut.join(" ")).toContain('A need keyed "Not A Key" was left out.');
    expect(p.leftOut).toContain("A role with no name was left out.");
    expect(p.leftOut.join(" ")).toContain('The role "Floater" was left out');
    expect(p.leftOut.join(" ")).toContain('A circle keyed "attic" was left out');
    expect(p.leftOut.join(" ")).toContain('"coin_toss" is not a way of deciding Village OS knows');
  });

  it("a timezone nobody can place, a currency that is not three letters and a cap out of range are left out", () => {
    const raw = JSON.parse(fixture("regen-village-riverbend.json"));
    raw.identity.timezone = "Atlantis/Lost_City";
    raw.identity.currency = "COLONES";
    raw.identity.hemisphere = "east";
    raw.economy.issuanceCap = 99_000_000;
    const p = read(raw);
    expect(p.village?.identity).toMatchObject({ timezone: null, currency: null, hemisphere: null });
    expect(p.village?.economy.issuanceCap).toBeNull();
    const why = p.leftOut.join(" ");
    expect(why).toContain('The timezone "Atlantis/Lost_City" was left out');
    expect(why).toContain("a currency is three letters");
    expect(why).toContain("from 1 to 10,000,000, or declined");
  });

  it("reads a declined cap as the founders' choice to keep Village OS's own, never as a number", () => {
    const raw = JSON.parse(fixture("regen-village-riverbend.json"));
    raw.economy.issuanceCap = "declined";
    expect(read(raw).village?.economy.issuanceCap).toBe("declined");
  });

  it("'another way' with no line saying what the way is is left out", () => {
    const raw = JSON.parse(fixture("regen-card-temple.json"));
    raw.circles[0].decidesBy = "other";
    raw.circles[0].decidesByGloss = "";
    const p = read(raw);
    expect(p.card.circles[0].decidesBy).toBeNull();
    expect(p.leftOut.join(" ")).toContain("needs its one line");
  });

  it("keeps a null as null, so Village OS's default stays", () => {
    const p = read(fixture("regen-village-riverbend.json"));
    expect(p.village?.purpose.statement).toBeNull();
    expect(p.card.firstLine).toBeNull();
    expect(p.card.players).toEqual({ toStart: null, now: null });
    const raw = JSON.parse(fixture("regen-village-riverbend.json"));
    raw.economy.issuanceCap = null;
    raw.modules.on = null;
    const q = read(raw);
    expect(q.village?.economy.issuanceCap).toBeNull();
    expect(q.village?.modules.on).toBeNull();
    expect(q.leftOut).toEqual([]);
  });

  it("reads 'confirmed' as the stewards' own answer, the word the brief used", () => {
    const raw = JSON.parse(fixture("regen-village-riverbend.json"));
    raw.status["identity.name"] = { status: "confirmed", from: "Your stewards" };
    raw.status["identity.tagline"] = { status: "decided by a dice roll" };
    const p = read(raw);
    expect(p.village?.status["identity.name"].status).toBe("yours");
    expect(p.village?.status["identity.tagline"]).toBeUndefined();
  });
});

describe("the seat card, field by field", () => {
  it("keeps what the board wrote and nothing it did not", () => {
    const p = read(fixture("regen-card-riverbend.json"));
    const keeper = p.card.seats.find((s) => s.name === "Water keeper")!;
    expect(keeper).toMatchObject({
      circle: "water",
      circleLabel: "Living Water",
      seats: 1,
      aim: "Living water for every household on the land",
      domain: null,
      accountabilities: "The spring, the catchment, the water tests",
      why: "Meets Vitality",
      heldBy: "team",
      who: "Ana",
      contribution: { hoursPerWeek: 4, text: "4 hours a week" },
      needLinks: [{ needKey: "vitality", weight: "partial" }],
    });
    const cook = p.card.seats.find((s) => s.name === "Cook")!;
    expect(cook.circle).toBe("own:Kitchen");
    expect(cook.who).toBeNull();
    expect(cook.contribution).toEqual({ hoursPerWeek: null, text: "two mornings a week" });
    expect(p.card.seats.find((s) => s.name === "River voice")).toMatchObject({ heldBy: "being", who: "The river" });
  });

  it("carries a circle whose cards disagree as its choices, with no way picked", () => {
    const p = read(fixture("regen-card-riverbend.json"));
    const love = p.card.circles.find((c) => c.key === "love")!;
    expect(love.decidesBy).toBeNull();
    expect(love.decidesByAnswers).toEqual([
      { by: "consensus", gloss: null },
      { by: "other", gloss: "Elders listen, then the circle sits until it is clear" },
    ]);
    expect(p.card.circles.find((c) => c.key === "water")?.decidesBy).toBe("consent");
  });
});
