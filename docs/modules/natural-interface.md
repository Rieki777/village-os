# The Natural Interface Kit

<!-- describes: client/src/components/natural/moments.ts client/src/lib/celebrated.ts server/lib/notify.ts client/src/index.css client/src/lib/haptics.ts client/src/lib/sound.ts client/src/components/natural/useReducedMotion.ts scripts/check-image-budget.mjs -->

The design foundation the rest of the product draws from. It lives in
`client/src/components/natural/`, plus two utilities in `client/src/lib/`.

The ruling it exists to keep, from the founder:

> Across the whole Game feel use regenerative, organic, and natural elements,
> graphics and feels (so if there is a progress ring, maybe have it be a moon
> going through phases from new moon 0% to full moon 100%) if there are
> sounds, it's nature sounds, everything about our Game is meant to get people
> into the real world with real life, we want to emulate that effect in our
> Game here by honoring and displaying nature everywhere.

And, on the moon specifically:

> For the moon completion Icon it should have a graphical phase for at least
> each 12.5% illumination/completion.

## The principle: what earns motion at all

Founder-approved, and the standing guidance for every lane after this one.
Read it before adding an animation anywhere in the product, and read it
instead of deciding fresh.

> **Motion that ANSWERS the person is alive. Motion that INTERRUPTS them is
> noise.**
>
> Animate: state transitions (things appearing, collapsing, arriving,
> filling), rare earned moments, arrivals, and waiting. Do not animate:
> ambient idle motion, anything on every row of a list, anything that moves
> the camera, or anything a person did not cause. Every effect needs a real
> reduced-motion still state that is dignified rather than absent. Transform
> and opacity only. Celebration is for RARE things; frequent events get a
> whisper. A product that celebrates everything celebrates nothing.

### What that rules out, in the cases that have already come up

**"Anything a person did not cause" is about causation, not about timing.** A
member who does a quest, has it consented, and comes back to look has caused
the moment they are shown, even though the consent happened while they were
away. What the rule forbids is the page celebrating its own load: a card that
throws petals on mount because a fetch resolved is celebrating a fetch. The
distinction is enforced mechanically in two places and neither is optional.
`arrivalStep` in `client/src/components/natural/moments.ts` fires only on a
change between two states it actually watched change, so the first real
reading always seeds the baseline in silence. `client/src/lib/celebrated.ts`
holds a moment to ONCE, EVER, keyed on the event, which is the same rule
`server/lib/notify.ts` already keeps with its `dedupe_key` and the comment
"re-computation can never re-celebrate".

**A still state is a composition, not a cancellation.** The global
reduce-motion block in `client/src/index.css` sets `animation-duration: 1ms`,
and for an effect whose content is "rise and fade" that arrives at an empty
box. Two live examples of getting this wrong, both now fixed: the crowdpool
ring's arrival ripple was `opacity: 0` under reduce-motion, which deleted the
arrival for exactly the members the rule exists to serve; and unmounting a
celebration in its own `onDone` shows those members one frame, because
`onDone` fires immediately when there is no animation to wait for. That second
trap is why `useMomentWindow` is a clock rather than a callback: the window is
the same length whichever way a member has their preference set.

**Celebration intensity is a budget with a fixed size.** `moment` is spent on
the events below and nothing else. Everything else is a `whisper`, and most
things are neither.

### The wired moments, and the kind each one takes

Five of these took a kind apiece, and that was a coincidence worth keeping
while it lasted: no two moments in the product looked alike. The sixth is
`dawn` a second time, which is stated here instead of quietly broken. A
governance decision carrying already draws `dawn` in
`client/src/components/governance/DecisionOutcome.tsx`, and a power crossing
over IS a decision carrying, seen from the side of the thing that moved. They
are the same daybreak read twice, they can never fire on one page at once
(`TransferCeremony` plays it and the outcome card stands down), and giving the
crossing a different drawing would say the two events are unrelated when one
is a special case of the other.

