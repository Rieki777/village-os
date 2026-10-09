# Founder Agent Guide

**You are reading this because a founder pointed you at this repository and
asked you to help them stand up their village.** This document is written for
you, an AI agent, and not for the founder. It tells you where things are, what
order the setup happens in, what each setting means, and the things you must
never do.

Start with `AGENTS.md` at the repository root if you have not: it is the front
door, and it is short. This guide is the long reference behind it. The founder
is the one who decides. Read the next section before anything else.

---

## 0. The rule that outranks everything

**Explain each step before it happens. Run a command, or take any action that
changes something, only after the founder has said yes to that step. Then tell
them what happened.**

This is the rule `AGENTS.md` and `docs/FOUNDER_SETUP_PROMPT.md` state in the
same words, and if any document in this repository reads differently,
`AGENTS.md` wins. It replaced the rule that stood here until 2026-10-02,
"suggest, never execute". A founder who has never used a terminal cannot run
`docker compose up` alone, and an assistant that may only suggest leaves them
stuck at the first command. What that rule protected stands unchanged: the
founder decides, credentials never pass through you, and you never act as them.

A yes covers the one step you described. Ask again for the next. Reading needs
no yes: this repository, the village's logs, its public pages, the founder's
own material. When something fails, stop, say what you saw, and ask before you
try anything else.

### What it means in practice

| With a yes for that step, you may | Never, even with a yes |
|---|---|
| Run a setup command on the founder's own computer: `node scripts/fork-init.mjs`, `docker compose up -d`, the backup commands in `START_HERE.md` | Ask for, read out, type or paste a password, an API key, a token or a database URL with a password in it, or print `.env` |
| Draft the village name, tagline, member name, footer sentence, quest text, FAQ answers and page copy, and type it into the field it belongs in while they watch | Press Save or Launch. The founder presses Save and Launch |
| Explain what a module does, what turning it on reveals, and what it will ask for next | Call an admin API on their behalf, `PUT /api/admin/brand` included, or write to their database |
| Set a setting that is not a secret and that the founder chose: a port, their domain | Put a secret into their hosting provider's settings. They paste secrets by hand |
| Explain what Stripe, Resend and Anthropic each cost and what each unlocks | Create an account, accept terms, enter card details, or spend their money |
| Tell the founder exactly which DNS record to add and where | Sign in to `/admin` as the founder, or hold their session token |
| Say plainly that a step needs a decision only they can make | Make that decision for them and report it as done |
| Read `.env.example` and explain any variable | Push to `ReGen-Civics/village-os`, ask anybody for access to it, or run the `:edge` image for a village |

### Where the line sits in Admin

**Filling in a form field is not executing.** Rieki drew the line at Save and
at Launch, and it holds under the new rule. Typing a drafted tagline into the
box while the founder watches holds no credential and takes no decision,
because the founder presses Save and the founder clicks to launch. They read
the field before it is committed and change whatever they want.

Two conditions hold that in place, and both have to be true:

- **The browser is one the founder is already signed into.** You never sign in.
  You never receive the token that would let you.
- **The founder sees the field before it is saved.** A value typed into a form
  in front of them is still a suggestion, and they can clear it in one
  keystroke. A value delivered by an API call is in their village whether they
  read it or not, which is why the admin APIs stay on the right of the table
  and typing does not.

### Two worked examples, so the line is unmistakable

**Right.** The founder says the Pictures step is confusing. You read
`client/src/pages/Admin.tsx` and `client/src/components/admin/setupProgress.ts`,
and you tell them: there are nine image slots, all nine are counted toward the
step being finished, blank slots draw a quiet placeholder with the alt text as
the accessible name, the header logo and footer mark and tab icon apply live
with no deploy, and the file they upload is re-encoded to WebP at 2000px on the
way in so a phone photo is safe to use. Then you ask which nine pictures they
have and offer to help them pick. They upload. They save.

**Wrong.** The founder says the Pictures step is confusing, so you ask for their
admin password, sign in, and upload nine images you found on their old website.
Every part of that is a violation: you asked for a credential, you acted as
them, and you published pictures they never chose onto a public site.

**Right.** The founder asks what their village should be called on the site. You
read the material they gave you, propose three options with a sentence on how
each one will read in the header, the footer, the browser tab and the quest
share card, and say which one you would pick and why.

**Wrong.** You `PUT /api/admin/brand` with the name you liked best. Even with a
valid token, this is the founder's identity and the founder's choice, and a
value that arrives in their village without them typing it is a value nobody
owns.

### One more thing that is never yours

**Never ask for, hold, store, or type a credential.** Not the admin password,
not a session token, not an API key, not a database URL with a password in it,
not a Railway token. If a step needs one, tell the founder where to go, what to
click, and what the screen should say when it worked. Wait.

Admin access in this platform is the founder's own account. `isAdmin` in
`server/index.ts` resolves a real signed-in user with the `admin` or `founder`
role, and the client passes that user's session token as
`Authorization: Bearer <token>` (`client/src/components/admin/adminApi.ts`).
The variable is called `password` in the client for historical reasons and it is
a session token. Holding it means being them.

### Two different secrets, and one of them is worse

A founder who says "here is my password" could be handing you either of these.
They need different answers, so establish which one it is before anything else.

- **The session token.** What the admin screens carry as `password` in
  `client/src/components/admin/adminApi.ts`, sent as
  `Authorization: Bearer <token>`. It stands for one signed-in account, and it
  can be revoked from inside the app. The remedy below covers it.
- **`ADMIN_PASSWORD`.** An environment variable, and the harder loss. It
  authenticates exactly one route, `POST /api/admin/bootstrap` in
  `server/index.ts`, the call that creates the first founder account on a
  village that has no admin to authenticate as. The route refuses once any admin
  exists, and it refuses outright while the value is still the shipped
  placeholder. On a village nobody has bootstrapped yet, that one string mints
  the account that can do everything, and there is no in-app revocation for an
  environment variable. The fix is to change it in Railway and redeploy.

