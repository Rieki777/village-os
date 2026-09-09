# Module design: Token Registry + Ledger (keystone)

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**A runtime tokens registry plus one conservation-checked transfer ledger that every internal currency flows through — replacing the day-one MySQL enum with a registry FK BEFORE the next foundation session's JSON→MySQL ledger cutover freezes the wrong column shape into hundreds of forks.**

Estimated sessions: 5

## Design decisions, and why

- Split the deck's everything-on-chain model by governance: slide 33's library-item 'internal NFTs', slide 32's stay credits and slide 31's Gratitude Fund become rows in a fast, free, gas-less internal ledger, while anything share-like (slide 25 village shares, slide 26 restaurant ownership tokens) is structurally forced onto Hypha as read-only display + deep link. A villager borrowing a tent never touches a wallet.
- Made slide 26's 'buy a share of village businesses' impossible to recreate by accident: ownership/equity can never exist as a platform token (governance='hypha' rows have no mint path and zero ledger rows, enforced at write time and asserted at reconciliation), so a fork admin cannot create an unregistered security with a dropdown. The 2020 deck had no such guardrail.
- Made slide 37's 'new village tokens, limited only by imagination' actually operational: the deck had aspiration with no mechanism (each token would have been a chain deployment); here an admin creates a token at runtime as a registry row — no migration, no contract, OFF by default until enabled.
- Turned the deck's vague pools ('Gratitude Fund' slide 31, 'Library Pool' slide 33 notes) into first-class ledger accounts, so 'how much is in the library pool' and 'total Gratitude ever issued' are queries (the gratitude-pool account's negative balance IS lifetime issuance), not beliefs.
- Resolved a contradiction the 2020 deck never noticed: slide 31 describes a pool-share model ('clicking the heart gives a share of the Gratitude Fund') while the dashboard slides show instant claims — the two double-pay each other. Encoded pay-at-send XOR pool-release per token as a boot-time invariant with a pinned test, matching the foundation plan's highest-ranked collision.
- Replaced chain-given idempotency (the SEEDS/EOS assumption) with explicit >=160-char idempotency keys on every movement, so double-clicks, retried requests and re-run jobs credit exactly once off-chain.
- Hardened the wallet assumption: the deck trusted the light wallet; we bind wallets with a signed-message challenge, refuse to display equity against unverified bindings, and show nothing (null) on RPC failure instead of persisting a zero — because an equity balance beside a member's name must never be misstated.
- White-labeled slide 39's 'currency diversity': per-deployment registry rows with platform-seeded defaults mean hundreds of forks inherit the mechanics under their own names with zero platform-file edits, per the config-driven mandate.
- Every tunable the deck buried in speaker notes (the 120% credit premium, health tick rates, mint caps) becomes a fail-loud game variable with bounds, admin-editable, inherited by forks.

## Data model

**THE RESOLUTION OF THE ENUM TENSION** (argued first because it has a deadline): the foundation plan's requirement is not literally "an enum" — it is *"the ledger's shape must be right on day one because altering it live is the migration regen refused to do."* The enum only satisfies that if the token set is closed, and the deck proves it is open (library credits, stay credits, event tickets, per-project tokens, all admin-created at runtime). So the enum is the fossil, not the fix. What must be right on day one is the **column shape**: `token_id varchar(64) FK -> tokens.id`. That shape never changes again; new token types become rows, not ALTERs. It is *more* conservative than the enum: the enum bakes a business guess (exactly 3 tokens forever) into DDL, the FK bakes only "tokens have string ids" — the same discipline the repo already applies to user ids and stage ids. Day-one seeds are exactly the plan's three tokens, so day-one data matches the plan's enum verbatim; and the plan's real invariant ("platform only ever writes gratitude") gets STRONGER, because with the enum 'amora' is a valid ledger value that only app code declines, while with the registry the write path rejects any `governance='hypha'` token and reconciliation asserts zero such rows exist. **Deadline: this must land in/before the next foundation session (Phase 1b ledger cutover). `server/db/schema.ts` line 314 currently ships `tokenType: mysqlEnum(...)`; once live rows exist, the correction becomes an ALTER on the busiest table in the system, inherited by every fork.** Cost now: ~30 minutes.

