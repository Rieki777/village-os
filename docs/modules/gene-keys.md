# Module design: gene-keys

Provenance: platform

> Registry id `gene-keys`. The contract is `shared/geneKeys.ts` (the wheel, the Human Design tables, type and
> authority, the chart checks and the words). The sky is read in the browser by `shared/geneKeysSky.ts`, the
> only file that imports `astronomy-engine`. Routes in `server/routes/geneKeys.ts`; the rules in
> `server/lib/geneKeys.ts`; every statement in `server/repos/geneKeys.ts`; the schema in
> `drizzle/0272_a_member_keeps_their_gene_keys.sql` and `drizzle/0287_gene_keys_find_a_badge_and_a_match.sql`.

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
- Launch showed the Activation Sequence only. Love (the Venus spheres) and Prosperity (the Pearl spheres) opened
  on 2026-10-30, after their live test matched genekeys.com on 77 of 77 key.lines ("10. Great!", 2026-10-23).
- The "Lines found" badge carries no multiplier and never pays Gratitude (Rye, 2026-10-30).
- "Who complements me" is opt-in on both sides (2026-10-23).
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
  to the circle and letting the guide use them are separate permissions. "Talk to me plainly" (`maia_plain`)
  keeps the lines for choosing what she suggests and takes them out of her wording.
- **"Who complements me" lists only members who joined it and show their lines**, and only to a member who did
  both; both conditions are in the SQL (`complementCandidates`).
- **The badge is earned only by SHOWN lines** (metric `gene_keys_shown`), so a public badge never says a member
  did Gene Keys they keep hidden.
- **The moon contemplation is a private Journal entry.** It lives, exports and is erased with the Journal.
- **A member's own Western signs (0303) are theirs alone.** Rye asked for "gene keys + human design and
  astrology" (2026-11-01). The page reads the Sun and Moon signs in the browser from the same date and town
  (`natalSigns` in `shared/geneKeysSky.ts`, `signsFor` in `client/src/components/geneKeys/natal.ts`) and sends only
  the numbers, 0 Aries to 11 Pisces. Each is sent only when the whole span the birth could fall in agrees on it:
  without a birth time the Moon can change sign that day, and then it is stored as not known, never guessed. A new
  reading replaces them, and one sent without signs clears them. They are member-pii (Module Library Contract
  clause 13): shown on the member's own controls only, never on a door that shows lines to anybody else
  (`shownGeneKeysFor` and `shownGeneKeysByHandle` do not select them), in the export, and gone with the row.
- **Erasure** deletes the row in the `gene-keys-after-tombstone` step, signs included. **Export** includes the
  stored row, signs included.

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
| `PUT /api/gene-keys/me` | the member | save `{ chart, source, visibility?, maia? }`; 30 an hour; answers `badgeEarned` |
| `PATCH /api/gene-keys/me` | the member | `{ visibility?, maia?, maiaPlain?, complement? }`; answers `badgeEarned` when showing earns it |
| `DELETE /api/gene-keys/me` | the member | remove their row |
| `GET /api/gene-keys/people?ids=` | any member | shown lines for up to 60 user ids, keyed by id |
| `GET /api/gene-keys/people/:handle` | any member | one member's shown lines, or `null` |
| `GET /api/gene-keys/complements` | the member | "Who complements me": `no-lines`, `hidden`, `not-joined`, or `joined` with up to 12 people |
| `GET /api/gene-keys/places` | any member | the birth-town list (`server/assets/places`), searched on the device |

## Where it shows

Every surface wears the profile's night world (`sheet-night`) and renders nothing while the module is off.

- **`/profile/gene-keys`** (`client/src/pages/GeneKeys.tsx`, a lazy chunk so nobody downloads the sky maths
  until they open it): birth date, time or "I don't know my birth time", the birth town searched on the device,
  the window choice when time decides the result, the reveal, then show or hide and Maia's yes, then the save.
