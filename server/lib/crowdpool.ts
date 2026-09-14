/**
 * Crowdpool (R44/R45): the bridge between this village's game surface and the
 * hub's public crowdpool campaigns.
 *
 * The hub serves a public, no-auth tRPC API at `/api/trpc` with five reads
 * this module cares about, measured live on 2026-08-22. Four of them are the
 * per-campaign bundle `fetchCampaignBundle` dials in parallel; `campaigns.list`
 * is the fifth and runs only to resolve a slug that carries no id. This line
 * said FOUR and listed five from the day it shipped, in this file and in
 * `docs/modules/crowdpool.md` both, which is the count a reader integrating
 * against this module would take at face value:
 *
 *   campaigns.list            -> every published campaign (input: {})
 *   campaigns.getById         -> one flat campaign record with items, images,
 *                                coverImage, contributorsCount (input: {id})
 *   campaigns.getItems        -> the needs list (input: {campaignId})
 *   campaigns.getActivity     -> the public activity feed (input: {campaignId})
 *   campaigns.getPartnerLinks -> partner funders with cached raised/percent/
 *                                count (input: {campaignId})
 *
 * The hub sends no CORS headers, so a browser cannot read any of this
 * cross-origin. That is WHY this proxy exists: the game server dials the hub
 * through the same pinned, range-checked dialer every other outbound call
 * uses, normalizes the answer down to what the page may show, and caches it.
 *
 * Three postures, all ruled:
 *
 *   AGGREGATE-FIRST. The page gets counts, totals, per-need slot meters and a
 *   narration feed. Per-pledge amounts never leave this file: the activity
 *   normalizer strips every value field, and a contributor with no public
 *   name travels as the words "A contributor", exactly as the hub's own
 *   public feed would show them.
 *
 *   DEGRADE HONESTLY. Every fetch that succeeds becomes the snapshot for the
 *   key. When the hub stops answering, the snapshot is served with `stale:
 *   true` and its `lastSyncAt` intact, so the page can name the age of what
 *   it is showing. Never silent stale, never fake zeros: a key with no
 *   snapshot at all answers null and the route says so.
 *
 *   FORK-SAFE. The hub base URL is config: per-campaign `hubBaseUrl` first,
 *   falling back to the `governance.hub_url` game variable. No literal hub
 *   address appears anywhere in this module.
 *
 * No new tables. The cache is memory; the caller may persist snapshots into
 * an app_config document across reboots (snapshotExport/snapshotImport are
 * the seam). Deps are injected the same way agentInbox injects `post`, so the
 * tests dial a local fixture while production dials guardedFetchJson.
 *
 * ── TWO HUB-SIDE DEFECTS THIS FILE CANNOT FIX AND MUST NOT HIDE ─────────────
 *
 * Both were measured by the Crowdpooling session against a scratch database of
 * their own on 2026-09-04 and relayed here. This side re-verified only what is
 * verifiable from this side, which is what OUR code does with the answers.
 *
 * 1. `pledgedTotal` WAS A FLOOR UNTIL 2026-09-05, AND THE HUB FIXED IT. The
 *    hub summed a campaign's pledged value filtering on the ACCEPTED status
 *    alone, so the moment a steward confirmed a delivery that value left the
 *    number. Their measurement: accept ten thousand, deliver it, accept five
 *    thousand more, and the campaign reported five thousand where the honest
 *    figure was fifteen, the drop deferred to a later, unrelated acceptance.
 *    The hub's commit b835c28 counts accepted, fulfilled and thanked, confirmed
 *    live on their main with CI and the deploy green, and 7c83ef4 switched
 *    `HUB_PLEDGED_TOTAL_IS_A_FLOOR` in `client/src/components/crowdpool/PoolPieces.tsx`
 *    off. `percentPledged` below divides by the hub's number, as it always did,
 *    because inventing a correction here would be worse than an honest gap.
 *    This side reads no hub contract version, so a fork pointed at a hub older
 *    than b835c28 would show a floor as a total; that flag is the one switch.
 *
 * 2. THE THREE-SLOT METER CAN ARRIVE WITH DELIVERED ABOVE WANTED. Their fulfil
 *    path is not idempotent despite a comment claiming it is: two stewards at
 *    once put delivered on two instead of one, ten trials out of ten. It does
 *    not cross to us as a payout, because this file reads the meter and never
 *    the payoff. It does cross as a need whose `quantityDelivered` exceeds its
 *    `quantityWanted`. `percentDelivered` below already clamps each need's
 *    share at 1 so one over-delivered need cannot push the walls past the
 *    ring; the client makes the same state deliberate where it is drawn.
 *
 * ── AND THE ONE THAT IS THEIRS AND WRONG WHERE OURS IS RIGHT ────────────────
 *
 * A financial pledge is stored on the hub in TWO fields: `pledgedTotal`, the
 * campaign total, and `pledgedFinancial`, the financial subtotal INSIDE it.
 * Three of the hub's own surfaces add the two together, so a ten thousand
 * pledge reads as twenty thousand on their public gallery headline. This file
 * reads them as separate fields and divides using the total alone, so our
 * figure is right where their gallery is wrong. THE HAZARD IS THE OBVIOUS ONE:
 * a later lane compares our number to the hub's public page, sees a mismatch,
 * and "fixes" ours to match. `server/lib/crowdpoolPledgeNeverSums.test.ts`
 * pins the rule to one spelling across the whole bridge, server and client
 * both, and fails on any line that adds the two.
 */

