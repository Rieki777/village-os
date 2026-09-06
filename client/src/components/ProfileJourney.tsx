import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Heart, ScrollText, ShieldCheck, Users } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { useTokenNameLower } from "@/hooks/useTokenNames";
import Celebration from "@/components/natural/Celebration";
import BreathingLoader from "@/components/natural/BreathingLoader";
import { useMomentWindow } from "@/components/natural/moments";
import { capabilityLabel } from "@shared/capabilities";
import { villageMoonLabel } from "@shared/villageMoon";
import { claimMoment } from "@/lib/celebrated";
import { playMoment } from "@/lib/sound";
import { onProfileRefresh } from "@/lib/profileRefresh";
import { formatTokenAmount } from "@/lib/tokenAmount";

/**
 * S4: the member's journey in numbers, over three live endpoints that had no
 * page (/api/game/progression, /gratitude/flows, /ledger). Complements
 * GameDashboard (stage ladder, balance, next action) with the parts it does
 * not show: stage HISTORY, capabilities and roles held, recognition breadth,
 * per-cycle settlements, and the ledger provenance of every point of value.
 */

/**
 * One read, and WHICH OF THE THREE THINGS HAPPENED.
 *
 * `authedGet` below answered null for a signed-out reader, a 500 and a
 * dropped connection alike, which is why this page could not tell a member
 * with nothing yet from a member whose data did not arrive. `state` keeps
 * them apart:
 *
 *   ok      the server answered, and `data` is what it said
 *   none    there is no session, so there was nothing to ask for
 *   failed  the ask was made and did not come back
 */
type Read = { state: "ok"; data: any } | { state: "none" } | { state: "failed" };

async function authedRead(path: string): Promise<Read> {
  // `authToken()` reads localStorage, which THROWS rather than returning null
  // in a browser with site data blocked. That throw used to escape into the
  // Promise.all below as a rejection, which is the fail-fast path that took
  // all three sections down together.
  let token: string | null = null;
  try {
    token = authToken();
  } catch {
    return { state: "failed" };
  }
  if (!token) return { state: "none" };
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { state: "failed" };
    return { state: "ok", data: await res.json() };
  } catch {
    return { state: "failed" };
  }
}

async function authedGet(path: string): Promise<any | null> {
  const r = await authedRead(path);
  return r.state === "ok" ? r.data : null;
}

