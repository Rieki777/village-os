# Module design: session-card

Provenance: platform

> Registry id `session-card`. The contract is `shared/sessionCard.ts` (the day's sky as a browser sends it and
> the check on it, the room read as a group, the plain reading and its words, the limits and the HTTP shapes).
> The day's sky is read in the browser by `skyAt` in `shared/geneKeysSky.ts`, still the only file that imports
> `astronomy-engine`. Routes in `server/routes/sessionCard.ts`; the rules in `server/lib/sessionCard.ts`; every
> statement in `server/repos/sessionCards.ts`; the schema in `drizzle/0296_a_session_pulls_a_card.sql` and
> `drizzle/0308_a_card_asks_its_own_yes.sql`. The card
> in the room is `client/src/components/sessionCard/PullACard.tsx`, mounted in the drop in stage.

**An optional card anyone in a live session can pull at the start, as often as they like. It reads the sky of the
day in Human Design and Gene Keys and in Western astrology, weaves in the lines of the people present who said
yes, names everyone in the room, gives each person read a line of their own, and offers the room a few ways to
hold the session today. A lens for being present, never a forecast.**

## Status

Ships OFF, like every non-core module. It reached main before the human security review Module Library Contract
clause 13 requires; that review returned ACCEPT WITH FIXES, the fixes are in this release, and Rye signed it off on
2026-10-31 ("yes and ship it on"). It requires Live Sessions and Gene Keys, and an admin turns it on to `members`.
Nothing to set up.

