/**
 * The Go live plan: one description of everything a founder has to do to put
 * their village on the internet, and one renderer that turns it into a file
 * they can save.
 *
 * WHY THIS IS DATA AND NOT JSX. The wizard's Go live step used to be six
 * hand-written code blocks inside `client/src/pages/Admin.tsx`. A founder read
 * them on screen and typed them out by hand, and nothing they read could leave
 * the page. The founder's own words: "This should also be a downloadable
 * package". A download built from a second copy of those blocks would be two
 * sets of instructions with one owner and no gate, and this repository has
 * already paid for that shape (the setup checklist and the Admin shell each
 * held their own step list until `setupProgress.ts` merged them). So the steps
 * live here once, `GoLivePackagePanel.tsx` renders them, and
 * `renderGoLivePackage` serialises the same objects into markdown. Neither can
 * move without the other, and `goLivePlan.test.ts` fails if one does.
 *
 * WHY MARKDOWN AND NOT A ZIP. Three audiences read this file and all three
 * read text: the founder, a developer they hand it to, and an LLM agent they
 * paste it into. A zip would need an archiver in the browser bundle and would
 * hand all three of them a file to unpack first. The repository's own handoff
 * documents (`docs/PROVISIONING.md`, `docs/FOUNDER_SETUP_PROMPT.md`) are
 * markdown for the same reason.
 *
 * WHAT IS AND IS NOT ASSERTED HERE. Every claim below was read out of this
 * repository on 2026-09-02 and each entry names where. Where a thing could not
 * be confirmed from the repository, `certainty: "unverified"` says so on the
 * entry itself and the rendered file prints the word, because a checklist that
 * states a guess in the same voice as a measurement is worse than a checklist
 * with a hole in it.
 *
 * SIX THINGS THE OLD ON-SCREEN STEPS GOT WRONG, all corrected below and all
 * still live in Admin.tsx until this panel replaces that block:
 *
 *   1. It opened with `railway up --ci`. `docs/PROVISIONING.md` step 5 has
 *      Railway building from the connected GitHub repository, and
 *      `docs/ARCHITECTURE.md` invariant 11 records that `railway up` stamps
 *      the build marker `-dev`, so `/health` cannot say which commit is live
 *      after one.
 *   2. It told founders to set `JOURNEY_PASSWORD`. `.env.example` records that
 *      variable as retired: it gated a screen that no longer exists.
 *   3. It named four variables and left out the four the server actually
 *      refuses to run without.
 *   4. It said the Resend key is set under "Notifications". There is no such
 *      tab. `adminNavGroups.ts` has Integrations, and `EmailSettingsTab` says
 *      in its own copy that the keys moved there.
 *   5. It told founders to edit `client/index.html` for `og:image`,
 *      `twitter:image` and the favicon. That file ships byte for byte to every
 *      deployment and says so at the top; it carries neither of those two tags
 *      today, and `client/src/App.tsx` repaints the favicon from the brand
 *      record at runtime, which is what step 2 of this same wizard sets.
 *   6. It had no prerequisites at all. Every command in it assumed an account,
 *      a domain and a DNS record that nothing on the page mentioned.
 */

/** Whether an entry was read out of this repository or is an open question. */
export type GoLiveCertainty = "verified" | "unverified";

/** How hard a prerequisite is. A conditional one carries its condition in `when`. */
export type GoLiveNeed = "required" | "recommended" | "conditional" | "optional";

export interface GoLivePrereq {
  id: string;
  name: string;
  need: GoLiveNeed;
  /** The condition, on a conditional entry. */
  when?: string;
  /** What this thing is FOR, in the founder's terms. */
  what: string;
  /** What it costs, honestly, including saying when the figure is unknown. */
  cost: string;
  /** Where to go to get it. */
  where?: string;
  certainty: GoLiveCertainty;
  /** Where in this repository the claim was read, or what is unconfirmed. */
  note?: string;
}

export interface GoLiveCommand {
  /** The command, placeholders in angle brackets. */
  code: string;
  /** What it does, or why it is optional. */
  note?: string;
  /** True when this repository does not corroborate the exact syntax. */
  unverified?: boolean;
}

export interface GoLiveStep {
  id: string;
  n: number;
  title: string;
  /** Why the step exists. One or two sentences. */
  why: string;
  /** True when nobody can do this on the founder's behalf. */
  humanOnly?: boolean;
  points: readonly string[];
  commands?: readonly GoLiveCommand[];
}

