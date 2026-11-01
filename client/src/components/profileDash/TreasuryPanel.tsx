/**
 * YOUR TREASURY: what you have earned (approved design, 2026-10-30).
 *
 * Four purses, then earned by moon, what is coming, the latest ledger lines and
 * what the member holds. Every figure is a door the page already reads
 * (useDashData). Cash is the 0285 record, so this purse SUMMARISES it and the
 * full list with its Claim buttons and the treasurer's books stays in
 * CashOwedPanel further down (#cash-owed); "Payment history" scrolls there.
 *
 * Whole numbers throughout (Rye, 2026-09-04). Gratitude says what was RECEIVED
 * this cycle and how much is left to SEND, because it only counts when it is
 * sent (Rye, 2026-10-23).
 *
 * A purse whose token this village does not run is left out: a village with no
 * Voice token has three purses, not a Voice purse reading zero.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { authToken, useGameConfig } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { announceProfileChange } from "@/lib/profileRefresh";
import { cashPayWords, linesWords, useDisplayRates } from "@/lib/workPay";
import type { PathParticulars } from "@shared/pathLadders";
import type { DashData, WalletRowLite } from "./useDashData";
import { cashSummary, earnedIn, moonRows, pickTokens, whole, wholeMoney, type MoonRow } from "./dashModel";
import { KICKER, LINK } from "./dashUi";

type Coin = "cash" | "gold" | "voice" | "thanks";
const COIN: Record<Coin, string> = {
  cash: "bg-dash-cash border-dash-voice",
  gold: "bg-dash-gold border-dash-gold-lit",
  voice: "bg-dash-voice border-dash-cash",
  thanks: "bg-dash-thanks border-dash-thanks",
};
const PURSE_EDGE: Record<Coin, string> = {
  cash: "border-dash-voice/50",
  gold: "border-dash-warm-edge",
  voice: "border-dash-edge",
  thanks: "border-dash-thanks/40",
};
const VALUE_TEXT: Record<Coin, string> = { cash: "text-dash-cash", gold: "text-dash-gold-lit", voice: "text-foreground", thanks: "text-foreground" };

const BTN = "inline-flex min-h-10 items-center rounded-[10px] px-3.5 text-[13px] font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BTN_FILL: Record<Coin, string> = {
  cash: "bg-dash-cash text-dash-cash-ink",
  gold: "bg-dash-gold text-dash-gold-ink",
  voice: "border border-border text-foreground",
  thanks: "bg-dash-thanks text-dash-thanks-ink",
};
const BTN_QUIET = `${BTN} border border-border text-foreground hover:bg-muted`;

/**
 * The design sets these small headings in the body face at 600. The sheet's
 * unlayered rule puts every h1 to h6 in the display face at 400 (index.css,
 * `.sheet-night :is(h1, ...)`), and only an inline style outranks it.
 */
const BODY_HEADING = { fontFamily: "inherit", fontWeight: 600, letterSpacing: "normal" } as const;

const held = (row: WalletRowLite) => row.heldUnits / Math.pow(10, Math.max(0, row.decimals));
const tokensName = (name: string) => (/tokens?$/i.test(name.trim()) ? name : `${name} tokens`);

