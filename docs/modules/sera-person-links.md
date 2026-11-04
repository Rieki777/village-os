# Sera person links: keyed-hash matching

How a village member is linked to their person in Sera without anyone pasting an owner id, and without an email ever crossing.

## Status

Built on the village side and **off by default**. It runs only when all three of these are true:

- `SABERRA_PERSON_MATCH=on`
- `SABERRA_LINK_SECRET` is set
- `SABERRA_PRIVACY_TOKEN` is set and Sera offers `match_person_by_email_hash` to that connection

Until then nothing is sent, and the manual **Link to Sera** control is the only way to link.

## The flow

1. **When it asks.** A member makes a profile with a proved email (Google sign-in), or proves their email with the verification link. The village then asks Sera once, in the background. Sign-up never waits on it. A password sign-up is asked at verification, because before that its email is not proved.
2. **What is sent.** `match_person_by_email_hash({ email_hash })`, where `email_hash = HMAC-SHA256(SABERRA_LINK_SECRET, lowercase(trim(verified email)))` in hex. It goes over the privacy token, never the routine sync token.
3. **What comes back.** `{ owner_ids: string[] }`.
   - **Exactly one id:** the link is stored (`sera_person_links`, how = `email`, shown as "Linked by email").
   - **None or several:** the member goes to the steward review queue (`sera_link_reviews`). Nothing is picked automatically. The steward sees the reason on the member's row in the Link to Sera panel and links them by hand with the existing control, which clears the review.
   - **One id that already belongs to another member:** this goes to review too.
4. **Members already here.** On the Link to Sera panel, a steward presses "Count who would be matched". That dry run counts verified, unlinked members and calls nothing. Only then can they press "Match now", which runs the same match for each of those members.
5. **Leaving or erasure.** Erasure deletes the member's link and their review row. The steward's "Also remove their tasks in Sera" (hard delete) runs first. After that, the hash link simply stops resolving on Sera's side.

## Privacy rules

- The raw email never leaves the village, and is never logged, stored with a match, or put in a payload. Only the hash is sent.
- The hash is never stored or logged on our side.
- The secret, the sync token and the privacy token are environment variables. Their values are never logged, returned, or shown. The board shows only which token each act uses and whether it is set.
- The review queue stores only four things: the member id, the outcome (`none` / `several`), the match count, and the secret version.
- The audit trail has two kinds of lines. Per member: `sera:match:linked|review|failed`. Per batch: `sera:match-backfill:<linked>/<review>/<failed>`. Neither carries an email or a hash.

## Rotating the secret

`SABERRA_LINK_SECRET_VERSION` (an integer, default 1) is recorded on every review row. To rotate:

1. Agree the new secret with Sera outside email.
2. Set both new values at once.
3. Rerun the backfill dry run, then the real run.

## What Sera must provide

- The tool `match_person_by_email_hash({ email_hash })` returning `{ owner_ids: string[] }`, with no other field. It is callable only with the full-scope (privacy) token.
- Precomputed hashes over the verified emails on Sera's profiles, made with the same secret and normalisation (trim, then lowercase, then HMAC-SHA256 as hex).
- Zero or several matches handled as "never auto-pick". Duplicates are resolved on Sera's side.
- An audit line per lookup: timestamp, calling token, and match count only.
- The shared secret, exchanged once outside email, and the secret version when it rotates.
- Later: creating a person for an unknown hash and recording the village member id on it. The village side does not ask for this yet; zero matches go to review.
