# Provisioning a new instance

This is the walkthrough for standing up one running village on this platform,
from nothing to a working instance with your own name on it. It is distilled
from `docs/FORK_RUNBOOK.md`, which is the long-form reference. If a step here
seems thin, that document has the reasoning behind it.

Two paths exist and both end at the same running platform:

- **Self-host.** You (or your own technical helper) hold the Railway account,
  the domain, and every key. ReGen Civics supports the code; you run it.
- **ReGen-hosted.** ReGen Civics holds the Railway account and runs the
  instance for you, for a fee. You still hold your own Resend and Stripe
  accounts if you use them, because those are your relationships with your
  members, not ReGen's.

Every instance runs the same code from the same repository. Nobody creates a
copy or a fork of it (`docs/ARCHITECTURE.md`: "a fork inherits the platform
by pulling, not by find-and-replace"). What makes your instance yours is its
own database, its own domain, and its own environment variables, set in the
steps below. Your village's name, tagline, colours and logo are not part of
any of that: they live in the database and you set them in step 7, after your
first login.

If you are a founder working through this with your own Claude session,
paste `docs/FOUNDER_SETUP_PROMPT.md` into that session instead of reading the
steps below by hand. It walks the same path and does the typing for you.

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

Three things in this walkthrough cannot be done by any script, by Claude, or
by ReGen Civics on your behalf, because they require proving you control
something outside this platform:

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

Everything else below, a founder's own Claude session can do end to end.

## 1. Get Railway access

**Self-host:** create a Railway account if you do not have one, then create
a new project. Because nobody forks this repository, your project deploys
from the same GitHub repository every instance runs from; ask ReGen Civics
to add you as a collaborator so Railway can build from it on your behalf.

**ReGen-hosted:** ReGen Civics creates the Railway project for you. Confirm
with them that it exists before continuing, then skip to step 3; they hold
the deploy settings in step 2.

## 2. Add MySQL and a volume

In your Railway project: add a MySQL database service, and add a volume to
your app service mounted at `/app/data` (this is where member uploads live;
`server/seeds/` in the repository is never touched at deploy time). Connect
the app service to MySQL so `DATABASE_URL` is filled in for you
automatically as a service reference; you do not type this one by hand.

## 3. Generate your environment variables

Run this from a working checkout of the repository (your Claude session can
clone it if it does not already have one):

```
node scripts/fork-init.mjs --village-name "Your Village Name" \
     --admin-email you@example.org --domain your-domain.example.org
```

Leave off `--domain` if you do not have one yet; you can fill `FRONTEND_URL`
in by hand once you do. This writes a local `.env` file and prints:

- Every value it generated for you (real random secrets; it never reuses one
  across villages).
- Your one-time bootstrap password, shown once. Save it now.
- A list of every variable it could not fill in, each with the one-line
  reason from `.env.example`. That list is not a failure. It is the rest of
  this walkthrough.

`.env` is for local development only and is never deployed. Copy every value
it printed into Railway, your app service, the Variables tab, by hand or
through the Railway CLI. Production reads variables from Railway directly.

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

## 5. Deploy and run migrations

Connect the GitHub repository to your Railway service if it is not
connected already (Railway builds with nixpacks from `pnpm run build` and
starts with `node dist/index.js`; see `railway.toml`). Once the first deploy
finishes, run the database migrations against it:

```
npx tsx scripts/run-migration.ts --all
```

Point this at your Railway MySQL's connection string (Railway shows it in
the MySQL service's Connect tab; use the public proxy URL if you are running
this from outside Railway's own network). Confirm with:

```
npx tsx scripts/run-migration.ts --status
```

Then check `https://<your-domain>/health` answers `ok` and its `build` field
carries a real git SHA. A build marker that never changes means the deploy
has not actually landed yet.

## 6. Create your founder account

Open `https://<your-domain>/claim` in a browser. Enter your email and the
`ADMIN_PASSWORD` you generated in step 3, and submit.

You get a link to set your own password. If `RESEND_API_KEY` and `EMAIL_FROM`
are both set and your sender domain is verified, that link is also emailed to
you. If it was not sent, the page says so and shows you the link instead,
along with the reason nothing went out. Open it on the device you are already
using.

That page works from a phone, which matters: this step has stranded two people
so far, and both times the only way through was a terminal.

<details>
<summary>The same thing from a shell, if you would rather</summary>

```
curl -X POST https://<your-domain>/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"password":"<the ADMIN_PASSWORD you generated>","email":"you@example.org","name":"Your Name"}'
```

The response carries `claimUrl`, plus an `emailed` field and an `emailNote`
saying why nothing was sent when it reads `false`.
</details>

Either way, `ADMIN_PASSWORD` now stops working. It authenticates exactly once,
for this one call, and refuses everyone once your village has a founder.

### Set `FOUNDER_EMAILS` too, so you can never be locked out again

`ADMIN_PASSWORD` spends itself here. If you later lose access, there is nothing
left to reach for, and `forgot-password` cannot help an account that never set
a password. That is the exact hole both lockouts fell into.

Add this in Railway alongside your other variables:

```
FOUNDER_EMAILS=you@example.org
```

Any Google sign-in from a listed address that Google has verified gets the
founder role, on every sign-in rather than only the first. So if your role ever
goes missing, signing in again restores it. It needs step 6a below to be done
first.

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

### What the wizard reaches, and the nineteen pages it does not

The wizard covers the whole shell and the whole product: your header, footer,
logo, tab icon, colours, fonts, every link, every screen a signed-in member
coordinates through. Finish it and a member sees your village and nothing
else.

Nineteen public brochure pages are a separate matter, and this walkthrough
used to end without saying so. They are the story a village tells visitors who
are not members yet, and they ship as compiled pages carrying the first
village's story: its land, its history, its four journey pages, its love
letter, its reasons for being in the country it is in. Verify what yours is
showing right now with:

```
node scripts/check-brand-refs.mjs
```

Its last line counts them. As of 2026-09-02 it reads 39 references across 19
pages, and the exact list of files is the `SHOPFRONT` array in that script.

Three things are true about them and it is worth having all three:

1. **They are not a bug and no guard will ever clean them.** A village's own
   prose about its own land is supposed to carry that village's name. The
   design intent is that a fork REPLACES these pages the way it replaces its
   logo.
2. **Replacing them today needs somebody who can edit code**, which is the one
   thing the rest of this walkthrough is built to avoid. Five pieces of that
   prose have already been lifted out into Admin and you can write those now:
   the Team page, the Legal and Jurisdiction Notices, the two Love Letter
   covenant paragraphs (the ones your members are asked to sign, which
   described somebody else's jungle until they moved), the FAQs, and the
   milestones. Everything else on those pages is still compiled in.
3. **There is no switch to hide them.** They are routed and linked from the
   footer with no per-page visibility setting, so a village that has not
   rewritten them is publishing them.

Until the remaining prose moves into the database, the honest options are: ask
whoever holds your deploy to rewrite those pages before you announce your
address, or launch on the member-facing product and leave the brochure pages
unlinked in your own announcements. Say which one you picked to whoever
supports your instance, because it decides whether your public address is
ready to hand out.

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
- **`BACKUP_EXPORT_TOKEN`** is what authenticates the uploads half of your
  backup. Without it the database dump keeps succeeding and looks healthy
  while your members' uploaded files are in no backup at all. Generate it the
  same way as the other secrets and mirror it into the backup workflow.

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

Run the automated smoke test, which registers throwaway members and walks
the real product loop end to end:

```
node scripts/smoke-all-modules.mjs --base https://<your-domain> \
     --email you@example.org --password '<your real password now>'
```

Every line it prints should read as a pass. If your village publishes its
structure publicly (Admin, Org Chart, plus the `map` module), also check:

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

Deploying from the repository, as step 5 describes, keeps you on whatever is
newest. Naming a version in your deploy instead is what makes an instance
reproducible, and it is worth doing before you have members depending on it.

## Where each step's file lives

- `.env.example` names every variable this platform reads and what breaks
  without it.
- `scripts/fork-init.mjs` writes a filled-in `.env` for a new village.
- `docs/FORK_RUNBOOK.md` is the long-form reference this walkthrough was
  distilled from.
- `docs/FOUNDER_SETUP_PROMPT.md` is this same walkthrough, written for a
  founder to hand directly to their own Claude session.
- `CHANGELOG.md` is what shipped in each release, and which release is
  current.
- `ops/RELEASES.md` is how to pull a release, pin one, and read the version a
  running village reports.
