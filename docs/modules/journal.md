# Module design: journal

Provenance: platform

> Registry id `journal`. The contract is `shared/journal.ts` (practices, questions, pulse metrics,
> feedback shapes and the HTTP surface). Routes in `server/routes/journal.ts`; the rules and the
> store in `server/lib/journal.ts`; every statement against the tables in `server/repos/journal.ts`;
> the schema in `drizzle/0227_a_member_keeps_a_journal.sql`.

**A member's own journal: a morning and an evening practice, light or deep, a weekly pulse, a debrief
after calls, and an open page. A guide asks one question at a time and reflects back what it heard.
The village reads the pulse as numbers only. Members who say yes can receive feedback from a
teammate, unsigned, in a weekly batch.**

## Status

Ships OFF, like every non-core module. An admin turns it on to `members`. Nothing to set up: the
practices and the questions are platform copy, and the one dial has a working default.

## The privacy line

- **An entry is its author's.** Every read filters on the id from the signed-in member's own token.
  There is no admin read, no `/api/admin/journal`, and no door that takes another member's id to
  read with. An admin asking for an entry that is not theirs gets the same 404 as anybody.
- **The pulse's numbers aggregate; its words never do.** `journal_pulse` holds a number per member
  per metric per week and no text. The aggregate's SELECT names no `user_id`.
- **Feedback arrives unsigned.** The received read's SELECT does not name `author_id`, so the
  recipient's payload carries no author at any depth. Feedback ids are random, so an id cannot
  date a message either.
- **Nothing is written to `health_events`, and nothing is notified.** `recordEvent` defaults to a
  public audience, and a notice that feedback arrived would mark the moment the batch exists to
  blur.

## Saving and paging

`POST /api/journal/entries` is idempotent on the client's `clientId`: a retry answers with the row
the first save wrote and changes nothing, including a pulse number a later entry has since replaced.
`GET /api/journal/entries` pages newest first in (`writtenAt`, `id`) order; `before` is
`<writtenAt>|<id>` of the previous page's last entry, so two entries written in the same second on
a page boundary are both seen. A bare ISO `writtenAt` still works and pages strictly before it.

## The pulse floor

`journal.pulse_floor` is how many different members must answer a metric in a week before its
average shows. **It defaults to 1 by ruling (2026-10-02)**: a small team still sees its own pulse,
and the anonymity the village values lives in how feedback is captured and delivered. It is a
village dial, open to a proposal like any other; a village whose members know enough of each
other's answers raises it. Below the floor a cell keeps its row with `n` and `mean` null and
`suppressed: true`. No floor stops subtraction, and the dial's description says so.

Signals are read from the latest week with any cell above the floor, from unsuppressed cells only:
burnout when mean energy is at most -1 and mean load at least 4; confidence, coherence or space when
that mean is at most 2.5. Each is a gentle sentence that names a pattern, never a person.

## Feedback

1. The recipient says yes on their own prefs (`open`, a preferred style, a note).
2. The author writes four parts: what they observed, felt, need and ask.
3. `POST /api/journal/feedback/shape` asks the guide for one message in the recipient's style,
   with anything identifying the author left out. Nothing is saved.
4. The author approves the exact words, which are refused past 2000 characters and never clipped,
   because a clipped message is one nobody approved.
5. `POST /api/journal/feedback` queues it. Refused to oneself, to anybody who has not said yes, and
   past one message per author per recipient per week (the count and the insert are one
   statement). It becomes visible on the first Monday 09:00, village time, at least 48 hours later.
6. The author may withdraw it until then, and not after. The recipient may answer thanks or not
   useful.

## The guide

The one assistant engine, in a `journal` mode of its own (member audience, 150 calls a day, 700
tokens, no tools). It is handed the member's own data as prefetched, fenced reads: what they wrote
in this sitting, their last ten entries clipped, the season and the moon, the village's own confirmed
brief, their open quests, and gratitude they received in the last fourteen days. It asks one
question at a time, reflects back for "Did I get that right?", never diagnoses or acts as a
therapist, answers a crisis with care and a pointer to people they trust or emergency services, and
never discusses other members. With no key configured both guide doors answer 503
`assistant-unavailable` and the page carries on with the plain questions.

## The module boundary

| Declared | Value |
|---|---|
| API prefixes | `/api/journal` |
| Capabilities | none: every door is the member's own |
| Variables | `journal.pulse_floor` |
| Open state | none: a journal holds no value anybody is owed |

## Leaving

`forgetMemberJournal` runs in the `journal-after-tombstone` step of `anonymizeMember`
(`server/lib/erasure.ts`), after the tombstone where the member's sessions die. It deletes every row
naming the member in all four tables, feedback in both directions. `GET /api/profile/export` carries
a `journal` key from `exportMemberJournal`: entries, the member's own pulse, their prefs, what they
sent, and what they received as message, delivery time and response only.

`GET /api/journal/export.md` gives the member their entries as markdown: frontmatter per entry
(date, practice, depth, the debrief's call, seats, quests and portability, privacy,
`confirmed_by_author`, tags), one section per answered question, and the reflection once confirmed.
