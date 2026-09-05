/**
 * The crowdpool page's craft pieces (lane CP), drawn in the living map's own
 * vocabulary: wood, parchment, gold, small-caps plaques. The colour tokens
 * are the artifact's (`docs/prototypes/grounds-v0.html`, read-only): wood
 * #241a10, gold #c9a25e, bright gold #ecd08a, parchment #f3e6c8, ink #241a10.
 *
 * The metaphors are the map's, reused on purpose and never reinvented: the
 * funding structure "wears a gold ring showing the percent", reads
 * "Gathering the pool" under half and "Under construction" above, the
 * star-lantern burns brighter as the close comes near, sprites grow
 * blueprint to wip to painted, and arrivals land as ripples.
 *
 * The capitals framework stays off this page by ruling: the nine capital
 * types appear only as TINTS on needs tiles, never as the hub's segmented
 * capital-stack widget.
 */
import type { CSSProperties } from "react";
import { BookOpen, Coins, Hammer, Mountain, Package, Repeat, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import Celebration from "@/components/natural/Celebration";
import { useArrival, useMomentWindow } from "@/components/natural/moments";

/**
 * The kit's water tokens, repainted in the board's gold. Recolouring through
 * the custom properties is the documented way to move the whole vocabulary at
 * once; the alternative is a forked copy of the drawing, which is how two
 * ripples drift apart.
 */
const GOLD_WATER = {
  "--nat-water": "#ecd08a",
  "--nat-water-deep": "transparent",
} as CSSProperties;

// ── The nine capital tints ───────────────────────────────────────────────────
// Hues chosen to sit on parchment; the hub's own hex accents belong to the
// hub's design system, so these are the map's warm-palette cousins.
export const CAPITAL_TINTS: Record<string, string> = {
  material: "#8a6a33",
  living: "#5c7a3a",
  financial: "#a8862c",
  social: "#a05c74",
  cultural: "#7a5ca0",
  spiritual: "#5f6fa8",
  intellectual: "#3f7a8a",
  experiential: "#b06f3a",
  health: "#3f8a5f",
};

export const capitalTint = (capital: string): string => CAPITAL_TINTS[capital] ?? "#8a6a33";

export const KIND_GLYPHS: Record<string, LucideIcon> = {
  loan: Repeat,
  role: UserRound,
  shift: Hammer,
  knowledge: BookOpen,
  item: Package,
  crypto: Coins,
  land: Mountain,
};

export const kindGlyph = (kind: string): LucideIcon => KIND_GLYPHS[kind] ?? Sparkles;

/** What a kind's claim means, in one plain word for the card corner. */
export const KIND_LABELS: Record<string, string> = {
  loan: "a loan",
  role: "a role",
  shift: "a work day",
  knowledge: "know-how",
  item: "goods",
  crypto: "crypto",
  land: "land",
};

// ── What the hub's numbers can and cannot be asked to mean ───────────────────

/**
 * THE HUB'S PLEDGED TOTAL IS A FLOOR AND NOT A TOTAL, SO THIS PAGE SAYS SO.
 *
 * Measured by the Crowdpooling session on 2026-09-04 against a scratch
 * database of their own, and relayed to this lane: the hub sums a campaign's
 * pledged value filtering on the ACCEPTED status alone, and delivered and
 * thanked are LATER states of the same lifecycle. So the moment a steward
 * confirms a delivery, that value leaves the number this ring divides. Their
 * trial: accept ten thousand, deliver it, accept five thousand more, and the
 * campaign reports five thousand where the honest figure is fifteen. They
 * recompute in one branch only, so the drop is DEFERRED and lands later, on an
 * unrelated acceptance. A member watching a village do well sees the ring go
 * backwards at a moment that looks like it has nothing to do with the delivery
 * that caused it.
 *
 * IT IS THEIRS TO FIX AND THEY ARE FIXING IT. Ours is to stop presenting it as
 * our own truth in the meantime. No correction is computed anywhere on this
 * page: a figure that guessed at the delivered value would be worse than an
 * honest gap, because it would be wrong in a way nobody could see. What
 * happens instead is that every place a reader meets the number names it as a
 * floor, and the growth strip refuses to describe the impossible relation
 * (delivered running ahead of pooled) as a healthy one.
 *
 * THE HUB LANDED ITS FIX ON 2026-09-05, so this is false and the language is
 * gone with it. That was the whole undo, and it is why the language read off a
 * constant instead of being typed into six places.
 *
 * Their commit b835c28: the pledged total now counts accepted, fulfilled AND
 * thanked, so delivered value stays in the number this page divides, and it no
 * longer falls when a village succeeds. They fixed it on the CALLERS and not on
 * the columns, deliberately, so nothing about the wire changed for us and this
 * file's reader needed no edit. They also found a second stale-number path
 * while chasing the deferral: their expiry sweep marked a claim expired and let
 * its value go on counting as pledged indefinitely.
 *
 * WHAT WE ARE ASSERTING, precisely, because they were careful to hand us the
 * weaker true claim rather than the stronger convenient one. Their CI ran the
 * suite against real MySQL and their deploy succeeded. Neither of us has read
 * the rendered number off a live campaign since. The residual after that is
 * OURS and not theirs: this bridge caches for ninety seconds and a sync job
 * writes a snapshot every ten minutes, so a floored figure can survive here for
 * one sync window after their fix went live. It is self-healing and it only
 * ever reads LOW, which is why flipping now is safe and leaving the hedge up
 * would not have been: a qualifier that has stopped being true is the same
 * stale sentence this build kept finding, just one we wrote ourselves.
 */
export const HUB_PLEDGED_TOTAL_IS_A_FLOOR = false;

/** The plain mechanics behind the word "pooled", on any surface. */
export const PLEDGED_FLOOR_TIP = HUB_PLEDGED_TOTAL_IS_A_FLOOR
  ? "The hub counts a pledge in this total only while it waits to be delivered, so confirmed deliveries drop out of it. Read the figure as a floor: the real pool is this much or more. The hub is repairing that."
  : "This is everything pledged to the raising so far.";

/** The campaign page's plaque: what the two arcs mean, then the floor. */
export const RING_TIP = `The gold ring is everything pledged so far and the quieter green arc inside it is what has actually arrived. ${PLEDGED_FLOOR_TIP}`;

/**
 * The plain-language paragraph, for the "What this pool is" plaque. Null when
 * the hub has landed its fix, so the sentence leaves the page with the rest of
 * the floor language and nobody has to remember it is there.
 */
export const PLEDGED_FLOOR_PARAGRAPH: string | null = HUB_PLEDGED_TOTAL_IS_A_FLOOR
  ? "Every figure here is the hub's own, kept as it was given. The pooled total is one the hub is still repairing: it drops a pledge out of the count once a delivery is confirmed, so what this page shows is a floor and the true pool is that much or more."
  : null;

/**
 * One spelling of the pooled money line, so the list card and the campaign
 * page cannot drift apart on the qualifier.
 */
export function pooledLine(pledged: number, total: number, currency: string): string {
  const figures = `${money(pledged, currency)} of ${money(total, currency)}`;
  return HUB_PLEDGED_TOTAL_IS_A_FLOOR ? `at least ${figures}` : figures;
}

/**
 * MORE DELIVERED THAN WERE EVER WANTED, which is arriving.
 *
 * The hub's fulfil path is not idempotent despite a comment of theirs claiming
 * it is: two stewards confirming at once put delivered on two instead of one,
 * ten trials out of ten. It does not reach us as a payout, because this bridge
 * reads the meter and never the payoff. It reaches us as a need whose counts
 * cannot all be true at once, and the rule of this page is that impossible
 * data is handled and never assumed away. One predicate, used by the meter and
 * by the campaign page, so the two cannot disagree about what counts as
 * impossible.
 */
export function isOverDelivered(n: { quantityWanted: number; quantityDelivered: number }): boolean {
  return n.quantityWanted > 0 && n.quantityDelivered > n.quantityWanted;
}

// ── The phase label: the map's own words ─────────────────────────────────────

/**
 * The 50% cut here reads the hub's pledged share, which is the floor described
 * above, so a village genuinely past half can still be labelled "Gathering the
 * pool". That is the honest direction to be wrong in: it understates a village
 * doing well and never overstates one that is not.
 */
export function phaseLabel(status: string, percentPledged: number): string {
  if (status === "draft" || status === "pending_review") return "Waiting to open";
  if (status === "funded") return "The pool is full";
  if (status === "completed") return "Built into the village";
  if (status === "cancelled" || status === "rejected") return "Closed";
  return percentPledged < 50 ? "Gathering the pool" : "Under construction";
}

// ── Shared formatting ────────────────────────────────────────────────────────

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "some time ago";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "moments ago";
  if (min < 60) return `${min} minutes ago`;
  const hours = Math.floor(min / 60);
  if (hours < 2) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "yesterday";
  return `${days} days ago`;
}

