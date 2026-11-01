# Organisational Memory (`saberra`)

Provenance: platform

> Written 2026-09-28 from the code on `wt/saberra-boundary-fix`, the vendor's own
> answers by email, and their live connector measured directly. Where this document
> and the code disagree, the code is right and this is stale.

An outside service keeps a record of how a village is actually organised, reads its
meetings and documents, and **suggests** changes to the village's circles and roles.
Suggest is the whole word. Nothing this module receives writes a role.

Ships **off**, like every non-core module. A village that turns it on holds its own
connection: its own address at the service and its own token.

## What it does

- A steward presses **Sync now** on the module's card in Admin (Modules, Organisational
  Memory, Settings). This village **pulls** from the service; the service never pushes
  to us. That is why the listing declares `on-demand` liveness: silence between calls is
  normal and is not a failure.
- Beside the button, a founder can set the module to **sync by itself**, daily or every
  six hours. Off is the default. Every run, pressed or scheduled, is reported in full under
  the button. See "Syncing on a schedule" below.
- What comes back is sorted into two halves and only one of them can move today.
- Suggestions land in the **review queue** that already exists. A steward reads, edits,
  accepts or refuses them, and the change limit, the preview and the publish step apply
  exactly as they do to any other producer.
- What the service knows about a role is stored beside that role and shown on its role
  card to **every member**, so somebody can read what a role involves before deciding
  whether to put their hand up for it.

## The two halves, and why the line is where it is

The split is by **personal data**, not by topic.

| Half | Carries | State |
|---|---|---|
| structure | circles, roles, role assignments; tensions and risks once the service offers them | flows today |
| people | anything that names somebody | gated, see below |

A module whose domain holds personal data is `member-pii`, and behind a vendor driver
that class may not go live without a signed processing agreement, a documented
hard-delete endpoint, and a `forgetMember` driver wired into the erasure sweep. The
vendor's delete endpoint does not exist yet.

Put both halves in one batch and the whole import waits on that endpoint. Split them and
the structure half, which is most of the value, lands without waiting for anything.

**Role assignments are in the structure half**, which is not obvious. It became true when
`Assignment Title` was excluded: every value of that field was a person's name followed
by their role, so while it was allowed, every assignment carried a person. With it gone,
what remains is state about a role — its type, how energized it is, its term, when it is
next reviewed.

## The boundary

`server/lib/saberraRecords.ts` is the one door and nothing else in the module may touch a
raw vendor record.

- An **allow list per record kind**, never a deny list. A deny list admits the vendor's
  next new field by default, and a name rides in behind it.
- A second net drops any value carrying an email address at any depth.
- `Active Holders`, `Role Holders`, `Owner`, `Sensed By`, `Circle Lead`, `Rep Steward`,
  `Assignment Title` and the whole of the vendor's Profiles database are absent on
  purpose. `Owner Role` crosses, because it names a role and not a person.
- What was left behind is named, and an unmapped field is reported **separately** from one
  holding an address: the first is a gap in that file, the second is somebody to go and
  talk to.

**Read the values of a field before allowing it, never the name.** `Assignment Title`
sounds like a label and was the vendor's people-to-roles mapping. It was in the allow list
for a day and nothing caught it: the address net looks for an address and that is a name.

## What a sync asks for

This village's kind ids are its own and stay so: `circle`, `role`, `roleAssignment`,
`tension`, `risk` (the allow list keys in `saberraRecords.ts`). The service names one of
them differently. Its mail of 2026-09-24 says `list_records` covers "Circles, Roles, and
Role Assignments", and its mail of 2026-09-28 says its founder "called list_records on
role_assignment". So:

| Ours | Sent to the service | Offered today |
|---|---|---|
| `circle` | `circle` | yes |
| `role` | `role` | yes |
| `roleAssignment` | `role_assignment` | yes |
| `tension` | `tension` | not yet |
| `risk` | `risk` | not yet |

**The argument the kind travels under is not measured.** So before the first
`list_records`, a sync reads the service's MCP `tools/list`, and `server/lib/saberraKinds.ts`
reads `list_records`' `inputSchema`:

1. A property carrying an enum that names one of our kinds is the kind argument, and the
   enum decides what is offered. The enum's own spelling is what gets sent. When any
   property carries a familiar argument name, only those are read here: a `sort_by` that
   lists `role` among its values is a sort order, and taking it once sent `{ sort_by:
   "role" }` with no kind at all.
2. Otherwise a familiar argument name (`kind`, `record_type`, `type`, `table` and a few
   more) is the kind argument, and the table above decides what is offered.
3. Otherwise, or when `tools/list` fails or carries no schema, the argument is `kind` and
   the table decides.

A kind this village holds and the service does not offer is **asked for nowhere and named
in the answer**, one line each under `notOffered` (`tension: not offered by the service
yet`). The answer's `asked` says which argument and values were sent and which rule above
chose them, so a measured plan and a guessed one can be told apart. The panel prints its
note under every sync, louder when the mail decided.

