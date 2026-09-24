# Module design: redemption

Provenance: platform

> Registry id `redemption`. Routes in `server/routes/redemption.ts`; the decisions in
> `server/lib/redemption.ts`; the postings and the row in `server/lib/redemptionStore.ts`; every
> statement against the table in `server/repos/redemptions.ts`; the schema in
> `drizzle/0201_a_member_redeems_what_they_hold.sql`. The client surfaces are
> `client/src/components/RedemptionPanel.tsx` and `client/src/components/RedemptionQueue.tsx`, both
> on `client/src/pages/Wallet.tsx`.

**A member asks for tokens they hold to become something real off the platform. Asking holds the
tokens, a steward confirms once the village has paid, and only then are the tokens destroyed. A
refusal, a withdrawal or an expiry gives them back in full.**

## Status

Ships OFF (ruling 22, 2026-09-15), like every non-core module. It ran ungated for every village
before it had a registry entry, so `drizzle/0211_redemption_stays_on_where_it_was_used.sql` records
it at `members` for any village that already holds a row in `redemptions`, open or ended, and
leaves every other village at the default.

Funds-bearing: `legalReview` is set, so enabling shows the caution card and is refused while a
shared password is the only admin credential.

## The sequence

1. **Ask.** `POST /api/redemptions`. The amount arrives human and is converted once. The request is
   refused, before anything is held, when the token is not redeemable, the member has an exit open,
   the per-cycle count is spent, or the balance is short.
2. **Hold.** With `redemption.holds_on_propose` on, the tokens post from the member to
   `sys:redemption-hold` after the row commits.
3. **Decide.** A holder of `redemption.confirm` confirms (the tokens post on to `sys:redeemed`, a
   sink and never a faucet) or refuses (the hold is reversed). The member may withdraw their own
   request at any time before that. WHO decides is derived and not configured: a village where nobody
   holds the key sends the request to a village ballot instead (`confirmModeFor`), which is why
   `redemption.confirmed_by` was retired on 2026-09-15. The ballot path is built and its closer is
   registered; it stays refused at the door while `VOTE_PATH_BUILT` is false.
4. **Expire.** The `redemption-reap` job reverses any request older than
   `redemption.expires_after_days`. Zero means never.

Every ending is terminal. The state moves first as a compare-and-set, and only the caller whose
update changed the row posts.

## The module boundary

| Declared | Value |
|---|---|
| API prefixes | `/api/redemptions`, `/api/admin/redemptions` |
| Capability it adds | `redemption.confirm` |
| Variables | `redemption.holds_on_propose`, `redemption.tokens`, `redemption.per_member_per_cycle`, `redemption.expires_after_days`, and ruling 23's money dials: `redemption.currencies`, `redemption.rate_source`, `redemption.rate_per_token`, `redemption.fee_pct`, `redemption.fee_fixed`, `redemption.min_amount`, `redemption.max_per_request`, `redemption.max_per_member_per_cycle`, `redemption.max_village_per_cycle`, `redemption.process_text` |
| Open state | every row still `requested`, village-wide |

**Off means off, with two deliberate exceptions, both about value already held.**

- `POST /api/redemptions/:id/withdraw` is registered above the gate. It is the member's own refund
  door. `openStateCheck` refuses to switch the module off while a request is open, so this only
  matters when the module is served off with rows open anyway (a quarantine, or a hand-edited
  settings row). It answers the same whether the module is on or off, so it reveals nothing about
  the lifecycle.
- `expireRedemptions` runs with no lifecycle test, for the same reason.

While the module is off, `redemption.confirm` is not listed as a held power on the member's
profile (`visibleCapabilities` in `server/lib/progressionPayload.ts`), and the Admin panel hides the
five variables.

## What still reads redemption while the module is off

The exit desk (`server/lib/exit.ts`) blocks leaving while a member has a request open, and the
hold reconciliation and retired supply figures keep reading the ledger. None of these serve the
module; they are the village's books.

## Security review, 2026-09-15 (phases 2 and 3)

Mechanical checks first, all clean: no `dangerouslySetInnerHTML` on any surface that
renders village- or member-authored text; every statement added for the money dials
and the holder count is a parameterised query in `server/repos/`; every route is
behind `authedUser` or `guardCapability`; `check-auth-fetch`, `check-admin-reach`,
`check-save-honesty` and `check-upload-strip` pass. What follows is the judgement,
which is the part a guard cannot make.