### When the credential is already in the transcript

The four verbs above assume you get a chance to refuse. Founders paste
credentials unprompted, in their opening message, before you have read a word of
this document. When that happens, three of those four verbs are already
violated, there is nothing left to prevent, and a rule stated in the future
tense is no help. Say this plainly and move to the remedy.

1. **Name the state.** The value is in a transcript now, so treat it as
   exposed. It has passed through a model, it may sit in session history and in
   logs, and no assurance you can give changes that. Do not soften this.
2. **Do not use it.** Not once, not to check one thing, not to be helpful. A
   credential you were handed is still a credential you were never given the
   right to hold.
3. **Name the remedy, for a session token.**
   `POST /api/admin/users/:id/revoke-sessions` in `server/index.ts` bumps that
   member's `tokenVersion`. Every token carries the version it was minted
   under, and the check that resolves a signed-in user refuses any token whose
   version is behind the account's, so every token issued before the bump stops
   verifying at once. An admin calls it from their own signed-in session against
   the affected user's id. Signing out bumps the same counter, so a founder who
   pasted their own token can sign out and back in without anybody's help.
4. **Say what it costs before they press it.** Revoking signs that member out
   on every device they own. That is what it is for, and a founder should hear
   it first rather than discover it on their phone.
5. **Restart from a clean state.** Ask them to open the admin screens
   themselves, and carry on suggesting.

If what they pasted was `ADMIN_PASSWORD`, none of steps 3 and 4 apply. Send them
to change it themselves, in `.env` on their own computer or in their hosting
provider's variables, and restart the village.

---

## 1. What this platform is

It is a white-label coordination platform for a village: a piece of land, a
community, and the work of running both. Its name is **Village OS** (it was
called game-amora until 1.2.0), and every village runs the same published
image, `ghcr.io/regen-civics/village-os:<version>`, pinned to a release. Forking is
optional, only for a village that means to change the code, and nobody needs
access to `ReGen-Civics/village-os` to run one. What makes an instance somebody's
own is its own database, its own domain, its own environment variables, and a
set of records inside its own database that carry the name, the pictures, the
words and the numbers.

The stack, from `CLAUDE.md` and `package.json`: React 19 with Vite and wouter in
`client/src`, one large Express server at `server/index.ts` plus `server/lib/*`
and `server/routes/*`, MySQL with hand-written SQL migrations in `drizzle/`
applied at boot by `server/db/migrate.ts`. A village runs the image with Docker
on one machine (`docker-compose.yml`, `START_HERE.md` part A) or on a hosting
provider such as Railway (`START_HERE.md` part B, `docs/PROVISIONING.md`);
`ops/RELEASES.md` covers the releases.

The platform is made of **modules** (`docs/MODULES.md` lists every one, generated from the code). Each one is a part of village
life the village can switch on: a map of the land, a quest board, stays and
hosting, a material library, an exchange, governance, messaging. Four core
modules (quests, gratitude, progression, profiles) are always on; the other 21
ship off. `shared/modules.ts` is the registry of everything the platform can
be. A village with only the core modules on is still a working site.

What this means for you: almost everything a founder wants to change is a
setting, not a code change. Reach for the admin screens first, every time. A
code change is the last resort and section 7 covers what it costs.

---

## 2. Before you touch anything: know which village you are looking at

Four things to establish in your first minutes, because getting any of them
wrong wastes the founder's afternoon. The first one is the one this section used
to skip.

**Whether any of it exists yet.** Ask before you ask for anything else, and ask
it in plain words: "Do you have a site running somewhere, and can you open it in
a browser?" A founder who has just been pointed at this platform may have no
deployment, no domain, no checkout on their machine, and no terminal they know
how to open. Every command below assumes a running instance. Running one against
nothing returns an error the founder reads as their own failure, and some of
them stop there.

Three states, and each sends you somewhere different:

- **Nothing deployed.** The village does not exist yet, and there is no address
  to curl. `START_HERE.md` is where this starts: part A runs the village on one
  computer with Docker, part B on a hosting provider, with
  `docs/PROVISIONING.md` behind it. On a provider the first decision is whether
  the founder self-hosts, holding the Railway account and the domain and every
  key themselves, or whether ReGen Civics hosts the instance for them. ReGen
  Civics does not charge for hosting: accepted Season 2 projects are hosted
  free, and gifts go to CORE. Read those documents with them and stay on the
  rule in section 0: the three human-only steps `docs/PROVISIONING.md` names up
  front are human-only for you too.
- **Deployed, no domain yet.** A village can be stood up before DNS exists.
  `scripts/fork-init.mjs` takes `--domain` as an optional flag, and
  `docs/PROVISIONING.md` says to leave it off and fill `FRONTEND_URL` in later.
  Ask the founder for whatever address their host is serving the instance on and
  use that everywhere this section says domain. Pointing the real domain is a
  later step and it is one of the three nobody can do on their behalf.
- **Deployed on their own domain.** Carry on with the rest of this section.

One thing to tell them early, because it changes what they think they have to
learn: **every step in section 3 except Going live happens in a browser, on the
admin screens, with no checkout and no terminal.** Going live is the one that
needs a shell, and it is one-time work somebody does once per village. A founder
who believes they have to install something before they can name their village
often stops before they start.

**Which repository checkout.** This one is about you rather than them. Confirm
you are in a checkout of this repository and read `CHANGELOG.md` for the current
release. The tree changes weekly.

**Which running instance.** Ask the founder for their domain. Then:

```
curl -s https://<their-domain>/health
```

`/health` answers `{status, build, timestamp, database, uploads}` and returns
503 when the database probe fails. The `build` field is a real build marker; a
marker that never changes across a deploy means the deploy did not land. Note
that `/health` is the path. `/api/health` is a different thing and may be gated
off.

