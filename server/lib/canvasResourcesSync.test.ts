/**
 * THE NIGHTLY READ OF THE GOVERNANCE CANVAS DATABASE, against a real
 * database (0224, server/lib/canvasResourcesSync.ts).
 *
 * The fetch is handed in, so no test leaves this machine: each case answers
 * with the CSV it needs, or throws the way a village with no network does.
 * What is asserted is what the shelf HOLDS afterwards, read back through the
 * repo, never what the function said it did.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  provisionTestDb,
  testDbConfigured,
  testPool,
  type TestDb,
} from "../db/testDb";
import {
  CANVAS_DATABASE,
  CANVAS_DATABASE_COLUMNS,
  EMAIL_PATTERN,
} from "../../shared/canvasResources";
import {
  everyResource,
  liveResources,
  setVillagePlacing,
} from "../repos/canvasResources";
import {
  canvasDatabaseUrl,
  checkResourceLinks,
  loadSnapshotIfEmpty,
  readSyncState,
  resourceKey,
  resourcesForBlock,
  SNAPSHOT_TAKEN,
  syncCanvasResources,
} from "./canvasResourcesSync";

const configured = testDbConfigured();
if (!configured)
  console.warn(
    "[canvasResourcesSync] TEST_DATABASE_URL not set - DB-backed tests SKIPPED."
  );

const HEADER = Object.values(CANVAS_DATABASE_COLUMNS);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const csv = (rows: string[][], header: readonly string[] = HEADER) =>
  [header, ...rows].map(r => r.map(q).join(",")).join("\r\n") + "\r\n";

const CONSENT = [
  "Consent decision making",
  "Article",
  "Sociocracyforall",
  "A proposal passes when no one holds a paramount objection. Keywords: decision making, consent, objections.",
  "https://www.sociocracyforall.org/consent-decision-making/",
];
const NVC = [
  "How You Can Use The NVC Process",
  "Article",
  "Marshall B. Rosenberg",
  "Rosenberg's four-part process. Keywords: conflict navigation, NVC, communication.",
  "https://nonviolentcommunication.com/wp-content/uploads/2021/11/4part_nvc_process.pdf",
];
const PENDING = [
  "BWL Strategy 3.0",
  "Report ",
  "Bioregional Weaving Labs Collective",
  "Keywords: strategy, roles.",
  "BWL STRATEGY 3.0 (FEBRUARY 2026 EDIT).docx",
];

let db: TestDb;
let pool: Pool;

const answering = (text: string) => {
  const asked: string[] = [];
  return { asked, fetchText: async (url: string) => (asked.push(url), text) };
};
const on = () => true;

describe.skipIf(!configured)(
  "canvas resources, against a real database",
  () => {
    beforeAll(async () => {
      db = await provisionTestDb();
      pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    });

    afterAll(async () => {
      await pool?.end();
      await db?.drop?.();
    });

    beforeEach(async () => {
      await pool.query("DELETE FROM canvas_resources"); // module-review-ok: resetting the scratch schema this suite provisioned
      await pool.query("DELETE FROM app_config WHERE config_key = 'canvas-resources-sync'"); // module-review-ok: resetting the scratch schema this suite provisioned
    });

    describe("syncCanvasResources", () => {
      it("reads the database into the shelf: trimmed, keywords split, link pending kept, keyed by name and address", async () => {
        const source = answering(csv([CONSENT, NVC, PENDING]));
        const said = await syncCanvasResources({
          pool,
          fetchText: source.fetchText,
          syncOn: on,
          env: {},
        });
        expect(said).toBe(
          "read 3 resources from the database; 0 newly withdrawn"
        );
        // The database's own address, the five columns only.
        expect(source.asked).toEqual([CANVAS_DATABASE.csvUrl]);
        expect(CANVAS_DATABASE.csvUrl).toContain("select%20A%2CB%2CC%2CD%2CE");

        const rows = await liveResources(pool);
        expect(rows.map(r => r.name)).toEqual([
          "BWL Strategy 3.0",
          "Consent decision making",
          "How You Can Use The NVC Process",
        ]);
        const pending = rows[0];
        expect(pending.type).toBe("Report");
        expect(pending.url).toBeNull();
        expect(pending.linkPending).toBe(true);
        expect(pending.source).toBe("database");
        const consent = rows[1];
        expect(consent.keywords).toEqual([
          "decision making",
          "consent",
          "objections",
        ]);
        expect(consent.description).toBe(
          "A proposal passes when no one holds a paramount objection."
        );
        expect(consent.resourceKey).toBe(
          resourceKey(
            "consent-decision-making|//sociocracyforall.org/consent-decision-making"
          )
        );
        expect(consent.tagsConfirmed).toEqual(["power"]);
        expect(consent.tagsSuggested.map(t => t.block)).toEqual(["power"]);

        const state = await readSyncState(pool);
        expect(state?.source).toBe("database");
        expect(state?.lastOutcome).toBe("read");
        expect(state?.lastReadAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it("asks CANVAS_DB_URL instead when it is set", async () => {
        const source = answering(csv([CONSENT]));
        await syncCanvasResources({
          pool,
          fetchText: source.fetchText,
          syncOn: on,
          env: { CANVAS_DB_URL: " https://mirror.example.org/db.csv " },
        });
        expect(source.asked).toEqual(["https://mirror.example.org/db.csv"]);
        expect(canvasDatabaseUrl({})).toBe(CANVAS_DATABASE.csvUrl);
      });

      it("does nothing at all while the dial is off: no request, no row", async () => {
        const source = answering(csv([CONSENT]));
        const said = await syncCanvasResources({
          pool,
          fetchText: source.fetchText,
          syncOn: () => false,
        });
        expect(said).toMatch(/^off: the dial canvas\.resources_sync is off/);
        expect(source.asked).toEqual([]);
        expect(await everyResource(pool)).toEqual([]);
      });

      it("REFUSES a drifted header: nothing written, the last good rows kept, the job fails with the reason", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT, NVC])).fetchText,
          syncOn: on,
        });
        const before = await everyResource(pool);

        const drifted = csv(
          [CONSENT],
          ["Resource", "Type", "Author(s)", "Short description", "URL"]
        );
        await expect(
          syncCanvasResources({
            pool,
            fetchText: answering(drifted).fetchText,
            syncOn: on,
          })
        ).rejects.toThrow(
          /changed shape: its first row no longer names "Governance resource name"/
        );
        const after = await everyResource(pool);
        expect(after).toEqual(before);
        expect(after.every(r => r.withdrawnAt === null)).toBe(true);
        const state = await readSyncState(pool);
        expect(state?.lastOutcome).toBe("refused");
        expect(state?.lastProblem).toContain("Governance resource name");
        // The last good read is still the one the page dates the shelf by.
        expect(state?.source).toBe("database");
        expect(state?.lastReadAt).not.toBeNull();
      });

      it("refuses an empty sheet and a cut-off download the same way", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT])).fetchText,
          syncOn: on,
        });
        await expect(
          syncCanvasResources({
            pool,
            fetchText: answering(csv([])).fetchText,
            syncOn: on,
          })
        ).rejects.toThrow(/no resource under them/);
        const cut = csv([CONSENT, NVC]).slice(0, -30);
        await expect(
          syncCanvasResources({
            pool,
            fetchText: answering(cut).fetchText,
            syncOn: on,
          })
        ).rejects.toThrow(/not clean CSV/);
        expect((await liveResources(pool)).map(r => r.name)).toEqual([
          "Consent decision making",
        ]);
      });

      it("marks a row gone upstream as withdrawn, never deletes it, and clears the mark when it comes back", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT, NVC])).fetchText,
          syncOn: on,
        });
        const said = await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT])).fetchText,
          syncOn: on,
        });
        expect(said).toBe(
          "read 1 resources from the database; 1 newly withdrawn"
        );
        const all = await everyResource(pool);
        expect(all).toHaveLength(2);
        const nvc = all.find(r => r.name.startsWith("How You Can"))!;
        expect(nvc.withdrawnAt).not.toBeNull();
        expect((await liveResources(pool)).map(r => r.name)).toEqual([
          "Consent decision making",
        ]);

        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT, NVC])).fetchText,
          syncOn: on,
        });
        expect(
          (await everyResource(pool)).every(r => r.withdrawnAt === null)
        ).toBe(true);
      });

      it("never touches the village's own placing when it reads the database again", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT])).fetchText,
          syncOn: on,
        });
        const [consent] = await liveResources(pool);
        await setVillagePlacing(
          pool,
          consent.resourceKey,
          ["learning"],
          "pen-1"
        );
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT])).fetchText,
          syncOn: on,
        });
        const [after] = await liveResources(pool);
        expect(after.tagsLocal).toEqual(["learning"]);
        expect(
          resourcesForBlock([after], "learning", "learn").map(r => r.placing.by)
        ).toEqual(["village"]);
        expect(resourcesForBlock([after], "power", "learn")).toEqual([]);
      });

      it("stores no email address in any column, whatever the sheet carries", async () => {
        const leaky = [
          "Consent decision making, from ada@example.org",
          "Article bob@example.org",
          "Sociocracyforall <carol@example.org>",
          "Write to dan@example.org. Keywords: decision making, eve@example.org, consent.",
          "https://www.sociocracyforall.org/consent-decision-making/",
        ];
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([leaky])).fetchText,
          syncOn: on,
        });
        const [raw] = await pool.query("SELECT * FROM canvas_resources"); // module-review-ok: reading back every column of the scratch schema's one row
        const cells = (raw as Record<string, unknown>[]).flatMap(r =>
          Object.values(r).map(v => (v == null ? "" : String(v)))
        );
        expect(cells.length).toBeGreaterThan(10);
        for (const cell of cells)
          expect(cell, cell).not.toMatch(new RegExp(EMAIL_PATTERN.source, "i"));
      });
    });

    describe("the snapshot, for a village with no way out", () => {
      it("is loaded when the read fails and the shelf is empty, and the job still fails with the reason", async () => {
        const offline = async () => {
          throw new Error("DNS resolution failed");
        };
        await expect(
          syncCanvasResources({ pool, fetchText: offline, syncOn: on })
        ).rejects.toThrow(
          /Could not read the Governance Canvas Database \(DNS resolution failed\)[\s\S]*the snapshot shipped with the platform was loaded/
        );
        const rows = await liveResources(pool);
        expect(rows).toHaveLength(58);
        expect(rows.every(r => r.source === "snapshot")).toBe(true);
        const state = await readSyncState(pool);
        expect(state?.source).toBe("snapshot");
        expect(state?.snapshotTaken).toBe(SNAPSHOT_TAKEN);
        expect(state?.lastOutcome).toBe("failed");
        expect(state?.lastReadAt).toBeNull();
      });

      it("is never loaded over a shelf that has been read, and never withdraws anything", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT])).fetchText,
          syncOn: on,
        });
        expect(await loadSnapshotIfEmpty(pool)).toBe(false);
        expect((await everyResource(pool)).map(r => r.name)).toEqual([
          "Consent decision making",
        ]);
      });

      it("loads on its own when the shelf has never held a row, marked as the snapshot", async () => {
        expect(await loadSnapshotIfEmpty(pool)).toBe(true);
        const rows = await liveResources(pool);
        expect(rows).toHaveLength(58);
        expect(rows.filter(r => r.linkPending)).toHaveLength(15);
        expect((await readSyncState(pool))?.source).toBe("snapshot");
        // Every row is under at least one block through the platform's map.
        expect(rows.every(r => (r.tagsConfirmed ?? []).length > 0)).toBe(true);
      });

      it("a safety surface leaves every NVC row out, and the Learn frame keeps them", async () => {
        await loadSnapshotIfEmpty(pool);
        const rows = await liveResources(pool);
        const learn = resourcesForBlock(rows, "conflict", "learn").map(
          r => r.name
        );
        const safety = resourcesForBlock(rows, "conflict", "safety").map(
          r => r.name
        );
        expect(learn.filter(n => /NVC|Nonviolent/.test(n))).toHaveLength(3);
        expect(safety.filter(n => /NVC|Nonviolent/.test(n))).toEqual([]);
        expect(safety).toContain("Beginning Anew");
      });
    });

    describe("checkResourceLinks", () => {
      it("records what each address answered, skips a row with no address, and resets the state when an address moves", async () => {
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT, NVC, PENDING])).fetchText,
          syncOn: on,
        });
        const asked: string[] = [];
        const said = await checkResourceLinks({
          pool,
          syncOn: on,
          check: async url => {
            asked.push(url);
            return url.includes("sociocracy")
              ? { ok: true, status: 200 }
              : { ok: false, status: 404 };
          },
        });
        expect(said).toBe(
          "checked 2 addresses: 1 answered, 1 did not, 0 refused by the guard"
        );
        expect(asked.sort()).toEqual([CONSENT[4], NVC[4]].sort());
        const byName = Object.fromEntries(
          (await liveResources(pool)).map(r => [r.name, r])
        );
        expect(byName["Consent decision making"].link).toBe("ok");
        expect(byName["How You Can Use The NVC Process"].link).toBe("broken");
        expect(byName["How You Can Use The NVC Process"].linkCheckedAt).toMatch(
          /^\d{4}-/
        );
        expect(byName["BWL Strategy 3.0"].link).toBe("unchecked");

        // The same row with a different address is a different key: a new, unchecked row, and the old one withdrawn.
        const moved = [
          ...NVC.slice(0, 4),
          "https://www.cnvc.org/learn/nvc-process",
        ];
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([CONSENT, moved, PENDING])).fetchText,
          syncOn: on,
        });
        const live = await liveResources(pool);
        expect(live.find(r => r.url === moved[4])?.link).toBe("unchecked");
        expect(live.find(r => r.name === "Consent decision making")?.link).toBe(
          "ok"
        );
        expect(live.find(r => r.url === NVC[4])).toBeUndefined();

        // The SAME key with its address written differently (no www, no
        // trailing slash) is one row whose address changed: it has not been
        // checked at that address, so its state goes back to unchecked. The
        // upsert assigns link_status BEFORE url for exactly this.
        const respelled = [
          ...CONSENT.slice(0, 4),
          "https://sociocracyforall.org/consent-decision-making",
        ];
        await syncCanvasResources({
          pool,
          fetchText: answering(csv([respelled, moved, PENDING])).fetchText,
          syncOn: on,
        });
        const consent = (await liveResources(pool)).find(
          r => r.name === "Consent decision making"
        )!;
        expect(consent.url).toBe(respelled[4]);
        expect(consent.link).toBe("unchecked");
        expect(consent.linkCheckedAt).toBeNull();
      });

      it("sends no request while the dial is off", async () => {
        let asked = 0;
        const said = await checkResourceLinks({
          pool,
          syncOn: () => false,
          check: async () => (asked++, { ok: true, status: 200 }),
        });
        expect(said).toMatch(/^off:/);
        expect(asked).toBe(0);
      });
    });
  }
);
