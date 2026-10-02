# Village Coordination Game — Platform Foundation

Amora is the **first project** built on this foundation. The goal is that hundreds of
communities can stand up their own coordination game from this codebase. This doc
explains what is platform (reusable) vs project (swappable), and how to launch
project #2.

## The core idea

The site is an **infinite game**: it doesn't funnel visitors to a form and end. It
gives every persona a progression path, a contribution loop, and a reason to return
until (and after) the physical village exists. The design principles, borrowed from
ReGen Civics and hard-won there:

1. **Stages are earned by real acts, never abstract points.** Training completed,
   covenant signed, quests consented — each stage proves the person did the thing.
2. **Value only moves with a human yes.** Quest rewards are credited only when a
   team member consents in Admin. No automatic payouts.
3. **Recognition, not compensation.** Gratitude sends are acknowledgments with a
   required message; the public wall shows the words, never the amounts.
4. **Nothing is decorative.** Every element on screen maps to real data (season,
   pulse events, stage ladder, budgets).
5. **Rhythm over streaks.** Budgets reset monthly; there is no daily-login anxiety.

## The fastest path: the Setup Wizard (`/admin` → "Make This Yours")

Most of a new project's identity can be set **live from the browser**, no code
deploy, via the Setup Wizard, the first item in admin. It writes a brand
overlay into the `brand` row of the `app_config` table, and
`/api/game/config` merges that over the `gameConfig.ts` defaults, so blank
fields keep the platform's values as suggestions until a project changes
them.

The overlay is a DATABASE ROW and there is no file. It is read through
`dbDocument(getPool(), "brand", DEFAULT_BRAND)` at `server/index.ts:1361`,
defined in `server/repos/store-db.ts`. That read is cached in the
process and only boot fills the cache, so a change written to the row by SQL
or by a script does not reach a running server. `GET /api/admin/brand/preview`
reads the row directly and says when the two disagree.

The wizard covers, in order:

1. **Identity**: project name, tagline, member name, location, the links and
   the footer line. Instantly reflected across the game layer (profile,
   gratitude, season, pulse). Token names are NOT here: they live in the token
   registry (Admin → Tokens), which `mergedConfig()` reads ahead of this
   overlay, so a name typed here could never win and the two boxes that tried
   have been removed.
2. **Pictures** — the hero images, the header logo, the footer mark and the tab
   icon, each with a live thumbnail. Every slot ships empty.
3. **Numbers** — village dues and other figures (Settings tab).
4. **Content** — one-click into every existing editor (page copy, FAQs, build
   progress, training, visit, investor summary, season, quests).
5. **Go live** — the one-time technical checklist (Railway deploy, data volume,
   env vars, domain, build-time og:image/favicon) with copy-paste commands.
   `START_HERE.md` is the current guide to running a village, and wins where
   this panel's commands have aged.

Use the wizard first; drop to the files below only for deeper structural changes
(new personas, a different stage ladder, new page layouts).

## The swap points (what changes per project)

| Layer | File(s) | What lives there |
|---|---|---|
| **Setup Wizard (live)** | the `brand` row of `app_config`, edited in `/admin` → Make This Yours | Project name, tagline, member name, location, the images, wizard progress. Live-editable, no deploy. Merged over gameConfig by `/api/game/config`. Token names are the token registry's, never this overlay's. |
| **Game config (defaults)** | `shared/gameConfig.ts` | The default identity + images the overlay falls back to, plus the structural bits the wizard doesn't touch: personas/paths, the stage ladder + earning rules, gratitude budget rules, next-best-action rules, default season. |
| Theme | `client/src/index.css` | Color tokens, fonts |
| Content seeds | `server/seeds/content-seed.json`, `server/seeds/quests-seed.json`, `DEFAULT_*` constants in `server/index.ts` | Page copy, starter quests, FAQs, milestones, training modules, visit config, village dues, brand defaults. (All also editable at runtime in admin.) |
| Pages | `client/src/pages/*` | Persona journey pages and marketing content are project-specific by nature; the game components they embed are platform. Hero images already read the brand overlay. |

Platform code (server game engine, `client/src/lib/gameApi.ts`, the game components
below) must never hardcode a project name, currency name, or stage — it reads
`/api/game/config`. If you find a hardcoded "Amora" outside content/seeds, that's a
platform bug.

## The game engine (platform)

### Server (`server/index.ts` and `server/routes/`)

Some of these still live in `server/index.ts` and some in route modules. New
routes go in `server/routes/<domain>.ts`, registered from `server/index.ts`,
which is ratcheted and may not grow.

