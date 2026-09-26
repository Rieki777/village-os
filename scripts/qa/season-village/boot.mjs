#!/usr/bin/env node
/**
 * THE SEASON TWO TEST VILLAGE, step 1 of 3: boot the BUILT server on a private schema.
 *
 *   node scripts/qa/season-village/boot.mjs                    boot (reuses the schema if it is ours)
 *   node scripts/qa/season-village/boot.mjs --fresh            drop and rebuild the schema first
 *   node scripts/qa/season-village/boot.mjs --fresh --run seed,check,walk
 *                                                              the whole harness in one command, then stop
 *                                                              (check is walk.mjs --self-check)
 *   node scripts/qa/season-village/boot.mjs --status           what is running, and is it healthy
 *   node scripts/qa/season-village/boot.mjs --stop             stop the running village
 *
 * It stays in the foreground and SUPERVISES the server: it holds the heavy lock
 * for as long as the server lives, answers `--stop`, and rebuilds the village
 * from nothing when `seed.mjs --fresh` asks it to. Run it in its own terminal or
 * as a background job. A detached server that outlives its parent is not an
 * option on Windows: the process tree dies with the job that started it.
 *
 * ── WHAT IT PROVES BEFORE ANYONE TRUSTS A RESPONSE ─────────────────────────
 *
 * Another lane's server on the same port answers every request happily, from
 * their database. So the listener is proved three ways, and each is printed:
 * the port was free before the spawn, /health answers 200 with THIS dist's
 * build (the SHA from dist/.build-inputs.json), and on Windows `netstat` names
 * the process that holds the port, which must be the child this script spawned.
 *
 * ── THE ENV BLOCK ──────────────────────────────────────────────────────────
 *
 * The same shape as server/loop.e2e.test.ts: scheduler off, every outside
 * service blank, VILLAGE_SECRETS_KEY set. Two differences, both deliberate:
 * the secrets are generated per fresh village (kept in the state dir, never in
 * the tree), and invite-only is left at the PLATFORM DEFAULT, which is on. The
 * test harness switches it off in every scratch schema, so no e2e suite ever
 * sees a real fork's first hour; this village does.
 *
 * Environment:
 *   QA_PORT             port (default 38471)
 *   QA_SCHEMA           scratch schema on the TEST_DATABASE_URL server (default village_season_qa)
 *   QA_OUT_DIR          where state, logs and reports go (default: the OS temp dir; never the repo)
 *   QA_HEAVY_LOCK       a directory path used as a machine-wide lock around build and boot (optional)
 *   QA_LOCK_OWNER       the name written inside that lock (default season-village)
 *   QA_BOOT_DEADLINE_S  how long a boot may take (default 300: migrations plus a slow first import)
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_PORT,
  FETCH_BLOCKED_PORTS,
  HERE,
  ROOT,
  controlDir,
  databaseTarget,
  fail,
  health,
  isAlive,
  readJson,
  serverStateFile,
  sleep,
  stateDir,
  tokensFile,
  writeJson,
} from "./shared.mjs";

// distFreshness.ts and the migration runner both resolve from the working directory.
process.chdir(ROOT);

const argv = process.argv.slice(2);
const FRESH = argv.includes("--fresh");
const TAKEOVER = argv.includes("--takeover");
const NO_BUILD = argv.includes("--no-build");
const runAt = argv.indexOf("--run");
const RUN = runAt === -1 ? [] : String(argv[runAt + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
for (const step of RUN) if (!["seed", "check", "walk"].includes(step)) fail(`--run takes seed, check and walk, comma separated. "${step}" is none of them.`);

const PORT = Number((process.env.QA_PORT ?? "").trim() || DEFAULT_PORT);
const BOOT_DEADLINE_MS = Number((process.env.QA_BOOT_DEADLINE_S ?? "").trim() || 300) * 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = path.join(ROOT, "dist", "index.js");
const LOG = path.join(stateDir(), "server.log");
const DATA_DIR = path.join(stateDir(), "data");
const SECRETS = path.join(stateDir(), "secrets.json");
const OWNER = path.join(stateDir(), "schema-owner.json");

/** Every key that could reach a service outside this machine, blanked. */
const OUTSIDE_SERVICES = [
  "RESEND_API_KEY", "EMAIL_FROM", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ANTHROPIC_API_KEY",
  "PLATFORM_ASSISTANT_KEY", "GEMINI_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
  "RIVERSIDE_WEBHOOK_SECRET", "GOVERNANCE_HUB_SECRET", "HYPHA_VOICE_WEBHOOK_SECRET", "FEEDBACK_HUB_URL",
  "ERROR_WEBHOOK_URL", "SATELLITE_PROVIDER", "SENTINEL_WMS_URL", "MAPBOX_TOKEN", "GOOGLE_MAPS_STATIC_KEY",
  "ESRI_API_KEY", "BASESCAN_API_KEY", "BACKUP_EXPORT_TOKEN", "HYPHA_LISTENER_CONTRACT_ADDRESS",
  "HYPHA_LISTENER_RPC_URL", "HYPHA_LISTENER_WEBHOOK_URL", "HYPHA_LISTENER_WEBHOOK_SECRET",
  "BREAK_GLASS_ADMIN_EMAIL", "FOUNDER_EMAILS", "JOURNEY_PASSWORD", "PLATFORM_SUPPORT_URL", "PLATFORM_SUPPORT_EMAIL",
];

