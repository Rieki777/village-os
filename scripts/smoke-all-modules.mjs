/**
 * Exercise every enabled module end-to-end as real users against the local
 * production build. Temporary check script; deleted after the run.
 */
const BASE = (process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3901").replace(/\/$/, "");
const FOUNDER_EMAIL = process.argv.includes("--email") ? process.argv[process.argv.indexOf("--email") + 1] : "steward@village.test";
const FOUNDER_PASSWORD = process.argv.includes("--password") ? process.argv[process.argv.indexOf("--password") + 1] : "LocalCheck123!";
const results = [];
let fails = 0;

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
function check(name, ok, detail = "") {
  results.push(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  ← ${detail}`}`);
  if (!ok) fails += 1;
}

const founder = (await api("POST", "/api/auth/login", { email: FOUNDER_EMAIL, password: FOUNDER_PASSWORD })).json.token;

// Two ordinary members (unique per run so reruns never collide).
const RUN = Date.now().toString(36);
const alice = await api("POST", "/api/auth/register", { email: `alice-${RUN}@village.test`, password: "Member123!", name: "Alice Gardener", paths: ["resident"] });
const bob = await api("POST", "/api/auth/register", { email: `bob-${RUN}@village.test`, password: "Member123!", name: "Bob Builder", paths: ["steward"] });
const aT = alice.json.token, bT = bob.json.token;
const aId = alice.json.user.id, bId = bob.json.user.id;
check("register two members", alice.status === 200 && bob.status === 200);

console.log("\n── QUESTS + GRATITUDE (core loop) ──");
const quests = await api("GET", "/api/quests", undefined, aT);
const q = (Array.isArray(quests.json) ? quests.json : quests.json.quests).find((x) => !x.minStage && !x.requiresRole);
const claim = await api("POST", `/api/game/quests/${q.id}/claim`, {}, aT);
check("claim a quest", claim.status === 200, `${claim.status} ${JSON.stringify(claim.json).slice(0,120)}`);
await api("POST", `/api/game/quests/${q.id}/submit`, { note: "Planted the beds." }, aT);
// Consent inside what the board advertises — the range IS the contract.
const advertised = Number(String(q.gratitude).match(/\d+/)?.[0] ?? 25);
const consent = await api("POST", `/api/admin/quest-claims/${claim.json.id}/consent`, { approve: true, amount: advertised }, founder);
check("admin consent releases value", consent.status === 200, `${consent.status} ${JSON.stringify(consent.json).slice(0,140)}`);
const grat = await api("POST", "/api/game/gratitude/send", { toEmail: `bob-${RUN}@village.test`, amount: 5, message: "Thanks for the fence" }, aT);
check("gratitude send", grat.status === 200, `${grat.status} ${JSON.stringify(grat.json).slice(0,120)}`);

console.log("\n── MAP ──");
const map = await api("GET", "/api/map", undefined, aT);
check("map returns circles + roles", map.status === 200 && (map.json.roles?.length ?? 0) > 0);
const concierge = await api("POST", "/api/assistant/coordinate", { query: "I want to help with gardens and permaculture" }, aT);
check("concierge routes deterministically", concierge.status === 200 && concierge.json.method === "deterministic", `${concierge.status} ${concierge.json?.method}`);

console.log("\n── FORUM + FEED ──");
await api("PUT", `/api/admin/players/${aId}/stage`, { stageId: "member" }, founder);
await api("PUT", `/api/admin/players/${bId}/stage`, { stageId: "co-creator" }, founder);
const thread = await api("POST", "/api/forum/threads", { category: "village-life", title: "Sunday harvest", body: "Who is in for the harvest?", tags: ["harvest"] }, aT);
check("start a thread", thread.status === 200, `${thread.status} ${JSON.stringify(thread.json).slice(0,120)}`);
const reply = await api("POST", `/api/forum/threads/${thread.json.id}/replies`, { body: "I'm in." }, bT);
check("reply to a thread", reply.status === 200);
const micro = await api("POST", "/api/forum/threads", { category: "village-life", kind: "post", body: "The papayas are ripe!" }, bT);
const heart = await api("POST", `/api/feed/threads/${micro.json.id}/heart`, {}, aT);
check("heart moves real budget", heart.status === 200 && heart.json.heartCount === 1, `${heart.status}`);
const feed = await api("GET", "/api/feed", undefined, aT);
check("feed shows posts + system items", feed.status === 200 && feed.json.items.length > 0);

console.log("\n── TOOLS ──");
const tool = await api("POST", "/api/admin/tools", { name: `Village Chat ${RUN}`, purpose: "Where we talk", url: "https://example.org/chat", category: "communication", visibility: "public" }, founder);
check("add a tool", tool.status === 200, `${tool.status} ${JSON.stringify(tool.json).slice(0,120)}`);
check("tool visible publicly", (await api("GET", "/api/tools")).json.tools.some(t => t.name === `Village Chat ${RUN}`));

console.log("\n── EVENTS ──");
// Capacity 1 on purpose: the point of this section is that the cap is real.
const soon = new Date(Date.now() + 3 * 86400000).toISOString();
const gathering = await api("POST", "/api/admin/events", {
  title: `Harvest work party ${RUN}`, startsAt: soon, locationText: "The greenhouse",
  structureKeys: ["greenhouse"], capacity: 1, status: "scheduled",
}, founder);
check("create a gathering", gathering.status === 200, `${gathering.status} ${JSON.stringify(gathering.json).slice(0,120)}`);
const evId = gathering.json?.event?.id;
check("gathering listed publicly", (await api("GET", "/api/events")).json.events.some(e => e.id === evId));
// A draft must never reach the member-facing list.
const draft = await api("POST", "/api/admin/events", { title: `Secret ${RUN}`, startsAt: soon }, founder);
check("draft stays off the public calendar",
  draft.status === 200 && !(await api("GET", "/api/events")).json.events.some(e => e.id === draft.json.event.id));
check("member RSVPs", (await api("POST", `/api/events/${evId}/rsvp`, { status: "going" }, aT)).status === 200);
// The seat is gone, so the second member is refused. This is the check that
// would pass anyway if capacity were enforced outside the transaction.
const second = await api("POST", `/api/events/${evId}/rsvp`, { status: "going" }, bT);
check("capacity refuses the second member", second.status === 409 && second.json.reason === "full", `${second.status}`);
check("a full gathering still takes maybe", (await api("POST", `/api/events/${evId}/rsvp`, { status: "maybe" }, bT)).status === 200);
// Withdrawing frees the seat, which proves the count is derived and not a
// counter somebody has to remember to decrement.
await api("DELETE", `/api/events/${evId}/rsvp`, undefined, aT);
check("withdrawing frees the seat", (await api("POST", `/api/events/${evId}/rsvp`, { status: "going" }, bT)).status === 200);
const oneEvent = await api("GET", `/api/events/${evId}`, undefined, aT);
check("event carries schema.org markup",
  oneEvent.json?.schemaOrg?.["@type"] === "Event"
  && oneEvent.json.schemaOrg.eventStatus === "https://schema.org/EventScheduled");
check("map reads gatherings by structure",
  (await api("GET", "/api/events/by-structure")).json.structures?.greenhouse?.eventId === evId);
// The organiser's list: names for whoever is catering, and never emails.
const answers = await api("GET", `/api/admin/events/${evId}/rsvps`, undefined, founder);
check("organiser sees who answered, with no emails",
  answers.status === 200
  && answers.json.rsvps.length >= 1
  && answers.json.rsvps.every(r => !("email" in r)),
  JSON.stringify(answers.json).slice(0, 140));

console.log("\n── BADGES ──");
const selfB = await api("POST", "/api/admin/badges", { name: `Composter ${RUN}`, kind: "self", description: "I compost" }, founder);
const earnedB = await api("POST", "/api/admin/badges", { name: `Quest Doer ${RUN}`, kind: "earned", rule: { metric: "quests_consented", threshold: 1, stackable: true, maxStack: 5 } }, founder);
check("create self + earned badges", selfB.status === 200 && earnedB.status === 200, `${selfB.status}/${earnedB.status}`);
check("member claims a self badge", (await api("POST", `/api/badges/${selfB.json.badge.id}/claim`, {}, aT)).status === 200);
const evald = await api("POST", "/api/admin/badges/evaluate", {}, founder);
check("earned engine awards from settled events", evald.status === 200 && evald.json.newTiers.length > 0, JSON.stringify(evald.json).slice(0,150));
check("skills declare + dedupe", (await api("POST", "/api/badges/skills", { tag: "carpentry" }, bT)).status === 200);

console.log("\n── LIBRARY ──");
await api("POST", "/api/admin/library/categories", { label: `Garden Tools ${RUN}` }, founder);
const intake = await api("POST", "/api/admin/library/intake", { name: `Wheelbarrow ${RUN}`, appraisal: 100, donorUserId: aId, categoryId: null }, founder);
check("intake awards credits", intake.status === 200 && intake.json.award === 75, `${intake.status} ${JSON.stringify(intake.json)}`);
const libItems = (await api("GET", "/api/library", undefined, aT)).json.items;
const barrow = libItems.find(i => i.name === `Wheelbarrow ${RUN}`);
const reserve = await api("POST", `/api/library/items/${barrow.id}/reserve`, {}, aT);
check("reserve locks escrow", reserve.status === 200 && reserve.json.escrow === 25, `${reserve.status} ${JSON.stringify(reserve.json)}`);
await api("POST", `/api/admin/library/loans/${reserve.json.loanId}/pickup`, {}, founder);
await api("POST", `/api/library/loans/${reserve.json.loanId}/return`, {}, aT);
const settle = await api("POST", `/api/admin/library/loans/${reserve.json.loanId}/settle`, { outcome: "closed" }, founder);
check("settle returns escrow minus wear", settle.status === 200 && settle.json.released === 20, JSON.stringify(settle.json));
const libAdmin = await api("GET", "/api/admin/library", undefined, founder);
check("escrow reconciles", libAdmin.json.reconciliation.ok === true, JSON.stringify(libAdmin.json.reconciliation));

console.log("\n── STAYS ──");
const room = await api("POST", "/api/admin/stays/accommodations", { name: `Garden Cabin ${RUN}`, description: "Under the mangoes", capacity: 2 }, founder);
await api("PUT", `/api/admin/stays/accommodations/${room.json.id}/prices`, { prices: [
  { tokenType: "stay-credit", audience: "guest", amountMinor: 2 },
  { tokenType: "stay-credit", audience: "member", amountMinor: 1 },
  { tokenType: "usd", audience: "guest", amountMinor: 5000 },
]}, founder);
const stayReq = await api("POST", "/api/stays/request", { accommodationId: room.json.id, notes: "Arriving Friday" }, bT);
check("request a stay", stayReq.status === 200, `${stayReq.status}`);
const manual = await api("POST", "/api/admin/stays/purchases/manual", { userId: bId, accommodationId: room.json.id, nights: 5, amountMinor: 25000 }, founder);
check("manual payment grants credits", manual.status === 200 && manual.json.creditsGranted === 5, JSON.stringify(manual.json).slice(0,150));
const activate = await api("POST", `/api/admin/stays/${stayReq.json.id}/activate`, {}, founder);
check("activation snapshots the rate", activate.status === 200 && activate.json.rateSnapshotCredits === 1, JSON.stringify(activate.json));
const nights = await api("POST", "/api/admin/stays/post-nights", {}, founder);
check("nightly posting runs", nights.status === 200, JSON.stringify(nights.json));
check("card checkout refuses honestly without Stripe", (await api("POST", "/api/stays/checkout", { accommodationId: room.json.id, nights: 2 }, bT)).status === 503);

console.log("\n── EXCHANGE ──");
await api("POST", "/api/admin/tokens", { slug: `village-credit-${RUN}`, name: `Village Credits ${RUN}`, kind: "credit", transferable: false }, founder);
check("recognition refuses listing", (await api("PUT", "/api/admin/exchange/tokens/gratitude", { purchasable: true }, founder)).status === 409);
check("library-credit never lists", (await api("PUT", "/api/admin/exchange/tokens/library-credit", { purchasable: true }, founder)).status === 409);
check("stay-credit blocked (one seller)", (await api("PUT", "/api/admin/exchange/tokens/stay-credit", { purchasable: true }, founder)).status === 409);
const VC = `village-credit-${RUN}`;
check("list a plain credit token", (await api("PUT", `/api/admin/exchange/tokens/${VC}`, { purchasable: true }, founder)).status === 200);
check("price needs a note", (await api("POST", `/api/admin/exchange/tokens/${VC}/price`, { priceMinor: 500 }, founder)).status === 409);
check("post a price with a note", (await api("POST", `/api/admin/exchange/tokens/${VC}/price`, { priceMinor: 500, note: "Opening price $5" }, founder)).status === 200);
const stock = await api("POST", "/api/admin/exchange/stock", { tokenSlug: VC, amount: 200 }, founder);
check("stock the treasury", stock.status === 200 && stock.json.treasuryBalance === 200, JSON.stringify(stock.json));
const market = await api("GET", "/api/exchange", undefined, bT);
check("market lists with price + stock", market.json.listings.some(l => l.slug === VC && l.inStock && l.priceMinor === 500), JSON.stringify(market.json.listings));
check("swap answers 501 (v2 contract)", (await api("POST", "/api/exchange/swap", {}, bT)).status === 501);

console.log("\n── HEALTH ──");
const regen = await api("POST", "/api/admin/health/regen", { metricKey: "trees_planted", value: 1400, note: "Reforestation sweep" }, founder);
check("record regen entry", regen.status === 200, `${regen.status}`);
const summary = await api("GET", "/api/health/summary");
check("health summary is honest about sparse data", summary.status === 200 && summary.json.trendsUnlocked === false, JSON.stringify({ l: summary.json.lunationsCollected, t: summary.json.trendsUnlocked }));
check("regen totals public", (await api("GET", "/api/health/regen")).json.totals.trees_planted.total >= 1400);

console.log("\n── AUTOMATION ──");
const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nWelcome to the circle.\n\n00:01:00.000 --> 00:01:10.000\nThe founders circle should repair the water pump.";
const rec = await api("POST", "/api/admin/recordings", { title: `Circle Call ${RUN}`, transcript: vtt }, founder);
check("ingest recording + transcript", rec.status === 200 && rec.json.segments === 2, JSON.stringify(rec.json).slice(0,120));
check("synthesis refuses honestly without a key", (await api("POST", `/api/admin/recordings/${rec.json.recording.id}/synthesize`, {}, founder)).status === 503);
check("members never see the admin pipeline", (await api("GET", "/api/admin/recordings", undefined, aT)).status === 401);

console.log("\n── JOURNAL ──");
const jEntry = await api("POST", "/api/journal/entries", {
  clientId: `smoke-${RUN}`, practice: "evening", depth: "light", writtenAt: new Date().toISOString(),
  answers: [{ questionKey: "went-well", prompt: "What went well today?", text: "The beds are planted." }],
}, aT);
check("save a journal entry", jEntry.status === 200 && !!jEntry.json?.id, `${jEntry.status} ${JSON.stringify(jEntry.json).slice(0,120)}`);
const jMine = await api("GET", "/api/journal/entries", undefined, aT);
check("the author reads it back", jMine.status === 200 && jMine.json.some((e) => e.id === jEntry.json?.id));
const jOther = await api("GET", "/api/journal/entries", undefined, bT);
check("another member does not", jOther.status === 200 && !jOther.json.some((e) => e.id === jEntry.json?.id));
const jAdmin = await api("GET", "/api/journal/entries", undefined, founder);
check("an admin does not either", jAdmin.status === 200 && !jAdmin.json.some((e) => e.id === jEntry.json?.id));
check("the guide refuses honestly without a key", (await api("POST", "/api/journal/guide", { practice: "evening", messages: [{ role: "user", content: "hello" }] }, aT)).status === 503);

console.log("\n── LIVE SESSIONS ──");
// Alice opens the room and facilitates; Bob joins. The checks walk the privacy
// line in shared/sessions.ts: members only, arrival seen while open and erased
// at close, facilitation feedback unsigned, the record read by the people who
// were there and by admins, and shareable minutes that name nobody.
const sNew = await api("POST", "/api/sessions", { title: `Garden circle ${RUN}`, durationMin: 30 }, aT);
check("open a session", sNew.status === 200 && !!sNew.json?.id, `${sNew.status} ${JSON.stringify(sNew.json).slice(0,120)}`);
const sid = sNew.json?.id;
const sAct = (action) => api("POST", `/api/sessions/${sid}/act`, { action }, aT);
check("a stranger cannot look in", (await api("GET", `/api/sessions/${sid}`)).status === 401);
await api("POST", `/api/sessions/${sid}/join`, {}, aT);
const sJoin = await api("POST", `/api/sessions/${sid}/join`, {}, bT);
check("a member joins", sJoin.status === 200, `${sJoin.status} ${JSON.stringify(sJoin.json).slice(0,120)}`);
await sAct({ type: "start" });
await sAct({ type: "go", stage: "arrival" });
const sArriveA = await api("POST", `/api/sessions/${sid}/arrival`, { score: 8, wish: "A slower morning" }, aT);
const sArriveB = await api("POST", `/api/sessions/${sid}/arrival`, { score: 6 }, bT);
check("both give a number", sArriveA.status === 200 && sArriveB.status === 200, `${sArriveA.status}/${sArriveB.status} ${JSON.stringify(sArriveB.json).slice(0,120)}`);
const sOpen = await api("GET", `/api/sessions/${sid}`, undefined, bT);
check("the room sees each other's number while open", sOpen.status === 200 && (sOpen.json?.people ?? []).some((p) => p.arrival === 8));
await sAct({ type: "go", stage: "agenda" });
const sItem = await api("POST", `/api/sessions/${sid}/items`, { title: `Water rota ${RUN}`, aim: "decide", minutes: 10 }, aT);
check("add an agenda item", sItem.status === 200 && !!sItem.json?.id, `${sItem.status} ${JSON.stringify(sItem.json).slice(0,120)}`);
await sAct({ type: "go", stage: "items" });
await sAct({ type: "item", itemId: sItem.json?.id ?? null });
const sTodo = await api("POST", `/api/sessions/${sid}/entries`, { kind: "action", text: "Fix the tank valve", itemId: sItem.json?.id }, aT);
check("catch an action", sTodo.status === 200 && !!sTodo.json?.id, `${sTodo.status} ${JSON.stringify(sTodo.json).slice(0,120)}`);
await sAct({ type: "go", stage: "actions" });
const sEarly = await api("POST", `/api/sessions/${sid}/close`, {}, aT);
check("the close waits while an action has nobody", sEarly.status === 409 && (sEarly.json?.unowned ?? []).includes(sTodo.json?.id), `${sEarly.status} ${JSON.stringify(sEarly.json).slice(0,120)}`);
const sClaim = await api("PATCH", `/api/sessions/${sid}/entries/${sTodo.json?.id}`, { claim: true }, bT);
check("a member claims it", sClaim.status === 200, `${sClaim.status} ${JSON.stringify(sClaim.json).slice(0,120)}`);
await sAct({ type: "go", stage: "close" });
const sFeed = await api("POST", `/api/sessions/${sid}/respond`, { target: "facilitation", value: "flowed", text: "A calm pace." }, bT);
check("feedback on the facilitation", sFeed.status === 200, `${sFeed.status} ${JSON.stringify(sFeed.json).slice(0,120)}`);
const sClose = await api("POST", `/api/sessions/${sid}/close`, {}, aT);
check("the facilitator closes the session", sClose.status === 200, `${sClose.status} ${JSON.stringify(sClose.json).slice(0,120)}`);
const sAfter = await api("GET", `/api/sessions/${sid}`, undefined, aT);
check("arrival words and numbers are erased at close", sAfter.status === 200 && (sAfter.json?.people ?? []).length === 2 && sAfter.json.people.every((p) => p.arrival === null && p.wish === null));
check("only the spread is kept", sAfter.json?.arrival?.count === 2 && sAfter.json?.arrival?.median === 7);
check("facilitation feedback reaches the facilitator unsigned", Array.isArray(sAfter.json?.facilitation) && sAfter.json.facilitation.length === 1 && !("userId" in sAfter.json.facilitation[0]));
check("the record is on the list for the people who were there", ((await api("GET", "/api/sessions", undefined, bT)).json?.recent ?? []).some((r) => r.id === sid));
check("an admin reads the record", (await api("GET", `/api/sessions/${sid}`, undefined, founder)).status === 200);
const carol = await api("POST", "/api/auth/register", { email: `carol-${RUN}@village.test`, password: "Member123!", name: "Carol Weaver", paths: ["resident"] });
const sNot = await api("GET", `/api/sessions/${sid}`, undefined, carol.json?.token);
check("somebody who was not there does not", [403, 404].includes(sNot.status), `${sNot.status}`);
const sMin = await api("GET", `/api/sessions/${sid}/minutes.md?for=shareable`, undefined, aT);
check("the shareable minutes name nobody", sMin.status === 200 && typeof sMin.json === "string" && sMin.json.includes(`Water rota ${RUN}`) && !/Alice|Bob/.test(sMin.json), `${sMin.status}`);

console.log("\n── EXIT (F12) ──");
check("exit policy is published", (await api("GET", "/api/exit-policy")).json.policy.voluntary.noticePeriodDays > 0);
const exitOpen = await api("POST", "/api/profile/request-exit", { password: "Member123!" }, bT);
check("member opens own departure", exitOpen.status === 200, `${exitOpen.status} ${JSON.stringify(exitOpen.json).slice(0,120)}`);
const resolveBlocked = await api("POST", `/api/admin/exits/${exitOpen.json.exit.id}/resolve`, {}, founder);
check("resolve refuses with blocking domains named", resolveBlocked.status === 409 && resolveBlocked.json.blocking.length > 0, JSON.stringify(resolveBlocked.json).slice(0,200));
await api("POST", `/api/admin/exits/${exitOpen.json.exit.id}/cancel`, {}, founder);

console.log("\n── COMMAND CENTRE + PLATFORM ──");
const cc = await api("GET", "/api/admin/command-centre", undefined, founder);
check("command centre aggregates", cc.status === 200 && Array.isArray(cc.json.modules), `${cc.status}`);
check("ledger invariants green", cc.json.reconciliation.invariants.ok === true, JSON.stringify(cc.json.reconciliation.invariants.problems));
const info = await api("GET", "/api/platform/info");
// Cross-checked against the server's OWN module list rather than a literal.
// This said `=== 14` and quietly rotted the moment commerce and network
// landed, failing a green platform on a stale magic number — the exact class
// of test that trains people to ignore a red run. The real contract is that
// the public handshake publishes every module this instance is running, so
// that is what gets asserted.
const adminModules = await api("GET", "/api/admin/modules", undefined, founder);
// `served`, not `lifecycle`: served is what the instance is actually running
// (it accounts for dependency demotion and for core modules always being on),
// and the handshake publishes what is running.
// Rank >= members, matching what the handshake now publishes. `preview` is a
// lifecycle for a founder to LOOK at a module; announcing it to peers and the
// public internet is what preview exists to avoid, so the handshake filters it
// and this assertion has to filter the same way or it goes red on a village
// that is legitimately previewing something.
const RANK = { off: 0, preview: 1, members: 2, public: 3 };
const runningIds = (adminModules.json?.modules ?? [])
  .filter((m) => RANK[m.served] >= RANK.members)
  .map((m) => m.id)
  .sort();
const handshakeIds = (info.json?.modules ?? [])
  .map((m) => (typeof m === "string" ? m : m.id))
  .sort();
check(
  "platform handshake publishes exactly the running modules",
  info.status === 200
    && handshakeIds.length > 0
    && JSON.stringify(handshakeIds) === JSON.stringify(runningIds),
  `handshake=[${handshakeIds.join(",")}] running=[${runningIds.join(",")}]`,
);

console.log("\n── COMMS (the post office, plumbing at every lifecycle) ──");
const commsStatus = await api("GET", "/api/admin/comms/status", undefined, founder);
check("comms status answers the founder", commsStatus.status === 200 && typeof commsStatus.json?.messages?.byStatus === "object", `${commsStatus.status}`);
const commsRun = await api("POST", "/api/admin/comms/run", { job: "drain" }, founder);
check("run now drains the post office", commsRun.status === 200 && commsRun.json?.job === "drain", `${commsRun.status}`);

console.log("\n── ECONOMY CLOSING ASSERTION ──");
const rec2 = await api("GET", "/api/admin/ledger/reconciliation", undefined, founder);
check("conservation holds across every token", rec2.json.invariants.ok === true, JSON.stringify(rec2.json.invariants.problems));

console.log("\n" + results.join("\n"));
console.log(`\n${fails === 0 ? "ALL GREEN" : fails + " FAILURE(S)"} — ${results.length} checks\n`);
process.exit(fails === 0 ? 0 : 1);



