# Module design: gene_keys

Provenance: platform

> Registry id `gene_keys`. The contract is `shared/geneKeys.ts` (the wheel, the Human Design tables, type and
> authority, the chart checks and the words). The sky is read in the browser by `shared/geneKeysSky.ts`, the
> only file that imports `astronomy-engine`. Routes in `server/routes/geneKeys.ts`; the rules in
> `server/lib/geneKeys.ts`; every statement in `server/repos/geneKeys.ts`; the schema in
> `drizzle/0272_a_member_keeps_their_gene_keys.sql`.

**Each member can find their Gene Keys lines and Human Design type from their birth details. The details are
read on the member's own device and never sent: the village stores the result (26 activations) and nothing
else. The two profile lines show as a seal on the portrait unless the member hides them, a circle sees which of
the six lines it holds, and Maia shapes her suggestions to how a member works best when they say yes.**

## Status

Ships OFF, like every non-core module. An admin turns it on to `members`. Nothing to set up.

Rulings it follows (Rye, 2026-10-22):

- Visible by default. A member can skip Gene Keys entirely, or do them and hide them.
- Key numbers may be public on the profile, though Life's Work key and line pin a birth day and month.
- Richard Rudd has agreed to Amora using Gene Keys naming; every surface links to genekeys.com to explore more
  in depth.
- Lines may appear on role applications.
- Time zones use the same offsets genekeys.com uses (the browser's zone data, which has no pre-1970 history for
  merged zones), so a member sees the same keys on both sites.
- Launch shows the Activation Sequence only. The Venus and Pearl spheres are already in the stored chart.
- The seal and the circle view use the Life's Work line words (Creator, Dancer, Changer, Server, Fixer, Teacher)
  for both numbers of a profile. The lines card shows each sphere's own word.

## The privacy line

- **No birth date, time or place reaches the server.** `PUT /api/gene-keys/me` takes a chart. `parseSave`
  rebuilds it from its 26 activations, so nothing else a client sent is stored. The migration's header forbids a
  column that could hold birth data.
- **The server derives type, authority and profile itself** (`analyse`, `profileOf`). A client never tells the
  server its type, and a chart that breaks the sky's own rules (`chartProblems`: Earth opposite the Sun, the
  nodes opposite, the design Sun 88 degrees back) is refused.
- **Another member's lines are read only when shown.** Both batched reads filter on `visibility = 'show'` in the
  SQL. Hidden means hidden everywhere: profile, circle view, role applications.
- **Maia reads the lines only with the member's yes** (`maia`), and only while the module is on. Showing lines
  to the circle and letting the guide use them are separate permissions.
- **Erasure** deletes the row in the `gene-keys-after-tombstone` step. **Export** includes the stored row.

## The calculator, and how it was proven

Gate 41 starts at 302 degrees; the design moment is the Sun 88 degrees of arc before birth; the node is the true
(osculating) node. On 2026-10-22 invented births were run through genekeys.com, humandesignchart.org and
arcanepattern.com, and `shared/geneKeys.test.ts` pins what those sites printed:

- the Activation Sequence for 7 births, including pairs 2 to 4 minutes either side of a line change;
- all 26 activations and all 11 spheres for one birth (the sphere to planet mapping matched 187 of 187);
- type, profile and authority for 9 births, including two the node model decides and one
  (Sacral to G to Throat) that humandesignchart.org gets wrong and the standard rule calls a Manifesting
  Generator.

`astronomy-engine` (MIT) and Swiss Ephemeris disagreed on 2 of 20,000 random births by one line. Swiss
Ephemeris is AGPL and this repository is MIT, so the browser uses `astronomy-engine`.

## Birth time

Every calendar day crosses at least one line change. Assuming noon gets type wrong for about 13% of people and an
hour either way changes it for about 6%. `resultsAcross` finds every distinct result in a span of minutes, each
change to the minute: the flow scans the whole day when the time is unknown and half an hour either side when it
is known, and asks the member to choose when the result changes. The saved row records `source`: `exact` or
`chosen`.

## HTTP

| Route | Who | What |
|---|---|---|
| `GET /api/gene-keys/me` | the member | their lines and settings, or `null` |
| `PUT /api/gene-keys/me` | the member | save `{ chart, source, visibility?, maia? }`; 30 an hour |
| `PATCH /api/gene-keys/me` | the member | `{ visibility?, maia? }` |
| `DELETE /api/gene-keys/me` | the member | remove their row |
| `GET /api/gene-keys/people?ids=` | any member | shown lines for up to 60 user ids, keyed by id |
| `GET /api/gene-keys/people/:handle` | any member | one member's shown lines, or `null` |
| `GET /api/gene-keys/places` | any member | the birth-town list (`server/assets/places`), searched on the device |

## Not built yet

- The Venus (Love) and Pearl (Prosperity) sequences on screen. Open `SHOWN_SPHERES` after their own live test.
- A profile typed from memory (`source = 'typed'` is in the schema, refused by the save door): it has no chart
  behind it, so it can carry no Human Design type.
- "Sleep on it" as a consent answer belongs to Live Sessions, whose files another lane holds; it was offered to
  that lane.
- The city list is GeoNames `cities15000` (CC BY 4.0, credited on the form).