// ── The gold ring ────────────────────────────────────────────────────────────

/**
 * The funding meter, exactly the ring a structure on the map wears: pledged
 * share as the outer gold arc, delivered share as a quieter inner arc so the
 * promise can be seen running ahead of the walls. `ripple` increments when a
 * new arrival lands and plays one expanding ring.
 *
 * THE ARRIVAL IS THE KIT'S RIPPLES NOW. It used to be one hand-rolled circle
 * with `@keyframes cp-ripple`, and under reduce-motion that rule set
 * `opacity: 0`: the arrival became invisible for exactly the members the
 * still states exist for, which is the difference between a dignified still
 * form and an absent one. `Celebration kind="ripples"` already carries rings
 * held at their full width as its still form, so the moment lands either way.
 *
 * It is recoloured through the kit's own tokens rather than forked: the board
 * is gold, so `--nat-water` is set to the ring's gold on the wrapper and
 * `--nat-water-deep` is cleared, because the centre of this ring is occupied
 * by the percentage and a water dot on top of it would be noise.
 */
export function GoldRing({
  percentPledged,
  percentDelivered,
  label,
  size = 220,
  ripple = 0,
}: {
  percentPledged: number;
  percentDelivered: number;
  label: string;
  size?: number;
  ripple?: number;
}) {
  const r = 84;
  const rIn = 70;
  const c = 2 * Math.PI * r;
  const cIn = 2 * Math.PI * rIn;
  const pledged = Math.min(100, Math.max(0, percentPledged));
  const delivered = Math.min(100, Math.max(0, percentDelivered));
  const landing = useMomentWindow(ripple, 3200);
  const floor = HUB_PLEDGED_TOTAL_IS_A_FLOOR;
  const spoken = floor
    ? `at least ${pledged} percent pledged, ${delivered} percent delivered`
    : `${pledged} percent pledged, ${delivered} percent delivered`;
  return (
    <div className="cp-ring-wrap" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={spoken}>
        <defs>
          <linearGradient id="cp-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ecd08a" />
            <stop offset="0.55" stopColor="#c9a25e" />
            <stop offset="1" stopColor="#a37f42" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(201,162,94,.22)" strokeWidth="9" />
        <circle
          className="cp-arc"
          cx="100" cy="100" r={r} fill="none"
          stroke="url(#cp-gold)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pledged / 100)}
          transform="rotate(-90 100 100)"
        />
        <circle cx="100" cy="100" r={rIn} fill="none" stroke="rgba(201,162,94,.14)" strokeWidth="5" />
        <circle
          className="cp-arc cp-arc-slow"
          cx="100" cy="100" r={rIn} fill="none"
          stroke="#8fd06a" strokeOpacity="0.75" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={cIn}
          strokeDashoffset={cIn * (1 - delivered / 100)}
          transform="rotate(-90 100 100)"
        />
        <text x="100" y="97" textAnchor="middle" className="cp-ring-pct">{pledged}%</text>
        {/* The sub-label is where the floor is said inside the ring itself, so
            the numeral is never read alone. See HUB_PLEDGED_TOTAL_IS_A_FLOOR. */}
        <text x="100" y="117" textAnchor="middle" className="cp-ring-sub">{floor ? "pooled or more" : "pooled"}</text>
      </svg>
      {landing && (
        <span className="cp-ring-land" style={GOLD_WATER}>
          <Celebration
            kind="ripples"
            intensity="moment"
            size={size}
            seed={ripple}
            message="A promise landed on the ring."
          />
        </span>
      )}
      <div className="cp-ring-label">{label}</div>
    </div>
  );
}

