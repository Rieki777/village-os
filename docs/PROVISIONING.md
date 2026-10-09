# Provisioning a new instance

This is the walkthrough for standing up one running village on this platform,
from nothing to a working instance with your own name on it. It is distilled
from `docs/FORK_RUNBOOK.md`, which is the long-form reference. If a step here
seems thin, that document has the reasoning behind it.

This is the hosting-provider path, written for Railway. To run a village on
one computer with Docker instead, follow `START_HERE.md`, part A.

Two paths exist and both end at the same running platform:

- **Self-host.** You (or your own technical helper) hold the Railway account,
  the domain, and every key. ReGen Civics supports the code; you run it.
- **ReGen-hosted.** ReGen Civics holds the Railway account and runs the
  instance for you. ReGen Civics does not charge for hosting: accepted
  Season 2 projects are hosted free, and gifts go to CORE. You still hold your
  own Resend and Stripe accounts if you use them, because those are your
  relationships with your members, not ReGen's.

Every instance runs the same published image,
`ghcr.io/rieki777/village-os`, pinned to a release such as `1.2.0`. Nobody
needs access to the repository to run one, and nobody forks it unless their
village means to change the code. What makes your instance yours is its own
database, its own domain, and its own environment variables, set in the steps
below. Your village's name, tagline, colours and logo are not part of any of
that: they live in the database and you set them in step 7, after your first
login.

If you are working through this with your own AI assistant, paste
`docs/FOUNDER_SETUP_PROMPT.md` into it instead of reading the steps below by
hand. It walks the same path, explains each step, and runs a command only
after you say yes. Its rules are in `AGENTS.md`.

## Before you start

You need, or need to get during this walkthrough:

- A Railway account (self-host) or a confirmed arrangement with ReGen Civics
  (ReGen-hosted).
- A domain you control, or a plan to get one. You can start without one and
  add it later; some steps below note what waits on it.
- A Resend account, free tier is fine, for sending email.
- A Stripe account, only if this village will ever sell anything with a
  card. Skip it for now if you are not sure yet; nothing below depends on it
  until you reach the payments step.

## The human-only steps, named up front

Three things in this walkthrough cannot be done by any script, by an AI
assistant, or by ReGen Civics on your behalf, because they require proving you
control something outside this platform:

1. **DNS.** Pointing your domain at Railway happens in whatever service
   manages your domain's records (your registrar, Cloudflare, wherever you
   bought it). Nobody else can do this for you.
2. **Resend sender-domain verification.** Proving you own your sending
   domain by adding the SPF and DKIM records that Comms Settings (or
   resend.com/domains) shows you, wherever your domain's DNS is managed.
   Same reason: it is your domain.
3. **Creating your own Stripe account**, if you take payments. Stripe
   requires the account holder to verify their own identity and banking
   details directly with Stripe.

Your own AI assistant can help with everything else below, one step at a
time, running each only after you say yes. Secrets are the exception: you
read them from `.env` and paste them into Railway yourself, and they never
pass through the assistant (`AGENTS.md`).

## 1. Get Railway access

**Self-host:** create a Railway account if you do not have one, then create
a new project. Your service runs the published image, so it needs access to
no repository, and nobody asks ReGen Civics or anybody else for access to
`Rieki777/village-os`. A village that means to change the code forks the
repository and deploys its own fork instead (step 5).

**ReGen-hosted:** ReGen Civics creates the Railway project for you. Confirm
with them that it exists before continuing, then skip to step 3; they hold
the deploy settings in step 2.

## 2. Add MySQL, the app service and a volume

In your Railway project: add a MySQL database service; add an app service
that runs the image `ghcr.io/rieki777/village-os:1.2.0` (name a release,
never `:edge`, which is the untested tip of `main`); and add a volume to the
app service mounted at `/app/data` (this is where member uploads live;
`server/seeds/` in the repository is never touched at deploy time). Connect
the app service to MySQL so `DATABASE_URL` is filled in for you
automatically as a service reference; you do not type this one by hand.

## 3. Generate your environment variables

