/**
 * THE BACKUP THAT DID NOT EXIST, PROVEN END TO END.
 *
 * `data/uploads/` had no copy anywhere: member photographs, brand images and
 * investor documents on a Railway volume, with docs/FORK_RUNBOOK.md saying in
 * as many words that losing one loses it. `db-backup.yml` only ever dumped
 * MySQL, and no GitHub Action can reach into a Railway volume, so the volume
 * has to hand itself out over an authenticated route. This suite is the
 * contract the backup workflow will call.
 *
 * WHY E2E AND NOT A UNIT TEST. `server/lib/uploadsArchive.test.ts` already
 * proves the tar bytes against an independently written reader. What it cannot
 * prove is the part that fails in production: the token check, the streamed
 * response arriving intact through Express and a real socket, the manifest
 * headers reaching the client, and a second instance with the variable UNSET
 * refusing rather than serving. Every one of those is a seam, and the archive
 * is worthless if any of them leaks or lies.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[backupUploads] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 9100 + (process.pid % 400);
// A second instance on the same schema, booted with NO export token, so the
// fail-closed branch is exercised for real rather than reasoned about.
const PORT_NO_TOKEN = PORT + 400;
const BASE = `http://localhost:${PORT}`;
const ADMIN = "backup-uploads-admin";
const EXPORT_TOKEN = "backup-uploads-export-token-fixture";

let child: ChildProcess | undefined;
let childNoToken: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let uploadsDir = "";

/** What we put on the volume, and what must come back byte for byte. */
const PLANTED: Record<string, Buffer> = {
  "1756000000000-aaaa11-member-photo.jpg": Buffer.alloc(200_000, 0x5a),
  "1756000000001-bbbb22-brand-mark.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
  "1756000000002-cccc33-investor-cap-table.pdf": Buffer.from("%PDF-1.4 not really a pdf\n"),
  // Not a multiple of 512, so the tar padding is exercised for real.
  "1756000000003-dddd44-odd-length.bin": Buffer.alloc(1337, 7),
};

async function boot(port: number, env: Record<string, string>): Promise<ChildProcess> {

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(port);
  const proc = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "backup-uploads-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  proc.stdout?.on("data", (d) => logs.push(String(d)));
  proc.stderr?.on("data", (d) => logs.push(String(d)));
  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: `http://localhost:${port}`, logs, child: proc });
  return proc;
}

const archive = (token?: string, port = PORT) =>
  fetch(`http://localhost:${port}/api/admin/backup/uploads-archive`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    headers: token === undefined ? {} : { "x-backup-export-token": token },
  });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the backup uploads test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-backup-uploads-"));
  uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (const [name, bytes] of Object.entries(PLANTED)) {
    fs.writeFileSync(path.join(uploadsDir, name), bytes);
  }
  testDb = await provisionTestDb();
  child = await boot(PORT, { BACKUP_EXPORT_TOKEN: EXPORT_TOKEN });
  childNoToken = await boot(PORT_NO_TOKEN, { BACKUP_EXPORT_TOKEN: "" });
}, 300_000);

