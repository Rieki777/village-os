# Module design: Gratitude Feed ("Village Feed")

Provenance: platform

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**A feed-style lens over the Phase 4 forum (a config-designated "Village Life" category) interleaved with Village Pulse system events, where a heart click IS a real Gratitude send through the existing pay-at-send path — budget-bounded, cap-respecting, one ledger, no new content store.**

Estimated sessions: 5

## Design decisions, and why

- The original 'share of a named member's Gratitude Fund' concept was a pool model — exactly the pay-at-CLOSE design revision 3 bans. Redesigned: hearts pay at SEND from the sender's existing cycle budget through the one ledger; the already-shipped cycle settlement report remains the bridge founders carry to Hypha, where the actual fund (the village's equity and Voice tokens) is governed. No platform-held fund, no double-pay, no security created.
- Hearts cost real budget (feed.heart_amount, default 1), so they are scarce signal, not infinite likes. The slide's heart was free and therefore meaningless; ours is a micro-gift with gift semantics: idempotent (one per member per post, enforced by a unique key, not a flag) and irrevocable (no un-heart — reversing would mean clawing back moved value).
- One surface instead of four. The slide implied a standalone social product next to governance tools; here the feed is a read-model over forum threads + pulse events, so replies, @mentions, moderation, notifications, and even the decision primitive all live in ONE place. Deleting the feed module leaves zero orphaned content.
- Two-tier recognition instead of one: wall acknowledgments stay considered (sender-chosen amount, required message, cap 1/recipient/cycle) while hearts are micro-appreciations (fixed tiny amount, derived message quoting the post, separate per-recipient cap) — both draw from the SAME budget and land in the SAME gratitude_log, so hearts cannot bypass the giving cap or inflate supply.
- Event 'Get Tickets' becomes structured CTA deep-links (internal: /visit stay program, Work With Us; external: https ticket URL with visible domain) instead of an in-platform payment rail — avoids money-transmitter exposure. Closed-loop internal event-ticket credits are deferred to v2 behind explicit legal review.
- Hashtags become queryable structure (forum_thread_tags, filter chips) rather than decorative text.
- Announcement/event posting goes through the ONE GATE: a new feed.announce capability in shared/capabilities.ts, grantable by role or stage, instead of the slide's implicit admin-only.
- System activity interleaving (quest consents, stage advances, season turns, cycle closes — already emitted by addActivity) solves the cold-start problem: the feed is alive on day one even with three members. The 2020 slide showed only member content.
- No public amounts anywhere: heart COUNTS are shown, Gratitude amounts never are — consistent with F2's no-posted-price rule and F3's no-leaderboard rule. The slide happily displayed token transfers.
- Anti-spam and moderation designed in from the start (stage-gated posting via forum.post, daily post cap, report thresholds reusing forum moderation) — absent from the slide entirely.
- Every tunable is a fail-loud game variable with platform defaults, so a fork tunes heart economics, caps, and rate limits from Admin with no deploy.

## Data model

**Architectural resolution: OPTION 1 (feed rides on forum tables), absorbing option 2's best idea as a read-model merge.** Reasoning: (a) Option 3 (standalone posts table) creates the fourth content surface the one-surface principle forbids, and duplicates moderation/mentions/notifications. (b) Option 2 (upgraded Pulse) means putting user content with authors, images, and moderation into a capped-at-500 free-text system log — you would build a posts table anyway and pollute the system log's job. (c) The full forum is already a locked decision (revision 2, decision 4; build order step 9), so riding it costs only columns, not tables; hearts wire to the existing gratitude send; forum moderation, @mentions, replies, and the Phase 3 notification fan-out are all inherited free. The pulse is NOT upgraded — it is merged read-only into the feed response. Cost accepted: the feed ships after Phase 4, which is correct because it is not loop-critical.

### Extensions to Phase 4 forum tables (specify at forum design time so no ALTER later)

**forum_threads** (Phase 4 table — feed needs these columns present on day one)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| categoryId | varchar(64) NOT NULL | feed = threads where category slug == var feed.category_slug |
| authorId | varchar(64) NOT NULL | FK users.id (varchar(64) per house rule) |
| title | varchar(255) NULL | NULL for microposts (kind='post'); derived preview used in lists |
| body | text NOT NULL | micropost length ≤ var feed.max_post_length |
| kind | enum('discussion','decision','post','event','announcement') NOT NULL DEFAULT 'discussion' | decision primitive already needs this enum; feed adds post/event/announcement |
| meta | json NULL | event fields: { startsAt, endsAt?, location?, ctaLabel?, ctaUrl?, ctaKind: 'internal'\|'external' } |
| imageUrl | varchar(500) NULL | must point at /api/uploads/… from own upload |
| heartCount | int NOT NULL DEFAULT 0 | denormalized cache, maintained in the same transaction as the ledger credit (recomputable from gratitude_log) |
| replyCount / lastReplyAt | int / timestamp | already planned in Phase 4 |
| pinnedAt | timestamp NULL | v2 |
| hiddenAt / hiddenBy / hiddenReason | timestamp NULL / varchar(64) / varchar(255) | moderation, shared with forum |
| createdAt | timestamp NOT NULL DEFAULT now() | |

**forum_thread_tags** (new, tiny)
| column | type | notes |
|---|---|---|
| threadId | varchar(64) | FK forum_threads.id |
| tag | varchar(64) | lowercased, extracted server-side, max 5/post |
| | | PK (threadId, tag); INDEX (tag) |

**gratitude_log** (existing table — additive columns during the gratitude domain cutover)
| column | type | notes |
|---|---|---|
| kind | enum('acknowledgment','heart') NOT NULL DEFAULT 'acknowledgment' | existing rows backfill to 'acknowledgment' |
| contextType | varchar(32) NULL | 'post' for hearts |
| contextRef | varchar(64) NULL | thread id |
| | | UNIQUE (from_id, context_ref, kind) — one heart per member per post (MySQL permits multiple NULLs, so wall sends are unaffected); INDEX (context_ref, kind) for heart counts; existing (from_id, to_id, cycle_id) queries serve both caps |

**activity** (existing — additive, nullable, so it stays a faithful shadow)
| column | type | notes |
|---|---|---|
| actorId | varchar(64) NULL | lets system cards link to a profile |
| entityType / entityRef | varchar(32) NULL / varchar(64) NULL | lets 'quest consented' cards link to the quest |

**forum_reports** (Phase 4 table, reused verbatim — no feed-specific moderation tables)
id varchar(64) PK, threadId varchar(64), replyId varchar(64) NULL, reporterId varchar(64), severity enum('soft','hard'), reason varchar(500), status enum('open','resolved','dismissed'), resolvedBy varchar(64) NULL, resolvedAt, createdAt. UNIQUE (threadId, replyId, reporterId).

**No hearts table, no feed_posts table, no second balance column anywhere.** Heart truth lives in gratitude_log + token_ledger; heartCount is a recomputable cache. If any part is built before the MySQL cutover completes (unlikely — feed follows Phase 4 which follows cutover), new JSON files need seeds in server/seeds/ + ensureDataFiles() entries per the standing rule.

## Endpoints

- `GET /api/feed?before=<ISO cursor>&tag=<tag>&kind=<post|event|system> — merged stream: forum threads in the feed category (not hidden) + activity rows (types quest/stage/season/cycle/join; 'gratitude' type excluded to avoid echoing hearts), sorted desc, 20/page; each item tagged itemType and, for signed-in users, heartedByMe`
- `POST /api/feed/posts — create micropost {body, imageUrl?} (capability forum.post; daily cap var feed.max_posts_per_day; length var feed.max_post_length; server extracts #tags) or event/announcement {kind, title, body, meta} (capability feed.announce or admin; meta validated: startsAt ISO, ctaUrl https or internal route)`
- `POST /api/feed/posts/:id/heart — the heart-as-gratitude-send; idempotent; returns {hearted, heartCount, budget}; NO un-heart endpoint by design`
- `POST /api/feed/posts/:id/report — {severity: 'soft'|'hard', reason} into forum_reports; soft auto-hides at var feed.report_hide_threshold distinct reporters; hard goes straight to the admin queue`
- `POST /api/feed/upload — one image, multer + sharp compress reusing the existing brand-image pipeline (memory storage, JPG/PNG/WebP/AVIF, existing 10/hr/IP rateLimited key), served by existing GET /api/uploads/:filename`
- `GET /api/forum/threads/:id — (Phase 4) card tap-through: full thread + replies; replies use Phase 4's POST /api/forum/threads/:id/replies — the feed adds no reply endpoints of its own`
- `GET /api/admin/feed/reports — open reports queue (admin)`
- `POST /api/admin/feed/posts/:id/hide and /restore — moderation actions, shared implementation with forum moderation (admin or forum.moderate capability)`
- `POST /api/admin/feed/announce — admin composer for event/announcement cards (same validation as member path, skips capability check)`

## Surfaces

**Pages/routes** (module OFF by default; contributes nav + routes + admin tab only when enabled):
- `client/src/pages/VillageFeed.tsx` at `/feed` — nav label config-driven (default: "Village Feed"); infinite scroll; filter chips: All / Posts / Events / Gratitude(v2) / per-tag; composer pinned top for members.
- Components: `FeedComposer.tsx` (textarea + char counter, image attach via /api/feed/upload, live #tag highlight; event-fields toggle appears only when the user holds feed.announce), `FeedPostCard.tsx` (avatar, first name, timeAgo, linkified #tags, optional image, HeartButton, reply count → opens forum thread view), `FeedEventCard.tsx` (banner variant: date/location line, CTA button — internal wouter Link or external https anchor with visible domain), `FeedSystemCard.tsx` (muted style; reuses VillagePulse's TYPE_ICON map), `HeartButton.tsx` (optimistic; tooltip "Sends N {currency.nameLower} from your cycle budget"; disabled states: own post, already hearted, budget 0 → "your giving budget unlocks as you progress", per-recipient cap reached).
- `client/src/pages/Home.tsx`: existing VillagePulse section gains a "See the Village Feed →" link when the module is on (pulse component itself untouched).
- Mobile: entry added to `client/src/config/mobileNav.ts` (config-driven per Phase 2 pattern).
- Admin: `FeedAdminTab` in `client/src/pages/Admin.tsx` following the existing *Tab function pattern — reports queue, hide/restore, announcement composer, this-cycle heart stats, deep link to Game Mechanics variables.
- All copy through GAME_CONFIG/mergedConfig (currency.name etc.) — zero village-specific strings in platform files.

## Mechanics

**Heart = gratitude send, one payment path.** During Phase 1b the existing POST /api/game/gratitude/send body is refactored into a shared `sendGratitude()` service in the gratitude repository; both the wall route and the heart route call it. Heart flow:
1. Auth → user; load thread (kind post/event, not hidden); reject self-heart (mirrors "Gratitude flows to others").
2. Idempotency pre-check: existing gratitude_log row (fromId=user, contextRef=threadId, kind='heart') → 200 {hearted:true} no-op (unique key is the enforcement, this is the fast path).
3. amount = var('feed.heart_amount'). Budget check via existing gratitudeBudget(user): total ≤ 0 → 403 progression message (visitor multiplier 0 naturally gates visitors out — hearts become a progression incentive); amount > remaining → 400. **Hearts and wall sends draw one budget, so total giving per cycle stays bounded — no inflation, no cap bypass.**
4. Per-recipient heart cap: count(kind='heart', fromId=user, toId=author, cycleId=current) ≥ var('feed.max_hearts_per_recipient_per_cycle') → 409. Then the per-recipient ceiling (R73): sum(amount, fromId=user, toId=author, cycleId=current) over ALL kinds, plus amount, above the sender's own allowance divided by var('gratitude.full_sends_per_cycle') → 409. One count cap and one ceiling, one budget, both enforced in gratitude_log. The ceiling is deliberately kind-blind, which is what stops either channel laundering the other.
5. Write gratitude_log entry {kind:'heart', contextType:'post', contextRef:threadId, message: derived snippet `for your post: "…first 80 chars…"`, cycleId} — the post itself is the context, satisfying the spirit of require_message without a modal.
6. creditTokens(ledger, {userId: author, amount, source:'gratitude_received', sourceRef: entry.id, idempotencyKey:`gratitude_received:${entry.id}`}) — identical source/key scheme as the wall send; recipient's recognitionBalance set to the RECOMPUTED balance (never +=).
7. Same transaction (post-cutover): forum_threads.heartCount recomputed from gratitude_log count.
8. Notification (once Phase 3 lands): dedupeKeyed heart milestones at 1/5/10/25 per post (regen's caps rule). No addActivity per heart — heart counts on cards carry the signal; the activity log stays low-noise.

**Composer:** capability forum.post (stage 'member' OR role — existing gate, and the real spam gate); posts-today < var; hashtags extracted server-side with /#([\p{L}0-9_-]{2,32})/gu, lowercased, first 5 stored; imageUrl must match own recent upload under /api/uploads/. **Event/announcement posting:** capability feed.announce (new key added to the Capability union in shared/capabilities.ts, granted via roles-as-data or admin; no stage unlock by default) — extends the ONE GATE, never bypasses it.

**Moderation (fully inherited from forum):** soft reports auto-hide at threshold pending review; hard reports queue immediately; hide sets hiddenAt (card disappears from feed, thread 410s for non-admins). Gratitude already sent to a later-hidden post is NOT clawed back automatically (value moved at send); admin correction = explicit negative ledger entry, logged.

**Interleaving:** server-side merge of two ordered sources with an ISO-timestamp cursor; system items are read-only cards; toggle var feed.show_system_events. Nothing runs on a timer — no scheduler dependency anywhere in this module.

**Hypha boundary:** the feed touches only platform-governed Gratitude. The "Gratitude Fund" of the slide is realized as: cycle settlement report (already shipped at /api/game/cycle/distributions) → founders carry to the village's configured Hypha DHO URL → equity and Voice distributed there. The feed's only Hypha surface is an optional deep-link card at cycle close ("this cycle's settlement is ready — view on Hypha").

## Game variables

- feed.heart_amount: 1 (1–100, unit: Gratitude) — how much a heart click sends from the sender's cycle budget; the giver never types a number
- feed.max_hearts_per_recipient_per_cycle: 3 (1–100) — heart-channel cap per recipient, counting TAPS; how much Gratitude reaches one person is bounded by gratitude.full_sends_per_cycle, which counts hearts and wall acknowledgments together
- feed.max_posts_per_day: 5 (1–50) — per-member micropost rate limit
- feed.max_post_length: 500 (100–5000, unit: characters) — micropost body ceiling
- feed.report_hide_threshold: 3 (1–20) — distinct soft reports before a post auto-hides pending admin review
- feed.allow_images: true (boolean) — turn image attachments off entirely for a text-only village
- feed.category_slug: "village-life" (text) — which forum category renders as the feed; forks rename freely, categories seed from config not migrations
- feed.show_system_events: true (boolean) — interleave pulse events (quest consents, stage advances, season turns, cycle closes) in the stream
- feed.hearts_on_wall: false (boolean) — whether kind='heart' entries also render on the Gratitude Wall (default off keeps the wall a considered space)
- feed.event_posting: "role" (choice: role|admin) — whether feed.announce capability holders may post events, or admin only

## Admin controls

FeedAdminTab in Admin.tsx (existing tab pattern): open-reports queue with severity badges and one-click hide/restore/dismiss; announcement/event composer (kind, title, body, event meta, CTA target picker offering internal routes /visit, /work-with-us, /quests or an external https URL); this-cycle heart stats (hearts sent, distinct senders, top-hearted posts — counts only, never Gratitude totals, per F3); module on/off toggle (feed ships OFF; enabling requires the forum module and surfaces nav + routes + admin tab). All ten feed.* variables edit through the existing Admin > Game Mechanics variables UI (fail-loud registry, only changed values stored so forks inherit platform defaults). Corrections: explicit admin negative-ledger adjustment (existing ledger tooling), never a silent balance edit. Capability grants: feed.announce assigned through the existing roles-as-data admin.

## Dependencies

- HARD: Phase 4 forum tables + moderation + thread/reply endpoints (the feed is a lens over them) — feed is 'Phase 4.5' in the build order
- HARD: Phase 1b gratitude domain cutover, refactoring the send route into a shared sendGratitude() repository service both wall and heart call
- Existing token ledger (server/lib/ledger.ts creditTokens + idempotency keys) — unchanged
- Existing gratitudeBudget(), lunar cycles (shared/lunar.ts), cycle settlement (untouched: close still credits nobody)
- shared/capabilities.ts — add feed.announce to the Capability union (ONE GATE extension)
- shared/gameVariables.ts + server/lib/variables.ts — ten new feed.* definitions (fail-loud)
- Existing multer + sharp upload pipeline and /api/uploads/:filename serving; existing rateLimited() helper (in-memory caveat documented)
- SOFT: Phase 3 notification spine — heart/mention/reply notifications attach when it lands; feed functions without it
- Existing addActivity() + activity table (additive nullable actor/entity columns)
- Admin.tsx tab pattern; client/src/config/mobileNav.ts for the mobile entry
- NOT needed: scheduler (nothing mutates on a timer), Maia changes (v2 only), any Hypha write path (read/deep-link only)

## v1 (ship first, useful alone)

Ships first, useful alone (3 sessions, sequenced immediately after Phase 4 forum lands): (S1) Server — forum_threads kind/meta/imageUrl/heartCount columns specified into the Phase 4 schema, forum_thread_tags, gratitude_log kind/context columns + unique heart index, ten feed.* variables, feed.announce capability, endpoints (merged GET /api/feed, POST posts, heart, report reuse, upload), plus tests: heart idempotency under double-fire, both caps enforced from one budget, hidden-post heart rejection, and a regression asserting the heart path writes through sendGratitude()/creditTokens with no second payment path. (S2) Client — VillageFeed page, FeedComposer, FeedPostCard/FeedSystemCard, HeartButton with all disabled states, nav + mobileNav config entries, module toggle. (S3) Events/announcements — event kind + meta validation, FeedEventCard with CTA deep-links, FeedAdminTab (reports queue, announce composer, heart stats), Home cross-link. v1 delivers the whole feed experience except ticket payments: microposts with hashtags and images, hearts that genuinely pay people, event cards with Get-Tickets CTAs (linking out), system life interleaved.

## v2 (the rest of the design)

The full slide vision plus what 2026 knows better (2 sessions): tag filter pages + trending tags; pinned posts (pinnedAt); Gratitude filter chip rendering wall entries as feed cards (wall page kept as an alias — begins gently unifying the two gratitude surfaces); Maia integration as a new PROPOSAL_KINDS entry "event-post" helping role holders draft announcements through the existing injection-guarded /api/assistant/proposal plumbing; Phase 3 notification wiring (heart milestones 1/5/10/25, mentions, replies, optional weekly feed digest once a scheduler exists); heart-received highlights on member profiles ("what people keep thanking you for" themes per F3, never totals); internal closed-loop event-ticket credits through the one ledger (platform-governed, non-withdrawable) — explicitly gated behind real legal review before build; optional Hypha deep-link card at cycle close pointing at the village's configured DHO URL.

## Risks

- Sequencing coupling: the feed cannot ship before Phase 4 forum tables exist; if pressure mounts to ship it early, the standalone-table shortcut would permanently fragment content — resist it, the feature is not loop-critical
- Two caps on one budget (acknowledgment cap vs heart cap) will read as a bug if the UI doesn't explain it; HeartButton tooltips and the 409 copy must name the cap that fired
- Settlement-report semantics shift: hearts add rows to gratitude_log, so distinctSenders in the cycle report founders carry to Hypha now mixes 1-Gratitude hearts with 100-Gratitude acknowledgments; amounts weight it correctly but the metric's meaning changes (open question filed)
- Spam-then-hide economics: gratitude sent to a post that is later hidden is not auto-clawed back; mitigated by member-stage posting gate, daily post cap, and tiny heart amounts, but a determined ring could farm hearts — the unique (from,post) key and per-recipient cap bound the damage to budget-sized numbers
- External CTA URLs are an outbound-link trust surface (phishing); only feed.announce holders can post them, https enforced, domain displayed — consider a domain allowlist variable if abused
- Image moderation is report-driven only (no automated scanning); an admin must be reachable — report_hide_threshold auto-hide is the backstop
- In-memory rate limiter resets on redeploy (standing hazard #5) — acceptable for post caps, documented
- gratitude_log migration must backfill kind='acknowledgment' on existing rows before the unique heart index is added, and the JSON-era rows carry no kind field — cutover script detail, easy to miss
- Legal (flagged per posture): v1 creates nothing new — hearts are the existing closed-loop credit; v2's internal event-ticket credits DO need counsel review before build (credits redeemable against real-world admission edge toward stored value)

## Open questions

- Heart UX: pure one-click with a derived quote-the-post message (designed default), or a one-tap popover offering an optional short note? The principle the design holds to is that the message is what makes recognition mean something, and the open half is whether quoting the post carries that on its own
- Should the cycle settlement report split heart totals from acknowledgment totals (two columns) since founders carry it to Hypha for real distribution? Recommended yes, and it changes a shipped report shape, so it is a deliberate break rather than an addition
- Does the feed eventually replace the Home VillagePulse section, or stay complementary (v1 keeps both with a cross-link)?
- Visitors with budget 0: heart button greyed with progression tooltip (designed default) or hidden entirely?
- Event CTA internal targets: /visit exists today; the accommodation-exchange and marketplace modules are being designed in parallel — confirm their route names before hardcoding the CTA picker options
- Should hearting be allowed on system cards (e.g. hearting a stage-advance to congratulate someone)? Tempting and cheap since system events now carry actorId, but it blurs 'appreciation for contribution' into 'reactions' — deferred, needs a product decision
- feed.category_slug assumes exactly one feed category per deployment; does any fork want multiple feed-rendered categories (e.g. separate Events feed)? Affects whether the variable is a slug or a list
