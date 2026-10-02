/**
 * THE JOURNAL, at /journal: one member's own practice.
 *
 * Four tabs. Today is where a page is written, one question at a time. History
 * is every page, newest first. Pulse is the member's own weekly numbers and
 * the village's averages. Feedback is the kind road for what would otherwise
 * go unsaid. The words, prompts and shapes all come from shared/journal.ts,
 * which is the contract the server reads too.
 *
 * Behind the `journal` module and a session. Nothing here is ever readable by
 * anyone but its author, so a signed-out visitor gets the sign-in card and
 * nothing is fetched for them.
 *
 * OFFLINE FIRST. Saves land in the device outbox before they are sent
 * (lib/journalOutbox.ts). This page flushes it when it opens, when the browser
 * says it is back online, and when the member taps "Sync now". A page the
 * journal turned down is listed above the tabs with the journal's own
 * sentence, to be tried again or removed from the device.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { JOURNAL_PRACTICE_DEFS } from "@shared/journal";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { useVillageName } from "@/hooks/useVillageName";
import { flushOutbox, removeFromOutbox, retryEntry, type OutboxItem } from "@/lib/journalOutbox";
import TodayTab from "@/components/journal/TodayTab";
import HistoryTab from "@/components/journal/HistoryTab";
import PulseTab from "@/components/journal/PulseTab";
import FeedbackTab from "@/components/journal/FeedbackTab";
import { usePendingEntries, useRememberedChoice, useSignOutForgetsDraft } from "@/components/journal/hooks";
import { BTN_QUIET, BTN_SECONDARY, dayLabel, timeLabel } from "@/components/journal/ui";

const TABS = ["today", "history", "pulse", "feedback"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  today: "Today",
  history: "History",
  pulse: "Pulse",
  feedback: "Feedback",
};

/**
 * One page the journal turned down, with its sentence. "Try again" sends it
 * once more (a date stamped by a clock that has since been put right is
 * stamped again first); removing it asks first, because it is not in the
 * journal and nothing else holds it.
 */
function RefusedPage({ owner, item }: { owner: string; item: OutboxItem }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const e = item.entry;
  const label = `${JOURNAL_PRACTICE_DEFS[e.practice].label}, ${dayLabel(e.writtenAt)} ${timeLabel(e.writtenAt)}`.trim();

  const retry = async () => {
    setBusy(true);
    try {
      await retryEntry(owner, e.clientId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl bg-card px-3 py-3">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{item.lastError ?? "The journal did not take this page."}</p>
      {confirming ? (
        <div role="group" aria-label="Confirm removing this page" className="mt-2">
          <p className="text-sm font-semibold text-destructive">
            Remove this page from this device? It is not in your journal, so it cannot be brought back.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => removeFromOutbox(e.clientId)}>
              Yes, remove it
            </button>
            <button type="button" className={BTN_QUIET} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => void retry()} disabled={busy}>
            {busy ? "Sending..." : "Try again"}
          </button>
          <button type="button" className={BTN_QUIET} onClick={() => setConfirming(true)} disabled={busy}>
            Remove from this device
          </button>
        </div>
      )}
    </li>
  );
}

export default function Journal() {
  const { user } = useAuth();
  const modules = useModules();
  const village = useVillageName();
  const owner = user?.id ?? null;
  const journalOn = (modules.modules ?? []).some((m) => m.id === "journal" && m.lifecycle !== "off");
  const [tab, setTab] = useRememberedChoice<Tab>("village.journal.tab", TABS, "today");
  const pending = usePendingEntries(owner);
  const waiting = pending.filter((p) => !p.refused);
  const refused = pending.filter((p) => p.refused);
  const changedElsewhere = useSignOutForgetsDraft(owner);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ today: null, history: null, pulse: null, feedback: null });

  const sync = useCallback(
    async (byHand: boolean) => {
      if (!owner) return;
      setSyncing(true);
      const result = await flushOutbox(owner);
      setSyncing(false);
      if (!byHand) return;
      if (result.offline) setSyncNote("Still offline. Your pages are safe on this device.");
      else if (result.sessionEnded) setSyncNote("Your session has ended. Sign in again and your pages go to your journal.");
      else if (result.kept.length) setSyncNote("Some pages could not be sent yet. They stay on this device.");
      else if (result.refused.length) setSyncNote("The journal did not take every page. Each one says why, above.");
      else setSyncNote(result.sent.length ? "Everything is in your journal." : "Nothing was waiting.");
    },
    [owner],
  );

  // Flush on open, and again whenever the browser comes back online.
  useEffect(() => {
    if (!owner || !journalOn) return;
    void sync(false);
    const back = () => void sync(false);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [owner, journalOn, sync]);

  // The catalog is still arriving: hold the shell, ask nothing yet.
  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label="Opening your journal" />
        </div>
      </Layout>
    );
  }
  if (!journalOn) return <ModuleGate moduleId="journal" name="Journal" />;
  if (!user) return <SignInToSee moduleId="journal" name="Journal" />;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.indexOf(tab);
    let next: Tab | null = null;
    if (e.key === "ArrowRight") next = TABS[(at + 1) % TABS.length]!;
    else if (e.key === "ArrowLeft") next = TABS[(at - 1 + TABS.length) % TABS.length]!;
    else if (e.key === "Home") next = TABS[0];
    else if (e.key === "End") next = TABS[TABS.length - 1]!;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Layout>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-3xl">
          <h1 className="font-display text-4xl font-bold text-foreground">Journal</h1>
          <p className="mt-2 text-muted-foreground">
            A few good questions, answered in your own words. Only you read what you write here.
          </p>
        </div>
      </section>

      <div className="container max-w-3xl pb-16">
        {refused.length > 0 && (
          <section
            aria-label="Pages the journal did not take"
            className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
          >
            <p className="text-sm font-medium text-foreground">
              The journal did not take {refused.length === 1 ? "1 page" : `${refused.length} pages`}. Each is still on this
              device.
            </p>
            <ul className="mt-3 space-y-2">
              {refused.map((item) => (
                <RefusedPage key={item.entry.clientId} owner={user.id} item={item} />
              ))}
            </ul>
          </section>
        )}
        {waiting.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/60 bg-amber-light px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {waiting.length === 1 ? "1 page is" : `${waiting.length} pages are`} saved on this device and not yet in your
              journal.
            </p>
            <button type="button" className={BTN_SECONDARY} onClick={() => void sync(true)} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </div>
        )}
        {syncNote && (
          <p role="status" className="mb-5 text-sm text-muted-foreground">
            {syncNote}
          </p>
        )}

        {changedElsewhere ? (
          // Another tab signed out or signed in as somebody else. The open page
          // closes here, so it cannot write itself back to the device.
          <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
            The account on this device changed in another tab, so this page has closed. Reload it to carry on.
          </p>
        ) : (
          <>
            <div role="tablist" aria-label="Journal" className="mb-6 grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  ref={(el) => {
                    tabRefs.current[t] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`journal-tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`journal-panel-${t}`}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => setTab(t)}
                  onKeyDown={onTabKey}
                  className={`min-h-11 rounded-xl px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                    tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`journal-panel-${tab}`} aria-labelledby={`journal-tab-${tab}`}>
              {tab === "today" && (
                <TodayTab key={user.id} owner={user.id} village={village} onSaved={() => setSavedCount((n) => n + 1)} />
              )}
              {tab === "history" && <HistoryTab key={user.id} owner={user.id} refreshKey={savedCount} />}
              {tab === "pulse" && <PulseTab village={village} />}
              {tab === "feedback" && <FeedbackTab />}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
