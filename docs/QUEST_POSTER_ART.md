<!-- carried 2026-08-29, round 7 lane CARRY -->

> **Dated 2026-08-29. Still accurate, and now unblocked.** Written 2026-08-08,
> re-checked against `origin/main` line by line before it was committed.
>
> **Both dependencies it names are closed.** Audit finding 7, the missing
> `onError` fallback, is `onError={() => setBroken(true)}` in
> `client/src/components/QuestCard.tsx`. Audit finding 5, the `/api/uploads/`
> allow-list on quest `imageUrl`, is `rejectOffsiteImage` in
> `server/index.ts`, guarding both the create and the update route. Nothing
> blocks a poster now.
>
> **The frame it describes is still the frame.** Board card `aspect-[16/9]`,
> detail hero `sm:aspect-[21/9]`, scrim `from-black/60 via-black/20
> to-transparent`, `group-hover:scale-105`. All four verified in the current
> components. The shot list still matches `server/seeds/quests-seed.json`
> exactly: fourteen quests, same titles, same order, same nine circles.
>
> **One number moved.** It says the total `dist/public` budget is 6000 KB. CI
> now sets `MAX_TOTAL_DIST_KB: 7000` (6600 until 2026-11-02). The argument is unaffected, since
> fourteen posters at 150 KB is still about a third of it, and posters belong
> in the uploads volume either way.
>
> **The work itself is not done.** All fourteen `imageUrl` values in the seed
> are `null`.

# Quest poster style bible

Art direction for the 14 quest posters. Painterly solarpunk, per the build
decision. Every constraint below that looks arbitrary was read out of the code
that will display these images, not invented.

## Where the files live, and why it is not `client/public`

**The uploads volume, served through `/api/uploads/:filename`.** Not
`client/public/images/`.

CI enforces three budgets on `dist/public`: main JS 700 KB, total 6000 KB, and
400 KB for any single image. Fourteen posters would eat a third of the total
budget on their own. More decisively, the gate's own comment says why:

> `client/public/assets` is served one-year-immutable and Vite does not
> content-hash passthrough files, so a fat PNG there is both slow AND
> unreplaceable for a year. Foundation art belongs in the uploads volume, which
> is hashed, cached correctly, and swappable.

Quest art is village content, not platform code. A fork should get the gradient
scenes and paint its own posters, which is exactly what `questScene()` already
does. Shipping Amora's photographs of Amora inside a white-label platform would
be brand-coupled content in a codebase whose whole discipline is the opposite.

**This depends on audit finding 7.** `QuestPoster` currently renders
`<img src={quest.imageUrl}>` with no `onError`, so a seed that references an
upload the village does not have shows a broken image instead of falling back to
its gradient. Add the `onError` fallback before any poster is referenced from a
seed. It is a four-line change and it is what makes uploads-volume art safe.

**Also depends on audit finding 5:** quest `imageUrl` needs the same
`/api/uploads/` allow-list the forum route already enforces, or the poster field
is an open redirect for visitor IPs on a public page.

## The frame the code will crop

The same file is used at two aspect ratios, so composition has to survive both.

| Surface | Container | What happens to the image |
|---|---|---|
| Board card | `aspect-[16/9]`, `object-cover` | Shown whole |
| Detail hero, under 640px | `aspect-[16/9]` | Shown whole |
| Detail hero, 640px and up | `aspect-[21/9]`, `object-cover` | Centre-cropped: 16/21 = **76% of the height survives**, so about 12% is cut from the top and 12% from the bottom |

On top of that:

- A scrim sits over every poster: `bg-gradient-to-t from-black/60 via-black/20
  to-transparent`. The bottom is at 60% black and the top is clear.
- White title text sits bottom-left, with the circle name beside it. On the hero
  that is a 4xl heading plus an italic subtitle.
- A translucent icon chip sits top-left (36px on the card, 44px on the hero, at
  a 12 to 16px inset). A status pill sits top-right.
- `group-hover:scale-105` on desktop grows the image 5%, eating roughly 2.4% at
  every edge.

**The safe frame, then:**

- Put everything that matters between **12% and 70% of the image height**. Above
  12% is cropped on desktop; below 70% is under the scrim and the title.
- Keep an **8% inset from every edge** so the hover scale never clips a subject.
- Leave the **top-left and top-right corners quiet** for roughly 18% square, so
  the chips sit on texture rather than on a face.
