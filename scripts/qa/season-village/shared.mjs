// Shared by boot.mjs, seed.mjs and walk.mjs. Nothing in here names a village.
//
// Three rules live here so the three scripts cannot disagree about them:
//
//   WHERE THE HARNESS WRITES. Everything it produces (server state, the tokens
//   it minted, the data dir, logs, screenshots, reports) goes under one root,
//   QA_OUT_DIR, which defaults to the OS temp dir and is REFUSED when it resolves
//   inside the repository. A token file or a screenshot that lands in the tree
//   is one `git add .` away from being published.
//
//   WHICH DATABASE IT MAY TOUCH. The schema is a scratch village on the
//   TEST_DATABASE_URL server, never the app schema, never a Railway host.
//
//   WHAT A SCRIPT SAYS WHEN IT STOPS. "REFUSED: <sentence>" and a non-zero exit,
//   so a caller reading only the exit code and a caller reading only the last
//   line reach the same answer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..", "..");

/**
 * Unusual on purpose. Every e2e suite in this repo sits between about 1100 and
 * 32767, the Windows dynamic range starts at 49152, and nothing on the Fetch
 * standard's blocked-port list is near it. Claimed in the ledger, 27c.
 */
export const DEFAULT_PORT = 38471;
export const DEFAULT_SCHEMA = "village_season_qa";

/** The Fetch standard's blocked ports. Node's fetch refuses these before it opens a socket. */
export const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103,
  104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513,
  514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/**
 * HOW THESE SCRIPTS STOP, AND WHY NONE OF THEM CALLS process.exit.
 *
 * On Node 25 under Windows, `process.exit()` in a process that has made any
 * `fetch` aborts inside libuv (`Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)`) and the process ends with 127, whatever code was asked
 * for. Measured 2026-09-26: six exits out of six, with and without keep-alive,
 * and none when the exit code is set and the process is left to end. So a
 * script sets `process.exitCode` and ends, and a refusal THROWS a Stop, which
 * the handler below turns into that exit code.
 */
export class Stop extends Error {
  constructor(code) {
    super(`stop with exit code ${code}`);
    this.code = code;
  }
}

process.on("uncaughtException", (e) => {
  if (e instanceof Stop) {
    process.exitCode = e.code;
    return;
  }
  // Anything else is a bug in the harness: say so and end now, whatever that costs.
  console.error(e?.stack ?? e);
  process.exit(1);
});

/** Stop quietly with this exit code. */
export function stop(code = 0) {
  throw new Stop(code);
}

/** Stop with a sentence: "REFUSED: ..." and a non-zero exit. */
export function fail(message, code = 1) {
  console.error(`\nREFUSED: ${message}`);
  throw new Stop(code);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when `child` is `parent` or sits inside it. Case-insensitive on Windows, as the filesystem is. */
export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The one directory the harness writes into. Never inside the repository. */
export function outRoot() {
  const raw = (process.env.QA_OUT_DIR ?? "").trim();
  const dir = path.resolve(raw || path.join(os.tmpdir(), "season-village-qa"));
  if (isInside(dir, ROOT)) {
    fail(
      `QA_OUT_DIR resolves to ${dir}, which is inside the repository (${ROOT}). The harness writes session ` +
        `tokens, passwords and screenshots there, so it must live outside the tree. Point QA_OUT_DIR somewhere else.`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const stateDir = () => ensureDir(path.join(outRoot(), "state"));
export const runsDir = () => ensureDir(path.join(outRoot(), "runs"));
export const controlDir = () => ensureDir(path.join(stateDir(), "control"));
export const serverStateFile = () => path.join(stateDir(), "server.json");
export const tokensFile = () => path.join(stateDir(), "tokens.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** A variable from the environment, else from the repository's own .env, else "". */
export function envOrDotenv(name) {
  const direct = (process.env[name] ?? "").trim();
  if (direct) return direct;
  try {
    const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, "m").exec(text);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, "$2");
  } catch {
    /* no .env: the caller says what it needed */
  }
  return "";
}

const RAILWAY_HOST = /(^|\.)(railway\.app|railway\.internal|rlwy\.net)$/i;

/**
 * The database server and the scratch schema on it, or a refusal.
 *
 * REFUSES: no TEST_DATABASE_URL at all, a Railway host, a schema named
 * `railway`, the URL's own database (somebody else's), a test-harness template
 * (`village_tpl_*`), and anything that is not a plain identifier.
 */
export function databaseTarget() {
  const base = envOrDotenv("TEST_DATABASE_URL");
  if (!base) {
    fail("TEST_DATABASE_URL is not set in the environment or in the repository's .env. The harness boots on a scratch schema of that server and will not guess at another.");
  }
  let url;
  try {
    url = new URL(base);
  } catch {
    fail("TEST_DATABASE_URL is not a URL this script can read.");
  }
  if (RAILWAY_HOST.test(url.hostname)) {
    fail(`TEST_DATABASE_URL points at ${url.hostname}, a Railway host. This harness drops and rebuilds its schema, so it only runs against a local database server.`);
  }
  const schema = (process.env.QA_SCHEMA ?? "").trim() || DEFAULT_SCHEMA;
  if (!/^[A-Za-z0-9_]{1,64}$/.test(schema)) fail(`QA_SCHEMA "${schema}" is not a plain identifier.`);
  if (schema.toLowerCase() === "railway") fail("The schema name railway is the production app schema's name. Pick a scratch name.");
  if (/^village_tpl_/i.test(schema)) fail(`${schema} is the test harness's template namespace. Pick another name.`);
  const own = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (own && own.toLowerCase() === schema.toLowerCase()) {
    fail(`${schema} is the database TEST_DATABASE_URL itself names. The harness only drops a schema of its own.`);
  }
  const serverUrl = new URL(base);
  serverUrl.pathname = "/";
  const schemaUrl = new URL(base);
  schemaUrl.pathname = `/${schema}`;
  return { host: `${url.hostname}:${url.port || "3306"}`, schema, serverUrl: serverUrl.toString(), schemaUrl: schemaUrl.toString() };
}

/** The running village this harness booted, or null. */
export function serverState() {
  return readJson(serverStateFile());
}

/** Where to send requests: QA_BASE_URL wins, then the village boot.mjs is running. */
export function baseUrl() {
  const explicit = (process.env.QA_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const state = serverState();
  if (state?.base) return state.base;
  fail("No village is running: start one with `node scripts/qa/season-village/boot.mjs`, or set QA_BASE_URL.");
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** One JSON request. Never throws on an HTTP status: the caller decides what a status means. */
export async function api(base, method, route, body, token) {
  const res = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

/** /health, read the way boot.mjs proves its listener: status 200 and the database answering. */
export async function health(base) {
  try {
    const r = await api(base, "GET", "/health");
    return { ok: r.status === 200 && r.json?.status === "ok", status: r.status, build: r.json?.build ?? null, body: r.json };
  } catch (e) {
    return { ok: false, status: 0, build: null, error: String(e?.cause?.code ?? e?.message ?? e) };
  }
}
