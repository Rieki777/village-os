/**
 * THE NAME OF AN UPLOAD IS ITS PASSWORD.
 *
 * `/api/uploads/:filename` has no gate, so the random tail `stampedName`
 * mints is the only thing between a stranger and an investor's cap table, an
 * unpublished portrait, or a CV attached to a proposal. These tests hold two
 * things: the tail comes from the CSPRNG (a `Math.random` tail is predictable
 * from outputs the public proposal upload hands back), and the name still has
 * the shape `uploadsSweep.ts` reads, so the retention sweep and the orphan
 * report can still place every file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAMP_TAIL_LENGTH, stampTail, stampedName } from "./uploads";
import { isProposalAttachment, stampOf } from "./uploadsSweep";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stampedName draws its tail from the CSPRNG", () => {
  it("never consults Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    for (let i = 0; i < 50; i++) stampedName("proposal", ".pdf");
    expect(spy).not.toHaveBeenCalled();
  });

  it("carries eight characters of tail, about 41 bits, where it used to carry five", () => {
    for (let i = 0; i < 200; i++) {
      const tail = stampTail();
      expect(tail).toMatch(/^[a-z0-9]{8}$/);
    }
    expect(STAMP_TAIL_LENGTH).toBe(8);
  });

  it("does not repeat across a large draw", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(stampTail());
    expect(seen.size).toBe(5000);
  });

  it("uses the whole alphabet, so the entropy is not quietly a smaller one", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const c of stampTail()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(36);
  });
});

describe("the shape the sweep reads back", () => {
  it("still parses as a stamped name, with its millisecond", () => {
    const before = Date.now();
    const name = stampedName("portrait", ".webp");
    const ms = stampOf(name);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(before);
    expect(name).toMatch(/^portrait-\d{13}-[a-z0-9]{8}\.webp$/);
  });

  it("is still recognised as a proposal attachment by the retention sweep", () => {
    expect(isProposalAttachment(stampedName("proposal", ".jpg"))).toBe(true);
    expect(isProposalAttachment(stampedName("proposal", ".bin"))).toBe(true);
  });
});