export interface GoLiveEnvVar {
  name: string;
  need: GoLiveNeed;
  /** The condition, on a conditional variable. */
  when?: string;
  /** What breaks without it, from `.env.example`. */
  breaks: string;
  /** Railway, this wizard, or Admin, Integrations. */
  where: string;
}

export interface GoLiveReference {
  path: string;
  what: string;
}

/* ── What a founder needs before any command in this file can run ─────────── */

export const GO_LIVE_PREREQS: readonly GoLivePrereq[] = [
  {
    id: "repo-access",
    name: "A GitHub account, and access to the platform repository",
    need: "conditional",
    when: "you deploy from the repository, which is the documented path",
    what:
      "Railway builds this platform straight from its GitHub repository, so the Railway " +
      "account has to be linked to a GitHub account that can see it. No village keeps its " +
      "own copy of the code; every one of them runs the same repository, and you ask ReGen " +
      "Civics to add you as a collaborator on it.",
    cost: "Free.",
    where: "github.com",
    certainty: "verified",
    note:
      "docs/PROVISIONING.md steps 1 and 5. One path skips GitHub entirely: ops/RELEASES.md " +
      "publishes the platform as a container image at ghcr.io/rieki777/village-os and states " +
      "the package is open, so a self-hosted village can pull and run a named version with " +
      "no account and no access token.",
  },
  {
    id: "railway",
    name: "A Railway account",
    need: "required",
    what:
      "Railway runs three things for this village: the server, its MySQL database, and the " +
      "disk that holds every file a member uploads. It is also where the environment " +
      "variables live, because production reads them from Railway and never from a file in " +
      "the repository.",
    cost:
      "Railway charges for what a deployment uses. This repository records no figure, so " +
      "read Railway's own pricing before you commit to it.",
    where: "railway.com",
    certainty: "verified",
    note:
      "docs/PROVISIONING.md step 1. On the ReGen-hosted path ReGen Civics holds the Railway " +
      "account and you skip this one.",
  },
  {
    id: "railway-cli",
    name: "The Railway CLI",
    need: "optional",
    what:
      "Every variable and every setting in this file can be typed into Railway's web " +
      "dashboard. The CLI does the same work from a terminal, which is what an agent doing " +
      "the typing for you would reach for.",
    cost: "Free.",
    certainty: "verified",
    note:
      "docs/PROVISIONING.md step 3 says the values go into Railway 'by hand or through the " +
      "Railway CLI'. The old Go live screen opened with a CLI command, which read as though " +
      "the CLI were the only way in. It is one of two.",
  },
  {
    id: "checkout",
    name: "A checkout of the repository, and Node.js 22 to run it",
    need: "required",
    what:
      "One command in this file generates your secrets: scripts/fork-init.mjs. It runs on " +
      "your own machine against a clone of the repository and writes a local .env. Nothing " +
      "it writes is deployed. The values it prints are what you paste into Railway.",
    cost: "Free.",
    certainty: "verified",
    note: "The repository pins Node 22 in .node-version, and CI runs that same version.",
  },
  {
    id: "domain",
    name: "A domain, from a registrar",
    need: "required",
    when: "before the village has an address of its own. You can deploy first and add it later",
    what:
      "FRONTEND_URL, every link in an outgoing email, the Google sign-in callback address " +
      "and the Stripe webhook endpoint are all built from your domain.",
    cost: "A yearly fee set by whoever you buy it from. This repository records no figure.",
    certainty: "verified",
    note: "docs/PROVISIONING.md, 'Before you start'.",
  },
  {
    id: "dns",
    name: "Access to that domain's DNS records",
    need: "required",
    what:
      "Two separate jobs need records here. Pointing the domain at Railway takes a CNAME " +
      "Railway hands you. Proving to Resend that you own the sending domain takes the SPF " +
      "and DKIM records Resend hands you. Both happen wherever your domain's records already " +
      "live: your registrar, Cloudflare, whoever holds them.",
    cost:
      "Free wherever the records already live. Nothing in this platform requires a " +
      "particular DNS provider.",
    certainty: "verified",
    note:
      "docs/PROVISIONING.md names DNS and Resend domain verification as human-only. They " +
      "prove you control something outside this platform, so nobody can do them for you.",
  },
  {
    id: "resend",
    name: "A Resend account",
    need: "recommended",
    what:
      "Every email this village sends goes through Resend: your own founder claim link, " +
      "member notifications, digests. With no key, email is skipped silently, logged and " +
      "never sent, and nothing on screen says so.",
    cost: "The free tier is enough to start.",
    where: "resend.com",
    certainty: "verified",
    note:
      "docs/PROVISIONING.md step 4 and .env.example. The trap they record: Resend answers " +
      "HTTP 200 for a sender domain you have not verified and delivers nothing, with no " +
      "error and no bounce. Comms Settings checks the domain with Resend and refuses a " +
      "sender address that is not on it.",
  },
  {
    id: "stripe",
    name: "A Stripe account",
    need: "conditional",
    when: "this village will sell anything with a card",
    what:
      "Card checkout, memberships, paid stays. Without it, card checkout answers an honest " +
      "503 and the manual payment path still grants credits.",
    cost: "Stripe's own per-transaction fee. This repository records no figure.",
    where: "stripe.com",
    certainty: "verified",
    note:
      "Human-only: Stripe requires the account holder to verify their own identity and " +
      "banking details directly with Stripe (docs/PROVISIONING.md).",
  },
  {
    id: "anthropic",
    name: "An Anthropic API key",
    need: "optional",
    what:
      "Powers the village assistant: guided proposals, the launch guide, the map concierge " +
      "and call synthesis. Without a key the assistant hides itself and every other part of " +
      "the platform keeps working.",
    cost: "Anthropic's own usage-based pricing. This repository records no figure.",
    certainty: "verified",
    note:
      ".env.example, ANTHROPIC_API_KEY. It can be set from Admin, Integrations after login " +
      "instead of in Railway, which needs VILLAGE_SECRETS_KEY set first.",
  },
  {
    id: "agent-browser",
    name: "Browser control for your LLM",
    need: "conditional",
    when: "your own LLM agent is going to do the clicking instead of you",
    what:
      "Four surfaces in this file have no command-line path that this repository documents: " +
      "Railway's Variables and Networking pages, your registrar's DNS records, " +
      "resend.com/domains, and the Stripe dashboard. An agent working through those needs to " +
      "drive a real browser session you are already signed into. For Claude that is the " +
      "Chrome extension.",
    cost: "Depends on the plan your assistant runs on. This repository records no figure.",
    certainty: "unverified",
    note:
      "Marked unverified on purpose. No founder has been recorded standing a village up this " +
      "way and nothing in this repository tests it, so treat the browser path as the part to " +
      "watch. One rule does carry over from docs/FOUNDER_SETUP_PROMPT.md: do not paste a " +
      "password or an API key into a chat window. Sign the agent into the account, or type " +
      "the secret into the dashboard yourself.",
  },
];

