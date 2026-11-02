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
import { natalSigns, risingSign, skyAt, zonedToUtc } from "./geneKeysSky";
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

  it("agrees with four more published charts, read through each town's own clock that day", () => {
    const charts: [string, Date, string, string][] = [
      // Barack Obama: 4 August 1961, 19:24, Honolulu.
      ["Obama", zonedToUtc(1961, 8, 4, 19, 24, "Pacific/Honolulu"), "Leo", "Gemini"],
      // Steve Jobs: 24 February 1955, 19:15, San Francisco.
      ["Jobs", zonedToUtc(1955, 2, 24, 19, 15, "America/Los_Angeles"), "Pisces", "Aries"],
      // Marilyn Monroe: 1 June 1926, 09:30, Los Angeles.
      ["Monroe", zonedToUtc(1926, 6, 1, 9, 30, "America/Los_Angeles"), "Gemini", "Aquarius"],
      // John Lennon: 9 October 1940, 18:30, Liverpool.
      ["Lennon", zonedToUtc(1940, 10, 9, 18, 30, "Europe/London"), "Libra", "Aquarius"],
    ];
    for (const [who, when, sun, moon] of charts) {
      const s = natalSigns([when]);
      expect([name(s.sun), name(s.moon)], who).toEqual([sun, moon]);
    }
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

describe("a member's own rising sign", () => {
  it("agrees with five published charts, from the exact time and the town's coordinates", () => {
    const charts: [string, Date, number, number, string][] = [
      // Princess Diana: 19:45 BST, Sandringham (52.83 N, 0.50 E). Sagittarius rising.
      ["Diana", zonedToUtc(1961, 7, 1, 19, 45, "Europe/London"), 52.83, 0.5, "Sagittarius"],
      // Albert Einstein: 11:30 local mean time at Ulm (48.40 N, 9.99 E), 10:50 UTC. Cancer rising.
      ["Einstein", new Date("1879-03-14T10:50:00Z"), 48.4, 9.99, "Cancer"],
      // Barack Obama: 19:24, Honolulu (21.31 N, 157.86 W). Aquarius rising.
      ["Obama", zonedToUtc(1961, 8, 4, 19, 24, "Pacific/Honolulu"), 21.31, -157.86, "Aquarius"],
      // Steve Jobs: 19:15, San Francisco (37.77 N, 122.42 W). Virgo rising.
      ["Jobs", zonedToUtc(1955, 2, 24, 19, 15, "America/Los_Angeles"), 37.77, -122.42, "Virgo"],
      // Marilyn Monroe: 09:30, Los Angeles (34.05 N, 118.24 W). Leo rising.
      ["Monroe", zonedToUtc(1926, 6, 1, 9, 30, "America/Los_Angeles"), 34.05, -118.24, "Leo"],
    ];
    for (const [who, when, lat, lon, sign] of charts) expect(name(risingSign(when, lat, lon)), who).toBe(sign);
  });

  it("moves through all twelve signs in a day, about two hours each", () => {
    const seen = new Set<number>();
    for (let h = 0; h < 24; h++) seen.add(risingSign(new Date(Date.UTC(2024, 2, 20, h)), 51.5, -0.13)!);
    expect(seen.size).toBeGreaterThanOrEqual(11);
  });

  it("gives nothing for a latitude it cannot read", () => {
    expect(risingSign(new Date(), Number.NaN, 0)).toBeNull();
    expect(risingSign(new Date(), 95, 0)).toBeNull();
  });
});