| Moment | Kind | Where | How often it can fire |
| --- | --- | --- | --- |
| A quest consented | `seeds` | `client/src/components/QuestActions.tsx` | Once ever per claim |
| A stage advanced | `dawn` | `client/src/components/StageAdvanced.tsx` | Once ever per rung |
| Gratitude received | `blossom` | `client/src/components/ProfileJourney.tsx` | Once ever per acknowledgment, at most one per visit |
| A cycle settled | `fireflies` | `client/src/pages/Admin.tsx` (Cycle Close) | Once per settlement that released something |
| A pledge landed | `ripples` | `client/src/components/crowdpool/PoolPieces.tsx` | Once per arrival seen while watching |
| A power crossed to the village | `dawn` | `client/src/components/governance/TransferCeremony.tsx` | Once ever per crossing, in the session that closed the vote |

### What was deliberately NOT wired, to keep celebration rare

Restraint is the deliverable here as much as the wiring is. Each of these was
reachable and was left alone on purpose.

- **A heart received.** Hearts and written acknowledgments both arrive as
  `kind` on the same gratitude row, and only one of them is rare. An
  acknowledgment is capped at one per sender per recipient per lunar cycle and
  must carry a message. A heart is a tap on a forum post, five per sender per
  cycle, and `feed.hearts_on_wall` already defaults false on the reasoning
  that a tap is a gesture. Celebrating the tap would spend the bloom on the
  cheaper thing inside a week, so the heart gets nothing.
- **Gratitude SENT.** The sender chose it; a confirmation is not a
  celebration, and the budget readout already answers "did that work".
- **Claiming or submitting a quest.** Both are frequent and both are the start
  of something. The consent is the end of it, and that is where the moment
  goes.
- **Every row of the pool ledger.** Arrivals already flash the one line that
  changed. A celebration per row is the wallpaper case, stated exactly.
- **The twenty-one interior admin tab loaders.** They are text, they are one
  screen deep inside an operator surface, and replacing all of them is churn
  with no member on the other end. The admin GATE, which is a real full-screen
  spinner, and the settlement desk, which is one of the wired moments, are the
  two that changed.
- **The dead `client/src/components/ui/spinner.tsx` primitive.** It has no
  call sites at all. Deleting it belongs to whoever prunes unused shadcn
  primitives, not to this lane.

## This is a unification, not an invention

The platform already ran a real lunar clock before this kit existed and it
stays the only one. `shared/lunar.ts` is the single source of lunar
arithmetic: cycle boundaries, `moonPhase`, `moonPhaseName`, `moonPhaseGlyph`.
`client/src/components/CycleClock.tsx` and
`client/src/components/calendar/YearWheel.tsx` already draw from it.

`moonGeometry.ts` adds exactly one thing shared/lunar has no opinion about:
the outline of the lit region at an arbitrary fraction. Phase NAMING is not
reimplemented, it is delegated, and
`client/src/components/natural/moonGeometry.test.ts` asserts that delegation
holds rather than asserting a copied table, so a change to shared/lunar's
thresholds moves this kit with it.

The craft bar is `client/src/components/crowdpool/PoolPieces.tsx`, which
carried the living map artifact's vocabulary into React: a gold ring that
fills, a lantern that brightens toward build day, sprites growing blueprint to
wip to painted, and a reduced-motion guard on every one of them.

## What each piece is for

| Piece | File | Use it for |
| --- | --- | --- |
| `MoonProgress` | `client/src/components/natural/MoonProgress.tsx` | Any completion display: a quest, a stage, a pool, a checklist |
| `Celebration` | `client/src/components/natural/Celebration.tsx` | Marking that something landed |
| `BreathingLoader` | `client/src/components/natural/BreathingLoader.tsx` | Waiting. It replaces a spinner |
| Tokens | `client/src/index.css` | Recolouring the whole vocabulary at once |
| `haptic()` | `client/src/lib/haptics.ts` | The one call into `navigator.vibrate` |
| `playSound()` / `useSound()` | `client/src/lib/sound.ts` | The audio layer |
| `useReducedMotion()` | `client/src/components/natural/useReducedMotion.ts` | Branching a composition, not just cancelling one |

