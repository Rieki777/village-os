/**
 * The village's words for its paths and its ladder, as every server reader
 * gets them, and the wiring that matters most: a path the founder renamed is
 * the name the join form is served and the name the path's email says.
 *
 * The stored document is handed in through a fake pool answering the same
 * SELECT `dbDocument.load()` issues, so the cache under test is the real one,
 * fed a document in an OLD SHAPE (one path's name and nothing else). The
 * back-fill is only proven by a document that lacks fields.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { defaultTemplate } from "../../shared/comms/defaults/templates";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { pageVarsFrom } from "../../shared/pageContent/vars";
import { VILLAGE_PATHS_DOCUMENT } from "../../shared/villagePaths";
import { derivedValues, renderTemplate } from "./comms/render";
import { pathNameOf } from "./comms/pathParts";
import { servedLadder, servedStage } from "./progressionPayload";
import {
  ladderTitle,
  loadVillagePaths,
  saveVillagePaths,
  servedPathWords,
  setVillageVars,
  stageName,
  storedVillagePaths,
  villagePathChoices,
} from "./villagePaths";

/** A pool holding one `app_config` row, or none. Records what was written. */
function poolHolding(doc: unknown | null) {
  const writes: Array<{ key: string; value: unknown }> = [];
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) {
        expect(args[0]).toBe(VILLAGE_PATHS_DOCUMENT);
        return [doc === null ? [] : [{ value: JSON.stringify(doc) }]];
      }
      writes.push({ key: String(args[0]), value: JSON.parse(String(args[1])) });
      return [{ affectedRows: 1 }];
    },
  } as unknown as Pool;
  return { pool, writes };
}

const noDatabase = () => {
  throw new Error("this render should not have read the database");
};

beforeEach(async () => {
  setVillageVars(() => pageVarsFrom({ project: { name: "Riverbend", commitmentName: "Pact" } }));
  await loadVillagePaths(poolHolding(null).pool);
});

describe("a village that never saved", () => {
  it("is served today's words everywhere", () => {
    expect(storedVillagePaths()).toEqual({});
    const served = servedPathWords();
    expect(served.paths.map((p) => [p.id, p.label, p.route])).toEqual(GAME_CONFIG.paths.map((p) => [p.id, p.label, p.route]));
    expect(served.paths.find((p) => p.id === "resident")?.description).toBe(
      "Make Riverbend your home. Find a place to live, join the waitlist, and belong.",
    );
    expect(served.ladder).toEqual({ title: "Path of Growth" });
    expect(stageName("member")).toBe("Member");
    expect(pathNameOf("steward")).toBe("Village Steward");
  });
});

describe("a village that saved one path's name, before anything else could be saved", () => {
  beforeEach(async () => {
    await loadVillagePaths(poolHolding({ paths: { steward: { label: "Keeper" } } }).pool);
  });

  it("is served that name on the join form's list, and today's words for everything it did not touch", () => {
    const { paths, ladder } = servedPathWords();
    const steward = paths.find((p) => p.id === "steward")!;
    expect(steward).toMatchObject({ id: "steward", label: "Keeper", role: "Co-Creator", route: "/steward" });
    expect(steward.description).toBe("Hold a role, join a circle, and keep the whole village running.");
    expect(paths.find((p) => p.id === "investor")?.label).toBe("Investor");
    expect(ladder.title).toBe("Path of Growth");
    expect(villagePathChoices().find((p) => p.id === "steward")?.label).toBe("Keeper");
  });

  it("names the path that way in its emails: the merge field, the journey's own value, and the rendered words", async () => {
    expect(derivedValues("path.steward.welcome", "https://riverbend.example")).toEqual({
      "path.name": "Keeper",
      "path.pageUrl": "https://riverbend.example/steward",
    });
    expect(pathNameOf("steward")).toBe("Keeper");

    // The platform's own welcome email for the path, rendered as it is sent.
    const platform = defaultTemplate("path.steward.welcome")!;
    expect(platform.subject, "CONTROL: the welcome subject must name the path for this to prove anything").toContain("{{path.name}}");
    const email = await renderTemplate("path.steward.welcome", { "person.firstName": "Ada" }, {
      getPool: noDatabase as never,
      village: { name: "Riverbend", url: "https://riverbend.example", logoUrl: null, seed: null, character: null, postalAddress: "1 Lane" },
      words: { subject: platform.subject, preheader: platform.preheader, bodyMd: platform.bodyMd },
    });
    expect(email.subject).toBe("Welcome to the Keeper path");
    expect(email.text).toContain("Keeper path");
    expect(email.text).not.toContain("Village Steward");
  });
});

