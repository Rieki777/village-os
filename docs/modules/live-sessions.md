# Module design: Live Sessions

Provenance: platform

> Registry id `sessions`. The contract is `shared/sessions.ts`: the six stages, the aims, the entry
> kinds, the consent values, every limit, the room's state machine, the list of doors, the minutes
> builder, the privacy line and every sentence a member reads. Routes in
> `server/routes/liveSessions.ts`; the rules in `server/lib/liveSessions.ts`; every statement
> against the tables in `server/repos/liveSessions.ts`; the schema in
> `drizzle/0238_a_circle_holds_a_live_session.sql`. The list is `client/src/pages/Sessions.tsx`
> and the room is `client/src/pages/SessionRoom.tsx`. What happens to an action after the call
> (below, "After the call: tasks") has its own contract in `shared/sessionTasks.ts`, its doors in
> `server/routes/sessionTasks.ts`, its rules in `server/lib/sessionTasks.ts`, its emails in
> `server/lib/sessionTaskMail.ts`, its statements in `server/repos/sessionTasks.ts` and its schema
> in `drizzle/0255_a_task_keeps_going_after_the_call.sql`. What members bring before a call (below,
> "Before the call: the agenda library") has its contract in `shared/sessionLibrary.ts`, its doors in
> `server/routes/sessionLibrary.ts`, its rules in `server/lib/sessionLibrary.ts`, its statements in
> `server/repos/sessionLibrary.ts` and its schema in `drizzle/0264_a_circle_keeps_an_agenda_library.sql`. When a
> circle meets (below, "When a circle meets: its rhythm") has its contract in `shared/sessionRhythm.ts`, its doors in
> `server/routes/sessionRhythm.ts`, its rules in `server/lib/sessionRhythm.ts`, its statements in
> `server/repos/sessionRhythm.ts` and its schema in `drizzle/0271_a_circle_keeps_a_rhythm.sql`. Circle
> meetings on a calendar (below, "Circle meetings on a calendar") has its contract in `shared/sessionCalendar.ts`,
> its doors in `server/routes/sessionCalendar.ts`, its rules in `server/lib/sessionCalendar.ts`, its statements in
> `server/repos/sessionCalendar.ts` and its schema in
> `drizzle/0275_a_member_follows_circles_on_their_calendar.sql`; a circle's own calendar adds
> `server/lib/circleOwnCalendar.ts` and `drizzle/0277_a_circle_attaches_its_own_calendar.sql`.

**A circle holds a working call together in real time. The facilitator moves the room through six
stages: drop in, arrival, agenda, items, actions and close. Everyone sees the stage the room is on
and can look back at an earlier one on their own screen. Every action leaves with a person or a
role on it, and the record of the call stays with the people who were in it and the village's
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
| **Agenda** | Anyone adds an item with an aim (Report, Explore or Decide) and some minutes. The running total is read against the time the session has left. The room consents to the agenda: consent, consent with a concern, object, or sleep on it, and a concern or an objection is said in one sentence. Sleeping on it (Rye, 2026-10-22) is for someone who decides best after a night: it needs no sentence, it is never an objection, and the round, here and on every proposal, stays open and says so. Since 2026-10-23 a night names when it ends (see "A night on a proposal" below). | Starts with the action check from last time, reads the agenda back, asks for objections, parks what will not fit. |
| **Items** | One live page per agenda item with its own clock, notes, ideas, wins and celebrations, a proposal with a consent round (and, folded under it, the regenerative lens: four questions for a room that wants to look at it whole first), a line on what we learned (one sentence for the record) and actions. A tension anybody senses goes to the backlog. | Starts the item's clock, says its aim, catches every action with a name or a role, closes the item with what we learned. Going on to the actions or the close stops the item on screen, the same as wrapping it up. |
| **Actions** | Every action is claimed by a person or a role, here and now, or parked. | Reads each action out and waits for a claim. |
| **Close** | Gratitude, one word each, feedback on the facilitation, and an idea for the tool. | Closes the session, which keeps the record. |

**The item's clock has grace.** It stays calm until four fifths of its minutes are gone, then
shifts softly, and when time is up it rings a quiet bell and offers three choices: add five minutes
with the room's consent (up to sixty extra on one item), park it, or wrap it up.

