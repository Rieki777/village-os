# Organisational Memory (`saberra`)

Provenance: platform

> Written 2026-09-28 from the code on `wt/saberra-boundary-fix`, the vendor's own
> answers by email, and their live connector measured directly. Where this document
> and the code disagree, the code is right and this is stale.

An outside service keeps a record of how a village is actually organised, reads its
meetings and documents, and **suggests** changes to the village's circles and roles.
Suggest is the whole word. Nothing this module receives writes a seat.

Ships **off**, like every non-core module. A village that turns it on holds its own
connection: its own address at the service and its own token.

## What it does

- A steward presses **Sync now** on the module's card in Admin (Modules, Organisational
  Memory, Settings). This village **pulls** from the service; the service never pushes
  to us. That is why the listing declares `on-demand` liveness: silence between calls is
  normal and is not a failure.
- What comes back is sorted into two halves and only one of them can move today.
- Suggestions land in the **review queue** that already exists. A steward reads, edits,
  accepts or refuses them, and the change limit, the preview and the publish step apply
  exactly as they do to any other producer.
- What the service knows about a seat is stored beside that seat and shown on the role
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
by their seat, so while it was allowed, every assignment carried a person. With it gone,
what remains is state about a seat — its type, how energized it is, its term, when it is
next reviewed.

## The boundary

`server/lib/saberraRecords.ts` is the one door and nothing else in the module may touch a
raw vendor record.

- An **allow list per record kind**, never a deny list. A deny list admits the vendor's
  next new field by default, and a name rides in behind it.
- A second net drops any value carrying an email address at any depth.
- `Active Holders`, `Role Holders`, `Owner`, `Sensed By`, `Circle Lead`, `Rep Steward`,
  `Assignment Title` and the whole of the vendor's Profiles database are absent on
  purpose. `Owner Role` crosses, because a role is a seat and not a person.
- What was left behind is named, and an unmapped field is reported **separately** from one
  holding an address: the first is a gap in that file, the second is somebody to go and
  talk to.

**Read the values of a field before allowing it, never the name.** `Assignment Title`
sounds like a label and was the vendor's people-to-seats mapping. It was in the allow list
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

## Configuration

`module_settings.config`:

| Key | What it is |
|---|---|
| `apiUrl` | the service's address for THIS village. Must be https. The sync sends the village's sealed credential here. |
| `dashboardUrl` | where the module's link out to the service opens. |

Both are set on the module's card in Admin (`client/src/components/admin/SaberraConfigPanel.tsx`),
which is where the module's readiness link (`?setting=config`) lands. The same panel shows
the connection (key set or not, address set or not, facts held) and holds **Sync now**.
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
| cause a sync, read connection status | `intake.moderate` |
| read what the service holds about a seat | signed in, module on. No capability. |

The second is deliberate: the question that panel answers is whether to put your hand up
for a seat, and that is not a steward's question.

## What it does not do yet

- **Tensions and risks are not read.** The service does not offer them yet, so a sync
  does not ask, and says so per kind. They will be asked for the day the service's schema
  lists them.
- **Nothing is written back to the service.** The vendor's structure-write tools exist and
  no code here calls them.
- **Seatings are not proposed.** That is the people half.

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
