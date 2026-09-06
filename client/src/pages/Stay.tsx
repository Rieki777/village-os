/**
 * Stays (S30-S31): the member-facing page. Rooms post their prices in stay
 * credits (and optionally USD); one credit hosts one night. Credits are
 * bought with real money or EARNED through work-exchange quests — the same
 * consent gate as every other reward.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { BedDouble, CreditCard, Hammer, Moon, Send } from "lucide-react";
import { Image } from "@/components/Image";
import { ExamplesBanner } from "@/components/ExamplesBanner";
import { ExampleRefusal, readRefusal } from "@/components/ExampleRefusal";
import { formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;

export default function Stay() {
  const modules = useModules();
  const staysModule = useModule("stays");
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requesting, setRequesting] = useState<string>("");
  const [arriveOn, setArriveOn] = useState("");
  const [notes, setNotes] = useState("");
  const [buyNights, setBuyNights] = useState(7);
  // The refusal, keyed to the room: the page-top error slot sits above the
  // whole grid, and the request composer stays open, so nothing near the
  // button moved. Declared with the other state, ABOVE the early return
  // below: a hook after a conditional return changes the hook count between
  // renders the moment the module catalogue loads.
  const [refusedRoom, setRefusedRoom] = useState<{ id: string; message: string } | null>(null);

  const load = () => {
    fetch("/api/stays", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  };
  useEffect(() => {
    if (staysModule) load();
    const q = new URLSearchParams(window.location.search).get("purchase");
    if (q === "success") setNotice("Payment received. Your credits arrive as soon as Stripe confirms (usually seconds).");
    if (q === "cancelled") setNotice("Checkout cancelled. Nothing was charged.");
  }, [staysModule?.id]);

  if (modules.loaded && !staysModule) return <ModuleGate moduleId="stays" name="Stays" />;

  const request = (accommodationId: string) => {
    setError(""); setRefusedRoom(null);
    fetch("/api/stays/request", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ accommodationId, arriveOn: arriveOn || undefined, notes }),
    })
      .then(async (r) => {
        const { ok, data: d, refusal } = await readRefusal(r);
        if (refusal) { setRefusedRoom({ id: accommodationId, message: refusal }); return; }
        if (!ok) throw new Error(d?.error || "Could not request");
        setRequesting("");
        setNotes("");
        setNotice("Request sent. The stewards will be in touch.");
        load();
      })
      .catch((e) => setError(e.message));
  };

  const checkout = (accommodationId: string) => {
    setError(""); setRefusedRoom(null);
    fetch("/api/stays/checkout", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ accommodationId, nights: buyNights }),
    })
      .then(async (r) => {
        const { ok, data: d, refusal } = await readRefusal(r);
        if (refusal) { setRefusedRoom({ id: accommodationId, message: refusal }); return; }
        if (!ok) throw new Error(d?.error || "Could not start checkout");
        window.location.href = d.url;
      })
      .catch((e) => setError(e.message));
  };

  const audience = data?.audience ?? "guest";
  /**
   * THE VILLAGE'S WORD FOR A PRICED TOKEN, AND ITS SCALE, off `priceTokens`.
   *
   * Every number in `a.prices` is `accommodation_prices.amount_minor`, the
   * ledger's MINOR units. This page divided its balance line and printed every
   * RATE raw, so a member could not work out how many nights they could afford
   * from the two numbers in front of them, which is the only arithmetic anyone
   * does on this page.
   *
   * `priceTokens` covers every token any room posts a rate in, including stay
   * credits, and reaches a signed-out visitor. `mine.balances`, where the name
   * used to come from, reaches neither. Falls back to the slug and to whole
   * units, which is what an unregistered token honestly means.
   */
  const priceTokens: Record<string, { name?: string; decimals?: number }> = data?.priceTokens ?? {};
  const tokenName = (slug: string): string => priceTokens[slug]?.name ?? slug;
  const tokenScale = (slug: string): number => Number(priceTokens[slug]?.decimals ?? 0) || 0;
  /**
   * Stay credits' own scale. It is the SAME token as `mine.balanceDecimals` on
   * the balance line above, read from `priceTokens` so a signed-out visitor
   * reading a nightly rate gets the number a member gets.
   */
  const stayScale = tokenScale("stay-credit");
  /**
   * 0092: every nightly rate a room posts that is neither stay credits nor
   * money, with the village's own name for each token.
   *
   * Derived from the room's posted prices and the balances the payload already
   * carries, so a village that renamed its credits sees its own word here with
   * nothing extra to configure. Written as a helper rather than inline because
   * "the prices that are not the two we already handle" is a rule, and a rule
   * spelled out once is a rule that stays true when a third one appears.
   */
  const villagePrices = (a: any): Array<{ slug: string; name: string; amount: string; units: number }> =>
    Object.entries(a.prices ?? {})
      .filter(([slug]) => slug !== "stay-credit" && slug !== "usd")
      .map(([slug, tiers]: [string, any]) => {
        const units = Number(tiers?.[audience] ?? tiers?.guest ?? 0);
        return { slug, name: tokenName(slug), amount: formatTokenAmount(units, tokenScale(slug)), units };
      })
      // Filtered on the UNITS, not on the rendered string: "0.001" is truthy
      // and a room posting one minor unit is still a room with a rate.
      .filter((v) => v.units > 0);

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Stay With Us</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            One stay credit hosts one night. Buy credits, or earn them through
            work-exchange Quests. The village runs on contribution either way.
          </p>
          <ExamplesBanner moduleId="stays" noun="room" />
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-3xl space-y-6">
          {notice && <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">{notice}</p>}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          {user && data?.mine && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-3">
                <Moon className="w-5 h-5 text-teal-deep" />
                <p className="text-sm text-foreground">
                  {/* Stay credits carry decimals 0 today. Through the shared
                      formatter regardless, for the reason in
                      client/src/lib/tokenAmount.ts: after the move to 4
                      decimals every undivided surface is wrong at once. */}
                  Your balance: <span className="font-bold">{formatTokenAmount(Number(data.mine.balance ?? 0), Number(data.mine.balanceDecimals ?? 0))}</span> stay credit(s)
                  {data.mine.balance < 0 && <span className="text-red-600">, please settle up with the stewards</span>}
                </p>
              </div>
              {data.mine.stays.filter((s: any) => s.status === "requested" || s.status === "active").map((s: any) => (
                <div key={s.id} className="mt-3 text-sm text-muted-foreground border-t border-border pt-3">
                  {s.status === "requested" ? (
                    <>Your stay request is with the stewards.</>
                  ) : (
                    <>
                      {/* The snapshot is in the token the stay was ACTIVATED
                          in, which is not always stay credits, so it reads
                          against that token's scale and not against the one
                          the balance line above uses. */}
                      Your stay is active at <b>{formatTokenAmount(Number(s.rateSnapshotCredits ?? 0), tokenScale(s.rateSnapshotToken ?? "stay-credit"))}</b> credit(s)/night
                      {s.nightsRemaining != null && <>, about <b>{Math.max(0, s.nightsRemaining)}</b> night(s) covered</>}.
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {(data?.accommodations ?? []).map((a: any) => {
              const credit = a.prices?.["stay-credit"]?.[audience] ?? a.prices?.["stay-credit"]?.guest;
              const money = a.prices?.usd?.[audience] ?? a.prices?.usd?.guest;
              // Both tiers ship to every viewer, and the page kept only the
              // one it was standing in. A visitor never learned a member rate
              // existed, and a member had nothing to compare theirs against.
              //
              // A room may genuinely post one price for everyone, and one of
              // the seeded rooms charges the same credits either way while
              // its dollar rates differ. Show the second number only where
              // there IS a second number.
              const memberCredit = a.prices?.["stay-credit"]?.member;
              const guestCredit = a.prices?.["stay-credit"]?.guest;
              const tiered = memberCredit != null && guestCredit != null && memberCredit !== guestCredit;
              return (
                <div key={a.id} className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
                  {a.photoUrl && <Image src={a.photoUrl} alt={a.name} className="h-40 w-full" />}
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <BedDouble className="w-4 h-4 text-teal-deep" />
                      <p className="font-semibold text-foreground">{a.name}</p>
                    </div>
                    {/* Recorded on every room since stays shipped, clamped to
                        at least 1 server-side, and shown only to admins. */}
                    {a.capacity > 0 && (
                      <p className="text-xs text-muted-foreground mb-2">Sleeps {a.capacity}</p>
                    )}
                    {a.description && <p className="text-sm text-muted-foreground mb-3">{a.description}</p>}
                    <div className="mt-auto space-y-2">
                      <p className="text-sm text-foreground">
                        {/* Divides for the same reason the balance line at the
                            top of this page divides: a rate and a balance a
                            member is asked to compare have to be in one scale.
                            Stay credits carry decimals 0 today, so this reads
                            exactly as it always has. */}
                        {credit ? <><b>{formatTokenAmount(credit, stayScale)}</b> credit(s)/night</> : <span className="text-muted-foreground">rate coming soon</span>}
                        {money ? <span className="text-muted-foreground"> · {usd(money)}/night</span> : null}
                        {/* 0092: a room can also post a nightly rate in the
                            village's own credits, which is where the cycle
                            pool's value finally buys something. Either
                            accepted, never a rate between them: the stewards
                            activate the stay in one of the two. */}
                        {villagePrices(a).map((v) => (
                          <span key={v.slug} className="text-muted-foreground"> · {v.amount} {v.name}/night</span>
                        ))}
                        {tiered && audience === "member" && (
                          <span className="ml-1 text-[10px] bg-teal-deep/10 text-teal-deep px-1.5 py-0.5 rounded-full">member rate</span>
                        )}
                      </p>
                      {tiered && (
                        <p className="text-xs text-muted-foreground">
                          {audience === "member"
                            ? <>Visitors pay {formatTokenAmount(guestCredit, stayScale)} credit(s)/night.</>
                            : <>Members pay {formatTokenAmount(memberCredit, stayScale)} credit(s)/night.</>}
                        </p>
                      )}
                      {user ? (
                        requesting === a.id ? (
                          <div className="space-y-2">
                            <input type="date" value={arriveOn} onChange={(e) => setArriveOn(e.target.value)}
                              className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                              placeholder="Anything the stewards should know?"
                              className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                            <div className="flex gap-2">
                              <button onClick={() => request(a.id)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium">
                                <Send className="w-3.5 h-3.5" /> Send request
                              </button>
                              <button onClick={() => setRequesting("")} className="text-sm text-muted-foreground px-2">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => setRequesting(a.id)}
                              className="flex-1 text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium">
                              Request a stay
                            </button>
                            {data?.stripeConfigured && credit && money ? (
                              <div className="flex items-center gap-1">
                                {/* Clamp BOTH ends here: the max attribute
                                    only bounds the spinner, so typing 999
                                    used to fail after the click instead of
                                    before it. */}
                                <input type="number" min={1} max={data?.maxPurchaseNights ?? 60} value={buyNights}
                                  aria-label="Nights of credits to buy"
                                  onChange={(e) => setBuyNights(Math.min(data?.maxPurchaseNights ?? 60, Math.max(1, Number(e.target.value) || 1)))}
                                  className="w-14 text-sm border border-border rounded-lg px-2 py-2" title="Nights" />
                                <button onClick={() => checkout(a.id)} title={`Buy ${buyNights} night(s) of credits`}
                                  className="inline-flex items-center gap-1.5 text-sm border border-teal-deep text-teal-deep rounded-lg px-3 py-2 font-medium hover:bg-teal-deep/5">
                                  <CreditCard className="w-3.5 h-3.5" /> Buy
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )
                      ) : (
                        <p className="text-xs text-muted-foreground">Sign in to request a stay or buy credits.</p>
                      )}
                      {refusedRoom && refusedRoom.id === a.id && (
                        <ExampleRefusal message={refusedRoom.message} className="mt-2" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {data && data.accommodations.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">No rooms posted yet. Check back soon.</p>
          )}

          {(data?.earnQuests ?? []).length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Hammer className="w-4 h-4 text-teal-deep" />
                <p className="font-semibold text-foreground text-sm">Earn your nights</p>
              </div>
              <div className="space-y-2">
                {data.earnQuests.map((q: any) => (
                  <Link key={q.id} href="/quests" className="block text-sm text-muted-foreground hover:text-foreground">
                    <span className="font-medium text-foreground">{q.title}</span>
                    {q.stayCreditReward > 0 && <>: {formatTokenAmount(q.stayCreditReward, stayScale)} stay credit(s) on consent</>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
