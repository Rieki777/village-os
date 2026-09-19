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
 */
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
const TARGETS = [
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
  // AFTER messaging, which it requires. Measured: with introductions ahead of
  // it the server answered 409 "requires messaging to be enabled first", the
  // module stayed off, and this script still exited 0. Order is load-bearing
  // in this list, exactly as the note at the top says.
  ["introductions", "members"],
  ["automation", "members"],
];

/** A public probe per module: what a signed-out visitor should be able to reach. */
const PROBES = {
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

  // TARGETS is a hand-written list, and a hand-written list rots the moment
  // a module is added without touching this file — which already happened
  // once: `commerce` and `network` shipped and this script silently skipped
  // them while still printing "All modules enabled". Compare against what
  // the SERVER actually has and refuse to claim completeness while any
  // optional module is unaccounted for.
  const covered = new Set(TARGETS.map(([id]) => id));

  /*
   * Module library listings are EXCLUDED, deliberately, and the exclusion is
   * read from the server's own tier field so it can never go stale the way
   * TARGETS did.
   *
   * Turning a listing on without its credential probes a surface that cannot
   * answer: the route is mounted, requireVendor answers 503, and this script
   * would report a failure that is nobody's defect. Worse for a MANAGED
   * listing, where turning it on is the village accepting a support
   * arrangement and a stamped contract version, which is not a thing a
   * convenience script gets to do on somebody's behalf.
   *
   * A village that wants one enables it from the Modules tab, having read the
   * card, having set the key. That is the whole point of the tier being an
   * acceptance.
   */
  const listings = before.json.modules.filter((m) => m.tier && m.tier !== "included");

  /*
   * Modules that declare `setup: "required"` are excluded on the same
   * principle as the listings above, and read from the server's own field for
   * the same reason: turning one on connects the village to something it has
   * not set up. The Hypha bridge is the live case. Switching it on for a
   * village with no DHO gives that village a governance surface pointing at
   * nothing, which is the exact defect this round is closing everywhere else.
   */
  const needSetup = before.json.modules.filter(
    (m) =>
      !m.core &&
      m.setup === "required" &&
      // Only modules this script was NOT already told to open. Four of the
      // list's own entries declare `setup: "required"` too, and without this
      // clause the run printed "Skipping stays, library, exchange, commerce"
      // and then turned all four on, which is a worse sentence than no
      // sentence. Measured, not reasoned about.
      !covered.has(m.id) &&
      !listings.some((l) => l.id === m.id),
  );

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
  const missing = before.json.modules
    .filter(
      (m) =>
        !m.core &&
        !covered.has(m.id) &&
        !listings.some((l) => l.id === m.id) &&
        !needSetup.some((n) => n.id === m.id),
    )
    .map((m) => m.id);
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

  console.log(`\n${DRY ? "DRY RUN — " : ""}Enabling ${TARGETS.length} module(s) on ${BASE}\n`);
  const results = [];
  for (const [id, target] of TARGETS) {
    const want = FORCE_PREVIEW ? "preview" : target;
    const now = stored[id]?.lifecycle ?? "off";
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
    const target = TARGETS.find(([m]) => m === id)?.[1];
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

main().catch((e) => { console.error(e); process.exit(1); });
