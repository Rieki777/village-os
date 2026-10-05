/**
 * Saying what is wrong with a sealing key, without saying the key.
 *
 * On 2026-10-02 a founder set VILLAGE_SECRETS_KEY on the right service and
 * every message still said "not set". `keyFromEnv` answers null for an absent
 * value and a malformed one alike, and both refuse, which is right; the
 * sentence an operator reads has to tell them apart. These pin the describer
 * against the shapes a hand paste actually produces, pin that it agrees with
 * `keyFromEnv` on every one of them, and pin that the sentence never carries
 * any part of the value.
 */
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { describeKeyEnv, keyEnvProblem, keyEnvSentence, keyFromEnv } from "./sealedBox";

const NAME = "VILLAGE_SECRETS_KEY";
/** 64 hex characters with every digit and letter in play, so no fixture passes on a lucky alphabet. */
const KEY = createHash("sha256").update("sealed-box-describer-fixture").digest("hex");
const B64 = Buffer.from(KEY, "hex").toString("base64");
const B64URL = Buffer.from(KEY, "hex").toString("base64url");

const env = (value: string | undefined) => (value === undefined ? {} : { [NAME]: value }) as NodeJS.ProcessEnv;
const read = (value: string | undefined) => describeKeyEnv(NAME, env(value));
const facts = (value: string) => {
  const r = read(value);
  if (r.state !== "malformed") throw new Error(`expected malformed, got ${r.state}`);
  return r.facts;
};
const sentence = (value: string | undefined) => keyEnvProblem(NAME, env(value));

/** Every shape below, so the agreement check and the leak check cannot skip one. */
const FIXTURES: Record<string, string | undefined> = {
  absent: undefined,
  empty: "",
  blank: "   \n",
  valid: KEY,
  upper: KEY.toUpperCase(),
  padded: `  ${KEY}\n`,
  quoted: `"${KEY}"`,
  singleQuoted: `'${KEY}'`,
  curlyQuoted: `“${KEY}”`,
  prefixed: `${NAME}=${KEY}`,
  prefixedQuoted: `${NAME}="${KEY}"`,
  exported: `export ${NAME}=${KEY}`,
  base64: B64,
  base64url: B64URL,
  short63: KEY.slice(0, 63),
  long65: `${KEY}a`,
  innerSpace: `${KEY.slice(0, 32)} ${KEY.slice(32)}`,
  stray: `${KEY.slice(0, 63)}g`,
};

/**
 * Every 4-character run of `value` that appears in `text`. Runs that sit
 * inside `export NAME=` are left out: the variable's name is not secret, every
 * sentence names it, and a value with the `.env` line pasted into it carries it
 * too, `export ` and all.
 */
function leakedRuns(text: string, value: string): string[] {
  const publicText = `export ${NAME}=`;
  const hits = new Set<string>();
  for (let i = 0; i + 4 <= value.length; i++) {
    const run = value.slice(i, i + 4);
    if (publicText.includes(run)) continue;
    if (text.includes(run)) hits.add(run);
  }
  return [...hits];
}