/**
 * The list page's small ring: one arc, the percent, nothing else. The card's
 * own money line carries the floor qualifier in words (`pooledLine`); here
 * only the spoken label has room for it.
 */
export function MiniRing({ percent, size = 64 }: { percent: number; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, percent));
  const spoken = HUB_PLEDGED_TOTAL_IS_A_FLOOR ? `at least ${p} percent pooled` : `${p} percent pooled`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={spoken}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(201,162,94,.25)" strokeWidth="5" />
      <circle
        cx="32" cy="32" r={r} fill="none" className="cp-arc"
        stroke="#c9a25e" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="cp-mini-pct">{p}%</text>
    </svg>
  );
}

// ── The star lantern ─────────────────────────────────────────────────────────

/**
 * The countdown, as the map draws it: a star-lantern that burns brighter as
 * build day comes near. Intensity eases from a quarter-glow sixty days out to
 * full at the close.
 */
export function StarLantern({ daysRemaining, endsAt }: { daysRemaining: number | null; endsAt: string | null }) {
  const closed = daysRemaining === 0 && endsAt !== null && new Date(endsAt).getTime() < Date.now();
  const glow = daysRemaining === null ? 0.35 : Math.max(0.25, Math.min(1, 1 - daysRemaining / 60));
  const line =
    daysRemaining === null
      ? "No close is set"
      : closed
        ? "The pool has closed"
        : daysRemaining === 0
          ? "Closes today"
          : daysRemaining === 1
            ? "One day until the pool closes"
            : `${daysRemaining} days until the pool closes`;
  return (
    <div className="cp-lantern" title={endsAt ? `Closes ${new Date(endsAt).toLocaleDateString()}` : undefined}>
      <svg viewBox="0 0 48 64" width="44" height="58" aria-hidden="true">
        <path d="M14 8 L34 8 L30 2 L18 2 Z" fill="#3a2b1a" stroke="#c9a25e" strokeWidth="1" />
        <path d="M12 10 L36 10 L32 46 L16 46 Z" fill="rgba(36,26,15,.9)" stroke="#c9a25e" strokeWidth="1.4" />
        <path
          className="cp-lantern-star"
          d="M24 16 L26.4 24.2 L34 24.2 L27.8 28.8 L30.2 36.4 L24 31.6 L17.8 36.4 L20.2 28.8 L14 24.2 L21.6 24.2 Z"
          fill="#ecd08a"
          style={{ opacity: 0.45 + glow * 0.55, filter: `drop-shadow(0 0 ${3 + glow * 9}px rgba(236,208,138,${0.35 + glow * 0.6}))` }}
        />
        <path d="M16 46 L32 46 L30 52 L18 52 Z" fill="#3a2b1a" stroke="#c9a25e" strokeWidth="1" />
      </svg>
      <div className="cp-lantern-line">{line}</div>
    </div>
  );
}