`GET /api/platform/info` is a public, unauthenticated handshake. It answers the
village's name, tagline and location as the merged config resolves them, plus a
permanent instance id, the platform version, the build marker, and every module
serving at members level or above. A module still in `preview` is deliberately
absent, because preview is what a founder is still looking at. Reading it is a
fast way to confirm you and the founder are talking about the same village and
that its identity actually landed.

**Whether the village is live yet.** `/journey-to-launch` is the readiness
checklist and it is the single answer to "what is left". The requirements are
data in `shared/launchRequirements.ts`, resolved to live status by
`server/lib/launch.ts`, and served at `GET /api/admin/launch` to a signed-in
admin. Three surfaces read that one registry: the Journey to Launch page, the
admin banner, and the assistant's launch-guide mode. Ask the founder to open
that page and read it to you. Do not invent your own checklist beside it.

---

## 3. The setup, described by what each step achieves

**Read this section as a description of goals, not of an order.** The wizard's
step numbers move. As of this writing the panel at
`client/src/components/MapSkinPanel.tsx` describes itself as "step 6" while
`client/src/pages/Admin.tsx` renders it as step 5, which is what a number in a
document is worth. There is also a planned reordering that puts the assistant
connection first and moves map styling into the map itself. Describe steps to
the founder by what they accomplish and the reordering costs you nothing.

The wizard lives at Admin, under a section headed **"Make This Site Yours"**
while it is unfinished and **"Project Settings"** once every step reads done.
Both names are the same screen and every field stays editable forever. The
default admin path is `/admin` (`shared/gameConfig.ts`).

`client/src/components/admin/setupProgress.ts` is the one place the steps are
declared, and it splits them into two kinds. This distinction matters and the
founder will not notice it unless you tell them:

- **Measured steps** are counted from what is actually saved in the village's
  own record. There is no checkbox. Empty a field and the step goes back to
  unfinished on its own. Identity and Pictures are measured.
- **Self-reported steps** carry a checkbox the founder ticks. They say only what
  the founder told them. Numbers, Content, Map and Go-live are self-reported,
  because what they ask about is genuinely not readable from the record.

A ticked box outlives whatever it was ticked about. If a founder shows you six
of six and the site still looks wrong, four of those six are their own word.

### Naming the place

**What it achieves:** the village has its own name, its own tagline, its own
word for a member, its own location, and its own one-sentence footer.

Fields the wizard renders in this step: project name, tagline, what a member is
called, location, main website URL, events page URL, contact email, footer
introduction. Saving applies live with no deploy.

Counted toward the step being finished: name, tagline, member name, location,
footer introduction. The three URL and email fields are deliberately excluded,
because blank is a real answer for each of them (see section 6).

**The token name is not in this step and there is no box for it here.** Every
token this village runs, including the recognition token members earn, is named
under Admin, Tokens. The wizard now shows a line pointing there. Two dead boxes
used to sit in this step and the token registry beat them every time, so typing
a token name here changed a stored value nothing displayed. If a founder tells
you they renamed the token in the wizard and nothing changed, this is why, and
the answer is Admin then Tokens.

### Dressing the place

**What it achieves:** the site carries the village's own pictures, colours, type
and visual identity.

Nine image slots, all nine counted: homepage hero, investor hero, resident hero,
steward hero, prosperity hero, master plan hero, header logo, footer mark,
browser tab icon. Every one of them ships empty on purpose, because the
platform holds no art that belongs to a particular village.

Alt text ships with the pictures and is what a screen reader reads in place of
the image. The tab icon has no alt field, because a browser tab icon has nothing
to read.

Three more panels are mounted inside this step and each is its own component:

- **Look** (`client/src/components/LookPanel.tsx`): three decisions a founder
  with no design background can make. A colour, a character, and one sentence
  about their place. Palette, radius and type pairing derive from those three,
  and every colour pairing is contrast-measured before it ships.
- **Typography** (`client/src/components/TypographyPanel.tsx`): heading, body and
  accent faces from a self-hosted catalogue, or the village's own font file.
  Uploading a font is gated behind a web-embedding licence acknowledgment that
  records who confirmed and when. Tell the founder plainly: "free to download"
  almost never includes web embedding, and the village that picks a font carries
  the licence.
- **Identity pack** (`client/src/components/IdentityPackPanel.tsx`): the
  village's visual identity written down as data, a description of what they are
  and what they are not, plus reference images. Its save is gated behind a
  rights acknowledgment, because a logo from a designer is often not the
  village's to feed to a model.

Uploads go through `POST /api/admin/brand/image`. The server re-encodes to WebP,
caps the long edge at 2000px, writes a 400px thumbnail, and asserts that no
metadata survived the encode. A file whose location data survives is refused
instead of stored. If compression is unavailable the upload is refused with a
503 and an explanation, and the original bytes are never written. Files land on
the mounted volume and are served at `/api/uploads/<filename>`.

**What the server accepts:** `image/jpeg`, `image/png`, `image/webp`,
`image/gif` and `image/avif`, one file at a time, up to 25 MB. That list is the
`fileFilter` on `brandImageUpload` in `server/index.ts`, and anything outside it
is refused with a 400 before a byte reaches the volume.

**SVG is refused, and this is the one to say before the founder tries it.** It
is absent from that list, and the file picker in `BrandImageField`
(`client/src/pages/Admin.tsx`) does not offer it either. A logo "my friend made"
is very often an SVG, and it is the first file a founder reaches for. Tell them
in advance what they need instead: a PNG export, around 1000px on the long edge,
with a transparent background. Every vector tool exports one. Doing that export
yourself and handing them the file is already allowed, and section 9 lists it.

**There is a second path into every image slot and this document never named
it.** Beside the upload button sits an "or use a URL" toggle, and the URL it
takes is stored and served exactly as typed. It is useful when a founder already
hosts their pictures somewhere they trust. It also means the site hotlinks, and
the founder should hear all of what that carries before they paste: the file is
fetched from that other host by every visitor, it never passes through the WebP
re-encode or the 2000px cap or the metadata assertion, and it vanishes from the
village's own pages the day that host moves it, rate-limits it, or takes it
down. An upload is the more durable of the two. The founder chooses.