### tokens (the registry)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | slug: `gratitude`, `library-credit`, `stay-credit`, `event-ticket-<slug>` |
| name | varchar(120) NOT NULL | "Library Credits" |
| symbol | varchar(32) | short display form |
| governance | enum('platform','hypha') NOT NULL | the ONE enum that is genuinely closed: value lives in our DB or on Hypha's chain, nowhere else. 'hypha' rows are display-only forever |
| kind | varchar(32) NOT NULL | 'recognition' \| 'credit' \| 'ticket' \| 'equity' \| 'voice' — varchar not enum (open set), validated fail-loud against a platform list in `shared/tokens.ts` |
| decimals | int NOT NULL default 0 | internal tokens are integer minor units; hypha tokens read `decimals()` from chain (plan trap: cap-table, not rounding) |
| transferable | boolean default false | peer-to-peer send allowed? |
| spendable | boolean default false | redeemable at sinks (stays, library)? |
| adminMintable | boolean default false | platform-governed only; server rejects true on governance='hypha' |
| expiresAfterDays | int NULL | tickets; sweep needs Phase 3 scheduler (v2) |
| chainId | int NULL | hypha only (Base = 8453) |
| contractAddress | varchar(42) NULL | hypha only; validated 0x-40-hex like gameVariables does |
| enabled | boolean default false | modules-toggleable rule: every token ships OFF |
| description | text; icon varchar(64); sortOrder int | |
| createdBy | varchar(64) FK users.id NULL | |
| createdAt / updatedAt | timestamp | |