**The room votes its agenda** (0290, Rye 2026-10-30: "In sessions this should be a vote (where we
can crowd vote ones up and down and together select the priority)"). Everyone in the room votes each
waiting item up or down, one vote per person per item; pressing the same vote again takes it back,
and the other vote changes it. While the vote is open the agenda sorts itself by the score (ups less
downs) at every vote and every new item, ties keeping their order, items already talked about at the
top and parked ones at the end, so the positions themselves are the room's choice. The tallies are the
room's to see. Whoever runs the room sets the order once the room has voted (`POST
/api/sessions/:id/agenda/order { set: true }`), which closes the vote; only then do the arrows show, to
move an item by hand, and opening the vote again sorts by the score once more. A vote is the person's
own, like a consent answer: nobody votes for anybody else, the facilitator filling in included. The
contract is `shared/sessionVotes.ts`.

**Wins and celebrations** (Rye, 2026-10-30: "add a section for 'wins and celebrations' to share about
things they've won at!"). Each item's page has a section where anyone shares a win, with the mic like
every box. A win is the entry kind `win` and goes into the record under its item. Every section on the
item's page has a name (`ITEM_SECTIONS`: `notes`, `ideas`, `wins`, `proposal`, `learned`, `actions`),
so a meeting template switches each on or off by name through the view's `itemSections`; a view that
names none shows them all.

**The next step is always in sight** (Rye, 2026-10-30: "make the next step more obvious and easy for
other facilitators to find"). On the agenda, the items and the close, the facilitator sees one bar
under the stage, held to the bottom of the screen (above the tab bar on a phone). It names the next
thing and does it in one tap: start the first item, wrap this one up and start the next, on to the
actions once every item is done, and on the close, the way to the close button. When an item's time
is up the bar says so and offers five more minutes beside the wrap up. On the item's page the wrap up
is a strong button beside the clock.

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

**The close refuses while any action has nobody.** An open action with no person and no role on it
stops the close with a sentence and the list of those actions. Claim it, name a role, or park it.

**Editing in the room.** Every box in the room can be put right while the session is open, by the
people it belongs to:

- **An entry's words** (a note, an idea, what we learned, a proposal, an action, a tension) are
  changed by the person who wrote it, the facilitator, the secretary, or an admin who has joined
  the room.
- **An item's title** is changed by the person who added it until the item is done, and by the
  facilitator, the secretary or a joined admin at any time. **Its aim and minutes** stay with the
  person who added it only while it waits: once it starts, the item's clock reads its minutes, so
  they are the hosts' to change. A form that sends the whole item back with only the title retyped
  still goes through, because a field sent unchanged asks for no right.
- **The session's title** has its own door, `PATCH /api/sessions/:id { title }`, open to the
  facilitator, the secretary and a joined admin. It is cleaned to one line and cut to 120
  characters, any other key is ignored, and sending the title it already has moves nothing.

Some things stay final on purpose, and the room says why where each one shows:

- A proposal decided by consent keeps its words and cannot be removed.
- The person holding an action they did not write sets its date and lets it go; its words stay
  with its author and the hosts.
- A consent answer, an arrival number and wish, and a closing word belong to the person who gave
  them, who changes them by answering again.
- Feedback on the facilitation stays unsigned and never comes back to the room; sending again
  replaces what was sent before.
- An idea for the tool is sent one way, to the village's feedback inbox.
- A closed session takes no writes, and its record reads as it closed.

An admin still joins before writing anything, and the room shows a joined admin the editing
controls. Who changed a card is not shown yet: entries keep no editor or edit time.

## Roles

- **Facilitator.** Whoever opened the room, until they or an admin hand it to somebody in the room.
  Moves the stage, starts the clock, the breath and the rounds, names the secretary, marks a consented
  proposal decided, and closes. The cues for each stage are shown to the facilitator only.
- **Secretary.** Optional, named by the facilitator. Can rename the session and change items and entries alongside the
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
- **The record of a closed session** (agenda, outcomes, decisions, what we learned on each item, actions and backlog) is
  read by the people who were in it and by the village's admins, and by nobody else.
- **What members bring for a circle** waits where the people with standing in that circle, the person who brought
  it, and admins read it; an item for no circle in particular is read by every member. Once a session takes an
  item up, anyone who looks into that open room reads it and its note, the way they read the rest of the agenda,
  and the form says so before it is sent. The circle line is a filter on the waiting list, and the room's own line
  takes over from there.
- **Nothing is written to `health_events`.** `recordEvent` defaults to a public audience, and the
  Village Pulse reads public events.
- **The shareable minutes name no person at all** (below).

## Filled in by the Facilitator

Rye, 2026-10-30: "Facilitator can fill other people's stuff out", live sessions first, with a notice to
the person. The contract is `shared/sessionOnBehalf.ts`.

- **Who.** Only the person facilitating the session, while it is open, for somebody who has joined the
  room. Not the secretary, and not an admin unless they take the facilitation.
- **What.** On their bar the facilitator chooses "Filling in for" a person. Until they choose Myself
  again, the arrival, a new agenda item and a new entry (a tension, a proposal, an action, any kind) go
  in as that person's (`forUserId`). They can also hand an action nobody holds to somebody
  (`ownerUserId`). Changing the words, plan, role or date on something a member added is a fill-in too.
- **Never an answer.** Consent, a concern, an objection, a night, the closing word and the feedback on
  the facilitation stay each person's own. `/respond` refuses any `forUserId` but the answerer's own.
- **Seen and heard.** The room marks it "Filled in by the Facilitator", by the role and never the
  facilitator's name, and the person gets one notice. The person, or the facilitator, can undo it from the
  room while it is open (`POST /api/sessions/:id/on-behalf/:fillId/undo`); the person changing it
  themselves makes it theirs, and the mark goes.

## What the record holds

Twenty-one tables, all new. A person is a number: `live_session_members` gives each member who ever opens
or joins a session one number, and every person column in the other twenty holds that number. One
(0288) is what the facilitator filled in for somebody, described under "Filled in by the Facilitator", and
one (0290) is the room's vote on its agenda, described under "The six stages". Three
(0255) are the task layer, described under "After the call: tasks", one (0280) is a decision's review
date, described under "After the call: a circle's decisions and their reviews", two (0284) are the advice
process, described under "Before deciding: the advice process", two (0264) are the agenda
library and one (0279) where its items came from, described under "Before the call: the agenda library",
one (0271) is a circle's rhythm, described under "When a circle meets: its rhythm", two (0275) are who
follows which circles on their own calendar, and the last (0277) is which circle keeps which calendar of
its own, both described under "Circle meetings on a calendar".

| Table | Holds |
|---|---|
| `live_sessions` | Title, circle, status, facilitator, secretary, length, the room's state, its version, the stamp (moon, season, place line), and at close the summary (the arrival spread, every proposal's tally, a few counts) and the minutes in both audiences. |
| `live_session_people` | Who joined, when they were last seen, and their arrival number and words while the session is open. |
| `live_session_items` | The agenda: title, aim, minutes, position, status, the seconds it was active, and which earlier session it came over from. |
| `live_session_entries` | Notes, ideas, what we learned (stored as the kind `seed`), proposals, actions and tensions, each with its author, and for an action its person or role and a due date. |
| `live_session_responses` | One answer per person per target: consent to the agenda, consent on a proposal, the closing word, and feedback on the facilitation. A night (`sleep`) carries its answer-by time in `answer_by` (0281). |
| `live_session_task_state` | One row per action open or done at close: its status (`open`, `done`, `let_go`), its person or role now, its date, the kind and the one line of its latest answer, who gave it, and a version that goes up on every answer. |
| `live_session_task_events` | Every answer to a task, in order, with the state it left. Append-only. |
| `live_session_task_sends` | Each time a session's task emails went out: the send's number (1 is the close), who pressed, and the counts by outcome. Numbers only, never an address. |
| `live_session_library` | One row per item a member brought for a circle's next session: its title, the aim it needs if they knew it, a note, the circle (or none), who brought it, where it stands now (`waiting`, `on_agenda`, `taken_up`), the session and agenda item it is on or was taken up in, and who last changed its words when that was somebody else. |
| `live_session_library_takes` | Every time a session took an item, and how it left that session: `taken_up`, `back`, or nothing yet while the session is open. One take of an item per session. |
| `live_session_rhythms` | One row per circle: how it meets (weekly, moon or once), the calendar's recurrence with any skipped dates, the village date of its first meeting and its wall-clock time, its length, and who set it last. |
| `live_session_follows` | The circles a member follows on their own calendar, one row each, or one row `*` for every circle, the new ones too. |
| `live_session_feed_keys` | One per member: the sha256 of their private calendar address's key, when it was made, and when a calendar app last read it. |
| `live_session_circle_calendars` | One per circle that attached its own calendar: which of the village's external calendar subscriptions it is, and who attached it. |
| `live_session_library_sources` | One per agenda item that came from a tension or a decision's review: which kind, which one, and the role's or the circle's name as it was then. One item per tension, and per review date. |
| `live_session_decision_reviews` | One per decision with a review date: the village date, who set it, and the agenda item its review became once it was made. |
| `live_session_advice_requests` | One per request for advice: the circle asked, who asked, what they mean to decide and why, the decide-by date, and once settled whether it was decided or withdrawn and what was decided. |
| `live_session_advice_asks` | One per person asked on a request, with their advice once they give it. |
| `live_session_item_votes` | One per person per agenda item they voted on (0290): up (1) or down (-1), and when. Taking a vote back deletes its row. |
| `live_session_checks` | One per checked proposal (0297): a hash of the words as checked, when, and the read (the season's priorities each marked when the words name them, the roles the words name with where each holder was, and when the purpose was written). No person: a holder is `here`, `away` or `open`. It goes with its proposal, its author's erasure and the session. |
| `live_session_on_behalf` | One per thing the facilitator filled in or changed for somebody (0288): who wrote it, whose it is, what (an arrival, an item, an entry) and whether it was added or changed, what it replaced (emptied at the close), when the person was told, and whether it was undone or made theirs since. |

When the facilitator closes, the session keeps its record, the arrival words and numbers are
erased, every admin gets a notice that the record is ready to read, and each person who holds an
action, or sits in a role that holds one, gets a notice that it is in their hands. The notice says
what the action is and by when. It links to the record only for somebody who was in the room, since
the record opens to nobody else. Each of them also gets one email listing every task they hold
from that call (below).

**A room nobody closes closes itself.** The arrival round is erased only by a close, so a room left
open would keep it for anybody who joined later. An open room that nobody has been seen in for its
own length plus two hours (and never less than six hours), and that is older than that, is closed
the way a facilitator closes it: its actions with no person and no role are parked first, then the
arrival spread is stored and every number and word erased, each proposal's tally is kept, both
minutes are written, and the admins hear the record is ready. The item on screen stops at the last
moment anybody was seen. Nothing runs on a timer. Reading the list closes every quiet room with one
indexed read, and reading or joining a room closes that one first when its row is old enough. Each
room is locked and checked again before it closes, so two readers close it once, and a room somebody
came back to stays open (`closeStaleRooms` in `server/lib/liveSessions.ts`).

**A session opened by mistake can be discarded, and a record can be deleted.** One door,
`DELETE /api/sessions/:id`. While the session is open, its facilitator or an admin (joined or not)
can discard it from the facilitator's bar or the admin's strip in the room, after a
confirm that says everything in it goes for everyone. Once it has closed, only an admin can delete
its record, from the bottom of the record; the facilitator alone cannot. Either way it is a real
delete, in one transaction that locks the session row first: its people, items, entries and
answers, its task state, task answers and task sends, and the session row itself. An item in a
later session that was brought over from it keeps its words and loses the link. Notifications and
emails already sent keep their link as text. Everybody else in an open room finds it gone on their
next poll and lands on the list, which says the session was discarded (`discardSession` in
`server/lib/liveSessions.ts`).

## A night on a proposal

Rye ruled on 2026-10-23 that someone who sleeps on a proposal names a time to answer by, and that a
night left unanswered by then counts as no objection. Choosing "I'll sleep on it" asks "When will you
answer by?": Tomorrow, 9:00; In two days, 9:00; or a time from a quarter of an hour to a week ahead
(the week is a choice the ruling left open, kept small). The answer cannot be sent without one. The
round names each night ("Ada asked for a night. The round stays open until 9:00 tomorrow."), and a night
whose time has come counts as no objection, by default: "1 no objection by default" in the tally and in
the minutes, and it never keeps the round waiting. A night asked for before 0281 has no time and keeps
the round waiting until its person answers, as it did.

**The round outlives the call** (Rye's choice, the same day). A proposal still open at the close with
somebody sleeping on it keeps its round on the record. Whoever asked for a night hears where to answer
and by when (`session_night_open`, bell only), and answers it from the record: I consent, a concern or an
objection, each of the last two in one sentence. Nobody else can answer after the call. Once no night
lasts, the round consents when nobody objects and nobody in the room at the close went unheard; the
facilitator hears how it went (`session_night_settled`, bell only), and marking a consented round decided
stays their act, from the record. A night that simply ends is settled by the `session-nights` job, every
fifteen minutes, which writes the record's tally and minutes again; a round that fails to settle waits for
the next run and never holds up the rest. Somebody who may not read the record hears from these doors what
the record's own door says, and nothing about what is in it. A member who leaves while their night lasts
takes their answer with them, and the round it held is written again from the answers left and settled,
with no notice: the facilitator finds it settled on the record. The rule is `shared/sessions.ts`
`nightRoundState`, and the summary keeps which rounds outlived the close.

| Door | Who | Limit |
|---|---|---|
| `POST /api/sessions/:id/respond` `{ target, value: "sleep", answerBy }` | the room's people | 300 an hour |
| `POST /api/sessions/:id/night` `{ entryId, value, text }` | whoever asked for a night on it, by their time | 60 an hour |
| `POST /api/sessions/:id/entries/:entryId/decide` | the facilitator, an admin | 60 an hour |

## When a circle meets: its rhythm

A circle keeps a meeting rhythm, and /sessions shows each circle's next meeting under **Coming up**,
between the rooms open now and the agenda items. The rhythm is every week or every two, three or four
weeks on a weekday, at each new or full moon, or once on a date, at a time of day in the village's own
zone (said under the form), for some minutes. It is stored in the calendar's own `Recurrence` shape
(`shared/gatherings.ts`), so a circle's meetings can later sit on the village calendar unchanged. Beside
it the rhythm keeps a village date (its first meeting) and a wall-clock time, never an instant: a
daylight change, or a first meeting in the hour the clocks skip, or a new village zone, leaves "Thursday
at 18:00" where it was. A first meeting is today or up to 120 days ahead, as far as Coming up looks, so a
saved rhythm always shows; a later one is refused in words.

**Who sets it:** the circle's own members, by the standing rule (in its last meeting, or one of its
roles now), and admins. A circle sets its own rhythm, the way it holds its own meetings. They change it,
skip one coming meeting (named by its village date, one of the next twelve), or stop it, which asks once
first. **A change keeps the circle's week**: the form opens starting from the next meeting, so a new time
or length on an every-other-week rhythm leaves its meetings on the same weeks (the door does the same for
a weekly rhythm sent with no first date), and the skipped meetings still among its next ones stay
skipped. "Set a meeting rhythm" offers only the circles with none; a circle that has one changes it from
its own row. **Anybody may
read when a circle meets**: a meeting time is the circle's door, and the agenda items behind it keep their
own rule, so a row's count of waiting items counts only what the viewer may see.

**Each row** says when in the village's words ("Tomorrow at 18:00"), how the circle meets ("Every
Thursday at 18:00") and how many agenda items wait for it, the viewer's own circles first. While the
circle's room is open the row offers it. Otherwise **Get the room ready** fills the start card for that
meeting: its title ("Garden circle, 23 October"), its circle, its length, and the circle's own waiting
items ticked, with the ones for no circle in particular left to choose. **Nothing opens a room by
itself**: a person opens it, so a rhythm nobody keeps any more never fills the list with empty rooms.

**The day before** (the hourly `session-coming-up` job, in the village's daytime window, nothing until
the module is open to members: in preview the page answers admins alone, and a member's notice would open
a door that refuses them), each of the circle's members hears when, with what is on the agenda: the people
who sit in its roles now and the people of its last meeting. In the bell only (`session_coming_up`): no
email preference a member has set covers a meeting reminder yet. Once per meeting per person: the key is
`session-coming:<circle>:<date>T<time>:<user>`, so a skipped meeting, or one moved to another day or
another time, is a new one. The notice opens the row on /sessions (`/sessions#coming-<circle>`), lit for a
moment, from another page or from /sessions itself.

