/**
 * Crowdpool proxy tests.
 *
 * The fixture payloads are TRIMMED COPIES OF MEASURED HUB ANSWERS (live tRPC,
 * 2026-08-22): campaigns.getById is flat with items/coverImage/contributors
 * embedded, getItems/getActivity/getPartnerLinks key on `campaignId`, and the
 * envelope is {result:{data:{json:...}}}. If the hub changes shape, these are
 * the assertions that say so.
 *
 * The last block dials a REAL local HTTP fixture through an injected dialer:
 * URL building, query encoding, envelope unwrapping and normalization all
 * exercised over an actual socket, because a guard nobody's data exercises is
 * not a guard. Production swaps the injected dialer for guardedFetchJson,
 * which is https-only and range-checked; the seam is the same one agentInbox
 * uses for `post`.
 */
import http from "http";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CROWDPOOL_TTL_MS,
  HUB_CONTRACT_CROWDPOOL_FALLBACK,
  HUB_CONTRACT_GRACE_MS,
  campaignKey,
  crowdpoolStatus,
  fetchCampaignBundle,
  foldEventType,
  getCampaign,
  normalizeCampaign,
  normalizeEvents,
  readHubContract,
  resetCrowdpoolCache,
  resolveCampaignId,
  slugify,
  snapshotExport,
  snapshotImport,
  trpcQueryUrl,
  unwrapTrpc,
  type CrowdpoolDeps,
} from "./crowdpool";

// ── Fixtures: the measured shapes, trimmed ───────────────────────────────────

const HUB_BY_ID = {
  id: 79,
  status: "active",
  durationDays: 120,
  startedAt: "2026-06-07T13:30:07.000Z",
  title: "Harmony Valley Ecovillage",
  projectName: "Harmony Valley",
  location: "Cascadia",
  description: "A village raising its first hamlet.",
  financialTarget: 500000,
  currency: "USD",
  totalValue: 107400,
  pledgedTotal: 20700,
  pledgedFinancial: 8500,
  projectImageUrl: "https://assets.example.test/harmony.jpg",
  generatedImageUrl: "",
  isDemo: 1,
  coverImage: null,
  contributorsCount: 7,
  items: [],
};

const HUB_ITEMS = [
  {
    id: 79, campaignId: 79, category: "resource", kind: "item", capitalType: "material",
    resourceName: "Cedar fence posts", resourceDescription: "Posts for the north paddock line.",
    estimatedValue: 3000, pledgedValue: 1800,
    quantityWanted: 200, quantityClaimed: 120, quantityDelivered: 80,
    needDeadline: "2026-08-31T13:30:07.000Z", priorityPinned: 1, groupClaimable: 1,
  },
  {
    id: 86, campaignId: 79, category: "role", kind: "role", capitalType: "health",
    roleTitle: "Yoga Instructor", roleDescription: "Twice a week through the season.",
    estimatedValue: 7200, pledgedValue: 7200,
    quantityWanted: 1, quantityClaimed: 1, quantityDelivered: 0,
    needDeadline: null, priorityPinned: 0, groupClaimable: 0,
  },
  {
    id: 93, campaignId: 79, category: "resource", kind: "crypto", capitalType: "financial",
    resourceName: "Crypto contribution (USDC on Base)",
    estimatedValue: 25000, pledgedValue: 8500,
    quantityWanted: 25000, quantityClaimed: 8500, quantityDelivered: 3500,
    needDeadline: null, priorityPinned: 0, groupClaimable: 1,
  },
];

const HUB_ACTIVITY = [
  {
    id: 501, type: "accepted", contributorName: "Rowan", itemName: "Cedar fence posts",
    amount: 450, value: 450, userId: 31, createdAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: 502, status: "fulfilled", itemName: "Pond design consultation",
    amount: 800, userId: 44, createdAt: "2026-08-21T10:00:00.000Z",
  },
  { id: 503, type: "thanked", contributorName: "Sage", createdAt: "2026-08-21T11:00:00.000Z" },
];

const HUB_PARTNERS = [
  {
    id: 1, campaignId: 79, partner: "maearth", label: "Give through Ma Earth",
    url: "https://partners.example.test/harmony", cachedRaised: 52000,
    cachedContributorCount: 41, cachedPercent: 35, lastFetchedAt: "2026-07-17T17:30:12.000Z",
  },
];

