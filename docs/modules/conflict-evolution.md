# Module design: conflict evolution

Provenance: platform

> Registry id `conflict-evolution`. Routes in `server/routes/conflictAgreement.ts`, behind
> `requireModule("conflict-evolution")` on `/api/conflict-agreement`, `/api/admin/conflict-agreement`
> and `/api/care`, plus the agreement's change vote at `/api/governance/conflict-agreement-changes`,
> which also sits behind the governance module. The gates are mounted in
> `server/routes/canvasModuleGates.ts`. Rules in `server/lib/conflictAgreement.ts` and
> `shared/conflictAgreement.ts`; the carried vote lands through `server/lib/conflictAgreementCloser.ts`.
> No table of its own: three `app_config` documents, `conflict-agreement`,
> `conflict-agreement-proposal:<ballot>` and `ombuds-asks`.

**A conflict agreement the village writes for itself: where a conflict goes, who takes it and who
covers when they cannot, how soon a member hears back, a contact outside the village, and a private
ask to that contact. The founders write it before the Game starts; after that, a change is a vote of
the village.**

## Status

Ships OFF, like every non-core module (Rye's module ruling, 2026-10-01). A founder turns it on in
Modules. Nothing turns it on by itself, a season file included. Nothing to set up first: the
agreement starts from the exit policy's own restorative steps, and the launch row says what is
still missing.

It does not need the Governance Canvas, and the canvas does not need it. With both on, the canvas's
block 8 (Conflict) carries the agreement's editor under Say.

## What every village has without it

A conflict path is part of every village, like leaving is. With this module off:

- the exit policy's **restorative block** is the village's conflict path, edited on Departures
  (the steps and the intake role) and printed at `/exit-policy`, `/governance` and `/roles`;
- the **private intake** reaches the live holders of the intake role and nobody else, and its words
  are never emailed;
- the public read of the exit policy still withholds a step that names a member.

Those are core and stay on whatever this module says.

## While it is on

- The agreement answers the exit policy's restorative block everywhere it is read
  (`withConflictAgreement`, read through `readExitPolicy()` in `server/index.ts`), so two pages can
  never print two conflict paths.
- Departures asks for the cover role, the reply time in hours (no platform default) and the outside
  contact, and the `conflict-door` launch row (blocking) applies: a live holder of the intake role or
  a named outside contact, and a reply time the village chose. Below three members who are not
  founders, only the outside contact will do.
- After the Birthing the restorative block changes only by the agreement's vote. Departures stops
  offering its fields, and a canvas suggestion to the care door says the same.
- The ombuds door records who asked, when and which contact. It carries no words and sends nothing.

## While it is off

- Every path under its prefixes answers `404 { "error": "module_disabled", "module": "conflict-evolution" }`,
  and so does the change vote.
- The agreement does not answer the restorative block. A stored agreement stays in `app_config`
  and answers again when the module is back on.
- Departures shows the restorative steps and the intake role, editable after the Birthing as they
  were before this module existed. The `conflict-door` row does not appear and does not block.
- `/governance` prints the exit policy's restorative steps where the agreement's public view was.
- The canvas's block 8, when the canvas is on, shows those steps under Say.

## The lifecycle

| Lifecycle | An admin | A member | A visitor |
| --- | --- | --- | --- |
| off | 404 | 404 | 404 |
| preview | every door | 404 | 404 |
| members | every door | every door its own rule allows | 401 |
| public | every door | every door its own rule allows | `GET /api/conflict-agreement/public` only |

The public view names roles and never members: outside contacts by organisation or role, safety
contacts left out, and every piece of text that names a member or one of the agreement's own
contacts withheld.

## Still to come

The care stages, routing, the consequences ladder and `/care` are planned (plan section 6) and not
built. `/api/care` is already listed as this module's prefix, so those routes mount behind this gate
the day they land.