- Compose so the **bottom third is calm and dark-tolerant**: ground, water,
  shadow, foliage. It will be pushed to 60% black and covered in white type.
  Never put a face, a hand, or the one readable detail down there.

## Palette

Lock to Amora's own tokens, the ones `questScene()` already paints with:

| Token | Hex | Use in the art |
|---|---|---|
| `teal-deep` | `#157f7d` | Deep water, shadow under canopy, the cool anchor |
| `teal-light` | `#3a9896` | Mid-distance foliage in cool light |
| `forest` | `#2b4a3e` | Darkest greens, the frame's edges |
| `sage` | `#3d6e4a` | Mid greens, cultivated growth |
| `gold` | `#a06b1c` | Earth, timber, low sun |
| `amber` | `#ecb163` | Warm light, lamplight, skin-warm highlights |
| `coral` | `#9b4030` | Clay, terracotta, the one warm accent |
| `aqua` | `#83a7ad` | Sky haze, mist, distance |

Every poster leans on two or three of these plus a light key. No neon, no
saturated primaries, no colour that does not appear above.

## Setting

Premontane tropical Costa Rica: broadleaf canopy, tree ferns, volcanic soil,
timber and earth-plaster buildings with deep eaves, rain-washed light. Solarpunk
here means abundance and craft, not chrome: hand tools, growing things, solar
panels weathered into the roofline rather than gleaming on it.

## Human figures

People appear in most posters, and they are the hardest thing to keep consistent
across fourteen generations. The rules that make it tractable:

- **No recurring characters.** Each poster shows different people, so there is
  no continuity to break. This is the single biggest reason the style survives.
- **Medium to long shot.** Figures occupy roughly a third of the frame height,
  never a close-up portrait. The quest is the subject; the person is doing it.
- **Faces turned, angled, or occupied** with the work. Avoid front-on faces at
  scale, which is where generated humans go uncanny and where inconsistency
  shows most.
- **Hands are doing something and mostly partly occluded** by the tool, the
  plant, the instrument.
- **Plausibly mixed** in age and background, dressed for outdoor work in the
  tropics. No idealised model faces, no stock-photo teeth, no white linen.
- **Never a likeness of a real Amora member.** These are invented people.

## Light keys by circle

Assigning light by circle gives the board a rhythm, reinforces the circle
grouping the cards already show, and narrows the generation space enough that
fourteen images read as one set.

| Circle | Light key | Palette lean |
|---|---|---|
| Community Development | Golden hour, low warm sun | `amber` + `gold` |
| Regenerative Agriculture | Mid-morning, clear | `sage` + `teal-light` |
| Land Stewardship | Early morning mist | `forest` + `aqua` |
| Governance | Soft shaded daylight, deep eaves | `teal-deep` + `sage` |
| Tourism & Retreat | Late afternoon, long shadows | `amber` + `aqua` |
| Arts & Culture | Dusk, warm lamplight | `coral` + `gold` |
| Education | Bright midday, dappled | `teal-light` + `amber` |
| Technology | Cool shade, screen glow | `teal-deep` + `aqua` |
| Wellness | Dawn, low soft light | `sage` + `aqua` |

## The prompt

Locked prefix, per-quest subject, locked suffix. Only the middle line changes.

**Prefix (never edit):**

> Painterly solarpunk illustration, hand-painted gouache and soft digital
> brushwork, visible brush texture, warm naturalistic light, premontane tropical
> Costa Rica ecovillage. ONE continuous scene filling the whole frame, cinematic
> 16:9, single unbroken composition. The main subject sits in the upper middle of
> the frame, and the foreground falls away into soft quiet shadow with no hard
> horizontal edge and no border band.

**Subject:** one line from the shot list below, then the palette lean for its
circle, then the muted-palette sentence.

**Suffix (never edit):**

> Figures at medium distance, faces angled and occupied with the work, never
> posed for camera. No text, no letters, no numbers, no logos, no signage, no
> watermark. No UI elements. Corners uncluttered. Avoid: split panel, diptych,
> horizontal band across the image, letterbox bars, framed inset, hard horizontal
> seam, two separate scenes, close-up portrait, deformed hands, extra fingers.

**The wording of the prefix is load-bearing, and the first draft was wrong.**
It asked for "a calm, darker, low-detail lower third", which the model read as a
literal instruction to paint a *band*: the first poster came back as two stacked
scenes with a hard seam at 66% and a different landscape below it. Describing the
same thing as a continuous foreground falling into shadow, plus the explicit
"avoid" list, fixed it on the next attempt. Anything that names a region of the
frame risks being drawn as a region. Describe light and depth, never geometry.