const envelope = (json: unknown) => ({ result: { data: { json } } });

/**
 * What a tRPC hub with no such procedure answers: an error envelope, and HTTP
 * 404. This is the shape a hub older than 3c70b12c gives `meta.contract`.
 */
const NO_PROCEDURE = {
  error: {
    json: {
      message: 'No procedure found on path "meta.contract"',
      code: -32004,
      data: { code: "NOT_FOUND", httpStatus: 404, path: "meta.contract" },
    },
  },
};

/** The live hub's answer, as the coordinator read it on 2026-09-14. */
const HUB_CONTRACT_V2 = envelope({ crowdpool: 2 });

const NOW = new Date("2026-08-22T00:00:00.000Z").getTime();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A dialer over the fixtures, counting calls, failable on demand.
 *
 * `contract` is what `meta.contract` does: a payload to answer with, "throw"
 * for a dial that fails outright, or "hang" for one that never settles.
 * `delayMs` holds each of the four campaign reads, so a test can see whether
 * the contract read held the bundle.
 */
function fixtureDeps(overrides?: {
  failing?: boolean;
  nowRef?: { t: number };
  contract?: unknown;
  delayMs?: number;
}) {
  const calls: string[] = [];
  const nowRef = overrides?.nowRef ?? { t: NOW };
  const state = {
    failing: overrides?.failing ?? false,
    contract: "contract" in (overrides ?? {}) ? overrides!.contract : HUB_CONTRACT_V2,
  };
  const deps: CrowdpoolDeps = {
    now: () => nowRef.t,
    async fetchJson(url: string) {
      calls.push(url);
      if (state.failing) throw new Error("resolves to a private address");
      if (url.includes("meta.contract")) {
        if (state.contract === "throw") throw new Error("404");
        if (state.contract === "hang") return new Promise(() => {});
        return state.contract;
      }
      if (overrides?.delayMs) await sleep(overrides.delayMs);
      if (url.includes("campaigns.list")) {
        return envelope([
          { id: 79, title: "Harmony Valley Ecovillage", status: "active" },
          { id: 80, title: "Terra Nova Regenerative Farm", status: "active" },
        ]);
      }
      if (url.includes("campaigns.getById")) return envelope(HUB_BY_ID);
      if (url.includes("campaigns.getItems")) return envelope(HUB_ITEMS);
      if (url.includes("campaigns.getActivity")) return envelope(HUB_ACTIVITY);
      if (url.includes("campaigns.getPartnerLinks")) return envelope(HUB_PARTNERS);
      throw new Error(`unexpected url ${url}`);
    },
  };
  return { deps, calls, state, nowRef };
}

const BASE = "https://hub.example.test";

beforeEach(() => resetCrowdpoolCache());

// ── URL building and envelope ────────────────────────────────────────────────

describe("trpc plumbing", () => {
  it("builds the measured GET query shape", () => {
    const url = trpcQueryUrl(`${BASE}/`, "campaigns.getById", { id: 79 });
    expect(url).toBe(
      `${BASE}/api/trpc/campaigns.getById?input=${encodeURIComponent('{"json":{"id":79}}')}`,
    );
  });

  it("unwraps the result envelope and refuses anything else", () => {
    expect(unwrapTrpc(envelope([1, 2]))).toEqual([1, 2]);
    expect(unwrapTrpc(envelope(null))).toBeNull();
    expect(() => unwrapTrpc({ error: { json: {} } })).toThrow(/envelope/);
    expect(() => unwrapTrpc(undefined)).toThrow(/envelope/);
  });

  it("slugifies titles the way the list is matched", () => {
    expect(slugify("Harmony Valley Ecovillage")).toBe("harmony-valley-ecovillage");
    expect(slugify("  Terra  Nova!! ")).toBe("terra-nova");
  });

  it("keys a ref by slug first, then id", () => {
    expect(campaignKey({ slug: "harmony", id: 79 })).toBe("harmony");
    expect(campaignKey({ id: 79 })).toBe("79");
    expect(campaignKey({})).toBe("");
  });
});

// ── Normalization ────────────────────────────────────────────────────────────