export interface CrowdpoolCampaignRef {
  /** The hub's numeric campaign id. Optional when `slug` can resolve it. */
  id?: number;
  /** The page address for this campaign, and the lookup key against the
   *  hub's list when `id` is absent (matched on slugified title). */
  slug?: string;
  /** Per-campaign hub override. Absent means the deployment default. */
  hubBaseUrl?: string;
}

export interface CrowdpoolConfig {
  villageCampaigns: CrowdpoolCampaignRef[];
}

export interface CrowdpoolDeps {
  /** The outbound dialer. Production wires guardedFetchJson; tests dial a
   *  local fixture so the whole path moves real bytes. */
  fetchJson(url: string, timeoutMs: number): Promise<any>;
  now?(): number;
}

// ── The wire shapes the page reads ───────────────────────────────────────────

export interface CrowdpoolNeed {
  id: string;
  name: string;
  /**
   * The hub'''s need kind: item, role, shift, loan, knowledge, crypto,
   * financial_link. Seven, and the hub owns the enum.
   *
   * THIS COMMENT HAS BEEN WRONG TWICE AND THE SECOND TIME WAS MINE. It listed
   * six and called the set open; a lane then added `land` to make seven, and
   * `land` is not a kind at all. It belongs to a DIFFERENT enum on the same hub
   * table, `category`, which carries land, equipment, role and resource and is
   * the taxonomy that predates the needs registry. So the list was seven long
   * with two members wrong, which is exactly why the length looked right.
   *
   * The two enums got conflated here because `normalizeNeed` FALLS BACK from
   * kind to category, so this field really can hold a category value. See the
   * note there: the fallback is the reason the confusion was available to make.
   */
  kind: string;
  category: string;
  /** One of the hub's nine capitals. The page tints with it, never charts it. */
  capitalType: string;
  description: string | null;
  estimatedValue: number;
  pledgedValue: number;
  quantityWanted: number;
  quantityClaimed: number;
  /**
   * CAN EXCEED `quantityWanted`, and does. The hub's fulfil path is not
   * idempotent (defect 2 at the top of this file), so two stewards confirming
   * at once put this at two where one was wanted. Nothing here corrects it;
   * every consumer handles the state instead of assuming it away.
   */
  quantityDelivered: number;
  needDeadline: string | null;
  priorityPinned: boolean;
  groupClaimable: boolean;
}

export interface CrowdpoolPartner {
  partner: string;
  label: string;
  url: string;
  raised: number;
  contributorCount: number;
  percent: number;
  /** The hub's own cache stamp for these numbers, passed through so the page
   *  can say how old the partner figures are. */
  cachedAt: string | null;
}

export interface CrowdpoolEvent {
  id: string;
  /** pledged | delivered | thanked, folded from the hub's contribution
   *  lifecycle. Anything unrecognized passes through in lowercase. */
  type: string;
  /** A public display name from the hub's feed, or "A contributor". */
  who: string;
  item: string | null;
  at: string | null;
}

