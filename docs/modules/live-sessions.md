# Module design: Live Sessions

Provenance: platform

> Registry id `sessions`. The contract is `shared/sessions.ts`: the six stages, the aims, the entry
> kinds, the consent values, every limit, the room's state machine, the list of doors, the minutes
> builder, the privacy line and every sentence a member reads. Routes in
> `server/routes/liveSessions.ts`; the rules in `server/lib/liveSessions.ts`; every statement
> against the tables in `server/repos/liveSessions.ts`; the schema in
> `drizzle/0232_a_circle_holds_a_live_session.sql`. The list is `client/src/pages/Sessions.tsx`
> and the room is `client/src/pages/SessionRoom.tsx`.

**A circle holds a working call together in real time. The facilitator moves the room through six
stages: drop in, arrival, agenda, items, actions and close. Everyone sees the stage the room is on
and can look back at an earlier one on their own screen. Every action leaves with a person or a
seat on it, and the record of the call stays with the people who were in it and the village's
admins.**

## Status

Ships OFF, like every non-core module. An admin turns it on to `members`: members only, no guests,
and nothing to probe in public. A signed-in account the village has not admitted yet (anybody below
the Member stage, a Guest included) is refused at every door with one sentence; admins pass. Nothing to set up. The place line falls back to a neutral sentence
and the usual length is a working default, so a circle can hold its first session the day the
module is switched on.

## Who it is for

Circles that meet often and want each call to end with clear decisions and actions somebody holds.
The shape follows the sociocratic meeting format (an opening round, consent to the agenda, content
items with an aim, a backlog, a closing round) with a shared breath, the moon and the season, and
gratitude added, and with a harvest of what each item taught.

The module runs beside whatever call tool the circle already uses. It carries no audio or video.

## The six stages

The facilitator moves the room. A member who looks back at an earlier stage sees it on their own
screen and is shown where the room is, with one tap back to it.

| Stage | What happens | What the facilitator does |
|---|---|---|
| **Drop in** | The village's place line, the moon and the season. A shared breath that every screen in the room takes at the same pace, from one start time the server holds. Who is here. | Reads the place line or asks someone to, starts the breath, names who is here and who sent word. |
| **Arrival** | Each person gives one number from 1 to 11 for how they are arriving and, if they like, what would make it an 11+. Nobody fixes anybody's answer. | Goes first, calls names two at a time. When the room arrives low (two or more numbers and a median of 5 or below), offers a lighter agenda and asks for consent. The tool suggests; it never trims. |
| **Agenda** | Anyone adds an item with an aim (Report, Explore or Decide) and some minutes. The running total is read against the time the session has left. The room consents to the agenda: consent, consent with a concern, or object, and a concern or an objection is said in one sentence. | Starts with the action check from last time, reads the agenda back, asks for objections, parks what will not fit. |
| **Items** | One live page per agenda item with its own clock, notes, ideas, a proposal with a consent round, a seed line (what we now know) and actions. A tension anybody senses goes to the backlog. | Starts the item's clock, says its aim, catches every action with a name or a seat, closes the item with a seed. Going on to the actions or the close stops the item on screen, the same as wrapping it up. |
| **Actions** | Every action is claimed by a person or a seat, here and now, or parked. | Reads each action out and waits for a claim. |
| **Close** | Gratitude, one word each, feedback on the facilitation, and an idea for the tool. | Closes the session, which keeps the record. |

**The item's clock has grace.** It stays calm until four fifths of its minutes are gone, then
shifts softly, and when time is up it rings a quiet bell and offers three choices: add five minutes
with the room's consent (up to sixty extra on one item), park it, or wrap it up.

**Speaking rounds.** The facilitator sets an order and the room shows who speaks now and who is
ready next, two names at a time.

**A consent round counts the people here, one by one.** A proposal reads "everyone here consents"
only when every person present now has answered and nobody has objected. An answer from somebody who
has stepped away never stands in for somebody present who has not been heard, and an objection holds
the round whether or not the person who raised it is still here.

**A decided proposal is final.** Marking a proposal decided by consent is the facilitator's move
(or an admin running the room), and only once its round has consented. After that its words and its
status stay as they are and it cannot be deleted. While a proposal is still open, new words start a
new round: the answers given to the old words are cleared.

**The close refuses while any action has nobody.** An open action with no person and no seat on it
stops the close with a sentence and the list of those actions. Claim it, name a seat, or park it.

## Roles