describe("normalizeCampaign", () => {
  const normalized = normalizeCampaign(HUB_BY_ID, HUB_ITEMS, HUB_ACTIVITY, HUB_PARTNERS, {
    baseUrl: BASE,
    slug: "harmony-valley-ecovillage",
    now: NOW,
  });

  it("derives endsAt from startedAt + durationDays and counts the days left", () => {
    // 2026-06-07 + 120 days = 2026-10-05.
    expect(normalized.endsAt).toBe("2026-10-05T13:30:07.000Z");
    expect(normalized.daysRemaining).toBe(45);
  });

  it("computes the ring: pledgedTotal over totalValue", () => {
    expect(normalized.percentPledged).toBe(19); // 20700 / 107400
  });

  it("computes the walls: value-weighted delivered share, behind the ring", () => {
    // 3000*(80/200) + 7200*0 + 25000*(3500/25000) = 1200 + 3500 = 4700 -> 4%.
    expect(normalized.percentDelivered).toBe(4);
    expect(normalized.percentDelivered).toBeLessThan(normalized.percentPledged);
  });

  it("keeps the three-slot meter on every need", () => {
    const posts = normalized.needs.find((n) => n.name === "Cedar fence posts")!;
    expect(posts.quantityWanted).toBe(200);
    expect(posts.quantityClaimed).toBe(120);
    expect(posts.quantityDelivered).toBe(80);
    expect(posts.capitalType).toBe("material");
    expect(posts.priorityPinned).toBe(true);
  });

  it("links every claim back to the hub's own campaign page", () => {
    expect(normalized.hubUrl).toBe(`${BASE}/campaigns/79`);
  });

  it("passes partner cache stamps through", () => {
    expect(normalized.partners[0]).toMatchObject({
      partner: "maearth",
      raised: 52000,
      contributorCount: 41,
      percent: 35,
      cachedAt: "2026-07-17T17:30:12.000Z",
    });
  });

  it("survives a campaign with no totalValue without dividing by zero", () => {
    const bare = normalizeCampaign({ ...HUB_BY_ID, totalValue: 0, pledgedTotal: 0 }, [], [], [], {
      baseUrl: BASE, now: NOW,
    });
    expect(bare.percentPledged).toBe(0);
    expect(bare.percentDelivered).toBe(0);
  });

  it("refuses a null campaign instead of normalizing garbage", () => {
    expect(() => normalizeCampaign(null, [], [], [], { baseUrl: BASE })).toThrow(/not found/);
  });
});

describe("the activity feed is aggregate-first", () => {
  it("folds the hub lifecycle into the three narrated verbs", () => {
    expect(foldEventType("accepted")).toBe("pledged");
    expect(foldEventType("fulfilled")).toBe("delivered");
    expect(foldEventType("thanked")).toBe("thanked");
    expect(foldEventType("somethingnew")).toBe("somethingnew");
  });

  it("carries names only as the hub's public feed gives them", () => {
    const events = normalizeEvents(HUB_ACTIVITY);
    expect(events[0].who).toBe("Rowan");
    expect(events[1].who).toBe("A contributor"); // no public name on the row
  });

  it("strips every amount, value and user id from what travels", () => {
    const wire = JSON.stringify(normalizeEvents(HUB_ACTIVITY));
    expect(wire).not.toContain("450");
    expect(wire).not.toContain("800");
    expect(wire).not.toContain("amount");
    expect(wire).not.toContain("userId");
  });
});

// ── Cache, TTL, degrade ──────────────────────────────────────────────────────