Import from the barrel, `@/components/natural`, unless you want one component
and nothing else.

## The moon's design rules

**Progress waxes only.** `mode="progress"` (the default) maps 0 to 1 onto new
through full, lit on the right limb, and never goes past full. A waning moon
reads as progress being lost, which is a lie about a quest at 80%. Use
`mode="lunation"` only where the thing being drawn really is cyclical, the
gratitude cycle among them; that mode takes the phase `shared/lunar.ts`'s
`moonPhase()` returns and is the only mode that lights the left limb.

**A reading always travels with it.** The accessible name is always
`"<percent> percent, <phase name>"`, optionally prefixed with a `label`, so a
screen reader hears "Path of Growth: 62 percent, waxing gibbous". `showNumber`
prints the same percent beside the disc and defaults on. Turn it off only
where the surrounding copy already states the same progress in words or in a
number. A shape is not a readout, and the ruling that nothing conveys meaning
by colour alone applies to shape too.

**Nine states, and they are tested.** The lit outline is one SVG path built
from two arcs: the limb, and a terminator half-ellipse whose horizontal radius
is `r * |1 - 2f|`, subtracted below `f = 0.5` and added above it, with the arc
sweep flag flipping at the half. The derivation is in the file header. The
area identity falls out exactly: the drawn region is lit in the proportion the
number claims, at every value. The nine 12.5% steps are asserted pairwise
distinct, the terminator radii are pinned to
`[34, 25.5, 17, 8.5, 0, 8.5, 17, 25.5, 34]` at r=34, and the lit width across
the equator is asserted to rise monotonically as `2 * r * f`. String
inequality alone would pass on a rounding wobble; the three checks together do
not.

Cross-checked against `shared/lunar.ts`, the nine steps name themselves: new
moon, waxing crescent, waxing crescent, waxing crescent, first quarter, waxing
gibbous, waxing gibbous, waxing gibbous, full moon. Three crescents and three
gibbouses share a name and none of them share a shape, which is the point of
the ruling.

**A moon can carry the line it has to reach.** Some values are measured
against a bar, and a vote's agreement is the first of them. The founder's
ruling on that surface:

> for quorum a small icon with many silhouettes of people that fill up as we
> get more of the quorum (what % of all voice tokens/voters) met and unity
> (what % for or against) is a moon so a 80% threshold would show a red line
> needing the moon to get to that 80% illumination

Pass `threshold` (0 to 1) and the disc carries the terminator it WOULD have at
that fraction, dashed, drawn by `terminatorPath` in `moonGeometry.ts`. The line
and the lit edge are the same curve at two values, so the moon crossing it is
exactly the number crossing the threshold, and the area identity above makes
that true rather than approximately true. `thresholdTone` (`met`, `short`,
`none`) colours it and `thresholdLabel` says it in words. The label is not
optional: colour is never the only signal, and `none` is its own state, so a
moon nobody has voted on yet never reads as a failure. The one consumer today
is the agreement half of `client/src/components/governance/VoteResult.tsx`; the
participation half is a field of silhouettes and never a second moon, because
one vocabulary per measurement is the whole point.

**Sizes.** One 100-unit viewBox, so everything scales with `size`. Below 24px
the horizon ring, the printed number and the threshold line are dropped
automatically, because at that size they are noise; the accessible name still
carries all three.

**Motion.** The terminator and the ring ease between values. Under
`prefers-reduced-motion` the transition classes are not applied and the value
still lands.

## Celebration intensity: what earns a moment

Two intensities, and the split is a budget rather than a volume knob.

`moment` is RARE. Reserve it for events a village would talk about:

- a stage advance on the Path of Growth
- a quest consented
- a ballot carrying
- a need delivered on a crowdpool
- a power crossing over to the village

Everything else gets a `whisper`: a gratitude sent, a claim made, a form
accepted, a row saved.

