# Module contract: Crowdpool

Provenance: platform

> As-built, written with the code it describes (round 5, lane CP). Where this
> file and the code disagree, **the code wins**; fix the file.

**A bridge page, never a second ledger: the hub's public crowdpool campaign
data, proxied through the game server, cached, and told in the living map's
own language. The gold ring is the pledged pool, the walls are what has been
delivered, the star lantern counts toward the campaign's close, and every
claim links out to the hub page where the pledge itself happens. Nothing in
this module moves money, records a pledge, or holds a member's name.**

## Where the data comes from

The hub serves a public, no-auth tRPC API at `/api/trpc`. Five procedures are
read (measured live 2026-08-22). Four of them are the per-campaign bundle,
dialled in parallel; `campaigns.list` is the fifth and runs only for a key that
has never synced. This paragraph said FOUR and listed five from the day it
shipped, and so did `server/lib/crowdpool.ts:5`; both were corrected on
2026-09-04.

- `campaigns.list` (input `{}`), used once per key to resolve a slug to an id
- `campaigns.getById` (input `{id}`): one flat record with items, images,
  coverImage and contributorsCount embedded
- `campaigns.getItems` (input `{campaignId}`): the needs, each with the
  three-slot `quantityWanted` / `quantityClaimed` / `quantityDelivered` meter,
  a `kind` (item, role, shift, loan, knowledge, crypto, financial_link: seven,
  and the hub owns the enum, so read it and never assume it), and one of the hub's nine `capitalType` values
- `campaigns.getActivity` (input `{campaignId}`): the public Pool Ledger
- `campaigns.getPartnerLinks` (input `{campaignId}`): partner funders with the
  hub's own cached raised, percent and contributor count

The hub sends no CORS headers, so a browser cannot read any of this directly.
The game server proxies through `guardedFetchJson`, the same pinned,
range-checked dialer the feedback relay and the peer network use: https only,
private and loopback ranges refused, every redirect hop re-vetted.

`endsAt` is DERIVED as `startedAt + durationDays`; the hub stores no end
column. Campaign progress is `pledgedTotal / totalValue`; the delivered share
weights each need's delivered fraction by its estimated value, clamped at 1 per
need.

## Three hub-side defects, and what this side does about each

Measured by the Crowdpooling session against a scratch database of their own on
2026-09-04 and relayed to this lane. This side re-verified only its own half.
None of the three is fixable here, and all three change what this module may
honestly claim.

| Their defect | What it does to us | What we do |
|---|---|---|
| `pledgedTotal` is summed filtering on the ACCEPTED status alone, and delivered and thanked are later states of the same lifecycle | the ring shrinks when a village succeeds, and the drop is DEFERRED to the next unrelated acceptance, so it looks unrelated to the delivery that caused it | still divide by the hub's number, and NAME it as a floor everywhere a reader meets it. No correction is computed: a guess at the delivered value would be worse than an honest gap |
| the fulfil path is not idempotent, so two stewards at once put `quantityDelivered` at 2 where 1 was wanted (ten trials out of ten) | a need can arrive with more delivered than wanted | `percentDelivered` clamps each need's share at 1 so the walls cannot pass the ring; the meter draws against what is WANTED and says out loud that more arrived than were wanted; the campaign page stops filing such a need away as quietly met |
| a financial pledge is stored as a total and a financial SUBTOTAL, and three of the hub's own surfaces add the two, so a ten thousand pledge headlines as twenty thousand | nothing: we read them as separate fields and divide by the total alone | **our figure is right where their gallery is wrong.** `server/lib/crowdpoolPledgeNeverSums.test.ts` pins that to one spelling across the whole bridge, so a later lane cannot quietly "fix" ours to match theirs |

The first two are being fixed on the hub. When the first lands,
`HUB_PLEDGED_TOTAL_IS_A_FLOOR` in
`client/src/components/crowdpool/PoolPieces.tsx` is the one switch that turns
the floor language back off.

## Config shape

Module config (`module_settings`, edited from Admin -> The Game -> Crowdpool):

```json
{
  "villageCampaigns": [
    { "id": 79, "slug": "harmony-valley-ecovillage" },
    { "slug": "second-raising", "hubBaseUrl": "https://hub.example" }
  ]
}
```

- Each entry needs a numeric hub `id` or a lowercase `slug`; a slug without an
  id is resolved against `campaigns.list` by slugified title.
- `hubBaseUrl` is per-campaign and optional. The default comes from the
  `governance.hub_url` game variable, so a fork points the whole module at its
  own hub by changing one founder-held variable and no code.
- The list is a LIST on purpose: one village, several raisings. `/campaigns`
  renders one card per entry.

## Surfaces

- `GET /api/crowdpool/campaigns`: one summary per configured campaign.
- `GET /api/crowdpool/campaign?slug=<key>`: the full normalized campaign.
- `GET /api/admin/crowdpool/status` (admin): per-key `lastSyncAt`,
  `lastAttemptAt`, `lastError`. The smallest honest last-sync surface.
- Client pages `/campaigns` (the list) and `/campaign/:slug` (the bridge
  page), both behind `ModuleGate("crowdpool")`. All `/api/crowdpool` routes
  mount behind `requireModule("crowdpool")`; the module ships OFF like every
  non-core module.

## Privacy posture (ruled: aggregate-first)

- Backer COUNTS, capital coverage and per-need slot meters travel. Per-pledge
  amounts never do: the activity normalizer copies only an id, a folded verb
  (pledged, delivered, thanked), the need's label, a timestamp, and a public
  display name exactly as the hub's public feed gives it. A row with no public
  name travels as "A contributor". Amount, value and user id fields are never
  read off the row, and a test holds the wire clean of them.
- Capital types tint the needs tiles. The hub's nine-segment capital-stack
  widget is deliberately absent: the capitals framework is not part of the
  map's vocabulary.

## Degrade behavior (ruled: honestly)

Every successful fetch becomes the snapshot for its key (memory, persisted in
the `crowdpool-snapshots` app_config document so a reboot with the hub dark
still has its last morning's numbers). Cache TTL is 90 seconds. When the hub
stops answering, the snapshot is served with `stale: true` and its real
`lastSyncAt`, and the page names the age instead of pretending. A key that has
NEVER synced answers null and the page says the hub is out of reach. There is
no path that renders fake zeros.

Sync instrumentation: the `crowdpool-sync` scheduler job (10 min while the
module is on) refreshes every configured campaign and writes its summary into
the job ledger; the first tick lands about 15 seconds after boot and logs one
line. The admin status route above is the on-demand view.

## What is deliberately deferred

- **The map door.** The living map artifact (`docs/prototypes/grounds-v0.html`)
  is frozen under a landing train, so the funding structure on the map does
  not yet open `/campaign/:slug`. When the artifact unfreezes, the door is a
  route entry plus a pin on the funding structure; this page is built to be
  its destination.
- **Painted sprite art for the growth strip.** The blueprint -> wip -> painted
  strip ships as stylized SVG keyed to the delivered share. A painted sprite
  set is a follow-up, priced against the image budget when it exists.
- **The commitments module (D7).** Post-campaign pledge tracking, fulfillment
  fan-out into the library and quests, and by-email pledge linking are the v2
  path, designed in `docs/modules/crowdpool-dashboard.md`. This module is the
  read-only bridge that ships first; the commitments module would write, and
  writing waits for its own lane.
