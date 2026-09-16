# Google sign-in

An extra door beside email and password. It never replaces the password path:
a village will have members with no Google account, and a village that
configures nothing keeps working exactly as it does now.

## What a founder has to do

Nothing, if you do not want Google sign-in. The sign-in page shows no Google
button, and the server prints this on every boot:

```
[auth] sign-in methods: email and password. Google is OFF, missing: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. No Google button is shown while it is off.
```

To turn it on you need a `GOOGLE_CLIENT_ID` and a `GOOGLE_CLIENT_SECRET`, and
there are two ways to get them.

**Ask ReGen Civics, and do no console work at all.** We hold one Google client
with each incubator village's callback registered on it, and Google allows 100
callbacks on one client, so thirteen is nowhere near the limit. Send your
village's domain, paste the two values we send back, done. This is the right
starting point for a village being designed, and it is the wrong one for a
village holding a real community's accounts, for two reasons worth saying
plainly: the Google consent screen will say **ReGen Civics** rather than your
village's name, and one leaked secret is every incubator village's problem at
once.

**Register your own, which is the answer once you go live.** Ten minutes below.
Moving from ours to yours is a two-variable change with no code and no
migration, so starting on ours costs you nothing later.

Either way you set the same variables (and `FRONTEND_URL`, which you need
anyway). The deployment reads its own credentials and has no idea who
registered them. The boot line then reads:

```
[auth] sign-in methods: email and password, Google. Google callback: https://your-village.example/api/auth/google/callback
```

### Set `FOUNDER_EMAILS` at the same time, or you will sign in and still be stuck

Signing in and being able to do anything are two different things. A founder who
signs in with Google and lands as an ordinary member cannot name their village,
cannot open the admin surface, and cannot tell that apart from being locked out.

```
FOUNDER_EMAILS=you@example.com
```

Comma separated if more than one. On any Google sign-in whose address Google
verified and which appears in that list, the account is given the `founder`
role.

It runs on **every** matching sign-in, not just the first, so this is also the
recovery path: a role lost to a restore from backup, a bad migration or a
hand-edit comes back by signing in again. No shell, no shared password, no
`/api/admin/bootstrap`.

Three things it will not do, each on purpose:

- **It never lowers a role.** Deleting a line here cannot demote a working
  founder, so a typo cannot lock a village out of itself. Demotion is a
  deliberate act on the admin surface.
- **It never accepts an unverified address.** Google reports whether the account
  actually proved it owns the mailbox, and an unverified one is refused before
  any account is looked up. Without that, somebody could register at Google
  claiming a founder's address and collect the village with it.
- **Blank means nobody.** It never means anyone. That is the default for every
  fresh village.

### Getting the two values, the ten-minute version

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a
   project, or pick one you already have.
2. Go to **APIs and services**, then **OAuth consent screen**. Choose
   **External**, fill in the app name (your village's name, which is what
   members will see on the Google screen), your support email, and a developer
   contact address. Publish it. The scopes this uses (`openid`, `email`,
   `profile`) are not sensitive, so there is no Google review to wait for.
3. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**.
   Choose **Web application**.
4. Under **Authorised redirect URIs**, add exactly one line:

   ```
   https://your-village.example/api/auth/google/callback
   ```

   It has to be byte for byte what your `FRONTEND_URL` is, with
   `/api/auth/google/callback` on the end. `https://www.your-village.example`
   and `https://your-village.example` are two different addresses to Google.
   If members reach your village at both, register both.
5. Copy the client ID and client secret into your deployment's environment as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and restart.

## Why each village registers its own client

This platform is about to run on thirteen hostnames. A Google OAuth client is
registered against exact callback addresses, so somebody has to own that list.
Three shapes were considered.

### One shared client owned by ReGen Civics

Every village's callback is registered on one OAuth client, and every village
is handed the same client ID and secret.

* Costs the founder: nothing. Two values pasted in.
* Costs us: an edit in one Google Cloud Console project per village, forever,
  including every time a village changes its domain. We become a support desk
  for a queue of one-line changes, and a village cannot fix its own sign-in.