### Stating the numbers

**What it achieves:** the money and land figures the site shows are this
village's own, or are absent.

This step is a doorway. The fields live on the **Settings** tab: village dues,
and the land and money figures the investor page and the master plan show
(size of the land, appraised value, change in land value, projected return,
target raise, planned homes, guest rooms).

**Every one of them ships blank, and a blank figure means the page shows no
figure at all.** The site only ever states what the founder stated. They are
free-text on purpose, so a village can write "under valuation" or "1.2M EUR"
without being pushed into a precision it does not have.

**These fields are a second record, behind a second endpoint, carrying the same
cache trap.** They are not part of the `brand` row. They live in another row of
the same `app_config` table, `config_key` = `settings`, opened as
`dbDocument(getPool(), "settings", DEFAULT_SETTINGS)` in `server/index.ts` on
the line above the one that opens `brand`. They are written by
`PUT /api/admin/settings`, a different endpoint from the one Identity and
Pictures call, and that one merges at the top level only. They are read at
`GET /api/settings` with no authentication and at `GET /api/admin/settings` by a
signed-in admin.

Because it is the same `dbDocument` machinery, everything section 5 says about
the brand row's cache is true here word for word: loaded into memory once at
boot, no TTL, and a value written straight into the database stays invisible to
the running server until it restarts. A founder whose figure will not change is
usually looking at that, and the fix is the same one. Use the admin screen.

This is the step where you are most useful and most dangerous. You can explain
where each figure appears. You must not supply one. See section 8, which now
carries a unit trap on the first of these fields.

### Writing the words

**What it achieves:** the questions, milestones, quests and page copy are the
village's own words.

Another doorway, this one to a list of editors: Org Chart, Team Page, FAQs,
Build Progress, Training modules, Visit program, Investor summary, Season, and
Quests. The Content tab itself holds Team Page, Legal and Jurisdiction Notices,
and the Love Letter Covenant (`client/src/components/admin/contentSections.ts`).

**Two kinds of pre-written content arrive and they behave in opposite ways.**
The pair reads as one thing at a glance. Both misreadings are actionable, and
each one costs somebody an afternoon.

- **Seeded starter quests** come from `server/seeds/quests-seed.json` and land
  as ordinary rows in a fresh village. No example flag anywhere on them. They
  are fully editable and fully deletable and they are meant to be rewritten in
  the village's own words. Rewriting them is the best drafting work available to
  you in this whole document.
- **Standing examples** come from `server/seeds/examples-seed.json` and appear
  when a module is first switched on, so a founder meets a working module rather
  than "No items yet." Every row carries `is_example` on the row itself, so the
  flag travels through every read path. Every mutation against one is refused,
  with `EXAMPLE_REFUSAL` from `server/lib/examples.ts`: "This is a standing
  example. Publish your own to replace it." They cannot be edited and they
  cannot be deleted one at a time. Publishing the first real item in that module
  retires the whole set, permanently and one way. `example_state.retired_at` is
  a tombstone, so deleting the real items later never brings the examples back.

A founder who reports "I tried to edit the example and it would not let me" has
met the refusal working correctly, and the answer is to publish their own item.
A founder who leaves the starter quests alone in case they are locked has the
other misreading, and those are theirs to rewrite today.

Drafting here is the single best use of your time. Read what the founder has
already written elsewhere, propose text, hand it over.

### Styling the land

**What it achieves:** the Living Map draws this village's land the way the
village sees it.

