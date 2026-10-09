/**
 * The platform's ONE at-rest sealing primitive.
 *
 * AES-256-GCM under a 32-byte key carried as 64 hex characters in an
 * environment variable. Two stores use it and they use it identically:
 * `memberSecrets.ts` for a member's own LLM key under `MEMBER_SECRETS_KEY`,
 * and `secrets.ts` for the village's integration credentials under
 * `VILLAGE_SECRETS_KEY`. The functions take the key as an argument so the
 * two never have to share one, and so neither has to grow its own copy of
 * the cipher.
 *
 * This file was extracted from memberSecrets.ts unchanged, algorithm, encoding
 * and all, at the moment the second caller appeared. A second copy of a cipher
 * is how two stores end up with two different iv lengths and one of them wrong.
 *
 * There is deliberately no default key and no per-process fallback. A random
 * key would let a deployment store a credential it can never read again after
 * its next restart, while every panel kept reporting the credential as set.
 * Callers check for a key first and refuse in their own words.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** The one shape a key may take. `keyFromEnv` and `describeKeyEnv` share it, so they cannot disagree. */
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/**
 * The 32 bytes behind `name`, or null. Read at call time, never cached at
 * import, so a test can set and unset it and so a deployment that adds the
 * variable and restarts is not surprised by a stale read.
 *
 * Anything that is not exactly 64 hex characters is null rather than an
 * error: a half-typed key and an absent key are the same condition to every
 * caller, and both must refuse. The SENTENCE an operator reads is where the
 * two part ways, and `describeKeyEnv` below is what tells them apart.
 */
export function keyFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env[name] ?? "").trim();
  if (!HEX_KEY.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

// ── Saying what is wrong with a key, without saying the key ─────────────────

/**
 * WHY THIS EXISTS. On 2026-10-02 a founder set VILLAGE_SECRETS_KEY on the
 * right service, the deploy restarted, and every message still said the key
 * was "not set". `keyFromEnv` answers null for an absent value and for a
 * malformed one alike, which is right for the callers that must refuse, and
 * wrong for the sentence an operator reads: it sent them back to a step they
 * had already done. The variable was there. It was the wrong shape, which is
 * what a hand paste into a host's variable screen produces (quotes, the whole
 * `NAME=value` line, a base64 key, one stray character). `fork-init.mjs`
 * writes bare hex, so a malformed value always comes from a person typing.
 *
 * So the facts below are about the value's SHAPE and never its content. No
 * part of the value is returned, not a prefix and not a last4: the sentence
 * lands in boot logs and in an admin's browser, and both travel further than
 * the environment does.
 */
export interface MalformedKeyFacts {
  /** Characters once the outer whitespace is trimmed, which is how `keyFromEnv` reads it. */
  length: number;
  /** Wrapped in a pair of quotes, straight or curly. */
  quoted: boolean;
  /** Starts with `<NAME>=`: the whole `.env` line pasted into the value box. */
  namePrefixed: boolean;
  /** Whitespace inside the key itself, once any name and quotes are set aside. */
  innerWhitespace: boolean;
  /** The key itself reads as base64, which is what `openssl rand -base64 32` prints. */
  looksBase64: boolean;
  /**
   * Characters in the key itself that are not 0-9 or a-f, once any name and
   * quotes are set aside. Whitespace is counted by `innerWhitespace` instead,
   * so one stray character is reported once.
   */
  nonHex: number;
}

export type KeyEnvReading =
  | { state: "missing" }
  | { state: "ok" }
  | { state: "malformed"; facts: MalformedKeyFacts };

const OPENING_QUOTES = "\"'`“‘";
const CLOSING_QUOTES = "\"'`”’";

/**
 * What `name` holds, as `keyFromEnv` would read it. `ok` exactly when
 * `keyFromEnv` returns a key: both test the trimmed value against `HEX_KEY`.
 * An empty or whitespace-only value is `missing`, since a host's variable
 * screen that saved a blank is a variable nobody set.
 */
export function describeKeyEnv(name: string, env: NodeJS.ProcessEnv = process.env): KeyEnvReading {
  const trimmed = (env[name] ?? "").trim();
  if (!trimmed) return { state: "missing" };
  if (HEX_KEY.test(trimmed)) return { state: "ok" };
  const prefix = new RegExp(`^(?:export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "i");
  const namePrefixed = prefix.test(trimmed);
  const afterName = namePrefixed ? trimmed.replace(prefix, "").trim() : trimmed;
  const quoted =
    afterName.length >= 2 &&
    OPENING_QUOTES.includes(afterName[0]) &&
    CLOSING_QUOTES.includes(afterName[afterName.length - 1]);
  const key = quoted ? afterName.slice(1, -1).trim() : afterName;
  const nonHex = (key.match(/[^0-9a-fA-F\s]/g) ?? []).length;
  return {
    state: "malformed",
    facts: {
      length: trimmed.length,
      quoted,
      namePrefixed,
      innerWhitespace: /\s/.test(key),
      // Base64's own alphabet, holding something hex cannot, and carrying a
      // mark of base64 (padding, + or /) or the length 32 bytes encode to.
      looksBase64:
        nonHex > 0 &&
        /^[A-Za-z0-9+/_-]+={0,2}$/.test(key) &&
        (/[+/=]/.test(key) || key.length === 43 || key.length === 44),
      nonHex,
    },
  };
}

/** The rule, said the same way everywhere a key is refused. */
const KEY_RULE = "It must be exactly 64 characters, using only 0-9 and a-f, with nothing else in the value.";

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * ONE sentence naming what is wrong, or null when the key is usable. It names
 * the variable and the shape of its value, and never a character of it.
 */
export function keyEnvSentence(name: string, reading: KeyEnvReading): string | null {
  if (reading.state === "ok") return null;
  if (reading.state === "missing") {
    return `${name} is not set, or is empty, in the environment this server started with.`;
  }
  const f = reading.facts;
  const withs: string[] = [];
  if (f.namePrefixed) withs.push(`the name ${name}= in front of the key`);
  if (f.quoted) withs.push("quotes around it");
  if (f.innerWhitespace) withs.push("a space or line break inside it");
  if (!f.looksBase64 && f.nonHex > 0) {
    withs.push(`${f.nonHex} ${f.nonHex === 1 ? "character that is" : "characters that are"} not 0-9 or a-f`);
  }
  return (
    `${name} is set, but it is ${f.length} ${f.length === 1 ? "character" : "characters"}` +
    (f.looksBase64 ? " in base64" : "") +
    (withs.length ? ` with ${joinAnd(withs)}` : "") +
    `. ${KEY_RULE}`
  );
}

/** `describeKeyEnv` and `keyEnvSentence` together: the sentence for `name`, or null when it is usable. */
export function keyEnvProblem(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return keyEnvSentence(name, describeKeyEnv(name, env));
}

/**
 * Seal a plaintext. Fresh 12-byte iv per call, so the same secret stored twice
 * produces two different rows and nothing about the plaintext leaks through
 * equality of ciphertexts.
 */
export function sealWith(key: Buffer, plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Open a sealed value. Null on a wrong key or a tampered row, never a throw
 * into a caller: the tag check is the whole point, and a failed tag is
 * information the caller has to act on rather than a crash.
 */
export function openWith(key: Buffer, sealed: Sealed): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
