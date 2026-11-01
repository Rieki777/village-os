/**
 * The spring plot's picture, as the approved prototype drew it. Every colour
 * is a token from forest.css, so nothing here is a literal the theme guard
 * would have to excuse. What grows is driven by the real setup state the
 * page passes in: a stake when the account exists, a sprout when the key is
 * planted, stones as Resend sees the DNS records, a nursery dome while the
 * test letter is out, bees once it is delivered, and a stream when the post
 * office is on.
 */
export interface SceneState {
  account: boolean;
  keyed: boolean;
  /** How many of the four stones to light. */
  stones: number;
  storm: boolean;
  nursery: boolean;
  bees: boolean;
  flowing: boolean;
  /** The agent is digging: DNS or the transplant. */
  busy: boolean;
  stake: string;
}

const v = (name: string) => `var(--sg-${name})`;

export default function ForestScene({ s }: { s: SceneState }) {
  const op = (on: boolean, level = 1) => (on ? level : 0);
  return (
    <svg viewBox="0 0 600 380" role="img" aria-label="The spring plot in the food forest">
      <defs>
        <linearGradient id="sg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v("sky1")} />
          <stop offset=".7" stopColor={v("sky2")} />
          <stop offset="1" stopColor={v("sky3")} />
        </linearGradient>
        <linearGradient id="sg-soil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v("moss1")} />
          <stop offset=".16" stopColor={v("moss2")} />
          <stop offset=".19" stopColor={v("loam1")} />
          <stop offset="1" stopColor={v("loam2")} />
        </linearGradient>
        <radialGradient id="sg-pool" cx=".5" cy=".4" r=".6">
          <stop offset="0" stopColor={v("pool1")} />
          <stop offset=".5" stopColor={v("teal")} />
          <stop offset="1" stopColor={v("pool3")} />
        </radialGradient>
        <radialGradient id="sg-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor={v("gold-b")} stopOpacity=".55" />
          <stop offset="1" stopColor={v("gold-b")} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="380" fill="url(#sg-sky)" />
      <g className="sg-motes" fill={v("earned-lit")}>
        {[[60, 60, 1.6], [140, 96, 1.2], [230, 40, 1.4], [330, 88, 1.2], [420, 50, 1.6], [520, 84, 1.3], [560, 30, 1.1], [190, 150, 1.2], [400, 160, 1.4]].map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <g fill={v("far")}>
        <circle cx="40" cy="160" r="64" /><circle cx="120" cy="140" r="58" /><circle cx="470" cy="145" r="60" /><circle cx="560" cy="158" r="64" /><circle cx="300" cy="160" r="48" />
      </g>
      <g>
        <rect x="74" y="150" width="12" height="90" fill={v("trunk")} />
        <circle cx="80" cy="140" r="44" fill={v("tree1")} /><circle cx="58" cy="160" r="26" fill={v("tree2")} />
        <circle cx="70" cy="128" r="5.5" fill={v("fruit-red")} /><circle cx="96" cy="150" r="5.5" fill={v("fruit-red")} /><circle cx="62" cy="152" r="5" fill={v("fruit-red")} />
        <rect x="514" y="150" width="12" height="90" fill={v("trunk")} />
        <circle cx="520" cy="138" r="46" fill={v("tree1")} /><circle cx="548" cy="160" r="26" fill={v("tree2")} />
        <circle cx="506" cy="130" r="5" fill={v("fruit-gold")} /><circle cx="534" cy="150" r="5" fill={v("fruit-gold")} /><circle cx="512" cy="158" r="5" fill={v("fruit-gold")} />
      </g>
      <g fill={v("shrub")}><circle cx="150" cy="232" r="24" /><circle cx="176" cy="240" r="18" /><circle cx="440" cy="234" r="22" /><circle cx="462" cy="242" r="16" /></g>
      <g fill={v("berry")}><circle cx="146" cy="226" r="3.2" /><circle cx="158" cy="236" r="3.2" /><circle cx="170" cy="232" r="3.2" /><circle cx="446" cy="228" r="3.2" /><circle cx="436" cy="238" r="3.2" /></g>
      <path d="M0 240 Q150 228 300 238 T600 236 V380 H0Z" fill="url(#sg-soil)" />
      <g fill={v("herb")}>
        <path d="M20 244 q6 -18 12 0z" /><path d="M200 246 q5 -14 10 0z" /><path d="M216 246 q5 -18 10 0z" /><path d="M380 244 q5 -16 10 0z" /><path d="M396 244 q5 -12 10 0z" /><path d="M580 242 q6 -16 12 0z" />
      </g>
      <g fill="none" stroke={v("gold-b")} strokeWidth="1.3" opacity={s.busy ? 0.9 : 0.35} className={`sg-fade${s.busy ? " sg-myc-live" : ""}`}>
        <path d="M80 240 C120 290 200 300 300 290 S480 290 520 240" />
        <path d="M150 256 C200 320 260 330 300 300" />
        <path d="M450 256 C410 320 340 330 300 300" />
        <path d="M300 290 L300 340 M300 340 C260 352 230 360 200 372 M300 340 C340 352 380 360 420 372" />
      </g>
      <g transform="translate(410 300)">
        <circle cx="18" cy="16" r="26" fill="url(#sg-glow)" opacity={op(s.keyed, 0.45)} className="sg-fade" />
        <path d="M0 30 V8 a18 14 0 0 1 36 0 V30z" fill={v("door")} stroke={v("gold")} strokeWidth="1.5" />
        <circle cx="28" cy="20" r="2.4" fill={v("gold-b")} />
        <text x="18" y="46" textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" letterSpacing="1.5" fill={v("gold-b")} style={{ fontVariant: "small-caps" }}>root cellar</text>
      </g>
      <ellipse cx="300" cy="262" rx="92" ry="26" fill={v("hollow")} stroke={v("gold")} strokeOpacity=".55" strokeWidth="1.5" />
      <ellipse cx="300" cy="262" rx="84" ry="21" fill="url(#sg-pool)" opacity={s.flowing ? 1 : s.bees ? 0.85 : s.stones >= 4 ? 0.35 : 0} className="sg-fade" />
      <circle className="sg-rip" cx="300" cy="262" r="4" fill="none" stroke={v("ripple")} strokeWidth="2" opacity={op(s.bees, 0.8)} />
      <g opacity={op(s.account && !s.keyed)} className="sg-fade"><ellipse cx="300" cy="258" rx="6" ry="4" fill={v("gold-b")} /></g>
      <g opacity={op(s.keyed)} className="sg-fade" stroke={v("living")} strokeWidth="3" fill={v("sprout")} strokeLinecap="round">
        <path d="M300 258 V236" fill="none" /><path d="M300 244 q-16 -4 -18 -16 q14 0 18 16z" strokeWidth="1.5" /><path d="M300 238 q14 -6 18 -18 q-14 2 -18 18z" strokeWidth="1.5" />
      </g>
      <g opacity={op(s.account)} className="sg-fade" transform="translate(188 220)">
        <rect x="22" y="16" width="4" height="34" fill={v("trunk")} />
        <rect x="0" y="0" width="70" height="22" rx="3" fill={v("paper-ink")} stroke={v("gold")} />
        <text x="35" y="15" textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" letterSpacing="1" fill={v("parch")} style={{ fontVariant: "small-caps" }}>{s.stake}</text>
      </g>
      <g>
        {[[214, 274], [248, 290], [352, 290], [386, 274]].map(([cx, cy], i) => (
          <ellipse key={cx} cx={cx} cy={cy} rx="11" ry="6" fill={i < s.stones ? v("stone-on") : v("stone-off")} opacity={i < s.stones ? 1 : 0.25} />
        ))}
      </g>
      <g opacity={op(s.nursery)} className="sg-fade">
        <path d="M226 262 a74 70 0 0 1 148 0" fill={v("pool1")} fillOpacity=".14" stroke={v("teal")} strokeWidth="1.5" />
        <path d="M262 262 a38 66 0 0 1 76 0 M300 192 V262" fill="none" stroke={v("teal")} strokeOpacity=".7" strokeWidth="1.2" />
        <text x="300" y="184" textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" letterSpacing="1.5" fill={v("teal")} style={{ fontVariant: "small-caps" }}>nursery</text>
      </g>
      <path className="sg-stream" d="M384 268 C430 290 470 300 520 300 S590 312 600 316" fill="none" stroke={v("teal")} strokeWidth="6" strokeLinecap="round" opacity={op(s.flowing, 0.9)} />
      <g opacity={op(s.bees)} className="sg-fade">
        {[[270, 214], [316, 200], [338, 224]].map(([cx, cy]) => (
          <g key={cx} className="sg-bee">
            <ellipse cx={cx} cy={cy} rx="5" ry="3.6" fill={v("fruit-gold")} stroke={v("bee-line")} strokeWidth="1" />
            <ellipse cx={cx - 2} cy={cy - 4} rx="3" ry="2" fill={v("white")} opacity=".8" />
          </g>
        ))}
      </g>
      <g opacity={op(s.storm)} className="sg-fade">
        <rect width="600" height="380" fill={v("dusk")} opacity=".35" />
        <g fill={v("cloud")}><circle cx="220" cy="60" r="30" /><circle cx="256" cy="50" r="36" /><circle cx="296" cy="62" r="28" /><circle cx="360" cy="70" r="30" /><circle cx="396" cy="58" r="34" /><circle cx="432" cy="72" r="24" /></g>
        <g className="sg-drops" stroke={v("teal")} strokeOpacity=".7" strokeWidth="2" strokeLinecap="round">
          {[[220, 100], [250, 120], [282, 104], [318, 124], [352, 108], [388, 122], [420, 104]].map(([x, y]) => (
            <line key={x} x1={x} y1={y} x2={x - 4} y2={y + 14} />
          ))}
        </g>
      </g>
      <g transform="translate(300 336)">
        <rect x="-74" y="-15" width="148" height="28" rx="3" fill={v("banner")} fillOpacity=".92" stroke={v("gold")} strokeOpacity=".55" />
        <text x="0" y="5" textAnchor="middle" fontFamily="Georgia, serif" fontSize="16" letterSpacing="3.3" fill={v("parch")} style={{ fontVariant: "small-caps" }}>The Spring</text>
      </g>
    </svg>
  );
}
