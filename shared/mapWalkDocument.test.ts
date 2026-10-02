/**
 * THE VILLAGE'S OWN WELCOME AND WALK, AS ONE DOCUMENT.
 *
 * Rye, 2026-10-02: "Onboarding is something that founders should do and
 * really personalize and put their spirit into it. So just add this to a
 * journey to launch that's suggested remove the example journey for now."
 *
 * Three things follow, and each is pinned here:
 *
 *   - a founder writes a welcome beside the walk, in the walk's document, and
 *     a save that does not mention it cannot wipe it;
 *   - the map is served the village's walk and welcome, or null for each, and
 *     null now means "no walk" and "the plain welcome", never the seed;
 *   - the Journey to Launch asks whether the walk the map is SERVED exists and
 *     has somewhere to go, and says plainly when it does not.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALK_LANG,
  sanitiseWalk,
  sanitiseWalkWelcome,
  servedWalk,
  storedWalkWelcome,
  WALK_WELCOME_KEY,
  WALK_WELCOME_MAX,
  walkDocumentFrom,
  welcomeWalkCheck,
} from "./mapAddress";

const step = (over: Record<string, unknown> = {}) => ({
  id: "s1", structure_key: "greenhouse", title: "The greenhouse",
  body: "Where seedlings start.", gesture: "tap", ...over,
});

describe("sanitiseWalkWelcome", () => {
  it("keeps a welcome per language, trimmed", () => {
    expect(sanitiseWalkWelcome({ en: "  Come in.  ", es: "Pasa." })).toEqual({ en: "Come in.", es: "Pasa." });
  });

  it("drops a blank welcome, a junk language and anything that is not words", () => {
    expect(sanitiseWalkWelcome({ en: "   ", "not-a-lang!": "hi", fr: 42 })).toEqual({});
    for (const junk of [undefined, null, "hello", ["hello"], 7]) expect(sanitiseWalkWelcome(junk)).toEqual({});
  });

  it("caps a welcome at the same length a step's body is capped at", () => {
    expect(sanitiseWalkWelcome({ en: "x".repeat(WALK_WELCOME_MAX + 300) }).en).toHaveLength(WALK_WELCOME_MAX);
  });
});

describe("walkDocumentFrom: what a save stores", () => {
  it("stores the walk and the welcome together, under the welcome's own key", () => {
    const next = walkDocumentFrom({}, { walk: { en: [step()] }, welcome: { en: "Come in." } });
    expect(next.walk.en).toHaveLength(1);
    expect(next.welcome).toEqual({ en: "Come in." });
    expect(next.doc).toEqual({ en: next.walk.en, [WALK_WELCOME_KEY]: { en: "Come in." } });
  });

  it("keeps the stored welcome when the save does not mention one", () => {
    // A client that only knows the walk must not wipe a welcome it never showed.
    const stored = { en: [step()], [WALK_WELCOME_KEY]: { en: "Come in." } };
    const next = walkDocumentFrom(stored, { walk: { en: [step({ title: "Renamed" })] } });
    expect(next.walk.en[0].title).toBe("Renamed");
    expect(next.welcome).toEqual({ en: "Come in." });
  });

  it("clears the welcome when the save sends an empty one, because that is the founder's answer", () => {
    const stored = { en: [step()], [WALK_WELCOME_KEY]: { en: "Come in." } };
    const next = walkDocumentFrom(stored, { walk: { en: [step()] }, welcome: { en: "  " } });
    expect(next.welcome).toEqual({});
    expect(next.doc).not.toHaveProperty(WALK_WELCOME_KEY);
  });

  it("still reads the old shape, a body that IS the walk", () => {
    expect(walkDocumentFrom({}, { en: [step()] }).walk.en).toHaveLength(1);
  });

  it("never lets the welcome's key pass for a language", () => {
    const next = walkDocumentFrom({}, { walk: { en: [step()] }, welcome: { en: "Come in." } });
    // Round trip: what was stored reads back as the same walk and welcome.
    expect(Object.keys(sanitiseWalk(next.doc)), "the languages the walk reads back").toEqual(["en"]);
    expect(servedWalk(next.doc, "en").walk).toHaveLength(1);
    expect(storedWalkWelcome(next.doc)).toEqual({ en: "Come in." });
  });
});

describe("servedWalk: what the map is handed", () => {
  it("answers null for a village that wrote nothing, and null is no walk at all", () => {
    expect(servedWalk({}, "en")).toEqual({ walk: null, welcome: null });
    expect(servedWalk(null, "en")).toEqual({ walk: null, welcome: null });
  });

  it("hands over the village's steps and welcome for the language asked", () => {
    const doc = { en: [step()], es: [step({ title: "El invernadero" })], [WALK_WELCOME_KEY]: { en: "Come in.", es: "Pasa." } };
    expect(servedWalk(doc, "es").walk?.[0].title).toBe("El invernadero");
    expect(servedWalk(doc, "es").welcome).toBe("Pasa.");
  });

  it("falls back to the default language for each half on its own", () => {
    const doc = { es: [step({ title: "El invernadero" })], en: [step()], [WALK_WELCOME_KEY]: { en: "Come in." } };
    expect(servedWalk(doc, "es").welcome).toBe("Come in.");
    expect(servedWalk({ en: [step()] }, "fr").walk?.[0].title).toBe("The greenhouse");
  });
});

describe("welcomeWalkCheck: the Journey to Launch's question", () => {
  it("is missing on a village that wrote nothing, and says the map offers no walk", () => {
    const r = welcomeWalkCheck(null);
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("Nothing is written yet, so the map offers no walk");
  });

  it("is missing when the walk is written only in a language the map is not served", () => {
    const r = welcomeWalkCheck({ es: [step()] });
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("Written in es only");
    expect(r.detail).toContain(`offers the ${DEFAULT_WALK_LANG} walk`);
  });

  it("is missing when no stop names a place, because the walk has nowhere to go", () => {
    const r = welcomeWalkCheck({ en: [step({ structure_key: "" }), step({ id: "s2", structure_key: "  " })] });
    expect(r.state).toBe("missing");
    expect(r.detail).toBe("2 stops written, and none names a place on the map, so the walk has nowhere to go");
  });

  it("is done once the walk has a stop with a place, and asks for a welcome when there is none", () => {
    const r = welcomeWalkCheck({ en: [step()] });
    expect(r.state).toBe("ok");
    expect(r.detail).toBe("Written, 1 stop. The guide greets people plainly until you write a welcome");
  });

  it("counts the welcome, and says which stops the walk will pass by", () => {
    const r = welcomeWalkCheck({
      en: [step(), step({ id: "s2", structure_key: "" }), step({ id: "s3" })],
      [WALK_WELCOME_KEY]: { en: "Come in." },
    });
    expect(r.state).toBe("ok");
    expect(r.detail).toBe("Written, 3 stops and your own welcome. 1 names no place, so the walk passes it by");
  });

  it("does not count a welcome alone as a walk", () => {
    expect(welcomeWalkCheck({ [WALK_WELCOME_KEY]: { en: "Come in." } }).state).toBe("missing");
  });
});