export interface CrowdpoolCampaign {
  id: number;
  slug: string;
  title: string;
  projectName: string | null;
  location: string | null;
  description: string | null;
  status: string;
  currency: string;
  totalValue: number;
  /**
   * The hub's campaign-wide pledged value: accepted, fulfilled and thanked
   * pledges, since the hub's b835c28 on 2026-09-05. It was a floor before that;
   * see item 1 at the top of this file.
   */
  pledgedTotal: number;
  financialTarget: number;
  /**
   * The financial SUBTOTAL inside `pledgedTotal`, carried separately and
   * never added to it. See the last block at the top of this file.
   */
  pledgedFinancial: number;
  /** pledgedTotal over totalValue, 0..100. The gold ring. */
  percentPledged: number;
  /** Value-weighted delivered share, 0..100. The walls under the ring. */
  percentDelivered: number;
  startedAt: string | null;
  /** DERIVED: startedAt + durationDays. The hub stores no end column. */
  endsAt: string | null;
  daysRemaining: number | null;
  contributorsCount: number;
  imageUrl: string | null;
  /** The hub's own campaign page, for every claim CTA. */
  hubUrl: string;
  isDemo: boolean;
  needs: CrowdpoolNeed[];
  partners: CrowdpoolPartner[];
  events: CrowdpoolEvent[];
}

// ── tRPC plumbing ────────────────────────────────────────────────────────────

