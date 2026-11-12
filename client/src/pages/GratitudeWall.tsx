/**
 * THE GRATITUDE WALL: threads between people (Phase C, lane C4).
 *
 * A thanks is a thread between two people. The page opens with what we saw in
 * each other: the thanks as threads, newest first, and the web this moon
 * (faces on a ring in alphabetical order, one thread per pair). Sending is a
 * lantern: it rises while the thanks is on its way, rests when it arrives, and
 * from then on it is a thread on the web.
 *
 * ── DECISION 4, AND WHAT IT LEFT ALONE ───────────────────────────────────
 *
 * The lead's ruling: threads never show a count and never order people by how
 * many thanks they have; the newest thanks come first. So the wall no longer
 * draws an amount beside a thanks, "Where you stand" (people who thanked you,
 * totals received and given) left the wall, and Moons past lists people by
 * name. The ledger, the allowance, the cycles and settlement are untouched:
 * every send still carries its amount, and the member's own allowance stays
 * in the composer, because it is what they hold to give, never a count of
 * what anybody received.
 *
 * ── PHONE AND DESKTOP, EACH AT ITS BEST ──────────────────────────────────
 *
 * Phone: the web is a full-bleed band above the words, the words follow one
 * at a time, and "Carry a thanks" waits within thumb reach; it opens a sheet
 * (pick a face, write, send) where the lantern rises. Desktop: the words in
 * two columns beside a large web that stays put, hovering a thanks lights its
 * thread, and the composer sits under the web, so writing never leaves the
 * page. Ctrl Enter sends on both.
 *
 * ── THE NIGHT WORLD ──────────────────────────────────────────────────────
 *
 * `sheet-night` (WORLD) redeclares the semantic tokens on the root, so every
 * descendant reading `bg-card` and `text-muted-foreground` resolves them in
 * the night world. Every surface here names the semantic pair together.
 */
import Layout from "@/components/Layout";
import VoiceArea from "@/components/voice/VoiceArea";
import { Trans, useLingui } from "@lingui/react/macro";
import QuietEmpty from "@/components/quiet/QuietEmpty";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch, fetchGameMe, GameMe } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { useLadderTitle } from "@/hooks/useVillagePaths";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import CycleClock from "@/components/CycleClock";
import { forgetExamplesCache } from "@/components/ExamplesBanner";
import InfoTip from "@/components/InfoTip";
import MoonDock from "@/components/profile/MoonDock";
import NightMotes from "@/components/profile/NightMotes";
import VoicesHero from "@/components/gratitude/VoicesHero";
import HeartsRow from "@/components/gratitude/HeartsRow";
import WallEntryCard from "@/components/gratitude/WallEntryCard";
import MoonsPast from "@/components/gratitude/MoonsPast";
import SuggestionChips from "@/components/gratitude/SuggestionChips";
import ThreadWeb from "@/components/gratitude/ThreadWeb";
import Lantern from "@/components/gratitude/Lantern";
import { bothWays, newestFirst, pairKey, personKey, sinceMoment } from "@/components/gratitude/threads";
import Fireflies from "@/components/journey/nature/Fireflies";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, H1, HINT, LEDE, WORLD } from "@/components/journey/look";
import type { WallEntry } from "@shared/gratitudeVoices";

interface SentEntry {
  toId?: string | null;
  cycleId?: string | null;
}

/**
 * Wide enough for the desktop layout (`lg`), where the composer sits in the
 * page and is never a sheet. Read once and on change; false until known, so a
 * phone never flashes a desktop composer.
 */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return wide;
}

/** The recipient a link asked for, as typed: `/gratitude?to=@handle`. Empty when none. */
function prefilledTo(): string {
  try {
    return (new URLSearchParams(window.location.search).get("to") ?? "").trim().slice(0, 80);
  } catch {
    return "";
  }
}