**The fifth one is an addition, and here is the argument for it.** This list
was four items long and the case for keeping it there is the strongest
argument in this document: a celebration on every action becomes wallpaper
within a session. So an addition has to clear a high bar, and the bar is the
sentence above the list, which is events a village would talk about.

A power crossing over clears it on every reading. It happens at most once per
power in a village's whole life, and there are a couple of dozen powers, so
the ceiling on this moment across a decade is smaller than the number of
quests a single member consents to in a season. It is the act this platform
exists for: the admin panel is scaffolding to be dismantled, and this is a
piece of it coming down by a vote the whole electorate held. And it is
irreversible in the way that matters to a person, which is what separates a
landmark from a step: after it, somebody in this village looks after something
that used to belong to whoever had the administrator password, and the record
of the day has a date on it, an author, a sentence and a row.

Two things it is NOT, because both were available and both would have been
cheaper. It is not a moment for OPENING the ask, which is frequent, reversible
and the beginning of something; the ration's own rule is that the end of a
thing carries the celebration and the start of it carries nothing. And it is
not a moment attached to how many powers a village holds. A village holding
two of twelve is young and not behind, so nothing here counts, compares or
totals: one power crossing is one daybreak, and the village with one and the
village with ten see the same drawing when their next one lands.

The reason is not taste. A celebration on every action becomes wallpaper
within a session, and once it is wallpaper the rare event has nothing left to
say with. A whisper stays under 1.5 seconds and a moment stays under 3.5, both
asserted in `celebrationPlan.test.ts`, so nothing ever holds up a page.

Five kinds, none of them confetti: `seeds`, `blossom`, `fireflies`, `dawn`,
`ripples`.

**Every kind has a still form.** The global `prefers-reduced-motion` block in
`index.css` sets `animation-duration: 1ms !important` across the whole
product. For a loader that is exactly right. For a celebration made of "rise
and fade" it means an empty box, so each kind reads the preference in
JavaScript and renders a settled composition instead: seeds resting where the
wind set them down, the blossom already open, fireflies holding their light,
full daylight, still rings on the water. The CSS rule stays as the floor under
everything else.

**It is never the only signal.** The drawing is `aria-hidden`. Pass `message`
and the same news goes out through a live region.

## Design tokens

In `client/src/index.css`, beside the platform's other custom properties, as
`:root` plus a `.dark` block. Every component reads them as
`var(--nat-x, #fallback)` so a stylesheet that never loaded still draws.

They are deliberately NOT in `@theme`: nothing here needs a Tailwind utility,
these are fill and stroke values inside SVG, and a generated `.bg-nat-leaf`
would be dead bytes in every build.

`--nat-moon-edge` carries the accessibility. A moon's lit limb touches the
page directly, so that stroke is the boundary WCAG 1.4.11 measures, and it
inverts between themes: `#2f4f52` on light, `rgba(206, 228, 228, .6)` on dark,
because a dark outline on a dark page is no outline.

Motion tokens: `--nat-breath-dur` (4s, near a calm human breath),
`--nat-ease-organic`, `--nat-settle`.

`nat-breathe` is a SECOND breath keyframe, not a replacement for the existing
`breathe`. That one is the character-select idle, scale 1 to 1.015 with a 4px
lift, tuned to read as a still portrait that happens to be alive. A loader has
to read as motion from across a room. Both stay; they are one gesture at two
amplitudes, and collapsing them would spoil whichever lost.

## Haptics

`client/src/lib/haptics.ts` is the one place the product calls
`navigator.vibrate`. The pattern came from `MobileFab`, which was the only
caller, and its behaviour is carried over unchanged: `press` is the 10ms it
used for the trigger and `tick` is the 6ms it used for a row, so the FAB feels
exactly as it did.

Five intensities: `tick` 6ms, `tap` 8ms, `press` 10ms, `confirm` 18ms,
`arrive` `[12, 40, 12]`. Nothing above 30ms per pulse, because on Android that
reads as an error buzz whatever it was meant to mean.