/* ── The steps ────────────────────────────────────────────────────────────── */

export const GO_LIVE_STEPS: readonly GoLiveStep[] = [
  {
    id: "project",
    n: 1,
    title: "Get the Railway project ready",
    why:
      "Self-host means you create the Railway project and hold it. ReGen-hosted means ReGen " +
      "Civics creates it and holds the deploy settings. Both paths end at the same running " +
      "platform.",
    points: [
      "Create a Railway project, then connect the platform repository as its source.",
      "Ask ReGen Civics for collaborator access to the repository, because no village keeps its own copy of the code.",
      "On the ReGen-hosted path, confirm with them that the project exists before you go further.",
    ],
  },
  {
    id: "database",
    n: 2,
    title: "Add MySQL and a data volume",
    why:
      "The database holds the village. The volume holds every file a member uploads. A " +
      "deployment with no volume loses those files on the next deploy.",
    points: [
      "Add a MySQL service to the project.",
      "Add a volume to the app service, mounted at /app/data.",
      "Connect the app service to MySQL so DATABASE_URL fills itself in as a service reference. You never type that one by hand.",
    ],
    commands: [
      {
        code: "railway volume add --mount-path /app/data",
        note:
          "The dashboard is the documented path (docs/PROVISIONING.md step 2). This CLI form " +
          "came off the old Go live screen and nothing in this repository confirms the flag " +
          "spelling, so check it against Railway's own CLI help before you trust it.",
        unverified: true,
      },
    ],
  },
  {
    id: "generate",
    n: 3,
    title: "Generate your environment variables",
    why:
      "One script writes every secret this platform needs, correctly formatted, and prints " +
      "an honest list of what it could not fill in and why.",
    points: [
      "Leave off --domain if you do not have one yet. FRONTEND_URL can be filled in by hand later.",
      "Save the one-time bootstrap password it prints. It is shown once and you need it in step 8.",
      "MEMBER_SECRETS_KEY and VILLAGE_SECRETS_KEY are sealing keys. Set each once and leave it alone; rotating either makes everything already stored under it unreadable.",
      "The list of variables it leaves blank is not a failure report. It is the rest of this file.",
    ],
    commands: [
      {
        code:
          'node scripts/fork-init.mjs --village-name "<your village name>" \\\n' +
          '     --admin-email "<you@example.org>" \\\n' +
          '     --domain "<your-domain.example.org>"',
        note: "Writes a local .env and prints every value it generated.",
      },
    ],
  },
  {
    id: "variables",
    n: 4,
    title: "Put those values into Railway",
    why:
      "Production reads its variables from Railway. The .env file the last step wrote is for " +
      "local development and is never deployed.",
    points: [
      "Railway, your app service, the Variables tab. Paste in what fork-init printed.",
      "Do not set JOURNEY_PASSWORD. The old version of this screen asked for it; .env.example records it as retired, gating a screen that no longer exists.",
      "The variable table further down says which ones the server refuses to start without.",
    ],
    commands: [
      {
        code:
          "railway variables \\\n" +
          '  --set "AUTH_TOKEN_SECRET=<from fork-init>" \\\n' +
          '  --set "ADMIN_PASSWORD=<from fork-init>" \\\n' +
          '  --set "FRONTEND_URL=https://<your-domain>"',
        note: "The CLI form. The Variables tab does the same job with no terminal.",
      },
    ],
  },
  {
    id: "deploy",
    n: 5,
    title: "Deploy, and watch the first boot",
    why:
      "The server applies every pending schema migration itself on the way up, so there is " +
      "no separate migration step and no approval to give. A boot that cannot apply one " +
      "binds its port anyway and serves a plain-language maintenance page, so the village " +
      "never goes dark and silent on a half-applied schema.",
    points: [
      "The first boot against an empty database was measured at 228 seconds on a cold server, and at 37 seconds against the same server warm. railway.toml gives the health check 900 seconds for that reason. Give it fifteen minutes before deciding something is wrong.",
      "/health answers with the build marker, so a green health check also says which commit is live. A build field that never changes means the deploy has not landed.",
      "railway up is the manual deploy path and it stamps that marker -dev, so /health cannot confirm the commit after one. Deploy from the connected repository where you can.",
    ],
    commands: [
      {
        code: "curl -s https://<your-domain>/health",
        note: "Should answer ok, with a real git SHA in its build field.",
      },
      {
        code: "npx tsx scripts/run-migration.ts --status",
        note: "Optional. Confirms what the boot already applied.",
      },
    ],
  },
  {
    id: "domain",
    n: 6,
    title: "Point your domain at the deployment",
    why: "Until this is done the village answers only at whatever address Railway gave it.",
    humanOnly: true,
    points: [
      "Railway dashboard, your service, Settings, Networking, add your custom domain.",
      "Add the CNAME Railway gives you wherever your domain's DNS records live.",
      "Set FRONTEND_URL to the same address. Without it no cross-site browser request is allowed, and every link in an outgoing email falls back to whatever address the server happened to be reached at.",
    ],
  },
  {
    id: "email",
    n: 7,
    title: "Turn on email",
    why:
      "Your own founder claim link is the first email this village sends. If email is not " +
      "working, that link is the thing you lose.",
    humanOnly: true,
    points: [
      "Everything email needs is set up in one place once you are signed in: Admin, Comms, Settings (/admin?tab=comms-settings). Its checklist takes your Resend key, adds your sending domain and shows the DNS records to copy, checks verification with Resend, sets the sender name and address, connects delivery reports with one button, takes the postal address for the footer, and sends you a test email that counts once Resend reports it delivered.",
      "You can claim your founder account in the next step before any of this. If email is not working yet, the claim page shows you the link and the reason nothing was sent.",
      "Resend accepts mail through an unverified domain and answers HTTP 200 as if it worked. Nothing arrives. Comms Settings marks the domain verified only when Resend says so, and refuses a sender address that is not on it.",
      "RESEND_API_KEY and EMAIL_FROM still work as Railway variables, and whatever is saved in Comms Settings takes over from them. Saving the key there needs VILLAGE_SECRETS_KEY set.",
    ],
  },
  {
    id: "claim",
    n: 8,
    title: "Claim your founder account",
    why:
      "ADMIN_PASSWORD authenticates exactly once, for this one call, and refuses everyone " +
      "after the village has a founder.",
    points: [
      "Open https://<your-domain>/claim, enter your email and the ADMIN_PASSWORD from step 3, and submit. That page works from a phone, which has mattered: this step has stranded two people so far.",
      "You get a link to set your own password. If email is working it is also sent to you; if it was not sent, the page shows you the link and the reason.",
      "Then set FOUNDER_EMAILS to your own address. ADMIN_PASSWORD is spent, and forgot-password cannot help an account that never set a password. A listed address that Google has verified gets the founder role on every sign-in, so a role lost to a restore comes back by signing in again.",
    ],
    commands: [
      {
        code:
          "curl -X POST https://<your-domain>/api/admin/bootstrap \\\n" +
          '  -H "Content-Type: application/json" \\\n' +
          '  -d \'{"password":"<your ADMIN_PASSWORD>","email":"<you@example.org>","name":"<Your Name>"}\'',
        note:
          "The same thing from a shell. The response carries claimUrl, and an emailNote " +
          "saying why nothing was sent.",
      },
    ],
  },
  {
    id: "brand",
    n: 9,
    title: "Make the site yours",
    why:
      "Your village's name, tagline, colours, pictures and page copy live in the database, " +
      "and this wizard is the only place any of it gets set. Nothing in the repository and " +
      "nothing you typed into Railway carries them.",
    points: [
      "Admin, Make This Yours. Steps 1 through 5 of this same wizard.",
      "Every field left blank inherits the platform's own default, so a half-finished village shows something sensible and never something wrong.",
      "The logo, footer mark and browser tab icon apply live, with no deploy.",
    ],
  },
  {
    id: "payments",
    n: 10,
    title: "Payments",
    why:
      "Only if this village will take card payments. Skip it otherwise; nothing else waits " +
      "on it.",
    points: [
      "Set STRIPE_SECRET_KEY in Railway, or from Admin, Integrations if VILLAGE_SECRETS_KEY is set.",
      "In Stripe, Developers, Webhooks, create an endpoint at https://<your-domain>/api/webhooks/stripe.",
      "Subscribe it to all five of checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, charge.refunded and charge.dispute.created. Skipping invoice.paid means a subscription charges a member every period and grants them nothing past the first one. Skipping the async one means a bank debit never confirms at all.",
      "Set STRIPE_WEBHOOK_SECRET to that endpoint's signing secret.",
    ],
  },
  {
    id: "prove",
    n: 11,
    title: "Prove it actually works",
    why:
      "The smoke test registers throwaway members and walks the real product loop end to end " +
      "against your live domain.",
    points: [
      "Every line it prints should read as a pass.",
      "If your village publishes its structure publicly, the well-known document is the second check.",
    ],
    commands: [
      {
        code:
          "node scripts/smoke-all-modules.mjs --base https://<your-domain> \\\n" +
          "     --email <you@example.org> --password '<your real password>'",
      },
      { code: "curl -s https://<your-domain>/.well-known/village.json" },
    ],
  },
  {
    id: "metadata",
    n: 12,
    title: "The social image and the tab icon",
    why:
      "The old version of this step told founders to edit client/index.html. That file is " +
      "neutral by construction: it ships byte for byte to every deployment of this platform, " +
      "so nothing in it may name a village or claim a canonical URL.",
    points: [
      "Your browser tab icon is set in step 2 of this wizard, under Pictures. The page repaints it from your brand record as it loads.",
      "client/index.html carries no og:image and no twitter:image tag today, so there is nothing there to point at your picture.",
      "A village that wants crawler-visible metadata adds it in its own fork of that file, where the values are actually true for one deployment.",
    ],
  },
];

