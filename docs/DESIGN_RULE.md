# The design rule

A member-facing page draws in the profile's look. The profile (`client/src/pages/Profile.tsx`,
`client/src/components/profile/*`, `ProfileHero`) is the reference: when a page and the profile
disagree, the page moves.

The rule exists as three things that agree with each other:

- this document, which says what the look is and why;
- `client/src/components/journey/look.ts`, the look as class strings a page imports;
- `scripts/check-design-rule.mjs`, which fails CI when a file on its list draws outside it.

The joining journey is on the list today: `/steward`, `/roles`, `/roles/select`, `/propose-a-role`,
the member door of `/propose`, `/love-letter`, `/application-status` and `/role-applications/:id`, and the onboarding pages: `/aligned` (and the
confidentiality and membership align cards), `/register`, `/set-password`, `/verify-email`, the onboarding path on the
profile, `/approvals`, `/role-measures` and `/quests`, the membership align step inside the proposal form
(`MembershipAtApplication`), `RoleCardBridge`, the signed-out card (`SignInDoors` in `ModuleGate`, whose two doors now
take `BTN_PRIMARY` and `BTN_SECONDARY` on every page that shows them), Admin's onboarding path editor and
`/request-membership`, and the pages where people decide (`/review`, `/decisions`, `/decisions/:id`,
with what they render: the vote, the roll, the round, the outcome and the review queue's cards). A page joins by being
added to `JOURNEY` (and `PAGES`, for a page) in the script, once it passes.
`node scripts/check-design-rule.mjs --report` lists what the rule would flag everywhere else.

## The rule in ten lines

1. Stand in the world: the page's outer element carries `WORLD` (`sheet-night`, the night ground).
2. Colour comes from the semantic tokens only: `foreground`, `muted-foreground`, `card`, `muted`,
   `border`, `notice` (gold), `open` (living green), `destructive`, `ring`.
3. A section is a panel: `CARD` (`rounded-2xl border bg-card p-6 shadow-sm sm:p-8`).
4. One panel per page may say "start here": `CARD_FEATURED`, the gold edge.
5. A heading is an eyebrow over the display face: `EYEBROW` then `H1` or `H2`.
6. Inside a panel, things sit on tiles: `TILE` (`rounded-xl border bg-muted p-4`).
7. The one main act is gold (`BTN_PRIMARY`); a second act is edged (`BTN_SECONDARY`).
8. Every target is at least 44px; every button shows hover, press, focus and disabled.
9. Corners: `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`. Shadow: `shadow-sm`.
10. Motion moves transform and opacity, settles inside 600ms, never loops beside text, and sits
    inside `prefers-reduced-motion: no-preference`. Nothing scores or ranks a person.

## Why the profile

The profile was rebuilt as a place: a night ground (`.sheet-night` in `client/src/index.css`), a
carved display face, gold for what is held and green for what is living. It was migrated to the
semantic tokens first, so the whole look is a set of custom properties redeclared on one element.
That is what makes it portable: a page that names `bg-card` and `text-muted-foreground` and puts
`sheet-night` on its root is in the same world with no other change, and a village that re-tints
its sheet (`--sheet-*`) re-tints every page in the rule with it.

## Use X, not Y

Examples taken from the code. Left is the profile's way, right is what the journey had before.

| Use | Not | Why |
|---|---|---|
| `className={WORLD}` on the page root | `min-h-screen bg-background` | the second is the app's light ground, a different world from the profile |
| `text-muted-foreground` | `text-stone-600` | a Tailwind palette colour never re-themes |
| `text-notice` (eyebrows, links, rings) | `text-teal-deep`, `text-sage` | the brand inks are dark; on the night ground they disappear |
| `text-open` (held, done) | `text-sage`, `bg-sage-light` | the sheet's living green |
| `bg-card` / `bg-muted` | `bg-white`, `bg-cream`, `bg-stone-50` | panels and tiles take the sheet's two surfaces |
| `bg-destructive/10 border-destructive text-destructive` | `bg-red-50 border-coral text-coral` | an error reads on both grounds |
| `EYEBROW` (`text-xs font-semibold uppercase tracking-widest text-notice`) | `text-xs font-bold uppercase tracking-[0.14em]` | one eyebrow, the one StartHereCard uses |
| `BTN_PRIMARY` (gold, `rounded-xl`) | `rounded-full bg-primary text-primary-foreground` | the profile's main act is gold; the brand fill is dark on the night ground |
| `BTN_SECONDARY` (`rounded-lg border border-border`) | `rounded-full border-2 border-primary` | the profile's second act |
| `bg-teal-deep text-white` with `border border-border` | the same without the edge | the bio Save: the village's colour, edged so it clears 3:1 on the night panel |
| `RING` (a number or icon in a gold ring) | `bg-teal-deep/10 text-teal-deep` circles | the sheet's stat tiles carry theirs this way |
| `CHIP_SOFT` | `text-[11px] font-bold uppercase` pills | no arbitrary sizes |
| `rounded-xl` / `rounded-2xl` | `rounded-3xl`, `rounded-t-[14px]` | three corner sizes and the full round |
| `shadow-sm` | `shadow-lg`, `shadow-xl` | the sheet deepens `shadow-sm` itself on the night ground |
| `font-display` | `font-serif`, `font-[...]` | the sheet sets its display face; `font-accent` is for a signed letter |
| a `useReducedMotion` still form | `repeat: Infinity` beside text | delight that settles |

## Fields, empty and loading states

- A field is `FIELD` (`rounded-lg border border-border bg-background`, gold focus ring), its label
  `LABEL`, its help `HINT`. Checkboxes and radios take `accent-notice`.
- Empty: a sentence in `HINT`, inside the panel it would fill, and the door still offered (the season
  goals card with no goals keeps "Explore the goals").
- Loading: the breathing leaf (`BreathingLoader`, `components/natural`), never a spinning ring.

## Motion and the game feel

The journey kit (`client/src/components/journey`, the `jw-` block in `client/src/index.css`) is
the motion half of the rule: `.jw-btn` (lift, press, focus), `.jw-pick` (a ring on the water when
something is chosen), `.jw-unfurl` / `.jw-seal` (growth), and the trail of stepping stones
(`Trail`, `.jw-trail-v`). A passed stone is a gold ring, the stone you stand on is filled gold.
Applicants are never shown points, ranks or scores; a count shown on a journey page is the
village's (goals reached this season), never a person's.

## The organic art direction (11 Nov 2026)

The lead's direction for anything that moves or celebrates: organic, growing, mycelial, lit like
fireflies, with sacred geometry and fractals as the structure underneath. It binds every page,
inside the journey list or not.

- **Banned:** confetti, streamers, fireworks, sparks and sparkle bursts, trophies, badges popping,
  coins raining, level-up flashes, neon, scan lines, HUD chrome, holograms, "XP" progress fills,
  and anything that reads as technical or arcade.
- **Glow is firefly light:** a few soft, warm points that drift and pulse slowly and lead the way.
  Fireflies appear only around the one next act on a screen and inside illustrations, never as a
  field of lights behind text.
- **Ceremony is a bloom, never a burst:** a flower opening, a fern unfurling, a root joining the
  network, a circle of light gathering.
- **Sacred geometry is structure, not ornament:** the Seed of Life grows one circle per step walked
  and continues into the Flower of Life; fireflies sit on Vogel's golden-angle spiral (the
  sunflower's packing); a fern is an L-system, the same rule at every scale; a threshold is a
  vesica, two circles meeting; the moon is the real moon for the date. Night palette only: no
  rainbow gradients, no new-age kitsch.

The motion rule that goes with it:

1. Ambient fireflies only around the one next act and in illustrations, and they rest after about
   20 seconds without input (`useRest`, `REST_AFTER_MS`).
2. A one-time bloom or unfurl may take up to 1.6s. It plays once per moment, claimed the way
   `LevelUpMoment` claims its crossing.
3. Everything else follows rule 10 above: transform and opacity, settled inside 600ms.
4. `prefers-reduced-motion` shows a still drawing of the same thing, complete: the seed with its
   petals open, the fern unfurled, the lights in their places. Never an empty box.

**The firefly exception to rule 10.** Fireflies are the one thing allowed to loop, because they
rest after 20 seconds and never sit on words. Their glow lives in the kit's stylesheet
(`client/src/components/journey/nature/nature.css`, from the sheet's `--sheet-*` knobs), so a page's classes
never carry a literal glow. `scripts/check-design-rule.mjs` holds the kit's files (`NATURE_KIT`) to
the same class rules as the journey.

**The nature kit** (`client/src/components/journey/nature`) is where these shapes live, each
tested as maths and as a still drawing: `Fireflies`, `SeedOfLife`, `FernUnfurl`, `Vesica`,
`MoonPhase` and the `RootStrip` shell. Import a piece where it is used, inside a lazy route or
through `React.lazy`, and never from the app shell, so none of it reaches the first page.

| Use | Not | Why |
|---|---|---|
| `<SeedOfLife bloom>` opening once when a path is whole | 46 sparks and a "Stage reached" flash | a bloom, never a burst |
| `<Fireflies>` around the one next act | a glowing ring or pulse on every button | one light leads the way; it rests after 20s |
| firefly glow from `nature.css` | `shadow-[0_0_40px_...]` on a page's classes | the glow re-tints with the sheet and stays out of class strings |
| `<SeedOfLife total walked>` | a filling bar, a percentage ring, an "XP" fill | progress grows; it is never a meter |
| `<FernUnfurl>` at adoption | a trophy, a badge popping in | something living, once |
| `<Vesica met>` for a threshold crossed | a lock icon flipping open | two circles meeting, each still whole |
| `<MoonPhase date>` | a decorative moon in a fixed phase | the real sky, computed, no network |
| `useReducedMotion` rendering the still drawing | `animation-duration: 1ms` on a bloom | the member still sees what was celebrated |

## Decider calm (12 Nov 2026)

The pages where people decide (`/review`, `/approvals`, `/role-applications/:id`, `/decisions`,
`/decisions/:id`, `/open-proposals/:id`) are kept calm on purpose, in the founding register. They
change what a decider sees and never what a decision does: votes, consent rules, approvals, money
and pay are exactly as they were.

- **The night world and almost nothing else.** No growth, moss, meadow or bloom beside an applicant
  or a vote, nothing that could read as a grade.
- **One light: your turn.** `YourTurn` (`components/governance/YourTurn.tsx`) draws the fireflies on
  a door that leads to the vote or the round, shown only when the server says the reader is asked
  and has not answered. **Never on an answer:** a light on Yes, Consent or Accept leans the reader
  toward it. On a phone the door is a bar under the thumb; from `lg` up it sits beside the words.
- **Two circles meet once, for a consent reached.** A `Vesica` on a decision the village made by
  consent and on a circle that consented, never on a vote still open or a majority count.
- **Arrival order only.** What waits on a decider reads oldest first (`byArrival`,
  `components/governance/deciderOrder.ts`), never by a count, a score or a guess at importance.
- **Phone and desktop.** A desktop shows the person's words at reading width beside the round, so
  nobody decides without the words in view; a phone reads them one after the other.

## Phone and desktop, each at its best (11 Nov 2026)

The lead: every surface is great on a phone AND on a desktop, and each leans on what its device
does best. Design each surface twice, on purpose. A desktop layout is never a stretched phone, and
a phone layout is never a squeezed desktop. Shoot both, at 390px and 1280px at least, and say what
is unique to each.

- **A phone leans on:** one thumb, the bottom of the screen, one thing at a time, full-bleed
  illustration, swiping between steps, a sticky next act within thumb reach, calm motion with no
  haptic fuss, short copy, and the native share sheet and camera where the platform has them.
- **A desktop leans on:** width for side by side (the path beside the step, the role card beside
  the form, the whole moon beside today), hover to reveal, the keyboard (Enter for next, arrows
  between stones, visible focus), larger fields for the geometry, and context panels that stay.

How the nature kit does it:

- `Fireflies`: with a fine pointer, hovering or focusing the act draws the lights in toward it; on
  a touch screen at most five stay, and a press gathers them.
- `SeedOfLife`, `FernUnfurl`, `Vesica`, `MoonPhase`: the drawing grows with the field (`size="lg"`
  widens at `sm` and `lg`). `FernUnfurl detail="auto"` grows one more generation of leaflets at
  1024px and up. Hovering a seed circle names its step; hovering the moon names its phase, and
  `showName` prints it for a phone, which has no hover.
- `RootStrip`: one slim line on a phone, with the whole strip as the target; on a desktop the root
  reaches further with more hyphae and the `detail` line shows beside the sentence.

| Use | Not | Why |
|---|---|---|
| a sticky next act at the bottom on a phone | the same button at the top of a long form | the thumb lives at the bottom |
| the path beside the step from `lg` up (`lg:grid-cols-[...]`) | one centred column stretched to 1280px | a desktop has the width for both at once |
| hover to reveal a name or draw fireflies in (`@media (hover: hover)`) | hover as the only way to reach something | a phone has no hover; reveal, never hide |
| Enter for next and arrows between stones | mouse only | a desktop has a keyboard |
| `navigator.share` on a phone, copy to clipboard on a desktop | one "copy link" for both | each device's own way to pass something on |
| a full-bleed illustration on a phone, a larger geometry field on a desktop | one fixed-size picture for both | each screen at its best |
| short copy on a phone, a `detail` line a desktop shows | the desktop's paragraph squeezed onto a phone | one thing at a time |

## What the gate does not check

It reads class strings, so it cannot see a colour set in a `style` object through a variable, a
component outside its list that a journey page renders (`SeatTradingCard`, `VillageConflictSteps`),
or whether a layout matches. The rendered page is still the check that matters: look at it at
1280px and 390px beside the profile.

The profile itself is not on the list: its hero carries tuned type sizes and glows
(`text-[44px]`, `shadow-[0_0_40px_...]`) that the rule would flag. Those are the reference's own
flourishes; a journey page does not copy them.