**Also worth knowing:** the negative prompt goes inline as an "Avoid:" clause.
There is no separate negative-prompt parameter on this endpoint.

## Shot list

| # | Quest | Subject line |
|---|---|---|
| 1 | Welcome Ambassador | Two people greeting a newcomer at a timber village gate at golden hour, one carrying the visitor's bag, canopy path opening behind them |
| 2 | Food Forest Tender | A tender kneeling among banana, cacao and ground cover in mid-morning light, hands in the mulch, layered food forest receding into green |
| 3 | Potluck & Celebration Organizer | A long communal table under strung lights at golden hour, hands setting down shared dishes, people gathering at the far end |
| 4 | Trail Builder & Maintainer | A builder setting stone steps into a misty forest slope at dawn, mattock resting against a fern, the trail curving up into cloud |
| 5 | Circle Scribe | A scribe writing in a bound book at the edge of a seated circle, deep-eaved open pavilion in soft shade, faces of the circle turned inward and away |
| 6 | Retreat Center Host | A host carrying folded linens along a shaded veranda in late afternoon, open guest room beyond, long shadows across the boards |
| 7 | Village Photographer & Storyteller | A photographer crouched at dusk framing a shot of villagers at work, warm lamplight behind, camera raised and face hidden behind it |
| 8 | Children's Play Day Facilitator | Children running through dappled midday light in a clearing, an adult mid-motion holding one end of a long rope, laughter in the posture |
| 9 | Tech & Platform Steward | A steward at a low desk in cool shade, screen glow on their face turned in profile, cables coiled neatly, jungle bright through the doorway |
| 10 | Healing Arts Practitioner | A practitioner's hands working on a person resting on a low table at dawn, soft light through a gauze curtain, herbs in a bowl nearby |
| 11 | Infrastructure Builder | Two builders raising a timber frame in early morning mist, one steadying the post, solar panels weathered into the finished roof behind |
| 12 | Arts & Mural Maker | A muralist at dusk painting a large vine-and-water mural onto an earth-plaster wall, brush raised, warm lamp on the scaffold |
| 13 | Community Music Circle Host | A drum and string circle at dusk around a low fire, the host mid-beat with head down, warm light on faces turned toward the centre |
| 14 | Security & Night Watch | A night watch walking a lantern-lit path in deep blue evening, lamp held low, sleeping village and canopy silhouetted behind |

Note 14 is the one poster with a night key. Governance's shaded-daylight key does
not fit a night watch, and the board benefits from one image that reads
differently at a glance.

## Output spec

- **1600 x 900**, 16:9 exactly.
- **WebP, quality 78.** Target **under 150 KB** each, hard ceiling 400 KB (the CI
  per-image cap, which these will not be scanned by from the uploads volume, but
  the number is the house standard and a phone in rural Costa Rica pays for
  every kilobyte either way).
- Filenames `quest-01-welcome-ambassador.webp` through
  `quest-14-security-night-watch.webp`, numbered by the seed's `order`.
- Seed value: `"imageUrl": "/api/uploads/quest-01-welcome-ambassador.webp"`.
- Fourteen posters at 150 KB is about 2.1 MB in the uploads volume, which
  `/health` already reports a gauge for.

## QA before any poster is accepted

Per image:

1. Crop it to 21:9 centred and confirm nothing essential was lost.
2. Overlay the scrim and white title at bottom-left; confirm the title holds
   contrast and lands on calm ground, not on a face.
3. Drop a 44px chip in the top-left and a pill in the top-right; confirm neither
   covers the subject.
4. Look at it at card size, roughly 340px wide. Most generated detail disappears
   there. If the poster is unreadable small, it is the wrong composition.
5. Check hands, and check that no text crept in.

Across the set:

6. View all fourteen as a grid. They must read as one commission. If one jumps
   out, it is usually light key drift or a figure too close to camera.
7. Confirm each poster's light key matches its circle, so the circle filters
   feel like they are doing something visual.

## Provisioning

Every poster is a file in a runtime volume, not a repo artifact, so the fork
runbook needs one line describing how a village uploads its own and what happens
when it does not: the board paints `questScene()` gradients and looks finished
without them, which is the behaviour the card was built around in the first
place.