function Purse({
  coin,
  glyph,
  name,
  value,
  delta,
  what,
  children,
  actions,
}: {
  coin: Coin;
  glyph: string;
  name: string;
  value: string;
  delta: string;
  what: string | null;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className={`flex flex-col gap-1.5 rounded-2xl border bg-card p-4 sm:gap-2 sm:rounded-[18px] sm:bg-dash-raised sm:p-5 ${PURSE_EDGE[coin]}`}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 text-[13px] font-bold text-dash-gold-ink sm:h-[34px] sm:w-[34px] sm:text-[15px] ${COIN[coin]}`}>
          {glyph}
        </span>
        <h3 className="m-0 min-w-0 flex-1 text-sm sm:text-[15px]" style={BODY_HEADING}>
          {name}
        </h3>
        <span className={`shrink-0 font-display leading-none sm:hidden ${value.length > 9 ? "text-2xl" : "text-[30px]"} ${VALUE_TEXT[coin]}`}>{value}</span>
      </div>
      <p className={`m-0 mt-1 hidden font-display leading-none sm:block ${value.length > 9 ? "text-[34px]" : "text-[44px]"} ${VALUE_TEXT[coin]}`}>{value}</p>
      <p className="m-0 text-xs font-semibold text-dash-cash sm:text-[13px]">{delta}</p>
      {what ? <p className="m-0 text-xs text-muted-foreground sm:text-[13px]">{what}</p> : null}
      {children}
      <div className="mt-auto flex flex-wrap gap-2 pt-1.5">{actions}</div>
    </li>
  );
}

export default function TreasuryPanel({
  data,
  claimedQuests,
  particulars,
  redeemOn,
  seasonName,
}: {
  data: DashData;
  /** This member's quests still in hand: claimed or submitted, not yet consented. */
  claimedQuests: ReadonlyArray<{ questId: string; questTitle: string }>;
  particulars: PathParticulars | null;
  redeemOn: boolean;
  seasonName: string | null;
}) {
  const rates = useDisplayRates();
  /** The village's own word for its recognition token, never a literal (scripts/check-village-facts.mjs). */
  const thanksName = useTokenName("Recognition");
  const config = useGameConfig();
  const [claiming, setClaiming] = useState(false);
  const [said, setSaid] = useState("");
  const { village, voice } = pickTokens(data.wallet ?? [], config?.currency?.value?.slug);
  const cash = data.cash ? cashSummary(data.cash) : null;
  const cycleStart = data.cycle?.startsAt ?? null;
  const thisMoon = (token: string | undefined) => (token && data.ledger && cycleStart ? earnedIn(data.ledger, token, cycleStart) : null);

  /** Claim every owed line, one by one, the same door CashOwedPanel's own button uses. */
  const claimAll = async () => {
    if (!data.cash || claiming) return;
    setClaiming(true);
    setSaid("");
    const t = authToken();
    const owed = data.cash.filter((e) => e.state === "owed");
    let done = 0;
    for (const e of owed) {
      try {
        const r = await fetch(`/api/me/cash-owed/${encodeURIComponent(e.id)}/claim`, {
          method: "POST",
          headers: t ? { Authorization: `Bearer ${t}` } : {},
        });
        if (r.ok) done += 1;
      } catch {
        /* counted below */
      }
    }
    setClaiming(false);
    setSaid(done === owed.length ? `Claimed ${done} ${done === 1 ? "line" : "lines"}. The treasurer sees them now.` : `Claimed ${done} of ${owed.length}. Try the rest again.`);
    announceProfileChange();
  };

  const moons: MoonRow[] =
    data.ledger && data.cycle
      ? moonRows(data.ledger, { current: data.cycle, past: data.pastMoons ?? [] }, { village: village?.token ?? null, voice: voice?.token ?? null }, data.cash ?? [])
      : [];
  const maxTok = Math.max(1, ...moons.map((m) => m.tokens));
  const maxVoice = Math.max(1, ...moons.map((m) => m.voice));

  const coming = claimedQuests
    .map((q) => {
      const pay = data.questPay?.[q.questId];
      if (!pay) return null;
      const cashLine = cashPayWords(pay, rates)?.own ?? null;
      const words = [cashLine, pay.lines.length ? linesWords(pay.lines) : null].filter(Boolean).join(" · ");
      return words ? { key: q.questId, title: q.questTitle, pay: words } : null;
    })
    .filter((x): x is { key: string; title: string; pay: string } => x !== null);

  // The ledger read names no order, so the newest four are chosen here.
  const latest = [...(data.ledger ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4);

  const holdings: Array<{ kind: string; value: string; href: string }> = [];
  const facts = (particulars?.investor?.facts ?? []) as unknown[];
  if (facts.length) holdings.push({ kind: "Investments", value: `${facts.length} on record`, href: "#sheet-paths" });
  const ventures = particulars?.["prosperity-creator"]?.ventures?.filter((v) => v.live) ?? [];
  if (ventures.length) holdings.push({ kind: "Ventures", value: `${ventures.length} open: ${ventures.map((v) => v.name).join(", ")}`, href: "#sheet-paths" });
  const stays = particulars?.resident?.reservations ?? [];
  if (stays.length) holdings.push({ kind: "Reservations", value: stays.map((r) => `${r.homeType}, ${r.status}`).join(" · "), href: "#sheet-paths" });

  return (
    <section
      id="treasury"
      aria-labelledby="tr-h"
      className="scroll-mt-28 flex flex-col gap-4 sm:gap-[22px] sm:rounded-3xl sm:border sm:border-dash-warm-edge sm:bg-card sm:p-7 sm:shadow-[inset_0_0_80px_color-mix(in_srgb,var(--color-dash-gold)_6%,transparent)]"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <p className={KICKER}>{seasonName ? `Your treasury · ${seasonName}` : "Your treasury"}</p>
          <h2 id="tr-h" className="m-0 font-display text-[34px] leading-tight sm:text-[38px]">
            What you have earned
          </h2>
        </div>
        <a href="#ledger" className={`${LINK} hidden text-sm sm:inline`}>
          Where it came from: the full ledger
        </a>
      </div>

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-[repeat(auto-fit,minmax(250px,1fr))]">
        {cash ? (
          <Purse
            coin="cash"
            glyph="$"
            name="Cash owed to you"
            value={cash.outstandingMinor > 0 && cash.currency ? wholeMoney(cash.outstandingMinor, cash.currency) : cash.outstandingMinor > 0 ? `${cash.owed + cash.claimed} lines` : "None"}
            delta={cash.owed + cash.claimed + cash.paid === 0 ? "Nothing owed to you yet" : `${cash.owed + cash.claimed} ${cash.owed + cash.claimed === 1 ? "line" : "lines"} waiting`}
            what="Real money the village pays you by bank transfer. The Treasurer marks it paid here when it is sent."
            actions={
              <>
                {cash.owed > 0 ? (
                  <button type="button" onClick={claimAll} disabled={claiming} className={`${BTN} ${BTN_FILL.cash} disabled:opacity-60`}>
                    {claiming ? "Claiming…" : "Claim all"}
                  </button>
                ) : null}
                {cash.owed + cash.claimed + cash.paid > 0 ? (
                  <a href="#cash-owed" className={BTN_QUIET}>
                    Payment history
                  </a>
                ) : null}
              </>
            }
          >
            {cash.owed + cash.claimed + cash.paid > 0 ? (
              <ol aria-label="Cash status" className="m-0 mt-1 hidden list-none grid-cols-3 gap-1.5 p-0 sm:grid">
                {[
                  { n: cash.owed, label: "Owed", cls: "text-dash-gold-lit" },
                  { n: cash.claimed, label: "Claimed", cls: "text-foreground" },
                  { n: cash.paid, label: "Paid", cls: "text-dash-cash" },
                ].map((s) => (
                  <li key={s.label} className="rounded-[10px] bg-dash-chip p-2 text-center">
                    <span className={`block text-lg font-semibold ${s.cls}`}>{s.n}</span>
                    <span className="text-[11px] text-muted-foreground">{s.label}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <p aria-live="polite" className="m-0 text-xs text-muted-foreground">
              {said}
            </p>
          </Purse>
        ) : null}

        {village ? (
          <Purse
            coin="gold"
            glyph={village.name.trim().slice(0, 1).toUpperCase()}
            name={tokensName(village.name)}
            value={whole(held(village))}
            delta={thisMoon(village.token) === null ? "" : `+${whole(thisMoon(village.token) ?? 0)} this moon`}
            what={null}
            actions={
              <>
                {redeemOn ? (
                  <a href="#redeem" className={`${BTN} ${BTN_FILL.gold}`}>
                    Redeem
                  </a>
                ) : null}
                <a href="#send-tokens" className={BTN_QUIET}>
                  Send
                </a>
              </>
            }
          />
        ) : null}

        {voice ? (
          <Purse
            coin="voice"
            glyph="V"
            name={voice.name}
            value={whole(held(voice))}
            delta={thisMoon(voice.token) === null ? "" : `+${whole(thisMoon(voice.token) ?? 0)} this moon`}
            what="Your weight when the village votes. Earned by showing up, never bought."
            actions={
              <Link href="/governance" className={`${BTN} ${BTN_FILL.voice}`}>
                Open ballots
              </Link>
            }
          />
        ) : null}

        {data.gratitude ? (
          <Purse
            coin="thanks"
            glyph={thanksName.trim().slice(0, 1).toUpperCase()}
            name={thanksName}
            value={whole(data.gratitude.receivedThisCycle)}
            delta="received this cycle"
            what="Thanks you give from the pool. It only counts when you send it."
            actions={
              <Link href="/gratitude" className={`${BTN} ${BTN_FILL.thanks}`}>
                Send {thanksName.toLowerCase()}
              </Link>
            }
          >
            {data.gratitude.total > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="h-2 overflow-hidden rounded bg-dash-track">
                  <div
                    className="h-full bg-dash-thanks"
                    style={{ width: `${Math.round((Math.min(data.gratitude.remaining, data.gratitude.total) / data.gratitude.total) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {whole(data.gratitude.remaining)} of {whole(data.gratitude.total)} left to send
                  {typeof data.cycle?.daysRemaining === "number" ? ` · cycle closes in ${data.cycle.daysRemaining} ${data.cycle.daysRemaining === 1 ? "day" : "days"}` : ""}
                </span>
              </div>
            ) : null}
          </Purse>
        ) : null}
      </ul>

      <div className="flex flex-wrap gap-4">
        {moons.length > 0 ? (
          <div className="hidden min-w-0 flex-[1_1_380px] flex-col gap-3 rounded-[18px] border border-dash-edge bg-dash-raised p-5 sm:flex">
            <h3 className="m-0 text-base" style={BODY_HEADING}>
              Earned by moon
            </h3>
            {moons.map((m) => (
              <div key={m.label} className="grid grid-cols-[80px_1fr] items-center gap-3">
                <span className="text-[13px] text-muted-foreground">{m.label}</span>
                <div className="flex flex-col gap-1">
                  {village ? (
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 rounded bg-dash-gold" style={{ width: `${Math.max(2, Math.round((m.tokens / maxTok) * 60))}%` }} />
                      <span className="text-xs">{whole(m.tokens)} {tokensName(village.name).toLowerCase()}</span>
                    </div>
                  ) : null}
                  {voice ? (
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 rounded bg-dash-voice" style={{ width: `${Math.max(2, Math.round((m.voice / maxVoice) * 40))}%` }} />
                      <span className="text-xs">{whole(m.voice)} {voice.name.toLowerCase()}</span>
                    </div>
                  ) : null}
                  {data.cash ? (
                    <span className="text-xs text-muted-foreground">
                      {m.cashMinor > 0 && data.cash[0]
                        ? `${wholeMoney(m.cashMinor, data.cash[0].currency)} cash${m.cashPaid ? ", paid" : " owed"}`
                        : "No cash"}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-2.5 rounded-2xl border border-dash-edge bg-card p-4 sm:rounded-[18px] sm:bg-dash-raised sm:p-5">
          <h3 className="m-0 text-[15px] sm:text-base" style={BODY_HEADING}>
            Coming when you finish
          </h3>
          {coming.length === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">
              Nothing in hand pays out yet.{" "}
              <Link href="/quests" className={LINK}>
                Find a quest
              </Link>
            </p>
          ) : (
            coming.map((c) => (
              <div key={c.key} className="border-b border-dash-edge pb-2.5 last:border-b-0">
                <p className="m-0 text-sm font-medium">{c.title} (quest)</p>
                <p className="m-0 mt-0.5 text-[13px] text-dash-gold-lit">{c.pay}</p>
              </div>
            ))
          )}
          {latest.length > 0 ? (
            <>
              <h3 className="m-0 mt-1.5 hidden text-base sm:block" style={BODY_HEADING}>
                Latest in your ledger
              </h3>
              {latest.map((l, i) => (
                <div key={`${l.at}-${i}`} className="hidden gap-2.5 text-[13px] sm:flex">
                  <span className="flex-1 text-foreground/85">{l.description || l.source}</span>
                  <span className={`text-right font-semibold ${l.amount >= 0 ? "text-dash-gold-lit" : "text-muted-foreground"}`}>
                    {l.amount >= 0 ? "+" : "−"}
                    {whole(Math.abs(l.amount) / Math.pow(10, Math.max(0, l.decimals)))} {l.tokenName}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      {holdings.length > 0 ? (
        <ul className="m-0 hidden list-none gap-3 p-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {holdings.map((h) => (
            <li key={h.kind}>
              <a href={h.href} className="flex flex-col gap-0.5 rounded-[14px] border border-dash-edge bg-dash-raised px-4 py-3.5 text-foreground no-underline hover:bg-muted">
                <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{h.kind}</span>
                <span className="text-[15px] font-medium">{h.value}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <a href="#ledger" className="flex min-h-11 items-center justify-center rounded-xl border border-border text-sm text-foreground no-underline sm:hidden">
        Where it came from: the full ledger
      </a>
    </section>
  );
}
