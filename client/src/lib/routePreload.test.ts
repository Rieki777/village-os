import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  type ChunkFacts,
  lazyRoutesFromApp,
  moduleKey,
  routePattern,
  routePreloadScript,
  routePreloadTable,
} from "./routePreload";

const APP = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

describe("lazyRoutesFromApp, against the real App.tsx", () => {
  const routes = lazyRoutesFromApp(APP);
  const of = (p: string) => routes.find((r) => r.path === p)?.module;

  it("reads the public routes members land on", () => {
    expect(of("/quests")).toBe("pages/Quests");
    expect(of("/quests/:id")).toBe("pages/QuestDetail");
    expect(of("/visit")).toBe("pages/Visit");
    expect(of("/investor")).toBe("pages/InvestorJourney");
    expect(of("/modules")).toBe("pages/Modules");
    expect(of("/events")).toBe("pages/Events");
    expect(of("/request-membership")).toBe("pages/RequestMembership");
  });

  it("leaves out the eager pages, which the main bundle already carries", () => {
    expect(of("/")).toBeUndefined();
    expect(of("/login")).toBeUndefined();
    expect(of("/404")).toBeUndefined();
  });

  it("finds nearly every route, so a change in App.tsx's shape cannot silently empty the table", () => {
    const declared = [...APP.matchAll(/<Route\s+path=/g)].length;
    // Everything except the eager three (/, /login, /404) and the /seat-applications/:id redirect
    // to /role-applications/:id (members say role, 2026-10-21) is lazy today.
    expect(routes.length).toBeGreaterThanOrEqual(declared - 4);
    expect(routes.length).toBeGreaterThan(60);
  });

  it("keeps App.tsx's order, because wouter's Switch takes the first match", () => {
    const i = (p: string) => routes.findIndex((r) => r.path === p);
    expect(i("/profile/characters")).toBeLessThan(i("/profile/:handle"));
    expect(i("/decisions")).toBeLessThan(i("/decisions/:id"));
  });

  it("reads the email pages, which import one module three ways", () => {
    expect(of("/email/preferences")).toBe("pages/EmailPages");
  });
});

describe("routePattern", () => {
  const m = (p: string, url: string) => new RegExp(routePattern(p), "i").test(url);
  it("matches a static path with or without a trailing slash, and nothing longer", () => {
    expect(m("/quests", "/quests")).toBe(true);
    expect(m("/quests", "/quests/")).toBe(true);
    expect(m("/quests", "/quests/abc")).toBe(false);
    expect(m("/quests", "/questsx")).toBe(false);
  });
  it("treats a :param as one segment", () => {
    expect(m("/quests/:id", "/quests/abc-1")).toBe(true);
    expect(m("/quests/:id", "/quests/a/b")).toBe(false);
    expect(m("/quests/:id", "/quests")).toBe(false);
  });
  it("matches case-insensitively, as wouter does", () => {
    expect(m("/request-membership", "/Request-Membership")).toBe(true);
  });
});

describe("moduleKey", () => {
  it("normalises Windows and POSIX ids to a client/src-relative key", () => {
    expect(moduleKey("C:\\w\\client\\src\\pages\\Quests.tsx")).toBe("pages/Quests");
    expect(moduleKey("/w/client/src/pages/Quests.tsx?v=1")).toBe("pages/Quests");
    expect(moduleKey("/w/node_modules/x/index.js")).toBeNull();
  });
});

describe("routePreloadTable and the emitted script", () => {
  const chunk = (fileName: string, o: Partial<ChunkFacts> = {}): ChunkFacts => ({
    fileName, imports: [], isEntry: false, isDynamicEntry: false, facadeModuleId: null, css: [], ...o,
  });
  const chunks: ChunkFacts[] = [
    chunk("assets/index-E.js", { isEntry: true, imports: ["assets/icons-I.js"], css: ["assets/index-C.css"] }),
    chunk("assets/icons-I.js"),
    chunk("assets/Quests-Q.js", { isDynamicEntry: true, facadeModuleId: "/w/client/src/pages/Quests.tsx", imports: ["assets/icons-I.js", "assets/QuestCard-K.js"] }),
    chunk("assets/QuestCard-K.js", { imports: ["assets/shared-S.js"] }),
    chunk("assets/shared-S.js"),
    chunk("assets/Events-V.js", { isDynamicEntry: true, facadeModuleId: "/w/client/src/pages/Events.tsx", imports: ["assets/shared-S.js"], css: ["assets/Events-V.css"] }),
  ];
  const routes = [
    { path: "/quests", module: "pages/Quests" },
    { path: "/events", module: "pages/Events" },
    { path: "/ghost", module: "pages/NoSuchPage" },
  ];
  const table = routePreloadTable(routes, chunks);
  const filesFor = (url: string) => {
    for (const [re, ids] of table.routes) if (new RegExp(re, "i").test(url)) return ids.map((i) => table.files[i]);
    return [];
  };

  it("lists the page chunk and everything it imports, transitively", () => {
    expect(filesFor("/quests")).toEqual(["assets/Quests-Q.js", "assets/QuestCard-K.js", "assets/shared-S.js"]);
  });

  it("never lists what index.html already loads", () => {
    for (const [, ids] of table.routes) {
      for (const i of ids) expect(["assets/index-E.js", "assets/icons-I.js", "assets/index-C.css"]).not.toContain(table.files[i]);
    }
  });

  it("carries a page's CSS", () => {
    expect(filesFor("/events")).toEqual(["assets/Events-V.js", "assets/Events-V.css", "assets/shared-S.js"]);
  });

  it("drops a route whose page has no chunk, rather than guessing", () => {
    expect(filesFor("/ghost")).toEqual([]);
    expect(table.routes).toHaveLength(2);
  });

  it("emits a script that adds exactly those links for the visited path, and none elsewhere", () => {
    const run = (pathname: string) => {
      const added: Array<Record<string, string>> = [];
      const document = {
        createElement: () => ({}) as Record<string, string>,
        head: { appendChild: (l: Record<string, string>) => added.push(l) },
      };
      vm.runInNewContext(routePreloadScript(table, "/"), { location: { pathname }, document });
      return added;
    };
    expect(run("/quests").map((l) => [l.rel, l.href, l.crossOrigin])).toEqual([
      ["modulepreload", "/assets/Quests-Q.js", ""],
      ["modulepreload", "/assets/QuestCard-K.js", ""],
      ["modulepreload", "/assets/shared-S.js", ""],
    ]);
    const css = run("/events").find((l) => l.href.endsWith(".css"))!;
    expect([css.rel, css.as, css.crossOrigin]).toEqual(["preload", "style", ""]);
    expect(run("/")).toEqual([]);
    expect(run("/nowhere")).toEqual([]);
  });
});