* What breaks: one client secret sits in thirteen deployments' environments. A
  leak from any one of them is a leak for all thirteen, and rotating it means
  thirteen coordinated restarts. The Google consent screen also says **ReGen
  Civics** to a member signing in to their own village, which is wrong on a
  platform whose whole claim is that a village owns itself.

**Update, 2026-08-31: both of the first two are now in use, in that order.**
The analysis below was written for a village running a real community, and for
that village it still holds. It was not written for the phase thirteen villages
are actually in, which is months of design before anyone joins. During that
phase the shared client's costs land almost entirely on us rather than on a
member, and its friction saves each founder ten minutes of console work they
would have to redo anyway when their real domain is chosen. So the shared
client is the documented starting point and a village's own client is the
documented graduation, taken before going live. The mechanism did not change:
that is the point, and it is what the closing paragraph of this section already
said.

### One client per village, created by the founder

* Costs the founder: the ten minutes above, once. Real friction, and it is
  paid on a path that is optional, so a founder who skips it still has a
  working village on day one with email and password.
* Costs us: this document, and a boot line that says what is missing.
* What breaks: founders who will not do it get no Google button. That is the
  honest outcome and it is why the button is drawn only where it works.
* What it buys: the consent screen carries the village's own name, a leaked
  secret is one village's problem, a village can change its own domain without
  asking anybody, and a fork that never talks to us can still turn this on.

### A broker on one ReGen Civics origin

One OAuth client with one registered callback, on a host we run. It verifies
with Google and then redirects onward to the village with a signed assertion.

* Costs the founder: nothing.
* Costs us: a service that every village's sign-in depends on, forever. It
  also needs its own allowlist of village origins, so onboarding a village is
  still a central edit, which was supposed to be the thing this avoided.
* What breaks: this is the reason it is refused. Whoever controls the broker
  can mint an identity assertion for any member of any village. It turns
  thirteen independent deployments into thirteen deployments with one shared
  authentication authority, and it puts a record of every sign-in on every
  village into one place we would then be holding. If the broker is down,
  nobody in the network can use Google.

**The mechanism that ships covers the first two options at no extra cost.** The
deployment reads its own client ID, secret and callback from its own
environment and does not know or care who registered them. A founder who
creates their own client sets three variables; a founder who is handed the
shared client's credentials sets the same three variables. The only difference
is who added the callback address in the console. The broker is the one that
would have needed different code, and it is the one we are not building.

## What happens when somebody signs in

1. `GET /api/auth/google/start` mints a signed `state` carrying the
   destination and a fresh nonce, then redirects to Google.
2. Google redirects back to `/api/auth/google/callback`. The state signature is
   checked before any network call: that is the login-CSRF guard.
3. The code is exchanged at Google's token endpoint using this deployment's
   client secret. The `id_token` that comes back is checked for issuer,
   audience, expiry, the nonce from step 1, and `email_verified`.
4. The village decides which account this is (see below), sets a two-minute
   HttpOnly cookie naming that member, and redirects to `/login?oauth=complete`.
5. The page POSTs to `/api/auth/google/exchange`, which trades the cookie for a
   session token once and clears it.

## Confirming a destructive action without a password

A member who joined through Google has no password, and leaving the village
(`POST /api/profile/request-exit`) and deleting the account
(`POST /api/profile/delete-account`) used to accept nothing else. Both routes
now take a fresh Google sign-in from a member with no password. The mechanism
and its security argument live in the header of `server/lib/identityConfirm.ts`.
In short:

1. The screen asks `GET /api/auth/confirm-methods` and draws a password box, a
   Confirm with Google button, or a sentence sending the member to set a
   password.
2. The button goes to `/api/auth/google/start?confirm=<action>&next=<screen>`.
   The action rides inside the signed state.
3. The callback runs every check a sign-in runs, then accepts ONLY the Google
   subject already linked to an account. It never creates or links an account
   on this path, and it sends a member who has a password back to it.