| Endpoint | What it does |
|---|---|
| `GET /api/game/config` | Public config: project, currency, paths, stages, current season |
| `GET /api/game/me` (auth) | Player state: stage, ladder position, gratitude balance + budget, quest claims, next-best-action |
| `POST /api/game/journey/sync` (auth) | Mirrors journey/training step completion into the player record |
| `GET /api/quests` + admin CRUD | Quest library (seeded from `server/seeds/quests-seed.json`) |
| `POST /api/game/quests/:id/claim` / `submit` (auth) | Claim a quest, submit evidence (artifact link + note) |
| `GET /api/admin/quest-claims` + `POST .../consent` | Team consent queue; consent credits the reward and emits a pulse event |
| `POST /api/game/gratitude/send` (auth) | Monthly budget (stage-multiplied), message required, once per recipient per cycle |
| `GET /api/game/gratitude/wall` | Public wall (names + messages only) |
| `GET /api/game/gratitude/me` (auth) | Private journal with amounts |
| `GET /api/game/pulse` | Public activity feed (joins, quests, gratitude, stage advances, season) |
| `GET /api/season` + `PUT /api/admin/seasons` | Current season banner data (the singular `PUT /api/admin/season` was deleted: it predated multi-season and had no caller) |
| `GET /api/admin/players` + `PUT .../:id/stage` | Player list with computed stages; grant ceremony-based stages |

Stage computation: `computeStage()` interprets the declarative rules in
`gameConfig.stages` (`default`, `account`, `training-complete`, `membership`,
`quests {min}`, `granted`). Adding a new rule type = one switch case.

### Client components (platform)

- `client/src/components/GameDashboard.tsx` — profile: next-best-action, stage ladder, gratitude, quests
- `client/src/components/QuestActions.tsx` — claim/submit UI on quest cards
- `client/src/components/SeasonBanner.tsx` — homepage season strip
- `client/src/components/VillagePulse.tsx` — homepage activity feed
- `client/src/pages/GratitudeWall.tsx` — public wall + send form (`/gratitude`)
- `client/src/lib/gameApi.ts` — auth fetch + types

### Admin (The Game section)

- **Quest Claims** — the consent queue (evidence, amount, consent/decline)
- **Players** — everyone's computed stage; grant Immersant/Initiate/Co-Creator/etc.
- **Season** — name, theme, focus, dates for the homepage banner

## Launching project #2 (checklist)

**The fast path (no code):** run the published image
(`ghcr.io/rieki777/village-os:<version>`, pinned to a release; `START_HERE.md`
walks it), then do everything in `/admin` → "Make This Yours" — identity,
images, numbers, and all content. That covers most projects, and needs no
fork and no access to the repository.

**Deeper structural changes (code):**
1. Fork the repository. A fork is only for changing code, and it deploys
   through the repository's own `Dockerfile`.
2. In `shared/gameConfig.ts`, change the structural bits the wizard doesn't touch:
   personas/paths, the stage ladder + earning rules, gratitude budget, next
   actions. (Identity + hero-image *defaults* also live here but are normally set
   live in the wizard instead.)
3. Swap theme tokens in `client/src/index.css` and the fonts in `client/index.html`.
4. Replace `server/seeds/*.json` and the `DEFAULT_*` seeds in `server/index.ts`
   (FAQs, milestones, training, visit, investor summary, village dues) if you want
   the project to *boot* with its own content instead of editing it in admin later.
5. Rewrite the persona journey pages + marketing pages if their structure differs.
6. Write `.env` with `node scripts/fork-init.mjs`, which generates every
   secret; `.env.example` explains each variable.
7. Deploy with a **persistent volume mounted at `/app/data`** for uploaded
   files. Everything else, the brand overlay included, lives in MySQL, and the
   server applies its own migrations at boot. Seeds live in `server/seeds/` so
   the mount never shadows them.

## Known trade-offs and next steps

- Storage is MySQL, with hand-written migrations in `drizzle/` that the server
  applies at boot. There is no `data/*.json` store any more.
- Member tokens are signed with `AUTH_TOKEN_SECRET`.
- Legacy field: the player balance is stored as `heartsBalance` on the user row (`server/repos/users.ts`)
  (predates the Gratitude rename); the API exposes it as `gratitude.balance`.
- Not yet built (next phases): Living Village map (milestones rendered on an
  illustrated map of the land), Season Harvest recap page, journey-page step sync
  (training already syncs), shareable profile cards, forum sensing/governance.