Run this on your own computer, from the starter kit or a clone of the
repository (`START_HERE.md`, step 2, says how to get either). It needs
Node 22 or newer:

```
node scripts/fork-init.mjs --village-name "Your Village Name" \
     --admin-email you@example.org --domain your-domain.example.org
```

Leave off `--domain` if you do not have one yet; you can fill `FRONTEND_URL`
in by hand once you do. This writes a local `.env` file and prints:

- The name of every value it generated for you (real random secrets; it
  never reuses one across villages), without the value itself.
- Where your one-time founder password is: the `ADMIN_PASSWORD` line of
  `.env`. It is never printed; open the file yourself to read it.
- A list of every variable it could not fill in, each with the one-line
  reason from `.env.example`. That list is not a failure. It is the rest of
  this walkthrough.

`.env` does not deploy on its own. Open it yourself and copy each value into
Railway, your app service, the Variables tab, by hand. Production reads
variables from Railway directly. Only `DATABASE_URL` is needed for the server
to start; a usable village also needs `AUTH_TOKEN_SECRET`, `ADMIN_PASSWORD`
and `FRONTEND_URL`, and you should copy every other value the script filled
in as well, including `MEMBER_SECRETS_KEY`, `VILLAGE_SECRETS_KEY`,
`BREAK_GLASS_ADMIN_EMAIL` and `BACKUP_EXPORT_TOKEN`.

### The one generated value that decides whether Admin can hold your keys

Two of the generated values are sealing keys, and neither can be recovered
once anything has been stored under it: `MEMBER_SECRETS_KEY` and
`VILLAGE_SECRETS_KEY`. Set each once here and leave it alone.

`VILLAGE_SECRETS_KEY` is the one to check before you reach step 4 or step 8.
It encrypts your own third-party keys where this platform stores them: your
Stripe secret key, your Stripe and Riverside webhook secrets, your Resend
key, your Anthropic key. Every later step that says "or from Admin,
Integrations" depends on it. With it unset, that panel refuses every save
with "this deployment has no village-secrets key", and each of those keys has
to be set in Railway instead. Clearing a key from the panel keeps working
either way, so a value you need to remove is never stuck.

Put it on the app service as the 64 characters alone: no quotes, no spaces,
no `VILLAGE_SECRETS_KEY=` in front. Press Deploy if Railway shows staged
changes, and wait for the new deployment to read Active. If the panel still
refuses, its banner and the `[identity]` line in the deploy log name what is
wrong with the value without printing any of it. `docs/FORK_RUNBOOK.md`,
"Setting VILLAGE_SECRETS_KEY on Railway, and when it is set but still
refused", gives the fix for each answer.

**Self-host:** you generate it in this step and you hold it. A copy of your
database carries none of your integration keys in a usable form.

**ReGen-hosted:** ReGen Civics sets it in the Railway project they hold. Ask
them to confirm it is set before you try to save a key from the panel.
Whoever holds the Railway project holds this key, so on this path ReGen can
read the keys you store through it. What it buys you is that a database
backup on its own carries nothing usable. Self-host if your village needs to
hold the key itself.

## 4. Set up email

Create a Resend account (or use your existing one). Everything after that
is done from Admin, Comms, Settings once you have claimed your founder
account in step 6, and needs no Railway access. Its checklist takes your
Resend key, adds your sending domain and shows the exact SPF and DKIM
records to add wherever your domain's DNS lives, checks verification with
Resend, sets the sender name and address, connects delivery reports with
one button, takes the postal address for the footer, and sends you a test
email that counts once Resend reports it delivered. Adding the DNS records
waits on DNS access, which is human-only (see above). A Resend key that can
only send gets the same steps to do by hand in Resend's dashboard.

**The trap:** Resend accepts mail through an unverified domain and answers
HTTP 200 as if it worked. Nothing arrives, with no error and no bounce.
Comms Settings marks the domain verified only when Resend says so, and
refuses a sender address that is not on it. Until then, do not trust that
any email, including your own founder claim link in step 6, is actually
being delivered.

