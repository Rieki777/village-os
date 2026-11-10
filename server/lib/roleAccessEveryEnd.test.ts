/**
 * EVERY WAY A SEATING ENDS RAISES REVOKE TASKS, or says why it does not.
 *
 * A new place that sets `ended_at` on org_role_assignments must call
 * `raiseRevokeForEnded`, or be named here with the reason. The draft publish
 * (end_holding) and draft revert paths are covered by this scan, because
 * publishing a draft needs a whole chart to test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EXEMPT: Record<string, string> = {
  "server/repos/seatApplications.ts": "a renewal ends the old seating of the SAME person in the same role; their access stays and no grant is raised again",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules") walk(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("seating ends and access", () => {
  it("every UPDATE that ends an org seating raises revoke tasks or is exempt", () => {
    const bad: string[] = [];
    for (const file of walk("server")) {
      const src = readFileSync(file, "utf8");
      if (!/UPDATE org_role_assignments SET ended_at/.test(src)) continue;
      const rel = file.split("\\").join("/");
      if (rel in EXEMPT) continue;
      // forgetDocumentedHolder ends documented holders, who hold no account to give access to.
      if (!src.includes("raiseRevokeForEnded") && !(rel === "server/lib/orgChart.ts")) bad.push(rel);
      if (rel === "server/lib/orgChart.ts") {
        const calls = (src.match(/raiseRevokeForEnded\(/g) ?? []).length;
        // endSeating and releaseSeatingsForUser (plus the definition import is not a call)
        expect(calls).toBeGreaterThanOrEqual(2);
      }
    }
    expect(bad).toEqual([]);
  });
});