describe("getCampaign: cache and honest degrade", () => {
  const REF = { slug: "harmony-valley-ecovillage", id: 79 };

  it("fetches once inside the TTL, again past it", async () => {
    const { deps, calls, nowRef } = fixtureDeps();
    await getCampaign(deps, REF, BASE);
    expect(calls.length).toBe(5); // the four procedures and meta.contract
    await getCampaign(deps, REF, BASE);
    expect(calls.length).toBe(5); // served from cache
    nowRef.t = NOW + CROWDPOOL_TTL_MS + 1000;
    await getCampaign(deps, REF, BASE);
    expect(calls.length).toBe(10);
    // Exactly one contract read per sync, never one per procedure.
    expect(calls.filter((u) => u.includes("meta.contract")).length).toBe(2);
  });

  it("serves the snapshot with its age named when the hub stops answering", async () => {
    const { deps, state, nowRef } = fixtureDeps();
    const first = await getCampaign(deps, REF, BASE);
    expect(first?.stale).toBe(false);
    const syncedAt = first!.lastSyncAt;

    state.failing = true;
    nowRef.t = NOW + CROWDPOOL_TTL_MS + 60_000;
    const served = await getCampaign(deps, REF, BASE);
    expect(served).not.toBeNull();
    expect(served!.stale).toBe(true);
    expect(served!.lastSyncAt).toBe(syncedAt); // the age is real, never re-stamped
    expect(served!.data.title).toBe("Harmony Valley Ecovillage");

    const status = crowdpoolStatus().find((s) => s.key === "harmony-valley-ecovillage");
    expect(status?.lastError).toContain("private address");
  });

  it("answers null when the hub has never answered, never zeros", async () => {
    const { deps, state } = fixtureDeps();
    state.failing = true;
    const served = await getCampaign(deps, REF, BASE);
    expect(served).toBeNull();
  });

  it("shares one in-flight fetch across concurrent requests", async () => {
    const { deps, calls } = fixtureDeps();
    await Promise.all([
      getCampaign(deps, REF, BASE),
      getCampaign(deps, REF, BASE),
      getCampaign(deps, REF, BASE),
    ]);
    expect(calls.length).toBe(5);
  });

  it("resolves a slug through campaigns.list when the ref carries no id", async () => {
    const { deps } = fixtureDeps();
    const id = await resolveCampaignId(deps, BASE, "terra-nova-regenerative-farm");
    expect(id).toBe(80);
    const served = await getCampaign(deps, { slug: "harmony-valley-ecovillage" }, BASE);
    expect(served?.data.id).toBe(79);
  });

  it("round-trips snapshots for reboot persistence, and memory wins", async () => {
    const { deps } = fixtureDeps();
    await getCampaign(deps, REF, BASE);
    const doc = snapshotExport();
    expect(Object.keys(doc)).toEqual(["harmony-valley-ecovillage"]);

    resetCrowdpoolCache();
    expect(snapshotImport(doc)).toBe(1);
    // No fetch has happened since the reset; the imported snapshot serves,
    // flagged stale because its stamp is old news by now.
    const { deps: coldDeps, state } = fixtureDeps({ nowRef: { t: NOW + 10 * 60_000 } });
    state.failing = true;
    const served = await getCampaign(coldDeps, REF, BASE);
    expect(served?.data.id).toBe(79);
    expect(served?.stale).toBe(true);
  });
});

// ── The hub contract version ─────────────────────────────────────────────────

/**
 * Rye's ruling of 2026-09-14, against hub commit 3c70b12c. The hub publishes
 * `meta.contract`, a map of integers with one per surface; its
 * docs/CROWDPOOL_HUB_CONTRACT.md section 10 says crowdpool 1 is a pledged total
 * of accepted pledges only, a floor, and crowdpool 2 counts fulfilled and
 * thanked too. The client words the figure off this number, so a wrong reading
 * here is a floor printed as a total.
 */