To set email up before you sign in, set `RESEND_API_KEY` and `EMAIL_FROM`
in Railway instead. Both still work, and whatever is saved in Comms Settings
takes over from them. Saving the key from the admin panel needs
`VILLAGE_SECRETS_KEY` from step 3 and refuses the save without it. With no
sender set anywhere, nothing is sent: each email is recorded as not sent.

## 5. Deploy; the server migrates itself

Deploy the app service. It runs the image you named in step 2: Railway pulls
it and starts it, and nothing is built. A village that changes the code
deploys its own fork instead, by connecting that fork to the service; Railway
then builds the repository's `Dockerfile` (`railway.toml` sets
`builder = "DOCKERFILE"`), which is the same recipe the published image is
built from.

**The server applies every database migration itself, at boot, before it
listens.** There is no migrate step to run. A first boot on an empty database
can take several minutes, so give it up to fifteen before you worry. To look
at what has been applied, without changing anything:

```
npx tsx scripts/run-migration.ts --status
```

Point this at your Railway MySQL's connection string (Railway shows it in
the MySQL service's Connect tab; use the public proxy URL if you are running
this from outside Railway's own network).

Then check `https://<your-domain>/health` answers `ok` and its `build` field
carries a real git SHA. A build marker that never changes means the deploy
has not actually landed yet.

## 6. Create your founder account

Open `https://<your-domain>/claim` in a browser. Enter your email, your name,
and the `ADMIN_PASSWORD` from the `.env` that step 3 wrote (open the file
yourself to read it), and submit.

You get a link to set your own password. If `RESEND_API_KEY` and `EMAIL_FROM`
are both set and your sender domain is verified, that link is also emailed to
you. If it was not sent, the page says so and shows you the link instead,
along with the reason nothing went out. Open it on the device you are already
using.

That page works from a phone, which matters: this step has stranded two people
so far, and both times the only way through was a terminal.

<details>
<summary>The same thing from a shell, for anybody without a browser</summary>

```
curl -X POST https://<your-domain>/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"password":"<the ADMIN_PASSWORD you generated>","email":"you@example.org","name":"Your Name"}'
```

The response carries `claimUrl`, plus an `emailed` field and an `emailNote`
saying why nothing was sent when it reads `false`.
</details>

Either way, `ADMIN_PASSWORD` now stops working. Once your village has a
founder it refuses everyone except the account named in
`BREAK_GLASS_ADMIN_EMAIL`, and that account still has to give it.

### Keep a way back in

`forgot-password` cannot help an account that never set a password, which is
the exact hole both lockouts fell into. Two variables close it:

- **`BREAK_GLASS_ADMIN_EMAIL`**, which `fork-init` set to your `--admin-email`.
  Keep it, and keep `ADMIN_PASSWORD`, in Railway: if you are ever locked out,
  that one address can still claim the founder role at `/claim` with the same
  password.
- **`FOUNDER_EMAILS=you@example.org`**, once Google sign-in works (step 6a).
  A Google sign-in from a listed address that Google has verified gives an
  existing account the founder role back, on every sign-in, so a role that
  goes missing returns when you sign in again. On a default invite-only
  village it cannot create a founder from nothing; the claim above does that.

## 6a. Google sign-in, which ReGen Civics can host for you

Two ways to switch this on. Both set the same three variables, and the code
does not know or care which you used.

**Ask ReGen Civics for the shared credentials (start here).** We hold one
Google client with every incubator village's callback address registered on it.
Send us your village's domain, and we send back a `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` to paste into Railway. Your Google Cloud Console work is
zero. Two things to know while you use them: the Google consent screen will say
**ReGen Civics** rather than your village's name, and the secret is shared with
the other incubator villages, so it is right for a village being designed and
wrong for one holding a real community's accounts.

**Register your own client (do this before you go live).** Ten minutes in
Google Cloud Console, and then the consent screen carries your village's name,
the secret is yours alone, and you can change your own domain without asking
anybody. Full steps in `docs/GOOGLE_SIGN_IN.md`.

Moving from the first to the second is a two-variable change and no code, so
starting on ours costs you nothing later.

