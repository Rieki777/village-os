/**
 * A MEMBER'S OWN WESTERN SIGNS (the coordinator's call on Rye's request of
 * 2026-11-01, "gene keys + human design and astrology"): the Sun and Moon
 * signs of their birth, read in the browser from the same date and town the
 * Gene Keys page already asks for. Only the two sign numbers are ever stored.
 *
 * A sign is said only when the whole span the birth could fall in agrees on
 * it. Without a birth time the Moon (and on a cusp day the Sun) can change sign
 * inside that span, and then the sign is unknown, never guessed.
 *
 * Checked against published charts: Princess Diana (1 July 1961, 19:45 BST,
 * Sandringham: Sun in Cancer, Moon in Aquarius) and Albert Einstein (14 March
 * 1879, 11:30 local mean time at Ulm, 10:50 UTC: Sun in Pisces, Moon in
 * Sagittarius); the March 2024 equinox (the Sun enters Aries at 03:06 UTC on
 * the 20th).
 */
import { describe, expect, it } from "vitest";
import { natalSigns, skyAt, zonedToUtc } from "./geneKeysSky";
import { SIGNS } from "./sessionCard";

const at = (iso: string) => [new Date(iso)];
const name = (n: number | null) => (n == null ? null : SIGNS[n]);

describe("a member's own Sun and Moon signs", () => {
  it("agrees with published charts", () => {
    const diana = natalSigns([zonedToUtc(1961, 7, 1, 19, 45, "Europe/London")]);
    expect([name(diana.sun), name(diana.moon)]).toEqual(["Cancer", "Aquarius"]);
    const einstein = natalSigns(at("1879-03-14T10:50:00Z"));
    expect([name(einstein.sun), name(einstein.moon)]).toEqual(["Pisces", "Sagittarius"]);
  });

  it("knows the Sun on either side of a sign boundary, and says nothing when the birth could be on both", () => {
    expect(name(natalSigns(at("2024-03-20T02:55:00Z")).sun)).toBe("Pisces");
    expect(name(natalSigns(at("2024-03-20T03:20:00Z")).sun)).toBe("Aries");
    expect(natalSigns([new Date("2024-03-20T02:00:00Z"), new Date("2024-03-20T04:00:00Z")]).sun).toBeNull();
  });

  it("says nothing about the Moon when it changed sign inside the span the birth could be in", () => {
    // The Moon's ingress after 5 August 2024, found by the card's own void-of-course reading.
    const ingress = Date.parse(skyAt(new Date("2024-08-05T17:00:00Z")).moonVoidUntil!);
    const hour = 60 * 60 * 1000;
    const across = natalSigns([new Date(ingress - hour), new Date(ingress + hour)]);
    expect(across.moon).toBeNull();
    expect(across.sun).not.toBeNull();
    const after = natalSigns([new Date(ingress + hour), new Date(ingress + 2 * hour)]);
    expect(after.moon).toBe((natalSigns([new Date(ingress - hour)]).moon! + 1) % 12);
  });

  it("says nothing at all from no instants", () => {
    expect(natalSigns([])).toEqual({ sun: null, moon: null });
  });
});
