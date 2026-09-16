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
   request at any time before that.
4. **Expire.** The `redemption-reap` job reverses any request older than
   `redemption.expires_after_days`. Zero means never.

Every ending is terminal. The state moves first as a compare-and-set, and only the caller whose
update changed the row posts.

## The module boundary

| Declared | Value |
|---|---|
| API prefixes | `/api/redemptions`, `/api/admin/redemptions` |
| Capability it adds | `redemption.confirm` |
| Variables | `redemption.confirmed_by`, `redemption.holds_on_propose`, `redemption.tokens`, `redemption.per_member_per_cycle`, `redemption.expires_after_days` |
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

## Tests

- `server/redemption.test.ts` and `server/stayRedeem.test.ts` drive the store against a real schema.
- `server/redemption.routes.e2e.test.ts` drives the doors against the built server, including the
  gate, the open-state refusal and the withdraw door.
- `server/redemptionModuleSeed.migration.test.ts` runs 0211 twice against seeded rows.