export default function GratitudeWall() {
  const { t } = useLingui();
  const { user } = useAuth();
  const wide = useWide();
  // Null until the first read lands: an empty array is a claim that the wall is empty.
  const [wall, setWall] = useState<WallEntry[] | null>(null);
  // undefined = not loaded (or the load failed); null = loaded, no game state.
  // fetchGameMe returns null for BOTH a 500 and a real absence, so without
  // this distinction a failed fetch rendered as a factual claim about the
  // member's standing ("your budget unlocks as you progress") when in truth
  // they may have had a full budget all along.
  const [me, setMe] = useState<GameMe | null | undefined>(undefined);
  /**
   * Distinct people this member has thanked this cycle, which is what the
   * hearts in the composer show: their own allowance, never what anybody
   * received. Null means UNKNOWN and the row stays away.
   */
  const [peopleThanked, setPeopleThanked] = useState<number | null>(null);
  /** When this moon began, so the web draws this moon's threads. Null until known. */
  const [moonStart, setMoonStart] = useState<string | null>(null);
  const currency = useTokenName("Recognition");
  const ladder = useLadderTitle();
  // `to` carries whatever the member typed: an @handle, or an address for
  // anyone who still knows one. The server tells the two apart and looks the
  // handle up; see `recipientFor` in server/index.ts.
  // `?to=@handle` fills the field (My moon's Send gratitude). Nothing sends until the member does.
  const [form, setForm] = useState(() => ({ to: prefilledTo(), amount: 10, message: "" }));
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  /** The lantern: on its way while a send is in flight, then arrived. Null shows the form. */
  const [lantern, setLantern] = useState<{ moment: "carrying" | "arrived"; toName: string } | null>(null);
  /** The pair whose thread just landed, drawn in once on the web. */
  const [fresh, setFresh] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  // Bumped after a send so the chips re-read and the person just thanked leaves.
  const [sentCount, setSentCount] = useState(0);
  /** The phone's sheet. On a desktop the composer is always in the page. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const carryButton = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const touchY = useRef<number | null>(null);

  const myKey = user?.handle ? personKey({ name: user.name ?? "", handle: user.handle.replace(/^@/, ""), avatar: null }) : null;

  /* The one thing on this form the village decides. See the textarea below. */
  const [requireMessage, setRequireMessage] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    gameFetch("/api/game/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setRequireMessage(Boolean(d?.gratitude?.requireMessage));
      })
      .catch(() => {
        /* stays optional, which is the server's own default posture */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* The moon's start, from the one public clock route. The web waits for it. */
  useEffect(() => {
    let alive = true;
    fetch("/api/game/cycle")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.startsAt === "string") setMoonStart(d.startsAt);
      })
      .catch(() => {
        /* no web this visit; the words below still render */
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The people this member has thanked this cycle, for the hearts.
   *
   * A FUNCTION, called after every send: as an effect keyed on the member and
   * the cycle it never re-ran after a send (neither changes), and the row sat
   * at its old count until a reload.
   */
  const loadPeopleThanked = (cycleId: string | undefined) => {
    if (!user || !cycleId) return;
    gameFetch("/api/game/gratitude/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.sent)) return;
        const ids = new Set(
          (d.sent as SentEntry[])
            .filter((s) => s.cycleId === cycleId && s.toId)
            .map((s) => String(s.toId)),
        );
        setPeopleThanked(ids.size);
      })
      .catch(() => { /* the row stays as it was rather than guessing */ });
  };

  const load = (afterSend = false) => {
    fetch("/api/game/gratitude/wall")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const rows = newestFirst(Array.isArray(d) ? (d as WallEntry[]) : []);
        setWall(rows);
        // The thread the lantern became: the newest thanks, when it is ours.
        const top = rows[0];
        if (afterSend && top && myKey && personKey(top.from) === myKey) setFresh(pairKey(top.from, top.to));
      })
      .catch(() => setWall((w) => w ?? []));
    // The count is re-read from whatever budget comes BACK, so a send that
    // moves the cycle boundary still counts against the right lunation.
    fetchGameMe().then((fresh) => {
      setMe(fresh);
      loadPeopleThanked(fresh?.gratitude.budget?.cycleId);
    });
  };

  useEffect(() => load(), []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setFeedback(null);
    const typed = form.to.trim();
    // The name the lantern carries toward: the person's first name when the
    // wall already knows the handle, otherwise what was typed.
    const handle = typed.replace(/^@/, "").toLowerCase();
    const known = (wall ?? []).flatMap((w) => [w.from, w.to]).find((p) => p.handle?.toLowerCase() === handle);
    setLantern({ moment: "carrying", toName: known ? known.name.trim().split(/\s+/)[0] ?? handle : handle });
    try {
      const res = await gameFetch("/api/game/gratitude/send", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setLantern(null);
        setFeedback({ ok: false, text: data.message ?? data.error ?? t({ message: "Something went wrong", context: "thanks send: an unknown failure" }) });
      } else {
        const toName = String(data?.entry?.toName ?? "").trim().split(/\s+/)[0] || typed.replace(/^@/, "");
        setLantern({ moment: "arrived", toName });
        setForm({ to: "", amount: 10, message: "" });
        // A real send is gratitude's retirement trigger server-side; this is a
        // cache hint and the next read corrects it.
        forgetExamplesCache("gratitude");
        setSentCount((n) => n + 1);
        load(true);
      }
    } catch {
      setLantern(null);
      setFeedback({ ok: false, text: t({ message: "Something went wrong. Try again.", context: "thanks send: the request failed" }) });
    }
    setSending(false);
  };

  /** Ctrl Enter (or Cmd Enter) sends from anywhere in the composer. */
  const onComposerKey = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  };

  const budget = me?.gratitude.budget;

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    carryButton.current?.focus();
  }, []);

  /*
   * The gratitude nudge links to `#send`, and My moon's "Send gratitude"
   * arrives with `?to=`. Either way the member came to carry a thanks: on a
   * phone the sheet opens, on a desktop the composer scrolls into view.
   */
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const asked = window.location.hash === "#send" || prefilledTo() !== "";
    if (!asked) return;
    if (window.matchMedia?.("(min-width: 1024px)").matches) {
      document.getElementById("send")?.scrollIntoView({ block: "start" });
    } else {
      setSheetOpen(true);
    }
  }, [user]);

  /* The sheet holds focus while it is open, and Escape puts it away. */
  useEffect(() => {
    if (!sheetOpen || wide) return;
    const el = sheet.current;
    el?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, wide, closeSheet]);

  const mutual = useMemo(() => bothWays(wall ?? []), [wall]);
  const thisMoon = useMemo(() => sinceMoment(wall ?? [], moonStart), [wall, moonStart]);
  const asSheet = !wide;
  const sheetHidden = asSheet && !sheetOpen;

  const web = (className: string) =>
    thisMoon.length > 0 ? (
      <ThreadWeb entries={thisMoon} lit={lit} fresh={fresh} me={myKey} className={className} />
    ) : (
      <p className={`${HINT} py-6 text-center`}>
        {t({ message: "No threads yet this moon. The first thanks carried draws one.", context: "thanks web: nothing this moon yet" })}
      </p>
    );

  const anotherLabel = t({ message: "Carry another thanks", context: "thanks composer: after the lantern arrived" });

  return (
    <Layout>
      {/*
        `relative` is load-bearing: NightMotes measures this element. MoonDock
        renders its own fixed layer and is placed last for source order, so a
        keyboard reaches the wall before it reaches an ornament.
      */}
      <div className={`${WORLD} py-10 sm:py-14`}>
        <NightMotes />
        <div className="relative container mx-auto max-w-3xl px-4 lg:max-w-6xl">
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-10">
            <div className="min-w-0">
              <header className="mb-8">
                <p className={EYEBROW}>{t({ message: "Thanks between us", context: "thanks wall eyebrow" })}</p>
                <h1 className={`${H1} mt-2`}>{t({ message: "What we saw in each other", context: "thanks wall heading" })}</h1>
                <p className={`${LEDE} mt-3`}>
                  {t({ message: "Each thanks is a thread between two people. The wall keeps the words and never a count.", context: "thanks wall lede" })}
                </p>
                {/* What sending is, said once: thanks, never pay. */}
                <p className={`${HINT} mt-3 max-w-prose`}>
                  <Trans context="thanks wall: what a thanks becomes">
                    Every thanks here also carries <InfoTip tip={t({ message: `Each cycle every member receives an allowance of ${currency.toLowerCase()} to send. Sending is thanks for real contributions, never pay, and the wall keeps every word.`, context: "thanks wall: the currency tooltip" })}>{currency.toLowerCase()}</InfoTip> to the person it names.
                  </Trans>
                </p>
              </header>

              {/* The phone's web: a full-bleed band above the words. */}
              {wall && wall.length > 0 && (
                <section aria-labelledby="web-phone-h" className="-mx-4 mb-8 border-y border-border bg-card/40 px-2 py-4 lg:hidden">
                  <h2 id="web-phone-h" className={`${EYEBROW} px-2 text-open`}>{t({ message: "The web this moon", context: "thanks web heading" })}</h2>
                  {web("mx-auto mt-2 max-w-sm")}
                  <p className={`${HINT} px-2 text-center`}>
                    {t({ message: "Faces sit in alphabetical order, and nobody sees how many threads anyone holds.", context: "thanks web: how to read it" })}
                  </p>
                </section>
              )}

              {wall === null ? null : wall.length === 0 ? (
                <>
                  {/* An empty wall still opens with words: the hero's labelled examples. */}
                  <VoicesHero />
                  {/* An empty ring of places, nobody named yet, and one door: to the
                      composer for a member, none for a visitor, whose sign-in
                      door already sits above the wall (components/quiet). */}
                  <QuietEmpty
                    drawing="ring"
                    title={t`No thanks on the wall yet`}
                    door={user ? { label: t({ message: "Carry a thanks", context: "empty thanks wall: door to the thank-you form" }), href: "#send" } : undefined}
                    className="justify-center"
                  >
                    {t`The wall is waiting for its first appreciation.`}
                  </QuietEmpty>
                </>
              ) : (
                <section aria-label={t({ message: "The thanks, newest first", context: "thanks wall: the list of threads" })}>
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    {wall.map((w) => {
                      const key = pairKey(w.from, w.to);
                      return (
                        <WallEntryCard
                          key={w.id}
                          entry={w}
                          mutual={mutual.has(key)}
                          lit={wide && lit === key}
                          onLight={wide ? (on) => setLit(on ? key : null) : undefined}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {/* The clock the economy runs on, and the chronicle of moons it closed. */}
              <div className="mt-12"><CycleClock /></div>
              <MoonsPast currency={currency} />
            </div>

            {/* The desktop's persistent side: the web, then the composer under it. */}
            <aside className="contents lg:sticky lg:top-6 lg:block lg:max-h-[calc(100svh-3rem)] lg:space-y-6 lg:overflow-y-auto lg:pb-2">
              <section aria-labelledby="web-desk-h" className="hidden rounded-2xl border border-border bg-card p-6 shadow-sm lg:block">
                <h2 id="web-desk-h" className={`${EYEBROW} text-open`}>{t({ message: "The web this moon", context: "thanks web heading" })}</h2>
                {web("mt-3")}
                <p className={`${HINT} mt-2`}>
                  {t({ message: "Hover a thanks and its thread lights. Faces sit in alphabetical order, and nobody sees how many threads anyone holds.", context: "thanks web: how to read it, desktop" })}
                </p>
              </section>

              {user ? (
                <>
                  {asSheet && sheetOpen && (
                    <div className="fixed inset-0 z-[65] bg-background/70 lg:hidden" aria-hidden="true" onClick={closeSheet} />
                  )}
                  <div
                    ref={sheet}
                    role={asSheet ? "dialog" : undefined}
                    aria-modal={asSheet && sheetOpen ? true : undefined}
                    aria-labelledby="carry-h"
                    inert={sheetHidden ? true : undefined}
                    data-testid="composer"
                    data-sheet={asSheet ? (sheetOpen ? "open" : "closed") : "page"}
                    onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null; }}
                    onTouchEnd={(e) => {
                      const start = touchY.current;
                      const end = e.changedTouches[0]?.clientY;
                      touchY.current = null;
                      // A swipe down from near the top of the sheet puts it away.
                      if (asSheet && start != null && end != null && end - start > 80 && (sheet.current?.scrollTop ?? 0) <= 0) closeSheet();
                    }}
                    className={`fixed inset-x-0 bottom-0 z-[70] max-h-[88svh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-8 pt-3 shadow-sm transition-transform duration-500 ease-out motion-reduce:transition-none ${sheetOpen ? "translate-y-0" : "translate-y-full"} lg:static lg:z-auto lg:max-h-none lg:translate-y-0 lg:overflow-visible lg:rounded-2xl lg:border lg:p-6 lg:transition-none`}
                  >
                    {/* The phone's sheet: a grab handle to swipe, and a close within the thumb's reach. */}
                    <div className="mb-2 grid grid-cols-[2.75rem_1fr_2.75rem] items-center lg:hidden">
                      <span />
                      <span aria-hidden="true" className="mx-auto block h-1.5 w-11 rounded-full bg-border" />
                      {asSheet && (
                        <button type="button" onClick={closeSheet} className={`${BTN_SECONDARY} px-0`} aria-label={t({ message: "Close", context: "thanks composer: close the sheet" })}>
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h2 id="carry-h" className={`${EYEBROW}`}>{t({ message: "Carry a thanks", context: "thanks composer heading" })}</h2>
                      {/*
                        The allowance: what the member holds to give this cycle.
                        `flex-wrap` and a gap, because at 390px the heading and
                        this line ran into each other with no space.
                      */}
                      {budget && budget.total > 0 ? (
                        <span className="text-sm text-muted-foreground">
                          <Trans context="thanks composer: the allowance left this cycle">
                            <span className="font-semibold text-card-foreground">{budget.remaining}</span> of {budget.total} left to give this cycle
                          </Trans>
                          <InfoTip tip={t({ message: "Your allowance refills when the cycle turns. Sending moves it from your allowance to the person you thank; it never costs you anything you earned.", context: "thanks composer: the allowance tooltip" })} label={t({ message: "How the allowance works", context: "thanks composer: tooltip label" })} />
                        </span>
                      ) : budget && budget.total <= 0 ? (
                        <span className="text-xs italic text-muted-foreground">
                          {t({ message: `Your allowance to give opens as you walk the ${ladder}.`, context: "thanks composer: no allowance yet" })}
                        </span>
                      ) : me === undefined ? null : (
                        <span className="text-xs italic text-muted-foreground">
                          {t({ message: "Your allowance didn't load. Reload to see it.", context: "thanks composer: allowance failed to load" })}
                        </span>
                      )}
                    </div>

                    {lantern ? (
                      <div aria-live="polite">
                        <Lantern
                          moment={lantern.moment}
                          toName={lantern.toName}
                          after={t({ message: "It is a thread on the web now, and they see it on their profile.", context: "lantern: after it arrived" })}
                        />
                        {lantern.moment === "arrived" && (
                          <div className="mt-4 flex flex-wrap justify-center gap-3">
                            <button type="button" className={BTN_SECONDARY} onClick={() => setLantern(null)}>{anotherLabel}</button>
                            {asSheet && (
                              <button type="button" className={BTN_SECONDARY} onClick={() => { setLantern(null); closeSheet(); }}>
                                {t({ message: "Back to the wall", context: "thanks composer: close after sending" })}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <form id="send" onSubmit={send} onKeyDown={onComposerKey} className="scroll-mt-20">
                        {/* One heart, one person: the member's own allowance. */}
                        {budget && budget.total > 0 && peopleThanked !== null && (
                          <HeartsRow people={peopleThanked} fullSends={budget.fullSends} cap={budget.cap} />
                        )}

                        {/* One tap fills the field below; the Send button still sends. */}
                        <SuggestionChips selected={form.to} onPick={(to) => setForm({ ...form, to })} refreshKey={sentCount} />

                        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_110px]">
                          <input
                            // type="text", and that IS the fix: `type="email"`
                            // made the browser refuse a handle.
                            type="text"
                            required
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={form.to}
                            onChange={(e) => setForm({ ...form, to: e.target.value })}
                            aria-label={t({ message: "Who you are thanking, by handle", context: "thanks composer: recipient field" })}
                            placeholder={t({ message: "Their @handle", context: "thanks composer: recipient placeholder" })}
                            className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                          />
                          <input
                            type="number"
                            min={1}
                            required
                            // From the live currency name, so a fork that renames its token gets the right label.
                            aria-label={t({ message: `Amount of ${currency.toLowerCase()} to send`, context: "thanks composer: amount field" })}
                            value={form.amount}
                            onChange={(e) => setForm({ ...form, amount: parseInt(e.target.value) || 1 })}
                            className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        {/*
                          THE VILLAGE'S OWN SETTING, NOT A HARDCODED TRUE. The
                          server gates this on `gratitude.require_message`, and
                          /api/game/rules carries the answer. Null while in
                          flight means OPTIONAL, matching the server's posture.
                        */}
                        <VoiceArea
                          value={form.message}
                          onValue={(v) => setForm((f) => ({ ...f, message: v }))}
                          talk={{
                            label: t({ message: "Your thank you", context: "voice field label: the thank-you note on the wall" }),
                            purpose: t({ message: "A short note thanking someone for what they did and what it meant to you.", context: "voice field purpose: the thank-you note on the wall" }),
                          }}
                        >
                        <textarea
                          required={requireMessage === true}
                          value={form.message}
                          onChange={(e) => setForm({ ...form, message: e.target.value })}
                          aria-label={t({ message: "What you saw them do", context: "thanks composer: message field" })}
                          placeholder={t({ message: "What you saw them do", context: "thanks composer: message field" })}
                          rows={3}
                          className="mb-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                        </VoiceArea>
                        {feedback && (
                          <p
                            // Announced: alert for a failure, status for a success.
                            role={feedback.ok ? "status" : "alert"}
                            className={`mb-3 text-sm ${feedback.ok ? "text-open" : "text-destructive"}`}
                          >
                            {feedback.text}
                          </p>
                        )}
                        {/* A spent allowance is a real state: say so, and stop offering the button. */}
                        {budget && budget.remaining <= 0 && budget.total > 0 && (
                          <p className="mb-3 text-sm text-notice">
                            {t({ message: "You've given your whole allowance this cycle. It refills when the lunar cycle turns.", context: "thanks composer: allowance spent" })}
                          </p>
                        )}
                        {/* An UNKNOWN budget does not disable Send: the server's guard is the authority. */}
                        <div className="flex flex-wrap items-center gap-3">
                          <Fireflies count={6} block={asSheet} className={asSheet ? "w-full" : ""}>
                            <button
                              type="submit"
                              disabled={sending || (!!budget && (budget.total <= 0 || budget.remaining <= 0))}
                              className={`${BTN_PRIMARY} ${asSheet ? "w-full" : ""}`}
                            >
                              {sending
                                ? t({ message: "Sending...", context: "thanks composer: send in flight" })
                                : t({ message: "Send the lantern", context: "thanks composer: the send button" })}
                            </button>
                          </Fireflies>
                          {/* i18n-ok: key names, the same on every keyboard */}
                          <kbd className="hidden rounded-lg border border-border px-2 py-0.5 text-xs text-muted-foreground lg:inline">Ctrl Enter</kbd>
                        </div>
                      </form>
                    )}
                  </div>

                  {/* The phone's one next act, within thumb reach. Gone while the sheet is open. */}
                  {asSheet && !sheetOpen && (
                    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.75rem)] z-50 flex justify-center px-24 lg:hidden">
                      <Fireflies count={5} block>
                        <button
                          ref={carryButton}
                          type="button"
                          onClick={openSheet}
                          aria-haspopup="dialog"
                          className={`${BTN_PRIMARY} w-full shadow-sm`}
                        >
                          {t({ message: "Carry a thanks", context: "thanks wall: opens the composer on a phone" })}
                        </button>
                      </Fireflies>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-10 rounded-2xl border border-border bg-card p-6 text-center shadow-sm lg:mt-0">
                  <p className="mb-4 text-muted-foreground">
                    {t({ message: `Sign in to carry a thanks to a fellow member.`, context: "thanks wall: signed out" })}
                  </p>
                  <Link href="/login" className={BTN_PRIMARY}>
                    {t({ message: "Sign in", context: "thanks wall: signed out door" })}
                  </Link>
                </div>
              )}
            </aside>
          </div>
        </div>
        <MoonDock />
      </div>
    </Layout>
  );
}
