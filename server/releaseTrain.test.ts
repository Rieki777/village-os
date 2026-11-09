/**
 * The daily release train (scripts/release-train.mjs, driven by
 * .github/workflows/daily-release.yml). Rye, 2026-11-06: Village OS cuts a
 * release every day, and never from a red main.
 *
 * These cases hold the decisions the workflow delegates to the script, so a
 * wrong one fails here, in a pull request, instead of on a schedule nobody is
 * watching:
 *
 *   1. when a day is skipped: nothing new, main red or unfinished, a release
 *      already in flight;
 *   2. which number the release takes, from the merged pull requests;
 *   3. what the changelog entry says, including the migrations the release
 *      carries, because "does it touch your data" is the heading a steward
 *      reads twice;
 *   4. that the version is moved everywhere release.yml compares it, or the
 *      tag is refused after the release pull request has already landed.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import * as train from "../scripts/release-train.mjs";

const {
  planDay,
  bumpFor,
  nextVersion,
  prsFromLog,
  rollChangelog,
  bumpVersionFiles,
  RELEASE_FILES,
} = train as {
  planDay: (f: Record<string, unknown>) => { release: boolean; reason: string; version?: string; bump?: string };
  bumpFor: (prs: { number: number; title: string; labels?: string[] }[]) => "major" | "minor" | "patch";
  nextVersion: (v: string, b: string) => string;
  prsFromLog: (log: string) => { number: number; title: string }[];
  rollChangelog: (t: string, o: Record<string, unknown>) => string;
  bumpVersionFiles: (f: Record<string, string>, v: string) => Record<string, string>;
  RELEASE_FILES: string[];
};

const greenDay = {
  lastTag: "v1.2.0",
  packageVersion: "1.2.0",
  commitsSinceTag: 14,
  ciConclusion: "success",
  openReleasePr: null,
  prs: [{ number: 950, title: "Map: tidy the legend", labels: [] }],
};

describe("planDay: when the train leaves", () => {
  it("releases a green main with new commits, as the next minor by default", () => {
    expect(planDay(greenDay)).toMatchObject({ release: true, version: "1.3.0", bump: "minor" });
  });

  it("skips a day with nothing new since the last tag", () => {
    const d = planDay({ ...greenDay, commitsSinceTag: 0 });
    expect(d.release).toBe(false);
    expect(d.reason).toMatch(/nothing/i);
  });

  it("never releases a red main", () => {
    const d = planDay({ ...greenDay, ciConclusion: "failure" });
    expect(d.release).toBe(false);
    expect(d.reason).toMatch(/failure/);
  });

  it("treats a main ci has not finished, or never ran, as not green", () => {
    for (const c of ["", null, undefined, "in_progress", "cancelled", "skipped"]) {
      expect(planDay({ ...greenDay, ciConclusion: c }).release).toBe(false);
    }
  });

  it("does not stack a second release while one is open", () => {
    const d = planDay({ ...greenDay, openReleasePr: 961 });
    expect(d.release).toBe(false);
    expect(d.reason).toMatch(/#961/);
  });

  it("does not cut over a version that main already carries but nobody tagged", () => {
    // A release pull request merged, its tag has not been pushed yet. The
    // tagger owns that; the train cutting 1.4.0 over it would skip a release.
    const d = planDay({ ...greenDay, packageVersion: "1.3.0" });
    expect(d.release).toBe(false);
    expect(d.reason).toMatch(/1\.3\.0/);
  });

  it("refuses a tag it cannot read rather than guessing a number", () => {
    expect(planDay({ ...greenDay, lastTag: "" }).release).toBe(false);
    expect(planDay({ ...greenDay, lastTag: "nightly" }).release).toBe(false);
  });
});

describe("bumpFor and nextVersion: the number", () => {
  it("is minor unless every change says it is a fix", () => {
    expect(bumpFor([{ number: 1, title: "fix: a typo" }, { number: 2, title: "Map: new layer" }])).toBe("minor");
    expect(bumpFor([{ number: 1, title: "fix: a typo" }, { number: 2, title: "fix(map): legend" }])).toBe("patch");
  });

  it("follows the release:patch and release:major labels", () => {
    expect(bumpFor([{ number: 1, title: "Tidy", labels: ["release:patch"] }])).toBe("patch");
    expect(bumpFor([{ number: 1, title: "fix: x" }, { number: 2, title: "Drop v0 API", labels: ["release:major"] }])).toBe("major");
  });

  it("is minor when no pull request can be named (direct pushes)", () => {
    expect(bumpFor([])).toBe("minor");
  });

  it("counts the way semver counts", () => {
    expect(nextVersion("1.2.0", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.7", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.7", "patch")).toBe("1.2.8");
    expect(nextVersion("1.9.3", "major")).toBe("2.0.0");
    expect(nextVersion("v1.2.0", "patch")).toBe("1.2.1");
  });
});

describe("prsFromLog: the merged pull requests", () => {
  it("reads GitHub's merge commits and ignores everything else", () => {
    const log = [
      "Merge pull request #952 from Rieki777/wt/batch98\x1fBatch 98: map, quests\x1e",
      "docs: regenerate\x1f\x1e",
      "Merge pull request #940 from Rieki777/wt/x\x1f\x1e",
      "Merge branch 'main' into wt/y\x1f\x1e",
    ].join("\n");
    expect(prsFromLog(log)).toEqual([
      { number: 952, title: "Batch 98: map, quests" },
      { number: 940, title: "wt/x" },
    ]);
  });
});

const CHANGELOG = `# Changelog

Intro.

## Unreleased

Work on \`main\` that has not been published as an image yet. No village runs
it. It is written here as it lands.

- **The platform's timezone is UTC.** A village that never chose moves.

---

## 1.2.0 (2026-10-03)

Old entry.
`;

describe("rollChangelog: the entry", () => {
  const rolled = rollChangelog(CHANGELOG, {
    version: "1.3.0",
    date: "2026-11-07",
    prs: [{ number: 952, title: "Batch 98" }],
    migrations: ["drizzle/0301_add_thing.sql"],
  });

  it("moves what was written under Unreleased into the release and leaves a fresh Unreleased", () => {
    const unreleased = rolled.indexOf("## Unreleased");
    const release = rolled.indexOf("## 1.3.0 (2026-11-07)");
    const older = rolled.indexOf("## 1.2.0 (2026-10-03)");
    expect(unreleased).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(unreleased);
    expect(older).toBeGreaterThan(release);
    const unreleasedBody = rolled.slice(unreleased, release);
    expect(unreleasedBody).toContain("Work on `main` that has not been published");
    expect(unreleasedBody).not.toContain("timezone is UTC");
    expect(rolled.slice(release, older)).toContain("timezone is UTC");
  });

  it("names every migration under Does it touch your data", () => {
    expect(rolled).toContain("### Does it touch your data");
    expect(rolled).toContain("`0301_add_thing.sql`");
  });

  it("says plainly when the release does not change the database", () => {
    const none = rollChangelog(CHANGELOG, { version: "1.3.0", date: "d", prs: [], migrations: [] });
    expect(none).toMatch(/No database migrations/);
  });

  it("lists the merged pull requests", () => {
    expect(rolled).toContain("- #952 Batch 98");
  });

  it("says so when nothing was written by hand, instead of an empty heading", () => {
    const bare = CHANGELOG.replace("- **The platform's timezone is UTC.** A village that never chose moves.\n", "");
    const out = rollChangelog(bare, { version: "1.3.0", date: "d", prs: [], migrations: [] });
    expect(out).toMatch(/Nothing was written up by hand/);
  });

  it("refuses to roll a changelog with no Unreleased section, or a version it already has", () => {
    expect(() => rollChangelog("# Changelog\n\n## 1.2.0\n", { version: "1.3.0", date: "d", prs: [], migrations: [] })).toThrow();
    expect(() => rollChangelog(CHANGELOG, { version: "1.2.0", date: "d", prs: [], migrations: [] })).toThrow();
  });

  it("refuses anything but a plain x.y.z version", () => {
    for (const version of ["1.3", "1.3.0-rc.1", "1\\.3.0", "1.3.0\n## Unreleased"]) {
      expect(() => rollChangelog(CHANGELOG, { version, date: "d", prs: [], migrations: [] })).toThrow(/not a version/);
    }
  });
});

describe("bumpVersionFiles: every place release.yml compares", () => {
  const files = {
    "package.json": '{\n  "name": "village-os",\n  "version": "1.2.0",\n  "private": true\n}\n',
    "server/lib/identity.ts": 'export const PLATFORM_VERSION = "1.2.0";\n',
    "docker-compose.yml": "    image: ${VILLAGE_OS_IMAGE:-ghcr.io/rieki777/village-os:1.2.0}\n",
    "START_HERE.md":
      "git clone --branch v1.2.0 https://github.com/Rieki777/village-os.git\n   the image `ghcr.io/rieki777/village-os:1.2.0`, and a volume\n",
  };

  it("moves all four to the new version", () => {
    const out = bumpVersionFiles(files, "1.3.0");
    expect(out["package.json"]).toContain('"version": "1.3.0"');
    expect(out["server/lib/identity.ts"]).toContain('PLATFORM_VERSION = "1.3.0"');
    expect(out["docker-compose.yml"]).toContain("ghcr.io/rieki777/village-os:1.3.0}");
    expect(out["START_HERE.md"]).toContain("--branch v1.3.0");
    expect(out["START_HERE.md"]).toContain("village-os:1.3.0`");
    expect(out["START_HERE.md"]).not.toContain("1.2.0");
  });

  it("keeps working after the move to another GitHub organisation (#431)", () => {
    const moved = { ...files, "docker-compose.yml": "image: ${VILLAGE_OS_IMAGE:-ghcr.io/another-owner/village-os:1.2.0}\n" };
    expect(bumpVersionFiles(moved, "1.3.0")["docker-compose.yml"]).toContain("ghcr.io/another-owner/village-os:1.3.0");
  });

  it("fails loud when a file no longer has the shape it expects", () => {
    expect(() => bumpVersionFiles({ ...files, "server/lib/identity.ts": "// moved\n" }, "1.3.0")).toThrow(/identity\.ts/);
  });

  it("names exactly the files a release pull request may touch", () => {
    expect([...RELEASE_FILES].sort()).toEqual(
      ["CHANGELOG.md", "START_HERE.md", "docker-compose.yml", "package.json", "server/lib/identity.ts"].sort(),
    );
  });
});