let db = null;
let mysql = null;
let lock = null;
let child = null;
let shuttingDown = false;
let restarting = false;
let current = null;

/** A refusal once the lock may be held: thrown, so the one exit path releases it. */
class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

// However the process ends, the lock is freed and the server stopped.
process.on("exit", () => {
  try { if (child && child.exitCode === null && child.signalCode === null) child.kill(); } catch { /* gone */ }
  releaseLock();
});

await main();

async function main() {
  if (argv.includes("--stop")) {
    process.exitCode = await stopRunning();
    return;
  }
  if (argv.includes("--status")) {
    process.exitCode = await printStatus();
    return;
  }

  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) fail(`QA_PORT must be a whole number from 1024 to 65535, and it is "${process.env.QA_PORT}".`);
  if (FETCH_BLOCKED_PORTS.has(PORT)) fail(`Port ${PORT} is on the Fetch standard's blocked list, so every probe of it would fail before it left this machine.`);

  const previous = readJson(serverStateFile());
  if (previous && isAlive(previous.supervisorPid)) {
    fail(`A season village is already running (supervisor pid ${previous.supervisorPid}, ${previous.base}). Stop it with --stop first.`);
  }
  if (previous) {
    console.log(`  found state from a supervisor that is gone (pid ${previous.supervisorPid}); clearing it`);
    if (isAlive(previous.serverPid) && (await listenerPid(previous.port)) === previous.serverPid) {
      try { process.kill(previous.serverPid); } catch { /* already gone */ }
      console.log(`  stopped its orphaned server, pid ${previous.serverPid}`);
    }
    fs.rmSync(serverStateFile(), { force: true });
  }

  db = databaseTarget();
  mysql = createRequire(path.join(ROOT, "package.json"))("mysql2/promise");

  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    try { process.on(sig, () => void shutdown(130, `received ${sig}`)); } catch { /* not every platform has every signal */ }
  }

  try {
    lock = await acquireLock();
    await ensureBuilt();
    current = await startVillage(FRESH);
    console.log(`\nREADY ${current.base}  (schema ${db.schema} on ${db.host}, build ${current.build}, boot ${current.bootId})`);
    if (RUN.length) {
      const code = await runSteps(RUN);
      await shutdown(code, `--run ${RUN.join(",")} finished`);
    } else {
      console.log("  supervising. Stop with: node scripts/qa/season-village/boot.mjs --stop  (or Ctrl-C)");
      await supervise();
    }
  } catch (e) {
    console.error(e instanceof Refusal ? `\nREFUSED: ${e.message}` : `\nFAILED: ${e?.stack ?? e}`);
    await shutdown(1, "the boot could not finish");
  }
}

// ── the heavy lock ─────────────────────────────────────────────────────────

async function acquireLock() {
  const dir = (process.env.QA_HEAVY_LOCK ?? "").trim();
  if (!dir) {
    console.log("  heavy lock: none configured (QA_HEAVY_LOCK unset), so this build and boot are not serialised with anyone");
    return null;
  }
  const owner = (process.env.QA_LOCK_OWNER ?? "").trim() || "season-village";
  const started = Date.now();
  for (let retry = 1; ; retry++) {
    try {
      fs.mkdirSync(dir); // atomic: exactly one caller creates it
      fs.writeFileSync(path.join(dir, "owner.txt"), `${owner}\npid ${process.pid}\nsince ${new Date().toISOString()}\n`);
      console.log(`  heavy lock: acquired ${dir} as ${owner}`);
      return dir;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let holder = "an unnamed holder";
      try { holder = fs.readFileSync(path.join(dir, "owner.txt"), "utf8").split(/\r?\n/).filter(Boolean).join(", "); } catch { /* being written */ }
      const minutes = Math.floor((Date.now() - started) / 60000);
      console.log(`  heavy lock: held by ${holder}; retry ${retry} in 30s (${minutes} min waited)${minutes >= 25 ? "  HELD OVER 25 MINUTES" : ""}`);
      await sleep(30_000);
    }
  }
}

