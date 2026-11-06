/**
 * The mailer's address checks, rewritten without a backtracking regex
 * (CodeQL js/polynomial-redos #449, #450, #451). Held to the regexes they
 * replace on every case below, and timed on the input CodeQL names.
 */
import { describe, expect, it } from "vitest";
import { isPlainAddress, normalizeRecipients, validEmailSender } from "./mailer";

const OLD_PLAIN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OLD_SENDER = (s: string) =>
  /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) || /^[^<>]+<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(s);

const CASES = [
  "a@b.c", "first.last@village.example", "x@y.z.w", "a@.b", "a@b.", "a@b", "@b.c", "a@@b.c", "a@b@c.d",
  "a b@c.d", "a@b .c", "", "a@b..c", "a@.b.c", "a.@b.c", ".a@b.c", "a@b.c.", "<a@b.c>", "a<b@c.d",
  "Name <a@b.c>", "Village Team <hello@village.example>", "Name <a@b>", "Name <a@b.c", "<a@b.c>x",
  "Na<me <a@b.c>", "Name <<a@b.c>>", "Name <a b@c.d>", "@ <a@b.c>", "  spaced@x.y  ",
];

describe("the mailer's address checks", () => {
  it("accept exactly what the regexes they replace accepted", () => {
    for (const s of CASES) {
      expect(isPlainAddress(s), s).toBe(OLD_PLAIN.test(s));
      expect(validEmailSender(s), s).toBe(OLD_SENDER(s.trim()) && s.trim() !== "");
    }
  });

  it("finish at once on the input that made the old regex crawl", () => {
    const attack = "!@!." + "!.".repeat(50_000);
    const t0 = performance.now();
    isPlainAddress(attack);
    validEmailSender(attack);
    normalizeRecipients([attack]);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("still splits, trims, filters and dedupes a recipient list", () => {
    expect(normalizeRecipients(["a@b.c, a@b.c ,nope, x@y.z"])).toEqual(["a@b.c", "x@y.z"]);
  });
});