Rulings it follows (Rye, 2026-10-30, "go with your recommendations except ANYONE can pull a card and we can do it
multiple times"):

- Anyone joined to the session may pull, any number of times, within the limits below.
- Each person's own line is private to them by default, and they may share it with the room.
- People without a reading are welcomed by name.
- Both skies: Human Design and Gene Keys transits, and Western astrology (signs, the Moon's phase, retrogrades, a
  void-of-course Moon). Every line of the card is labelled with the system it comes from.

## Who is read

A person present gets a reading only when all three hold, and the SQL itself checks them
(`cardReadableGeneKeys` in `server/repos/geneKeys.ts`):

- their lines are shown (`member_gene_keys.visibility = 'show'`);
- they let Maia use their lines (`maia = 1`), since Maia may weave the card;
- they said yes to session cards themselves (`card_in = 1` and `card_out = 0`, from their own Gene Keys controls:
  "Read me on session cards" and "Leave me out of session cards").

Whether a card asks its own yes, or reads anyone who lets Maia use their lines unless they said no, is Rye's call
(the clause 13 review's F4). It is one constant, `CARDS_ASK_THEIR_OWN_YES` in `shared/geneKeys.ts`: true asks
(`card_in = 1`), false reads by default (`card_out = 0`). The toggle writes both columns, so either answer reads
what members have already chosen. It shows in the Gene Keys controls whether or not the village has cards on.

The same rule is asked again every time the cards are read. When somebody a card read has since hidden their
lines, stopped Maia, said no to cards or deleted their lines, that card is taken back for everyone and deleted.

Everyone else present is named in "Welcome too" and nothing more is said about them. The card tells a person who
was not read why, and how to be read next time, without telling anyone else.

"Present" is the room's own presence window (`PRESENT_WINDOW_MS`): somebody who joined and has gone quiet is not
on a new card. The puller is always present.

## What a card says

Built from facts by `readRoom` and `plainReading`, in Amora's own words. No Gene Keys text of Richard Rudd's is
reproduced: gates and lines are numbers, the centres carry the names every Human Design source uses, and every
sentence about them is Amora's. The strategy and authority lines are the ones the lines card already shows.

- **The sky**: today's Sun, Earth and Moon gates; the Sun's and Moon's signs, the Moon's phase and element, what
  is retrograde, and whether the Moon is void of course (no further major aspect to the Sun or a planet before
  it leaves its sign), with the time it moves on.
- **The room**: everyone read, by name; how many of each type; the centres nobody here defines even with today's
  sky; and a channel two people make only together.
- **Each person's line**: what today's sky switches on for them (the Sun in one of their gates, or a channel the
  sky completes through a gate they hold), a channel they make with somebody else present, and how they decide.
- **The day's lean**: inward or outward from the Moon's phase and element.
- **Ways to hold today**: a longer arrival round on an inward day, a brisk one on an outward day, the sleep
  answer for a big proposal when someone decides with an emotional authority, reviewing over launching under a
  retrograde Mercury, a tension given its own session under a void Moon or a retrograde Mars, intentions at the
  new moon, thanks at the full. Nothing changes on its own: for the tension, the facilitator can park an item
  for next time from the card, through the room's own item door.

## Maia

When an assistant key is set, Maia weaves the same facts into warmer words (mode `card`, its own day budget in
`server/lib/assistant.ts`, no tools, the facts prefetched). She never sees a name or a member id. A display name
is member-written text, so each person read is a key (`p1`, `p2`), the people welcomed are only a count, and the
draft she is given is rebuilt from the keyed facts. Her reply must use every key and no other, and the names go
back in on the server. Her card is thrown away, and the plain card served, when it is cut off or unreadable,
leaves out a key, uses a key nobody holds, gives someone no line, runs long, or trips the house voice check. The
card says which it is: "Woven by Maia" or "Read from today's sky".

On the platform's borrowed key, woven cards are capped at 5 per member and 20 per village a day
(`PLATFORM_WOVEN`), because that key's day cap is shared by every mode; past either, the plain card is served.
A village's own key meets only the `card` mode's own budget.

## The sky comes from the browser

The server may not import the ephemeris, so the puller's browser reads the sky (`skyAt`) and sends it. The server
rebuilds it field by field and refuses anything that could not be the sky (`parseSky`): gates 1 to 64, lines 1
to 6, signs 0 to 11, a phase between 0 and 1, an instant within a day and a half of the server's clock, a void
that ends within three days. The sky is public and the same for everybody, so a browser that lied could only
mislead its own room. The ephemeris is loaded only when somebody pulls.

## Limits

`CARD_LIMITS` in `shared/sessionCard.ts`: 24 cards per session, ten seconds between two pulls in one room (a
double tap is one card), 30 pulls per member per hour. The share door has its own hourly bound, and so does the
read door (1500 an hour, room for the open card's five-second poll in two tabs).

## The privacy line

- **Deletion.** Every card, with every line on it, is deleted within an hour of its session closing or being
  discarded (the hourly job `session-cards-clear-closed`), at once when somebody it read withdraws (above), and
  at once on a member's erasure (`session-cards-after-tombstone` in `server/lib/erasure.ts`), which finds every
  card that named them, read or only welcomed, because `session_card_lines` holds a row for every person
  present. Reading a closed session's cards answers none and writes nothing.
- **Export.** `GET /api/profile/export` returns nothing for cards. A card exists only while its session is open,
  and the member sees their own line on it in the room the whole time; the export carries the saved Gene Keys
  row, chart included, which is what a card reads.
- **Sub-processor.** When the village has an assistant key, the keyed facts above (types, authorities, profiles,
  gate and channel numbers, the sky, a count of people welcomed: no name, no member id, no birth data) go to the
  village's assistant provider, Anthropic by default, to be woven. Without a key nothing leaves the server.
- No birth date, time or place appears anywhere: the card reads the saved charts, and the sky of the day.

## HTTP

Behind `requireModule("session-card")`; every door needs a signed-in member who has joined the session (an admin
may read without joining).

| Door | What it does |
|---|---|
| `GET /api/session-card/:sessionId` | the session's cards, newest first, as this viewer may see them |
| `POST /api/session-card/:sessionId` | pull a card, body `{ sky }` |
| `POST /api/session-card/:sessionId/cards/:cardId/share` | share or unshare the viewer's own line, body `{ shared }` |

## Not built yet

- Keeping a card with the session's record after close. Today every card is deleted at close; keeping one would
  need the room to agree and a place on the record page, which belongs to the Live Sessions lane.
- Looking back over a season at what the cards said against how the sessions went.