describe("a village's ladder", () => {
  beforeEach(async () => {
    await loadVillagePaths(
      poolHolding({
        stages: { member: { name: "Kin", description: "Signed the {commitment} with {village}." }, sage: { name: "Elder" } },
        ladder: { title: "The Spiral" },
      }).pool,
    );
  });

  it("serves the renamed rungs in the platform's order, with their rules and {words} filled", () => {
    const ladder = servedLadder("Pact");
    expect(ladder.map((s) => s.id)).toEqual(GAME_CONFIG.stages.map((s) => s.id));
    const member = ladder.find((s) => s.id === "member")!;
    expect(member).toMatchObject({ name: "Kin", description: "Signed the Pact with Riverbend.", rule: { type: "membership" } });
    expect(ladder.find((s) => s.id === "sage")).toMatchObject({ name: "Elder", description: "Twenty-one or more years of stewardship." });
    expect(ladder.find((s) => s.id === "guest")?.name).toBe("Guest");
  });

  it("names the member's own stage the same way, braces filled", () => {
    expect(servedStage("member")).toMatchObject({ id: "member", name: "Kin", description: "Signed the Pact with Riverbend." });
  });

  it("names a stage in a sentence the village's way, and an unknown id as the first stage", () => {
    expect(stageName("sage")).toBe("Elder");
    expect(stageName("no-such-stage")).toBe("Visitor");
    expect(ladderTitle()).toBe("The Spiral");
    expect(servedPathWords().ladder.title).toBe("The Spiral");
  });
});

describe("a sparse save: one stage renamed and nothing else", () => {
  beforeEach(async () => {
    await loadVillagePaths(poolHolding({ stages: { initiate: { name: "Apprentice" } } }).pool);
  });

  it("renames that rung alone, keeps its line, and leaves every other word as it was", () => {
    const ladder = servedLadder("Pact");
    expect(ladder.find((s) => s.id === "initiate")).toMatchObject({ name: "Apprentice", description: "Walking the Co-Creator Right of Passage." });
    for (const s of GAME_CONFIG.stages.filter((x) => x.id !== "initiate")) {
      expect(ladder.find((x) => x.id === s.id)?.name, s.id).toBe(s.name);
    }
    expect(servedPathWords().paths.map((p) => p.label)).toEqual(GAME_CONFIG.paths.map((p) => p.label));
    expect(ladderTitle()).toBe("Path of Growth");
    expect(stageName("initiate")).toBe("Apprentice");
  });
});

describe("saving", () => {
  it("writes the document under its own key and serves the new words on the next read", async () => {
    const { pool, writes } = poolHolding(null);
    await loadVillagePaths(pool);
    const words = await saveVillagePaths({ paths: { investor: { label: "Backer" } } });
    expect(writes).toEqual([{ key: VILLAGE_PATHS_DOCUMENT, value: { paths: { investor: { label: "Backer" } } } }]);
    expect(words.paths.investor.label).toBe("Backer");
    expect(servedPathWords().paths.find((p) => p.id === "investor")?.label).toBe("Backer");
  });
});

describe("the {words} reader", () => {
  it("falls back to the platform's words when the reader throws, and the page still gets its paths", () => {
    setVillageVars(() => {
      throw new Error("brand not loaded");
    });
    const resident = servedPathWords().paths.find((p) => p.id === "resident")!;
    expect(resident.description).toContain("Make the village your home");
  });
});
