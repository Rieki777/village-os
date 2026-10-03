import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_WORDS, CONTRAST, PASSIVE, RHETORICAL, voiceLint, voiceLintWords } from "./voiceLint";

/**
 * The Words editor's voice check, held to the same lists as the repository's
 * own voice gate. A change to one list without the other fails here.
 *
 * THE GATE IS IMPORTED FOR REAL, BY NODE. `scripts/check-voice.mjs` starts
 * with a shebang, which vitest's transform refuses (server/gratitudeVoices.test.ts
 * records the same dead end), so a plain `node` process imports it and hands
 * back its lists and its verdicts as JSON. Nothing of the gate is re-typed here.
 */

const SAMPLES = [
  "We delve into it.",
  "This is not a party, but a meeting.",
  "Join us on the walk.",
  "Have you ever wondered?",
  `A long pause ${String.fromCharCode(0x2014)} then more.`,
  "Plain words about a supper on Saturday.",
];

interface GateFacts {
  ai: string[];
  contrast: string[];
  passive: string[];
  rhetorical: string;
  found: boolean[];
}

function readGate(): GateFacts {
  const url = pathToFileURL(path.resolve(process.cwd(), "scripts/check-voice.mjs")).href;
  const script = `
    const g = await import(${JSON.stringify(url)});
    const re = (r) => r.source + "/" + r.flags;
    const samples = JSON.parse(process.argv[1]);
    console.log(JSON.stringify({
      ai: g.AI_WORDS,
      contrast: g.CONTRAST.map(re),
      passive: g.PASSIVE.map(re),
      rhetorical: re(g.RHETORICAL),
      found: samples.map((s) => g.checkSpan(s).length > 0),
    }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(SAMPLES)], { encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop() ?? "{}");
}

const regexes = (list: RegExp[]) => list.map((r) => `${r.source}/${r.flags}`);

describe("the voice check's lists", () => {
  const gate = readGate();

  it("are the same as scripts/check-voice.mjs, word for word and pattern for pattern", () => {
    expect(gate.ai.length, "the gate's list was read").toBeGreaterThan(10);
    expect([...AI_WORDS].sort()).toEqual([...gate.ai].sort());
    expect(regexes(CONTRAST)).toEqual(gate.contrast);
    expect(regexes(PASSIVE)).toEqual(gate.passive);
    expect(`${RHETORICAL.source}/${RHETORICAL.flags}`).toBe(gate.rhetorical);
  });

  it("finds whatever the gate finds in the same words", () => {
    SAMPLES.forEach((s, i) => expect(voiceLint(s).length > 0, s).toBe(gate.found[i]));
    expect(gate.found.filter(Boolean)).toHaveLength(5);
  });
});

describe("voiceLint", () => {
  it("names each rule it finds, with what to do instead", () => {
    const rules = (s: string) => voiceLint(s).map((f) => f.rule);
    expect(rules("A pause — here.")).toEqual(["dash"]);
    expect(rules("A pause - here.")).toEqual(["dash"]);
    expect(rules("We leverage the land.")).toEqual(["filler-word"]);
    expect(rules("Unlock your potential.")).toEqual(["filler-word"]);
    expect(rules("Come rather than wait.")).toEqual(["contrast"]);
    expect(rules("Together we can do it.")).toEqual(["passive"]);
    expect(rules("Intro.\n\nImagine if it rained.")).toEqual(["rhetorical-opener"]);
    for (const finding of voiceLint("We leverage the land.")) expect(finding.hint.length).toBeGreaterThan(10);
  });

  it("reads only the words a person reads: no addresses, no tokens, no list markers", () => {
    expect(voiceLint("[See it](https://village.example/leverage-robust)")).toEqual([]);
    expect(voiceLint("Hi {{person.firstName}},\n\n- **When:** {{gathering.when}}\n- **Where:** here")).toEqual([]);
  });

  it("checks the subject, the preview line and the body, and says which", () => {
    const found = voiceLintWords({ subject: "A seamless evening", preheader: "Plain", bodyMd: "Words – more words." });
    expect(found.map((f) => [f.where, f.rule])).toEqual([
      ["subject", "filler-word"],
      ["body", "dash"],
    ]);
  });
});