describe("describeKeyEnv", () => {
  it("reads absent, empty and blank as missing", () => {
    expect(read(undefined)).toEqual({ state: "missing" });
    expect(read("")).toEqual({ state: "missing" });
    expect(read("   \n")).toEqual({ state: "missing" });
    expect(sentence(undefined)).toBe(`${NAME} is not set, or is empty, in the environment this server started with.`);
  });

  it("reads a valid key as ok, with surrounding whitespace and in either case", () => {
    expect(read(KEY)).toEqual({ state: "ok" });
    expect(read(KEY.toUpperCase())).toEqual({ state: "ok" });
    expect(read(`  ${KEY}\n`)).toEqual({ state: "ok" });
    expect(sentence(`  ${KEY}\n`)).toBeNull();
  });

  it("names quotes, and says it in the sentence an operator reads", () => {
    expect(facts(`"${KEY}"`)).toEqual({
      length: 66, quoted: true, namePrefixed: false, innerWhitespace: false, looksBase64: false, nonHex: 0,
    });
    expect(sentence(`"${KEY}"`)).toBe(
      `${NAME} is set, but it is 66 characters with quotes around it. ` +
        "It must be exactly 64 characters, using only 0-9 and a-f, with nothing else in the value.",
    );
    // Single quotes and the curly pair a word processor substitutes.
    expect(facts(`'${KEY}'`).quoted).toBe(true);
    expect(facts(`“${KEY}”`).quoted).toBe(true);
  });

  it("names a NAME= prefix, the whole .env line pasted into the value box", () => {
    expect(facts(`${NAME}=${KEY}`)).toMatchObject({ namePrefixed: true, quoted: false, nonHex: 0, length: 84 });
    expect(sentence(`${NAME}=${KEY}`)).toContain(`with the name ${NAME}= in front of the key.`);
    // With quotes as well, both are named, and neither is counted as stray.
    expect(facts(`${NAME}="${KEY}"`)).toMatchObject({ namePrefixed: true, quoted: true, nonHex: 0 });
    expect(sentence(`${NAME}="${KEY}"`)).toContain(`the name ${NAME}= in front of the key and quotes around it`);
    expect(facts(`export ${NAME}=${KEY}`).namePrefixed).toBe(true);
  });

  it("names base64, which is what openssl rand -base64 32 prints", () => {
    expect(B64).toHaveLength(44);
    expect(facts(B64)).toMatchObject({ looksBase64: true, length: 44, quoted: false, namePrefixed: false });
    expect(sentence(B64)).toContain("it is 44 characters in base64.");
    // The url-safe alphabet with no padding, 43 characters for 32 bytes.
    expect(facts(B64URL)).toMatchObject({ looksBase64: true, length: 43 });
  });

  it("names a length one short and one long, and nothing else when nothing else is wrong", () => {
    expect(facts(KEY.slice(0, 63))).toEqual({
      length: 63, quoted: false, namePrefixed: false, innerWhitespace: false, looksBase64: false, nonHex: 0,
    });
    expect(sentence(KEY.slice(0, 63))).toBe(
      `${NAME} is set, but it is 63 characters. ` +
        "It must be exactly 64 characters, using only 0-9 and a-f, with nothing else in the value.",
    );
    expect(facts(`${KEY}a`).length).toBe(65);
    expect(sentence(`${KEY}a`)).toContain("it is 65 characters.");
  });

  it("names a space inside the key", () => {
    const v = `${KEY.slice(0, 32)} ${KEY.slice(32)}`;
    expect(facts(v)).toMatchObject({ innerWhitespace: true, length: 65, nonHex: 0 });
    expect(sentence(v)).toContain("with a space or line break inside it");
  });

  it("counts a stray character once, as a stray character", () => {
    expect(facts(`${KEY.slice(0, 63)}g`)).toMatchObject({ length: 64, nonHex: 1, looksBase64: false });
    expect(sentence(`${KEY.slice(0, 63)}g`)).toContain("with 1 character that is not 0-9 or a-f");
  });

  it("agrees with keyFromEnv on every shape: ok exactly when a key comes back", () => {
    for (const [label, value] of Object.entries(FIXTURES)) {
      const ok = read(value).state === "ok";
      expect(ok, label).toBe(keyFromEnv(NAME, env(value)) !== null);
      expect(sentence(value) === null, label).toBe(ok);
    }
  });

  it("speaks of whichever variable it is asked about", () => {
    const member = keyEnvSentence("MEMBER_SECRETS_KEY", describeKeyEnv("MEMBER_SECRETS_KEY", { MEMBER_SECRETS_KEY: `"${KEY}"` }));
    expect(member).toContain("MEMBER_SECRETS_KEY is set, but it is 66 characters with quotes around it.");
    expect(member).not.toContain(NAME);
  });
});

describe("the sentence never carries the value", () => {
  it("holds no 4-character run of any fixture's value", () => {
    for (const [label, value] of Object.entries(FIXTURES)) {
      const said = sentence(value);
      // Absent and blank values hold nothing to leak, and "" is in every string.
      if (said === null || value === undefined || !value.trim()) continue;
      expect(said, label).not.toContain(value.trim());
      expect(leakedRuns(said, value), label).toEqual([]);
    }
  });

  it("and the instrument sees a leak when there is one", () => {
    // The known positive. A helper that could never report a run would pass
    // the test above on any sentence at all, so the same call is shown to
    // fire on a sentence that does carry four characters of the value.
    for (const value of [FIXTURES.quoted!, FIXTURES.prefixed!, FIXTURES.base64!, FIXTURES.stray!]) {
      const said = sentence(value)!;
      const planted = value.slice(value.length - 9, value.length - 5);
      expect(leakedRuns(said, value)).toEqual([]);
      expect(leakedRuns(`${said} ${planted}`, value)).toContain(planted);
    }
  });

  it("holds no run of four hex characters at all, so no hex key could ever show through", () => {
    for (const [label, value] of Object.entries(FIXTURES)) {
      const said = sentence(value);
      if (said === null) continue;
      expect(said, label).not.toMatch(/[0-9a-f]{4}/i);
    }
  });
});
