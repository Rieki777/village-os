/**
 * The agent paths tree's grouping and search (agentPathGroups.ts), against the first village's real list of paths
 * so a path the lead actually uses never falls into "Other" unnoticed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entryMatches, groupAgentPaths, pathGroup, PATH_GROUPS, type TreeEntry } from "./agentPathGroups";

const seed = JSON.parse(readFileSync(path.resolve(process.cwd(), "server/seeds/amora/agent-paths-seed.json"), "utf8")) as { paths: TreeEntry[] }; // brand-ok: the first village's own record

describe("grouping the paths by area", () => {
  it("reads the area off the path", () => {
    expect(pathGroup("/api/admin/content/:section")).toBe("pages");
    expect(pathGroup("/api/confidentiality")).toBe("pages");
    expect(pathGroup("/api/admin/faqs/:pathway/:id")).toBe("faqs");
    expect(pathGroup("/api/org/circles/:id/card")).toBe("circles");
    expect(pathGroup("/api/admin/circles/:id")).toBe("circles");
    expect(pathGroup("/api/admin/org/roles/:id/holders")).toBe("roles");
    expect(pathGroup("/api/org/role-edit/:id")).toBe("roles");
    expect(pathGroup("/api/admin/variables/org.ccos_terms")).toBe("roles");
    expect(pathGroup("/api/moon-review/rhythm")).toBe("seasons");
    expect(pathGroup("/api/admin/onboarding-path")).toBe("onboarding");
    expect(pathGroup("/api/map/draft")).toBe("map");
    expect(pathGroup("/api/admin/events/:id/slots")).toBe("events");
    expect(pathGroup("/api/admin/quests/:id")).toBe("quests");
    expect(pathGroup("/api/admin/variables")).toBe("connector");
    expect(pathGroup("/api/admin/member-tasks/access")).toBe("connector");
    expect(pathGroup("/api/admin/something-new")).toBe("other");
  });

  it("puts every one of the first village's paths in a named area, none left over", () => {
    const groups = groupAgentPaths(seed.paths);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(seed.paths.length);
    expect(groups.map((g) => g.group)).not.toContain("other");
    // In the fixed order, each group's reads and writes adding up.
    const order = groups.map((g) => PATH_GROUPS.indexOf(g.group as (typeof PATH_GROUPS)[number]));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const g of groups) expect(g.reads + g.writes).toBe(g.items.length);
    const faqs = groups.find((g) => g.group === "faqs")!;
    expect(faqs).toMatchObject({ reads: 1, writes: 3, byPerson: 1 });
  });

  it("keeps each entry's index in the saved list, so an edit reaches the right row", () => {
    for (const g of groupAgentPaths(seed.paths)) for (const { entry, index } of g.items) expect(seed.paths[index]).toBe(entry);
  });

  it("holds paths added on this screen in their own group at the top", () => {
    const list = [...seed.paths, { method: "GET", path: "/api/admin/", confirm: "person" as const, label: "" }];
    const groups = groupAgentPaths(list, { fresh: new Set([list.length - 1]) });
    expect(groups[0].group).toBe("new");
    expect(groups[0].items.map((i) => i.index)).toEqual([list.length - 1]);
  });
});

describe("searching the tree", () => {
  it("filters by every word, across method, path, label, area and who confirms", () => {
    const words = (g: string) => (g === "faqs" ? "FAQs" : g);
    const faq = groupAgentPaths(seed.paths, { query: "faqs delete", groupWords: words });
    expect(faq).toHaveLength(1);
    expect(faq[0].items.map((i) => `${i.entry.method} ${i.entry.path}`)).toEqual(["DELETE /api/admin/faqs/:pathway/:id"]);
    const seating = groupAgentPaths(seed.paths, { query: "seat" });
    expect(seating.flatMap((g) => g.items.map((i) => i.entry.path))).toContain("/api/admin/org/roles/:id/holders");
    expect(groupAgentPaths(seed.paths, { query: "no-such-thing-anywhere" })).toEqual([]);
    expect(entryMatches({ method: "PUT", path: "/api/x", confirm: "person", label: "Edit" }, "person put")).toBe(true);
    expect(entryMatches({ method: "PUT", path: "/api/x", confirm: "agent", label: "Edit" }, "person")).toBe(false);
  });

  it("never hides a path being added, whatever the search says", () => {
    const list = [{ method: "GET", path: "/api/admin/", confirm: "person" as const, label: "" }];
    expect(groupAgentPaths(list, { query: "events", fresh: new Set([0]) })[0].items).toHaveLength(1);
  });
});
