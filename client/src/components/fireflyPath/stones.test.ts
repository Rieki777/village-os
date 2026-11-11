/**
 * THE FIREFLY PATH, its pure rules: which stone each finding belongs to, the
 * walking order of the final review, the inbox door, and the swipe.
 */
import { describe, expect, it } from "vitest";
import { LAST_STONE, STONES, confirmBy, inboxFor, onStone, orderByStone, ownsKeys, replyBy, stoneOfField, swipeStep } from "./stones";

describe("the stones", () => {
  it("are six, in the brief's order", () => {
    expect(STONES).toEqual(["role", "moon", "why", "energy", "about", "send"]);
    expect(LAST_STONE).toBe(5);
  });

  it("every field the form or the server names has its stone, and an unknown one stays on Send", () => {
    expect(["roles", "aim", "card", "serves", "drafts:moon", "why", "terms", "checkConsent", "references", "links", "files", "drafts:about", "agreed", "membership", "name", "email"].map(stoneOfField)).toEqual([
      0, 1, 1, 1, 1, 2, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5,
    ]);
    expect(stoneOfField(null)).toBe(LAST_STONE);
    expect(stoneOfField("somethingNew")).toBe(LAST_STONE);
  });

  it("the review lists findings in walking order, keeping the order within a stone", () => {
    const found = [
      { field: "name", n: 1 },
      { field: "why", n: 2 },
      { field: "email", n: 3 },
      { field: "card", n: 4 },
      { field: "aim", n: 5 },
    ];
    expect(orderByStone(found).map((p) => p.n)).toEqual([4, 5, 2, 1, 3]);
    expect(onStone(found, 1).map((p) => p.n)).toEqual([4, 5]);
    expect(onStone(found, 3)).toEqual([]);
  });
});

describe("the inbox door", () => {
  it("opens the provider's own webmail for a domain we know, in any case", () => {
    expect(inboxFor("Rowan@GMail.com")).toEqual({ name: "Gmail", href: "https://mail.google.com/" });
    expect(inboxFor("a@hotmail.com")?.name).toBe("Outlook");
    expect(inboxFor("a@proton.me")?.href).toBe("https://mail.proton.me/");
  });
  it("guesses nothing for a domain we do not know, or no address", () => {
    expect(inboxFor("a@village.example")).toBeNull();
    expect(inboxFor("gmail.com")).toBeNull();
    expect(inboxFor("")).toBeNull();
  });
});

describe("a swipe", () => {
  it("left walks on, right walks back, and short or mostly vertical moves say nothing", () => {
    expect(swipeStep(-120, 10)).toBe(1);
    expect(swipeStep(120, -10)).toBe(-1);
    expect(swipeStep(-40, 0)).toBe(0);
    expect(swipeStep(-100, 90)).toBe(0);
  });
});

describe("keys a field owns", () => {
  it("is false off a field and for nothing", () => {
    expect(ownsKeys(null)).toBe(false);
  });
});

describe("dates for the next steps", () => {
  it("the link works for the hours given, and the reply is counted in days", () => {
    const at = new Date("2026-11-11T10:00:00Z");
    expect(confirmBy(at, 48).toISOString()).toBe("2026-11-13T10:00:00.000Z");
    expect(replyBy(at, 7)?.toISOString()).toBe("2026-11-18T10:00:00.000Z");
    expect(replyBy(at, 0)).toBeNull();
  });
});

describe("Enter walks on", () => {
  it("from a one-line field, never from a long answer, a choice or a file", async () => {
    const el = (tag: string, type?: string) => ({ tagName: tag, type: type ?? "" }) as unknown as EventTarget;
    const { enterWalksOn } = await import("./stones");
    expect(enterWalksOn(el("INPUT", "text"))).toBe(true);
    expect(enterWalksOn(el("INPUT", "email"))).toBe(true);
    expect(enterWalksOn(el("INPUT", "date"))).toBe(true);
    expect(enterWalksOn(el("TEXTAREA"))).toBe(false);
    expect(enterWalksOn(el("INPUT", "checkbox"))).toBe(false);
    expect(enterWalksOn(el("INPUT", "file"))).toBe(false);
    expect(enterWalksOn(el("SELECT"))).toBe(false);
    expect(enterWalksOn(null)).toBe(false);
  });
});
