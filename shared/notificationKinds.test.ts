import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  celebrates,
  celebrationFor,
  kindOf,
  manyLine,
  UNKNOWN_KIND,
} from "./notificationKinds";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Top-level members of an object literal source, braces included. */
function splitTop(block: string): string[] {
  const inner = block.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let str: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/**
 * Every type string the server actually produces.
 *
 * Read out of the source and never from a list beside it, because a list
 * beside it is the thing that goes stale. Three producer shapes exist:
 * `notify({ type: "x", … })`, `notifyRoll(ballot, { type: "x", … })` and
 * `notifyAdmins("x", …)`.
 *
 * The `type:` VALUE is taken whole and every literal inside it is collected,
 * because one call site picks its type with a ternary and a regex anchored on
 * `type: "` would have read one arm and silently missed the other.
 *
 * A FOURTH SHAPE: `type: TABLE[key]`, where the table is a const in the same
 * file mapping a moment to a type. `tellStewards` sends one of three window
 * types that way, and a scanner that read only literals reported all three as
 * blurbs with no producer while the server was sending them every hour. When
 * the arm holds no literal and reads as an index into a local const, that
 * const's own string values are collected.
 */
function producedTypes(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, "server"));

  const found = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    // notifyAdmins("<type>", …)
    for (const m of src.matchAll(/\bnotifyAdmins\s*\(\s*"([a-z_]+)"/g)) found.add(m[1]);
    // notify({ … type: "<type>" … }) — the object literal is brace-matched so
    // a `type:` on some unrelated neighbouring call cannot leak in.
    for (const m of src.matchAll(/\b(?:notify|notifyRoll|insertNotification)\s*\(/g)) {
      const open = src.indexOf("{", m.index + m[0].length - 1);
      if (open < 0 || open - m.index > 60) continue;
      let depth = 0;
      let str: string | null = null;
      let j = open;
      for (; j < src.length; j++) {
        const c = src[j];
        if (str) {
          if (c === "\\") j++;
          else if (c === str) str = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          str = c;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) break;
      }
      for (const part of splitTop(src.slice(open, j + 1))) {
        const kv = part.trim().match(/^type\s*:\s*([\s\S]*)$/);
        if (!kv) continue;
        // Drop the operands of a comparison first. A ternary that picks the
        // type by testing `result.outcome === "passed"` would otherwise
        // report "passed" as a notification type, which it is not.
        const arms = kv[1].replace(/[!=]==?\s*"[a-z_]+"/g, "");
        let any = false;
        for (const lit of arms.matchAll(/"([a-z_]+)"/g)) {
          found.add(lit[1]);
          any = true;
        }
        if (any) continue;
        // `type: TABLE[key]`: read TABLE's own values out of the same file.
        const table = arms.trim().match(/^([A-Za-z_$][\w$]*)\s*\[/);
        if (!table) continue;
        const decl = src.match(new RegExp(`\\b${table[1]}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
        if (!decl) continue;
        for (const lit of decl[1].matchAll(/"([a-z_]+)"/g)) found.add(lit[1]);
      }
    }
  }
  return found;
}

describe("the notification catalogue", () => {
  it("has a blurb for every type the server actually sends", () => {
    const produced = producedTypes();
    // A control: if the scanner found nothing it would pass this vacuously.
    expect(produced.size).toBeGreaterThan(20);
    expect(produced.has("gratitude")).toBe(true);
    const missing = Array.from(produced).filter((t) => !(t in NOTIFICATION_KINDS)).sort();
    expect(missing, `add these to shared/notificationKinds.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares nothing the server never sends", () => {
    const produced = producedTypes();
    const orphans = Object.keys(NOTIFICATION_KINDS).filter((t) => !produced.has(t)).sort();
    expect(orphans, `these have a blurb and no producer: ${orphans.join(", ")}`).toEqual([]);
  });

  it("rations celebration to four kinds", () => {
    const loud = Object.entries(NOTIFICATION_KINDS).filter(([, k]) => k.celebrate).map(([t]) => t).sort();
    expect(loud).toEqual(["ballot_carried", "cycle_settled", "quest_consented", "stage_advanced"]);
  });

  it("puts every kind in a declared group", () => {
    const ids = new Set(NOTIFICATION_GROUPS.map((g) => g.id));
    for (const [type, k] of Object.entries(NOTIFICATION_KINDS)) {
      expect(ids.has(k.group), `${type} claims group ${k.group}`).toBe(true);
    }
  });

  it("gives every batched line somewhere to put the count", () => {
    for (const [type, k] of Object.entries(NOTIFICATION_KINDS)) {
      expect(k.many, `${type} has no {n}`).toContain("{n}");
      expect(k.blurb.length, `${type} blurb is too short to say anything`).toBeGreaterThan(20);
    }
  });

  it("uses no dash characters the voice rules refuse", () => {
    for (const [type, k] of Object.entries(NOTIFICATION_KINDS)) {
      expect(`${k.blurb} ${k.many}`, type).not.toMatch(/[–—]/);
    }
  });
});

describe("reading a kind", () => {
  it("degrades an unheard-of type to something quiet and renderable", () => {
    expect(kindOf("not_a_real_type")).toBe(UNKNOWN_KIND);
    expect(celebrates("not_a_real_type")).toBe(false);
    expect(kindOf("not_a_real_type").group).toBe("village");
  });

  it("puts the count into the batched line", () => {
    expect(manyLine("gratitude", 7)).toContain("7");
    expect(manyLine("gratitude", 7)).not.toContain("{n}");
  });

  it("draws a different scene for each celebrated kind", () => {
    const scenes = ["stage_advanced", "ballot_carried", "cycle_settled", "quest_consented"].map(celebrationFor);
    expect(new Set(scenes).size).toBe(4);
  });
});