Muting sound mutes haptics. A member asking for quiet means the device, and a
phone buzzing at every tap is not quiet. iOS Safari has no `navigator.vibrate`
at all, which is fine: nothing here is ever the only feedback, so a device
without a motor loses a flourish and no information.

## The audio layer

`client/src/lib/sound.ts`. **Mechanism only. No audio file is committed.**

### Why no files

A licence is a human check and a fabricated one is worse than silence: every
fork inherits the obligation and violates it without ever being told. This is
the same reasoning the brand ratchet runs on.

- **CC0 ONLY.** A CC-BY sample creates an attribution obligation that every
  fork inherits and silently breaks.
- **The BBC sound effects library is NOT usable here.** Its terms are
  personal, educational and research use. This is a commercial product.
- Suggested CC0 sources, each to be verified per asset because a library's
  overall licence is not a given file's licence: Freesound (filter to CC0 and
  check the individual page), OpenGameArt, 99Sounds.

### The manifest

The brief handed to whoever sources the audio, and the budget the result has
to fit. It lives as `SOUND_MANIFEST` in `client/src/lib/sound.ts`, so the
budget is a value tests read rather than a paragraph someone remembers.

Format for all five: OGG Vorbis primary with an MP3 fallback for Safari, mono,
44.1kHz, normalised to about -16 LUFS so one moment is not twice the loudness
of another.

| Moment | When it fires | The sound wanted | Seconds | Max KB (OGG) |
| --- | --- | --- | --- | --- |
| `quest_complete` | A quest was consented and the work is done | A short wooden wind chime settling, three or four notes falling | 0.8 to 1.6 | 120 |
| `gratitude` | Gratitude was sent, and the same sound when it arrives | One soft water drop into a still pool, with a little room tail | 0.4 to 0.9 | 80 |
| `stage_advance` | A member moved a stage along the Path of Growth | Dawn birdsong opening, two or three birds, no traffic underneath | 1.2 to 2.5 | 150 |
| `notification` | Something arrived that was not asked for | A single low bamboo knock, dry and close | 0.2 to 0.5 | 60 |
| `ui_tick` | A control took an input | A leaf brushing a leaf, almost under hearing | 0.05 to 0.15 | 50 |

The MP3 fallback may run to about twice the OGG budget.

### Where the bytes live

**The uploads volume, served by `GET /api/uploads/:filename`. Never
`client/public`.**

That directory is cached one-year-immutable and Vite does not content-hash
passthrough files, so a sound placed there is both unreplaceable for a year
and charged against the `MAX_TOTAL_DIST_KB` budget in every fork. The uploads
volume is hashed, swappable and per-deployment, which is what a village asset
is. This is the same rule the image budget enforces on art.

`server/index.ts` now serves `.ogg` as `audio/ogg` and `.mp3` as `audio/mpeg`
from that route, with the same one-year immutable cache images and fonts get.
Without those two lines an uploaded one-shot came back as
`application/octet-stream` with an attachment disposition, which no `Audio`
element will play, so the layer would have shipped unable to make a sound.

### The admin path a village follows

1. Source five CC0 one-shots against the manifest above and keep the licence
   evidence with the deployment's records.
2. Encode to OGG Vorbis plus MP3, inside the size budgets.
3. Put them in the uploads volume with a stamped filename, the way every other
   writer into that directory does: `${Date.now()}-${random}-quest.ogg`. The
   stamp is what makes the immutable cache correct.
4. Call `configureSounds({ files: { quest_complete: { ogg: "...", mp3: "..." }, ... } })`
   once at boot with those filenames.

**Open, and named rather than hidden:** there is no admin upload endpoint for
audio yet. `POST /api/admin/brand/font` is the shape it should copy, magic-byte
check included, and the manifest belongs beside the theme fields in the brand
document so step 4 reads it instead of being hand-called. Until that lands, a
village supplies files by writing to the volume directly. Nothing breaks
meanwhile: an unconfigured moment is silent, which is the shipped default.