// ── The three-slot meter ─────────────────────────────────────────────────────

/**
 * wanted / claimed / delivered as one bar: delivered is solid (the walls),
 * claimed is the ghost (spoken for, still travelling), the rest is open air.
 *
 * THE TRACK IS WHAT WAS WANTED, and that is a change made on purpose.
 *
 * The denominator used to be `Math.max(wanted, claimed, delivered, 1)`, which
 * looks defensive and is not. Measured on 2026-09-04, a need arriving with one
 * wanted, one claimed and two delivered (the hub's non-idempotent fulfil, see
 * `isOverDelivered` above) drew BOTH fills at 100% and captioned itself
 * "2 arrived, 0 spoken for, 1 wanted": the bar was pixel-identical to a need
 * that finished perfectly, the impossible pair was printed flat with no
 * comment, and the real claimed count was erased, because `claimed - delivered`
 * had gone negative and floored to zero. Nothing overflowed, but only because
 * the denominator had quietly grown to match whatever the largest number was.
 * That is a clamp by accident, and a clamp by accident is the shape this
 * repository keeps finding underneath a confident comment.
 *
 * So: the track is `wanted`, both fills clamp at 100% by rule, and a need with
 * more arrived than wanted SAYS SO in the caption and in the spoken label. A
 * need the hub gives no wanted count for falls back to the largest count it
 * does give, which is the only case where the old denominator was right.
 */