- **The seal** (`GeneKeysSeal.tsx`) on the member's own portrait (`ProfileHero`) and on another member's
  (`PublicProfile`): hover or focus shows the two words, a click or tap opens the lines card, as a dialog on a
  wide screen and a sheet on a phone.
- **The lines card** on the member's own profile, with their controls (show or hide, Maia, find again, remove),
  and on another member's public profile without them. Before a result exists, the own-profile card invites.
- **The character page** (`GeneKeysPrompt.tsx`): a card while the member has no result, and a popup once, after
  a character joins their party. "Once" is per device (`localStorage`).
- **The circle view** (`CircleLines.tsx`) inside each circle on `/circles`, from the role holders `/api/org`
  names to a signed-in member: the six lines bottom up, the open ones as invitations, the type mix, and one count
  for members who keep their lines private.
- **Role applications** (`ApplicantGeneKeys` above the card on `/role-applications/:id`): the candidate's seal
  and one plain sentence, read by their id, only when they show their lines. Information, never a score.
- **The reveal** (`GeneKeysReveal.tsx`): the six lines draw in and the member's two light up; reduced motion draws
  the finished state.
- **The Trail and Start Here** offer "Find your lines" only where nothing else is waiting: a member may skip.
- **"Roles that fit your lines"** (`RolesForYourLines.tsx`) on the saved step of `/profile/gene-keys`: the roles
  the member already holds that their lines fit, in one sentence, "Builder (Rick)", then the open roles best fit
  first, each with its "Why you". A role fits when its circle has nobody else showing one of the member's lines,
  and a little more when it suits one of their characters.
- **"Why you"** on every role in "Roles that fit this character": the character, and a line the role's circle
  has nobody showing.
- **Love and Prosperity** fold under the Activation tiles on every lines card.
- **"Who complements me"** (`GeneKeysComplements.tsx`) on the member's own card.
- **"Share my lines"** (`ShareLines.tsx`, `shareCard.ts`): a PNG drawn on the device in the night theme, handed to
  the share sheet or downloaded. Profile, words, type and the four keys; never birth data.
- **A contemplation each moon** (`GeneKeysMoon.tsx`, `moon.ts`) on the Journal's Today tab and the own card: one
  prompt on the Life's Work key, the member's own words, and where they met it from (Shadow, Gift, Siddhi), kept
  as a private `free` Journal entry. The ladder shows the last 13 moons. No Gene Keys text of Richard's is
  reproduced; the card links to genekeys.com.
- **Maia speaks your type** (`MaiaTypeLine.tsx`) under the quest board's first suggestion, only with Maia's yes
  and not while the member asked for plain talk; her note (`assistantNoteFor`) says when she shapes something.
- **On the living map of the circles** (`/map/circles`), mounted by the map lane on its renderer, which this module
  does not edit: `CircleGlyph` (`{ cx, cy, r, px, holderIds }`: six bars on a plate outside a circle's rim, solid for
  a line someone shows, a dashed gold outline for a gap) and `HolderGeneKeys` (`{ userId, name, size? }`: a role
  holder's seal, opening their lines card). Both draw nothing while the module is off or for hidden lines, and every
  use on a page joins one batched read (`shownLines.ts`).

## Not built yet

- Each key's own Shadow, Gift and Siddhi words: those are Richard Rudd's text and wait on an agreed content pack.
- The land map (`/map`, the artifact) carries no glyph; holder ids never reach it.
- A profile typed from memory (`source = 'typed'` is in the schema, refused by the save door): it has no chart
  behind it, so it can carry no Human Design type.
- "Sleep on it" as a consent answer belongs to Live Sessions, whose files another lane holds; it was offered to
  that lane.
- The city list is GeoNames `cities15000` (CC BY 4.0, credited on the form).
- The rising sign. `rising_sign` (0303) is in the table, and stays NULL: the rising sign needs the birth town's
  latitude and longitude, and the town list carries only a name, a country and a clock. Adding them means
  regenerating the list from GeoNames, which is a download for Rye to agree to. It would also be read only from an
  exact birth time.