Seeds (in `server/seeds/`, a village's values in seed data, never platform files): `gratitude` (platform, recognition, enabled), `amora` (hypha, equity, disabled until address set), `voice` (hypha, voice, disabled). Names read from registry rows; `GAME_CONFIG.currency` becomes the seed source, not the runtime lookup.

### ledger_accounts (pools are accounts, not columns)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | members: `user:<userId>`; system: `sys:<slug>` |
| kind | enum('member','system') NOT NULL | |
| userId | varchar(64) NULL, unique | FK users.id, NULL for system |
| slug | varchar(64) NULL, unique | `treasury`, `gratitude-pool`, `library-pool` |
| name | varchar(120) NOT NULL | |
| createdAt | timestamp | |

Seeded system accounts: `sys:treasury` (admin mints originate here), `sys:gratitude-pool` (the recognition faucet — its negative balance = lifetime Gratitude issued, a feature not a bug), `sys:library-pool` (slide 33's 20% premium destination, meaningful when the library module enables). Modules enabling later call `ensureSystemAccount('sys:<module>:<slug>')`.

### token_ledger (transfer rows — replaces the enum version in schema.ts)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| tokenId | varchar(64) NOT NULL FK tokens.id | **replaces `tokenType` enum** |
| fromAccountId | varchar(64) NOT NULL FK ledger_accounts.id | |
| toAccountId | varchar(64) NOT NULL FK ledger_accounts.id | |
| amount | bigint NOT NULL, CHECK > 0 | minor units per tokens.decimals; direction carries sign |
| source | varchar(64) NOT NULL | `quest_consent`, `gratitude_received`, `opening_balance`, `admin_mint`, `reversal`, later `library_purchase`, `stay_payment`, `ticket_purchase` |
| sourceRef | varchar(120) | claim id, gratitude_log id, etc. |
| description | varchar(500) | |
| idempotencyKey | varchar(191) NOT NULL UNIQUE | plan requires >=160; 191 is the safe utf8mb4 index width |
| reversesId | varchar(64) NULL FK token_ledger.id | corrections are reversal rows; append-only, never UPDATE/DELETE |
| createdBy | varchar(64) NULL | admin who triggered manual moves |
| at | timestamp defaultNow | |

Indexes: UNIQUE(idempotencyKey), (toAccountId, tokenId), (fromAccountId, tokenId), (tokenId, at).

### token_balances (cache — recompute, never increment)
| column | type | notes |
|---|---|---|
| accountId | varchar(64) FK | PK part 1 |
| tokenId | varchar(64) FK | PK part 2 |
| balance | bigint NOT NULL | always rewritten from SUM(in) − SUM(out); self-healing |
| computedAt | timestamp | |

`users.recognitionBalance` stays one release as a legacy mirror of `token_balances(user:<id>, gratitude)`, then drops.

### chain_balance_cache (Hypha tokens — display only, NEVER ledger rows)
| column | type | notes |
|---|---|---|
| userId | varchar(64) FK | PK part 1 |
| tokenId | varchar(64) FK | PK part 2; must be governance='hypha' |
| rawBalance | varchar(80) NULL | fixed-point string at chain decimals; **NULL on RPC failure, never zero** (plan trap) |
| fetchedAt | timestamp | |

Displayed only when `users.walletVerifiedAt` is set (signed-message proof of control; columns already exist). Plus `wallet_challenges` (userId PK, nonce varchar(64), expiresAt) for the EIP-191 verify flow.

## Endpoints

- `GET /api/tokens — enabled registry rows (public; UI reads names/symbols from here, not GAME_CONFIG)`
- `GET /api/game/balances — my platform-token balances (from token_balances) + hypha display balances (null-safe) in one payload`
- `GET /api/game/ledger?token=<id> — my own entries, newest first (exists today for gratitude; gains the token param and inSync cache check)`
- `POST /api/tokens/:id/transfer — peer transfer, only if tokens.transferable; body {toUserId, amount, message?, idempotencyKey} (v2; Gratitude keeps its dedicated send path)`
- `POST /api/admin/tokens — create a platform token (admin; governance='hypha' creation only via address config, never mintable)`
- `PUT /api/admin/tokens/:id — edit flags/copy; governance is immutable after creation; tokens with ledger rows can be disabled, never deleted`
- `POST /api/admin/tokens/:id/mint — {toUserId|toAccountSlug, amount, reason, idempotencyKey}; transfer sys:treasury -> target; rejected unless governance='platform' && adminMintable; capped by ledger.admin_mint_cap`
- `POST /api/admin/ledger/reverse — {entryId, reason} writes a mirrored reversal row with reversesId + idempotencyKey reversal:<entryId>`
- `GET /api/admin/ledger — filterable listing (token, account, source, date range), CSV export param`
- `GET /api/admin/ledger/reconciliation — the audit view: per-token totals, system-account balances, cache-vs-SUM drift per account, count of ledger rows on hypha tokens (must be 0), duplicate-key scan (JSON interim only), pay-at-send XOR release assertion status`
- `POST /api/wallet/challenge — issue nonce for the signing message (v2)`
- `POST /api/wallet/verify — verify EIP-191 signature, set users.walletVerifiedAt (v2)`

## Surfaces

**Admin** (Admin.tsx tab pattern): new **Tokens** tab (`AdminTokensTab.tsx`) — registry list with governance badge, enable toggle, create/edit form, mint form with reason + cap; hypha rows show address config + "Manage on Hypha" deep link to the deployment's configured DHO URL. New **Ledger** tab (`AdminLedgerTab.tsx`) — filterable entries, reversal action, "recompute caches" button, and `ReconciliationPanel.tsx` showing the invariant checks with red/green states. **Member**: `BalancesCard.tsx` in GameDashboard (platform tokens by name from the registry); profile "flows" view extends the existing /api/game/ledger UI with a token switcher; `EconomicsSection.tsx` (v2) with `HyphaBalanceCard.tsx` — verified-wallet balances or a "verify your wallet" prompt, never a zero on RPC failure — gated by the existing `tokens.show_economics_section` variable. **Mobile**: BalancesCard is already inside the dashboard flow; no new nav entry needed in v1. **Module posture**: the registry+ledger core is infrastructure (always on, like the DB — Gratitude already flows through the shipped JSON ledger); every *token* ships disabled, the economics section ships off, and downstream modules (exchange, stays, library, badges) each toggle independently and declare `dependsOn: ["token-registry"]`.

## Mechanics

**Write path (one function, `postTransfer()`)**: load token from registry (unknown id throws — fail-loud, same philosophy as gameVariables) → reject if governance='hypha' ("issued on Hypha and only read here", same message as the shipped guard) → reject if !enabled → check idempotencyKey: existing row returns {ok, duplicate:true} and credits nothing → INSERT transfer row + rewrite both accounts' token_balances from SUM, all in one MySQL transaction. Ports the two shipped disciplines verbatim from server/lib/ledger.ts: RECOMPUTE-NEVER-INCREMENT and EVERY-WRITE-CARRIES-A-KEY.

**Double-entry vs single-entry — chosen: transfer rows (directed double-entry: one row, two account columns).** Rationale: classic two-row debit/credit postings buy multi-leg journal entries, which nothing here needs (every movement has exactly two parties), at 2x rows and a torn-pair hazard. Pure single-entry (the shipped JSON shape: userId + signed amount) loses conservation — mints are indistinguishable from transfers and sums prove nothing. Transfer rows give conservation BY CONSTRUCTION: every unit comes from an account and goes to an account; issuance is visible as system-account negatives (sys:gratitude-pool balance = −lifetime issuance); per-token global sum is identically zero, so reconciliation checks caches and invariants instead of hunting leaks.

**Pay-at-send coexistence (the plan's highest-ranked hazard, encoded structurally)**: the ONE payment path for Gratitude is the send — `sys:gratitude-pool → user:<toId>` at POST /api/game/gratitude/send, key `gratitude_received:<entryId>` (unchanged from shipped code). Quest consent: `sys:gratitude-pool → user`, key `quest_consent:<claimId>` (unchanged). **Cycle close writes ZERO ledger rows** — gratitude_cycles + gratitude_distributions remain a settlement audit, exactly per Revision 3. Enforced twice: the close job has no ledger import, and a pinned test asserts COUNT(token_ledger) is unchanged across a close. If a fork later configures F2-style weighted-pool releases on a token, a startup assertion (F4 pattern) refuses to boot when the same token has both pay-at-send and releases — pay-at-send XOR pool-release, per token, forever.

**Migration (migrated_from_hearts flow)**: already half-shipped — `backfillOpeningBalances()` wrote one `opening_balance:<userId>` row per member from the heartsBalance→recognitionBalance rename. The MySQL cutover imports JSON ledger rows verbatim, mapping single-entry shape to transfers by source (positive credit → `sys:gratitude-pool → user`; opening balances → `sys:treasury → user`), **preserving every idempotencyKey unchanged** so the import is idempotent and re-runnable, and documenting that `opening_balance` IS the plan's `migrated_from_hearts` row. After import, `recognitionBalance` is verified equal to SUM per member (the shipped /api/game/ledger inSync check generalizes to all accounts).

**Hypha tokens**: never ledger rows; read-through chain_balance_cache with TTL; `decimals()` read from contract, fixed-point string storage, null-on-failure; displayed only against walletVerifiedAt bindings; every hypha token surface carries a deep link to the deployment-configured Hypha DHO URL. **Legal posture**: platform tokens are closed-loop, non-withdrawable, non-refundable-to-fiat credits — the registry has no fiat-exchange field at all and no sell-back endpoint exists; anything fiat-exchangeable is by definition Hypha's.

## Game variables

- ledger.admin_mint_cap: 10000 (0–1000000) — largest single admin mint; 0 disables manual minting entirely
- ledger.reconciliation_drift_alert: 0 (0–1000) — cache-vs-SUM drift tolerated before a Village Pulse alert fires; default zero because any drift is a bug
- tokens.default_ticket_expiry_days: 90 (1–730) — expiry applied to kind:'ticket' tokens that don't set their own (sweep runs on the Phase 3 scheduler, v2)
- tokens.chain_cache_ttl_minutes: 15 (1–1440) — how stale a Base balance may be before re-fetch; failures keep the old value or null, never zero
- (existing, referenced not redefined) gratitude.base_budget, gratitude.full_sends_per_cycle — the send-budget side; and the existing tokens.equity_address / tokens.voice_address / tokens.base_rpc_url variables become the seed values for the two hypha registry rows

## Admin controls

Tokens tab: create/edit/enable/disable platform tokens (create ships disabled; governance immutable after creation; delete forbidden once ledger rows exist — disable only); configure hypha token addresses (0x-validated) and the deployment's Hypha DHO URL; mint with mandatory reason, capped by ledger.admin_mint_cap, idempotency key generated per form render so double-submit is a no-op. Ledger tab: filter/search entries, reverse an entry with reason (append-only reversal row, never edit), recompute-all-caches button, CSV export. Reconciliation panel: per-token issuance totals, system account balances, per-account cache drift list, hypha-rows-must-be-zero check, XOR-invariant status — red/green with plain-language explanations. Server-side rejections mirror F4 style: adminMintable on hypha token, mint above cap, transfer of non-transferable token, and any write to a disabled or unknown token all fail loudly with named errors.

## Dependencies

- HARD DEADLINE DEPENDENCY: must merge into server/db/schema.ts before the Phase 1b ledger cutover session writes live MySQL rows with the tokenType enum (schema.ts:314) — after that it becomes the exact live-enum ALTER the plan forbids
- Phase 1b repository layer (the ledger repository is one of its first domains; this design IS that session's spec)
- server/lib/ledger.ts (shipped JSON ledger) — port its idempotency keys and recompute discipline verbatim; it remains the interim engine until cutover
- shared/gameVariables.ts + server/lib/variables.ts (exists) — new keys registered fail-loud
- shared/lunar.ts + gratitude cycles (shipped) — close job must remain ledger-free; add the pinned zero-rows test
- Admin.tsx tab pattern (exists) for the two new tabs
- server/seeds/ + ensureDataFiles() convention for any interim JSON seed (tokens registry should go straight to MySQL in the cutover session, so likely none needed)
- viem (new package, v2 only) for EIP-191 signature verification and ERC-20 balanceOf/decimals reads on Base
- Phase 3 scheduler (v2 only) for ticket-expiry sweeps and chain cache refresh — nothing in v1 needs a timer
- Resend email + notification spine (v2, optional) for 'you received X' notices

## v1 (ship first, useful alone)

Ship with/before the Phase 1b ledger cutover (2 sessions). Session A: tokens + ledger_accounts + token_ledger (varchar tokenId FK, NOT enum) + token_balances in schema.ts; seed the three plan tokens + three system accounts; JSON→MySQL import preserving every idempotencyKey; postTransfer() repository with hypha/enabled/duplicate guards; rewire quest consent and gratitude send through it; boot invariants (hypha-never-mints, pay-at-send XOR releases); pinned tests — loop e2e stays green, cycle close writes zero ledger rows, duplicate key credits once, per-token conservation sums to zero. Session B: GET /api/tokens, /api/game/balances, extended /api/game/ledger; Admin Tokens tab (list, enable, mint with cap) and Ledger tab with the reconciliation panel; BalancesCard reading names from the registry. Useful alone: the keystone exists, Gratitude runs on it in production, and the enum fossil never ships.

## v2 (the rest of the design)

The full slide vision (3 sessions): generic peer transfer endpoint for transferable tokens; ticket expiry sweeps + chain cache refresh on the Phase 3 scheduler; wallet challenge/verify (viem, EIP-191) + chain_balance_cache + EconomicsSection with verified-only hypha balances and DHO deep links (slides 25/35's read-side, minus the trading we deliberately push to Hypha); reversal UI, CSV export, notification hooks; module pool-account registration API so exchange/stays/library/badges (slides 26/32/33/38) each enable against the registry with their own tokens and pools — library-credit with the 120% premium flowing to sys:library-pool, stay-credit debits per night, event tickets with expiry.

## Risks

- TIMING: if the next foundation session builds the MySQL ledger with the enum before this lands, the correction becomes a live-table ALTER inherited by every fork — the exact migration the plan refuses; this is a this-week decision, not a someday one
- Legal: the ledger only records grants, but the moment any module sells credits/tickets FOR FIAT (stays, library, events), prepaid-instrument / gift-certificate / consumer-refund law applies (Costa Rica + purchaser jurisdictions) — expiry and non-refundability defaults especially NEED REAL LEGAL REVIEW before a fiat purchase path exists
- Runtime token creation lets an admin mint a junk economy; mitigations (disabled-by-default, mint caps, disable-not-delete, no fiat field) reduce but don't eliminate it — a fork can still run a bad game on purpose
- Negative system-account balances (the faucet pattern) will confuse admins reading raw numbers; the UI must label sys:gratitude-pool as 'issued to date' or someone will 'fix' it
- Import fidelity: rewriting or re-deriving idempotency keys during JSON→MySQL migration would silently enable double-credits on replay; keys must be copied byte-for-byte and the import verified by per-member SUM equality
- kind as validated varchar instead of enum trades DB-level enforcement for flexibility; the fail-loud shared validator must be the single write path or junk kinds leak in
- The XOR (pay-at-send vs pool-release) boot assertion only protects tokens it knows about; the F2 currencies[] work, if built later, must route through this registry rather than adding a parallel currency store — one registry, same one-ledger rule

## Open questions

- Should quest consent draw from sys:gratitude-pool (recognition faucet, current implicit behavior) or sys:treasury (making quest spend visibly budget-shaped)? Affects whether the treasury needs funding mechanics before the exchange module
- One shared 'credit' token vs one token per module (library-credit + stay-credit separately)? The registry supports both; the seeds need a per-village decision
- Slide 26's non-equity business tokens (restaurant discounts, loyalty): allowed as platform tokens created by admins, or does creating any third-party-business token require a proposal/decision first?
- Should Gratitude ever become transferable=true peer-to-peer generically, or stay locked to its dedicated budgeted send flow (current design: locked)?
- Confirm decimals=0 for all internal tokens at launch (no fractional credits) — bigint minor units make later precision possible but the UI is simpler if v1 is integer-only
- Does the F2 multi-currency 'releases' mechanism, if a village ever wires it, target a NEW platform token (compensation kind), or is compensation always Hypha-side? Determines whether the weighted-pool close job is ever built here at all