Skipping this entirely is fine. Your village works on email and password, and
no Google button is drawn where it would not work.

## 7. Make it yours

Log in with the password you just set, go to Admin, Make This Yours, and
work through the wizard: your village's name, tagline, what a member is
called, main site and events links; your pictures (logo, hero images); your dues and
budgets; your page copy; your map styling. Every field left blank inherits
the platform's own default rather than showing something wrong, so you can
do this in one sitting or spread it over a week.

This is the only place any of this gets set. Nothing in the repository, and
nothing this walkthrough has had you type into Railway, carries your
village's name or look.

Then open the Launch Plan (`/journey-to-launch`). It lists what is still
missing before launch, including your currency and your timezone, which both
ship blank on purpose.

### What the wizard reaches, and the first village's own pages

The wizard covers the whole shell and the whole product: your header, footer,
logo, tab icon, colours, fonts, every link, every screen a signed-in member
coordinates through. Finish it and a member sees your village and nothing
else.

The first village's own story pages are switched off in yours. Eighteen
public pages and one component tell that village's story: its four journey
pages, its master plan, its team, its housing, its visit and membership
forms, its rights pages, its build history. They are compiled into every
image, and the exact list is the `SHOPFRONT` array in
`scripts/check-brand-refs.mjs`. One `app_config` document decides whether a
village serves them:

- **`brochure-pages`**, read once at boot. `{"enabled": true}` serves them;
  absent, or anything else, means off. A new village has no such document, so
  it starts with them off and has nothing to set.
- **With them off**, each of their routes answers not-found; the menus, the
  footer, the sitemap and the mobile shortcut drop their links; and `/` shows
  a plain welcome page carrying your village's own name
  (`client/src/pages/VillageWelcome.tsx`).
- **A village that already served them keeps them.** Migration
  `drizzle/0225_a_village_keeps_the_pages_it_already_served.sql` wrote the
  document ON in every database that already had members when it ran, which
  is how Amora keeps its pages.

Do not turn them on for your village: they tell another village's story. A
village that has rewritten them in its own fork turns them back on as
`shared/brochure.ts` describes.

Neutral starting text for your legal and covenant wording, with placeholders
for your village's name, legal entity, data controller and contact, is in
`server/seeds/templates/`. The first village's own wording is in
`server/seeds/amora/`. Nothing loads either automatically.

## 8. Payments, if you are selling anything

Skip this section entirely if this village will not take card payments yet.

Create your own Stripe account (human-only, see above), then set
`STRIPE_SECRET_KEY` in Railway, or from Admin, Integrations if
`VILLAGE_SECRETS_KEY` is set (step 3). In your Stripe dashboard,
under Developers, Webhooks, create an endpoint at
`https://<your-domain>/api/webhooks/stripe` subscribed to
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`invoice.paid`, `charge.refunded` and `charge.dispute.created`, then set
`STRIPE_WEBHOOK_SECRET` to that endpoint's signing secret. All five events
matter: skipping `invoice.paid` means a subscription charges a member every
period and grants them nothing past the first one, and skipping
`checkout.session.async_payment_succeeded` means a delayed payment method
(bank debit, ACH) never confirms at all. Test with `stripe listen --forward-to`
before you tell anyone this is live.

## 9. Optional integrations

Everything else in `.env.example` past this point is optional, and the
platform tells you plainly when one is missing rather than failing
silently: the assistant hides without `ANTHROPIC_API_KEY`, the Hypha
governance surfaces hide without `hypha.org_url` (set from Admin, not an
environment variable), and so on. Add these when you actually want the
feature, not before. `docs/FORK_RUNBOOK.md`'s environment variable table has
the full reasoning for each one.

`node scripts/fork-init.mjs` groups these for you: it prints the handful that
are genuinely your next steps, then names the rest by feature so you can come
back to one when you want it.

Two of these are worth knowing about early, because their failure is quiet:

- **Aerial imagery for the Living Map** needs `SATELLITE_PROVIDER` set to one
  of five sources, plus that source's own key. Start with `village-upload`,
  which takes your own photograph through Admin and needs no account, no key
  and no third-party licence. Unset, the land page says nothing is configured
  rather than showing a picture of somewhere else.