There is also no mute control in the UI yet. `useSound().toggleMute()` is the
API for one, and it belongs on whichever settings surface a later lane owns.

### The five rules the mechanism keeps

1. **Nothing autoplays.** No element is constructed until a moment is actually
   played, asserted in `sound.test.ts`.
2. **Mute is per member and honoured everywhere**, haptics included. It is
   stored in `localStorage` under `village.sound.muted:<memberId>`, the way
   the first walk's progress and the landing preference already are: per
   browser and per person, no server state, nothing to migrate. Call
   `setSoundMember(id)` at sign-in, and again with `""` at sign-out, so two
   people sharing a laptop do not share a mute.
3. **Silence under `prefers-reduced-motion`.** Someone managing sensory load
   is not asking for a soundtrack. This is checked separately from mute and
   does not overwrite the member's own preference.
4. **Nothing blocks.** Every call returns a promise that resolves and never
   rejects. `useSound().play()` swallows it, so a click handler is one line.
5. **A missing file fails silently and is remembered.** A blocked autoplay and
   a 404 look identical from here, and both mean the moment stays quiet. A
   village with three of the five files gets three sounds and a quiet console.
   `resetSounds()` clears that memory once the file is uploaded.

## The asset budget rule

CI enforces `MAX_MAIN_JS_KB` 700 and `MAX_TOTAL_DIST_KB` 6600 after
`pnpm build`, and recent builds sit near the total ceiling. This kit is
therefore all SVG drawn from arithmetic: no image, no font, no audio, no
animation library. Nothing it adds is a file.

The rule for anything later built on it: **large or swappable assets belong in
the uploads volume.** `client/public` is cached one-year-immutable, is not
content-hashed by Vite, counts against the dist budget in every fork, and
cannot be replaced without a redeploy. `scripts/check-image-budget.mjs` holds
that line for images. Sound follows the same line by policy, stated here,
because there is no gate that can see a file nobody committed.

## Where it is wired today

The dashboard's Path of Growth rail
(`client/src/components/GameDashboard.tsx`) shows the member's position as a
40px moon beside the heading. The stage chips underneath carry the same
reading in words, so the moon adds a shape to something already stated.
`showNumber` is off there for that reason.

The five celebrations are in the table above. Beyond them:

- **Waiting.** `BreathingLoader` replaces the admin gate's spinner
  (`client/src/pages/Admin.tsx`), the settlement desk's text loader, both
  crowdpool boards (`client/src/pages/Crowdpool.tsx`,
  `client/src/pages/CrowdpoolCampaign.tsx`) and the profile journey
  (`client/src/components/ProfileJourney.tsx`). `PageLoading` in
  `client/src/App.tsx` is deliberately untouched: the shell-hoist work
  rewrites that file.
- **Sound and haptics.** `playMoment` in `client/src/lib/sound.ts` is the one
  call, and every wired moment makes it. It pairs the two channels so a
  surface cannot remember one and forget the other, and it honours the
  existing mute and reduce-motion refusals for both. No audio file is
  committed and every moment is silent until a village supplies one, which is
  unchanged.

### Two things the wiring had to fix first

**A badge holder was told the wrong number.** The claim row stores `amount` as
the grant, and the badge reward multiplier is applied AFTER that row is
written, so the quest card printed the pre-multiplier figure while the ledger
credited more. `questCreditsFor` in `server/lib/ledger.ts` reads what actually
moved and `/api/game/me` serves it as `credited`, so the number that counts up
is the number that landed and the bonus is named beside it.

**"You can now" had no words to say it with.** `recordStageEvent` has computed
the exact capability diff since item 8, and every surface that showed it
rendered raw keys: `forum.post,message.send`. `CAPABILITY_LABELS` in
`shared/capabilities.ts` is the missing table, kept in lockstep with
`ALL_CAPABILITIES` by `shared/capabilities.test.ts`, and it is also what fixed
the same raw-key line on the profile's stage history.
