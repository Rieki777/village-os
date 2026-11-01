#!/usr/bin/env node
/**
 * Turn every module on, in dependency order, and verify each surface answers.
 *
 * Modules ship OFF by design — this is the deliberate act that opens them.
 * Order matters: the feed is a lens over the forum, so the forum goes first;
 * funds-bearing modules (stays, exchange) refuse to enable while a shared
 * password is the only admin credential, so the deployment needs per-admin
 * identities already bootstrapped.
 *
 * Usage:
 *   node scripts/enable-all-modules.mjs --base https://your-village.example \
 *        --email founder@example.com --password '…'
 *   node scripts/enable-all-modules.mjs --base http://localhost:3001 --token <bearer>
 *
 *   --dry     report what WOULD change, change nothing
 *   --preview enable to 'preview' (admins only) instead of the target posture
 *
 * What a module is opened to is decided here, by hand, in TARGETS: whether a
 * stranger may read it is a judgment about the village, not a fact the
 * registry holds. A third posture, "held", names a module this script must
 * not open yet (with the reason as a third element): it is reported and never
 * sent, and anything that requires it is blocked with it. Everything else is read from the server: the ORDER comes
 * from each module's `requires`, a posture wider than what a module requires
 * allows is narrowed to it, and a module the server does not offer is skipped.
 * `scripts/enable-all-modules.test.mjs` holds this list to the registry in
 * `shared/modules.ts`, so a module added without a posture here fails CI and
 * not a founder's setup.
 */
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = String(args.base || "http://localhost:3001").replace(/\/$/, "");
const DRY = !!args.dry;
const FORCE_PREVIEW = !!args.preview;

/**
 * Target postures. Public = anyone may read; members = sign-in required;
 * automation is an admin-facing pipeline, so it never needs to go public.
 */
export const TARGETS = [
  ["map", "public"],
  ["forum", "public"],
  ["feed", "public"],
  ["tools", "public"],
  ["badges", "public"],
  ["library", "public"],
  ["health", "public"],
  ["stays", "public"],
  ["exchange", "public"],
  ["commerce", "public"],
  ["network", "public"],
  ["events", "public"],
  // Four that shipped after this list was written and were never added, which
  // is why the runbook's own step exited 3 on trunk and told the founder the
  // script was out of date. How a village decides and how its resources flow
  // are things villages publish; who is being introduced to whom is not.
  ["governance", "public"],
  ["resources", "public"],
  ["crowdpool", "public"],
  ["messaging", "members"],
  // A member's request to be paid back is between them and the village.
  ["redemption", "members"],
  // A member's own journal is never anybody else's to read, and the module
  // has no public surface to probe.
  ["journal", "members"],
  // A circle's calls are for the people in them, members only and no guests,
  // and the module has no public surface to probe.
  ["sessions", "members"],
  // AFTER messaging, which it requires. Measured: with introductions ahead of
  // it the server answered 409 "requires messaging to be enabled first", the
  // module stayed off, and this script still exited 0. Order is load-bearing
  // in this list, exactly as the note at the top says.
  ["introductions", "members"],
  ["automation", "members"],
  // Members, never public: public is what lets a stranger RSVP as a guest,
  // which is a village's own choice. Turning the module on sends nothing by
  // itself, because every journey inside it also ships off.
  ["comms", "members"],
  // A member's own chart, shown only to the members they choose; no public
  // surface to probe.
  ["gene-keys", "members"],
  // HELD. A member-pii module that reached main before the human security
  // review Module Library Contract clause 13 requires. It stays off in every
  // fork until that review closes and Rye signs off; then this line becomes
  // ["session-card", "members"] (it requires sessions and gene-keys).
  ["session-card", "held", "security review pending (Module Library Contract clause 13)"],
];