**A failure describes the reply's shape, never its values.** A failure's `detail` is taken
before the boundary above runs, so neither the allow list nor the address net has seen it,
and it reaches the sync's answer. An unreadable reply is therefore described by its keys
(identifiers only; a key with a space or an `@` is counted, never named), each content
block's type and length, and whether that text parsed as JSON. The service's own words for
a refusal are clipped to 400 characters and withheld whole when they carry an address. The
panel repeats a detail only for a refused call and for the service saying no.

## How the service's role becomes a role on the chart

`server/lib/saberraProposals.ts` turns roles into one `org.proposed`. A role's `Circle`
is a **relation** in the service's store (page ids, or objects carrying an id and maybe a
name), so it is read in any of those shapes by `server/lib/saberraRelations.ts` and its ids
are resolved against the circle records of the same read. An id that resolves to nothing is
counted and never shown as a name. The sync's answer carries `circles`: how many roles were
placed, unresolved, absent or named several circles, and the field's **shape** (never its
value), so the shape is measured on every sync. The aim comes from `Body` when it is text.
The first live sync (2026-10-09) lost every role's circle and aim because only a string was
read.

The service's `Status` is carried as the source wrote it and applied by the structure
review (`shared/structurePlan.ts`):

| Status | In the structure review |
|---|---|
| Active | proposed as usual |
| Proposed | proposed, tagged "Proposed in" the service |
| Vacant | proposed as a role with an opening; never sets `recruiting` |
| Archived | never proposed as new; listed apart under "Archived in" the service, with its reason, and a role in an archived circle goes with it. One that matches a live circle or role here is a note, never a retirement |

**Pressing Sync now again replaces what is still waiting.** A changed claim supersedes
the waiting one; an unchanged one is moved into the new delivery (`rebatchWaiting`), so
the newest batch is whole. Accepted, rejected and superseded proposals are left as they
are. A proposal stored before this could read relations cannot be repaired from what is
stored; the next sync replaces it.

**A record the service stops sending leaves the queue** (2026-10-31). Superseding and moving
both need the record to come back, so a circle the service archived out of its answer, or
deleted, used to wait for good: thirteen did, for three weeks. Now, after a read lands, a
waiting circle, tension or risk whose record the read did not carry is withdrawn
(`withdrawGone`, status `superseded`), and the run counts it. Only a kind read WHOLE can
say that: one that failed or was cut short at the page ceiling withdraws nothing, and nor
does an empty answer for a kind. The structure batch keeps its own rule, since a changed
structure already replaces the waiting one. If the service sends a withdrawn record again
unchanged, it comes back into the newest batch (`reopenSuperseded`), and any other claim
still waiting about the same record is retired. `superseded` is only ever written by a
landing, never by a steward, so bringing one back undoes no decision.

## Syncing on a schedule

The founder's commitment to the vendor (2026-10-13) was a polling schedule beside the Sync
now button, live in the module's settings, with a full report of each run. The code is
`server/lib/saberraSync.ts` (the sync and both ways it starts), `server/lib/saberraPolling.ts`
(the arithmetic) and `client/src/components/admin/SaberraSyncSchedule.tsx` (the control and
the report).

- **The setting** is `pollSchedule` in the module's config: `off` (the default, and what an
  absent key reads as), `daily` or `every-6-hours`, saved through the same `validateConfig`
  the config route runs.
- **Off never calls the service** and writes nothing. On, the scheduler's `saberra-poll` job
  checks every tick (five minutes) and calls the service only while the module is not off,
  a key and an https address are set, and the schedule's gap has passed.
- **A missing key or address is said once.** The check writes one "Not run" entry and says
  nothing more while the newest entry already says it. It is written again only after
  something else has happened since.
- **Only a real change makes a batch.** A press of Sync now replaces what is waiting (the
  section above), which is right for the person about to review. A schedule presses nobody's
  button, and every six hours it would keep moving a steward's open batch out from under
  them. So a scheduled read is fingerprinted (a hash of each record's kind, id, link and the
  fields the boundary lets cross, keys and records sorted). When it matches the last read
  that **landed**, the run is logged as "No changes" and the review queue and the facts are
  not touched. A press lands as it always has, and its read becomes the one the schedule
  compares against. A change only in a field the boundary drops is no change, because nothing
  this village would propose moved. The first scheduled run after this shipped has nothing to
  compare with, and lands once.
- **Half a read is not a change.** A scheduled read with any kind failing lands nothing and
  counts as a failure. A press still lands what it could read, as before, and its report says
  which kinds failed.
- **Never two at once.** Every sync runs under one named database lock (`withNamedLock`,
  `server/repos/namedLock.ts`, the lock the failed-actions job runs under). A press that finds
  a sync running is answered 409 ("A sync is already running"), and a scheduled check that
  finds one waits for its next tick. The lock belongs to one database session, so a process
  that dies mid-sync releases it.
- **The clock** is the last run that called the service, pressed or scheduled, so a press
  pushes the next scheduled run out by a whole gap. **Backoff:** one failure retries on the
  schedule; from the second failure in a row the gap doubles, up to four times the schedule
  (every six hours becomes twelve, then twenty-four; daily becomes two days, then four). It
  never shrinks below the schedule. Any whole read resets it. A press that landed only part
  of a read neither resets it nor counts as a failure. The panel says when it is backing off
  and by how much.
