/**
 * The session-token key lives in exactly one place, and this test is what says so.
 *
 * client/src/lib/gameApi.ts exports TOKEN_KEY and spends its own comment
 * explaining the failure a hand-typed copy causes: a fork that renames the key
 * and misses a copy splits the session in half, and a page reading a key
 * nothing writes reads as permanently signed out. SetPassword.tsx carried a
 * hand-typed copy anyway. It agreed with the constant by coincidence, so
 * nothing failed and nothing could. A comment asking for a rule is not the
 * rule. This is.
 *
 * The scan looks for the VALUE of TOKEN_KEY rather than for a literal spelled
 * out here. That survives the rename this key is waiting for (it carries a
 * village name inside platform code), and it keeps this file from being one
 * more copy of the string it exists to forbid.
 *
 * SCOPE, and what it deliberately does not cover: client/src only. The key also
 * appears twice in docs/prototypes/qa/probe-l1-library.ts, which drives a real
 * browser through localStorage from the outside and is right to name the key as
 * a string. That file belongs to another lane and is not scanned here, so a
 * rename still has to update it by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKEN_KEY } from "@/lib/gameApi";

const CLIENT_SRC = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const OWNER = path.join(CLIENT_SRC, "lib", "gameApi.ts");
const SET_PASSWORD = path.join(CLIENT_SRC, "pages", "SetPassword.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(CLIENT_SRC);
const carriers = files.filter((f) => fs.readFileSync(f, "utf-8").includes(TOKEN_KEY));

describe("the session token key", () => {
  it("scans a real tree with a needle worth scanning for", () => {
    // The positive control. A scan that finds nothing looks exactly like a scan
    // that walked an empty list or hunted an empty string, and this suite would
    // stay green while checking nothing at all.
    expect(TOKEN_KEY.length).toBeGreaterThan(4);
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(SET_PASSWORD);
    expect(carriers).toContain(OWNER);
  });

  it("appears in no client file except the module that owns it", () => {
    const strays = carriers.filter((f) => f !== OWNER).map((f) => path.relative(CLIENT_SRC, f));
    expect(strays).toEqual([]);
  });

  it("reaches SetPassword through the constant", () => {
    const src = fs.readFileSync(SET_PASSWORD, "utf-8");
    expect(src).toContain('import { TOKEN_KEY } from "@/lib/gameApi"');
    expect(src).toContain('writeStored("local", TOKEN_KEY,');
  });
});