**One circle's sessions** for its home page (the circle card): `GET
/api/sessions/circles/:circleId/summary` answers its rhythm in words, its next meeting, when it last met
(its last closed session two or more people were in), what waits for it as the viewer may see, its open
room, and whether the viewer may keep its rhythm.

| Door | Who | Limit |
|---|---|---|
| `PUT /api/sessions/circles/:circleId/rhythm` | the circle's members, admins | 60 an hour |
| `POST /api/sessions/circles/:circleId/rhythm/skip` | the circle's members, admins | the same bucket |
| `GET /api/sessions/circles/:circleId/summary` | a signed-in member | none |

### Circle meetings on a calendar

**On the village calendar.** Each circle's rhythm is mirrored into the one calendar
(`calendarUpsert`, source `sessions`, the circle's id, layer `circle`, kind `call`), titled "Garden
circle meeting" and linking to its row on /sessions, so the Events calendar and its own feeds carry
circle meetings. The calendar expands the rhythm's own `Recurrence`, so both count the weeks of an
every-other-week rhythm from the same week and skip the same dates
(`server/lib/sessionCalendar.test.ts` holds the two halves to the same meetings). A set, a skip or a
stop mirrors at once; the hourly `session-calendar-mirror` job catches up a renamed circle, a new
village zone, or a mirror that failed. While the module is off or in preview every mirrored row is
retired, and they come back when it opens to members.

**Follow the calendar.** Under Coming up, any member who may use Live Sessions picks the circles whose
meetings they want on their own calendar, or **every circle, new ones too**. The list is the live
circles, read from the village each time the panel opens, with how each meets. They make a private
address once, and the panel offers **Add to Google Calendar** (Google's own add-by-address page),
**Add to Apple or Outlook** (the `webcal://` link) and **Copy the address**. A calendar app reads the
address every few hours and gets the meetings of the circles followed at that moment, so a changed
rhythm, a skipped meeting or a new circle reaches it with no new address. A weekly rhythm leaves as one
RRULE in the village's zone with its skipped dates as EXDATE; a moon rhythm leaves as its meetings one
by one, through the calendar's own writer (`buildIcs`).