/* ── The variables, and what breaks without each one ──────────────────────── */

export const GO_LIVE_ENV: readonly GoLiveEnvVar[] = [
  {
    name: "DATABASE_URL",
    need: "required",
    breaks: "The server refuses to start.",
    where: "Railway, filled in for you as a MySQL service reference",
  },
  {
    name: "AUTH_TOKEN_SECRET",
    need: "required",
    breaks:
      "The server invents a new one on every restart, which signs every member out every time it restarts.",
    where: "Railway, generated by fork-init",
  },
  {
    name: "ADMIN_PASSWORD",
    need: "required",
    breaks: "Nobody can ever become an admin. It is spent on the first claim.",
    where: "Railway, generated by fork-init",
  },
  {
    name: "FRONTEND_URL",
    need: "required",
    breaks:
      "No cross-site browser request is allowed, and email links point wherever the server was last reached.",
    where: "Railway",
  },
  {
    name: "BREAK_GLASS_ADMIN_EMAIL",
    need: "recommended",
    breaks: "A village that loses every admin has no way back in.",
    where: "Railway",
  },
  {
    name: "MEMBER_SECRETS_KEY",
    need: "recommended",
    breaks:
      "Members cannot store their own AI key or agent-inbox secret. Rotating it makes every stored member key unreadable.",
    where: "Railway, generated by fork-init, set once",
  },
  {
    name: "VILLAGE_SECRETS_KEY",
    need: "recommended",
    breaks:
      "Admin, Integrations refuses every save, so every third-party key has to come from Railway instead.",
    where: "Railway, generated by fork-init, set once",
  },
  {
    name: "FOUNDER_EMAILS",
    need: "recommended",
    breaks:
      "A founder whose role goes missing has nothing left to reach for, because ADMIN_PASSWORD is already spent.",
    where: "Railway",
  },
  {
    name: "EMAIL_FROM",
    need: "recommended",
    // There is no fallback sender any more: with none set, nothing is sent
    // (resolvedEmailSender in server/lib/comms/mailer.ts).
    breaks: "Nothing is sent. Every email is recorded as not sent until a sender is set here or in Comms Settings.",
    where: "Railway, or Admin, Comms Settings",
  },
  {
    name: "RESEND_API_KEY",
    need: "recommended",
    breaks:
      "Every email is recorded as not sent, and nothing leaves the village. Comms Settings shows it as the first open step.",
    where: "Railway, or Admin, Comms Settings",
  },
  {
    name: "TRUSTED_PROXY_HOPS",
    need: "recommended",
    breaks: "Rate limits key on the wrong address. 1 is correct on Railway.",
    where: "Railway",
  },
  {
    name: "GOOGLE_CLIENT_ID",
    need: "optional",
    breaks: "The sign-in page shows no Google button. Email and password still work.",
    where: "Railway",
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    need: "optional",
    breaks: "The same, and both are needed together.",
    where: "Railway",
  },
  {
    name: "STRIPE_SECRET_KEY",
    need: "conditional",
    when: "this village sells with a card",
    breaks: "Card checkout answers an honest 503. The manual payment path still grants credits.",
    where: "Railway, or Admin, Integrations",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    need: "conditional",
    when: "this village sells with a card",
    breaks: "Settlements are unverified or rejected, so orders never credit.",
    where: "Railway, or Admin, Integrations",
  },
  {
    name: "ANTHROPIC_API_KEY",
    need: "optional",
    breaks: "The village assistant hides. Every form and the rest of the platform keep working.",
    where: "Railway, or Admin, Integrations",
  },
  {
    name: "ERROR_WEBHOOK_URL",
    need: "optional",
    breaks: "Crashes still alert admins in the app; nothing reaches an outside channel.",
    where: "Railway",
  },
];