/** A public probe per module: what a signed-out visitor should be able to reach. */
export const PROBES = {
  map: "/api/map",
  forum: "/api/forum/categories",
  feed: "/api/feed",
  tools: "/api/tools",
  badges: "/api/badges",
  library: "/api/library",
  health: "/api/health/summary",
  stays: "/api/stays",
  exchange: "/api/exchange",
  commerce: "/api/products",
  network: "/api/network/published",
  events: "/api/events",
  governance: "/api/governance/ballots",
  resources: "/api/resources",
  crowdpool: "/api/crowdpool/campaigns",
};

const RANK = { off: 0, preview: 1, members: 2, public: 3 };

/**
 * What a run would do, worked out from the server's module list alone, so the
 * self-test drives exactly the decisions a real run makes.
 *
 * - `listings`: library listings (a tier other than included). Never opened here.
 * - `needSetup`: modules declaring `setup: "required"` that TARGETS does not
 *   name. Never opened here.
 * - `missing`: optional modules the server offers that none of the above
 *   accounts for. A run refuses while this is not empty.
 * - `absent`: TARGETS entries this server does not offer (an older or newer
 *   release). Skipped, never sent.
 * - `held`: TARGETS entries with the posture "held", each with its reason.
 *   Reported, never sent, and treated as off by anything that requires them.
 * - `steps`: the rest, each after every module it requires. `want` is narrowed
 *   to the widest posture its requirements allow, with `narrowedFrom` set when
 *   that happened; `blockedBy` names a requirement that is neither core, nor in
 *   this run, nor already on, which the server would refuse.
 */