- **The run log** is the last twenty runs, one `app_config` document (`saberra-sync-runs`),
  each with when it started, scheduled or by hand, its outcome, the counts (records read,
  suggestions landed, carried forward, replaced, withdrawn as gone, refused, facts stored, records held back,
  records that carried an address), the kinds not offered, the kinds cut short, each failed
  kind and how, how the roles' circles were read with the shapes line (an object's keys taken
  out, and a shape holding any other text dropped), how the kinds were chosen, and one
  sentence from a fixed table when something went wrong. **Typed fields only:**
  never the key, never a field name or value, never the service's own words, never a
  failure's detail. `readLog` rebuilds every run from its types on the way out too.
- **The panel** shows the schedule beside Sync now, the next scheduled time in the village's
  own timezone (named), and the log under the button. The schedule can be set while the
  module is off and starts when it goes on.
- **No migration.** The setting is module config and the log is an `app_config` document.

The other half of that commitment, a signed receiver for the service's event feed with its
own inbound token, waits for the vendor to have an event feed. Nothing here receives.

## Configuration

`module_settings.config`:

| Key | What it is |
|---|---|
| `apiUrl` | the service's address for THIS village. Must be https. The sync sends the village's sealed credential here. |
| `dashboardUrl` | where the module's link out to the service opens. |
| `pollSchedule` | how often the module syncs by itself: `off` (default; absent reads as off), `daily`, `every-6-hours`. |

Both are set on the module's card in Admin (`client/src/components/admin/SaberraConfigPanel.tsx`),
which is where the module's readiness link (`?setting=config`) lands. The same panel shows
the connection (key set or not, address set or not, facts held) and holds **Sync now**.
Under Sync now, its schedule and the run log, it lists what the journal bridge would send
(`SaberraOutboxPanel.tsx`), without the words.
The key itself is never entered there: the panel links to Admin, Integrations.

The panel saves **only the fields somebody edited**, over a fresh read of the stored config.
A save that carried both would put this tab's stale copy of the untouched field over
whatever another admin saved since, and on `apiUrl` that sends the next sync's key to the
old host.

One rule decides what counts as an https address: `httpsAddress` in `shared/modules.ts`.
The listing's `validateConfig` refuses a save with it, the sync route refuses a call with
it, and the panel refuses in the browser by running that same `validateConfig`.

Secret slot: `sera_api_secret`, held in the village's own secret store
(`server/lib/secrets.ts`). The environment fallback name is `SERA_API_SECRET`.

**The address is read from the store and never from a request.** An earlier version took
it from the request body, which meant anybody holding `intake.moderate` could name a host
and be sent the village's key.

## Who may do what

| Action | Gate |
|---|---|
| cause a sync, read connection status, read the run log (`GET /api/saberra/runs`) | `intake.moderate` |
| set the schedule | admin, through the module config route like the addresses |
| read what the journal bridge would send (`GET /api/saberra/outbox`) | `intake.moderate`. Kind, date, code-name, length and status only, never the words. |
| read what the service holds about a role | signed in, module on. No capability. |

The last is deliberate: the question that panel answers is whether to put your hand up
for a role, and that is not a steward's question.

## What it does not do yet

- **Tensions and risks are not read.** The service does not offer them yet, so a sync
  does not ask, and says so per kind. They will be asked for the day the service's schema
  lists them.
- **Nothing is written back to the service.** The vendor's structure-write tools exist and
  no code here calls them.
- **Journal entries are recorded and not sent.** The journal bridge (part 1, `drizzle/0261_a_journal_crosses_under_a_code_name.sql`)
  queues every shared entry under a code-name with member names swapped out, plus a weekly
  team signal, in `saberra_outbox`. The service has not named where journal entries land, so
  no transport exists and nothing is sent; `docs/modules/journal.md` has the rules. When a
  transport is wired, this listing's `dataClass` question comes back: pseudonymised member
  writing is closer to `member-pii` than to `village-content`, and the registry comment on
  the listing names what that class needs before it goes live.
- **Seatings are not proposed.** That is the people half.
- **Nothing is received.** The service has no event feed yet, so there is no inbound
  endpoint and no inbound token. The schedule pulls.

## Turning it off

Absent `module_settings` row means off. Off unmounts the routes, so nothing is fetched
and nothing is shown.

Every row this module wrote is findable by its module id alone, which is why
`module_entity_facts.module_id` is a plain string and not a foreign key (`drizzle/0221_a_seat_carries_what_a_module_knows.sql`),
and `forgetModuleFacts` removes all of them.

**That function is not yet called by anything.** Turning the module off leaves its rows in
place, and `GET /api/saberra/status` reports how many there are so a village can see what
it still holds. Two reasons it is not wired to the off switch: `off` is a reversible state
a village may use for a week, and this data is a mirror of the service's own record rather
than anything the village authored, so deleting on every toggle would cost a full re-sync
for no gain. A deliberate revoke wants its own button, and that button does not exist.