export const GO_LIVE_REFERENCES: readonly GoLiveReference[] = [
  {
    path: ".env.example",
    what: "Every variable this platform reads, and what breaks without each one.",
  },
  {
    path: "docs/PROVISIONING.md",
    what: "The full walkthrough this file is drawn from, including the ReGen-hosted path.",
  },
  {
    path: "docs/FOUNDER_SETUP_PROMPT.md",
    what: "The same walkthrough written to be pasted into a founder's own Claude session.",
  },
  {
    path: "docs/FORK_RUNBOOK.md",
    what: "The long-form reference, with the reasoning behind each variable.",
  },
  {
    path: "docs/GOOGLE_SIGN_IN.md",
    what: "Registering your own Google OAuth client, about ten minutes.",
  },
  {
    path: "ops/RELEASES.md",
    what: "Pulling a published release, pinning a version, and running one without Railway.",
  },
  {
    path: "railway.toml",
    what: "How the deployment builds and starts, and why the health check waits 900 seconds.",
  },
  { path: "scripts/fork-init.mjs", what: "The script in step 3 that generates your secrets." },
  { path: "scripts/smoke-all-modules.mjs", what: "The end-to-end check in step 11." },
  {
    path: "PLATFORM_FOUNDATION.md",
    what: "The white-label architecture and every swap point.",
  },
];