function prettySource(s: string): string {
  return String(s ?? "").replace(/[_:]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A BLOSSOM FOR BEING THANKED, and the restraint that keeps it worth seeing.
 *
 * Two things arrive as `gratitude` and only one of them is rare. A written
 * acknowledgment has to carry a message, so receiving one is somebody sitting
 * down and saying why. (This comment used to add "capped at ONE per sender per
 * recipient per lunar cycle". R73 retired that cap: a count cap bounded how
 * OFTEN one member acknowledged another and never how MUCH, so it is a share
 * of the giver's allowance now and the same person can be thanked twice. The
 * bloom's rarity was never resting on it: the two guards below are what hold
 * it.) A heart is a tap on a forum post, five per sender per cycle,
 * and `feed.hearts_on_wall` already defaults false on the reasoning that a
 * tap is a gesture. Celebrating the tap would spend the bloom on the cheaper
 * thing within a week, so `kind === "heart"` is filtered out here and gets
 * nothing.
 *
 * ONE PER VISIT, AT MOST. Only the newest unseen acknowledgment is offered,
 * so a member returning after ten thank-yous sees one bloom rather than ten.
 * `claimMoment` then holds it to once ever for that entry.
 */
function useGratitudeBloom(): { name: string; message: string } | null {
  const [bloom, setBloom] = useState<{ name: string; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    authedGet("/api/game/gratitude/me").then((data) => {
      if (!live || !data) return;
      const newest = (data.received ?? []).find((g: any) => g?.kind !== "heart");
      if (!newest?.id || !claimMoment(`gratitude:${newest.id}`)) return;
      setBloom({ name: String(newest.fromName ?? "Someone"), message: String(newest.message ?? "") });
      playMoment("gratitude", "tap");
    });
    return () => {
      live = false;
    };
  }, []);

  return bloom;
}

/**
 * THE FIRST TIME, THREE TIMES, FOR ONE PERSON.
 *
 * Stage crossings are recorded and shown. These three are the moments the
 * engine has always been able to answer and nobody ever asked it for: the
 * first vote somebody cast, the first objection they named, the first seat
 * they held. All derived on the read, none stored, and exact rather than
 * approximate (`cast_at` does not move when a vote is changed).
 *
 * R55, and this surface is where it would be easiest to break. There is no
 * count of anything, no total, no streak, no "you have voted in 3 of 11", and
 * no comparison with another member. It says WHEN, and only for the reader.
 * A member who has done none of these gets no section at all rather than
 * three empty rows, and a member who has done one gets that one: an absence
 * here is a person early in their own story and never a person behind.
 *
 * Deliberately not a badge. Badges are public artefacts and these are private
 * milestones; putting one through the other is how a first vote turns into
 * something members can rank each other by.
 */
function FirstTimes({ firsts }: { firsts?: { vote?: string | null; objection?: string | null; seat?: string | null } | null }) {
  const rows = [
    { key: "vote", label: "The first time you voted", at: firsts?.vote },
    { key: "objection", label: "The first objection you named", at: firsts?.objection },
    { key: "seat", label: "The first seat you held", at: firsts?.seat },
  ].filter((r) => !!r.at);
  if (rows.length === 0) return null;
  return (
    <div className="mb-5 border-b border-border pb-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">The first time</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 text-sm">
            <span className="mt-1.5 w-2 h-2 rounded-full bg-notice shrink-0" />
            <span>
              <span className="text-card-foreground">{r.label}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {new Date(String(r.at)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The three reads, in the order they are drawn. */
const SECTIONS = [
  { key: "prog", path: "/api/game/progression", label: "Your Progression" },
  { key: "flows", path: "/api/game/gratitude/flows", label: "Recognition Flows" },
  { key: "ledger", path: "/api/game/ledger", label: "Where It Came From" },
] as const;

export default function ProfileJourney() {
  const [prog, setProg] = useState<any | null>(null);
  const [flows, setFlows] = useState<any | null>(null);
  const [ledger, setLedger] = useState<any | null>(null);
  const bloom = useGratitudeBloom();
  const blooming = useMomentWindow(bloom !== null);
  const [settled, setSettled] = useState(false);
  /** Which of the three did not come back. Named, so the page can say so. */
  const [failed, setFailed] = useState<string[]>([]);
  const tokenNameLower = useTokenNameLower();

  /**
   * THREE READS THAT NO LONGER SHARE A FATE.
   *
   * This was `Promise.all([...]).finally(...)` with no `.catch`, and
   * `Promise.all` fails fast: one rejection abandoned the other two
   * regardless of whether they had already answered, left all three states
   * null, and the component returned null. A member lost stage history,
   * recognition flows AND the ledger because one of the three was slow to
   * fail. `allSettled` waits for all three and reports each one separately,
   * so a section draws whenever its own read landed.
   */
  const load = (quiet = false) => {
    // `quiet` re-reads without dropping back to the loader, which is what a
    // refresh after a write on the same page wants.
    if (!quiet) setSettled(false);
    setFailed([]);
    Promise.allSettled(SECTIONS.map((s) => authedRead(s.path))).then((results) => {
      const read = (i: number): Read =>
        results[i]?.status === "fulfilled"
          ? (results[i] as PromiseFulfilledResult<Read>).value
          : { state: "failed" };
      const reads = SECTIONS.map((_, i) => read(i));
      setProg(reads[0].state === "ok" ? reads[0].data : null);
      setFlows(reads[1].state === "ok" ? reads[1].data : null);
      setLedger(reads[2].state === "ok" ? reads[2].data : null);
      setFailed(SECTIONS.filter((_, i) => reads[i].state === "failed").map((s) => s.label));
      setSettled(true);
    });
  };

  useEffect(() => {
    load();
  }, []);
  // A write elsewhere on the sheet changes the ledger and the flows.
  useEffect(() => onProfileRefresh(() => load(true)), []);

  // Waiting, said as a breath. The page showed nothing at all until all three
  // reads landed, which on a slow connection is a profile that looks empty
  // and then fills. `settled` is what keeps this from becoming a permanent
  // loader for a signed-out reader, whose three reads resolve to null.
  if (!settled) {
    return (
      <div className="flex justify-center py-12">
        <BreathingLoader label="Reading your journey" size={44} showLabel />
      </div>
    );
  }

  // Nothing landed and nothing failed: a reader with no session. Silence is
  // the right answer for that one, and only that one.
  if (!prog && !flows && !ledger && failed.length === 0) return null;

  return (
    <div className="space-y-8">
      {/*
        WHAT DID NOT ARRIVE, SAID OUT LOUD, with the one control that can do
        anything about it. Before this the sections simply were not drawn, so
        a failed read and an empty account looked identical, and the page's
        own promise ("every point of value, from the ledger itself") quietly
        became false. `role="status"` announces it, which is item 9 for this
        card. Semantic pair, not the stone/white pair the cards below use:
        this banner sits on the page's own themed background.
      */}
      {failed.length > 0 && (
        <div
          role="status"
          className="rounded-2xl border border-border bg-muted px-5 py-4 text-sm text-muted-foreground"
        >
          <p>
            Could not load: {failed.join(", ")}. The rest of your journey is below.{" "}
            <button
              type="button"
              onClick={() => load()}
              className="min-h-11 font-medium text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        </div>
      )}
      {/* Progression: capabilities, roles, and the history of stage turns */}
      {prog && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl shadow-lg p-8"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-notice" />
            <h2 className="text-2xl font-display font-bold text-card-foreground">Your Progression</h2>
          </div>

          {(prog.capabilities?.length > 0 || prog.roles?.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-5">
              {/* THE ROLE'S OWN NAME, which the seed has always carried.
                  This ran `prettySource` over the ID and printed
                  "Founders-Circle", because a prettifier can title-case an
                  id and can never learn where the words break. The payload
                  sends `{ id, name }` now, so the chip reads the name a
                  founder typed and the id stays as the title for the one
                  reader who wants it. */}
              {(prog.roles ?? []).map((r: { id: string; name: string }) => (
                <span key={r.id} title={r.id} className="inline-flex items-center gap-1 text-xs bg-muted text-notice border border-notice/60 px-2.5 py-1 rounded-full font-medium">
                  <Users className="w-3 h-3" /> {r.name}
                </span>
              ))}
              {/* WHAT A MEMBER CAN DO, IN WORDS. These rendered the raw keys,
                  in monospace, under a heading promising to say what somebody
                  had unlocked: eleven chips reading `map.viewPeople` and
                  `forum.post` at a person who has never seen a capability key
                  and never should. `capabilityLabel` is the same function the
                  stage-crossing line two blocks down already uses for exactly
                  this, so the page held the answer and used it in one place
                  out of two. The key stays as the title, for the one reader
                  who wants it. */}
              {(prog.capabilities ?? []).map((c: string) => (
                <span key={c} className="inline-flex items-center gap-1 text-xs bg-teal-deep/10 text-foreground px-2.5 py-1 rounded-full" title={c}>
                  <ShieldCheck className="w-3 h-3" /> {capabilityLabel(c)}
                </span>
              ))}
            </div>
          )}

          <FirstTimes firsts={prog.firsts} />

          {(prog.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your stage turns will be recorded here. Each one names what it unlocked.
            </p>
          ) : (
            <ol className="space-y-3">
              {prog.history.map((h: any, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-teal-deep shrink-0" />
                  <div>
                    <span className="font-medium text-card-foreground">
                      {prettySource(h.fromStage)} → {prettySource(h.toStage)}
                    </span>
                    {h.reason && <span className="text-muted-foreground">: {h.reason}</span>}
                    {/* An array interpolated straight into JSX rendered as
                        `forum.post,message.send`. The same labels the stage
                        celebration reads turn it back into language. */}
                    {Array.isArray(h.unlocked) && h.unlocked.length > 0 && (
                      <span className="block text-xs text-foreground mt-0.5">
                        Unlocked: {h.unlocked.map(capabilityLabel).join(", ")}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {new Date(h.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </motion.div>
      )}

      {/* Recognition flows: breadth over volume, and per-cycle settlements */}
      {flows && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card rounded-2xl shadow-lg p-8"
        >
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-5 h-5 text-destructive" />
            <h2 className="text-2xl font-display font-bold text-card-foreground">Recognition Flows</h2>
            {blooming && bloom && (
              <span className="ml-auto shrink-0">
                <Celebration
                  kind="blossom"
                  intensity="moment"
                  size={64}
                  message={`${bloom.name} thanked you.`}
                />
              </span>
            )}
          </div>
          {bloom && (
            <div className="mb-5 rounded-xl border border-destructive/70/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-semibold text-card-foreground">{bloom.name} thanked you</p>
              {bloom.message && <p className="text-sm text-muted-foreground mt-0.5">{bloom.message}</p>}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="text-center bg-teal-deep/5 rounded-xl py-4">
              <p className="text-2xl font-display font-bold text-card-foreground">{flows.totals?.received ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">received</p>
            </div>
            <div className="text-center bg-teal-deep/5 rounded-xl py-4">
              <p className="text-2xl font-display font-bold text-card-foreground">{flows.totals?.sent ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">sent</p>
            </div>
            <div className="text-center bg-muted rounded-xl py-4" title="How many different people have thanked you. Breadth is the real signal of community health">
              <p className="text-2xl font-display font-bold text-notice">{flows.totals?.distinctAcknowledgers ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">people thanked you</p>
            </div>
          </div>
          {(flows.byCycle ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">By moon</p>
              <div className="space-y-1.5">
                {/*
                  The row is keyed by the stored cycle id and LABELLED by the
                  village's own moon. A key is machinery and a label is a
                  sentence to a member; this row used to print the key.
                */}
                {flows.byCycle.slice(0, 6).map((c: any) => (
                  <div key={c.cycleId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm border border-border rounded-lg px-3 py-2">
                    {/*
                      A row whose stored id this build cannot place gets no
                      moon, and the honest thing to print there is that it has
                      none. The old id in its place would be a leak, and a
                      blank span would read as a rendering fault.
                    */}
                    <span className="text-muted-foreground text-xs">{villageMoonLabel(c.moon) || "Moon not known"}</span>
                    <span className="text-card-foreground">
                      {c.received} received · {c.distinctSenders} sender{c.distinctSenders === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Ledger: where every point of value came from */}
      {ledger && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card rounded-2xl shadow-lg p-8"
        >
          <div className="flex items-center gap-2 mb-1">
            <ScrollText className="w-5 h-5 text-notice" />
            <h2 className="text-2xl font-display font-bold text-card-foreground">Where It Came From</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Every movement of {ledger.currency ?? "recognition"} on your account, from the ledger itself.
          </p>
          {(ledger.entries ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Consented quests and received {tokenNameLower} will appear here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {ledger.entries.slice(0, 12).map((e: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm border border-border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-card-foreground">
                      {prettySource(e.source)}
                      {/* 0092: a send names the other person. Without it the
                          line reads as a bare number with a caption and no
                          counterpart, on the one surface whose job is to make
                          a balance explainable. */}
                      {e.withName && (
                        <span className="text-muted-foreground">{e.amount < 0 ? ` to ${e.withName}` : ` from ${e.withName}`}</span>
                      )}
                    </span>
                    {e.description && (
                      <span className="block text-xs text-muted-foreground truncate">{e.description}</span>
                    )}
                  </div>
                  {/* MINOR UNITS. `amount` is `token_ledger.amount` verbatim,
                      so a Village Voice row reading 10000 is ten, and this feed
                      printed ten thousand. The sign is taken before formatting
                      so a negative renders "-0.5" and never "-0.-5". See
                      client/src/lib/tokenAmount.ts. */}
                  <span className={`shrink-0 font-semibold ${e.amount < 0 ? "text-destructive" : "text-foreground"}`}>
                    {e.amount > 0 ? "+" : e.amount < 0 ? "-" : ""}
                    {formatTokenAmount(Math.abs(Number(e.amount)), Number(e.decimals ?? 0))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