Three panels: the map skin, the walk editor, and the map vocabulary (the
founder's own words for roads, water and zones). Blank keeps the map's own look.
The stored shape is the map artifact's own export format
(`shared/mapSkin.ts`), so a founder can style inside the map, export, and land
on these values.

This is the part the planned reordering moves into the map itself. Describe it
by what it achieves and the move does not affect your advice.

### Going live

**What it achieves:** the village is deployed, has a database and a volume, has
its environment variables, and answers on its own domain.

The wizard's Go-live step lists one-time technical work: deploy on Railway, add
a persistent volume mounted at `/app/data`, set the environment variables,
point the domain, and read `PLATFORM_FOUNDATION.md`. That panel predates the
published image and is stale in places (it still names `JOURNEY_PASSWORD`,
which is retired). Do not follow it over the walkthrough.

**The source of truth for this step is `START_HERE.md`, with
`docs/PROVISIONING.md` behind it for a hosting provider.**
`docs/FOUNDER_SETUP_PROMPT.md` is the same walkthrough written as a prompt a
founder pastes into their own assistant. Read them before advising on any of
it. The things worth carrying in your head:

- `scripts/fork-init.mjs` generates every secret and writes it to `.env`. It
  never prints `ADMIN_PASSWORD`, and you do not open `.env`. The founder reads the file themselves. Two
  of the values it generates, `MEMBER_SECRETS_KEY` and `VILLAGE_SECRETS_KEY`,
  cannot be recovered once anything has been stored under them. Set once,
  leave alone.
- The server applies every migration itself, at boot, before it listens. There
  is no migrate step. A first boot on an empty database takes minutes.
- The founder claims the village at `<address>/claim` with their email, their
  name and the `ADMIN_PASSWORD` they read from `.env`. After a founder exists
  that password refuses everyone except `BREAK_GLASS_ADMIN_EMAIL`, which is
  what stops a later lockout being permanent. `FOUNDER_EMAILS` re-grants the
  founder role on Google sign-in to an existing account, and needs Google
  sign-in configured; on a default invite-only village it cannot create a
  founder from nothing.
- Resend accepts mail through an unverified sending domain and answers success.
  Nothing arrives, with no error and no bounce anywhere in the platform. Do not
  let a founder believe email works until the domain reads verified in Resend's
  own dashboard.
- Three steps cannot be done by any script, by you, or by anyone else on the
  founder's behalf, because each proves control of something outside this
  platform: DNS, Resend sender-domain verification, and creating a Stripe
  account.

`docs/FOUNDER_SETUP_PROMPT.md` states the same rule as section 0, and if any
document in this repository reads differently, `AGENTS.md` wins. With a yes
for each step you may run the setup commands. What stays outside the line
whatever the founder says: you do not press Save, you do not launch, and you do
not hold a credential.

---

## 4. Getting the residents in

Second question every founder asks, right after the site starts looking like
theirs: "twelve people live here, how do I get them accounts?" Here is the
whole of it.

**Members join by invitation.** `membership.invite_only` ships true, so a
village is invitation-only until its founder changes that dial. The path has
three parts:

1. **The founder makes an invitation link for each person**, from the
   invitation panel on their own profile (`client/src/components/profile/InvitePanel.tsx`,
   calling `POST /api/invites` in `server/routes/invites.ts`). Anybody holding
   `member.vouch` may make one, and the founder does. Each link is
   `/register?invite=<token>`, works once, lasts 14 days, and a person may have
   up to 20 open links at a time. The link is shown once, when it is made;
   the panel's list says what became of each one and never repeats the link.
2. **The resident makes their own account with it**, in one of two ways: the
   sign-up page the link opens, which posts to `POST /api/auth/register`, or
   Google sign-in at `/api/auth/google/start` (`server/routes/authGoogle.ts`),
   set up as `docs/GOOGLE_SIGN_IN.md` says. Both doors check the invitation
   the same way (`server/lib/inviteDoor.ts`), and both make a plain member
   holding no privileges. Somebody without a link can ask to join at
   `/request-membership`, and the request lands in the founder's Admin.
3. **An admin sets the role afterwards**, at `PUT /api/admin/users/:id/role`.
   It takes exactly `member`, `admin` or `founder`. Before the village launches,
   only a founder may call it; after launch an admin and a founder reach the
   same surfaces, which is a deliberate decision recorded in the route's own
   comments.

`POST /api/admin/users/:id/send-password-link` is the unsticking tool for
somebody who cannot get in. An admin sends a short-lived set-password link to
the member's address, so a credential never travels through the founder or
through you. It depends on email working, which is the Resend trap in section 3:
an unverified sending domain answers success and delivers nothing.

Practical shape for twelve people: the founder makes twelve invitation links
from their profile and sends one to each person, each person signs themselves
up, and the founder promotes the two or three who need admin. Nothing in that
needs you to touch an account, and drafting the message the founder sends with
each link is work you can do.

### "Role" means three different things in this codebase

An agent that says "role" without knowing which one it means will mislead a
founder, and the three are not related to each other.

| What | Where | What it decides |
|---|---|---|
| `users.role` | on the member record, set by `PUT /api/admin/users/:id/role` | Whether this account is a member, an admin, or the founder. This is the one that opens `/admin` |
| The `roles` table | `drizzle/0002_roles_and_cycles.sql`, holders in `role_holders` | Named permission groups carrying a `capabilities` list. Village-authored, granted per person |
| `org_roles` and `org_role_assignments` | `drizzle/0049_org_roles.sql` | Org-chart seats, in the sociocratic sense: a seat has an aim, a domain it may decide alone, accountabilities, and a seat count. Vacancy is derived from active assignments against seats. It grants no access to anything |

The third is the one founders mean when they talk about roles in the village,
and it is the one that grants nothing. The first is the one that grants
everything and it has three possible values. When a founder says "make Ana a
steward", find out which of the three they are asking for before anybody clicks.

---

## 5. Where the real state lives

This section exists because these have already cost people time. Read all four
before you advise on anything that stores a value.

### The brand record is a database row, and it is cached with no expiry

Everything the founder types into Identity and Pictures, plus the theme, the
identity pack and the map skin, lives in **one row of the `app_config` table
whose `config_key` is `brand`**. It is read through
`dbDocument(getPool(), "brand", DEFAULT_BRAND)` in `server/index.ts`, and
`dbDocument` is defined in `server/repos/store-db.ts`.

**That document is loaded into memory once, at boot, and there is no TTL.**
`load()` runs during startup. `get()` returns a module-level cache. `put()`
writes the row and refreshes the cache in the same process. Nothing re-reads it
on a timer.

The consequence you must hold on to: **a value written straight into the
database is invisible to the running server until it restarts.** Anyone who
"fixes" a brand field with SQL will see the API keep reporting the old value and
will conclude the write failed. It did not fail. It was not read.

This is one of the strongest reasons the rule in section 0 is the rule. The
supported write is `PUT /api/admin/brand`, which the wizard calls when the
founder presses Save, and which merges section by section so a partial payload
never blanks a field it did not send.

### There is no brand file on the volume

Older documents named data/brand.json as the brand overlay. **No code in this
tree reads a file by that name, and there is no `data/*.json` store any more.**
Writing that file onto the uploads volume changes nothing, and the API keeps
reporting empty values while the file sits there looking correct.

It is written here without code formatting on purpose, because a path in this
document is a route you are meant to follow and this one leads nowhere. If you
see data/brand.json named in a document, translate it to "the `brand` row of
`app_config`" and carry on.

### Module enablement lives in `module_settings` and nowhere else

`shared/modules.ts` says it in its own header: enablement lives in
`module_settings`, read through `server/lib/modules.ts`, "and NOWHERE else". The
per-module `<module>.enabled` game variables that older design documents sketch
are void.

Four lifecycles, rank-ordered `off < preview < members < public`:

- `off` routes answer 404, no nav entry, no admin tab, variables hidden
- `preview` admins only, and a non-admin gets the identical 404 body so the
  catalog of what a village is trying never leaks
- `members` signed-in only
- `public` everyone, with per-route capability checks still applying on top

**An absent row means off.** A village inherits every new platform module as
off, and enabling is always a deliberate admin act recorded in `module_events`.

Turning a module on is a founder decision with consequences: it reveals nav,
admin tabs and public routes, and for funds-bearing modules the platform refuses
the enable entirely while no admin holds their own credential. Explain what a
module will do. Let them press it.

### Uploaded files live on the volume

Member and brand uploads are written to `/app/data/uploads` on the mounted
Railway volume and served at `/api/uploads/<filename>`. In code the directory is
`UPLOADS_DIR`, which is `DATA_DIR` plus `uploads`, and `DATA_DIR` defaults to a
`data` directory beside the built server unless the `DATA_DIR` environment
variable overrides it. The Dockerfile creates `/app/data/uploads` and the
provisioning steps mount the volume at `/app/data`.

Two properties of that route worth knowing. It answers a real 404 for a file
that is not there, so it is honest. And it has no authentication in front of it,
so the filename is the only secret a file has. Never suggest putting something
sensitive on the volume and relying on the address being unguessable.

Large art belongs here and not in `client/public`. `client/public` is served
one-year-immutable, so a file cached by a browser cannot be replaced for a year.

---

## 6. What each setting means, and what a blank value does

The platform's whole posture on blank values is: **blank inherits the platform
default where a default is safe, and hides the thing entirely where it is not.**
A village's site never states something the village did not state.

The merge is `mergedConfig()` in `server/index.ts`. It overlays the brand record
over `shared/gameConfig.ts` and serves the result at `GET /api/game/config`. The
overlay rule is `pick()`: an empty string, `undefined` or `null` inherits the
platform default. Everything else wins.

| Setting | Blank does this |
|---|---|
| Project name | Falls back to the platform default `Unnamed Village` |
| Tagline | Falls back to `healing the land and ourselves, together` |
| What a member is called | Falls back to `Village member` |
| Location | Shows nothing. The platform default is empty, on purpose, because there is no neutral location |
| Footer introduction | Falls back to `A regenerative village where all beings belong and thrive.` |
| Main website URL | Hides the "Main Site" link entirely, so no visitor is sent to another village's site |
| Events page URL | Hides the footer Events link |
| Contact email | Hides every "email us" control on the shopfront pages. Read through `useVillageLinks` in `client/src/lib/gameApi.ts`. This one matters most, because its failure is silent: a compiled-in address would take an enquiry, send it somewhere else, and show the visitor a normal mail composer |
| Any of the nine images | Draws a quiet placeholder mark and keeps the alt text as the accessible name. The header logo becomes an empty spacer and the footer mark is omitted. The tab icon falls back to a neutral platform mark shipped in `client/index.html` |
| Any Settings figure (acreage, appraisal, target raise, and the rest) | The page shows no figure at all |
| Map skin, walk, vocabulary | The map keeps its own look and its own words |

Two identity values deserve their own note: `project.country` and
`project.fiatCurrency`. Both ship blank. They are two different situations, and
an earlier version of this document called them the same thing and was wrong
about one of them.

**`project.fiatCurrency` is read, and it decides what money looks like.**
`defaultDisplayCurrency()` in `shared/money.ts` reads it, and two callers use
that helper. `CurrencyPicker` (`client/src/components/power/CurrencyPicker.tsx`)
fetches `/api/game/config` and takes the project's currency as the code a viewer
starts on. `resourcesDefaultUnit()` in `server/index.ts` uses it as the declared
unit a new resources rule starts in. A grep for the key name finds the helper
and misses both callers, because neither of them names the key, and that is
exactly how the earlier claim was made and how it survived review.

The platform default is blank, and a blank answer displays as the helper's own
fallback, `CHF`. The Launch Plan (`/journey-to-launch`) asks the founder for
the village's currency, and Make This Yours has the field that writes it. The
currency is the founder's answer: section 0 holds, and you do not make that
call yourself.

**`project.country` is genuinely dead.** The only thing in this tree that
touches it is `mergedConfig()`, which merges it and serves it. No reader, no
writer, no admin field. It is an ISO code with nothing behind it. One thing that
looks like a reader is not one: `defaultDisplayCurrency()` accepts `country` in
its parameter type and never looks at it. Reading the body settles that in three
lines, and it is worth doing before repeating either half of this paragraph.

Behaviour, as opposed to identity, lives in a different plane: the variable
registry in `shared/gameVariables.ts`, with per-village overrides in the
`game_variables` table stored delta-only, so only changed values are kept and
platform default changes flow through. Token names live in the `tokens` table
and are set at Admin, Tokens.

**A token's display name is editable and its slug is frozen forever.**
`slugFreezeRefusal` in `server/lib/ledger.ts` refuses a slug change and explains
why: this schema carries no foreign keys, so the slug is the only thread holding
a token's history together, and moving it would orphan every ledger row,
balance and idempotency key without raising a single error. Every balance would
quietly read zero. Rename the display name and every surface follows.

---

## 7. If you propose a code change

Most founder requests are settings. Some are not. When you genuinely need a code
change, propose a diff to the founder and let them decide who applies it. These
are the house rules the repository enforces mechanically. Breaking any of them
fails CI, and CI is `.github/workflows/ci.yml`.

### Two files are ratcheted and may not grow at all

- `server/index.ts` is capped by `scripts/check-server-index-size.mjs` against
  `scripts/server-index-size-baseline.json`, in **lines and in route
  registrations**, and `--update-baseline` refuses to write a higher number in
  either. No file under `server/routes/` may pass 2,000 lines, so the monolith
  cannot move house. New routes go in `server/routes/<domain>.ts`, registered
  from `server/index.ts`.
- `client/src/pages/Admin.tsx` is capped by `scripts/check-file-lines.mjs`
  against `scripts/file-lines-baseline.json`, per file, and `--update-baseline`
  refuses to raise any tracked file's count. Any file in `client/src` that
  crosses 1,000 lines enters the baseline and is tracked from that day.
  Vendored shadcn primitives under `client/src/components/ui/` and test files
  are exempt.

Both refusals are proven by their own test suite (`server/serverIndexRatchet.test.ts`)
and both run as named CI steps. The path out is extraction into a new component
or a new route module, which lowers the number and keeps it lowered.

### Two gates guard the exact fields the founder is filling in

These are the ones to know before you touch identity, because they govern the
same values sections 3 and 6 are about. Both run as named steps in
`.github/workflows/ci.yml`.

- **Brand guard** (`scripts/check-brand-refs.mjs`, CI step "Brand guard").
  Platform code carries no village's brand. Three zones: `server/lib/**`,
  `shared/**`, `scripts/**`, `drizzle/**` and every file not in the baseline are
  hard-clean, where any hit fails. `shared/gameConfig.ts`, `server/seeds/**` and
  the documents are declared homes and exempt, because brand belongs in them.
  `server/index.ts` and `client/src/**` are a ratchet whose per-file counts may
  only fall. A genuine false positive takes an inline `brand-ok: <reason>`, and
  the waivers are counted and printed.
- **Identity keys** (`scripts/check-identity-keys.mjs`, CI step "Identity
  keys"). Every identity slot in `GAME_CONFIG` is empty, or holds an approved
  platform-neutral value, or holds somebody's identity, and this decides which
  without knowing a single proper noun. It exists because the brand guard cannot
  see this class of leak: `shared/gameConfig.ts` is the brand guard's declared
  home, and two of the three strings that put one village's identity into every
  fork's defaults contain no village name for a word-matching guard to match. It
  carries a dated `KNOWN_PENDING` list of keys still populated on purpose, with
  a ceiling that only falls, and it prints that list on every run.

Read the identity gate before you tell a founder that a config value has no
reader. Its `KNOWN_PENDING` entries carry the reason each key is still
populated, and one of those entries once corrected the `project.fiatCurrency`
claim this document used to make in section 6.

### The image budget is a ratchet too

`scripts/check-image-budget.mjs` walks `client/public`, fails on any raster that
is not WebP or AVIF, fails on any single file over 400 KB, and fails on a total
above `scripts/image-budget-baseline.json`. `--update-baseline` writes the new
number only when it is lower.

**New art belongs on the uploads volume, through the admin upload, and not in
`client/public`.** The volume is content-addressed, cached correctly and
swappable. `client/public` is served one-year-immutable.

### The writing rules

They apply to every string a member reads and `scripts/check-voice.mjs` enforces
them over `client/src`, `server`, `shared`, `server/seeds/**.json` and
`docs/knowledge/*.md`. It parses with the TypeScript compiler and reads only
real copy, so comments and class names cannot trip it.

1. No em-dashes and no en-dashes. Use a comma, a period, a colon, or a rewrite.
   Hyphens are fine.
2. No contrast framing. State what a thing is.
3. No AI filler vocabulary. The banned list is in the script.
4. No rhetorical-question openers used as filler.
5. No passive inspiration. Say something specific.

`scripts/check-hyphen-dash.mjs` catches the fifth escape route, a hyphen doing a
dash's job, and it scans `client/src` only, on purpose.

A genuine false positive takes an inline `voice-ok: <reason>` on the line, and
the waivers are counted and printed so they stay honest.

**Apply these rules to the copy you draft for the founder as well.** It will
save them an edit later.

### An HTTP 200 does not prove a file exists

The server serves the SPA shell with a status of 200 for any unmatched path, so
that client-side routing works. Four families of path are carved out and answer
an honest 404: `/api/*`, `/assets/*`, `/org/*` and `/.well-known/*`. Everything
else that does not match a route gets the SPA shell and a 200.

So when you check whether something is deployed: **read the content type, not
the status code.** A request for a missing document outside those four prefixes
answers `text/html` with a 200, and it looks exactly like success. This has
produced three separate silent failures already, including a member holding a
cached shell requesting a bundle hash that no longer exists and getting HTML
served as JavaScript.

### Everything else

`CLAUDE.md` at the repository root carries the full gate list, and
`node scripts/module-facts.mjs` prints that list straight from the CI workflow,
so it is right on the day you run it. Prefer the script over any block of text,
including the one in `CLAUDE.md` and including this document.

One number to never quote from a document: any budget or line count. This
repository has carried a stale figure twice. Run the script and read your own
tree.

---

## 8. What you cannot know, and must ask

You will be tempted to fill these in, because a blank field looks like a
problem and you are good at producing plausible text. Every one of these is a
place where a plausible answer is worse than an empty field, because the village
publishes it as a fact about itself.

**The land.** Acreage. Boundaries. What is built and what is planned. Water,
access, soil, what grows there. Whether the road is passable in the wet season.
You cannot know any of it and the master plan page will print whatever is
entered.

**The acres trap, and it is worth reading before a founder types a number.**
The Settings field is labelled "Size of the land", and the note box beside it
hints `acres, hectares` (`client/src/pages/Admin.tsx`). So a founder anywhere
metric enters `40` in the value and `hectares` in the note, correctly, exactly
as invited. The tile that renders it on the master plan is hardcoded
`label: "Total Acres"` in `client/src/pages/MasterPlan.tsx`, and that tile
renders the value and the label and nothing else. The note is dropped on the
floor. Of the four tiles in that row, only the appraisal renders its note, and
it does that further down the page inside the valuation sentence. A village
entering 40 hectares publishes "40" under "Total Acres" on the page it sends to
investors, understating its own land by a factor of 2.47.

**Check what the public page actually renders before you advise anybody on
units.** Open the village's own master plan and read the tile. A fix to this is
in flight and may have landed by the time you read this, so treat the label as
something to look at rather than something to assume. If the tile still reads
"Total Acres" for every village, say so plainly: the unit on that tile is not
the founder's to set yet, and the two honest options are to enter the figure in
acres, or to write the unit into the value itself, which is free text and does
render. If the tile has been fixed to carry the unit, say that instead and let
the note do its job. Either way the number is theirs, and the reason to raise it
at all is that the wrong answer is silent.

**The community's own words.** What a member is called. What the recognition
token is called. How they describe what they are doing and why. These are
identity, and identity that arrives from a model is identity nobody owns. Draft
options. Let them choose.

**Money.** Appraised value, projected return, target raise, dues, budgets. These
are financial statements a village makes to prospective members and investors.
Never supply a figure, never estimate one, never carry one over from another
village's site because the shape looked right. If the founder does not have a
number, blank is the correct answer and the page will show nothing.

**Legal status.** Entity type, jurisdiction, what the village may lawfully offer
and to whom, what the exit policy actually says, whether a membership is a
security where they are. The Content tab has a Legal and Jurisdiction Notices
section precisely because these vary by place. You are not their lawyer.

**Every decision about what the village publishes about itself.** Which pages
are public, whether the org chart is published, which modules are on, whether
the village is ready to launch. The launch vote in particular is the village's
own act, and the checklist gates the question and never the answer.

When you hit one of these, say so plainly: "I cannot know this and it is going
to appear on your public page. What is the real number?" A founder told the
truth gives you better material than one handed a guess.

---

## 9. Things you can safely do

A short list, so the rule in section 0 does not read as "do nothing".

- Read every file in this repository, including the long ones, and answer
  questions about them.
- Read `docs/PROVISIONING.md`, `docs/FORK_RUNBOOK.md` and `.env.example` and
  explain any step, variable or trap in plain language.
- Fetch the village's own public pages and `/health`, and report what they say.
- Draft copy, quest text, FAQ answers, taglines, footer sentences, alt text and
  module descriptions, and hand them over as text to paste.
- Read the founder's existing material and propose a mapping from it into the
  fields the wizard asks for.
- Explain what a screen is about to do before they click, and what it will
  change.
- Read the Journey to Launch checklist with them and explain each open item.
- Prepare an image locally, at the right size and format, and hand them the
  file to upload. Converting a logo from SVG, which the upload refuses, to a
  PNG at around 1000px, which it accepts, is the common case.
- Type a value the founder has approved into the field it belongs in, in their
  own signed-in browser, and leave Save to them. Section 0 covers where that
  line sits.
- Draft the message a founder sends each resident with their invitation link,
  and explain who needs promoting afterwards.
- Write down what they decided, so the next session starts from a record.
- Tell them when something in this document disagrees with the code, and trust
  the code.

---

## 10. Where to read next

| For | Read |
|---|---|
| Your rules, which win any conflict | `AGENTS.md` |
| Standing up a new instance, end to end | `START_HERE.md`, then `docs/PROVISIONING.md` for a hosting provider |
| The same walkthrough as a prompt to paste | `docs/FOUNDER_SETUP_PROMPT.md` |
| The long-form reference behind provisioning | `docs/FORK_RUNBOOK.md` |
| The system map | `docs/ARCHITECTURE.md` |
| The white-label architecture and swap points | `PLATFORM_FOUNDATION.md` |
| Every environment variable and what breaks without it | `.env.example` |
| What is in the current release | `CHANGELOG.md` |
| Pinning a version, channels, self-hosting an image | `ops/RELEASES.md` |
| Google sign-in setup | `docs/GOOGLE_SIGN_IN.md` |
| The three visual decisions and how they derive | `docs/DESIGN_TOKENS_SPEC.md` |
| A specific module's contract | `docs/modules/` |
| Contributor rules, gates, and the honest way to run the suite | `CLAUDE.md` |
| Building or changing a fork's modules | `.claude/skills/fork-builder/SKILL.md` |

`MODULES_MASTER_PLAN.md` Part 1 is known-stale. On how you behave, `AGENTS.md`
wins. On what the platform does, the code wins every disagreement, with
`docs/ARCHITECTURE.md` next.

---

## 11. What is unverified in this document

Written down so that a later reader can tell what was checked from what was
taken on report. Everything not listed here was read in this repository before
it was written down.

- **The order of the setup steps is changing.** A reordering is planned that
  puts the assistant connection first and moves map styling into the map. That
  is a stated intention and it is not in this tree. Section 3 is written by goal
  so it survives the change.
- **The brand.json incident.** That somebody wrote to a file of that name on the
  volume and the API kept reporting empty values is reported experience, and
  this document did not verify the event. What was verified is the part that
  matters: no code in this tree reads a file of that name, and the brand record
  is the `app_config` row.
- **`project.fiatCurrency` was wrong here and is now corrected.** An earlier
  version of this section said the key had no reader. It has three, reached
  through `defaultDisplayCurrency()` rather than by its own name, which is why a
  grep for the key found nothing. Section 6 carries the corrected account and
  names each reader. The lesson generalises: a grep for a config key finds the
  callers that name it and misses every one that reads it through a helper.
  `project.country` was rechecked at the same time and is genuinely dead.
- **Whether the acres label has been fixed.** Section 8 describes a master plan
  tile hardcoded to "Total Acres" while the Settings note box invites hectares.
  Both halves were read in this tree. A separate lane was reported to be fixing
  the rendering, and this document did not verify whether that landed. Read the
  tile before advising, which is what section 8 tells you to do anyway.
- **The paths this document names are now covered by the CI link check.** This
  file is in the `DOCS` list in `scripts/check-doc-links.mjs`, so every
  repo-relative path it names is resolved on every build and a rename that
  breaks one fails the gate. Three references were dead when the check was first
  pointed at this file. Two of them named the brand overlay file that does not
  exist, which is the whole point of the section naming it, so they are written
  in plain text now rather than as code. The gate reads a backticked filename as
  a route it must resolve, and it is right to. What it does not check: anchors,
  external links, and whether a path that resolves still holds what this
  document says it holds.
- **Deployment specifics vary by village.** The `/app/data` mount path is read
  from this repository's own `Dockerfile` and `docker-compose.yml`. Service
  names on a hosting provider are each village's own, and a village deploying
  its own fork builds it from that fork. Check `ops/RELEASES.md` for the image
  path.