- **Facilitator.** Whoever opened the room, until they or an admin hand it to somebody in the room.
  Moves the stage, starts the clock, the breath and the rounds, names the secretary, marks a consented
  proposal decided, and closes. The cues for each stage are shown to the facilitator only.
- **Secretary.** Optional, named by the facilitator. Can change notes and entries alongside the
  facilitator.
- **Members in the room.** Join, give a number, add items and entries, claim and let go of actions,
  answer consent rounds, leave a word and feedback.
- **Admins.** Read every closed record and receive the notice that one is ready. An admin who joins
  an open room can also run it, the same as the facilitator: move the stage, start the clocks and
  rounds, name the secretary, take over facilitating (for when the facilitator has stepped away),
  mark a consented proposal decided, and close. Admins also see the consent answers, and the feedback
  on the facilitation once the session has closed.

There is no capability in v1. Facilitation is a fact of each session, held on its own row, and an
admin reads closed records and runs any open room they have joined through `isAdmin`. A facilitation
capability can come later without a migration, because nothing stores one.

## Live, on a poll

The server has no push channel to a browser: every route authenticates by `Authorization: Bearer`,
and an `EventSource` cannot send that header. So the room polls, the way the living map does.
`GET /api/sessions/:id` answers with an ETag built from the session's `version`, which goes up by
one on every write in the same transaction, and a 304 with no body when nothing moved. An open room
asks every 2.5 seconds (`ROOM_POLL_MS`), and a page says it is still here every 20 seconds
(`HERE_EVERY_MS`); somebody seen within 45 seconds counts as here. The list at `/sessions` asks
every half minute while its tab is visible.

## The privacy line

- **Members only.** Every door needs a signed-in member the village has admitted, on the same ladder
  the rest of the platform reads (`isAdmitted` in `server/lib/admission.ts`). A Guest gets a 403 and
  one sentence, admins excepted. There is no public view.
- **An open room can be looked into before joining.** A member who has not joined sees the agenda
  and the work, so they can decide to come in. Only the people who joined see the arrival round, and the
  consent answers are seen by them and by admins.
- **Arrival stays in the room.** While the session is open the people in it see each other's
  number and words, the way a spoken round works. At close the spread is written down (count,
  median, low and high) and then every number and every word is set to NULL. The record keeps the
  spread and nothing else from the round.
- **Feedback on the facilitation arrives unsigned, after the session closes.** It is stored with its
  member's number so one person answers once, and no route returns that number with it. Only the
  facilitator and admins receive it, and only once the session has closed, as one batch sorted by
  answer. While the room is open nobody reads it, because an answer showing up on the next poll
  would say who had just pressed send.
- **The record of a closed session** (agenda, outcomes, decisions, seeds, actions and backlog) is
  read by the people who were in it and by the village's admins, and by nobody else.
- **Nothing is written to `health_events`.** `recordEvent` defaults to a public audience, and the
  Village Pulse reads public events.
- **The shareable minutes name no person at all** (below).

## What the record holds

Six tables, all new. A person is a number: `live_session_members` gives each member who ever opens
or joins a session one number, and every person column in the other five holds that number.

| Table | Holds |
|---|---|
| `live_sessions` | Title, circle, status, facilitator, secretary, length, the room's state, its version, the stamp (moon, season, place line), and at close the summary (the arrival spread, every proposal's tally, a few counts) and the minutes in both audiences. |
| `live_session_people` | Who joined, when they were last seen, and their arrival number and words while the session is open. |
| `live_session_items` | The agenda: title, aim, minutes, position, status, the seconds it was active, and which earlier session it came over from. |
| `live_session_entries` | Notes, ideas, seeds, proposals, actions and tensions, each with its author, and for an action its person or seat and a due date. |
| `live_session_responses` | One answer per person per target: consent to the agenda, consent on a proposal, the closing word, and feedback on the facilitation. |

When the facilitator closes, the session keeps its record, the arrival words and numbers are
erased, every admin gets a notice that the record is ready to read, and each person who holds an
action, or sits in a seat that holds one, gets a notice that it is in their hands. The notice says
what the action is and by when. It links to the record only for somebody who was in the room, since
the record opens to nobody else.

**A room nobody closes closes itself.** The arrival round is erased only by a close, so a room left
open would keep it for anybody who joined later. An open room that nobody has been seen in for its
own length plus two hours (and never less than six hours), and that is older than that, is closed
the way a facilitator closes it: its actions with no person and no seat are parked first, then the
arrival spread is stored and every number and word erased, each proposal's tally is kept, both
minutes are written, and the admins hear the record is ready. The item on screen stops at the last
moment anybody was seen. Nothing runs on a timer. Reading the list closes every quiet room with one
indexed read, and reading or joining a room closes that one first when its row is old enough. Each
room is locked and checked again before it closes, so two readers close it once, and a room somebody
came back to stays open (`closeStaleRooms` in `server/lib/liveSessions.ts`).