describe("the hub contract version rides on the campaign", () => {
  const REF = { slug: "harmony-valley-ecovillage", id: 79 };

  it("(a) a hub answering {crowdpool:2} serves hubContract.crowdpool === 2", async () => {
    const { deps, calls } = fixtureDeps({ contract: HUB_CONTRACT_V2 });
    const served = await getCampaign(deps, REF, BASE);
    expect(served?.data.hubContract).toEqual({ crowdpool: 2 });
    // Dialled with the input the hub accepts, `{"json":{}}`.
    expect(calls).toContain(trpcQueryUrl(BASE, "meta.contract", {}));
  });

  it("(b) a hub with no meta.contract still serves the campaign, at version 1", async () => {
    // The error envelope a tRPC hub answers for a procedure it does not have.
    const envelopeHub = fixtureDeps({ contract: NO_PROCEDURE });
    const one = await getCampaign(envelopeHub.deps, REF, BASE);
    expect(one?.stale).toBe(false);
    expect(one?.data.title).toBe("Harmony Valley Ecovillage");
    expect(one?.data.percentPledged).toBe(19);
    expect(one?.data.hubContract).toEqual({ crowdpool: 1 });

    // A dialer that throws on the 404 instead of handing back the body.
    resetCrowdpoolCache();
    const throwingHub = fixtureDeps({ contract: "throw" });
    const two = await getCampaign(throwingHub.deps, REF, BASE);
    expect(two?.stale).toBe(false);
    expect(two?.data.title).toBe("Harmony Valley Ecovillage");
    expect(two?.data.hubContract).toEqual({ crowdpool: 1 });
    expect(crowdpoolStatus().find((s) => s.key === REF.slug)?.lastError).toBeNull();
  });

  it("(c) a malformed answer reads as 1", () => {
    expect(HUB_CONTRACT_CROWDPOOL_FALLBACK).toBe(1);
    const malformed: Array<[string, unknown]> = [
      ["a string value", envelope({ crowdpool: "2" })],
      ["a negative value", envelope({ crowdpool: -2 })],
      ["zero", envelope({ crowdpool: 0 })],
      ["a fraction", envelope({ crowdpool: 2.5 })],
      ["a missing key", envelope({ feedback: 3 })],
      ["an empty map", envelope({})],
      ["a string answer", envelope("2")],
      ["a bare number", envelope(2)],
      ["an array", envelope([2])],
      ["a null answer", envelope(null)],
      ["no envelope", { crowdpool: 2 }],
      ["an error envelope", NO_PROCEDURE],
      ["nothing", undefined],
    ];
    for (const [what, payload] of malformed) {
      expect(readHubContract(payload), what).toEqual({ crowdpool: 1 });
    }
    // And a later version passes through as the number it is.
    expect(readHubContract(envelope({ crowdpool: 3, feedback: 1 }))).toEqual({ crowdpool: 3 });
  });

  it("(c) through the whole path: a malformed answer serves version 1", async () => {
    const { deps } = fixtureDeps({ contract: envelope({ crowdpool: "2" }) });
    const served = await getCampaign(deps, REF, BASE);
    expect(served?.data.hubContract).toEqual({ crowdpool: 1 });
  });

  it("(d) a contract fetch that throws does not fail or delay the bundle", async () => {
    // Each of the four campaign reads takes 40ms; the contract throws at once.
    const throwing = fixtureDeps({ contract: "throw", delayMs: 40 });
    const started = Date.now();
    const campaign = await fetchCampaignBundle(throwing.deps, BASE, 79, "harmony-valley-ecovillage");
    const elapsed = Date.now() - started;
    expect(campaign.title).toBe("Harmony Valley Ecovillage");
    expect(campaign.hubContract).toEqual({ crowdpool: 1 });
    // A settled failure spends none of the grace: the bundle is as quick as its
    // four reads.
    expect(elapsed).toBeLessThan(HUB_CONTRACT_GRACE_MS);
  });

  it("(d) a contract read that never answers holds the bundle no longer than the grace", async () => {
    const hanging = fixtureDeps({ contract: "hang", delayMs: 40 });
    const started = Date.now();
    const campaign = await fetchCampaignBundle(hanging.deps, BASE, 79);
    const elapsed = Date.now() - started;
    expect(campaign.hubContract).toEqual({ crowdpool: 1 });
    expect(elapsed).toBeLessThan(40 + HUB_CONTRACT_GRACE_MS + 400);
  });

  it("(d) the four reads still decide failure, whatever the contract did", async () => {
    const { deps, state } = fixtureDeps({ contract: HUB_CONTRACT_V2 });
    state.failing = true; // every dial refuses, the contract's included
    await expect(fetchCampaignBundle(deps, BASE, 79)).rejects.toThrow(/private address/);
  });

  it("a stale snapshot keeps the version it was fetched with", async () => {
    const { deps, state, nowRef } = fixtureDeps({ contract: HUB_CONTRACT_V2 });
    expect((await getCampaign(deps, REF, BASE))?.data.hubContract.crowdpool).toBe(2);
    state.failing = true;
    nowRef.t = NOW + CROWDPOOL_TTL_MS + 60_000;
    const served = await getCampaign(deps, REF, BASE);
    expect(served?.stale).toBe(true);
    expect(served?.data.hubContract).toEqual({ crowdpool: 2 });
    // And it persists with the snapshot.
    expect(snapshotExport()[REF.slug].data.hubContract).toEqual({ crowdpool: 2 });
  });

  it("a snapshot persisted before the field existed comes back as version 1", async () => {
    const { deps } = fixtureDeps();
    await getCampaign(deps, REF, BASE);
    const doc = snapshotExport();
    const { hubContract: _dropped, ...legacy } = doc[REF.slug].data;
    resetCrowdpoolCache();
    expect(snapshotImport({ [REF.slug]: { ...doc[REF.slug], data: legacy as any } })).toBe(1);
    expect(snapshotExport()[REF.slug].data.hubContract).toEqual({ crowdpool: 1 });
  });

  it("normalizeCampaign with no contract reading is version 1", () => {
    const bare = normalizeCampaign(HUB_BY_ID, HUB_ITEMS, [], [], { baseUrl: BASE, now: NOW });
    expect(bare.hubContract).toEqual({ crowdpool: 1 });
  });
});