/** A tRPC GET query URL: /api/trpc/<proc>?input={"json":<input>}. */
export function trpcQueryUrl(baseUrl: string, procedure: string, input: unknown): string {
  const base = String(baseUrl).replace(/\/+$/, "");
  return `${base}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
}

/** Unwrap the tRPC envelope. A missing result is an upstream shape change and
 *  throws rather than normalizing garbage. */
export function unwrapTrpc(payload: any): any {
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    throw new Error("hub answer is not a tRPC result envelope");
  }
  return payload?.result?.data?.json ?? null;
}

export function slugify(title: string): string {
  return String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** The key a campaign is cached and addressed under: declared slug first,
 *  then the numeric id as a string. A ref with neither is invalid config. */
export function campaignKey(ref: CrowdpoolCampaignRef): string {
  return (ref.slug ?? "").trim() || String(ref.id ?? "");
}

// ── Normalization ────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function needName(it: any): string {
  return String(
    it?.equipmentName ?? it?.roleTitle ?? it?.resourceName ?? it?.landDescription ?? "Unnamed need",
  ).slice(0, 160);
}

function needDescription(it: any): string | null {
  const d =
    it?.resourceDescription ?? it?.roleDescription ?? it?.equipmentDescription ?? it?.landDescription ?? null;
  return d ? String(d).slice(0, 600) : null;
}

export function normalizeNeed(it: any): CrowdpoolNeed {
  return {
    id: String(it?.id ?? ""),
    name: needName(it),
    /*
     * THE FALLBACK CROSSES TWO TAXONOMIES AND IS KEPT DELIBERATELY, NARROWLY.
     *
     * `kind` and `category` are different enums on the hub'''s table. When kind
     * is absent this writes a CATEGORY value into a kind field, so a need can
     * arrive labelled `land`, which no kind ever was. That is not a default, it
     * is a value from another vocabulary, and it is how this file'''s own comment
     * came to list one.
     *
     * Kept because the hub names kind in its stable set, so an absent kind means
     * a legacy row rather than a rename, and a legacy row with a category reads
     * better than one reading "item". Not widened: nothing downstream may treat
     * a kind as a member of a closed set.
     */
    kind: String(it?.kind ?? it?.category ?? "item").toLowerCase().slice(0, 32),
    category: String(it?.category ?? "").toLowerCase().slice(0, 32),
    capitalType: String(it?.capitalType ?? "material").toLowerCase().slice(0, 32),
    description: needDescription(it),
    estimatedValue: num(it?.estimatedValue),
    pledgedValue: num(it?.pledgedValue),
    quantityWanted: num(it?.quantityWanted),
    quantityClaimed: num(it?.quantityClaimed),
    quantityDelivered: num(it?.quantityDelivered),
    needDeadline: iso(it?.needDeadline),
    priorityPinned: Boolean(Number(it?.priorityPinned ?? 0)),
    groupClaimable: Boolean(Number(it?.groupClaimable ?? 0)),
  };
}

/**
 * The hub's contribution lifecycle is pending -> accepted -> fulfilled ->
 * thanked (plus rejected/withdrawn/expired, which its public feed does not
 * celebrate). The page narrates three verbs. Everything else passes through
 * lowercased so a future hub event kind degrades to an unstyled line rather
 * than a dropped one.
 */
export function foldEventType(raw: unknown): string {
  const t = String(raw ?? "").toLowerCase();
  if (["pledge", "pledged", "accepted", "claimed", "contribution"].includes(t)) return "pledged";
  if (["delivered", "fulfilled", "delivery"].includes(t)) return "delivered";
  if (["thanked", "thanks", "gratitude"].includes(t)) return "thanked";
  return t || "pledged";
}

/**
 * The activity feed, aggregate-first. What survives: an id to diff on, a
 * folded verb, a public display name (or "A contributor"), the need's label,
 * a timestamp. What is stripped, by never being read: every amount, value,
 * quantity and user id on the row. The live hub's seeded campaigns all
 * answer an empty feed today, so the field names here are defensive; the
 * privacy posture is not.
 */
export function normalizeEvents(rows: any): CrowdpoolEvent[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 60).map((r, i) => {
    const who =
      r?.contributorName ?? r?.displayName ?? r?.userName ?? r?.username ?? r?.name ?? null;
    const item = r?.itemName ?? r?.itemTitle ?? r?.item ?? null;
    return {
      id: String(r?.id ?? `row-${i}`),
      type: foldEventType(r?.type ?? r?.eventType ?? r?.status ?? r?.action),
      who: who ? String(who).slice(0, 80) : "A contributor",
      item: item ? String(item).slice(0, 160) : null,
      at: iso(r?.createdAt ?? r?.at ?? r?.timestamp),
    };
  });
}

export function normalizePartners(rows: any): CrowdpoolPartner[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 8).map((r) => ({
    partner: String(r?.partner ?? "").slice(0, 40),
    label: String(r?.label ?? r?.partner ?? "Partner").slice(0, 80),
    url: String(r?.url ?? "").slice(0, 400),
    raised: num(r?.cachedRaised ?? r?.raised),
    contributorCount: num(r?.cachedContributorCount ?? r?.contributorCount),
    percent: Math.min(100, Math.max(0, num(r?.cachedPercent ?? r?.percent))),
    cachedAt: iso(r?.lastFetchedAt),
  }));
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 100))) : 0;

/**
 * One campaign, assembled from the hub's four answers.
 *
 * `endsAt` is derived (startedAt + durationDays): the hub stores duration,
 * never an end column, and deriving it here means every consumer gets the
 * same clock. `percentDelivered` weights each need's delivered share by its
 * estimated value, so two hundred fence posts cannot outvote a well: the ring
 * is the pledged promise, this is how much of the promise became walls.
 *
 * TWO ARITHMETIC RULES HERE ARE LOAD-BEARING, both explained at the top of
 * this file:
 *
 *   `percentPledged` divides by `pledgedTotal` ALONE. `pledgedFinancial` is a
 *   subtotal inside it, and adding the two double-counts every financial
 *   pledge. Our figure is right where the hub's own gallery is wrong, so a
 *   later lane will meet a mismatch and be tempted to make ours match theirs.
 *   `server/lib/crowdpoolPledgeNeverSums.test.ts` refuses that edit by name.
 *
 *   the delivered share clamps each need at 1 (`Math.min` below). The hub's
 *   fulfil path is not idempotent, so a need can arrive with more delivered
 *   than were ever wanted; without the clamp one such need would push the
 *   walls past the ring, which is a state that cannot be true.
 */
export function normalizeCampaign(
  byId: any,
  items: any,
  activity: any,
  partnerLinks: any,
  opts: { baseUrl: string; slug?: string; now?: number },
): CrowdpoolCampaign {
  if (!byId || typeof byId !== "object") throw new Error("campaign not found on the hub");
  const started = iso(byId.startedAt);
  const durationDays = num(byId.durationDays);
  const endsAt =
    started && durationDays > 0
      ? new Date(new Date(started).getTime() + durationDays * 86_400_000).toISOString()
      : null;
  const now = opts.now ?? Date.now();
  const daysRemaining = endsAt
    ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 86_400_000))
    : null;

  const needs = (Array.isArray(items) && items.length ? items : byId.items ?? [])
    .map(normalizeNeed)
    .filter((n: CrowdpoolNeed) => n.id);

  const totalValue = num(byId.totalValue);
  // Delivered share, value-weighted. A need with no wanted count contributes
  // nothing rather than dividing by zero.
  let deliveredValue = 0;
  for (const n of needs) {
    if (n.quantityWanted > 0) {
      deliveredValue += n.estimatedValue * Math.min(1, n.quantityDelivered / n.quantityWanted);
    }
  }

  const cover = byId?.coverImage?.url ?? byId?.projectImageUrl ?? byId?.generatedImageUrl ?? null;
  const base = String(opts.baseUrl).replace(/\/+$/, "");

  return {
    id: num(byId.id),
    slug: (opts.slug ?? "").trim() || slugify(String(byId.title ?? byId.id)),
    title: String(byId.title ?? "Untitled campaign").slice(0, 200),
    projectName: byId.projectName ? String(byId.projectName).slice(0, 200) : null,
    location: byId.location ? String(byId.location).slice(0, 200) : null,
    description: byId.description ? String(byId.description).slice(0, 2000) : null,
    status: String(byId.status ?? "active").toLowerCase().slice(0, 24),
    currency: String(byId.currency ?? "USD").slice(0, 8),
    totalValue,
    pledgedTotal: num(byId.pledgedTotal),
    financialTarget: num(byId.financialTarget),
    pledgedFinancial: num(byId.pledgedFinancial),
    percentPledged: pct(num(byId.pledgedTotal), totalValue),
    percentDelivered: pct(Math.round(deliveredValue), totalValue),
    startedAt: started,
    endsAt,
    daysRemaining,
    contributorsCount: num(byId.contributorsCount),
    imageUrl: cover ? String(cover).slice(0, 500) : null,
    hubUrl: `${base}/campaigns/${num(byId.id)}`,
    isDemo: Boolean(Number(byId.isDemo ?? 0)),
    needs,
    partners: normalizePartners(partnerLinks),
    events: normalizeEvents(activity),
  };
}

// ── Fetching ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 12_000;

/**
 * Resolve a slug to the hub's numeric id via campaigns.list, matched on
 * slugified title. Resolutions are cached by the caller through the snapshot
 * itself (a snapshot's campaign carries its id), so this only runs for a key
 * that has never synced.
 */
export async function resolveCampaignId(
  deps: CrowdpoolDeps,
  baseUrl: string,
  slug: string,
): Promise<number | null> {
  const list = unwrapTrpc(await deps.fetchJson(trpcQueryUrl(baseUrl, "campaigns.list", {}), TIMEOUT_MS));
  if (!Array.isArray(list)) return null;
  const hit = list.find((c) => slugify(String(c?.title ?? "")) === slug);
  return hit ? num(hit.id) : null;
}

/** The four reads, in parallel. Throws on any envelope failure; the caller
 *  decides whether a snapshot stands in. */
export async function fetchCampaignBundle(
  deps: CrowdpoolDeps,
  baseUrl: string,
  id: number,
  slug?: string,
): Promise<CrowdpoolCampaign> {
  const [byId, items, activity, partners] = await Promise.all([
    deps.fetchJson(trpcQueryUrl(baseUrl, "campaigns.getById", { id }), TIMEOUT_MS),
    deps.fetchJson(trpcQueryUrl(baseUrl, "campaigns.getItems", { campaignId: id }), TIMEOUT_MS),
    deps.fetchJson(trpcQueryUrl(baseUrl, "campaigns.getActivity", { campaignId: id }), TIMEOUT_MS),
    deps.fetchJson(trpcQueryUrl(baseUrl, "campaigns.getPartnerLinks", { campaignId: id }), TIMEOUT_MS),
  ]);
  return normalizeCampaign(unwrapTrpc(byId), unwrapTrpc(items), unwrapTrpc(activity), unwrapTrpc(partners), {
    baseUrl,
    slug,
    now: deps.now?.(),
  });
}

// ── Cache and snapshots ──────────────────────────────────────────────────────

export interface CrowdpoolSnapshot {
  key: string;
  data: CrowdpoolCampaign;
  /** When the hub last ANSWERED, which is the only honest meaning of sync. */
  lastSyncAt: string;
}

export interface CrowdpoolServed {
  data: CrowdpoolCampaign;
  lastSyncAt: string;
  /** True when this answer is older than the TTL because the hub is not
   *  answering. The page names the age instead of pretending. */
  stale: boolean;
}

/** In-memory per-key state. Snapshots survive hub outages; `lastError` and
 *  `lastAttemptAt` are the admin's honesty line. */
interface KeyState {
  snapshot: CrowdpoolSnapshot | null;
  resolvedId: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  inflight: Promise<void> | null;
}

const states = new Map<string, KeyState>();

function stateFor(key: string): KeyState {
  let s = states.get(key);
  if (!s) {
    s = { snapshot: null, resolvedId: null, lastError: null, lastAttemptAt: null, inflight: null };
    states.set(key, s);
  }
  return s;
}

/** TTL inside the ruled 60-120s window. */
export const CROWDPOOL_TTL_MS = 90_000;

/**
 * Serve one campaign: fresh from cache inside the TTL, refetched past it,
 * snapshot with `stale: true` when the hub refuses, null when there has never
 * been an answer to show. Concurrent requests share one in-flight fetch, so a
 * page full of members cannot multiply into a hammering of the hub.
 */
export async function getCampaign(
  deps: CrowdpoolDeps,
  ref: CrowdpoolCampaignRef,
  defaultBaseUrl: string,
  opts?: { ttlMs?: number; force?: boolean },
): Promise<CrowdpoolServed | null> {
  const key = campaignKey(ref);
  if (!key) return null;
  const s = stateFor(key);
  const now = deps.now?.() ?? Date.now();
  const ttl = opts?.ttlMs ?? CROWDPOOL_TTL_MS;

  const fresh =
    s.snapshot && now - new Date(s.snapshot.lastSyncAt).getTime() < ttl && !opts?.force;
  if (!fresh) {
    if (!s.inflight) {
      s.inflight = (async () => {
        try {
          const base = String(ref.hubBaseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
          let id = ref.id ?? s.resolvedId ?? s.snapshot?.data.id ?? null;
          if (!id && ref.slug) id = await resolveCampaignId(deps, base, ref.slug);
          if (!id) throw new Error(`no campaign on the hub matches "${key}"`);
          s.resolvedId = id;
          const data = await fetchCampaignBundle(deps, base, id, ref.slug);
          s.snapshot = { key, data, lastSyncAt: new Date(deps.now?.() ?? Date.now()).toISOString() };
          s.lastError = null;
        } catch (e: any) {
          // The snapshot stays. A failed refresh is a log line and a stale
          // flag, never a page of zeros.
          s.lastError = String(e?.message ?? e).slice(0, 300);
        } finally {
          s.lastAttemptAt = new Date(deps.now?.() ?? Date.now()).toISOString();
          s.inflight = null;
        }
      })();
    }
    await s.inflight;
  }

  if (!s.snapshot) return null;
  const age = (deps.now?.() ?? Date.now()) - new Date(s.snapshot.lastSyncAt).getTime();
  return { data: s.snapshot.data, lastSyncAt: s.snapshot.lastSyncAt, stale: age >= ttl };
}

/** Refresh every configured campaign. The scheduler's sweep and the boot
 *  warm both land here; the summary string feeds the job ledger. */
export async function refreshAll(
  deps: CrowdpoolDeps,
  config: CrowdpoolConfig | null,
  defaultBaseUrl: string,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const ref of config?.villageCampaigns ?? []) {
    const served = await getCampaign(deps, ref, defaultBaseUrl, { force: true });
    if (served && !served.stale) ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}

/** The admin's honesty line, one row per configured key. */
export function crowdpoolStatus(): Array<{
  key: string;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}> {
  return Array.from(states.entries()).map(([key, s]) => ({
    key,
    lastSyncAt: s.snapshot?.lastSyncAt ?? null,
    lastAttemptAt: s.lastAttemptAt,
    lastError: s.lastError,
  }));
}

/** Snapshots out, for persistence into an app_config document. */
export function snapshotExport(): Record<string, CrowdpoolSnapshot> {
  const out: Record<string, CrowdpoolSnapshot> = {};
  for (const [key, s] of Array.from(states.entries())) if (s.snapshot) out[key] = s.snapshot;
  return out;
}

/** Snapshots back in at boot. Existing in-memory state wins: a reboot loads
 *  before any fetch, so this only ever fills empty keys. */
export function snapshotImport(doc: Record<string, CrowdpoolSnapshot> | null | undefined): number {
  let n = 0;
  for (const [key, snap] of Object.entries(doc ?? {})) {
    if (!snap || typeof snap !== "object" || !snap.data || !snap.lastSyncAt) continue;
    const s = stateFor(key);
    if (!s.snapshot) {
      s.snapshot = { key, data: snap.data, lastSyncAt: snap.lastSyncAt };
      n += 1;
    }
  }
  return n;
}

/** Tests only: a clean slate between cases. */
export function resetCrowdpoolCache(): void {
  states.clear();
}