export function SlotMeter({
  wanted, claimed, delivered, tint,
}: {
  wanted: number; claimed: number; delivered: number; tint: string;
}) {
  const track = wanted > 0 ? wanted : Math.max(claimed, delivered, 1);
  const dPct = Math.min(100, Math.max(0, (delivered / track) * 100));
  const cPct = Math.min(100, Math.max(0, (Math.max(claimed, delivered) / track) * 100));
  const over = isOverDelivered({ quantityWanted: wanted, quantityDelivered: delivered });
  const spoken = over
    ? `${delivered} delivered, ${claimed} claimed, ${wanted} wanted, which is more delivered than wanted`
    : `${delivered} delivered, ${claimed} claimed, ${wanted} wanted`;
  return (
    <div className="cp-slots" role="img" aria-label={spoken}>
      <div className="cp-slots-track">
        <div className="cp-slots-claimed" style={{ width: `${cPct}%`, background: tint }} />
        <div className="cp-slots-delivered" style={{ width: `${dPct}%`, background: tint }} />
      </div>
      <div className="cp-slots-caption">
        <span>{delivered} arrived</span>
        <span>{Math.max(0, claimed - delivered)} spoken for</span>
        <span>{wanted} wanted</span>
      </div>
      {over && (
        <p className="cp-slots-over">
          More arrived than were wanted. The hub counts a delivery twice when two stewards confirm
          it at once, and it is fixing that. Nothing here changes what the hub recorded.
        </p>
      )}
    </div>
  );
}

// ── The growth strip ─────────────────────────────────────────────────────────

/**
 * blueprint, wip, painted: the sprite ladder every structure on the map
 * climbs, keyed here to the DELIVERED share, because walls are made of what
 * arrived. Ships as stylized SVG; a painted sprite set is a named follow-up.
 *
 * CROSSING A THRESHOLD IS NOW LEGIBLE. The strip was a pure function of the
 * current percentage: 14% became 16%, the middle cell quietly swapped one
 * class for another, and the build passing from Blueprint to Raising was the
 * single most important thing this page can report and made no sound at all.
 *
 * `useArrival` is what keeps that from becoming noise. The first stage it
 * sees seeds the baseline in silence, so opening the page on a build that
 * crossed last month announces nothing; only a crossing that happens while
 * somebody is watching does. That is the rule the whole product runs on:
 * motion answers the person, it does not arrive unasked.
 */
export function GrowthStrip({ percentDelivered, percentPledged }: { percentDelivered: number; percentPledged: number }) {
  const stage = percentDelivered >= 70 ? 2 : percentDelivered >= 15 ? 1 : 0;
  const stages: Array<{ name: string; at: string }> = [
    { name: "Blueprint", at: "the dream, drawn" },
    { name: "Raising", at: "frames and scaffold" },
    { name: "Painted", at: "walls, roof, door" },
  ];
  const crossing = useMomentWindow(useArrival(String(stage)), 3600);
  return (
    <div className="cp-growth">
      <div className="cp-growth-row">
        {stages.map((s, i) => (
          <div
            key={s.name}
            className={`cp-growth-cell ${i === stage ? "on" : i < stage ? "done" : ""}${crossing && i === stage ? " crossed" : ""}`}
          >
            <HouseSprite stage={i} lit={i <= stage} />
            <div className="cp-growth-name">{s.name}</div>
            <div className="cp-growth-at">{s.at}</div>
          </div>
        ))}
      </div>
      {/* The news in words, because a border that brightened is not a readout
          and a screen reader has nothing to read in a class name. */}
      <p className="cp-growth-crossed" role="status" aria-live="polite">
        {crossing ? `The walls reached ${stages[stage].name}.` : ""}
      </p>
      {/*
        * THE THIRD BRANCH IS THE ONE THAT MATTERS.
        *
        * There were two, and delivered running AHEAD of pooled fell into the
        * happy one: measured on 2026-09-04 at 5% pooled against 40% delivered,
        * this paragraph read "Delivered work is keeping pace with the pool: 40%
        * standing." Delivered value has to have been pledged first, so that
        * pair cannot both be true, and the page was narrating it as health.
        * The cause is the hub's accepted-only pledged sum
        * (HUB_PLEDGED_TOTAL_IS_A_FLOOR above), and the honest thing to print is
        * the contradiction, never an arithmetic patch over it.
        *
        * THIS BRANCH IS NOT GATED ON THAT CONSTANT AND MUST NOT BE. The hub
        * fixed the cause we knew about on 2026-09-05, and the impossible pair
        * is still impossible: if it appears again the reason will be a new one.
        * What changed is the SENTENCE. It used to name the hub's defect and
        * promise a fix, which was true then and would be a confident wrong
        * answer now. It says what is observable instead, that one of the two
        * figures is wrong and this page does not know which, because the page
        * genuinely does not.
        *
        * It was also the one surface the flip did not reach: six read the
        * constant and this one carried the word on its own, so removing the
        * hedge everywhere else would have left it here alone, unqualified and
        * pointing at a repair that had already happened.
        */}
      <p className="cp-growth-note">
        The ring holds the promise; the walls are what has arrived.
        {percentDelivered > percentPledged
          ? ` More is standing than the pool records as pledged: ${percentPledged}% pooled against ${percentDelivered}% delivered. Both cannot be true, because delivered work was pledged first. One of the two figures is wrong and this page does not know which.`
          : percentPledged > percentDelivered
            ? ` Right now the ring runs ahead: ${percentPledged}% pooled, ${percentDelivered}% delivered and standing.`
            : ` Delivered work is keeping pace with the pool: ${percentDelivered}% standing.`}
      </p>
    </div>
  );
}