function releaseLock() {
  if (!lock) return;
  const ownerFile = path.join(lock, "owner.txt");
  try {
    const text = fs.readFileSync(ownerFile, "utf8");
    if (!text.includes(`pid ${process.pid}`)) {
      console.error(`  heavy lock: ${lock} no longer names this process, so it is left alone`);
      lock = null;
      return;
    }
    fs.rmSync(ownerFile, { force: true });
    fs.rmdirSync(lock);
    console.log(`  heavy lock: released ${lock}`);
  } catch (e) {
    console.error(`  heavy lock: could not release ${lock}: ${e.message}`);
  }
  lock = null;
}

// ── the build ──────────────────────────────────────────────────────────────

async function distProblem() {
  if (!fs.existsSync(DIST)) return "dist/index.js does not exist";
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, "server", "db", "distFreshness.ts")).href);
    return mod.distFreshnessProblem();
  } catch (e) {
    return `the freshness check could not run on this Node (${String(e?.message ?? e).split("\n")[0]}), so the bundle counts as stale`;
  }
}

function distSha() {
  return readJson(path.join(ROOT, "dist", ".build-inputs.json"))?.sha ?? "";
}

async function ensureBuilt() {
  const before = await distProblem();
  if (!before) {
    console.log(`  build: dist is current (built from ${distSha() || "an unknown commit"}), no build needed`);
    return;
  }
  if (NO_BUILD) refuse(`dist is stale and --no-build was given: ${before.split("\n")[0]}`);
  console.log(`  build: dist is stale (${before.split("\n")[0].slice(0, 160)}), running pnpm build`);
  const r = spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  // The exit code alone is not the verdict: on Windows `pnpm build` has exited 0
  // after vite finished and the server half never ran. The receipts are.
  const after = await distProblem();
  if (after) refuse(`pnpm build exited ${r.status} and dist is still not the code in this tree:\n${after}`);
  console.log(`  build: pnpm build exited ${r.status}; dist now matches the tree (built from ${distSha()})`);
}

// ── the schema, the secrets, the server ────────────────────────────────────

async function prepareSchema(fresh) {
  const admin = await mysql.createConnection(db.serverUrl);
  try {
    const [rows] = await admin.query("SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [db.schema]);
    const exists = rows.length > 0;
    const owner = readJson(OWNER);
    const ours = owner?.schema === db.schema && owner?.host === db.host;
    if (exists && !ours && !TAKEOVER) {
      refuse(
        `A schema named ${db.schema} already exists on ${db.host} and this harness has no record of creating it, ` +
          `so it may be somebody else's. Pick another name with QA_SCHEMA, or pass --takeover if it is yours to drop.`,
      );
    }
    if (exists && !fresh) return "reused";
    if (exists) await admin.query(`DROP DATABASE \`${db.schema}\``);
    await admin.query(`CREATE DATABASE \`${db.schema}\` CHARACTER SET utf8mb4`);
    writeJson(OWNER, { schema: db.schema, host: db.host, createdAt: new Date().toISOString() });
    return exists ? "dropped and recreated" : "created";
  } finally {
    await admin.end();
  }
}

/** Test values for a scratch village, generated here and kept in the state dir only. */
function secrets(fresh) {
  const kept = readJson(SECRETS);
  if (kept && !fresh) return kept;
  const made = {
    adminPassword: `qa-${crypto.randomBytes(12).toString("hex")}`,
    authTokenSecret: crypto.randomBytes(32).toString("hex"),
    villageSecretsKey: crypto.randomBytes(32).toString("hex"),
  };
  writeJson(SECRETS, made);
  return made;
}


function serverEnv(s) {
  const env = { ...process.env };
  for (const k of ["DATABASE_URL", "TEST_DATABASE_URL", "QA_HEAVY_LOCK"]) delete env[k];
  for (const k of OUTSIDE_SERVICES) env[k] = "";
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(PORT),
    DATA_DIR,
    DATABASE_URL: db.schemaUrl,
    FRONTEND_URL: BASE,
    ADMIN_PASSWORD: s.adminPassword,
    AUTH_TOKEN_SECRET: s.authTokenSecret,
    VILLAGE_SECRETS_KEY: s.villageSecretsKey,
    // No background work: the walk reads a village that holds still.
    SCHEDULER_ENABLED: "0",
    // A dead local address (port 9 is fetch-blocked), so even a key typed into
    // the admin later cannot reach a model from this village.
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });
}