/* ── Rendering the same objects into a file a founder can save ────────────── */

const NEED_WORD: Record<GoLiveNeed, string> = {
  required: "Required",
  recommended: "Strongly recommended",
  conditional: "Only if",
  optional: "Optional",
};

/**
 * The short word alone, for a badge with no room for a condition. The panel
 * puts the condition on its own line underneath.
 */
export function needWord(need: GoLiveNeed): string {
  return NEED_WORD[need];
}

/**
 * The requirement line for one entry, spelled identically on screen and in the
 * downloaded file. A conditional entry reads "Only if <condition>"; a required
 * one that carries a `when` reads "Required <qualifier>".
 */
export function needLabel(entry: { need: GoLiveNeed; when?: string }): string {
  const word = NEED_WORD[entry.need];
  return entry.when ? word + " " + entry.when : word;
}

export interface GoLivePackageOptions {
  /** The village's own name, when the caller has the brand record. */
  villageName?: string;
  /** The date the file was generated, so a stale copy can be told apart. */
  generatedOn?: string;
}

/** A safe, readable filename for the download. */
export function goLivePackageFilename(villageName?: string): string {
  const slug = String(villageName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? "go-live-" + slug + ".md" : "go-live.md";
}

/**
 * The package, as markdown. Every line of it comes from the four lists above,
 * which is what stops the file and the screen from disagreeing.
 */
export function renderGoLivePackage(opts: GoLivePackageOptions = {}): string {
  const village = String(opts.villageName ?? "").trim();
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const FENCE = "```";

  push("# Go live" + (village ? ": " + village : ""), "");
  push(
    "Everything needed to put this village on the internet. Hand it to a developer, or",
    "paste it into an LLM agent that can run commands and drive a browser for you.",
    "",
  );
  if (opts.generatedOn) {
    push("Generated " + opts.generatedOn + " from the Go live step of this village's admin.", "");
  }
  push(
    "Two words appear throughout. VERIFIED means the claim was read out of this platform's",
    "own repository. UNVERIFIED means nobody has confirmed it, so check it before you rely",
    "on it.",
    "",
  );

  push("## Before any command here can run", "");
  for (const p of GO_LIVE_PREREQS) {
    push("### " + p.name, "");
    push("- " + needLabel(p) + "." + (p.certainty === "unverified" ? " UNVERIFIED." : ""));
    push("- What it is for: " + p.what);
    push("- What it costs: " + p.cost);
    if (p.where) push("- Where: " + p.where);
    if (p.note) push("- Note: " + p.note);
    push("");
  }

  push("## The steps", "");
  for (const s of GO_LIVE_STEPS) {
    push("### " + s.n + ". " + s.title + (s.humanOnly ? " (only you can do this one)" : ""), "");
    push(s.why, "");
    for (const point of s.points) push("- " + point);
    push("");
    for (const c of s.commands ?? []) {
      push(FENCE, c.code, FENCE);
      if (c.unverified) push("UNVERIFIED. " + (c.note ?? ""));
      else if (c.note) push(c.note);
      push("");
    }
  }

  push("## The variables", "");
  push("| Variable | Needed | What breaks without it | Where it is set |");
  push("| --- | --- | --- | --- |");
  for (const v of GO_LIVE_ENV) {
    push("| " + v.name + " | " + needLabel(v) + " | " + v.breaks + " | " + v.where + " |");
  }
  push("");
  push(
    "JOURNEY_PASSWORD shows up in older notes and in the previous version of this step. It",
    "gated a screen that was retired. Setting it now does nothing.",
    "",
  );

  push("## Where the detail lives in the repository", "");
  for (const r of GO_LIVE_REFERENCES) push("- " + r.path + ": " + r.what);
  push("");

  push("## What this file does not do", "");
  push(
    "- It runs nothing. Every command here is still typed by a person or by an agent.",
    "- It carries none of your secrets. The values in angle brackets are placeholders, and",
    "  the real ones come from scripts/fork-init.mjs in step 3.",
    "- It does not cover the three steps nobody can do for you: DNS records, Resend sender",
    "  verification, and creating your own Stripe account. Each one proves you control",
    "  something outside this platform.",
    "",
  );
  return out.join("\n");
}
