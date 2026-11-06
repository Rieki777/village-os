/**
 * EVERY "FIX IT HERE" LINK LANDS ON A SCREEN THAT CAN FIX IT.
 *
 * The founder-path pass of 2026-11-01 found three Journey to Launch rows whose
 * link opened a screen that could not do the thing: the session secret sent a
 * founder to Integrations (an environment variable no screen can set), and the
 * exit terms and the backup drill both sent them to Settings, which holds dues
 * and land figures. Nothing failed, because nothing checked where a link went.
 *
 * This holds every in-app admin link to a tab the admin navigation really has,
 * and pins the three rows to where they now point.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORK_RUNBOOK_URL, LAUNCH_REQUIREMENTS } from "./launchRequirements";

const NAV = readFileSync(join(__dirname, "..", "client", "src", "components", "admin", "adminNavGroups.ts"), "utf8");
const TABS = new Set(Array.from(NAV.matchAll(/key:\s*"([a-z0-9-]+)"/g), (m) => m[1]));
const RUNBOOK = readFileSync(join(__dirname, "..", "docs", "FORK_RUNBOOK.md"), "utf8");

/** GitHub's own anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const anchorOf = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
const ANCHORS = new Set(Array.from(RUNBOOK.matchAll(/^#{1,6}\s+(.+)$/gm), (m) => anchorOf(m[1])));

describe("where a launch row sends a founder", () => {
  it("names only admin tabs that exist", () => {
    expect(TABS.size, "the navigation's tab keys were read").toBeGreaterThan(10);
    for (const r of LAUNCH_REQUIREMENTS) {
      const tab = /^\/admin\?tab=([a-z0-9-]+)/.exec(r.fixAt)?.[1];
      if (tab) expect(TABS.has(tab), `${r.id} opens /admin?tab=${tab}`).toBe(true);
    }
  });

  it("links into the runbook only at headings the runbook has", () => {
    for (const r of LAUNCH_REQUIREMENTS) {
      if (!r.fixAt.startsWith(FORK_RUNBOOK_URL)) continue;
      const anchor = r.fixAt.split("#")[1] ?? "";
      expect(ANCHORS.has(anchor), `${r.id} links to #${anchor}`).toBe(true);
    }
  });

  it("sends the three rows the pass found to screens that can do the thing", () => {
    const at = (id: string) => LAUNCH_REQUIREMENTS.find((r) => r.id === id)?.fixAt ?? "";
    expect(at("exit-policy-terms")).toBe("/admin?tab=exits-admin");
    expect(at("session-secret").startsWith(FORK_RUNBOOK_URL)).toBe(true);
    expect(at("backups-drilled").startsWith(FORK_RUNBOOK_URL)).toBe(true);
  });
});