/** The pid holding a LISTENING socket on this port, from the OS, or null when it cannot be read. */
async function listenerPid(port) {
  try {
    if (process.platform === "win32") {
      // Both address families: a server bound to "::" never shows under `-p TCP`.
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 5 && /^TCP/i.test(cols[0]) && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) return Number(cols[4]);
      }
      return null;
    }
    const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
    const m = /pid=(\d+)/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function logTail(lines = 40) {
  try {
    return fs.readFileSync(LOG, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "(no server log)";
  }
}

async function startVillage(fresh) {
  const holder = await listenerPid(PORT);
  if (holder !== null || !(await portFree(PORT))) {
    refuse(`Port ${PORT} is already taken${holder ? ` by pid ${holder}` : ""}. Another lane may own it: set QA_PORT to a free one.`);
  }
  const schemaWas = await prepareSchema(fresh);
  console.log(`  schema: ${db.schema} on ${db.host} ${schemaWas}`);
  if (fresh || schemaWas !== "reused") {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(tokensFile(), { force: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const s = secrets(fresh || schemaWas !== "reused");

  const logFd = fs.openSync(LOG, "a");
  fs.writeSync(logFd, `\n==== boot ${new Date().toISOString()} (${fresh ? "fresh" : "reuse"}) ====\n`);
  child = spawn(process.execPath, [DIST], { cwd: ROOT, env: serverEnv(s), stdio: ["ignore", logFd, logFd] });
  fs.closeSync(logFd);
  const started = Date.now();
  let exited = null;
  child.once("exit", (code, signal) => { exited = { code, signal }; });

  let h = null;
  while (Date.now() - started < BOOT_DEADLINE_MS) {
    if (exited) refuse(`the server exited during boot (code ${exited.code}, signal ${exited.signal}). Log tail:\n${logTail()}`);
    h = await health(BASE);
    if (h.ok) break;
    await sleep(1000);
  }
  if (!h?.ok) refuse(`the server did not answer /health within ${BOOT_DEADLINE_MS / 1000}s (last: ${h?.status} ${h?.error ?? ""}). Log tail:\n${logTail()}`);
  const bootSeconds = Math.round((Date.now() - started) / 1000);

  // The listener, proved rather than assumed.
  const sha = distSha();
  if (sha && !String(h.build ?? "").includes(sha)) {
    refuse(`/health on ${BASE} reports build "${h.build}", and this dist was built from ${sha}. Something else is answering this port.`);
  }
  const owner = await listenerPid(PORT);
  if (owner !== null && owner !== child.pid) {
    refuse(`netstat says pid ${owner} holds port ${PORT}, and the server this script started is pid ${child.pid}.`);
  }
  console.log(
    `  listener: port was free before the spawn; /health 200 with build ${h.build}; ` +
      (owner === null ? "the OS listener table could not be read here (NOT VERIFIED that way)" : `netstat names pid ${owner}, the child this script spawned`) +
      `; boot took ${bootSeconds}s`,
  );

  child.on("exit", (code, signal) => {
    if (!shuttingDown && !restarting) {
      console.error(`\nthe server exited on its own (code ${code}, signal ${signal}). Log tail:\n${logTail()}`);
      void shutdown(1, "the server stopped");
    }
  });

  const state = {
    supervisorPid: process.pid,
    serverPid: child.pid,
    port: PORT,
    base: BASE,
    schema: db.schema,
    dbHost: db.host,
    build: h.build,
    bootId: crypto.randomBytes(6).toString("hex"),
    // Changes only when the schema is made again, so a plain restart keeps its seed.
    villageId: `${db.schema}@${readJson(OWNER)?.createdAt ?? "unknown"}`,
    fresh: fresh || schemaWas !== "reused",
    startedAt: new Date().toISOString(),
    bootSeconds,
    dataDir: DATA_DIR,
    log: LOG,
    adminPasswordFile: SECRETS,
  };
  writeJson(serverStateFile(), state);
  return state;
}

async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((r) => child.once("exit", r));
  child.kill();
  await Promise.race([gone, sleep(15_000)]);
}

// ── supervising ────────────────────────────────────────────────────────────

async function supervise() {
  const stop = path.join(controlDir(), "stop");
  const again = path.join(controlDir(), "restart-fresh");
  for (const f of [stop, again]) fs.rmSync(f, { force: true });
  while (!shuttingDown) {
    await sleep(1000);
    if (shuttingDown) return;
    if (fs.existsSync(stop)) {
      fs.rmSync(stop, { force: true });
      await shutdown(0, "asked to stop");
      return;
    }
    if (fs.existsSync(again)) {
      console.log("\n  asked for a fresh village: stopping the server, rebuilding the schema");
      restarting = true;
      await stopChild();
      current = await startVillage(true);
      restarting = false;
      fs.rmSync(again, { force: true });
      console.log(`READY ${current.base}  (fresh, build ${current.build}, boot ${current.bootId})`);
    }
  }
}

function runStep(step) {
  return new Promise((resolve) => {
    // "check" is the walk's self-check: every instrument shown a defect it must report.
    const [script, args] = step === "check" ? ["walk.mjs", ["--self-check"]] : [`${step}.mjs`, []];
    console.log(`\n==== ${step}: ${script} ${args.join(" ")} ====`);
    const p = spawn(process.execPath, [path.join(HERE, script), ...args], { cwd: ROOT, stdio: "inherit", env: process.env });
    p.once("exit", (code) => resolve(code ?? 1));
  });
}

async function runSteps(steps) {
  let worst = 0;
  for (const step of steps) {
    const code = await runStep(step);
    console.log(`==== ${step} exited ${code} ====`);
    worst = Math.max(worst, code);
    if (step === "seed" && code !== 0) {
      console.error("  the seed failed, so the walk would read a village that is not the one it describes; stopping here");
      return code;
    }
  }
  return worst;
}

async function shutdown(code, why) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  stopping (${why})`);
  await stopChild();
  if (child) console.log(`  server pid ${child.pid} stopped`);
  const state = readJson(serverStateFile());
  if (state?.supervisorPid === process.pid) fs.rmSync(serverStateFile(), { force: true });
  releaseLock();
  // No process.exit: see Stop in shared.mjs. The supervise loop sees `shuttingDown` and
  // returns, and a forced exit waits behind it in case anything still holds the loop open.
  process.exitCode = code;
  setTimeout(() => process.exit(code), 10_000).unref();
}

// ── --stop and --status, answered from another terminal ───────────────────

async function stopRunning() {
  const state = readJson(serverStateFile());
  if (!state) {
    console.log("  no season village is running here");
    return 0;
  }
  if (isAlive(state.supervisorPid)) {
    fs.writeFileSync(path.join(controlDir(), "stop"), new Date().toISOString());
    for (let i = 0; i < 60 && fs.existsSync(serverStateFile()); i++) await sleep(1000);
    if (fs.existsSync(serverStateFile())) fail(`the supervisor (pid ${state.supervisorPid}) did not stop within 60s.`);
    console.log(`  stopped the season village on ${state.base}`);
    return 0;
  }
  // The supervisor died without cleaning up: stop its server and free its lock.
  if (isAlive(state.serverPid) && (await listenerPid(state.port)) === state.serverPid) {
    try { process.kill(state.serverPid); } catch { /* gone */ }
    console.log(`  the supervisor was gone; stopped its orphaned server, pid ${state.serverPid}`);
  }
  fs.rmSync(serverStateFile(), { force: true });
  const lockDir = (process.env.QA_HEAVY_LOCK ?? "").trim();
  if (lockDir) {
    try {
      const text = fs.readFileSync(path.join(lockDir, "owner.txt"), "utf8");
      if (text.includes(`pid ${state.supervisorPid}`)) {
        fs.rmSync(path.join(lockDir, "owner.txt"), { force: true });
        fs.rmdirSync(lockDir);
        console.log(`  released the heavy lock the dead supervisor held (${lockDir})`);
      }
    } catch { /* not held by it */ }
  }
  return 0;
}

async function printStatus() {
  const state = readJson(serverStateFile());
  if (!state) {
    console.log("  no season village is running here");
    return 1;
  }
  const h = await health(state.base);
  console.log(JSON.stringify({ ...state, supervisorAlive: isAlive(state.supervisorPid), health: h.ok ? "ok" : `${h.status} ${h.error ?? ""}` }, null, 2));
  return h.ok ? 0 : 1;
}