**The address is a credential**: 32 random bytes in the address, stored only as a sha256, shown once
the moment it is made. Later the panel says when it was made and last read, and offers a new one (the
old one stops working) or none. `GET /api/calendar/circles.ics?key=` lives outside `/api/sessions`
because a calendar app reads it with no sign-in. It is bounded generously per network address (Google
reads every subscriber's calendar from a shared pool of its own) and tightly per address, and it answers one
bare 404 to a key that does not read or is not live, a module off or in preview, or a member who has
left, been anonymized or is no longer admitted; a gone member's key is stopped on the way out.

| Door | Who | Limit |
|---|---|---|
| `GET /api/sessions/circles/following` | a signed-in member | none |
| `PUT /api/sessions/circles/following` | a signed-in member | 60 an hour |
| `POST /api/sessions/circles/following/key` | a signed-in member | 10 a day |
| `DELETE /api/sessions/circles/following/key` | a signed-in member | none |
| `GET /api/calendar/circles.ics?key=` | whoever holds the key | 30 an hour per address, 600 an hour per network address |

**A circle's own calendar.** A circle that already keeps its meetings in Google Calendar, Apple or
Outlook attaches that calendar's secret address under Coming up ("Attach a circle's own calendar"):
the circle's members by the standing rule, and admins. It becomes one of the village's own external
calendar subscriptions (`server/lib/externalCalendars.ts`, the same the Events page attaches): https
or `webcal://` only, never a private address, sealed in the secrets store (so attaching is refused in
words while the village has no `VILLAGE_SECRETS_KEY`), fetched through the outbound guard, and its
events imported onto the calendar's `circle` layer every three hours by `calendar-external-poll`. It
is read once the moment it is attached, so its meetings show at once; a first read that fails still
attaches, and the panel says so. 0277 only says which subscription is whose. A member is told nothing the
admins alone may read: an address the outbound guard turns away is "cannot be read from here", whatever it
resolved to, and while the village has no secrets key the panel says to ask an admin. A circle that goes
dormant or is removed has nobody left to detach its calendar, so the hourly `session-calendar-mirror` job
detaches it; attach it again if the circle comes back.

A meeting is a timed event no longer than the longest session (480 minutes). An all-day entry or a
multi-day one stays on the village calendar and in a follower's feed as what it is, and never becomes the
circle's next meeting, its start card or its day-before notice. Its meetings count as the circle's: a row's
next meeting is the sooner of the rhythm's and the calendar's (`nextOf`, which Coming up, the circle's summary and the day-before notice all ask), shown
with that meeting's own title, and a circle with a calendar and no rhythm gets a row of its own ("From
the circle's own calendar"). A meeting from the calendar is skipped in that calendar; a skip always names the rhythm's own next meeting,
and says which while the calendar's comes sooner ("Skip the rhythm's meeting on Friday 30 October at
09:00"). A circle with a calendar and no rhythm is offered "Set a meeting rhythm", with nothing to stop.
A follower's feed carries the circle's imported meetings with its rhythm. Only the circle's keepers
see which calendar it is (where it points and its last four characters, never the address) and how
its last read went, and they replace it, or detach it after one confirm. Replacing or detaching removes the old
subscription whole, its sealed address and its imported meetings with it; an admin who removes the
subscription on the Events page detaches it too.

| Door | Who | Limit |
|---|---|---|
| `PUT /api/sessions/circles/:circleId/calendar` | the circle's members, admins | 10 a day |
| `DELETE /api/sessions/circles/:circleId/calendar` | the circle's members, admins | the same bucket |

## After the call: a circle's decisions and their reviews

Every agreement is good until it is reviewed (Rye, 2026-10-22). **Decisions** on /sessions lists what a
circle decided by consent, newest first: the `decision` entries its rooms marked decided, in its closed
sessions. It is for the circle's members by standing (in its last meeting, or holding one of its roles now) and
admins, one circle at a time, their own first: the same audience the circle's task cards on its earlier
sessions already have. A decision's words are the circle's agreement; the session's title travels only
to somebody who was in it, or an admin, and otherwise the card says only when it was decided.

**A review date.** The same people set one ("In 3 months", "In 6 months", "In a year", or a date from
tomorrow up to three years ahead), change it, or take it off. When the date comes, the hourly
`session-decision-reviews` job (nothing before the module is open to members) makes "Review: <the
decision>" an item waiting for the circle, added by nobody in particular so it stays the circle's
(its card says "Added by the Garden circle"), its source the decision and that date (0279: "A decision
the Garden circle set a date to review"). A long decision's words reach the item's note whole; the
"Review:" opens only its title. The card then says when its review came and that it went to the agenda
items. Each review date is its own cycle: a new date lets the last one go, and each date's review is made
once. The job reads only live circles' reviews, so a dormant circle's never hold up anybody else's. The
decision's record is never written to: 0280 keeps the date beside it.

| Door | Who | Limit |
|---|---|---|
| `GET /api/sessions/circles/:circleId/decisions` | the circle's members, admins | none |
| `PUT /api/sessions/circles/:circleId/decisions/:entryId/review` `{ reviewOn }` | the circle's members, admins | 60 an hour |

## This season: a circle's pulse, and the regenerative lens

Feature 6 of the sessions program (Rye, 2026-10-22). **This season** on /sessions says how a circle has
been doing, from what its sessions already wrote down: "The Garden circle met 5 times this spring: 12
decisions by consent, 9 of 14 actions done", and under it the times it met, the people who came, what it
decided by consent, the tensions it named, where the actions those sessions left stand now, and how the
room arrived (the median of the arrival rounds' medians, out of 11, numbers only). It is for the circle's
members by standing and admins, one circle at a time, their own first; counts only, never a name. No
table: it reads the sessions, their entries, the task layer's state and who came.

The season is the one a session opened now would be stamped with, read from the day it began: the
village's own seasons when it has written them (the latest start on or before today, so a season named
twice in a year is two seasons and a long one is read whole), the natural ones by hemisphere otherwise
(the latest equinox or solstice). Only a closed session two or more people were in counts as the circle
meeting, counted the house's one way, so it stays a meeting after one of its people leaves the village. A
village that keeps no seasons (the tropics) reads its last three months.

**The regenerative lens** folds under every open proposal in the room: "Look at it through a regenerative
lens" opens four questions (who and what it touches beyond the people here; what it gives back to the
land, the village and the people doing the work; what it will ask of us in a year and of the people who
come after us; how we would notice it stops serving and how easily we could undo it). They are prompts,
kept nowhere.

| Door | Who | Limit |
|---|---|---|
| `GET /api/sessions/circles/:circleId/pulse` | the circle's members, admins | none |

## Before deciding: the advice process

Anybody may decide, once they have asked the people their decision touches (Rye, 2026-10-22, feature 4 of
the sessions program). **Asking for advice** on /sessions lets a member name what they mean to decide,
why, and the date they will decide by (In 3 days, In a week, In two weeks, or a date up to sixty days
ahead), and ask a circle. Everybody with standing in it is asked, the asker aside: in its last meeting, or
holding one of its roles now, the audience a circle's meeting reminder reaches (at most sixty people).
Each person asked gives advice in their own words and can change it until the decision; the advice is
open to everybody asked, which is the point of the process. Nobody has to follow it. The asker records
what they decided and how the advice shaped it, or withdraws the request after a confirm.

A request is read by whoever asked and the people asked, and by nobody else: to anybody else it does not
exist, and every refusal says so in the same words. A member keeps at most ten requests open. The bells
are bell only: the people asked hear they were asked (`session_advice_asked`), the asker hears the first
advice from each person (`session_advice_given`), and the people asked hear what was decided
(`session_advice_decided`). A withdrawal rings nobody. Every bell names its actor, so when the asker or an
adviser leaves the village the erasure rewrites the bell in everybody else's inbox. While Live Sessions is
only in preview nobody can be asked, since the people asked could not open what their bell links to.
Advice lands only on a request still open: the write reads the status in the same statement, so a
decision that lands first wins. The lists are read again every minute while the page is in view, and a
bell's link lands on its request once, reading the lists again when the request is newer than they are.

| Door | Who | Limit |
|---|---|---|
| `GET /api/sessions/advice/requests` | any member: the requests they made, and the ones they were asked about | none |
| `POST /api/sessions/advice/requests` `{ circleId, intent, context, decideBy }` | any member | 60 an hour |
| `PUT /api/sessions/advice/requests/:id/advice` `{ advice }` | the people asked, while it is open | 60 an hour |
| `POST /api/sessions/advice/requests/:id/decide` `{ decision }` | whoever asked, while it is open | 60 an hour |
| `POST /api/sessions/advice/requests/:id/withdraw` | whoever asked, while it is open | 60 an hour |

## Before deciding: a check on a proposal

The facilitator or the person who proposed it can check an open proposal in the room (0297, Rye
2026-10-30 and 2026-10-31: "Check Sera"). The button carries the name the outside governance service's
agent answers under (the `saberra` module's `agentName`, Sera by default), and it is offered while that
module is open to members. Everybody in the room sees the same card under the proposal:

- **The village's purpose**, the Governing Purpose Statement, beside the proposal. Whether the proposal
  serves it is the room's to say, so nothing scores it. The card says when the purpose was rewritten
  after the check.
- **This season's priorities**, every one of them, each marked "Named" when the proposal's words name it:
  the priority word for word, or every meaningful word of it when it has two or more.
- **The roles the words name**, the role the proposal sits with first, and for each whether its holder
  was here when the check ran, was not here, or whether nobody held it. Never who. A role of one word
  counts only where the proposal writes it with a capital ("the Host welcomes", never "we will host"); a
  role of several words counts in any case. A plural reads as the role.
- **One line saying the agent's own read is not available yet.** That needs a typed check call from the
  service, asked of it on 2026-10-31. This read is the village's own and calls nobody.

Only an open proposal is checked: a parked or a decided one is refused. A second check replaces the
first, and new words on the proposal mark the card as changed until it is checked again. A decided proposal keeps the card it was checked with and offers no button. The check is
stored with its proposal (`live_session_checks`) and holds no person, and the proposal's words only as a
hash, so a member's export has nothing of it; it goes when the proposal is removed, when its author is erased, and when the session is
discarded.

| Door | Who | Limit |
|---|---|---|
| `POST /api/sessions/:id/entries/:entryId/check` | the facilitator, an admin in the room, or the proposer, while the proposal and the room are open | 120 an hour |

## Before the call: the agenda library

Members bring what needs a circle's time before the circle meets, and the session that opens next
takes it up. The code calls it the library, the founder's word. **A member never reads that word**:
the village already has a Library (the shared material library) and a Module Library, so on
/sessions the section is **Agenda items**, under one plain line (Rye, 2026-10-22): "Add agenda items
for future sessions. You can add anything: each session decides which topics to explore." The start
card and the room head their lists "Agenda items for the Garden circle", a card says "Added by" and
when, and its controls are "Remove it" and "Add it again".

**Bringing an item.** Any admitted member, on /sessions: "Add an agenda item" opens the room's own add form
without the minutes (a title, the aim it needs from the circle, or "Not sure yet", and anything the
circle should know first), and the circle it is for, which must be answered: one of the village's live
circles, or "No circle in particular" as a deliberate last choice. It is chosen for a member who has
standing in exactly one circle. A member may bring something to a circle they are not in, the way a
tension is raised with the circle that holds it, and they always see their own. Fifty waiting items
per member at most.

**Every tension becomes an agenda item** (Rye, 2026-10-22). A tension raised with a role, brought to the
circle by one of the role's holders from the player card, becomes an item waiting for the role's circle
(`server/lib/roleTensions.ts`), brought by that holder, with the tension's words: the whole of them as
the title when they fit, otherwise the start as the title and every word in the note. It works for a
circle that has never met, and it never writes into a closed session's record (the old road wrote a
backlog entry into the circle's last session, and refused a circle that had not met). A tension named in
a room is sent on from the room's backlog by whoever named it, the session's hosts or an admin, and from
"From last time" by anybody who was in that session: "Send to a circle's agenda items", the room's own
circle chosen first, any live circle or none, after a line saying who will read its words. The room then
says where each one went (`sentTensions`) and "From last time" offers a sent one no more, while the closed
record stays exactly as it was. Each such item says where it came from on its card ("From a tension
raised with Water keeper", "From a tension named in a session of the Garden circle"), from 0279, which
keeps the role's or circle's name as it was. The same tension never becomes two items: the unique key
on the source refuses the second ("That tension has been sent to agenda items already."), decided before
anything is written, and two sends at once leave one item. A withdrawn item takes its source with it, so
the tension can be sent on again and the room offers it again. The warning before a send names who will
read the words: the circle's members, or every member for no circle in particular. No waiting cap applies:
bringing a tension on is answering it.

| Door | Who | Limit |
|---|---|---|
| `POST /api/sessions/library/from-tension` `{ sessionId, entryId, circleId }` | whoever named it, the hosts and admins in an open room; anybody who was in a closed one | the add bucket, 60 an hour |

**The list.** One list per circle, the member's own circles first, then the others, then no circle in
particular, each oldest first, and every card says where it stands in one line: waiting (and "back for
next time" when a session did not reach it), on the agenda of a room open now with a link into it, or
taken up, which folds under "Taken up lately" for three moons. Every card names who brought it and
when, and who last changed its words when that was somebody else. It rides on `GET /api/sessions`,
because `GET /api/sessions/library` would be read as the room numbered "library".

**Who sees an item** (`canSeeBrought` in the contract): whoever brought it, admins, every member for an
item for no circle in particular, and the people with **standing** in its circle, the same rule the
task layer reads, from the same function (`standingIn` in `server/lib/circleStanding.ts`): they were
in the circle's **last meeting**, or sit in one of its roles now, live and not lapsed, in a role the
circle still keeps. A meeting is a closed session **at least two people were in** (Rye, 2026-10-21),
because any member may open a room for any circle and close it alone, and that one close would
otherwise hand them the circle's waiting items, with the words of the people who brought them, and
take the list from everybody at the circle's last real meeting. A taken-up item reaches
whoever brought it, admins and the people who were in the session that took it up, through every door,
and a closed session's title reaches only them. An item somebody may not see answers 404, the same as one
that is not there, so a refusal never says an item exists.

**Who changes an item** (`broughtRights`): whoever brought it and admins change its title, aim, note
and circle, withdraw it at any time, and bring a taken-up item again. The facilitator or secretary of
an open session of its circle, who has standing there, may reword it (title, aim and note), never move
its circle, because the circle is the item's audience. Nobody but the bringer and admins rewords an
item for no circle in particular: any member can open a session with no circle, so hosting one says
nothing. The words and the circle change only while it waits; on an agenda, the room's own edit rights
govern the agenda item. A change is made against the row as it is, locked, so a host's new title never
puts back a circle the bringer had just moved, and a card says "Words changed by" whoever last changed
somebody else's.

**Taking it up.** The "Start a session" card lists what the chosen circle may take up: that circle's
waiting items, then the ones for no circle in particular (a session for no circle is offered only
those). The ticks follow the circle and drop when they stop fitting, the list scrolls inside its card,
the minutes they would plan show under it, and "Open the room with 2 items" puts them on the agenda in
the order shown. In an open room, the agenda stage shows the same kind of list after "From last time",
each viewer reading their own (joining a room asks nothing about its circle), and anyone in the room
brings one with "Add to the agenda", the way a parked item comes over from last time. The room's
consent to the agenda is the circle's check.

Each item becomes an ordinary agenda item added by whoever took it, presented by whoever brought it
when they are in the room, with its aim (explore when they were not sure) and the minutes that aim
usually gets (report 5, explore 10, decide 15); its note becomes the item's first note, written by
whoever wrote the note as it stands (whoever brought it, unless a host or an admin reworded it), so the
record keeps it as said and says whose words they are. The agenda row reads "Added by" with their
name, in the room or not. Opening and bringing are **all or none, and every refusal comes before the
first write** (the room's transactions commit whatever was written before a refusal returns): the items
are locked after the session row and checked, the agenda's 30 and the entries' room are measured, and
one item that went elsewhere a moment ago refuses the whole batch with one sentence that names no item,
and the page reads the list again. An item already on this agenda is a quiet yes.

**The close settles them, on its own.** Inside the close's own transaction, after the record is
written, an item the record says is done is taken up, and one the session did not reach (waiting or
parked) goes back to wait for next time. Automatic, never a question on close, for three reasons: a
quiet room closes itself with nobody there to ask and both closes run the same code (`closeLocked`), so a
choice could only ever reach one of them; the close already stops on unheld actions, and a second
question at the moment people leave gets skipped; and an item somebody brought stays with the circle
until the circle has taken it up, so dropping it is the bringer's act (withdraw) or an admin's, never an
accident of where the clock ran out. The library follows the record: the item on screen when the room
closed is done in the minutes, so it is taken up, and whoever brought it can bring it again. "From last
time" leaves out an item the library took back, so it is offered once.

**A withdrawn item** goes from the list at once, and from an open agenda it stays as the room recorded
it. Its takes stay: they hold no words, and they keep "From last time" from offering the agenda item it
became a second time.

**A session removed.** A discarded open session's items wait again and its takes go, because the
session is meant never to have been. A deleted closed record's taken-up items stay taken up and lose
the link, the way an item brought over from it keeps its words. A release from before the library
closes and deletes sessions without settling anything, so the list mends what such a session left on
its agenda when it is read (`reconcileLibrary`).

**The notices**, in the bell only: no email preference a member has set covers an agenda item. When a
session takes an item, whoever brought it hears it is on that session's agenda (`session_item_taken`),
unless they took it themselves; when that session closes, whoever brought it and was not in the room
hears whether it was taken up or waits for next time (`session_item_settled`), and that notice never
names the closed session. Both open the item's own card on /sessions (`/sessions#brought-<id>`), never
the session, because a closed record refuses anybody who was not in it.

| Door | Who | Limit |
|---|---|---|
| `POST /api/sessions/library` | an admitted member | 60 an hour, 50 waiting |
| `PATCH /api/sessions/library/:itemId` | `broughtRights` | 120 changes an hour |
| `DELETE /api/sessions/library/:itemId` | whoever brought it, admins | the same bucket |
| `POST /api/sessions/library/:itemId/again` | whoever brought it, admins | the same bucket |
| `GET /api/sessions/:id/library` | a signed-in member, their own list | none |
| `POST /api/sessions/:id/library` | anyone in the open room | the same bucket |

## After the call: tasks

When a session closes, every action somebody holds becomes a **task** that keeps going after the
call. The words said in the room never change: `live_session_entries` and the frozen minutes stay
as they were at close, and the room still refuses every write to a closed session. What happens to
a task afterwards lives in the three task tables.

**The state layer.** The close writes one `live_session_task_state` row per held action, inside its
own transaction, so a task exists the moment the close does. The facilitator's close and a quiet
room closing itself both come through `closeLocked`, so both write them. The migration wrote the
same rows for the sessions closed before it, and running its backfill again adds nothing. A task is
`open`, `done` or `let_go`; an open task with no person and no role is **back with the circle**.
Each answer moves the state row, appends one `live_session_task_events` row, and bumps the version
of any open room in the same circle, so that room's next poll shows it. The answers are **It's
done**, **Not yet** (a new date after today), **Let go** (one sentence), **Hand it back**, **I'll
take it** (a task back with the circle) and **Open it again**. A version the page did not see is
refused with the card as it stands now.

**Who may answer.** One pure function, `taskRights` in `shared/sessionTasks.ts`, decides every door:
the person holding the task; a member who sits in the holding role now, with a term that has not
lapsed; the facilitator or secretary of the session it came from, or of an open session in the same
circle, since facilitation rotates; and admins. Anybody with rights may open a done task again (a
mistaken tap). Only the hosts and admins may open a let go task again. Anybody who may see a task
back with the circle may take it, which since the ruling below is every member with standing in
its circle; somebody who sits in one of its roles and has never joined a session gets their number
when they take it.

**Who may see a task.** `canSeeTask`: the people who were in the session it came from, whoever
holds it now (person or role), **every member with standing in the task's circle**, the facilitator
or secretary of an open session in the same circle, and admins. Standing is one measure, shared
with the agenda library (`standingIn` in `server/lib/circleStanding.ts`): they were in the circle's
last meeting, a closed session **at least two people were in** (a session somebody opened and
closed alone gives nobody standing and takes it from nobody; the count is the one the close kept, so
a meeting that has closed stays one after a member later leaves the village), or they sit in one of
its roles now,
with a term that has not lapsed, in a role the circle still keeps (active and not a standing
example). A role holder who has never joined a session has standing
too: every door reads their roles by their own id. Rye ruled on 2026-10-21 that the
whole circle reads its task cards: a sociocratic circle works in the open, and a task that comes
back to the circle should be visible to everyone who might take it. Standing widens seeing and
taking and nothing else: a circle member who holds nothing and hosts nothing cannot answer a task
somebody else holds or open a finished one again. A task from a session with no circle keeps the
narrower rule. A task somebody may not see answers 404, the same as a task that is not there. No
card carries a user id, an email or a count about a person.

**A card is not the record.** A role holder or a circle member who was not in the room sees the
text, the session's title, the circle, the date, the status and the latest answer, with no link to
the record, because a closed record and its minutes open only to the people who were in it and
admins.

| Who | Reads the card | Takes it when it is back with the circle | Answers it | Opens it again | Record link |
|---|---|---|---|---|---|
| Holds it (in person, or sits in the holding role now) | yes | | yes | done: yes; let go: no | only if they were in the room |
| Was in the session it came from | yes | yes | | | yes |
| Has standing in its circle (its last meeting of two or more, or a live role) | yes | yes | | | no, unless they were in the room |
| Facilitates or keeps notes for the source session, or for an open room of the circle where they have standing | yes | yes | yes | yes | only if they were in the room |
| Admin | yes | yes | yes | yes | yes |
| Anybody else | no (404) | | | | |

**Where tasks show.** **Your task board** on the profile lists what a member holds, what their roles
hold, what is **back with their circles** (open tasks nobody holds, in a circle where they have
standing, each with **I'll take it**), and what they finished in the last three moons, with older
ones a tap away. An action still in an open session shows there read-only, answered in the room.
The menu's count and the profile's **Your tasks** card stay the member's own: what they hold and
what their roles hold, never the circle's. The next session of the same circle shows the circle's
tasks in "From last time" to everyone with standing there, grouped for the action check: done since
last time, back with the circle, new dates, let go, and still holding. A closed record shows each
action's status beside it. No notice or email goes to the whole circle: the notices and the task
emails still reach only whoever holds a task, and the facilitator when a task comes back.

| Door | Who | Limit |
|---|---|---|
| `GET /api/sessions/tasks/mine` (`?earlier=1` adds the older finished tasks) | a signed-in member | none |
| `PATCH /api/sessions/tasks/:entryId` | `taskRights` | 120 answers an hour |
| `GET /api/sessions/:id/task-record` | whoever may read the session gets every task and the mail line; anybody else gets the cards `canSeeTask` gives them and no mail line, or 403 when that is none | none |
| `POST /api/sessions/:id/task-emails` | the closed session's facilitator, and admins | 3 presses an hour |

The doors register right after the room's, so the module gate and the members-only gate in front
of `/api/sessions` stand in front of them too.

**The task emails.** When a call closes, each person holding an open task from it gets one email
listing every task they hold, and every task their roles hold, with its date. It goes out as a
`notices` email (members only, sent with the Village Comms module off too, with suppression and the
one-click unsubscribe). The holders are read again when the email is sent: the person, and every
member who sits in the role now. A role holder who was not in the room gets the role's opening and
no record link. A role nobody sits in tells the admins and the session's facilitator in-app.
`noticesAfterClose` is the one place the close starts these emails, and nothing waits for them: the
close answers first. The closed record's facilitator and admins can press **Send the task emails** to
send the open tasks again; each press takes the next send number. Each email is keyed
`session-tasks:<session>:<user>:<send>`, so the same send posted twice is one email per person, and
a new press really sends again. The counts are kept on the send's row as numbers by outcome.

**The gentle notes.** The hourly `session-task-notes` job (registered in
`server/routes/sessionTasks.ts`) writes one note two days before a task's date and one the morning
after it, to whoever holds it then. It does nothing while the module is off or outside the
village's daytime window (`comms.quiet_start_hour` to `comms.quiet_end_hour`). A task with no date,
a finished task, and a task back with the circle get no note. Each note is keyed
`session-due:<entry>:<user>:<date>:<before|after>`, so a task gets at most two notes per date, and a
new date is a new pair.

**The preference.** `tasksEmail` (`immediate`, `daily` or `off`, default `immediate`) in
Notifications. `immediate` sends the close email and the notes. `daily` keeps each to one line in the
daily digest. `off` keeps them in the bell only.

## The shareable minutes, and an organisational-memory service

`GET /api/sessions/:id/minutes.md?for=shareable` gives the record as markdown that names no person.
`buildMinutes(input, "shareable")` writes it:

- Actions say the role that holds them, or "a member".
- Email addresses and phone numbers are removed from every line.
- Nothing from the arrival round or the check-out crosses except the numbers: how many took part,
  and the arrival median and range.
- Notes and ideas stay in the record for the people who were there. The shareable version carries
  the agenda, decisions with their tallies, what we learned (stored as the kind `seed`), actions by role, and the backlog.

The room shows these minutes under "Shareable minutes", with a line asking the reader to read them
through before copying them anywhere, and a copy button. **An admin who keeps the village's
organisational memory with an outside service hands the minutes over by hand**: read them, copy
them, paste them into the service. Nothing in this module sends a record to any outside service.
The Organisational Memory module only reads from its service today, it has no write path, and
personal information does not cross to it, which is why the minutes that may travel are the ones
built to name nobody.

The `people` audience, with names on actions and who was present, is for the people who were there
and the admins.

## Meeting templates: the meetings a village holds again and again

Contract `shared/sessionTemplates.ts`; doors `server/routes/sessionTemplates.ts` under their own
prefix, `/api/session-templates`; rules `server/lib/sessionTemplates.ts`; statements
`server/repos/sessionTemplates.ts`; schema `drizzle/0291_a_circle_keeps_its_meeting_templates.sql`.
Rye, 2026-10-30: "need to be able to create/select templates and to sort those of the same
category (like our friday and monday sessions)", and feedback on each template over time should
keep changing what it looks like and how its meeting flows.

- **A template is a row, never code.** Name, category, a sentence on what it is for, the usual
  circle and length, and an ordered FLOW of sections. Each section has a kind, a title, a prompt
  and minutes. The kinds are `round`, `talking_stick`, `wins`, `agenda`, `priority_vote`,
  `priorities_set`, `priorities_review`, `carried_over` and `close`; the words a member reads are
  always the section's own title and prompt.
- **Who keeps them.** Every admitted member reads them. Making, changing, duplicating, ordering
  and archiving ask the one gate for `session.template`, which opens at the member rung, the same
  people who may open a room. A template is archived, never deleted, because a series still names
  it.
- **Three seeds, written once.** Heart share (category "Heart share"), Monday planning and Friday
  check-in (category "Weekly rhythm", Monday first). A seed row that exists is never written over,
  so the feedback a village gives a seed stays.
- **The start card's "Meeting type".** The templates grouped by category in their keepers' order.
  Picking one fills the title, circle and length and shows the flow; "No template" stays first.
  `POST /api/sessions` takes `templateId`, checks it is an active template before the room opens,
  and links the new session to it.
- **A series feeds itself.** Each template may name another it reads back from. Friday reads back
  from Monday: under its `priorities_review` section ("Last Monday's priorities") the room sees the
  priorities the latest Monday opened before it chose, and the facilitator marks each done, partly
  or carried over. Monday reads back from Friday: under its `carried_over` section ("Carried over
  from Friday") come the priorities that Friday marked partly or carried, each one a tap from being
  this week's priority again, and gone from the list once taken up. Monday's `priorities_set`
  section keeps this week's priorities, and can take the agenda's top items once the room has voted
  them into order.
- **The talking stick.** A `talking_stick` section passes a visible stick around the people here,
  in the order the facilitator starts it with: the room sees who holds it, who is next and the
  round. The facilitator passes it on, steps back one, or gives it to somebody. Anyone in the room
  keeps a line of what was shared (grateful for, what's working, what's not working, a tension),
  and a line can be brought to a later session: it becomes an item in the agenda library for the
  session's circle, a tension as an Explore and anything else as a Report, once only.
- **The season's priorities stay at the centre** (0292, Rye 2026-10-30). A season's priorities are
  its own `goals` (the season document, kept in the season settings). A `season_priorities` section
  reads them out in the room; the weekly templates open with one. Every weekly priority and every
  win may name the season priority it serves, chosen from that list and copied as written, the way
  a member's season plan names its goal; a carried priority taken up again keeps the one it served.
  Wins are shared under a `wins` section in the room's panel (the item page's own wins name none).
- **The season so far**, at `/sessions/season` (`GET /api/session-templates/season?season=<id>`):
  for each season priority, the weekly priorities that named it set against how each went, and the
  wins that named it; wins over time, a row per week; and the tensions that keep coming up in
  Heart share (what was named a tension or as not working), grouped when the same one comes back,
  latest first. Counts and words only, no score, no ranking and no person's name. A tension's words
  reach the people who were in a Heart share it came up in, and admins; everybody else reads that
  it came up, and how often. The window is the season's own dates in the village's zone, and a
  session belongs to the season it was opened in.
- **A season goal keeps its name** (0298). Every goal on a season carries an id (`server/lib/seasonGoals.ts`):
  one written before ids existed is given the id its words derive, and the migration gives every
  link made by words the same id, so the two agree before anybody saves the season again. Once
  saved, the season editor sends each goal back whole, so a reworded goal keeps its id and every
  priority and win linked to it. A link also keeps the words it was made with: when a goal is
  removed, the season view lists what served it under "named no season priority", saying which
  priority it served. Two goals with the same words get two ids.
- **A win on an agenda item serves the season too** (0298): under each win on an item page, anybody
  in the open room names the season priority it serves, and the season view lists it with the
  meeting's own wins.
- **People say how tensions group** (0298). The word guess now stems ("waters", "watering" and
  "watered" are one word) and still needs two shared meaning words, so two tensions that share only
  "kitchen" never group. Where the guess is wrong, the people who were in that Heart share say so
  on the season view: "Same tension as" joins two (anybody who was in both), and "Not the same"
  keeps one apart from the guess. Nobody else can regroup what they never heard.
- **Who writes in the room.** Moving the stick and setting or marking priorities is the
  facilitator, the secretary or a joined admin, while the room is open. Capturing a share and
  bringing one to a later session is anybody in the room.

## How it rhymes with the rest of the game

- **Roles.** An action can be held by a role from the org chart, so the work stays with the role
  when its holder changes. The notice at close reaches whoever sits in that role.
- **Gratitude.** The close opens a gratitude round. A thank-you goes through the gratitude door like
  any other, from the sender's own allowance, and lands in the current moon's cycle. That is why the
  module recommends `gratitude`, which is core and always on.
- **The moon and the season.** Every session is stamped when it starts with the moon's phase (drawn,
  lit on the side the village's hemisphere sees), the village's own moon count when it keeps one, the
  season, and the place line. The season is the village's own when it has named its seasons in
  `calendar.seasons`; none when its land sits between the tropics and it has named none, since the
  four temperate seasons do not describe a year that turns on rain; and otherwise the four by the
  village's hemisphere. The stamp is on the record and at the top of the minutes.
- **The backlog seeds the next session.** When a circle meets again, the room shows "From last
  time": every open task from all of the circle's earlier sessions, and every one answered since it
  last met, each with its latest answer, for an action check; and the backlog of its last meeting
  (parked items, parked entries and tensions), each one a tap from this session's agenda. Something
  brought over is offered no more, and a second copy of it from the same session is refused. "Last
  time" is the circle's last close, passing over a session one person was in that left nothing
  behind, no agenda item and no entry (`lastTimeIn` in `server/lib/circleStanding.ts`): a test room
  or a room opened by mistake never stands between a circle and its last meeting. A one-person
  session that did leave something stays last time, even though it gives nobody standing: passing
  over it would hide what it parked, and offer again what it brought over from the meeting before it
  and dealt with. The action check reads every open task of the circle whatever session it came
  from, so no task depends on which session is last time.
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
| `calendar.seasons` | The village's own seasons, each with the day it starts, as `Name: MM-DD` separated by commas (for example `Dry: 12-01, Green: 05-01`). Blank uses the platform's seasons, or none in the tropics. Read by the stamp; shared with the calendar. |

## The module boundary

| Declared | Value |
|---|---|
| API prefixes | `/api/sessions`, `/api/session-templates` |
| Data class | `member-pii`: every row names a person |
| Capabilities | `session.template`, for keeping the meeting templates; every room door is a member's own, and facilitation belongs to the session |
| Variables | `sessions.place_line`, `sessions.default_minutes`, `calendar.seasons` |
| Recommends | `gratitude` |
| Open state | none: a session holds no value anybody is owed |

## Deliberately not in v1

- **No push to any outside service.** No write to an organisational-memory service, no webhook, no
  relay of the record or the minutes. An admin copies the shareable minutes by hand.
- **No quest creation.** An action stays in the session with its person or role. Work that wants a
  reward goes through the quest board the usual way, proposed and approved by people.
- **No guests.** Members only, with no link a non-member can open and no public minutes.
- **No village-wide decisions.** A consent round in the room decides for the circle in the room.
  Anything for the whole village goes to governance.
- **No events on the public spine.** Its one capability keeps the meeting templates.

## Leaving

`forgetMemberSessions` (`server/lib/liveSessions.ts`) runs after the tombstone in
`anonymizeMember` (`server/lib/erasure.ts`). It deletes the member's people rows, their responses
and the entries they wrote, clears them off the actions they held, writes 0 where they facilitated,
took notes or opened a session, rebuilds the stored minutes of every closed session that named
them, and then deletes their number. A name the village no longer holds reads as "A member".

The task layer goes in the same transaction (`forgetTaskRowsFor` in
`server/repos/sessionTasks.ts`). The tasks of the entries they wrote are deleted with their state
and every answer to them. A task they held goes back to the circle. Where they gave the latest
answer, the answer keeps its kind and loses their number and their words, and every answer they
gave reads as a member's with its note removed. A send they pressed reads as sent by nobody.
`sessionIdsNaming` reads the three task tables too, so every record that named them is rebuilt.

Meeting templates go in the same transaction (`forgetTemplatesFor`): what they said or kept around a
talking stick is deleted, since its words are theirs, and a priority they wrote stays the circle's
plan with its author set to 0.

The agenda library goes in the same transaction too, after every session row is held: the items they
brought go (their takes stay, holding no words), a take they made reads as taken by nobody, where they
last changed somebody else's words the item says nobody, and a note they wrote on somebody else's item
goes, because those were their words. A note that became an entry in a room is an entry they wrote, so
it goes with the rest. A circle's rhythm they set last says it was set by nobody: the rhythm is the
circle's, and stays. The circles they followed and their calendar address go, so the address answers
nothing from then on. A circle's own calendar they attached says it was attached by nobody, and stays,
and so does a decision's review date they set. A decision they wrote went with the rest of their words,
so its review date goes too, with every "Review:" item made from it, since those carried the words.
The requests for advice they made go, with every ask and every word of advice on them, since those
answered their words; and their own advice on anybody else's request goes. Their votes on agenda items
go (0290).

`GET /api/profile/export` carries a `sessions` key with what this module holds about the member:
the sessions they were in, the agenda items they added or present, the entries they wrote or hold,
and their own answers, a night's answer-by time with it. From the task layer it carries `tasks`, the tasks they hold now, and
`taskAnswers`, every answer they gave a task with its date and words. A note somebody else left on
a task they hold is that person's, and stays out. From the agenda library it carries `library`, the
items they brought in their own words, `libraryTakes`, the times they put an item on an agenda, and
`libraryNotes`, the notes they wrote on items somebody else brought (the note and nothing else of the
item); a session's id travels only where they may read that session. From a circle's rhythm it carries
`rhythmsSet`, the circles whose rhythm they set last. From the calendar it carries `circlesFollowed`,
the circles they follow (`*` for every circle) and since when, `calendarAddress`, when their
address was made and last read, never its key, and `ownCalendarsAttached`, the circles whose own
calendar they attached, never its address. From decisions it carries `reviewsSet`, the review dates they
set last. From the advice process it carries `adviceAsked`, the requests they made in their own words,
and `adviceGiven`, the advice they gave, each with the request's id and nothing else of it. From the
agenda vote it carries `agendaVotes`, each vote they gave with its session, item and date.
