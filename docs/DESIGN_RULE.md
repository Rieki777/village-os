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
`/request-membership`. A page joins by being
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

## What the gate does not check

It reads class strings, so it cannot see a colour set in a `style` object through a variable, a
component outside its list that a journey page renders (`SeatTradingCard`, `VillageConflictSteps`),
or whether a layout matches. The rendered page is still the check that matters: look at it at
1280px and 390px beside the profile.

The profile itself is not on the list: its hero carries tuned type sizes and glows
(`text-[44px]`, `shadow-[0_0_40px_...]`) that the rule would flag. Those are the reference's own
flourishes; a journey page does not copy them.