export function planRun(modules, targets = TARGETS, { preview = false } = {}) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const posture = new Map(targets.map(([id, t]) => [id, t]));
  const held = targets.filter(([id, t]) => t === "held" && byId.has(id)).map(([id, , reason]) => ({ id, reason: reason ?? "held" }));
  const isHeld = (id) => posture.get(id) === "held";
  const listings = modules.filter((m) => m.tier && m.tier !== "included");
  const isListing = (id) => listings.some((l) => l.id === id);
  const needSetup = modules.filter((m) => !m.core && m.setup === "required" && !posture.has(m.id) && !isListing(m.id));
  const missing = modules
    .filter((m) => !m.core && !posture.has(m.id) && !isListing(m.id) && !needSetup.some((n) => n.id === m.id))
    .map((m) => m.id);
  const absent = targets.map(([id]) => id).filter((id) => !byId.has(id));

  const steps = [];
  const placed = new Map();
  const visiting = new Set();
  const place = (id) => {
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const def = byId.get(id);
    for (const dep of def.requires ?? []) if (posture.has(dep) && !isHeld(dep) && byId.has(dep)) place(dep);
    let want = preview ? "preview" : posture.get(id);
    let narrowedFrom = null;
    const blockedBy = [];
    for (const dep of def.requires ?? []) {
      const d = byId.get(dep);
      const depLevel = d?.core ? "public" : isHeld(dep) ? "off" : placed.has(dep) ? placed.get(dep) : d?.served ?? d?.lifecycle ?? "off";
      if (depLevel === "off") {
        blockedBy.push(dep);
        continue;
      }
      if (RANK[depLevel] < RANK[want]) {
        narrowedFrom ??= want;
        want = depLevel;
      }
    }
    visiting.delete(id);
    placed.set(id, want);
    steps.push({ id, want, from: def.lifecycle ?? "off", narrowedFrom, blockedBy });
  };
  for (const [id] of targets) if (byId.has(id) && !isHeld(id)) place(id);
  return { listings, needSetup, missing, absent, held, steps };
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function main() {
  let token = args.token && args.token !== true ? String(args.token) : null;
  if (!token) {
    if (!args.email || !args.password) {
      console.error("Need --token, or --email and --password for a founder/admin account.");
      process.exit(2);
    }
    const login = await api("POST", "/api/auth/login", { email: String(args.email), password: String(args.password) });
    if (login.status !== 200 || !login.json?.token) {
      console.error(`Login failed (${login.status}):`, login.json?.error ?? login.json);
      process.exit(1);
    }
    token = login.json.token;
    console.log(`Signed in as ${login.json.user?.name ?? args.email} (${login.json.user?.role ?? "?"}).`);
  }

  const before = await api("GET", "/api/admin/modules", undefined, token);
  if (before.status !== 200) {
    console.error(`Cannot read modules (${before.status}):`, before.json?.error ?? before.json);
    console.error("The token must belong to an account with the founder or admin role.");
    process.exit(1);
  }
  const stored = Object.fromEntries(before.json.modules.map((m) => [m.id, m]));

  /*
   * TARGETS is a hand-written list, and a hand-written list rots the moment a
   * module is added without touching this file. It happened three times:
   * `commerce` and `network` were skipped while this printed "All modules
   * enabled", then four more, then `gene-keys`, which made the runbook's step
   * exit 3 on main. So the run compares against what the SERVER has and
   * refuses to claim completeness while any optional module is unaccounted
   * for, and the self-test catches the same gap against the registry before
   * it ships.
   *
   * Module library listings are EXCLUDED, read from the server's own tier
   * field. Turning a listing on without its credential probes a surface that
   * cannot answer (requireVendor says 503), and for a MANAGED listing turning
   * it on is the village accepting a support arrangement and a stamped
   * contract version, which no convenience script gets to do on somebody's
   * behalf. A village that wants one enables it from the Modules tab, having
   * read the card and set the key.
   *
   * Modules that declare `setup: "required"` and are not in TARGETS are
   * excluded on the same principle: turning one on connects the village to
   * something it has not set up. The Hypha bridge is the live case. Four of
   * TARGETS' own entries declare it too (stays, library, exchange, commerce);
   * naming them in TARGETS is this script's decision to open them.
   */
  const plan = planRun(before.json.modules, TARGETS, { preview: FORCE_PREVIEW });
  const { listings, needSetup, missing } = plan;

  /*
   * WHAT STATE AM I IN. This prints on every exit, including the refusal.
   *
   * The refusal below was already the right shape: it declines to report a
   * success it cannot vouch for. What it never did was say what it had left
   * behind, so an operator following the runbook read "this script is out of
   * date", got exit 3, and had no idea which modules their village now had. A
   * setup step that leaves somebody unsure what they are running is the same
   * defect as a save that lands where nothing reads.
   */
  let lastRead = null;
  const reportState = () => {
    const rows = (lastRead ?? before).json.modules;
    console.log("\nWhere this village stands right now:\n");
    for (const m of rows) {
      const state = m.core ? "always on" : m.lifecycle;
      const served = m.served && m.served !== m.lifecycle ? `  (serving ${m.served})` : "";
      console.log(`  ${String(m.id).padEnd(14)} ${String(state).padEnd(9)}${served}`);
    }
    console.log("");
  };
  if (missing.length) {
    console.error(
      `\nThis script does not know about ${missing.length} module(s) the server offers: ${missing.join(", ")}.\n` +
        `Add them to TARGETS (and PROBES) in scripts/enable-all-modules.mjs — refusing to report success while the list is stale.`,
    );
    reportState();
    console.error("Nothing was changed. Every module above is exactly as you left it.");
    process.exit(3);
  }
  if (needSetup.length) {
    console.log(
      `\nSkipping ${needSetup.length} module(s) that need their own setup first: ${needSetup.map((m) => m.id).join(", ")}.\n` +
        `Each one connects this village to something outside it. Turn it on from Admin -> Modules once that connection exists.`,
    );
  }
  if (listings.length) {
    console.log(
      `\nSkipping ${listings.length} module library listing(s): ${listings.map((m) => `${m.id} (${m.tier})`).join(", ")}.\n` +
        `Enable each one from Admin -> Modules after reading its card and setting its credential.`,
    );
  }

  for (const h of plan.held) {
    console.log(`\nHeld, not sent: ${h.id}, ${h.reason}. It stays as it is on this village.`);
  }
  if (plan.absent.length) {
    console.log(`\nNot on this server, so not sent: ${plan.absent.join(", ")}.`);
  }
  for (const st of plan.steps) {
    if (st.narrowedFrom) console.log(`  ${st.id} opens to ${st.want}, not ${st.narrowedFrom}: what it requires is open only that far.`);
  }

  console.log(`\n${DRY ? "DRY RUN — " : ""}Enabling ${plan.steps.length} module(s) on ${BASE}, each after what it requires\n`);
  const results = [];
  for (const { id, want, blockedBy } of plan.steps) {
    const now = stored[id]?.lifecycle ?? "off";
    if (blockedBy.length && now !== want) {
      results.push({ id, action: "REFUSED", from: now, to: want, status: "-", error: "requires a module that is off and not in this run", detail: blockedBy });
      continue;
    }
    if (now === want) { results.push({ id, action: "already", lifecycle: now }); continue; }
    if (DRY) { results.push({ id, action: "would-set", from: now, to: want }); continue; }
    const r = await api("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: want }, token);
    if (r.status === 200) results.push({ id, action: "set", from: now, to: want });
    else results.push({ id, action: "REFUSED", from: now, to: want, status: r.status, error: r.json?.error, detail: r.json?.missing ?? r.json?.dependents ?? r.json?.description });
  }

  for (const r of results) {
    const line = r.action === "REFUSED"
      ? `  ✗ ${r.id.padEnd(12)} ${r.status} ${r.error}${r.detail ? ` (${JSON.stringify(r.detail)})` : ""}`
      : `  ${r.action === "already" ? "·" : "✓"} ${r.id.padEnd(12)} ${r.action === "already" ? `already ${r.lifecycle}` : `${r.from} → ${r.to}`}`;
    console.log(line);
  }

  if (DRY) {
    reportState();
    console.log("Dry run. Nothing was changed.");
    return;
  }

  /*
   * A REFUSED module counts against the run.
   *
   * `bad` used to count only probe failures and dependency demotions, so a
   * module the server declined to enable was printed with a cross, left off,
   * and then followed by "All modules enabled and answering" and exit 0. That
   * was measured on this repo: introductions sat above the module it requires,
   * came back 409, stayed off, and the script reported success.
   */
  let bad = results.filter((r) => r.action === "REFUSED").length;

  // Verify: what a signed-out visitor sees, module by module.
  console.log("\nVerifying public surfaces (as a signed-out visitor):\n");
  for (const [id, path] of Object.entries(PROBES)) {
    const target = plan.steps.find((st) => st.id === id)?.want;
    const r = await api("GET", path);
    const ok = target === "public" ? r.status === 200 : [401, 404].includes(r.status);
    if (!ok) bad += 1;
    console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(24)} ${r.status}${ok ? "" : "  ← unexpected"}`);
  }

  const after = await api("GET", "/api/admin/modules", undefined, token);
  lastRead = after;
  const servedOff = after.json.modules.filter((m) => !m.core && m.served === "off" && m.lifecycle !== "off");
  if (servedOff.length) {
    console.log("\n  ! demoted (dependency unmet, serving OFF):");
    for (const m of servedOff) console.log(`    ${m.id}: needs ${JSON.stringify(m.demotedBecause)}`);
    bad += servedOff.length;
  }

  const info = await api("GET", "/api/platform/info");
  console.log(`\n${info.json?.name ?? "?"} — ${info.json?.modules?.length ?? 0} module(s) serving, build ${info.json?.build ?? "?"}`);
  // The same table on the way out as on the refusal, so the answer to "what do
  // I have now" never depends on which exit was taken.
  reportState();
  console.log(bad === 0 ? "All modules this script opens are on and answering.\n" : `${bad} module(s) or surface(s) need attention. The table above is what you have.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