## The shareable minutes, and an organisational-memory service

`GET /api/sessions/:id/minutes.md?for=shareable` gives the record as markdown that names no person.
`buildMinutes(input, "shareable")` writes it:

- Actions say the seat that holds them, or "a member".
- Email addresses and phone numbers are removed from every line.
- Nothing from the arrival round or the check-out crosses except the numbers: how many took part,
  and the arrival median and range.
- Notes and ideas stay in the record for the people who were there. The shareable version carries
  the agenda, decisions with their tallies, seeds, actions by seat, and the backlog.

The room shows these minutes under "Shareable minutes", with a line asking the reader to read them
through before copying them anywhere, and a copy button. **An admin who keeps the village's
organisational memory with an outside service hands the minutes over by hand**: read them, copy
them, paste them into the service. Nothing in this module sends a record to any outside service.
The Organisational Memory module only reads from its service today, it has no write path, and
personal information does not cross to it, which is why the minutes that may travel are the ones
built to name nobody.

The `people` audience, with names on actions and who was present, is for the people who were there
and the admins.

## How it rhymes with the rest of the game

- **Seats.** An action can be held by a seat from the org chart, so the work stays with the role
  when its holder changes. The notice at close reaches whoever sits in that seat.
- **Gratitude.** The close opens a gratitude round. A thank-you goes through the gratitude door like
  any other, from the sender's own allowance, and lands in the current moon's cycle. That is why the
  module recommends `gratitude`, which is core and always on.
- **The moon and the season.** Every session is stamped when it starts with the moon's phase, the
  village's own moon count when it keeps one, the season by the village's hemisphere, and the place
  line. The stamp is on the record and at the top of the minutes.
- **The backlog seeds the next session.** When a circle meets again, the room shows "From last
  time": the open actions from its last closed session, for an action check, and its backlog
  (parked items, parked entries and tensions), each one a tap from this session's agenda. Something
  brought over is offered no more, and a second copy of it from the same session is refused.
- **The feedback inbox.** An idea for the tool, given at close, lands in the village's feedback
  inbox as an idea and stays in the village. The close form promises the inbox only, so the idea is
  recorded as not relayable (`may_relay` 0) and the feedback relay never sends it to the platform
  hub, even when the village relay is on.
- **The journal.** The journal's call debrief is one member's private reflection after a call. A
  session is the call itself, held together. The two sit side by side.

## Dials

| Key | What it does |
|---|---|
| `sessions.place_line` | The village's own sentence, read at drop in. Empty means the room reads the platform's neutral line, "Take a moment to feel where you are." |
| `sessions.default_minutes` | How long a new session runs unless the person opening it says otherwise. |

## The module boundary

| Declared | Value |
|---|---|
| API prefixes | `/api/sessions` |
| Data class | `member-pii`: every row names a person |
| Capabilities | none: each door is a member's own, and facilitation belongs to the session |
| Variables | `sessions.place_line`, `sessions.default_minutes` |
| Recommends | `gratitude` |
| Open state | none: a session holds no value anybody is owed |

## Deliberately not in v1

- **No push to any outside service.** No write to an organisational-memory service, no webhook, no
  relay of the record or the minutes. An admin copies the shareable minutes by hand.
- **No quest creation.** An action stays in the session with its person or seat. Work that wants a
  reward goes through the quest board the usual way, proposed and approved by people.
- **No guests.** Members only, with no link a non-member can open and no public minutes.
- **No village-wide decisions.** A consent round in the room decides for the circle in the room.
  Anything for the whole village goes to governance.
- **No events on the public spine,** and no capability of its own.

## Leaving

`forgetMemberSessions` (`server/lib/liveSessions.ts`) runs after the tombstone in
`anonymizeMember` (`server/lib/erasure.ts`). It deletes the member's people rows, their responses
and the entries they wrote, clears them off the actions they held, writes 0 where they facilitated,
took notes or opened a session, rebuilds the stored minutes of every closed session that named
them, and then deletes their number. A name the village no longer holds reads as "A member".
`GET /api/profile/export` carries a `sessions` key with what this module holds about the member:
the sessions they were in, the agenda items they added or present, the entries they wrote or hold,
and their own answers.