// ── The local fixture dial: real bytes over a real socket ────────────────────

describe("fetchCampaignBundle against a live local fixture", () => {
  let server: http.Server;
  let origin = "";
  /** What the fixture hub does with `meta.contract`: answer 2, or 404 the way
   *  a hub older than the procedure does. */
  let contractMode: "v2" | "absent" = "v2";

  const start = () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const url = new URL(String(req.url), "http://127.0.0.1");
        const proc = url.pathname.replace("/api/trpc/", "");
        const input = JSON.parse(url.searchParams.get("input") ?? "{}").json ?? {};
        const answer = (json: unknown) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(envelope(json)));
        };
        if (proc === "meta.contract") {
          if (contractMode === "v2") return answer({ crowdpool: 2 });
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(NO_PROCEDURE));
        }
        if (proc === "campaigns.getById" && input.id === 79) return answer(HUB_BY_ID);
        if (proc === "campaigns.getItems" && input.campaignId === 79) return answer(HUB_ITEMS);
        if (proc === "campaigns.getActivity" && input.campaignId === 79) return answer(HUB_ACTIVITY);
        if (proc === "campaigns.getPartnerLinks" && input.campaignId === 79) return answer(HUB_PARTNERS);
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { json: { message: `bad input for ${proc}` } } }));
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        origin = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
        resolve();
      });
    });

  afterAll(() => new Promise<void>((r) => server?.close(() => r())));

  it("drives the whole path: query encoding, envelope, normalization", async () => {
    await start();
    // The injected dialer is a REAL network client here. Production injects
    // guardedFetchJson instead, which refuses this very address (loopback,
    // http) - that refusal is toolcheck's own tested behaviour.
    const deps: CrowdpoolDeps = {
      now: () => NOW,
      async fetchJson(url: string, timeoutMs: number) {
        const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); // module-review-ok: the fixture dialer under test; production injects guardedFetchJson
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      },
    };
    const campaign = await fetchCampaignBundle(deps, origin, 79, "harmony-valley-ecovillage");
    expect(campaign.title).toBe("Harmony Valley Ecovillage");
    expect(campaign.percentPledged).toBe(19);
    expect(campaign.needs.length).toBe(3);
    expect(campaign.partners[0].partner).toBe("maearth");
    expect(campaign.events[1].who).toBe("A contributor");
    // The contract read went over the same socket, with the input the hub takes.
    expect(campaign.hubContract).toEqual({ crowdpool: 2 });

    // (b) over a real socket: a hub that 404s meta.contract, read by a dialer
    // that throws on any non-2xx, still serves the whole campaign, at version 1.
    contractMode = "absent";
    const older = await fetchCampaignBundle(deps, origin, 79, "harmony-valley-ecovillage");
    expect(older.title).toBe("Harmony Valley Ecovillage");
    expect(older.percentPledged).toBe(19);
    expect(older.hubContract).toEqual({ crowdpool: 1 });
    contractMode = "v2";

    // The fixture 400s on a wrong input key, exactly like the live hub did
    // when getItems was asked with `id`: the guard proves the parameter
    // names, which is the mistake a fixture nobody dials would never catch.
    await expect(fetchCampaignBundle(deps, origin, 80)).rejects.toThrow();
  });
});