4. It writes a digest of a random id into that member's row, sets a five-minute
   HttpOnly cookie scoped to `/api/profile` that names the member, the action
   and the session generation, and redirects back to the screen.
5. The route spends the record under the member's row lock, so a confirmation
   works exactly once, and clears the cookie.

A member with a password keeps the password prompt exactly as it was. On a
village with Google off, a member with no password is refused in a sentence
that sends them to set one. Google publishes no `auth_time` claim, so this
cannot tell a Google session typed a minute ago from one the browser has kept
for a week. The account chooser is always shown.

## Account linking, and the security argument

**A Google sign-in whose verified email matches an existing account is linked
to it.** The reason is not convenience. Google has said this person controls
that mailbox, and anybody who controls that mailbox can already take the
account by asking for a password reset and clicking the link that arrives. So
linking grants no power the mailbox did not already carry, and refusing would
lock real members out of accounts they own while leaving the mailbox path
exactly as open as it was.

**`email_verified` is required and is not negotiable.** A Google account can
carry an address whose owner never proved they hold it. Accepting one would
mean an attacker signs up to Google claiming the founder's address, clicks
sign in, and is handed the village. An unverified address is refused before any
account is looked at.

**Matching is by Google's subject id first and email second.** The subject is
the stable identity; an email address is a mutable attribute of it. A member
who changes their Google address keeps their village account.

**An account with no password is linked and signed in.** This is the state a
founder is left in when bootstrap created their account and the claim email
never arrived. Before this change that account could not log in and could not
ask for a reset either. It can now do both: Google sign-in works, and
`forgot-password` sends a claim link (see below).

**Refused:** an account already linked to a different Google subject, a
standing example identity, and a retired member's tombstone.

## The forgot-password fix that shipped with this

`POST /api/auth/forgot-password` used to guard its whole body on
`if (user?.passwordHash)`. An account that never set a password got the
cheerful "if an account exists, a link is on its way" answer and no email, on
every attempt, forever. The comment beside it said bootstrap covered that case;
bootstrap needs `ADMIN_PASSWORD` from the environment and refuses outright once
any founder exists, so for an ordinary member it covered nothing.

Three different accounts have an empty password hash, and truthiness cannot
tell them apart: a member who never set one, a standing example identity, and a
tombstone. The rule is now written on positive facts about each
(`server/lib/oauthAccounts.ts`), so the first gets a claim link and the other
two get nothing.

The account-enumeration defence is unchanged. Every caller still gets one
identical 200. What changed is which letter is sent, and the only person who
sees that is whoever controls the mailbox.

## Adopting the button on another sign-in surface

The button is a shared component. Any page that offers a sign-in adds one line:

```tsx
<GoogleSignInButton next="/admin" />
```

plus `import GoogleSignInButton from "@/components/auth/GoogleSignInButton";`.

It renders nothing on a village with no Google credentials, so a surface that
adopts it does not need to ask whether Google is configured. The return leg is
handled on `/login`, whatever page the sign-in started from, because the
callback always redirects there and carries `next` through.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| No Google button, boot log says `Google is OFF` | The variables it names are unset. |
| `redirect_uri_mismatch` from Google | The callback in the console does not match `FRONTEND_URL` exactly. Check `https` and `www`. |
| Boot log names `FRONTEND_URL (or GOOGLE_REDIRECT_URI)` | Credentials are set but the village has no configured address. It is never guessed from traffic, because Google compares the callback byte for byte. |
| `/login?oauth=error&reason=email_unverified` | Google has not confirmed that address belongs to that account. Use email and password. |
| `/login?oauth=error&reason=bad_state` | The sign-in took longer than fifteen minutes, or the link was tampered with. Start again. |
| Log line `Google token exchange failed: status=401` | The client secret is stale or has whitespace in it. |
| Log line `Google token exchange failed: status=400` | The code was already used, or the redirect URI at the token step does not match the one at the auth step. |