afterAll(async () => {
  child?.kill();
  childNoToken?.kill();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the uploads archive route", () => {
  it("refuses a caller with no token, and one with the wrong token", async () => {
    expect((await archive()).status).toBe(401);
    expect((await archive("")).status).toBe(401);
    expect((await archive("not-the-token")).status).toBe(401);
    // Same length as the real one, so the constant-time compare is what is
    // being exercised rather than the length short-circuit.
    expect((await archive("x".repeat(EXPORT_TOKEN.length))).status).toBe(401);
  });

  it("refuses with a 503 that NAMES the variable when none is configured", async () => {
    // The fail-closed branch, on a real second instance. A deployment that
    // never set the variable must not fall back to serving the volume, and
    // "unauthorized" would be a lie to an operator holding a correct token.
    const res = await archive(EXPORT_TOKEN, PORT_NO_TOKEN);
    expect(res.status).toBe(503);
    expect(String((await res.json()).error)).toContain("BACKUP_EXPORT_TOKEN");
  });

  it("streams a tar that round-trips every file on the volume", async () => {
    const res = await archive(EXPORT_TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    // Chunked, not buffered: a Content-Length here would mean the whole volume
    // was assembled in memory on the process that serves the village.
    expect(res.headers.get("content-length")).toBeNull();

    const bytes = Buffer.from(await res.arrayBuffer());
    const entries = untar(bytes);
    const byName = new Map(entries.map((e) => [e.name, e.body]));

    for (const [name, expected] of Object.entries(PLANTED)) {
      const got = byName.get(name);
      expect(got, `${name} is in the archive`).toBeTruthy();
      expect(got!.equals(expected), `${name} round-tripped byte for byte`).toBe(true);
    }
    expect(entries[0]!.name).toBe("MANIFEST.txt");
    expect(entries[entries.length - 1]!.name).toBe("EXPORT-STATUS.txt");
  });

  it("carries a manifest in the headers that agrees with the one in the archive", async () => {
    const res = await archive(EXPORT_TOKEN);
    const bytes = Buffer.from(await res.arrayBuffer());
    const entries = untar(bytes);
    const manifest = parseKv(entries.find((e) => e.name === "MANIFEST.txt")!.body.toString());
    const planted = Object.values(PLANTED);

    expect(res.headers.get("x-uploads-files")).toBe(String(planted.length));
    expect(manifest.files).toBe(String(planted.length));
    const totalBytes = planted.reduce((n, b) => n + b.length, 0);
    expect(res.headers.get("x-uploads-bytes")).toBe(String(totalBytes));
    expect(manifest.bytes).toBe(String(totalBytes));
    // Two statements of the same fact from two transports. They come from one
    // plan object, so a disagreement here means something rewrote one of them.
    expect(res.headers.get("x-uploads-canary")).toBe(manifest.canary);
    expect(res.headers.get("x-uploads-canary-sha256")).toBe(manifest.canarySha256);

    // The drill's own assertion, run here: re-hash the canary OUT OF THE
    // ARCHIVE and compare with what the manifest claimed.
    const canary = entries.find((e) => e.name === manifest.canary)!;
    const { createHash } = await import("crypto");
    expect(createHash("sha256").update(canary.body).digest("hex")).toBe(manifest.canarySha256);
  });

  it("says complete=yes in a trailer written after the last file", async () => {
    const res = await archive(EXPORT_TOKEN);
    const entries = untar(Buffer.from(await res.arrayBuffer()));
    const status = parseKv(entries[entries.length - 1]!.body.toString());
    // The completeness assertion. A tar cut off at 60% still untars and still
    // has plausible counts; only the absence of this entry distinguishes it.
    expect(status.complete).toBe("yes");
    expect(status.entries).toBe(String(Object.keys(PLANTED).length));
    expect(status.degradedCount).toBe("0");
  });

  it("is reachable by the exact call the backup workflow will make", async () => {
    // Named here so the workflow and the server cannot drift apart quietly:
    // this is the whole contract, and if it changes this test changes with it.
    const res = await fetch(`${BASE}/api/admin/backup/uploads-archive`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method: "GET",
      headers: { "x-backup-export-token": EXPORT_TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("uploads-archive.tar");
    await res.arrayBuffer();
  });
});

// ── An independent tar reader, so the writer is not marking its own work ────

function untar(buf: Buffer): { name: string; body: Buffer }[] {
  const out: { name: string; body: Buffer }[] = [];
  let off = 0;
  let pendingPath: string | null = null;
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const rawName = head.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(head.subarray(124, 135).toString("ascii").replace(/\0.*$/, ""), 8);
    const typeflag = head.subarray(156, 157).toString("ascii");
    const body = Buffer.from(buf.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
    if (typeflag === "x") {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      pendingPath = m ? m[1]! : null;
      continue;
    }
    out.push({ name: pendingPath ?? rawName, body });
    pendingPath = null;
  }
  return out;
}

function parseKv(text: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([a-zA-Z0-9]+)=(.*)$/.exec(line);
    if (m) kv[m[1]!] = m[2]!;
  }
  return kv;
}