function HouseSprite({ stage, lit }: { stage: number; lit: boolean }) {
  const stroke = lit ? "#ecd08a" : "rgba(236,208,138,.35)";
  if (stage === 0) {
    return (
      <svg viewBox="0 0 80 64" width="80" height="64" aria-hidden="true">
        <g fill="none" stroke={stroke} strokeWidth="1.6" strokeDasharray="5 4">
          <path d="M12 34 L40 12 L68 34" />
          <rect x="18" y="34" width="44" height="22" />
          <rect x="34" y="42" width="12" height="14" />
        </g>
      </svg>
    );
  }
  if (stage === 1) {
    return (
      <svg viewBox="0 0 80 64" width="80" height="64" aria-hidden="true">
        <g fill="none" stroke={stroke} strokeWidth="2">
          <path d="M12 34 L40 12 L68 34" />
          <rect x="18" y="34" width="44" height="22" />
          <line x1="18" y1="45" x2="62" y2="45" />
          <line x1="30" y1="34" x2="30" y2="56" />
          <line x1="50" y1="34" x2="50" y2="56" />
        </g>
        <g stroke="rgba(201,162,94,.7)" strokeWidth="1.2">
          <line x1="8" y1="60" x2="8" y2="26" />
          <line x1="72" y1="60" x2="72" y2="26" />
          <line x1="4" y1="30" x2="76" y2="30" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 64" width="80" height="64" aria-hidden="true">
      <path d="M10 34 L40 10 L70 34 Z" fill="#8a5a3a" stroke="#ecd08a" strokeWidth="1.6" />
      <rect x="18" y="34" width="44" height="22" fill="#e4d3ae" stroke="#ecd08a" strokeWidth="1.6" />
      <rect x="34" y="42" width="12" height="14" fill="#3a2b1a" stroke="#c9a25e" strokeWidth="1.2" />
      <rect x="23" y="39" width="8" height="8" fill="#9fd4ff" stroke="#c9a25e" strokeWidth="1" />
      <rect x="49" y="39" width="8" height="8" fill="#9fd4ff" stroke="#c9a25e" strokeWidth="1" />
    </svg>
  );
}

// ── The page's scoped styles ─────────────────────────────────────────────────

export function CrowdpoolStyles() {
  return (
    <style>{`
      .cp-board{background:linear-gradient(180deg,#1c1309,#241a10 30%,#2a1f12);color:#f3e6c8;border-radius:18px;border:1px solid rgba(201,162,94,.35);overflow:hidden}
      .cp-plaque{background:linear-gradient(180deg,#fdf3d7,#efdcae);border:1px solid #8a6a33;border-radius:10px;color:#241a10;box-shadow:0 2px 10px rgba(0,0,0,.25)}
      .cp-smallcaps{font-variant:small-caps;letter-spacing:.18em;color:#ecd08a;font-weight:400}
      .cp-smallcaps-ink{font-variant:small-caps;letter-spacing:.14em;color:#4a3a26;font-weight:600}
      .cp-ring-wrap{position:relative;margin:0 auto}
      .cp-ring-pct{font-size:34px;font-weight:700;fill:#ecd08a}
      .cp-ring-sub{font-size:11px;letter-spacing:.25em;fill:#c9a25e}
      .cp-mini-pct{font-size:13px;font-weight:700;fill:#ecd08a}
      .cp-arc{transition:stroke-dashoffset 1.4s cubic-bezier(.25,.8,.3,1)}
      .cp-arc-slow{transition-duration:2s}
      .cp-ring-label{text-align:center;margin-top:6px;font-variant:small-caps;letter-spacing:.2em;font-size:13px;color:#c9a25e}
      .cp-ring-land{position:absolute;top:0;left:0;right:0;display:flex;justify-content:center;pointer-events:none}
      .cp-lantern{display:flex;flex-direction:column;align-items:center;gap:4px}
      .cp-lantern-line{font-size:12px;color:#e4d3ae;letter-spacing:.06em;text-align:center}
      .cp-slots-track{position:relative;height:10px;border-radius:6px;background:rgba(36,26,15,.15);border:1px solid rgba(138,106,51,.4);overflow:hidden}
      .cp-slots-claimed{position:absolute;inset:0 auto 0 0;opacity:.32}
      .cp-slots-delivered{position:absolute;inset:0 auto 0 0}
      .cp-slots-caption{display:flex;justify-content:space-between;font-size:10.5px;color:#4a3a26;margin-top:3px;letter-spacing:.04em}
      /* No colour of its own: it inherits the plaque ink and marks itself with
         weight and a rule, so the board keeps one palette. */
      .cp-slots-over{font-size:10.5px;line-height:1.45;font-weight:600;margin-top:4px;border-left:2px solid currentColor;padding-left:6px}
      .cp-need{position:relative;padding:12px 14px 12px 16px;border-left-width:4px;border-left-style:solid}
      .cp-need .cp-pin{position:absolute;top:8px;right:10px;font-size:10px;letter-spacing:.12em;color:#8a6a33;font-variant:small-caps}
      .cp-ledger-line{animation:none}
      .cp-ledger-line.arrival{animation:cp-arrive 1.2s ease-out 1}
      @keyframes cp-arrive{from{opacity:0;transform:translateY(-6px);background:rgba(236,208,138,.28)}to{opacity:1;transform:none;background:transparent}}
      .cp-growth-row{display:flex;gap:14px;justify-content:space-between}
      .cp-growth-cell{flex:1;text-align:center;opacity:.45;padding:8px 4px;border-radius:10px;border:1px dashed rgba(201,162,94,.25)}
      .cp-growth-cell.done{opacity:.8;border-style:solid}
      .cp-growth-cell.on{opacity:1;border-style:solid;border-color:#ecd08a;background:rgba(236,208,138,.07);box-shadow:0 0 14px rgba(236,208,138,.12)}
      .cp-growth-cell.crossed{animation:cp-cross 1.1s cubic-bezier(.37,0,.29,1) 1}
      @keyframes cp-cross{from{opacity:.45;transform:scale(.97)}60%{opacity:1;transform:scale(1.02)}to{opacity:1;transform:none}}
      .cp-growth-crossed{min-height:18px;font-size:12.5px;font-variant:small-caps;letter-spacing:.14em;color:#ecd08a;margin-top:8px;text-align:center}
      .cp-growth-name{font-variant:small-caps;letter-spacing:.16em;font-size:12px;color:#ecd08a;margin-top:2px}
      .cp-growth-at{font-size:10.5px;color:#c9a25e}
      .cp-growth-note{font-size:12.5px;color:#e4d3ae;margin-top:10px;line-height:1.5}
      .cp-stale{background:rgba(36,26,15,.85);border:1px solid rgba(201,162,94,.5);color:#e4d3ae;border-radius:10px;padding:10px 14px;font-size:13px}
      @media (prefers-reduced-motion: reduce){
        .cp-arc{transition:none}
        .cp-ledger-line.arrival{animation:none}
        .cp-lantern-star{filter:none}
        /* The crossed cell holds the lit state it animated toward. The old
           rule here set the ripple to opacity 0, which removed the arrival
           instead of stilling it; the kit's Ripples now carries its own held
           form and needs nothing said about it. */
        .cp-growth-cell.crossed{animation:none;opacity:1}
      }
    `}</style>
  );
}