### 1. A village vote publishes the member's request, permanently

**The exposure.** When nobody holds `redemption.confirm`, the request opens as a
ballot. A ballot is served to anyone with the link and it is kept after it closes,
so the member's own words for what they asked for (`askedFor`, clipped to 300
characters) and their identity as the ballot's opener become public and stay
public, including after the village votes no.

**Who can see it.** Anyone with the link. Ballot reads are not member-only.

**What the member sees before they submit**, in the panel, before the button:

> Nobody in this village holds the key that confirms a redemption, so this one goes
> to a village vote. A vote is public and it stays public: what you are asking for,
> and what you are asking for it in return, become readable by anyone with the link,
> permanently, including if the village says no. If you would rather it stayed
> between you and a steward, ask the village to give the redemption key to a role first.

**Can a member redeem privately in a village with no steward? No.** There is no
private path in that village. Every redemption goes to a public ballot until
somebody holds the key, and the member's only remedy is to ask the village to give
`redemption.confirm` to a role. This is a real consequence of the ruling rather
than an implementation choice: "if there isn't a steward the village can vote on
these things" makes the village the decider, and this village's decider is public.
It lands hardest on exactly the requests a member would most want kept quiet, which
is why the notice says it in those words and before the ask rather than after.

**Recommendation.** Ship as is, and put the choice in front of a founder: a village
that does not want members' requests public gives the redemption key to a role on
day one. Worth Rye's attention as a product question, not a code one: if he wants a
private fallback where no steward exists, that is a different ruling (an
admin-decides path, or a members-only ballot), and neither exists today.

### 2. The payload says whether the village has a key-holder

**The exposure.** `confirmedBy` in `GET /api/redemptions` is `steward` or `vote`,
and it is derived from whether anybody holds `redemption.confirm`. A member can
therefore tell that the village has given that power to nobody.

**Who can see it.** Any signed-in member, since the module serves at `members`.

**Recommendation.** Accept. The same fact is already public to members through the
powers surfaces, which list roles and the capabilities they carry, and the field is
what lets the panel warn a member before they ask. Hiding it would remove the
warning without removing the inference.

### 3. The member's redemption page reads prices once per token

**The exposure.** `GET /api/redemptions` resolves a rate for every redeemable
token, and each resolution reads the exchange's posted price and the daily rate
table. A village with several redeemable tokens pays several reads per page load.
Availability only: the reads are cheap indexed lookups, the route is authenticated,
and the ask itself is rate limited to thirty a day per member.

**Recommendation.** Fix when the route is next open: read the fx table once per
request and hand it to each resolution, which removes the repeated read without
changing any figure. Not done here because it is a performance change to a path
this lane had already frozen and tested, and it is not a correctness or an
authorisation defect.

### What a stranded hold looks like, and who finds it

The failed-actions report shows one, down ONE path and not in general, so it is
worth being exact about which. Governance's widening landed in #309: a redemption
decision that was vetoed inside its window or written off, whose give-back itself
then failed and recorded an error, appears on What's Failing with how it was
stopped. That is `failedReleases`, and it is the one case where a stopped
decision survives the report's usual rule of keeping only landings that are
`not_applicable`, `pending`, `applying` or `stalled`.

It deliberately leaves two neighbouring cases off, and the function's own
docblock says why. A scheduled landing that kept failing until it was written off
leaves an identical-looking row, an open attempt carrying an error on an
`expired` decision, but no give-back failed there; the note's own words tell the
two apart (`isReleaseFailure`), and it stays governance's record. An open attempt
carrying no error records no failure at all, so it stays off too.

So a hold can still be stranded with nothing on the tab. `unfinishedLandings`
shows one the tab does not, and this module's own `holdReconciliation`, which
compares `sys:redemption-hold` against the sum of open rows per token, is the one
that names the money.

## Tests

- `server/redemption.test.ts` and `server/stayRedeem.test.ts` drive the store against a real schema.
- `server/redemption.routes.e2e.test.ts` drives the doors against the built server, including the
  gate, the open-state refusal and the withdraw door.
- `server/redemptionModuleSeed.migration.test.ts` runs 0211 twice against seeded rows.