- **`BACKUP_EXPORT_TOKEN`** is what authenticates the uploads half of the
  encrypted GitHub Actions backup (`ops/backup/db-backup.yml`,
  `docs/RUNBOOK.md`). `fork-init` generates it with the other secrets. Without
  it the database dump keeps succeeding and looks healthy while your members'
  uploaded files are in no backup at all. Run that workflow only from a
  **private** repository: on a public one, anybody can download its artifacts
  and read its logs. On Railway, your first backup is Railway's own: its
  database backups and volume snapshots.

If you ever suspect `.env.example` has fallen behind the code, check rather
than guess:

```
node scripts/fork-env-audit.mjs
```

It fails when the server reads a variable the template does not name. That had
happened to 25 variables by 2026-09-02, seven of them founder-facing, and eight
of the 25 were unreachable by grep as well, because the code reads them through
a string (`keyEnv: "MAPBOX_TOKEN"`) rather than as `process.env.MAPBOX_TOKEN`.

## 10. Confirm it actually works

Sign in with the password you set, and open the Launch Plan
(`/journey-to-launch`) once more: what it still lists is what stands between
you and launch. Then invite your first member from your own profile. Members
join by invitation link (`/register?invite=...`): one use each, valid for
fourteen days. Somebody without a link can ask to join at
`/request-membership`, and the request lands in your Admin. That first member
arriving is the real test of your email and your sign-up together.

`scripts/smoke-all-modules.mjs` is a developer check and not a setup step. It
registers throwaway accounts with no invitation, so a village on the default
`membership.invite_only` answers it with 403. Run it only against a scratch
instance with `membership.invite_only` set to false.

If your village publishes its structure publicly (Admin, Org Chart, plus the
`map` module), also check:

```
curl -s https://<your-domain>/.well-known/village.json | jq '.supports, .publicKey.kid'
```

## For developers testing locally

This walkthrough provisions a live instance; it does not cover running the
automated test suite. If you or a technical helper does run `pnpm test`
locally, know this first: without `TEST_DATABASE_URL` set in a local `.env`,
roughly a third of the suite (every database-backed test file, 91 of them)
skips itself. The run now FAILS rather than exiting 0, and prints what it
skipped and why, because a green result on an unrun third is not something
anyone can tell apart from a real one. If you want the smaller suite anyway,
run `ALLOW_NO_TEST_DB=1 pnpm test` and read the pass and skip counts as the
result.

## Which version you are running, and how to hold still

The platform ships as numbered releases, each one a container image published
at `ghcr.io/rieki777/village-os`. The package is open, so a self-hosted
village can pull and run a named version with no account and no access token.

- `CHANGELOG.md` says what each release contains, in plain language. Its
  newest entry is the current release.
- `ops/RELEASES.md` covers the rest: the `:stable` and `:edge` channels, the
  `docker run` line for a self-hosted village, how to ask a running village
  which version it is, and how to pin a version so your village stays put
  while others move.

Step 2 pinned a release, such as `1.2.0`, and that pin is what keeps your
village still while others move. `:stable` follows the newest release, and
`:edge` is the untested tip of `main`, never for a village. A fork deployed
from its own repository runs whatever its branch holds. Read
`docs/UPGRADING.md` before you change the tag, every time.

## Where each step's file lives

- `.env.example` is the reference for every variable: what it does and what
  breaks without it.
- `scripts/fork-init.mjs` writes a filled-in `.env` for a new village.
- `docs/FORK_RUNBOOK.md` is the long-form reference this walkthrough was
  distilled from.
- `docs/FOUNDER_SETUP_PROMPT.md` is this same walkthrough, written for a
  founder to hand directly to their own AI assistant; `AGENTS.md` holds that
  assistant's rules.
- `CHANGELOG.md` is what shipped in each release, and which release is
  current.
- `ops/RELEASES.md` is how to pull a release, pin one, and read the version a
  running village reports.
