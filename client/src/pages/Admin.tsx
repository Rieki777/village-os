import { useState, useEffect, useCallback, useMemo, useRef } from "react";
// Nineteen icons left this list when navGroups and CONTENT_SECTIONS moved to
// client/src/components/admin/: they were the nav's icons, not this file's.
import { Lock, Eye, EyeOff, Inbox, Circle, Trash2, ChevronDown, ChevronUp, Save, RefreshCw, LogOut, FileText, Upload, ExternalLink, ArrowUp, ArrowDown, Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { linesToList, listToLines } from "@/lib/questBoard";
import {
  CLOSE_CONSEQUENCES, closeReport, settlementBlocked, settlementIntent,
  type OpenCycle, type PendingSettlement,
} from "@/lib/settlement";
import {
  canAct, DISCLOSURE_NOTE, emptyQueueLine, reportedLine, reportPlace,
  type MessageReport, type ReportStatus,
} from "@/lib/messageReports";
import { resolutionLine } from "@/lib/reportFeedback";
import { ALL_CAPABILITIES, isDeniable } from "@shared/capabilities";
import BreathingLoader from "@/components/natural/BreathingLoader";
import { SeatSomebody } from "@/components/power/SeatSomebody";
import Celebration from "@/components/natural/Celebration";
import { useMomentWindow } from "@/components/natural/moments";
import { playMoment } from "@/lib/sound";
import { useAuth } from "@/contexts/AuthContext";
import { authToken, useGameConfig } from "@/lib/gameApi";
import { holdCancelled, swipeIntent } from "@/lib/gestures";
import { Link } from "wouter";
import { BUILDER_GUIDE_URL, MODULE_GROUPS, POOL_REASON_COPY } from "@shared/moduleCatalog";
import { filterNavByModules, TAB_MODULE, type TabBadge } from "@/lib/adminNav";
import { AdminGoLive } from "@/components/modules/GoLiveCard";
import type { ModuleLifecycle } from "@shared/modules";
import type { UploadsSweepReport } from "@shared/uploadsSweep";
import { CIRCLE_STATUSES } from "@shared/draftKinds";

import TypographyPanel from "@/components/TypographyPanel";
import LookPanel from "@/components/LookPanel";
import IdentityPackPanel from "@/components/IdentityPackPanel";
import MapSkinPanel from "@/components/MapSkinPanel";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import MapVocabularyPanel from "@/components/admin/MapVocabularyPanel";
import EventsAdminPanel from "@/components/EventsAdminPanel";
import ResourcesAdminPanel from "@/components/power/ResourcesAdminPanel";
import { CrowdpoolAdminTab, ForumCategoriesEditor, ToolsCategoriesEditor } from "@/components/admin/ModuleConfigPanels";
import { CONTENT_SECTIONS, emptyContentFor } from "@/components/admin/contentSections";
import { displayCurrencyProblem } from "@shared/money";
import InvoluntaryExitDialog from "@/components/admin/InvoluntaryExitDialog";
import ContentEditorTab from "@/components/admin/ContentEditorTab";
import WorkWithUsTab from "@/components/admin/WorkWithUsTab";
import { StepListEditor, stalePolicyTerms } from "@/components/admin/exitPolicyEditing";
import { CONNECTIONS_GROUP_TITLE, MODULES_GROUP_TITLE, navGroups, type NavGroup } from "@/components/admin/adminNavGroups";
import { IDENTITY_WIZARD_FIELDS, SETUP_STEPS, measureSetup, setupIsComplete } from "@/components/admin/setupProgress";
import TokenNamingLink from "@/components/admin/TokenNamingLink";
import TokensTab from "@/components/admin/TokensTab";
import SetupSection from "@/components/admin/SetupSection";
import HandoverTab from "@/components/admin/HandoverTab";
import VariablesTab from "@/components/admin/VariablesTab";
import VotingWeightsPanel from "@/components/admin/VotingWeightsPanel";
import RelationsEditor from "@/components/admin/RelationsEditor";
import HousingAdminPanel from "@/components/HousingAdminPanel";
import WalkEditorPanel from "@/components/WalkEditorPanel";
import { ExampleChip, ExamplesBanner, forgetExamplesCache, RETIRES_WITH } from "@/components/ExamplesBanner";
// visit-inquiry and membership-508 were missing, and they are the two highest-value
// submissions on the site: a request to walk the land, and a signed 508(c)(1)(a)
// membership. Both were reachable only by scrolling "All types". The strings are
// the ones the pages actually POST, from Visit.tsx and LoveLetter.tsx.
const FORM_TYPES = ["work-with-us", "quest-proposal", "visit-inquiry", "membership-508", "investor", "steward", "resident", "prosperity", "contact"] as const;

/**
 * THE SERVER'S OWN SENTENCE, WHEN IT HAS ONE.
 *
 * Several editors here read `res.ok` and then threw an empty Error, so every
 * refusal reached the admin as "Save failed". The routes behind them answer
 * with a written reason (why a link cannot be that link, which power was
 * missing, what a value has to be), and that reason is the only part an admin
 * can act on. A refusal nobody can read is a wall.
 *
 * Falls back to the caller's own words when the body carries nothing, so a
 * dead network still says something true.
 */
async function saveProblem(res: Response, fallback = ""): Promise<string> {
  try {
    const body = await res.json();
    const said = String(body?.error ?? body?.message ?? "").trim();
    if (said) return said;
  } catch {
    /* a non-JSON body says nothing, and the fallback below is the honest answer */
  }
  return fallback;
}

/**
 * One locale decision for the moderation queues, so a card and the line under
 * it never disagree about how a date looks.
 */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * Who closed a report, and when. Both moderation queues render it, so the
 * forum and the message queue stay one pattern for a moderator.
 */
function ResolutionNote({ report }: { report: { status: string; resolvedBy?: string | null; resolvedAt?: string | null } }) {
  const line = resolutionLine(report, shortDate);
  if (!line) return null;
  return <p className="text-xs text-gray-500 mt-2">{line}</p>;
}

/**
 * Forum moderation, which had no surface at all.
 *
 * Three endpoints have existed since the forum shipped — the report queue,
 * resolving a report, and hiding or locking a thread — and not one of them had
 * a caller anywhere in the client. Meanwhile the server auto-hides a thread
 * once enough people softly report it. So the village could silence a
 * conversation on its own, and the stewards had no way to see that it had
 * happened, why, or how to put it back. Moderation that only ever removes is
 * not moderation.
 */
function ForumModerationTab({ password }: { password: string }) {
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const [reports, setReports] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(() => {
    setReports(null);
    fetch(`${API_BASE}/admin/forum/reports?status=${status}`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : []))
      .then(setReports)
      .catch(() => setReports([]));
  }, [password, status]);
  useEffect(load, [load]);

  const act = async (url: string, body: any, okMsg: string, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method: url.includes("/reports/") ? "PUT" : "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
      toast.success(okMsg);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-gray-900">Moderation</h2>
        <p className="text-sm text-gray-500 mt-1">
          What the village has flagged, and what it has already hidden on its own.
          Hiding is always reversible. Nothing here deletes anyone's words.
        </p>
      </div>

      {/* The category list, which the forum has validated on every write and
          read on every request since it shipped, with no editor anywhere. */}
      <ForumCategoriesEditor password={password} />

      <div className="flex gap-2">
        {(["open", "resolved", "dismissed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={`text-sm rounded-lg px-3 py-1.5 border capitalize transition-colors ${
              status === s
                ? "bg-teal-deep text-white border-teal-deep"
                : "bg-white text-gray-600 border-gray-200 hover:border-teal-deep/40"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {reports === null && <p className="text-sm text-gray-400">Loading…</p>}
      {reports?.length === 0 && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-6">
          Nothing {status}. A quiet queue is the good outcome.
        </p>
      )}

      <div className="space-y-3">
        {(reports ?? []).map((r) => (
          <div key={r.id} className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 break-words">{r.threadTitle}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {r.severity === "hard" ? "Serious report" : "Flagged"} by {r.reporter} ·{" "}
                  {new Date(r.at).toLocaleDateString()}
                  {r.replyId ? " · on a reply" : ""}
                </p>
                {r.reason && <p className="text-sm text-gray-600 mt-2 break-words">"{r.reason}"</p>}
                {/* Who closed it and when. Written on every close since the
                    queue shipped, and read by nobody until now. */}
                <ResolutionNote report={r} />
              </div>
              {r.alreadyHidden && (
                <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 shrink-0">
                  Auto-hidden
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
              <a
                href={`/forum/${r.threadId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-teal-deep border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
              >
                Read it
              </a>
              {r.alreadyHidden ? (
                <button
                  disabled={busy === r.id}
                  onClick={() => act(`${API_BASE}/forum/threads/${r.threadId}/moderate`, { action: "restore" }, "Back in the open", r.id)}
                  className="text-xs text-emerald-700 border border-emerald-200 rounded-lg px-2.5 py-1.5 hover:bg-emerald-50 disabled:opacity-40"
                >
                  Put it back
                </button>
              ) : (
                <button
                  disabled={busy === r.id}
                  onClick={() => {
                    const reason = window.prompt("Why is this being hidden? The author is told.");
                    if (reason === null) return;
                    act(`${API_BASE}/forum/threads/${r.threadId}/moderate`, { action: "hide", reason }, "Hidden", r.id);
                  }}
                  className="text-xs text-red-600 border border-red-200 rounded-lg px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-40"
                >
                  Hide it
                </button>
              )}
              <button
                disabled={busy === r.id}
                onClick={() => act(`${API_BASE}/forum/threads/${r.threadId}/moderate`, { action: "lock" }, "Locked to new replies", r.id)}
                className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40"
              >
                Lock replies
              </button>
              {status === "open" && (
                <>
                  <button
                    disabled={busy === r.id}
                    onClick={() => act(`${API_BASE}/admin/forum/reports/${r.id}`, { status: "resolved" }, "Marked handled", r.id)}
                    className="text-xs text-teal-deep border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Handled
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => act(`${API_BASE}/admin/forum/reports/${r.id}`, { status: "dismissed" }, "Dismissed", r.id)}
                    className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Nothing wrong here
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Direct-message reports, which went into a void.
 *
 * Members have always been able to flag a line in a private conversation
 * (`Messages.tsx`), the server has always stored it, and the queue that reads
 * those rows plus the route that resolves one have had no caller anywhere in
 * the client. So somebody reporting harassment got a success path into
 * nothing, and the platform never told them otherwise.
 *
 * Built to match the forum queue above on purpose: the same status chips, the
 * same card, the same two verbs. A moderator learns one pattern.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHOW. Private correspondence is the whole
 * difference from the forum queue. The server hands over one message body and
 * the thread it sat in, and that is all this renders: no surrounding lines, no
 * author name, no link into the conversation. A direct thread is never named,
 * because its name is the two people in it. The card says so out loud, so a
 * moderator knows they are judging one line and not a thread.
 */
function MessageReportsTab({ password }: { password: string }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<MessageReport[] | null>(null);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(() => {
    setReports(null);
    fetch(`${API_BASE}/admin/messages/reports?status=${status}`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setReports(Array.isArray(rows) ? rows : []))
      .catch(() => setReports([]));
  }, [password, status]);
  useEffect(load, [load]);

  const resolve = async (id: string, next: "resolved" | "dismissed", okMsg: string) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_BASE}/admin/messages/reports/${id}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(data, "That report could not be updated."));
      toast.success(okMsg);
      load();
    } catch (e: any) {
      toast.error(e?.message || "That report could not be updated.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-gray-900">Message Reports</h2>
        <p className="text-sm text-gray-500 mt-1">
          Lines members have flagged inside private conversations. {DISCLOSURE_NOTE}
        </p>
      </div>

      <div className="flex gap-2">
        {(["open", "resolved", "dismissed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={`text-sm rounded-lg px-3 py-1.5 border capitalize transition-colors ${
              status === s
                ? "bg-teal-deep text-white border-teal-deep"
                : "bg-white text-gray-600 border-gray-200 hover:border-teal-deep/40"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {reports === null && <p className="text-sm text-gray-400">Loading…</p>}
      {reports?.length === 0 && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-6">
          {emptyQueueLine(status)}
        </p>
      )}

      <div className="space-y-3">
        {(reports ?? []).map((r) => {
          const line = reportedLine(r);
          return (
            <div key={r.id} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-words">{reportPlace(r)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Reported by {r.reporter} · {new Date(r.at).toLocaleDateString()}
                  </p>
                </div>
                {r.deleted && (
                  <span className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 shrink-0">
                    Deleted by its author
                  </span>
                )}
              </div>

              <blockquote
                className={`mt-3 border-l-2 pl-3 text-sm break-words ${
                  line.present ? "border-gray-300 text-gray-800" : "border-gray-200 text-gray-500 italic"
                }`}
              >
                {line.text}
              </blockquote>

              {r.reason && (
                <p className="text-sm text-gray-600 mt-2 break-words">
                  Why they flagged it: "{r.reason}"
                </p>
              )}

              <ResolutionNote report={r} />

              {canAct(r) && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
                  <button
                    disabled={busy === r.id}
                    onClick={() => void resolve(r.id, "resolved", "Marked handled")}
                    className="text-xs text-teal-deep border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Handled
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => void resolve(r.id, "dismissed", "Dismissed")}
                    className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Nothing wrong here
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The nav rail.
 *
 * Thirty-odd items at a fixed 224px ate more than half a phone screen and
 * left the actual settings in a column too narrow to read — the reason this
 * exists. Collapsed it is a 56px strip of icons that still navigate in one
 * tap, so narrowing costs nothing.
 *
 * Expanded, the two sizes behave differently on purpose. On a wide screen it
 * sits in the layout and pushes the content across. On a phone there is no
 * room to push anything, so it floats over the content with a backdrop and
 * closes itself the moment you choose something — the pattern every mobile
 * drawer uses, because the alternative is squeezing the page to nothing.
 */
function AdminNav({
  groups, activeTab, onSelect, open, setOpen,
}: {
  groups: NavGroup[];
  activeTab: string;
  onSelect: (key: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const choose = (key: string) => {
    onSelect(key);
    // Only the floating drawer gets out of the way; a docked rail stays put.
    if (open && window.innerWidth < 1024) setOpen(false);
  };

  /**
   * TWO WAYS TO LEARN AN ICON, NEITHER OF WHICH IS `title`.
   *
   * `title` is a hover tooltip, and a touch screen has no hover — on a phone
   * the collapsed rail was thirty unlabelled glyphs with no way to ask what
   * any of them meant. So:
   *
   *   press and hold  → that one icon says its name
   *   swipe right     → the whole rail slides open and they all do
   *
   * A hold is a question, not an answer, so the click it would otherwise
   * fire on release is swallowed: asking "what is this?" must never navigate
   * somewhere you did not choose.
   */
  const HOLD_MS = 350;
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const startHold = (e: React.TouchEvent<HTMLButtonElement>, label: string) => {
    swallowClick.current = false;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    // Read the rect NOW: the nav scrolls on its own axis, so by the time the
    // timer fires the button may have moved under the finger.
    const r = e.currentTarget.getBoundingClientRect();
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      swallowClick.current = true;
      setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
    }, HOLD_MS);
  };
  const moveHold = (e: React.TouchEvent) => {
    const s = touchStart.current;
    if (!s) return;
    const t = e.touches[0];
    // A finger that travels is scrolling or swiping, not asking.
    if (holdCancelled(t.clientX - s.x, t.clientY - s.y)) clearHold();
  };
  const endHold = () => {
    clearHold();
    // Linger, so a label that appeared under the fingertip is still there to
    // read once the finger lifts off it.
    if (tip) window.setTimeout(() => setTip(null), 900);
  };

  // Swipe anywhere on the rail: right opens, left closes.
  const swipeStart = (e: React.TouchEvent) => {
    // Every touch clears the flag, so a swallow can only ever apply to the
    // click of the gesture that set it. Without this, a swipe-to-open would
    // arm the flag and the next honest tap would silently do nothing.
    swallowClick.current = false;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const swipeEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const intent = swipeIntent(t.clientX - s.x, t.clientY - s.y);
    if (!intent) return;
    clearHold();
    swallowClick.current = true;
    setTip(null);
    setOpen(intent === "open");
  };

  /**
   * Neither gesture announces itself, so say it once.
   *
   * Only on a touch screen (a mouse has hover and does not swipe), only
   * while the rail is actually collapsed, and only until it is dismissed or
   * eight seconds pass. Then never again.
   */
  const [hint, setHint] = useState(
    () => !open
      && typeof window !== "undefined"
      && window.matchMedia("(hover: none)").matches
      && !localStorage.getItem("admin.navHintSeen"),
  );
  const dismissHint = useCallback(() => {
    setHint(false);
    localStorage.setItem("admin.navHintSeen", "1");
  }, []);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(dismissHint, 8000);
    return () => window.clearTimeout(t);
  }, [hint, dismissHint]);
  useEffect(() => {
    if (open && hint) dismissHint(); // they found it; stop explaining
  }, [open, hint, dismissHint]);

  return (
    <>
      {hint && (
        <button
          onClick={dismissHint}
          className="fixed z-50 left-16 bottom-6 max-w-[15rem] rounded-xl bg-gray-900 px-3 py-2.5 text-left text-xs leading-relaxed text-white shadow-xl"
        >
          Hold an icon to see its name, or swipe right to slide the whole menu
          out.
          <span className="mt-1 block text-white/60">Tap to dismiss</span>
        </button>
      )}
      {tip && (
        // Fixed, not absolute: the rail scrolls vertically, which clips its
        // own overflow, so a label parked inside it would be cut off at 56px.
        <div
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="fixed z-50 -translate-y-1/2 pointer-events-none rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {tip.label}
        </div>
      )}
      {open && (
        <button
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}
      <nav
        onTouchStart={swipeStart}
        onTouchEnd={swipeEnd}
        className={`${open ? "fixed z-40 top-0 bottom-0 left-0 w-64 shadow-2xl lg:static lg:shadow-none lg:w-56" : "w-14"} ` +
          "min-h-[calc(100vh-60px)] bg-white border-r border-gray-200 py-3 flex-shrink-0 overflow-y-auto transition-[width] duration-150"}
      >
        <button
          onClick={() => {
            // A swipe that started on this button already did the toggling.
            if (swallowClick.current) { swallowClick.current = false; return; }
            setOpen(!open);
          }}
          aria-expanded={open}
          aria-label={open ? "Collapse menu" : "Expand menu"}
          title={open ? "Collapse menu" : "Expand menu"}
          className={`flex items-center gap-2 mb-2 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-teal-deep transition-colors ${
            open ? "w-full px-4" : "w-full justify-center px-0"
          }`}
        >
          {open ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          {open && <span>Menu</span>}
        </button>

        {groups.map((group) => (
          <div key={group.title}>
            {open ? (
              <div className="px-4 mt-5 mb-2">
                {/* gray-600, not gray-400: at 12px on the rail's white these
                    labels measured 2.60:1, and they are the only thing that
                    tells thirty menu items apart. */}
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest">{group.title}</p>
              </div>
            ) : (
              // Collapsed, a group title has nowhere to go, but the grouping
              // is still what makes thirty icons findable — so it becomes a
              // rule instead of disappearing.
              <div className="mx-3 my-2 border-t border-gray-100" />
            )}
            {group.items.map(({ key, label, icon: Icon, badge }) => {
              const active = activeTab === key;
              return (
                <button
                  key={`${group.title}:${key}`}
                  onClick={() => {
                    if (swallowClick.current) { swallowClick.current = false; return; }
                    choose(key);
                  }}
                  onTouchStart={open ? undefined : (e) => startHold(e, label)}
                  onTouchMove={open ? undefined : moveHold}
                  onTouchEnd={open ? undefined : endHold}
                  onTouchCancel={open ? undefined : endHold}
                  title={label}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex items-center text-sm font-medium transition-colors ${
                    open ? "gap-3 px-4 py-2.5" : "justify-center px-0 py-3"
                  } ${
                    active
                      ? "bg-teal-deep/10 text-teal-deep border-r-2 border-teal-deep"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <Icon className={open ? "w-4 h-4 flex-shrink-0" : "w-5 h-5"} />
                  {open && <span className="truncate">{label}</span>}
                  {/* The lifecycle badge (L1): where this tab's module stands,
                      so a founder never opens the library just to check. */}
                  {open && badge && (
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide flex-shrink-0">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Submission {
  id: string;
  type: string;
  data: Record<string, any>;
  submittedAt: string;
  status?: string;
  userId?: string;
  userName?: string;
  rewarded?: boolean;
}

const SUBMISSION_STATUSES = ["new", "reviewing", "in-conversation", "accepted", "declined"];
const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  reviewing: "bg-amber-100 text-amber-800",
  "in-conversation": "bg-violet-100 text-violet-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-stone-100 text-stone-500",
};
function prettyType(t: string) {
  return t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Admin Gate (S1: admins are real users) ───────────────────────────────────
//
// The old PasswordGate probed the server with a shared password. Admins are
// member accounts with role admin|founder now, so the gate is login-aware:
// signed out → member login; signed in without the role → a clear refusal;
// admin → the member TOKEN flows into the existing `password` prop plumbing,
// which already sends `Authorization: Bearer <value>` everywhere. Renaming
// that prop across fifteen tabs is deliberate later cleanup, not S1.

function AdminGate({ onAuth }: { onAuth: (token: string) => void }) {
  const { user, loading, login, logout } = useAuth();
  // Same config the rest of the app reads its identity from (Layout.tsx and
  // every public page use this hook). Null until the fetch resolves, so
  // villageName starts blank and the heading falls back to plain "Admin"
  // rather than flashing anyone's name.
  const cfg = useGameConfig();
  const villageName = String(cfg?.project?.name ?? "").trim();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const isAdmin = !!user && (user.role === "admin" || user.role === "founder");

  useEffect(() => {
    if (isAdmin) {
      const token = authToken();
      if (token) onAuth(token);
    }
  }, [isAdmin, onAuth]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw) return;
    setChecking(true);
    setError("");
    try {
      await login(email, pw);
      // On success the user lands in context; the effect above finishes the job
      // (or the refusal screen renders if the account isn't an admin).
    } catch {
      setError("Wrong email or password.");
      setPw("");
    }
    setChecking(false);
  };

  if (loading || isAdmin) {
    return (
      <div className="min-h-screen bg-teal-deep flex items-center justify-center">
        <BreathingLoader label="Opening the admin" size={56} />
      </div>
    );
  }

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-teal-deep flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Not an admin</h1>
          <p className="text-sm text-gray-500 mb-8">
            You're signed in as <strong>{user.name}</strong>, but this account doesn't
            have admin access. Ask a founder to grant it, or sign in with an admin
            account.
          </p>
          <button
            onClick={() => logout()}
            className="w-full py-3 bg-teal-deep text-white rounded-lg font-medium hover:bg-teal-deep/90 transition-colors"
          >
            Sign out and switch accounts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-teal-deep flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm">
        <div className="w-14 h-14 rounded-full bg-teal-deep/10 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-7 h-7 text-teal-deep" />
        </div>
        <h1 className="font-display text-2xl font-bold text-center text-gray-900 mb-2">
          {villageName ? `${villageName} Admin` : "Admin"}
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          Sign in with your admin account
        </p>
        <form onSubmit={submit} className="space-y-4">
          {/*
            * `username`, not `email`, even though the field takes an address:
            * `username` is the token a password manager pairs with
            * `current-password` to recognise a sign-in form, and this is the
            * identifier half of exactly that pair. A placeholder is not a name,
            * so both fields carry one an assistive technology can read.
            */}
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="Email"
            aria-label="Email"
            autoComplete="username"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => { setPw(e.target.value); setError(""); }}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
            />
            {/*
              * The eye stays a 16px icon and the thing a thumb hits becomes
              * 44x44 around it, which is what the input's `pr-12` was already
              * reserving. gray-600 rather than gray-400 because this is a
              * control, and 2.6:1 was under the 3:1 a non-text control owes.
              */}
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p role="alert" className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={checking}
            className="w-full py-3 bg-teal-deep text-white rounded-lg font-medium hover:bg-teal-deep/90 disabled:opacity-60 transition-colors"
          >
            {checking ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Submissions Tab ───────────────────────────────────────────────────────────

function SubmissionsTab({ password }: { password: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? `${API_BASE}/admin/submissions`
        : `${API_BASE}/admin/submissions?type=${filter}`;
      const res = await fetch(url, { headers: authHeaders(password) });
      const data = await res.json();
      setSubmissions(Array.isArray(data) ? data : []);
    } catch {
      setSubmissions([]);
    }
    setLoading(false);
  }, [password, filter]);

  useEffect(() => { load(); }, [load]);

  const deleteSubmission = async (id: string) => {
    if (!confirm("Delete this submission?")) return;
    // The reload was standing in for an answer: a refused delete redrew the
    // same row and said nothing, so it read as a click that missed.
    try {
      const res = await fetch(`${API_BASE}/admin/submissions/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The submission is still here.`));
        return;
      }
    } catch {
      toast.error("That did not reach the server. The submission is still here.");
      return;
    }
    load();
  };

  const setStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/submissions/${id}/status`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (data.rewarded) toast.success("Accepted. The member was welcomed into the game.");
      // Whether the person who sent this heard about the move. Members hear;
      // a public form filled in by a stranger has no account to reach, and a
      // founder who knows which is which can pick up the phone.
      else if (data.notified) toast.success("Status updated. The person who sent it has been told.");
      else toast.success("Status updated");
      load();
    } catch { toast.error("Could not update status"); }
  };

  return (
    <div>
      {/* flex-wrap and gap, because this row does not fit a phone: the heading
          plus a 171px type filter plus the refresh button need about 657px, and
          justify-between on a non-wrapping flex pushed the overflow onto the
          document rather than onto this row. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-xl font-bold text-gray-900">Form Submissions</h2>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          >
            <option value="all">All types</option>
            {FORM_TYPES.map((t) => (
              <option key={t} value={t}>{prettyType(t)}</option>
            ))}
          </select>
          <button onClick={load} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No submissions yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => (
            <div key={s.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-deep/10 text-teal-deep">
                    {prettyType(s.type)}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[s.status ?? "new"] ?? STATUS_STYLE.new}`}>
                    {prettyType(s.status ?? "new")}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {s.data.name || s.data.firstName || s.data.email || "Anonymous"}
                  </span>
                  {s.userId && <span className="text-xs text-emerald-600" title="Submitted while signed in">● member</span>}
                  <span className="text-xs text-gray-400">
                    {new Date(s.submittedAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSubmission(s.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {expanded === s.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {expanded === s.id && (
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <label className="text-xs font-medium text-gray-500">Status</label>
                    <select
                      value={s.status ?? "new"}
                      onChange={(e) => setStatus(s.id, e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                    >
                      {SUBMISSION_STATUSES.map((st) => (
                        <option key={st} value={st}>{prettyType(st)}</option>
                      ))}
                    </select>
                    {s.userId && (
                      <span className="text-xs text-emerald-600">
                        Signed-in member{s.userName ? ` · ${s.userName}` : ""}{s.rewarded ? " · welcomed into the game ✓" : ""}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(s.data)
                        .filter(([k]) => k !== "attachmentName")
                        .map(([k, v]) => (
                        <tr key={k} className="border-b border-gray-100 last:border-0">
                          <td className="py-1.5 pr-4 font-medium text-gray-600 capitalize w-1/4 align-top">
                            {k.replace(/([A-Z])/g, " $1").trim()}
                          </td>
                          <td className="py-1.5 text-gray-800 whitespace-pre-wrap">
                            {k === "attachment" && v ? (
                              <a href={`${API_BASE}/uploads/${v}`} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">
                                {s.data.attachmentName || String(v)}
                              </a>
                            ) : Array.isArray(v) ? (
                              v.join(", ")
                            ) : (
                              String(v ?? "")
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Email Settings Tab ────────────────────────────────────────────────────────

interface EmailConfig {
  investor: string;
  steward: string;
  resident: string;
  prosperity: string;
}

/**
 * Hoisted OUT of EmailSettingsTab on purpose (the cursor-jump bug): a
 * component type created inside a render is a NEW type every keystroke, so
 * React unmounted and remounted the input mid-word and focus fell to the
 * top of the section. Module scope = stable identity = the cursor stays
 * where the person is typing.
 */
function EmailField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      {/* type=text, not email: these fields take a comma-separated LIST so
          several people can receive updates, and the browser's single-email
          validation would fight that. */}
      <input
        type="text"
        inputMode="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
        placeholder="one@example.org, two@example.org"
      />
      <p className="text-xs text-gray-400 mt-1">{hint} Several people? Separate addresses with commas.</p>
    </div>
  );
}

function EmailSettingsTab({ password, openIntegrations }: { password: string; openIntegrations: () => void }) {
  const [cfg, setCfg] = useState<EmailConfig>({
    investor: "", steward: "", resident: "", prosperity: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, { headers: authHeaders(password) });
      const data = await res.json();
      setCfg({
        investor: data.investor ?? "",
        steward: data.steward ?? "",
        resident: data.resident ?? "",
        prosperity: data.prosperity ?? "",
      });
    } catch {
      toast.error("Failed to load email settings");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Email settings saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Email Settings</h2>
          <p className="text-sm text-gray-500 mt-1">
            Form submissions are routed to the matching inbox via Resend.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading}
          className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-5 max-w-xl">
          <EmailField
            label="Business Inquiries (Prosperity / Contact)"
            value={cfg.prosperity}
            onChange={(v) => setCfg({ ...cfg, prosperity: v })}
            hint="Receives business and contact form submissions."
          />
          <EmailField
            label="Investor"
            value={cfg.investor}
            onChange={(v) => setCfg({ ...cfg, investor: v })}
            hint="Receives investor enquiries and document requests."
          />
          <EmailField
            label="Core Team (Steward)"
            value={cfg.steward}
            onChange={(v) => setCfg({ ...cfg, steward: v })}
            hint="Receives Village Steward applications."
          />
          <EmailField
            label="Resident"
            value={cfg.resident}
            onChange={(v) => setCfg({ ...cfg, resident: v })}
            hint="Receives Resident applications and waitlist signups."
          />

          <div className="border-t border-gray-100 pt-5">
            <p className="text-sm text-gray-600">
              API keys (Resend, Anthropic, Stripe) moved to{" "}
              <button onClick={openIntegrations} className="text-teal-deep font-medium hover:underline">
                Integrations
              </button>,{" "}
              one place for every third-party connection, and keys never travel
              back to a browser once saved.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * S63: every third-party key in one place, write-only. The server tells us
 * whether each is configured, from where (admin vs host env), who set it and
 * its last four characters — never the value. Typing a new one replaces it;
 * clearing falls back to the host env var if one exists.
 */
function IntegrationsTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/integrations`, { headers: authHeaders(password) });
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const put = async (key: string, value: string) => {
    setBusy(key);
    try {
      const res = await fetch(`${API_BASE}/admin/integrations/${key}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ value }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      toast.success(value.trim() ? "Key saved" : "Key cleared");
      setDrafts((p) => ({ ...p, [key]: "" }));
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setBusy("");
  };

  /*
   * The cards come from the server now.
   *
   * This was a hardcoded four-entry array while the store held seven keys, so
   * riverside_webhook_secret, governance_hub_secret and basescan_api_key were
   * settable over the API, present in this very payload, and had no field
   * anywhere in the product. Copy in this same file told an admin to set the
   * Riverside secret "under Integrations", where no such card existed.
   *
   * The list is derived from the registry server-side, so a module library
   * listing brings its own card and there is no second list to keep in step.
   */
  const CARDS: any[] = data?.cards ?? [];

  const statusOf = (key: string) => (data?.secrets ?? []).find((s: any) => s.key === key);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Integrations</h2>
        <p className="text-sm text-gray-500 mt-1">
          Third-party connections, one place. Keys are write-only: once saved,
          the server shows only that a key exists and its last four characters.
          A key set here beats one from the hosting environment.
        </p>
      </div>
      {loading && !data ? <div className="text-center py-12 text-gray-400">Loading…</div> : (
        <div className="space-y-5 max-w-2xl">
          {/* The one value that flows the OTHER way: what to paste into Stripe. */}
          <div className="bg-teal-deep/5 border border-teal-deep/20 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-900 mb-1">Your Stripe webhook URL</p>
            <code className="text-xs bg-white border border-gray-200 rounded px-2 py-1 block overflow-x-auto">
              {data?.stripeWebhookUrl}
            </code>
            <p className="text-xs text-gray-500 mt-2">
              In Stripe: Developers → Webhooks → Add endpoint → paste this URL,
              subscribe to all five events below, then copy the signing secret
              into the card below.
            </p>
            <ul className="text-xs text-gray-500 mt-2 space-y-1">
              <li><code>checkout.session.completed</code>: a purchase is made</li>
              <li><code>checkout.session.async_payment_succeeded</code>: a bank
                transfer or direct debit clears, days later</li>
              <li><code>invoice.paid</code>: a subscription renews for another period</li>
              <li><code>charge.refunded</code>: money is given back</li>
              <li><code>charge.dispute.created</code>: a buyer charges back</li>
            </ul>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              Miss <code>invoice.paid</code> and recurring products keep charging
              people every month while delivering only the first one. Miss{" "}
              <code>checkout.session.async_payment_succeeded</code> and anyone
              paying by bank transfer is charged and never receives anything.
            </p>
          </div>

          {CARDS.map((c) => {
            const s = c.key ? statusOf(c.key) : null;
            return (
              <div key={c.key ?? `module:${c.module}`} className="bg-white border border-gray-100 rounded-xl p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                  <p className="font-semibold text-gray-900">
                    {c.title}
                    {c.tier === "connected" && <span className="ml-2 text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full">connected</span>}
                    {c.tier === "managed" && <span className="ml-2 text-[10px] bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full">managed</span>}
                    {/* The licence pill, on the one card whose field IS the
                        entitlement. Every other key opens an account; this one
                        is what the village bought. */}
                    {c.isLicence && <span className="ml-2 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">licence</span>}
                  </p>
                  {/* A managed listing has no key of the village's to report, so
                      it reports the entitlement instead. Everything else
                      reports the slot. */}
                  {!c.credential ? (
                    <span className={`text-xs font-medium rounded-full px-2.5 py-1 border ${c.entitled ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-gray-500 bg-gray-50 border-gray-200"}`}>
                      {c.entitled ? "Included in your plan" : "Not on your plan"}
                    </span>
                  ) : s?.configured ? (
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                      Connected · ••••{s.last4}
                      {s.source === "env" ? " · from host env" : s.setBy ? ` · set by ${s.setBy}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">{c.unlocks}</p>
                {/* A key being set is not a key that works. This line is the
                    only place either screen may speak about health, and it
                    reads the recorded outcome of real calls. */}
                {(c.health ?? []).map((h: any) => (
                  <p key={h.operation} className={`text-xs mb-2 ${h.verdict === "failing" || h.verdict === "stale" ? "text-red-600" : "text-gray-500"}`}>
                    {h.operation}: {h.detail}
                  </p>
                ))}
                {/* How the value is HELD, which the pill above cannot say.
                    Both states read as "Not connected" or as an ordinary
                    "Connected" pill, so a steward looking at this card had no
                    way to tell a key sitting in the clear from a sealed one,
                    or a key this deployment has lost from one never set.
                    Unreadable first: it is the stronger fact, and the two can
                    be true at once. */}
                {s?.unreadable ? (
                  <p className="text-xs text-red-600 mb-2">
                    A key is saved here and this deployment cannot open it, so it
                    is being treated as unset. VILLAGE_SECRETS_KEY is missing, or
                    it changed after this key was saved. Put the old value back,
                    or save this key again.
                  </p>
                ) : s?.atRest === "plaintext" ? (
                  <p className="text-xs text-amber-700 mb-2">
                    Saved in the clear, from before this platform encrypted these
                    keys. Any copy of the database carries it. Set
                    VILLAGE_SECRETS_KEY on this deployment and restart, and it is
                    encrypted on the next boot.
                  </p>
                ) : null}
                {c.credential && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      value={drafts[c.key] ?? ""}
                      onChange={(e) => setDrafts((p) => ({ ...p, [c.key]: e.target.value }))}
                      placeholder={s?.configured ? `Replace key (${c.placeholder})` : c.placeholder}
                      className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
                    />
                    <button
                      onClick={() => put(c.key, drafts[c.key] ?? "")}
                      disabled={busy === c.key || !(drafts[c.key] ?? "").trim()}
                      className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
                    >
                      Save
                    </button>
                    {s?.source === "admin" && (
                      <button
                        onClick={() => { if (window.confirm("Clear this key? If the host environment provides one, it takes over; otherwise this integration disconnects.")) put(c.key, ""); }}
                        disabled={busy === c.key}
                        className="text-sm text-gray-500 bg-gray-100 rounded-lg px-3 py-2 font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
                {/* Steps a founder performs inside the other product. Every one
                    of these is a permanent per-village human cost, which is why
                    the listing has to declare them where a founder can see. */}
                {(c.setupSteps ?? []).length > 0 && (
                  <ul className="text-xs text-gray-500 mt-3 space-y-1 list-disc pl-4">
                    {c.setupSteps.map((step: string, i: number) => <li key={i}>{step}</li>)}
                  </ul>
                )}
                {c.support?.party === "vendor" && (
                  <p className="text-xs text-gray-400 mt-2">
                    Supported by {c.support.vendorName}:{" "}
                    <a href={c.support.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">{c.support.supportUrl}</a>
                    {c.support.supportEmail ? ` · ${c.support.supportEmail}` : ""}
                  </p>
                )}
                {/* What it costs and who wrote it, on the card where a founder
                    is holding the key it buys. */}
                {c.priceLine && (
                  <p className="text-xs text-gray-500 mt-2">
                    {c.priceLine}
                    {c.billingUrl && (
                      <>
                        {" · "}
                        <a href={c.billingUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Pricing ↗</a>
                      </>
                    )}
                  </p>
                )}
                {c.builtBy && <p className="text-xs text-gray-400 mt-1">Built by {c.builtBy}</p>}
                {c.getAt && <p className="text-xs text-gray-400 mt-2">Get it at: {c.getAt}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Investor Vault Tab ────────────────────────────────────────────────────────

/**
 * The columns `investor_docs` actually has. This declared `name` and
 * `filename`, which are not columns of that table, so the list rendered a blank
 * link to `/api/uploads/undefined` for any row that reached it. Nothing ever
 * did, because the upload route could not write a row either.
 */
interface InvestorDoc {
  id: string;
  title: string;
  description: string | null;
  /** `/api/uploads/<file>` for an upload, or any address for an imported row. */
  url: string;
  pageLink: string | null;
  uploadedAt: string | null;
  /**
   * 0104. Is this document part of the packet the public request form emails?
   * False for everything until a person says otherwise.
   */
  inPacket: boolean;
}

/**
 * WHO RECEIVES AN INVESTOR ENQUIRY, edited where a founder is already
 * standing (founder ruling R10, 2026-08-31, verbatim: "Add a section in admin
 * where new instances can add the emails that receive investor requests -
 * this should stay editable and be found right next to where they upload
 * investor packet details.").
 *
 * NO NEW STORE, AND NO SECOND COPY OF THE ADDRESSES. These are the same two
 * inboxes Email Settings has always written, on the same
 * `/api/admin/email-config` document, read back by `recipientsForType` on the
 * server. A second field holding a second copy of an address is a second
 * chance for the two to disagree, and the one a founder had just edited would
 * not be the one the server read. So this is a SECOND DOOR onto one value,
 * not a second value: change it here and Email Settings shows the change, and
 * the other way round.
 *
 * TWO ADDRESSES, NOT ONE. The server already routes these apart
 * (`FORM_TYPE_TO_PATHWAY`): `investor`, `investor-pack`, `investor-call` and
 * `investor-doc-request` reach the investor inbox, while `prosperity`,
 * `contact` and `work-with-us` reach the business one. The code this replaced
 * carried two literal addresses for exactly that reason. A village that wants
 * one inbox types one address into both fields, which costs it nothing;
 * merging the fields would delete a routing choice the server can already
 * make and no founder could get it back from this screen.
 *
 * The PUT sends only these two keys on purpose. The route merges per field
 * (an absent key keeps its stored value), so saving here cannot blank the
 * steward and resident inboxes that this card deliberately does not show.
 */
function InvestorInboxCard({ password }: { password: string }) {
  const [investor, setInvestor] = useState("");
  const [business, setBusiness] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, { headers: authHeaders(password) });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setInvestor(String(data?.investor ?? ""));
      setBusiness(String(data?.prosperity ?? ""));
      setLoadFailed(false);
    } catch {
      // Say so rather than showing two empty boxes, which read as "no address
      // set" and invite a founder to type over an address that is really there.
      setLoadFailed(true);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ investor, prosperity: business }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). Nothing changed.`));
        setSaving(false);
        return;
      }
      toast.success("Investor and business addresses saved");
      load();
    } catch {
      toast.error("That did not reach the server. Nothing changed.");
    }
    setSaving(false);
  };

  const nobodyHome = !loading && !loadFailed && !investor.trim() && !business.trim();

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Who receives investor requests</h3>
          <p className="text-xs text-muted-foreground mt-1">
            When somebody asks for the packet below, the documents go to them and
            the alert comes to you. These are the addresses it reaches. They are
            the same two inboxes as Email Settings, so an edit in either place is
            the same edit.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading || loadFailed}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-teal-deep text-white rounded-lg text-xs font-medium hover:bg-teal-deep/90 disabled:opacity-50 transition-colors"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-4">Loading the current addresses...</p>
      ) : loadFailed ? (
        <p className="text-xs text-red-600 py-4">
          The current addresses did not load. Reload the page before editing,
          so a save here cannot overwrite an address you never saw.
        </p>
      ) : (
        <div className="space-y-4 mt-4">
          {nobodyHome && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No address is set. A visitor can still request the packet and still
              receives it, and nobody here is told the request happened.
            </p>
          )}
          <EmailField
            label="Investor requests"
            value={investor}
            onChange={setInvestor}
            hint="Receives investor enquiries, calls, and every request for the packet below."
          />
          <EmailField
            label="Business enquiries"
            value={business}
            onChange={setBusiness}
            hint="Receives business, contact and work-with-us enquiries."
          />
        </div>
      )}
    </div>
  );
}

function InvestorVaultTab({ password }: { password: string }) {
  const [docs, setDocs] = useState<InvestorDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [pageLink, setPageLink] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/investor-docs`, { headers: authHeaders(password) });
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      setDocs([]);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error("Pick a file first");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    if (pageLink) fd.append("pageLink", pageLink);
    try {
      const res = await fetch(`${API_BASE}/admin/investor-docs/upload`, {
        method: "POST",
        headers: authHeaders(password),
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast.success("Document uploaded");
      setName(""); setPageLink(""); setFile(null);
      const fileInput = document.getElementById("vault-file") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      load();
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
  };

  /**
   * The one press that puts a document in the investor packet, or takes it out.
   *
   * The public request form emails the packet to anyone who asks, so this is
   * the press that decides what a stranger can receive. The server's answer is
   * read before the screen changes: a toggle that flips itself and then finds
   * out is how an admin ends up believing the cap table is private.
   */
  const setInPacket = async (id: string, next: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/investor-docs/${id}`, {
        method: "PATCH",
        headers: { ...authHeaders(password), "Content-Type": "application/json" },
        body: JSON.stringify({ inPacket: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). Nothing changed.`));
        return;
      }
      toast.success(next ? "Added to the investor packet" : "Removed from the investor packet");
      load();
    } catch {
      toast.error("That did not reach the server. Nothing changed.");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this document permanently?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/investor-docs/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The document is still here.`));
        return;
      }
      /*
       * The row going away is not proof the file went away. `/api/uploads/`
       * has no authentication, so anyone still holding the old link can open
       * the document until the file itself is gone. The server now says which
       * of the two happened, and a half-delete has to reach the person who
       * pressed the button.
       */
      const body = await res.json().catch(() => null);
      if (body?.fileRemoved === false) {
        toast.error(String(body.warning ?? "The record is gone, and its file is still on the server."), { duration: 12000 });
      } else {
        toast.success("Deleted");
      }
      load();
    } catch {
      toast.error("That did not reach the server. The document is still here.");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Investor Vault</h2>
          {/*
            State what is true and then get out of the way. The old line said
            "Documents shared with investors after they request the packet",
            and every document really was shared with anyone who filled in the
            public form. A count is a fact the founder can act on.
          */}
          <p className="text-sm text-gray-500 mt-1">
            Everything you upload stays private. The public request form emails
            only the documents you tick as in the packet.
          </p>
          {!loading && (
            <p className="text-sm text-gray-500 mt-1">
              {docs.filter((d) => d.inPacket).length} of {docs.length} in the packet.
            </p>
          )}
        </div>
      </div>

      {/*
        Above the upload, not below it (R10 asks for "right next to", and of
        the two adjacencies this is the useful one): a founder who uploads
        first and sets the address never sees the gap, while a founder who
        meets the address first cannot fill the packet without being told who
        hears about it.
      */}
      <InvestorInboxCard password={password} />

      <form onSubmit={upload} className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">File</label>
            <input
              id="vault-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Display Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Investor Memo"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Site Page Link (optional)</label>
          <input
            type="text"
            value={pageLink}
            onChange={(e) => setPageLink(e.target.value)}
            placeholder="/master-plan"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
        </div>
        <button
          type="submit"
          disabled={uploading || !file}
          className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50 transition-colors"
        >
          <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
        </button>
      </form>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No documents in the vault yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between border border-gray-200 rounded-xl px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-gray-900 hover:text-teal-deep"
                  >
                    {d.title}
                  </a>
                  {d.pageLink && (
                    <a
                      href={d.pageLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full"
                    >
                      {d.pageLink} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">
                  {d.url.split("/").pop()}
                  {d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <label className="flex items-center gap-2 mr-3 shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={d.inPacket}
                  onChange={(e) => setInPacket(d.id, e.target.checked)}
                  className="w-4 h-4 accent-teal-deep cursor-pointer"
                />
                <span className={`text-xs font-medium ${d.inPacket ? "text-teal-deep" : "text-gray-400"}`}>
                  {d.inPacket ? "In the packet" : "Private"}
                </span>
              </label>
              <button
                onClick={() => remove(d.id)}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Uploaded Files Tab ────────────────────────────────────────────────────────

/**
 * WHAT IS ON THE VOLUME, AND THE ONE PRESS THAT CLEARS THE UNUSED PART.
 *
 * The investor vault wrote its file before attempting a row it could never
 * save, so every press of that button left a file behind that nothing has
 * ever pointed at. The route is fixed. Removing what it already left needed a
 * shell on a production volume, which is a thing a founder does not have, and
 * that was the real defect.
 *
 * THE LIST IS THE DEFAULT AND THE REMOVAL IS A SECOND ACT. Opening this tab
 * looks and never touches anything. The removal reads the fingerprint of
 * exactly the list on screen back to the server, so what leaves the volume is
 * always what somebody read.
 *
 * The sentence beside each file is written on the SERVER, where the evidence
 * was. This page renders it and adds nothing, because a second copy of the
 * reasoning over here is the copy that goes stale.
 */
function volumeSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function UploadedFilesTab({ password }: { password: string }) {
  const [report, setReport] = useState<UploadsSweepReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [removedNames, setRemovedNames] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setArmed(false);
    try {
      const res = await fetch(`${API_BASE}/admin/uploads/orphans`, { headers: authHeaders(password) });
      const data = await res.json();
      setReport(res.ok ? (data as UploadsSweepReport) : null);
      if (!res.ok) toast.error(data?.error ?? "The volume could not be read");
    } catch {
      setReport(null);
      toast.error("The volume could not be read");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/uploads/orphans/remove`, {
        method: "POST",
        headers: { ...authHeaders(password), "Content-Type": "application/json" },
        body: JSON.stringify({ digest: report.digest }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.report) setReport(data.report as UploadsSweepReport);
        toast.error(data?.error ?? "Nothing was removed");
      } else {
        setRemovedNames(Array.isArray(data.names) ? data.names : []);
        setReport(data.after as UploadsSweepReport);
        toast.success(`Removed ${data.removed} file(s), ${volumeSize(data.bytes)}`);
        for (const k of data.kept ?? []) toast.error(`${k.name}: ${k.reason}`);
      }
    } catch {
      toast.error("Nothing was removed");
    }
    setArmed(false);
    setBusy(false);
  };

  const orphans = report?.findings?.filter((f) => f.verdict === "orphan") ?? [];
  const unknowns = report?.findings?.filter((f) => f.verdict === "unknown") ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Uploaded Files</h2>
          <p className="text-sm text-gray-500 mt-1">
            Every file on this village's uploads volume, and what the database says about each one.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || busy}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Look again
        </button>
      </div>

      {loading || !report ? (
        <div className="text-center py-12 text-gray-400">Looking...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="border border-gray-200 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-gray-900">{report.volume.files}</div>
              <div className="text-xs text-gray-500 mt-0.5">files, {volumeSize(report.volume.bytes)}</div>
            </div>
            <div className="border border-gray-200 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-gray-900">{report.tally.referenced.files}</div>
              <div className="text-xs text-gray-500 mt-0.5">in use, {volumeSize(report.tally.referenced.bytes)}</div>
            </div>
            <div className="border border-gray-200 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-gray-900">{report.tally.orphan.files}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                nothing points at, {volumeSize(report.tally.orphan.bytes)}
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-gray-900">{report.tally.unknown.files}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                unidentified, {volumeSize(report.tally.unknown.bytes)}
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 mb-6">
            Read at {new Date(report.scannedAt).toLocaleString()} against {report.scan.columns} column(s) of{" "}
            {report.scan.tables} table(s), {report.scan.values} stored value(s). A file is left alone for its first{" "}
            {report.graceDays} days and for as long as any row points at it.{" "}
            {report.tally.recent.files > 0
              ? `${report.tally.recent.files} file(s) are inside that window today.`
              : ""}
          </p>

          {!report.complete && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl px-5 py-4 mb-6 text-sm text-amber-900">
              {report.incompleteReason} Nothing can be removed until every table can be read, because a file is only
              removable when nothing anywhere names it.
            </div>
          )}

          {removedNames && (
            <div className="border border-gray-200 rounded-xl px-5 py-4 mb-6">
              <div className="text-sm font-medium text-gray-900 mb-2">
                {removedNames.length === 0 ? "Nothing was removed." : `Removed ${removedNames.length} file(s):`}
              </div>
              <div className="text-xs text-gray-500 font-mono break-all space-y-0.5">
                {removedNames.map((n) => <div key={n}>{n}</div>)}
              </div>
            </div>
          )}

          <h3 className="text-sm font-bold text-gray-900 mb-1">Nothing points at these</h3>
          {orphans.length === 0 ? (
            <p className="text-sm text-gray-500 mb-8">
              {/* Exactly what is true, and no more. "Everything here is in use"
                  would be a claim about the unidentified files below, which are
                  the ones nothing here can say anything about. */}
              No file on the volume has been shown to be unused.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-3">
                Removing them frees {volumeSize(report.tally.orphan.bytes)} and changes nothing a member or a visitor
                can see. It cannot be undone.
              </p>
              <div className="space-y-2 mb-4">
                {orphans.map((f) => (
                  <div key={f.name} className="border border-gray-200 rounded-xl px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-gray-900 break-all">{f.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {volumeSize(f.bytes)} · {f.ageDays} day(s) old
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{f.reason}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mb-8">
                {armed ? (
                  <>
                    <button
                      onClick={remove}
                      disabled={busy}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? "Removing..." : `Yes, remove these ${orphans.length} file(s)`}
                    </button>
                    <button
                      onClick={() => setArmed(false)}
                      disabled={busy}
                      className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Keep them
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setArmed(true)}
                    disabled={busy || !report.complete}
                    className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Remove these {orphans.length} file(s)
                  </button>
                )}
              </div>
            </>
          )}

          {unknowns.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-gray-900 mb-1">These stay</h3>
              <p className="text-sm text-gray-500 mb-3">
                Nothing here can tell what these are, so nothing here will touch them. They are listed so somebody who
                does know can decide.
              </p>
              <div className="space-y-2">
                {unknowns.map((f) => (
                  <div key={f.name} className="border border-gray-200 rounded-xl px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-gray-900 break-all">{f.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {volumeSize(f.bytes)} · {f.ageDays} day(s) old
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{f.reason}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Training Modules Tab ──────────────────────────────────────────────────────

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  type: string;
  url: string;
  order: number;
  /** 0179. Required modules gate the Participant rung; optional ones do not. */
  mandatory?: boolean;
}

const TRAINING_TYPES = ["Video", "Article", "Practice", "Workshop", "Live Session"];

function TrainingModulesTab({ password }: { password: string }) {
  const [mods, setMods] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Partial<TrainingModule>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/training-modules`, { headers: authHeaders(password) });
      const data = await res.json();
      setMods(Array.isArray(data) ? data : []);
    } catch {
      setMods([]);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (m: TrainingModule) => {
    setEditingId(m.id);
    setDraft({ ...m });
  };

  const startNew = () => {
    setEditingId("new");
    setDraft({ title: "", description: "", type: "Video", url: "", mandatory: true, order: mods.length + 1 });
  };

  const cancelEdit = () => { setEditingId(null); setDraft({}); };

  const save = async () => {
    if (!draft.title || !draft.type) {
      toast.error("Title and type are required");
      return;
    }
    try {
      if (editingId === "new") {
        const res = await fetch(`${API_BASE}/admin/training-modules`, {
          method: "POST",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error();
      } else if (editingId) {
        const res = await fetch(`${API_BASE}/admin/training-modules/${editingId}`, {
          method: "PUT",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify(draft),
        });
        if (!res.ok) throw new Error();
      }
      toast.success("Saved");
      cancelEdit();
      load();
    } catch {
      toast.error("Save failed");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this module?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/training-modules/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The module is still here.`));
        return;
      }
      toast.success("Deleted");
      load();
    } catch {
      toast.error("That did not reach the server. The module is still here.");
    }
  };

  const renderForm = () => (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Title</label>
          <input
            type="text"
            value={draft.title ?? ""}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Type</label>
          <select
            value={draft.type ?? "Video"}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          >
            {TRAINING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Description</label>
        <textarea
          value={draft.description ?? ""}
          rows={2}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">URL</label>
          <input
            type="text"
            value={draft.url ?? ""}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://..."
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Order</label>
          <input
            type="number"
            value={draft.order ?? 0}
            onChange={(e) => setDraft({ ...draft, order: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Required to climb</label>
          {/* The one lever that turns the Participant rung on and off. A member
              states for themselves what they have finished; the REQUIRED ones
              are what moves them onto the next rung. Absent reads as required,
              which is what every module shipped before 0179 is. */}
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draft.mandatory !== false}
              onChange={(e) => setDraft({ ...draft, mandatory: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300"
            />
            Finishing this one is required
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 transition-colors"
        >
          <Save className="w-4 h-4" /> Save
        </button>
        <button
          onClick={cancelEdit}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Training Modules</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage what shows on the /training page.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startNew}
            className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 transition-colors"
          >
            Add Module
          </button>
        )}
      </div>

      {editingId === "new" && <div className="mb-6">{renderForm()}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-2">
          {mods.map((m) => editingId === m.id ? (
            <div key={m.id}>{renderForm()}</div>
          ) : (
            <div key={m.id} className="flex items-center justify-between border border-gray-200 rounded-xl px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-6">#{m.order}</span>
                  <span className="font-medium text-gray-900 truncate">{m.title}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-deep/10 text-teal-deep">
                    {m.type}
                  </span>
                </div>
                {m.url && <div className="text-xs text-gray-400 mt-0.5 truncate">{m.url}</div>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEdit(m)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(m.id)}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FAQ Admin Tab (NEW-1) ─────────────────────────────────────────────────────

interface FaqItem { id: string; question: string; answer: string }
const FAQ_PATHWAYS: { id: "investor" | "steward" | "resident" | "prosperity"; label: string }[] = [
  { id: "investor", label: "Investor" },
  { id: "steward", label: "Steward" },
  { id: "resident", label: "Resident" },
  { id: "prosperity", label: "Prosperity" },
];

function FaqAdminTab({ password }: { password: string }) {
  const [pathway, setPathway] = useState<"investor" | "steward" | "resident" | "prosperity">("investor");
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ question: string; answer: string }>({ question: "", answer: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/faqs/${pathway}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    setLoading(false);
  }, [pathway]);

  useEffect(() => { load(); }, [load]);

  /*
   * The list moved first and the answer was thrown away, so a refused save
   * left the screen holding a version of the FAQ the server never took. The
   * old `catch` only ran on a dead network; a 403 or a 500 resolved normally
   * and changed nothing on screen.
   */
  const persist = async (next: FaqItem[]) => {
    const before = items;
    setItems(next);
    try {
      const res = await fetch(`${API_BASE}/admin/faqs/${pathway}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setItems(before);
        toast.error(refusal(body, `The server refused that (${res.status}). The list is back to what it holds.`));
      }
    } catch {
      setItems(before);
      toast.error("That did not reach the server. The list is back to what it holds.");
    }
  };

  const add = async () => {
    if (!newQ.trim()) { toast.error("Question required"); return; }
    try {
      const res = await fetch(`${API_BASE}/admin/faqs/${pathway}`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ question: newQ.trim(), answer: newA.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewQ(""); setNewA("");
      toast.success("Added");
      load();
    } catch { toast.error("Add failed"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/faqs/${pathway}/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The question is still here.`));
        return;
      }
      toast.success("Deleted");
      load();
    } catch { toast.error("That did not reach the server. The question is still here."); }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const next = items.map((it) => it.id === editingId ? { ...it, question: editDraft.question, answer: editDraft.answer } : it);
    persist(next);
    setEditingId(null);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">FAQs</h2>
        <p className="text-sm text-gray-500">Manage the Common Questions section shown on each journey page.</p>
      </div>

      <div className="flex items-center gap-2 mb-6 border-b border-gray-200">
        {FAQ_PATHWAYS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPathway(p.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              pathway === p.id
                ? "border-teal-deep text-teal-deep"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 space-y-3">
        <input
          type="text"
          value={newQ}
          onChange={(e) => setNewQ(e.target.value)}
          placeholder="Question"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
        />
        <textarea
          value={newA}
          onChange={(e) => setNewA(e.target.value)}
          placeholder="Answer"
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-y"
        />
        <button
          onClick={add}
          className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Question
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No questions yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={item.id} className="border border-gray-200 rounded-xl px-5 py-4">
              {editingId === item.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editDraft.question}
                    onChange={(e) => setEditDraft({ ...editDraft, question: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
                  />
                  <textarea
                    value={editDraft.answer}
                    onChange={(e) => setEditDraft({ ...editDraft, answer: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-y"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-3 py-1.5 text-sm bg-teal-deep text-white rounded-lg">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button onClick={() => move(idx, -1)} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:justify-center" disabled={idx === 0}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => move(idx, 1)} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:justify-center" disabled={idx === items.length - 1}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 mb-1">{item.question}</div>
                    <div className="text-sm text-gray-600 leading-relaxed">{item.answer}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingId(item.id); setEditDraft({ question: item.question, answer: item.answer }); }}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      Edit
                    </button>
                    <button onClick={() => remove(item.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Milestones Admin Tab (NEW-3) ──────────────────────────────────────────────

interface Milestone {
  id: string;
  phase: string;
  title: string;
  description: string;
  status: "complete" | "in-progress" | "upcoming" | "future";
  completedDate: string | null;
  updateNote: string;
  order: number;
  updatedAt?: string;
}

/** Days since a milestone was last touched, or null if it's never been edited. */
function daysSinceUpdate(m: Milestone): number | null {
  if (!m.updatedAt) return null;
  const t = Date.parse(m.updatedAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/** In-progress work that nobody has touched in a while is how a board quietly
 *  goes stale — surface it rather than waiting for someone to notice. */
const STALE_AFTER_DAYS = 21;

function MilestonesAdminTab({ password }: { password: string }) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Milestone>>({ phase: "Phase 1", title: "", description: "", status: "upcoming" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/milestones`, { headers: authHeaders(password) });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const update = async (id: string, patch: Partial<Milestone>) => {
    setItems((prev) => prev.map((m) => m.id === id ? { ...m, ...patch } : m));
    // Same shape as the FAQ list above: optimistic, and the answer was
    // dropped. `load()` is the rollback here, because the server holds the
    // whole row and re-reading it is cheaper than remembering the old one.
    try {
      const res = await fetch(`${API_BASE}/admin/milestones/${id}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The row is back to what it holds.`));
        load();
      }
    } catch { toast.error("That did not reach the server. The row is back to what it holds."); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this milestone?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/milestones/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The milestone is still here.`));
        return;
      }
      toast.success("Deleted");
      load();
    } catch { toast.error("That did not reach the server. The milestone is still here."); }
  };

  const add = async () => {
    if (!draft.title || !draft.phase) { toast.error("Title and phase required"); return; }
    try {
      const res = await fetch(`${API_BASE}/admin/milestones`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      toast.success("Added");
      setAdding(false);
      setDraft({ phase: "Phase 1", title: "", description: "", status: "upcoming" });
      load();
    } catch { toast.error("Add failed"); }
  };

  // Group by phase
  const grouped = items.reduce<Record<string, Milestone[]>>((acc, m) => {
    (acc[m.phase] ??= []).push(m);
    return acc;
  }, {});

  const stale = items.filter((m) => {
    const d = daysSinceUpdate(m);
    return m.status === "in-progress" && d !== null && d >= STALE_AFTER_DAYS;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Milestones</h2>
          <p className="text-sm text-gray-500 mt-1">Edit the Build Progress tracker shown on the homepage.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90">
            Add Milestone
          </button>
        )}
      </div>

      {stale.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>{stale.length} milestone{stale.length === 1 ? "" : "s"} not updated in over {STALE_AFTER_DAYS} days:</strong>{" "}
          {stale.map((m) => m.title).join(", ")}. A quick note keeps the public tracker honest.
        </div>
      )}

      {adding && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={draft.phase ?? ""}
              onChange={(e) => setDraft({ ...draft, phase: e.target.value })}
              placeholder="Phase (e.g. Phase 1)"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
            <input
              type="text"
              value={draft.title ?? ""}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Title"
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y"
          />
          <select
            value={draft.status ?? "upcoming"}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Milestone["status"] })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="complete">Complete</option>
            <option value="in-progress">In Progress</option>
            <option value="upcoming">Planned</option>
            <option value="future">Future</option>
          </select>
          <div className="flex gap-2">
            <button onClick={add} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm">Add</button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([phase, mils]) => (
            <div key={phase}>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{phase}</h3>
              <div className="space-y-2">
                {mils.map((m) => (
                  <div key={m.id} className="border border-gray-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={m.title}
                          onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, title: e.target.value } : x))}
                          onBlur={(e) => update(m.id, { title: e.target.value })}
                          className="w-full font-semibold text-gray-900 px-2 py-1 border border-transparent hover:border-gray-200 rounded focus:border-teal-deep/40 focus:outline-none"
                        />
                        <textarea
                          value={m.description}
                          onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, description: e.target.value } : x))}
                          onBlur={(e) => update(m.id, { description: e.target.value })}
                          rows={2}
                          className="w-full text-sm text-gray-600 px-2 py-1 border border-transparent hover:border-gray-200 rounded focus:border-teal-deep/40 focus:outline-none resize-y mt-1"
                        />
                      </div>
                      <button onClick={() => remove(m.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={m.status}
                        onChange={(e) => update(m.id, { status: e.target.value as Milestone["status"] })}
                        className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                      >
                        <option value="complete">Complete</option>
                        <option value="in-progress">In Progress</option>
                        <option value="upcoming">Planned</option>
                        <option value="future">Future</option>
                      </select>
                      <input
                        type="text"
                        value={m.completedDate ?? ""}
                        onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, completedDate: e.target.value || null } : x))}
                        onBlur={(e) => update(m.id, { completedDate: e.target.value || null })}
                        placeholder="YYYY-MM (if complete)"
                        className="px-2 py-1 text-xs border border-gray-200 rounded"
                      />
                      <input
                        type="text"
                        value={m.phase}
                        onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, phase: e.target.value } : x))}
                        onBlur={(e) => update(m.id, { phase: e.target.value })}
                        placeholder="Phase"
                        className="px-2 py-1 text-xs border border-gray-200 rounded"
                      />
                    </div>
                    <input
                      type="text"
                      value={m.updateNote}
                      onChange={(e) => setItems((prev) => prev.map((x) => x.id === m.id ? { ...x, updateNote: e.target.value } : x))}
                      onBlur={(e) => update(m.id, { updateNote: e.target.value })}
                      placeholder="Status note (optional, shown on homepage)"
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
                    />
                    {(() => {
                      const d = daysSinceUpdate(m);
                      if (d === null) return null;
                      const isStale = m.status === "in-progress" && d >= STALE_AFTER_DAYS;
                      return (
                        <p className={`text-[11px] ${isStale ? "text-amber-600 font-medium" : "text-gray-400"}`}>
                          {d === 0 ? "Updated today" : `Updated ${d} day${d === 1 ? "" : "s"} ago`}
                          {isStale && ", worth a fresh look"}
                        </p>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Visit Program Admin Tab (NEW-5) ───────────────────────────────────────────

interface VisitType {
  id: string;
  title: string;
  duration: string;
  format: string;
  cost: string;
  description: string;
  cta_label: string;
  cta_url: string;
  order: number;
}

interface VisitConfig {
  hero_subtitle: string;
  visit_types: VisitType[];
  logistics: { getting_there: string; accommodation: string; what_to_bring: string; contact_note: string };
}

function VisitAdminTab({ password }: { password: string }) {
  const [cfg, setCfg] = useState<VisitConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/visit-config`, { headers: authHeaders(password) });
      setCfg(await res.json());
    } catch { toast.error("Failed to load"); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/visit-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(cfg),
      });
      // The server refuses a call-to-action link that points into the investor
      // vault, and it says which door is open in a whole sentence. Throwing an
      // empty Error here turned that sentence into "Save failed", so an admin
      // met a wall with no reason on it and no way to guess the reason.
      if (!res.ok) throw new Error(await saveProblem(res));
      toast.success("Saved");
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Save failed"); }
    setSaving(false);
  };

  const updateVisitType = (idx: number, patch: Partial<VisitType>) => {
    if (!cfg) return;
    const next = { ...cfg, visit_types: cfg.visit_types.map((v, i) => i === idx ? { ...v, ...patch } : v) };
    setCfg(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Visit Program</h2>
          <p className="text-sm text-gray-500 mt-1">Controls the /visit page.</p>
        </div>
        <button onClick={save} disabled={saving || loading} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {loading || !cfg ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Hero Subtitle</label>
            <textarea
              value={cfg.hero_subtitle}
              onChange={(e) => setCfg({ ...cfg, hero_subtitle: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y"
            />
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">Visit Types</h3>
            <div className="space-y-3">
              {cfg.visit_types.map((v, idx) => (
                <div key={v.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={v.title} onChange={(e) => updateVisitType(idx, { title: e.target.value })} placeholder="Title" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="text" value={v.duration} onChange={(e) => updateVisitType(idx, { duration: e.target.value })} placeholder="Duration" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="text" value={v.format} onChange={(e) => updateVisitType(idx, { format: e.target.value })} placeholder="Format" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="text" value={v.cost} onChange={(e) => updateVisitType(idx, { cost: e.target.value })} placeholder="Cost" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  </div>
                  <textarea value={v.description} onChange={(e) => updateVisitType(idx, { description: e.target.value })} placeholder="Description" rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={v.cta_label} onChange={(e) => updateVisitType(idx, { cta_label: e.target.value })} placeholder="CTA Label" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="text" value={v.cta_url} onChange={(e) => updateVisitType(idx, { cta_url: e.target.value })} placeholder="https://..., mailto:..., or /visit. Blank shows the contact form" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">Logistics</h3>
            <div className="space-y-3">
              {(["getting_there", "accommodation", "what_to_bring", "contact_note"] as const).map((k) => (
                <div key={k}>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{k.replace(/_/g, " ")}</label>
                  <textarea
                    value={cfg.logistics[k]}
                    onChange={(e) => setCfg({ ...cfg, logistics: { ...cfg.logistics, [k]: e.target.value } })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Investor Summary Admin Tab (NEW-6) ────────────────────────────────────────

interface SummaryDetail { id: string; label: string; value: string; note: string; icon: string }
interface SummaryConfig {
  headline: string;
  intro: string;
  details: SummaryDetail[];
  disclaimer: string;
  cta_label: string;
  cta_url: string;
}

function InvestorSummaryAdminTab({ password }: { password: string }) {
  const [cfg, setCfg] = useState<SummaryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/investor-summary`, { headers: authHeaders(password) });
      setCfg(await res.json());
    } catch { toast.error("Failed to load"); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/investor-summary`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(cfg),
      });
      // Same reason as VisitAdminTab above: this page is public, the server
      // refuses a CTA that would publish a vault document, and the admin has
      // to be able to read why.
      if (!res.ok) throw new Error(await saveProblem(res));
      toast.success("Saved");
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : "Save failed"); }
    setSaving(false);
  };

  const updateDetail = (idx: number, patch: Partial<SummaryDetail>) => {
    if (!cfg) return;
    setCfg({ ...cfg, details: cfg.details.map((d, i) => i === idx ? { ...d, ...patch } : d) });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Investor Financial Summary</h2>
          <p className="text-sm text-gray-500 mt-1">Plain-language summary shown on /investor.</p>
        </div>
        <button onClick={save} disabled={saving || loading} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {loading || !cfg ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Headline</label>
            <input type="text" value={cfg.headline} onChange={(e) => setCfg({ ...cfg, headline: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Intro</label>
            <textarea value={cfg.intro} onChange={(e) => setCfg({ ...cfg, intro: e.target.value })} rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">Details</h3>
            <div className="space-y-3">
              {cfg.details.map((d, idx) => (
                <div key={d.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                  <div className="text-xs uppercase tracking-widest text-gray-400">{d.id}</div>
                  <input type="text" value={d.label} onChange={(e) => updateDetail(idx, { label: e.target.value })} placeholder="Label" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <input type="text" value={d.value} onChange={(e) => updateDetail(idx, { value: e.target.value })} placeholder="Value (large text)" className="w-full px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg" />
                  <textarea value={d.note} onChange={(e) => updateDetail(idx, { note: e.target.value })} placeholder="Explanation note" rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Disclaimer</label>
            <textarea value={cfg.disclaimer} onChange={(e) => setCfg({ ...cfg, disclaimer: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">CTA Label</label>
              <input type="text" value={cfg.cta_label} onChange={(e) => setCfg({ ...cfg, cta_label: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">CTA URL</label>
              <input type="text" value={cfg.cta_url} onChange={(e) => setCfg({ ...cfg, cta_url: e.target.value })} placeholder="https://..., mailto:..., or /visit. Blank hides the button" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Admin: Quest Claims consent queue ────────────────────────────────────

function QuestClaimsTab({ password }: { password: string }) {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/quest-claims`, { headers: authHeaders(password) });
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch { setClaims([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const consent = async (id: string, approve: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/quest-claims/${id}/consent`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ approve, amount: amounts[id] ?? 50 }),
      });
      // Surface what the server actually said. The refusals here are the
      // informative ones — no self-consent, work not submitted yet, amount
      // outside what the board advertises — and "Action failed" taught the
      // steward nothing about which rule they had just met.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Action failed");
      }
      toast.success(approve ? "Consented and credited" : "Declined");
      load();
    } catch (e: any) { toast.error(e?.message || "Action failed"); }
  };

  const pending = claims.filter((c) => c.status === "submitted");
  const active = claims.filter((c) => c.status === "claimed");
  const resolved = claims.filter((c) => c.status === "consented" || c.status === "declined");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Quest Claims</h2>
        <p className="text-sm text-gray-500 mt-1">Consent releases the reward. Value only moves with a human yes.</p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <div className="space-y-8">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Awaiting consent ({pending.length})</h3>
            {pending.length === 0 && <p className="text-sm text-gray-400">Nothing waiting.</p>}
            <div className="space-y-2">
              {pending.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="font-medium text-gray-900">{c.userName}</span>
                    <span className="text-xs text-gray-400">{new Date(c.submittedAt ?? c.claimedAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-1">{c.questTitle}</p>
                  {c.note && <p className="text-sm text-gray-500 italic mb-1">"{c.note}"</p>}
                  {c.artifactUrl && (
                    <a href={c.artifactUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-teal-deep underline break-all">
                      {c.artifactUrl}
                    </a>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="number"
                      min={0}
                      value={amounts[c.id] ?? 50}
                      onChange={(e) => setAmounts({ ...amounts, [c.id]: parseInt(e.target.value) || 0 })}
                      className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                    />
                    <button onClick={() => consent(c.id, true)} className="px-3 py-1.5 text-sm bg-teal-deep text-white rounded-lg">
                      Consent + credit
                    </button>
                    <button onClick={() => consent(c.id, false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">In progress ({active.length})</h3>
            {active.map((c) => (
              <p key={c.id} className="text-sm text-gray-600 py-1">{c.userName} · {c.questTitle}</p>
            ))}
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Resolved ({resolved.length})</h3>
            {resolved.slice(0, 10).map((c) => (
              <p key={c.id} className="text-sm text-gray-400 py-1">
                {c.userName} · {c.questTitle} · {c.status}{c.amount ? ` (+${c.amount})` : ""}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The quest LIBRARY, not the claims on it.
 *
 * Full CRUD existed on the server from the beginning and no admin surface
 * ever called it, so the only quests a village could ever have were the
 * seeded ones — carrying the seed's own copy, including the founding
 * village's name — and the Setup Wizard pointed at the claims tab as if that
 * were where you edit them. Everything here is live to members immediately;
 * there is no deploy in the loop.
 */
function QuestsTab({ password }: { password: string }) {
  const [quests, setQuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState({ title: "", description: "", gratitude: "", circle: "" });
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";
  // Suggestions come from the board itself, so an admin reuses the circle
  // names already in play instead of coining a near-miss the chips ignore.
  const questCircles = useMemo(
    () => Array.from(new Set(quests.map((q) => q?.circle).filter(Boolean))).sort() as string[],
    [quests],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quests`);
      const data = await res.json();
      setQuests(Array.isArray(data) ? data : []);
    } catch { setQuests([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body?: unknown, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error || "That did not work");
      }
      return await res.json();
    } catch (e: any) {
      toast.error(e?.message || "That did not work");
      return null;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Quests</h2>
        <p className="text-sm text-gray-500 mt-1">
          The board members see. Edits are live immediately, no deploy. A quest with claims in
          flight cannot be deleted until those claims are consented or declined.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Post a quest</h3>
        <div className="grid sm:grid-cols-5 gap-2 items-end">
          <label className="text-xs text-gray-500">Title
            <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          <label className="text-xs text-gray-500">What it asks for
            <input value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          <label className="text-xs text-gray-500">Reward (e.g. 50 or 50-100)
            <input value={adding.gratitude} onChange={(e) => setAdding({ ...adding, gratitude: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          {/* The state carried a circle from the day this form shipped and no
              field was ever bound to it, so every admin-posted quest landed
              with an empty circle: filtered off every chip on the board, and
              unplaceable on the map. */}
          <label className="text-xs text-gray-500">Circle
            <input value={adding.circle} onChange={(e) => setAdding({ ...adding, circle: e.target.value })}
              list="quest-circles" placeholder="Which circle?" className={`${inputCls} w-full mt-1`} />
            <datalist id="quest-circles">
              {questCircles.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <button
            onClick={async () => {
              if (!adding.title.trim()) return toast.error("Give it a title");
              const d = await call("/admin/quests", adding);
              if (d) {
                forgetExamplesCache("quests");
                toast.success("Posted");
                setAdding({ title: "", description: "", gratitude: "", circle: "" });
                load();
              }
            }}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
          >
            Post quest
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : quests.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No quests on the board yet.</div>
      ) : (
        <div className="space-y-3">
          {quests.map((q: any) => {
            const d = draft[q.id] ?? {
              ...q,
              stepsText: listToLines(q.steps),
              tipsText: listToLines(q.tips),
            };
            // The dirty check projects every editable field, story layer
            // included, so a change buried in a collapsed section still
            // lights the Save button.
            const proj = (x: any, stepsText: string, tipsText: string) =>
              JSON.stringify({
                t: x.title, de: x.description, g: x.gratitude, s: x.status, c: x.circle,
                su: x.subtitle ?? "", st: x.story ?? "", fs: x.firstStep ?? "",
                dv: x.deliverable ?? "", iu: x.imageUrl ?? "", im: x.impact ?? "",
                di: x.difficulty ?? "", du: x.duration ?? "",
                sl: stepsText, tl: tipsText,
              });
            const dirty =
              proj(d, d.stepsText ?? "", d.tipsText ?? "") !==
              proj(q, listToLines(q.steps), listToLines(q.tips));
            return (
              <div key={q.id} className="bg-white border border-gray-100 rounded-xl p-4">
                {/* On a fresh fork the whole board is examples. Without the
                    chip the admin found that out by editing one and reading
                    the 409 the edit route answers. */}
                {q.isExample && (
                  <p className="mb-2"><ExampleChip /></p>
                )}
                <div className="grid sm:grid-cols-5 gap-2 items-end">
                  <label className="text-xs text-gray-500">Title
                    <input value={d.title ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, title: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">What it asks for
                    <input value={d.description ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, description: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">Reward
                    <input value={d.gratitude ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, gratitude: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">Circle
                    <input value={d.circle ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, circle: e.target.value } })}
                      list="quest-circles" className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">Status
                    <select value={d.status ?? "Open"} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, status: e.target.value } })} className={`${inputCls} w-full mt-1`}>
                      <option value="Open">Open</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </label>
                </div>

                {/* The story layer (0068): everything a member reads on the
                    quest's own page. Collapsed by default so the board list
                    stays scannable; every field is optional and an empty one
                    simply does not render. */}
                <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                  <summary className="text-xs font-semibold text-gray-600 cursor-pointer select-none">
                    Story, effort, steps, and poster
                  </summary>
                  <div className="grid sm:grid-cols-2 gap-2 mt-3">
                    {/* Difficulty, duration and impact were in the save payload
                        and in the dirty check from the day the story layer
                        shipped, with no field bound to any of them. The server
                        took all three and a founder had no door to reach them,
                        so every admin-posted quest kept whatever the seed left
                        behind. Difficulty is the load-bearing one: ringFor
                        reads it to place the quest on the board. */}
                    <label className="text-xs text-gray-500">Difficulty
                      {/* A select, because the three words are a vocabulary
                          the board reads: QuestCard colours by them,
                          the Quests filter chips match on them exactly, and
                          ringFor compares against "Beginner" character for
                          character. A typed "beginner" would drop the colour
                          and move the quest out of Start here with nothing
                          said. */}
                      <select value={d.difficulty ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, difficulty: e.target.value } })} className={`${inputCls} w-full mt-1`}>
                        <option value="">Not set</option>
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                        {/* A stored value outside the three shows itself. A
                            select whose value matches no option renders blank,
                            which would read as "Not set" over a row that holds
                            something, and the founder would save the blank
                            believing they changed nothing. */}
                        {d.difficulty && !["Beginner", "Intermediate", "Advanced"].includes(d.difficulty) && (
                          <option value={d.difficulty}>{d.difficulty} (not one of the three)</option>
                        )}
                      </select>
                    </label>
                    <label className="text-xs text-gray-500">Time it takes
                      <input value={d.duration ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, duration: e.target.value } })} placeholder="90 minutes, Two mornings, Flexible" className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">Subtitle
                      <input value={d.subtitle ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, subtitle: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">First step
                      <input value={d.firstStep ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, firstStep: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500 sm:col-span-2">Why it matters
                      <textarea value={d.story ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, story: e.target.value } })} rows={3} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    {/* A textarea, because the quest page prints this as a
                        pull quote under Why it matters and the seeded ones run
                        to two full sentences. */}
                    <label className="text-xs text-gray-500 sm:col-span-2">What changes because of it
                      <textarea value={d.impact ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, impact: e.target.value } })} rows={2} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">Steps, one per line
                      <textarea value={d.stepsText ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, stepsText: e.target.value } })} rows={4} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">Tips, one per line
                      <textarea value={d.tipsText ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, tipsText: e.target.value } })} rows={4} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">What they'll share
                      <input value={d.deliverable ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, deliverable: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">Poster path
                      <input value={d.imageUrl ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, imageUrl: e.target.value } })} placeholder="/api/uploads/quest-01.webp" className={`${inputCls} w-full mt-1`} />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Beginner places this quest in the board's Start here ring. Any other setting, and an empty one, place it under The village. A stage floor or a role requirement moves it to Further in whatever you pick.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-2">
                    A poster comes through the village's own upload, so its path starts with /api/uploads/. Leave it empty and the card paints a scene from the quest's circle.
                  </p>
                </details>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    disabled={!dirty}
                    onClick={async () => {
                      const r = await call(`/admin/quests/${q.id}`, {
                        title: d.title, description: d.description, gratitude: d.gratitude,
                        status: d.status, circle: d.circle,
                        subtitle: d.subtitle ?? "", story: d.story ?? "", firstStep: d.firstStep ?? "",
                        deliverable: d.deliverable ?? "", imageUrl: d.imageUrl ?? "",
                        difficulty: d.difficulty ?? "", duration: d.duration ?? "", impact: d.impact ?? "",
                        steps: linesToList(d.stepsText ?? ""), tips: linesToList(d.tipsText ?? ""),
                      }, "PUT");
                      if (r) { toast.success("Saved"); setDraft({ ...draft, [q.id]: undefined }); load(); }
                    }}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete "${q.title}"? Members will no longer see it.`)) return;
                      const r = await call(`/admin/quests/${q.id}`, undefined, "DELETE");
                      if (r) { toast.success("Deleted"); load(); }
                    }}
                    className="text-sm text-red-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Game Admin: Players + stage grants ───────────────────────────────────────

const ROLE_STYLE: Record<string, string> = {
  founder: "bg-amber-100 text-amber-800 border-amber-200",
  admin: "bg-violet-100 text-violet-700 border-violet-200",
  member: "bg-gray-100 text-gray-500 border-gray-200",
};

function PlayersTab({ password }: { password: string }) {
  const { user: me } = useAuth();
  const iAmFounder = me?.role === "founder";
  const [players, setPlayers] = useState<any[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  /*
   * R90: THE FOUNDER ROLE ENDS WHEN THE VILLAGE STARTS ITS GAME, so who may
   * work the control below changes at that moment and this tab has to know it.
   * Before launch only a founder may change a role. After launch any
   * administrator may, and no new founder can be made.
   *
   * Read from the server rather than inferred from the roster, because a
   * client that guesses at a permission is a client that eventually disagrees
   * with the gate. `/api/game/mechanics` answers strangers and already carries
   * the fact, so this costs no new route and no token.
   */
  const [gameStarted, setGameStarted] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/game/config`),
        fetch(`${API_BASE}/game/mechanics`),
      ]);
      const p = await pRes.json();
      const c = await cRes.json();
      const m = await mRes.json();
      setPlayers(Array.isArray(p) ? p : []);
      setStages(c?.stages ?? []);
      setGameStarted(m?.gameStart?.started === true);
    } catch { setPlayers([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const grant = async (id: string, stageId: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/players/${id}/stage`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ stageId: stageId || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Stage updated");
      load();
    } catch { toast.error("Update failed"); }
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`Delete player ${email}? This removes their account. Historical quest claims and gratitude entries are kept.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/players/${id}`, {
        method: "DELETE",
        headers: authHeaders(password),
      });
      if (!res.ok) throw new Error();
      toast.success("Player deleted");
      load();
    } catch { toast.error("Delete failed"); }
  };

  const setRole = async (id: string, role: string, name: string) => {
    if (role === "founder" && !confirm(`Make ${name} a FOUNDER? Founders manage admins and can only be demoted by another founder.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/users/${id}/role`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(`${name} is now ${role}`);
      load();
    } catch (e: any) { toast.error(e?.message || "Role change failed"); }
  };

  const revokeSessions = async (id: string, name: string) => {
    if (!confirm(`Sign ${name} out everywhere? They keep their account and password; every active session dies.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/users/${id}/revoke-sessions`, {
        method: "POST",
        headers: authHeaders(password),
      });
      if (!res.ok) throw new Error();
      toast.success("Sessions revoked");
    } catch { toast.error("Revoke failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Players</h2>
        <p className="text-sm text-gray-500 mt-1">
          Stages compute automatically from real acts; grant the ceremony-based stages here.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : players.length === 0 ? (
        <p className="text-sm text-gray-400">No players yet.</p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <div className="font-medium text-gray-900">
                  {p.name}
                  {p.handle && <span className="text-gray-400 font-normal"> @{p.handle}</span>}
                </div>
                <div className="text-xs text-gray-400">{p.email} · joined {new Date(p.joinedAt).toLocaleDateString()}</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium border ${ROLE_STYLE[p.role] ?? ROLE_STYLE.member}`}>
                {p.role}
              </span>
              <span className="text-xs bg-teal-deep/10 text-teal-deep px-2 py-1 rounded-full font-medium">
                {stages.find((s) => s.id === p.stageComputed)?.name ?? p.stageComputed}
              </span>
              <span className="text-xs text-gray-500">{p.balance} earned</span>
              {(gameStarted || iAmFounder) && (
                <select
                  value={p.role}
                  onChange={(e) => setRole(p.id, e.target.value, p.name)}
                  title={
                    gameStarted
                      ? "Change this member's role. The founder role ended when the village started its Game, so an administrator is the most this can set"
                      : "Founders run the admins: change this member's role"
                  }
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  {/* Only while the role still exists, or on the row of
                      somebody who already holds it. After launch the server
                      refuses a new one, and an option that can only ever
                      produce a refusal is worse than no option. Dropping it
                      from a founder's OWN row would be worse again: the select
                      would have no option matching the value and would show
                      that person as a member beside a badge saying founder. */}
                  {(!gameStarted || p.role === "founder") && <option value="founder">founder</option>}
                </select>
              )}
              <button
                onClick={() => revokeSessions(p.id, p.name)}
                title="Sign this member out everywhere (their password keeps working)"
                className="text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 font-medium"
              >
                Sign out all
              </button>
              <select
                value={p.stageGranted ?? ""}
                onChange={(e) => grant(p.id, e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">No grant</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>Grant: {s.name}</option>
                ))}
              </select>
              <button
                onClick={() => remove(p.id, p.email)}
                className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 font-medium"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Game Admin: Role appointments (S3 — no more curl) ────────────────────────

function GameRolesTab({ password }: { password: string }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
      ]);
      const r = await rRes.json();
      const p = await pRes.json();
      setRoles(Array.isArray(r) ? r : []);
      setPlayers(Array.isArray(p) ? p : []);
    } catch { setRoles([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const change = async (roleId: string, userId: string, action: "add" | "remove") => {
    try {
      const res = await fetch(`${API_BASE}/admin/roles/${roleId}/holders`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ userId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(action === "add" ? "Appointed" : "Removed");
      setPicking((prev) => ({ ...prev, [roleId]: "" }));
      load();
    } catch (e: any) {
      // The stage-floor refusal comes back with the member's name and the
      // stage the role asks for — show it verbatim, it is written for humans.
      toast.error(e?.message || "Change failed");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Game Roles</h2>
        <p className="text-sm text-gray-500 mt-1">
          Appoint and remove role holders. Appointments respect each role's stage
          floor; role grants are one of the two ways a member gains capabilities.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : roles.length === 0 ? (
        <p className="text-sm text-gray-400">No roles defined yet.</p>
      ) : (
        <div className="space-y-4">
          {roles.map((r) => (
            <div key={r.id} className="border border-gray-200 rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  {r.description && <p className="text-sm text-gray-500 mt-0.5 max-w-xl">{r.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.minStage && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      stage ≥ {r.minStage}
                    </span>
                  )}
                  {(r.capabilities ?? []).map((c: string) => (
                    <span key={c} className="text-xs bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full font-mono">
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {(r.holders ?? []).length === 0 && (
                  <span className="text-xs text-gray-400 italic">Vacant, an open call</span>
                )}
                {(r.holders ?? []).map((h: any) => (
                  <span key={h.userId} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 pl-2.5 pr-1 py-1 rounded-full">
                    {h.name}
                    <button
                      onClick={() => change(r.id, h.userId, "remove")}
                      title="Remove from this role"
                      className="w-4 h-4 rounded-full hover:bg-gray-300 text-gray-500 flex items-center justify-center"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value={picking[r.id] ?? ""}
                  onChange={(e) => setPicking((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="">Appoint a member…</option>
                  {players
                    .filter((p) => !(r.holders ?? []).some((h: any) => h.userId === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.handle ? ` (@${p.handle})` : ""}</option>
                    ))}
                </select>
                <button
                  onClick={() => picking[r.id] && change(r.id, picking[r.id], "add")}
                  disabled={!picking[r.id]}
                  className="text-xs bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
                >
                  Appoint
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modules (S13): the catalog, lifecycles, and the Hypha integration card ───
//
// BUILDER_GUIDE_URL and POOL_REASON_COPY moved to shared/moduleCatalog.ts
// (L1): the public library renders the same words, and shared/ is where
// check-voice holds them.

const LIFECYCLES = ["off", "preview", "members", "public"] as const;
// Keyed by the union, not by `string`: the compiler now owns the promise that
// every lifecycle has a sentence, so a fifth one is a build error rather than a
// blank paragraph where the who-can-see-this line belongs.
const LIFECYCLE_HINT: Record<ModuleLifecycle, string> = {
  off: "Routes 404, no nav, no admin surface.",
  preview: "Admins only. Invisible to everyone else.",
  members: "Signed-in members only.",
  public: "Everyone. Capability gates still apply.",
};

function ModulesTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  // The catalog controls. Every filter defaults to "all", so a village that has
  // never opened this page sees the same list it saw before.
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  /** Which listing has its detail open. One at a time, so the page stays readable. */
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/modules`, { headers: authHeaders(password) });
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const setLifecycle = async (mod: any, lifecycle: string) => {
    if (mod.legalReview && mod.lifecycle === "off" && lifecycle !== "off") {
      const sure = window.confirm(
        `${mod.name} touches funds. Before enabling: credits are non-withdrawable and non-refundable to fiat; ` +
          "tested backups, per-admin identities, and legal review are preconditions. Continue?",
      );
      if (!sure) return;
    }
    setBusy(mod.id);
    try {
      const res = await fetch(`${API_BASE}/admin/modules/${mod.id}/lifecycle`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ lifecycle }),
      });
      const d = await res.json();
      if (!res.ok) {
        // A missing dependency is the one refusal the server cannot phrase
        // alone, because the fix is a list of other modules. The trailing stop
        // comes off before the sentence is extended, so a unified body that
        // already ends in one does not print "..". Every other refusal,
        // `dependents` included, now carries its own sentence and is printed
        // as it stands.
        if (d.missing?.length) toast.error(`${refusal(d, "Change refused").replace(/\.$/, "")}. Enable ${d.missing.join(", ")} first.`);
        else toast.error(refusal(d, "Change refused"));
      } else {
        toast.success(`${mod.name} is now ${lifecycle}`);
        // The nav rail and the Go-live card share one reader; tell it the
        // world moved so a turned-on module's tab appears without a reload.
        window.dispatchEvent(new Event("modules:changed"));
      }
      load();
    } catch { toast.error("Change failed"); }
    setBusy("");
  };

  /**
   * Clear a module's standing examples without publishing a decoy first.
   * One-way, so it asks — and it says what "for good" means, because the
   * button cannot be undone by turning the module off and on again.
   */
  const clearExamples = async (mod: any) => {
    // The route retires the PAIR, and the question named one module, so a
    // founder clearing the forum was never told the feed empties with it.
    // Only name a twin that is actually holding examples right now.
    const twins = (RETIRES_WITH[mod.id] ?? [])
      .map((id) => (data?.modules ?? []).find((m: any) => m.id === id))
      .filter((m: any) => m?.showingExamples)
      .map((m: any) => String(m.name));
    const sure = window.confirm(
      `Clear the standing examples from ${mod.name}?\n\n` +
        (twins.length
          ? `This clears ${twins.join(" and ")} too: they are lenses over the same rows, so one cannot keep its examples while the other loses them.\n\n`
          : "") +
        "They are removed permanently. Publishing your first real item would " +
        "have done this anyway; this just does it now, leaving the module empty.",
    );
    if (!sure) return;
    setBusy(mod.id);
    try {
      const res = await fetch(`${API_BASE}/admin/modules/${mod.id}/examples/clear`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(refusal(d, "Could not clear the examples"));
      } else {
        toast.success(`${mod.name}: ${d.removed} example row(s) cleared`);
        // The member-facing banner reads its own endpoint and would otherwise
        // keep labelling a module whose rows this button just deleted, until
        // whoever is on that page happened to reload it. Only on success: a
        // partial pass leaves the rows AND the tombstone, so the label has to
        // stay. Paired, because the route retires the pair: the forum and the
        // feed share a table and a category, so clearing one alone left the
        // other's rows on the same page with the banner already gone.
        // `confirmed` because this answer IS the server's, awaited: there is
        // nothing left to reconcile with a poll.
        forgetExamplesCache(mod.id, { confirmed: true });
      }
      load();
    } catch { toast.error("Could not clear the examples"); }
    setBusy("");
  };

  const demoted = (data?.modules ?? []).filter((m: any) => m.demotedBecause?.length);
  const showingExamples = (data?.modules ?? []).filter((m: any) => m.showingExamples);

  // ── The catalog ────────────────────────────────────────────────────────────
  const all: any[] = data?.modules ?? [];
  /** A village running something that is no longer offered needs telling once, at the top. */
  const withdrawnAndOn = all.filter((m: any) => m.withdrawn && m.lifecycle !== "off");

  /*
   * A filter appears only once the catalog holds more than one answer for it.
   *
   * Eighteen modules that are all `included`, all free and all member-pii would
   * otherwise render three dropdowns that can only ever return everything, plus
   * a price filter whose "paid" option matches nothing. The toolbar grows as
   * the library does, which is the honest version of a store front.
   */
  const distinct = (pick: (m: any) => string | null | undefined): string[] =>
    Array.from(new Set(all.map(pick).filter((v): v is string => !!v))).sort();
  const tiers = distinct((m) => m.tier);
  const domains = distinct((m) => m.provides);
  const dataClasses = distinct((m) => m.dataClass);
  const prices = distinct((m) => (m.pricing && m.pricing.amount > 0 ? "paid" : "free"));

  const needle = query.trim().toLowerCase();
  const visible = all.filter((m: any) => {
    if (needle) {
      const hay = [m.name, m.description, m.id, m.builtBy, m.vendor?.legalName, m.provides]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (tierFilter !== "all" && m.tier !== tierFilter) return false;
    if (domainFilter !== "all" && (m.provides ?? "") !== domainFilter) return false;
    if (dataFilter !== "all" && m.dataClass !== dataFilter) return false;
    if (priceFilter !== "all" && (m.pricing && m.pricing.amount > 0 ? "paid" : "free") !== priceFilter) return false;
    return true;
  });
  const filtered = needle !== "" || tierFilter !== "all" || domainFilter !== "all" || dataFilter !== "all" || priceFilter !== "all";
  const clearFilters = () => {
    setQuery(""); setTierFilter("all"); setDomainFilter("all"); setDataFilter("all"); setPriceFilter("all");
  };

  /**
   * A successor named by its NAME. `replacedBy` carries a module id because an
   * id is what the registry can validate against; showing that id to a founder
   * would print something like "village-map replaces it" where the product
   * everywhere else says Village Map. The server's 409 resolves it the same
   * way, so the two read alike.
   */
  const successorName = (id: string | null | undefined): string | null =>
    id ? (all.find((x: any) => x.id === id)?.name ?? id) : null;

  /**
   * The five shelves (L1): the same grouping the public library renders,
   * filters and search applying within them. A module whose group the
   * shelves do not claim stays visible on the last shelf instead of
   * vanishing; the catalog test upstream makes that a cannot-happen.
   */
  const shelves = MODULE_GROUPS.map((group, gi) => ({
    group,
    items: [
      ...visible.filter((m: any) => m.group === group.id),
      ...(gi === MODULE_GROUPS.length - 1
        ? visible.filter((m: any) => !MODULE_GROUPS.some((g) => g.id === m.group))
        : []),
    ],
  })).filter((s) => s.items.length > 0);

  /*
   * Mobile first, because most of this audience is on mobile Safari.
   *
   * Two iOS rules drive every number here. A form control under 16px makes
   * Safari ZOOM the whole page on focus, which on a filter row means the
   * catalog jumps sideways the moment somebody taps it, so the base size is
   * `text-base` and desktop shrinks to the existing `text-xs` at `sm:`. And a
   * touch target under 44px is a target people miss, so controls carry
   * `min-h-[44px]` on a phone and drop it on a pointer device.
   *
   * The filters are half-width on a phone so two sit per row within thumb
   * reach, and full auto width from `sm:` up.
   */
  const SELECT =
    "text-base min-h-[44px] flex-1 min-w-[45%] sm:text-xs sm:min-h-0 sm:flex-none sm:min-w-0 " +
    "border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-deep/40";
  const PILL = "ml-2 text-[10px] px-1.5 py-0.5 rounded-full";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Modules</h2>
        <p className="text-sm text-gray-500 mt-1">
          What this village runs. Everything ships off; each step up widens who can
          see it. Off modules contribute nothing: no routes, no nav, no settings.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-600">Loading...</div> : !data ? (
        <p className="text-sm text-red-600">Could not load modules.</p>
      ) : (
        <div className="space-y-5">
          {(demoted.length > 0 || (data.orphans ?? []).length > 0) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {demoted.map((m: any) => (
                <p key={m.id}>
                  <strong>{m.name}</strong> is configured {m.lifecycle} but requires{" "}
                  {m.demotedBecause.join(", ")}. It is being served as OFF until that is resolved.
                </p>
              ))}
              {(data.orphans ?? []).length > 0 && (
                <p>Stored settings reference unknown module id(s): {data.orphans.join(", ")} (ignored).</p>
              )}
            </div>
          )}

          {withdrawnAndOn.length > 0 && (
            <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900">
              <p className="font-medium">
                {withdrawnAndOn.length === 1 ? "One module you run is" : `${withdrawnAndOn.length} modules you run are`} no longer offered.
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                Withdrawn means withdrawn from the catalog. Yours keeps running exactly as it is, and
                nothing about it changes today. What you cannot do is turn it back on once you switch
                it off, so plan the move before you do.
              </p>
              <ul className="mt-2 text-xs space-y-1">
                {withdrawnAndOn.map((m: any) => (
                  <li key={m.id}>
                    <strong>{m.name}</strong>, withdrawn {m.withdrawn.since}
                    {m.withdrawn.replacedBy ? `. ${successorName(m.withdrawn.replacedBy)} replaces it` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showingExamples.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Some modules are showing standing examples.</p>
              <p className="mt-1 text-xs leading-relaxed">
                Platform-authored content so a module is never empty when you first
                open it. Nobody in this village made it, nothing anyone does to it
                takes effect, and it clears itself the moment you publish something
                real there. Clear it early if you want to start from nothing. Either
                way it is gone for good.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {showingExamples.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => clearExamples(m)}
                    disabled={busy === m.id}
                    className="text-xs font-medium px-2.5 py-1 rounded-md border border-amber-400 bg-white/70 hover:bg-white disabled:opacity-50"
                  >
                    {busy === m.id ? "Clearing…" : `Clear ${m.name} examples`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border border-teal-deep/30 bg-teal-deep/5 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Hypha integration</h3>
            <p className="text-xs text-gray-600 mb-3">
              All governance, voting, and equity live on your Hypha DHO; modules link
              out and never rebuild it. Set the address in Game Mechanics → Hypha
              (hypha.org_url). Blank hides every Hypha button.
            </p>
            {data.hypha?.configured ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.hypha.links).map(([name, url]) => (
                  <a key={name} href={String(url)} target="_blank" rel="noopener noreferrer"
                    className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-teal-deep font-medium hover:bg-gray-50">
                    {name} ↗
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
                Not connected yet. Every Hypha surface is hidden.
              </p>
            )}
          </div>

          {/* The front door for builders. It sits above the catalog because
              somebody browsing what exists is the person most likely to notice
              what does not. Mobile first, on the same numbers as the catalog
              controls below: 16px text and a 44px target on a phone, dropping
              to the compact sizes on a pointer device, and the link is
              underlined at rest because a phone has no hover. */}
          <div className="border border-teal-deep/30 bg-white rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Start building modules. Start here.</h3>
            <p className="text-sm sm:text-xs text-gray-600 leading-relaxed">
              Anyone can build a module for this platform. One guide covers all of it: what to read,
              what to run, and how a finished module reaches other villages. Every free module earns a
              share of the ReGen builders' pool, sized by how many members open it. A share is
              recorded against the account named in the module's own entry, and the builder links
              their Base address in their own profile there. Nothing has been paid out yet: the
              counting runs, and the sending is still done by a person.
            </p>
            {/* The explainer sits here once, beside the link that acts on it,
                instead of repeating per card. Every module card carries its own
                one-line reason; this is the sentence that makes those reasons
                mean something, and a founder needs it once. */}
            <p className="text-sm sm:text-xs text-gray-600 leading-relaxed mt-2">
              ReGen Civics shares a pool of $ReGen every lunar cycle across the free modules that
              members are opening. A module that charges a price is paid by the villages using it.
            </p>
            <a
              href={BUILDER_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center mt-3 text-base sm:text-xs font-medium text-teal-deep underline min-h-[44px] sm:min-h-0 pr-3"
            >
              Open the builder guide ↗
            </a>
          </div>

          {/* The catalog toolbar. Search always; each filter only once the
              library holds more than one answer for it. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the catalog"
              /* A placeholder is not a name: it disappears the moment somebody
                 types, and a screen reader announcing "edit text, blank" beside
                 four labelled selects leaves the one control that does the most
                 work unnamed. */
              aria-label="Search the catalog"
              className="w-full sm:flex-1 sm:w-auto sm:min-w-[200px] px-3 py-2 text-base min-h-[44px] sm:text-sm sm:min-h-0 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
            />
            {tiers.length > 1 && (
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className={SELECT} aria-label="Filter by tier">
                <option value="all">Any tier</option>
                {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {domains.length > 1 && (
              <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} className={SELECT} aria-label="Filter by domain">
                <option value="all">Any domain</option>
                {domains.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {dataClasses.length > 1 && (
              <select value={dataFilter} onChange={(e) => setDataFilter(e.target.value)} className={SELECT} aria-label="Filter by data class">
                <option value="all">Any data</option>
                {dataClasses.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {prices.length > 1 && (
              <select value={priceFilter} onChange={(e) => setPriceFilter(e.target.value)} className={SELECT} aria-label="Filter by price">
                <option value="all">Any price</option>
                <option value="free">No extra charge</option>
                <option value="paid">Paid</option>
              </select>
            )}
            {/* The count is the one number that says whether a filter is
                hiding anything, so it reads at gray-600. At gray-400 it
                measured 2.49:1 on the panel's own gray-50. */}
            <span className="text-xs text-gray-600">
              {visible.length} of {all.length}
            </span>
            {filtered && (
              <button onClick={clearFilters} className="text-sm sm:text-xs font-medium text-teal-deep underline min-h-[44px] sm:min-h-0 px-2">
                Clear
              </button>
            )}
          </div>

          {visible.length === 0 && (
            <p className="text-sm text-gray-500 py-8 text-center">
              Nothing in the catalog matches that. Clear the filters to see all {all.length}.
            </p>
          )}

          {shelves.map(({ group, items }) => (
          <section key={group.id}>
            <h3 className="font-semibold text-gray-900">{group.label}</h3>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">{group.gloss}</p>
          <div className="grid gap-4">
            {items.map((m: any) => (
              /*
               * `min-w-0 break-words` is what keeps eighteen cards inside a
               * phone.
               *
               * One column, so every card is the same width, and a grid item's
               * automatic minimum is its min-content: one long word anywhere in
               * any listing sets the floor for the whole catalog and the page
               * scrolls sideways. The word that did it is a game variable in
               * the lifecycle hint. `feed.max_hearts_per_recipient_per_cycle`
               * is thirty-nine characters and a dot is not a break opportunity,
               * so it measured 256px against the 232px a 360px screen leaves,
               * and every card went to 298.5.
               *
               * `min-w-0` stops any child setting that floor and `break-words`
               * gives the word somewhere to break, which is why they ship as a
               * pair: alone, the first would let the word spill out of the card
               * and the second would not shrink min-content at all. Applied to
               * the card rather than to the one paragraph, because `builtBy`, a
               * vendor name, a licence key and a module id can all be one long
               * token too, and `overflow-wrap` inherits.
               */
              <div key={m.id} className="border border-gray-200 rounded-xl p-5 min-w-0 break-words">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-xl min-w-0">
                    <h3 className="font-semibold text-gray-900">
                      {m.name}
                      {/* gray-600 on the gray-100 chip: gray-500 measured
                          4.39:1 there, just under the line. */}
                      {m.core && <span className="ml-2 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Core</span>}
                      {m.legalReview && <span className="ml-2 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">legal review</span>}
                      {/* The third pill. `included` deliberately shows nothing:
                          it is the absence of a badge, exactly the way
                          everything that is not core is silent here today. */}
                      {m.tier === "connected" && <span className={`${PILL} bg-sky-50 text-sky-700 border border-sky-200`}>connected</span>}
                      {m.tier === "managed" && <span className={`${PILL} bg-violet-50 text-violet-700 border border-violet-200`}>managed</span>}
                      {/* Withdrawn sits beside the tier because it changes what
                          a founder can do, which is the same kind of fact. */}
                      {m.withdrawn && <span className={`${PILL} bg-orange-50 text-orange-700 border border-orange-200`}>withdrawn</span>}
                      {m.pricing && m.pricing.amount > 0 && (
                        <span className={`${PILL} bg-emerald-50 text-emerald-700 border border-emerald-200`}>{m.priceLine}</span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">{m.description}</p>
                    {/* Who wrote it. A credit line, never a tier, which is why it
                        renders for included modules too and sits apart from the
                        pills above. */}
                    {m.builtBy && (
                      <p className="text-xs text-gray-600 mt-1.5">Built by {m.builtBy}</p>
                    )}
                    {m.requires.length > 0 && (
                      <p className="text-xs text-gray-600 mt-1.5">requires: {m.requires.join(", ")}</p>
                    )}
                    {/* The fourth line: who answers for this one. Only where
                        somebody outside is involved, so eighteen platform
                        modules gain no noise. */}
                    {m.support?.party === "vendor" && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        built and supported by {m.support.vendorName}, and you hold the account.{" "}
                        <a href={m.support.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Support</a>
                      </p>
                    )}
                    {m.tier === "managed" && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        supported by whoever runs this deployment. One bill, one number to call.
                      </p>
                    )}
                    {m.listing && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        enabled as {m.listing.tier} under library contract {m.listing.contractVersion}
                        {m.listing.acceptedAt ? ` on ${new Date(m.listing.acceptedAt).toLocaleDateString()}` : ""}
                      </p>
                    )}
                    {/* A paid listing says where it stands on its licence, in
                        both directions. `credentialPresent` is whether a key is
                        SET, which is a different fact from a key that works, so
                        this line never claims the second one. */}
                    {m.pricing && m.pricing.amount > 0 && m.credentialPresent === false && (
                      <p className="text-xs text-amber-700 mt-1.5">
                        No licence key yet. This module answers 503 and says who to reach, and the
                        rest of the village keeps working.
                      </p>
                    )}
                    {m.pricing && m.pricing.amount > 0 && m.credentialPresent === true && (
                      <p className="text-xs text-gray-600 mt-1.5">Licence key is set.</p>
                    )}
                    {m.withdrawn && (
                      <p className="text-xs text-orange-700 mt-1.5">
                        Withdrawn from the catalog on {m.withdrawn.since}.
                        {m.withdrawn.replacedBy ? ` ${successorName(m.withdrawn.replacedBy)} replaces it.` : ""}
                        {m.lifecycle === "off"
                          ? " It cannot be turned on."
                          : " Yours keeps running, and turning it off is one way."}
                      </p>
                    )}
                    {/* Underlined at rest rather than on hover: a phone has no
                        hover, so an affordance that only appears under a cursor
                        is invisible to most of this audience. */}
                    <button
                      onClick={() => setOpenId(openId === m.id ? null : m.id)}
                      aria-expanded={openId === m.id}
                      className="text-sm sm:text-xs font-medium text-teal-deep underline mt-2 min-h-[44px] sm:min-h-0 pr-3"
                    >
                      {openId === m.id ? "Hide details" : "Details"}
                    </button>
                    {/* The public card for this module: art, promise, the
                        whole pitch. Same page members browse (L1). */}
                    <Link
                      href={`/modules/${m.id}`}
                      className="text-sm sm:text-xs font-medium text-teal-deep underline mt-2 min-h-[44px] sm:min-h-0 pr-3 inline-flex items-center"
                    >
                      Library page
                    </Link>
                  </div>
                  {m.core ? (
                    /* This pill is a core module's whole lifecycle answer, so
                       it reads at the same weight as the buttons beside it.
                       gray-400 measured 2.49:1 on the panel's gray-50. */
                    <span className="text-xs text-gray-600 italic pt-1">always on</span>
                  ) : (
                    /*
                     * Two columns on a phone, one row from `sm:` up.
                     *
                     * As one nowrap row the four labels set a min-content floor
                     * of 264px, which a 360px screen cannot pay for: 56px rail +
                     * 32px page padding + 40px card padding leaves 230, and the
                     * whole catalog scrolled sideways because of it. A grid
                     * wraps instead of pushing, so the card fits whatever is
                     * left, and each cell lands well over the 44px a thumb
                     * needs (the `off` button was 40.6 wide as a flex item).
                     *
                     * The hairlines come from the container's own background
                     * showing through a 1px gap. `border-l` per button drew a
                     * stray line down the left edge of the second row.
                     */
                    <div className="grid grid-cols-2 gap-px w-full sm:flex sm:w-auto sm:gap-0 rounded-lg border border-gray-200 bg-gray-200 sm:bg-transparent overflow-hidden">
                      {LIFECYCLES.map((lc) => {
                        /* A withdrawn listing that is already off can never come
                           back, so the buttons that would try are dead rather
                           than merely refused. The server refuses it anyway
                           (409); this is so a founder is not invited to press
                           something that cannot work. */
                        const barred = !!m.withdrawn && m.lifecycle === "off" && lc !== "off";
                        return (
                          <button
                            key={lc}
                            disabled={busy === m.id || barred}
                            onClick={() => setLifecycle(m, lc)}
                            title={barred ? `Withdrawn on ${m.withdrawn.since}. It cannot be turned on.` : LIFECYCLE_HINT[lc]}
                            className={`px-3 py-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 text-xs font-medium transition-colors ${
                              m.lifecycle === lc
                                ? "bg-teal-deep text-white"
                                : "bg-white text-gray-600 hover:bg-gray-50"
                            } ${barred ? "opacity-40 cursor-not-allowed" : ""} ${lc !== "off" ? "sm:border-l sm:border-gray-200" : ""}`}
                          >
                            {lc}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {!m.core && m.lifecycle !== "off" && (
                  <p className="text-xs text-gray-600 mt-3">
                    {/* `m` is the untyped catalog row, so the cast is where the
                        wire value meets the union. It asserts what the server
                        already validates and nothing more: a value outside the
                        union still renders blank, exactly as it does today. */}
                    {LIFECYCLE_HINT[m.lifecycle as ModuleLifecycle]}
                    {m.variableKeys.length > 0 && ` Tunables now visible in Game Mechanics: ${m.variableKeys.join(", ")}.`}
                  </p>
                )}

                {/* The listing detail. Inline rather than a modal, so the list
                    stays put and a founder never loses their place. */}
                {openId === m.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100 grid gap-3 text-xs">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-500">
                      <span>id: <code className="text-gray-700">{m.id}</code></span>
                      <span>data it holds: <span className="text-gray-700">{m.dataClass}</span></span>
                      {m.pool && POOL_REASON_COPY[m.pool.reason] && (
                        <span>
                          pool:{" "}
                          {/* Keyed on disposition and no longer on `eligible`.
                              R59 made every platform module eligible, so an
                              eligible test now paints all twenty-three the same
                              emerald and the colour says nothing. Green here
                              means a builder outside the platform is paid. */}
                          <span className={m.pool.disposition === "paid" ? "text-emerald-700" : "text-gray-700"}>
                            {POOL_REASON_COPY[m.pool.reason]}
                          </span>
                        </span>
                      )}
                      {m.provides && <span>domain: <span className="text-gray-700">{m.provides}</span></span>}
                      <span>
                        contract doc:{" "}
                        <span className={m.hasContractDoc ? "text-gray-700" : "text-amber-700"}>
                          {m.hasContractDoc ? "on the shelf" : "none yet"}
                        </span>
                      </span>
                    </div>

                    {m.pricing && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                        <p className="font-medium text-emerald-900">{m.priceLine}</p>
                        <p className="text-emerald-800 mt-1 leading-relaxed">
                          {m.pricing.amount > 0
                            ? "You buy this from the builder and they bill you directly. This platform takes no part in the payment."
                            : "This listing adds no charge of its own."}
                        </p>
                        {m.pricing.billingUrl && (
                          <a href={m.pricing.billingUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">
                            Pricing and billing ↗
                          </a>
                        )}
                        {m.pricing.licenceKey && (
                          <p className="text-emerald-800 mt-1">
                            The licence lives in your own secrets store, under{" "}
                            <code>{m.pricing.licenceKey}</code>. You can see its last four characters
                            and clear it from Integrations, without asking anybody.
                          </p>
                        )}
                      </div>
                    )}

                    {m.vendor && (
                      <div className="grid gap-1">
                        <p className="font-medium text-gray-700">{m.vendor.legalName}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <a href={m.vendor.url} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Product ↗</a>
                          <a href={m.vendor.termsUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Terms ↗</a>
                          <a href={m.vendor.statusUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Status ↗</a>
                          <a href={m.vendor.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep hover:underline">Support ↗</a>
                          <span className="text-gray-500">{m.vendor.supportEmail}</span>
                        </div>
                        <p className="text-gray-500">
                          {m.vendor.liveness?.mode === "window"
                            ? `A successful call is expected inside ${m.vendor.liveness.withinHours} hours. Longer silence reads as stale.`
                            : "Called on demand, so silence here is normal and is declared as such."}
                        </p>
                      </div>
                    )}

                    {(m.vendor?.setupSteps ?? []).length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Setup you do inside their product</p>
                        <ul className="list-disc pl-4 space-y-1 text-gray-500">
                          {m.vendor.setupSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}

                    {(m.health ?? []).length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">What its calls have actually done</p>
                        {m.health.map((h: any) => (
                          <p key={h.operation} className={h.reading?.verdict === "failing" || h.reading?.verdict === "stale" ? "text-red-600" : "text-gray-500"}>
                            {h.operation}: {h.reading?.detail}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-500">
                      {m.recommends.length > 0 && <span>works better with: {m.recommends.join(", ")}</span>}
                      {m.capabilities.length > 0 && <span>adds permissions: {m.capabilities.join(", ")}</span>}
                      {m.variableKeys.length > 0 && <span>tunables: {m.variableKeys.length}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Circles & Map admin (S19-S23) ────────────────────────────────────────────

/**
 * The sociocratic org chart, edited as rows (0049).
 *
 * The public /roles, /circles and /team pages read /api/org, so THIS is where
 * their content comes from. The "Roles Page" and "Circles Page" content-card
 * editors under Content no longer reach those pages.
 *
 * Distinct from "Game Roles", which seats people into PERMISSION GROUPS. The
 * two share a word and nothing else: a group grants capabilities, a seat is
 * work somebody holds. Nothing here can grant anyone a permission.
 *
 * Seat status is DERIVED from live holdings against the seat count. There is
 * no status dropdown, because a hand-set one drifts: the cards this replaced
 * shipped two seats marked "filled" with nobody named in them.
 */
/**
 * The village brain: what this place says it is for.
 *
 * Every section shows, written or not, because the BLANKS are the useful part.
 * A guide that knows membership has never been described can raise it six weeks
 * later; one that only sees what exists cannot. The three marked essential are
 * the ones that unblock everything else, so a founder who fills only those has
 * a usable game.
 *
 * Confirming is its own act, separate from saving. A section seeded from the
 * application is real and usable and nobody has agreed to it yet, and that
 * difference is what the guide cites when she leans on it.
 */
function VillageBrainTab({ password }: { password: string }) {
  const [sections, setSections] = useState<any[]>([]);
  const [record, setRecord] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // A refused read and an empty brief look identical unless the difference is
  // kept. On a screen whose whole job is showing what is missing, silently
  // reporting "nothing written" when the server said no is the worst failure
  // it has.
  const [loadError, setLoadError] = useState<string | null>(null);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.error ?? "That did not save"); return null; }
      return d;
    } catch {
      toast.error("That did not reach the server");
      return null;
    }
  };

  /** `keepDrafts` is the whole point: reloading must never eat unsaved text in
   *  the OTHER thirteen boxes on this page. */
  const load = useCallback(async (savedId?: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/admin/brain`, { headers: authHeaders(password) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setLoadError(d?.error ?? "Could not read the brief");
        return;
      }
      const d = await r.json();
      setLoadError(null);
      setSections(d.sections ?? []);
      setRecord(d.record ?? []);
      // Only the section that just saved is cleared: its stored body is now the
      // truth, and everything else may still be half-typed.
      if (savedId) setDraft((p) => { const n = { ...p }; delete n[savedId]; return n; });
    } catch {
      setLoadError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const save = async (id: string, confirm: boolean) => {
    setBusy(id);
    try {
      const body = draft[id];
      // A refusal keeps the typed text on screen. Discarding what somebody
      // wrote because the server said no is unrecoverable and unforgivable.
      const ok =
        body !== undefined
          ? await call(`/admin/brain/${id}`, { body, confirm }, "PUT")
          : confirm
            ? await call(`/admin/brain/${id}/confirm`)
            : null;
      if (ok) {
        toast.success(confirm ? "Saved and confirmed" : "Saved, not yet confirmed");
        await load(id);
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-sm text-gray-500">Reading what this village has said about itself.</div>;
  if (loadError) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-4">
        <h3 className="font-semibold text-red-800">The brief did not load</h3>
        <p className="text-sm text-gray-600 mt-1">{loadError}</p>
        <button onClick={() => void load()} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 mt-3">
          Try again
        </button>
      </div>
    );
  }
  const blanks = sections.filter((s) => s.status === "blank");

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900">What this village is for</h3>
        <p className="text-sm text-gray-600 mt-1">
          Your guide reads this before she suggests anything. She ranks it above the shipped
          literature and below what is live in the game, and she names which section she drew on.
          None of it leaves this village.
        </p>
        {blanks.length > 0 && (
          <p className="text-sm text-gray-600 mt-2">
            Still blank: {blanks.map((s) => s.id).join(", ")}. She will ask about these when a
            conversation touches them, one at a time.
          </p>
        )}
        {record.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            The record holds {record.reduce((a, r) => a + Number(r.entries ?? 0), 0)} entr
            {record.reduce((a, r) => a + Number(r.entries ?? 0), 0) === 1 ? "y" : "ies"} across{" "}
            {record.length} section(s), derived from calls, decisions and closed cycles.
          </p>
        )}
      </div>

      {sections.map((s) => {
        const body = draft[s.id] ?? s.body ?? "";
        const dirty = draft[s.id] !== undefined && draft[s.id] !== (s.body ?? "");
        return (
          <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-medium text-gray-900">{s.title}</h4>
                  <span className="text-xs text-gray-400">{s.id}</span>
                  {s.minimum && (
                    <span className="text-xs bg-amber-50 text-amber-700 rounded px-1.5 py-0.5">essential</span>
                  )}
                  {s.audience === "admin" && (
                    <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">admins only</span>
                  )}
                  <span
                    className={`text-xs rounded px-1.5 py-0.5 ${
                      s.status === "confirmed"
                        ? "bg-green-50 text-green-700"
                        : s.status === "proposed"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {s.status === "confirmed"
                      ? `confirmed${s.confirmedBy ? ` by ${s.confirmedBy}` : ""}`
                      : s.status === "proposed"
                        ? `from ${s.source ?? "elsewhere"}, not confirmed`
                        : "not yet written"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{s.feeds}</p>
              </div>
            </div>
            <textarea
              value={body}
              placeholder={s.ask}
              onChange={(e) => setDraft((d) => ({ ...d, [s.id]: e.target.value }))}
              className="mt-3 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[110px]"
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                onClick={() => save(s.id, true)}
                // `!body.trim()` matters on a blank section: without it the
                // button is live, promises an action, and posts a confirm
                // against a row that does not exist yet.
                disabled={busy === s.id || !body.trim() || (!dirty && s.status === "confirmed")}
                className="text-xs bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
              >
                {busy === s.id ? "Saving" : s.status === "confirmed" ? "Save" : "Save and confirm"}
              </button>
              {dirty && (
                <button
                  onClick={() => save(s.id, false)}
                  disabled={busy === s.id}
                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  Save without confirming
                </button>
              )}
              {s.revision > 1 && <span className="text-xs text-gray-400">revision {s.revision}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Her drafts, and the one screen where a permission gets granted on purpose.
 *
 * ESCALATIONS ARE THE POINT. Any capability a proposed role asks for that no
 * existing role already grants is listed as its own checkbox, in a sentence
 * about what a holder could DO. Anything left unticked is stripped from the
 * role that gets created, so silence is refusal. A single Accept button on a
 * role quietly carrying `exchange.manage` is exactly how this goes wrong.
 */
function DraftQueueTab({ password }: { password: string }) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [granted, setGranted] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * A failed read must NEVER render as "nothing waiting".
   *
   * This is the one screen where a capability gets granted. A queue of drafts
   * carrying unreviewed escalations sitting on the server while the page says
   * positively that there is nothing to review is a governance failure, not a
   * cosmetic one.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/admin/drafts`, { headers: authHeaders(password) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setLoadError(d?.error ?? "Could not read the queue");
        return;
      }
      const d = await r.json();
      setLoadError(null);
      setDrafts(d.drafts ?? []);
    } catch {
      setLoadError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_BASE}/admin/drafts/${id}/${accept ? "accept" : "reject"}`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(accept ? { grantedEscalations: granted[id] ?? [] } : { note: note[id] ?? "" }),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        // Without this the draft simply reappears with its boxes still ticked,
        // which reads as "nothing happened", so the admin clicks into the same
        // refusal forever with no reason ever shown.
        toast.error((d as any)?.error ?? "That draft did not go through");
        return;
      }
      toast.success(accept ? "Accepted" : "Rejected");
      setGranted((g) => { const n = { ...g }; delete n[id]; return n; });
      setNote((n) => { const c = { ...n }; delete c[id]; return c; });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string, cap: string) =>
    setGranted((g) => {
      const have = g[id] ?? [];
      return { ...g, [id]: have.includes(cap) ? have.filter((c) => c !== cap) : [...have, cap] };
    });

  if (loading) return <div className="text-sm text-gray-500">Loading what she has proposed.</div>;
  if (loadError) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-4">
        <h3 className="font-semibold text-red-800">The queue did not load</h3>
        <p className="text-sm text-gray-600 mt-1">
          {loadError}. There may be drafts waiting; this is not an empty queue.
        </p>
        <button onClick={() => void load()} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 mt-3">
          Try again
        </button>
      </div>
    );
  }
  if (!drafts.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900">Nothing waiting</h3>
        <p className="text-sm text-gray-600 mt-1">
          Roles and circles your guide proposes land here for you to read before they exist.
          She never creates anything herself.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {drafts.map((d) => {
        const esc: Array<{ capability: string; consequence: string }> = d.escalations ?? [];
        const ticked = granted[d.id] ?? [];
        return (
          <div key={d.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{d.kind}</span>
              <h4 className="font-medium text-gray-900">{d.payload?.name ?? "Untitled"}</h4>
            </div>
            <p className="text-sm text-gray-700 mt-2">{d.payload?.description ?? d.payload?.purpose}</p>
            <p className="text-sm text-gray-600 mt-2 italic">{d.rationale}</p>
            {Array.isArray(d.cites) && d.cites.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">Drawn from: {d.cites.join(", ")}</p>
            )}

            {esc.length > 0 && (
              <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-900">
                  This asks for {esc.length === 1 ? "a power" : "powers"} no existing role has.
                  Tick each one you mean to grant. Anything you leave unticked is removed before
                  the role is created.
                </p>
                <div className="mt-2 space-y-2">
                  {esc.map((e) => (
                    <label key={e.capability} className="flex items-start gap-2 text-sm text-amber-900">
                      <input
                        type="checkbox"
                        checked={ticked.includes(e.capability)}
                        onChange={() => toggle(d.id, e.capability)}
                        className="mt-0.5"
                      />
                      <span>
                        Let a holder {e.consequence}
                        <span className="text-xs text-amber-700"> ({e.capability})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button
                onClick={() => decide(d.id, true)}
                disabled={busy === d.id}
                className="text-xs bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
              >
                {esc.length && ticked.length < esc.length ? "Accept without the unticked" : "Accept"}
              </button>
              <input
                value={note[d.id] ?? ""}
                onChange={(e) => setNote((n) => ({ ...n, [d.id]: e.target.value }))}
                placeholder="Why not, so she learns"
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[180px]"
              />
              <button
                onClick={() => decide(d.id, false)}
                disabled={busy === d.id}
                className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrgChartTab({ password }: { password: string }) {
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [circleDraft, setCircleDraft] = useState<Record<string, any>>({});
  const [newSeat, setNewSeat] = useState<Record<string, string>>({});
  // Opened per seat, because the point of a journal is reading one node's
  // history before you change it, not scrolling a feed of everything.
  const [journal, setJournal] = useState<Record<string, any[] | "loading">>({});
  // Mandates that have run out or are about to. Sorted most overdue first by
  // the server, which is the only order that makes this list get acted on.
  const [expiring, setExpiring] = useState<any[]>([]);
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  const openJournal = async (id: string) => {
    if (journal[id]) { setJournal((p) => { const n = { ...p }; delete n[id]; return n; }); return; }
    setJournal((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await fetch(`${API_BASE}/org/roles/${id}/journal`, { headers: authHeaders(password) });
      const rows = r.ok ? await r.json() : [];
      setJournal((p) => ({ ...p, [id]: Array.isArray(rows) ? rows : [] }));
    } catch { setJournal((p) => ({ ...p, [id]: [] })); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, m, e] = await Promise.all([
        fetch(`${API_BASE}/org`, { headers: authHeaders(password) }).then((r) => r.json()),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_BASE}/admin/org/expiring?days=45`, { headers: authHeaders(password) })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);
      setOrg(o);
      setMembers(Array.isArray(m) ? m : []);
      setExpiring(Array.isArray(e) ? e : []);
    } catch { setOrg(null); }
    setLoading(false);
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    // `refusal` and not `d?.error`: the refusal bodies this tab now meets
    // carry the sentence in `message` and the machine code in `error`, and a
    // toast that prints `unknown_status` hands a founder a code and calls it
    // an explanation. `??` also let a body with `error: ""` toast nothing.
    if (!res.ok) { toast.error(refusal(d, "That did not save")); return null; }
    return d;
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Loading…</div>;
  if (!org) return <div className="text-center py-12 text-gray-400">The org chart could not be read.</div>;

  const circles: any[] = org.circles ?? [];
  const roles: any[] = org.roles ?? [];
  const byCircle = new Map<string, any[]>();
  for (const r of roles) {
    const k = r.circleId ?? "";
    byCircle.set(k, [...(byCircle.get(k) ?? []), r]);
  }

  const STATE_LABEL: Record<string, string> = {
    filled: "Filled", partial: "Partially filled", open: "Open seat", forming: "Forming",
    // Held, and overdue. Nobody has been removed; the seat is asking to be
    // reassigned because a term ran out or the season it was filled in turned.
    expired: "Term ended, awaiting reassignment",
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Org Chart</h2>
        <p className="text-sm text-gray-500 mt-1">
          Circles, the seats inside them, and who holds each seat. This is what
          /roles, /circles and /team show, and edits are live immediately.
          Whether a seat reads as filled or open is worked out from its holders,
          so it can never say filled with nobody in it.
        </p>
      </div>

      {/*
        The mandates that have run out, at the top where they get seen.

        This list is the whole reason terms are worth recording. Nothing on it
        has been revoked and nobody has been removed: a seat going dark on a
        Tuesday for reasons nobody chose is worse than one saying out loud that
        it is overdue. Reassigning happens in the seat below, so this points
        rather than acts.
      */}
      {expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="font-semibold text-gray-900 text-sm">
            {expiring.filter((e: any) => e.lapsed).length > 0
              ? `${expiring.filter((e: any) => e.lapsed).length} mandate(s) have run out`
              : "Mandates coming up"}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            Everyone here is still holding their seat and still doing the work. What has run out is the
            agreement to keep doing it unasked.
          </p>
          <ul className="mt-2 space-y-1">
            {expiring.map((e: any) => (
              <li key={e.assignmentId} className="text-xs text-gray-800">
                <span className="font-medium">{e.roleName}</span>
                {e.holder ? <> held by {e.holder}</> : null}
                {": "}
                {e.lapsed
                  ? e.reason === "season"
                    ? "the season it was filled in has turned"
                    : "the term has passed"
                  : `${e.daysLeft} day(s) left`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        {circles.map((c) => {
          const seats = byCircle.get(c.id) ?? [];
          return (
            <div key={c.id} className="bg-white border border-gray-100 rounded-xl p-5">
              {/*
                A CIRCLE'S NAME, PURPOSE AND STATUS ARE EDITABLE HERE.

                All three are printed by /circles, /roles and /team, all three
                of which are always-on core pages. The only editor used to be
                the Circles and Map tab, which disappears with the map module,
                so turning the map off took away the ability to rename a circle
                while the public pages kept printing the old name. This tab has
                no module gate, and `/api/admin/circles` no longer has one
                either.
              */}
              {(() => {
                const cd = circleDraft[c.id] ?? c;
                const cDirty = ["name", "purpose", "status"].some((k) => (cd[k] ?? "") !== (c[k] ?? ""));
                const setCircle = (patch: any) => setCircleDraft({ ...circleDraft, [c.id]: { ...cd, ...patch } });
                return (
                  <div className="mb-4">
                    <div className="grid sm:grid-cols-3 gap-2 items-end">
                      <label className="text-xs text-gray-500">Circle name
                        <input value={cd.name ?? ""} className={`${inputCls} w-full mt-1 min-h-[44px]`} disabled={!!c.isExample}
                          onChange={(e) => setCircle({ name: e.target.value })} />
                      </label>
                      <label className="text-xs text-gray-500">Status
                        <select value={cd.status ?? "active"} className={`${inputCls} w-full mt-1 min-h-[44px]`} disabled={!!c.isExample}
                          onChange={(e) => setCircle({ status: e.target.value })}>
                          {CIRCLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <div className="text-xs text-gray-400 pb-2">
                        {c.grownFromOrgRoleId && <span>Grew from a seat. </span>}
                        {c.isExample && <span className="text-amber-700">Standing example, publish your own to replace it.</span>}
                      </div>
                    </div>
                    <label className="text-xs text-gray-500 block mt-2">Purpose
                      {/* A wrapping <label> names the control with EVERY string
                          inside it, so this field announced its name plus the
                          whole hint as one sentence. The name is the field, the
                          hint is a description a reader can take or skip. */}
                      <textarea rows={2} value={cd.purpose ?? ""} className={`${inputCls} w-full mt-1`} disabled={!!c.isExample}
                        aria-label="Purpose"
                        aria-describedby={`${c.id}-purpose-hint`}
                        onChange={(e) => setCircle({ purpose: e.target.value })} />
                      <span id={`${c.id}-purpose-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                        Printed on /circles as the circle's description, and on /roles as the heading under its name.
                      </span>
                    </label>
                    <button
                      disabled={!cDirty || !!c.isExample}
                      className="mt-2 text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      onClick={async () => {
                        const ok = await call(`/admin/circles/${c.id}`, { name: cd.name, purpose: cd.purpose, status: cd.status }, "PUT");
                        if (ok) { toast.success("Circle saved"); setCircleDraft({ ...circleDraft, [c.id]: undefined }); void load(); }
                      }}
                    >Save circle</button>
                  </div>
                );
              })()}

              <div className="space-y-3">
                {seats.map((r) => {
                  const d = draft[r.id] ?? r;
                  /*
                   * accountabilities is an ARRAY, so it is compared by value.
                   * A `d[k] !== r[k]` over an array is a reference comparison
                   * that is true the moment the draft object is cloned and
                   * false for two different lists that happen to be the same
                   * object, which is the wrong answer in both directions.
                   */
                  const dirty =
                    ["name", "circleId", "aim", "domain", "seats", "whyItMatters"].some((k) => (d[k] ?? "") !== (r[k] ?? "")) ||
                    JSON.stringify(d.accountabilities ?? []) !== JSON.stringify(r.accountabilities ?? []);
                  return (
                    <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                      <div className="grid sm:grid-cols-4 gap-2 items-end">
                        <label className="text-xs text-gray-500">Seat
                          <input value={d.name ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, name: e.target.value } })} />
                        </label>
                        <label className="text-xs text-gray-500">Circle
                          <select value={d.circleId ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, circleId: e.target.value } })}>
                            <option value="">Unplaced</option>
                            {circles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-gray-500">Seats
                          <input type="number" min={1} value={d.seats ?? 1} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, seats: Number(e.target.value) } })} />
                        </label>
                        <p className="text-xs text-gray-500">
                          State<br />
                          <span className="font-medium text-gray-800">{STATE_LABEL[r.state] ?? r.state}</span>
                          <span className="text-gray-400"> · {r.holderCount} of {r.seats}</span>
                        </p>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2 mt-2">
                        <label className="text-xs text-gray-500">Aim
                          <textarea rows={2} value={d.aim ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, aim: e.target.value } })} />
                        </label>
                        <label className="text-xs text-gray-500">Domain (what it decides alone)
                          <textarea rows={2} value={d.domain ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, domain: e.target.value } })} />
                        </label>
                      </div>
                      {/*
                        Both of these are rendered on /roles inside the seat's
                        expanded panel, and `updateOrgRole` has accepted both
                        since the org chart shipped. The form never sent them,
                        so every village's accountabilities and reason-this-
                        matters were frozen at whatever the backfill wrote,
                        while the banner on the old cards editor sent founders
                        here promising the site updates immediately.
                      */}
                      <div className="grid sm:grid-cols-2 gap-2 mt-2">
                        {/* Both fields carry an explicit aria-label: a wrapping
                            <label> would otherwise name each control with its
                            field name AND the hint under it, run together. */}
                        <label className="text-xs text-gray-500">Key accountabilities, one per line
                          <textarea rows={4} value={(d.accountabilities ?? []).join("\n")} className={`${inputCls} w-full mt-1`}
                            aria-label="Key accountabilities, one per line"
                            aria-describedby={`${r.id}-accountabilities-hint`}
                            onChange={(e) => setDraft({
                              ...draft,
                              [r.id]: { ...d, accountabilities: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) },
                            })} />
                          <span id={`${r.id}-accountabilities-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                            The ongoing work the circle counts on this seat to keep doing. Listed on /roles.
                          </span>
                        </label>
                        <label className="text-xs text-gray-500">Why this seat matters
                          <textarea rows={4} value={d.whyItMatters ?? ""} className={`${inputCls} w-full mt-1`}
                            aria-label="Why this seat matters"
                            aria-describedby={`${r.id}-why-hint`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, whyItMatters: e.target.value } })} />
                          <span id={`${r.id}-why-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                            Shown on /roles under Why This Role Matters.
                          </span>
                        </label>
                      </div>

                      {/*
                        SEATING SOMEBODY WAS A ONE-WAY DOOR.

                        `DELETE /api/admin/org/seatings/:id` and its `/forget`
                        sibling shipped with their own test suite and no caller
                        anywhere in the client, so a village could seat a person
                        and never unseat them, and the right-to-be-forgotten
                        path was reachable only by curl. `/api/org` now carries
                        the seating id for admins, which is what these two need.

                        Two doors on purpose. Ending a holding is ordinary and
                        reversible: the person stays in the record and can be
                        seated again. Forgetting is destructive and only exists
                        for a documented holder, a real person with no account
                        who asked to be erased: it scrubs their name and note
                        from every row, live and historical, and nothing brings
                        it back. It is labelled as such and it types their name.
                      */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(r.holders ?? []).map((h: any) => (
                          <span key={h.assignmentId ?? h.userId ?? h.name} className={`text-xs rounded-full pl-3 pr-1 py-1 inline-flex items-center gap-1 ${h.lapsed ? "bg-amber-50 border border-amber-200" : "bg-gray-100"}`}>
                            {h.name}
                            {h.focus && <span className="text-gray-500"> · {h.focus}</span>}
                            {h.kind === "documented" && <span className="text-amber-700"> · no account yet</span>}
                            {h.lapsed && (
                              <span className="text-amber-700">
                                {" "}· {h.lapsedReason === "term" ? "term ended" : "seated last season"}
                              </span>
                            )}
                            {h.assignmentId && (
                              <button
                                type="button"
                                aria-label={`End ${h.name}'s holding of ${r.name}`}
                                className="ml-1 min-h-[44px] min-w-[44px] px-2 rounded-full text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                                onClick={async () => {
                                  const reason = window.prompt(`End ${h.name}'s holding of "${r.name}"? They stay in the record and can be seated again. Reason for the journal (optional):`);
                                  if (reason === null) return;
                                  const ok = await call(`/admin/org/seatings/${h.assignmentId}`, { reason }, "DELETE");
                                  if (ok) { toast.success("Holding ended"); void load(); }
                                }}
                              >Unseat</button>
                            )}
                            {h.assignmentId && h.kind === "documented" && (
                              <button
                                type="button"
                                aria-label={`Forget ${h.name} permanently`}
                                className="min-h-[44px] min-w-[44px] px-2 rounded-full text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600"
                                onClick={async () => {
                                  const typed = window.prompt(
                                    `FORGET ${h.name}. This ends every holding in their name and erases their name and notes from this seat's history, past entries included. It cannot be undone.\n\nType their name exactly to confirm:`,
                                  );
                                  if (typed === null) return;
                                  if (typed.trim() !== String(h.name).trim()) { toast.error("That name did not match. Nothing was changed."); return; }
                                  const ok = await call(`/admin/org/seatings/${h.assignmentId}/forget`, { reason: "forgotten at their request" });
                                  if (ok) { toast.success(`Forgotten. ${ok.seatings} holding(s) ended.`); void load(); }
                                }}
                              >Forget</button>
                            )}
                          </span>
                        ))}
                        {(r.holders ?? []).length === 0 && <span className="text-xs text-gray-400">Nobody holds this yet.</span>}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 items-end">
                        <SeatSomebody
                          roleId={r.id}
                          members={members}
                          call={call}
                          onSeated={(what) => { toast.success(what); void load(); }}
                          onFailed={(why) => toast.error(why)}
                        />
                        <button
                          onClick={() => void openJournal(r.id)}
                          className="text-sm text-gray-500 hover:text-gray-800 px-2 py-2"
                        >{journal[r.id] ? "Hide history" : "History"}</button>
                        <button
                          disabled={!dirty}
                          className="text-sm border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40"
                          onClick={async () => {
                            const ok = await call(`/admin/org/roles/${r.id}`, {
                              name: d.name, circleId: d.circleId, aim: d.aim, domain: d.domain, seats: d.seats,
                              accountabilities: d.accountabilities ?? [], whyItMatters: d.whyItMatters ?? "",
                            }, "PUT");
                            if (ok) { toast.success("Saved"); setDraft({ ...draft, [r.id]: undefined }); void load(); }
                          }}
                        >Save seat</button>
                      </div>

                      {journal[r.id] === "loading" && (
                        <p className="text-xs text-gray-400 mt-2">Reading the history…</p>
                      )}
                      {Array.isArray(journal[r.id]) && (
                        <div className="mt-2 border-t border-gray-100 pt-2 space-y-1">
                          {(journal[r.id] as any[]).length === 0 && (
                            <p className="text-xs text-gray-400">
                              Nothing recorded against this seat yet. Changes from here on will show up.
                            </p>
                          )}
                          {(journal[r.id] as any[]).map((e) => (
                            <p key={e.id} className="text-xs text-gray-600">
                              <span className="text-gray-400">{new Date(e.at).toLocaleDateString()}</span>{" "}
                              {e.text}
                              {e.by && <span className="text-gray-400"> · {e.by}</span>}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {seats.length === 0 && <p className="text-xs text-gray-400">No seats in this circle yet.</p>}
                {/*
                  Creating a seat. `POST /api/admin/org/roles` has existed since
                  the org chart shipped and nothing in the browser called it, so
                  a village could rename and re-seat the seats it was given and
                  never add one of its own.
                */}
                <div className="flex flex-wrap gap-2 items-end pt-2 border-t border-gray-50">
                  <label className="text-xs text-gray-500">Add a seat to this circle
                    <input value={newSeat[c.id] ?? ""} placeholder="Welcome Host"
                      className={`${inputCls} mt-1 min-h-[44px]`}
                      onChange={(e) => setNewSeat({ ...newSeat, [c.id]: e.target.value })} />
                  </label>
                  <button
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                    disabled={!String(newSeat[c.id] ?? "").trim()}
                    onClick={async () => {
                      const ok = await call("/admin/org/roles", { name: String(newSeat[c.id]).trim(), circleId: c.id, seats: 1 });
                      if (ok) { toast.success("Seat added"); setNewSeat({ ...newSeat, [c.id]: "" }); void load(); }
                    }}
                  >Add seat</button>
                </div>
              </div>
            </div>
          );
        })}

        {(byCircle.get("") ?? []).length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h3 className="font-semibold text-amber-900 mb-2">Seats with no circle</h3>
            <p className="text-xs text-amber-800">
              {(byCircle.get("") ?? []).map((r) => r.name).join(", ")}
            </p>
          </div>
        )}

        {/*
          THE LINKS BETWEEN THE NODES ABOVE, and the second door this lane owed.

          `POST /api/admin/org/relations` and its DELETE sibling had no caller
          anywhere in the browser while `RelationLines.tsx` drew the rows on
          the Power Map, so a live renderer could only ever draw nothing. It
          sits here because the circles and seats it joins are the ones a
          person has just been editing, and it reads them from the same `/api/org`
          payload this tab already holds instead of fetching them twice.
        */}
        <RelationsEditor password={password} circles={circles} roles={roles} />
      </div>
    </div>
  );
}

/**
 * Season shapes: what a season CARRIES, and what the last one taught.
 *
 * A pattern is a selection from everything the village has ever made. Leaving
 * a pattern removes a membership row and nothing else, so a circle or a seat
 * that steps out of this season is waiting in the catalogue for the next one.
 *
 * The roll is a dry run until somebody presses the second button, and it
 * refuses outright while anything is unsettled. That is the same settle-first
 * rule that already governs deleting a quest with claims in flight.
 */
function SeasonPatternsTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [retro, setRetro] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        fetch(`${API_BASE}/admin/seasons/patterns`, { headers: authHeaders(password) }).then((r) => r.json()),
        fetch(`${API_BASE}/org`, { headers: authHeaders(password) }).then((r) => r.json()),
      ]);
      setData(d); setOrg(o);
    } catch { setData(null); }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      /*
       * `null`, and it used to be `d`.
       *
       * Ten sibling helpers in this file return null on a refusal and their
       * callers read that as "it did not happen". This one returned the ERROR
       * BODY, which is an object and therefore truthy, so every caller here
       * treated a refusal as a result: `setPlan(await call(...))` drew a
       * season plan out of an error, and creating a pattern wiped the name the
       * founder had typed. The toast fired the whole time, under a screen that
       * had already moved on.
       */
      if (!res.ok) { toast.error(refusal(d, `The server refused that (${res.status}).`)); return null; }
      return d;
    } finally { setBusy(false); }
  };

  if (!data) return <div className="text-center py-12 text-gray-400">Loading…</div>;

  const members: any[] = data.members ?? [];
  const inCurrent = (kind: string, id: string) =>
    members.some((m) => m.patternId === data.currentPatternId && m.kind === kind && m.entityId === id);
  const governed = (kind: string, id: string) => members.some((m) => m.kind === kind && m.entityId === id);

  const toggle = async (kind: string, entityId: string, on: boolean) => {
    if (!data.currentPatternId) return toast.error("This season carries no shape yet");
    await call(`/admin/seasons/patterns/${data.currentPatternId}/members`, { kind, entityId },
      on ? "POST" : "DELETE");
    void load();
  };

  const rows: Array<{ kind: string; id: string; name: string }> = [
    ...(org?.circles ?? []).map((c: any) => ({ kind: "circle", id: c.id, name: c.name })),
    ...(org?.roles ?? []).map((r: any) => ({ kind: "org_role", id: r.id, name: r.name })),
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Season Shapes</h2>
        <p className="text-sm text-gray-500 mt-1">
          A shape is the working setup of a season: which circles, seats, badges
          and quests are live while it runs. Anything in no shape at all is
          permanent and a season turn never touches it.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900 mb-2">Shapes</h3>
        {(data.patterns ?? []).length === 0 && (
          <p className="text-sm text-gray-500 mb-3">
            None yet. A village without shapes runs one continuous season, which is a fine place to start.
          </p>
        )}
        <div className="flex flex-wrap gap-2 mb-3">
          {(data.patterns ?? []).map((p: any) => (
            <span key={p.id} className={`text-sm rounded-full px-3 py-1 border ${
              p.id === data.currentPatternId ? "bg-teal-deep text-white border-transparent" : "border-gray-200 text-gray-600"}`}>
              {p.name}{p.id === data.currentPatternId && " · running now"}
            </span>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <label className="text-xs text-gray-500">New shape
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Festival Season"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full mt-1" />
          </label>
          <button disabled={!newName.trim() || busy}
            onClick={async () => { const made = await call("/admin/seasons/patterns", { name: newName }); if (made) setNewName(""); void load(); }}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">Create</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          A shape becomes a season's by setting its id on the season itself, in Admin, Season.
        </p>
      </div>

      {data.currentPatternId && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-gray-900 mb-1">What this season carries</h3>
          <p className="text-xs text-gray-500 mb-3">
            Unticked and never ticked anywhere are different things. Something in
            no shape at all is permanent; something in another shape is resting.
          </p>
          <div className="grid sm:grid-cols-2 gap-1">
            {rows.map((r) => (
              <label key={`${r.kind}:${r.id}`} className="flex items-center gap-2 text-sm py-1">
                <input type="checkbox" checked={inCurrent(r.kind, r.id)}
                  onChange={(e) => void toggle(r.kind, r.id, e.target.checked)} />
                <span className={governed(r.kind, r.id) ? "" : "text-gray-500"}>{r.name}</span>
                <span className="text-[11px] text-gray-400">
                  {r.kind === "circle" ? "circle" : "seat"}
                  {!governed(r.kind, r.id) && " · permanent"}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900 mb-1">Turn the season</h3>
        <p className="text-xs text-gray-500 mb-3">
          Nothing moves until you press Apply. Reassignment cadence is{" "}
          <strong>{String(data.cadence ?? "season_turn").replace(/_/g, " ")}</strong>.
        </p>
        <div className="flex gap-2 mb-3">
          <button disabled={busy}
            onClick={async () => setPlan(await call("/admin/seasons/roll", {}))}
            className="text-sm border border-gray-200 rounded-lg px-4 py-2">Show me what would change</button>
          {plan && plan.changes?.length > 0 && plan.blocked?.length === 0 && (
            <button disabled={busy}
              onClick={async () => { const r = await call("/admin/seasons/roll", { apply: true }); if (r?.applied !== undefined) { toast.success(`${r.applied} change(s) applied`); setPlan(null); void load(); } }}
              className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">Apply</button>
          )}
        </div>
        {plan && (
          <div className="text-sm space-y-2">
            {plan.blocked?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="font-medium text-amber-900 mb-1">Settle these first</p>
                {plan.blocked.map((b: any) => (
                  <p key={b.entityId} className="text-amber-800 text-xs">{b.name}: {b.reason}</p>
                ))}
              </div>
            )}
            {plan.changes?.length === 0 && plan.blocked?.length === 0 && (
              <p className="text-gray-500">Nothing would change.</p>
            )}
            {plan.changes?.map((c: any) => (
              <p key={`${c.kind}:${c.entityId}`} className="text-gray-700 text-xs">
                {c.name}: {c.from} → {c.to}
              </p>
            ))}
            {plan.lapsing?.length > 0 && (
              <p className="text-xs text-gray-500">
                {plan.lapsing.length} seat(s) would reopen for reassignment.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">What the season taught</h3>
        <p className="text-xs text-gray-500 mb-3">
          What this shape declared, against what the village actually used.
        </p>
        <button disabled={busy}
          onClick={async () => setRetro(await call("/admin/seasons/retrospective", undefined, "GET"))}
          className="text-sm border border-gray-200 rounded-lg px-4 py-2 mb-3">Read the season</button>
        {retro && retro.tooQuietToRead && (
          <p className="text-sm text-gray-500">
            Too little happened this season to read anything into. That is worth
            knowing on its own, and it is better than a number invented from four events.
          </p>
        )}
        {retro && !retro.tooQuietToRead && (
          <div className="space-y-3">
            {(retro.observations ?? []).length === 0 && <p className="text-sm text-gray-500">Nothing stood out.</p>}
            {(retro.observations ?? []).map((o: any) => (
              <div key={o.id} className="border-l-2 border-gray-200 pl-3">
                <p className="text-sm font-medium text-gray-900">{o.name}</p>
                <p className="text-xs text-gray-600">{o.reading}</p>
                <p className="text-xs text-gray-400 mt-0.5">{o.meaning}</p>
                <p className="text-[11px] text-teal-deep mt-1">{String(o.action).replace(/_/g, " ")}</p>
              </div>
            ))}
            {retro.proposed?.drop?.length > 0 && (
              <p className="text-xs text-gray-500 pt-2">
                Next time this shape could drop {retro.proposed.drop.length} thing(s) nobody used.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CirclesMapTab({ password }: { password: string }) {
  const [off, setOff] = useState(false);
  const [circles, setCircles] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [unmatched, setUnmatched] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCircle, setNewCircle] = useState({ name: "", purpose: "" });
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cRes = await fetch(`${API_BASE}/circles`, { headers: authHeaders(password) });
      if (cRes.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setCircles(await cRes.json());
      const [rRes, ctRes, uRes] = await Promise.all([
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/map/contact-log`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/map/concierge-log?unmatched=1`, { headers: authHeaders(password) }),
      ]);
      setRoles(await rRes.json());
      setContacts(ctRes.ok ? await ctRes.json() : []);
      setUnmatched(uRes.ok ? await uRes.json() : []);
    } catch { /* leave whatever loaded */ }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const createCircle = async () => {
    const res = await fetch(`${API_BASE}/admin/circles`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify(newCircle),
    });
    const d = await res.json();
    if (!res.ok) return toast.error(refusal(d, "Create failed"));
    toast.success("Circle created");
    setNewCircle({ name: "", purpose: "" });
    // The village's first real circle retires the map's examples server-side.
    forgetExamplesCache("map");
    load();
  };

  const addAlias = async (circle: any) => {
    const alias = (aliasDrafts[circle.id] ?? "").trim();
    if (!alias) return;
    const res = await fetch(`${API_BASE}/admin/circles/${circle.id}`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ aliases: [...(circle.aliases ?? []), alias] }),
    });
    const d = await res.json();
    if (!res.ok) return toast.error(refusal(d, "Alias refused"));
    toast.success(`"${alias}" now resolves to ${circle.name}`);
    setAliasDrafts((p) => ({ ...p, [circle.id]: "" }));
    load();
  };

  const assignRole = async (roleId: string, circleId: string) => {
    const res = await fetch(`${API_BASE}/admin/roles/${roleId}`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ circleId }),
    });
    if (!res.ok) return toast.error("Assignment failed");
    // Progression's declared trigger is a real role edited into existence,
    // and this is the only role-mutation route in the admin.
    forgetExamplesCache("progression");
    load();
  };

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Circles &amp; Map</h2>
        <p className="text-sm text-gray-500">The How Power Is Held module is off. Turn it on in the Module Library (top of the {MODULES_GROUP_TITLE} group) first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Circles &amp; Map</h2>
        <p className="text-sm text-gray-500 mt-1">
          The village's shape: circles, which roles orbit them, and what the
          concierge couldn't route (your role-creation demand signal).
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <div className="space-y-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            Pre-scale requirement: a per-member block list for the contact relay is
            not built yet. Watch the contact log below for misuse until it is.
          </div>

          <div className="space-y-3">
            {circles.map((c) => (
              <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {c.name} <span className="text-xs text-gray-400 font-mono">{c.id}</span>
                      {(c as any).isExample && <ExampleChip className="ml-2 align-middle" />}
                    </h3>
                    <p className="text-xs text-gray-500">{c.purpose}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{c.status}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {(c.aliases ?? []).map((a: string) => (
                    <span key={a} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">≈ {a}</span>
                  ))}
                  <input
                    value={aliasDrafts[c.id] ?? ""}
                    onChange={(e) => setAliasDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder="add alias…"
                    className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 w-28"
                  />
                  <button onClick={() => addAlias(c)} className="text-[11px] text-teal-deep font-medium">add</button>
                </div>
              </div>
            ))}
            <div className="border border-dashed border-gray-300 rounded-xl p-4 flex flex-wrap gap-2 items-center">
              <input value={newCircle.name} onChange={(e) => setNewCircle({ ...newCircle, name: e.target.value })}
                placeholder="New circle name" className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
              <input value={newCircle.purpose} onChange={(e) => setNewCircle({ ...newCircle, purpose: e.target.value })}
                placeholder="Purpose" className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-40" />
              <button onClick={createCircle} disabled={!newCircle.name}
                className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40">Create</button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-2">Role → circle assignment</h3>
            <div className="space-y-1.5">
              {roles.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-700">
                    {r.name}
                    {r.isExample && <ExampleChip className="ml-2 align-middle" />}
                  </span>
                  <select
                    defaultValue={(r as any).circleId ?? ""}
                    onChange={(e) => assignRole(r.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                  >
                    <option value="">unassigned</option>
                    {circles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-2">Unrouted concierge asks</h3>
              {unmatched.length === 0 ? <p className="text-xs text-gray-400">None. The map covers what people ask for.</p> : (
                <ul className="space-y-1 text-xs text-gray-600">
                  {unmatched.slice(0, 12).map((q: any) => (
                    <li key={q.id}>"{q.query}" <span className="text-gray-300">· {new Date(q.created_at).toLocaleDateString()}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-2">Contact relay log</h3>
              {contacts.length === 0 ? <p className="text-xs text-gray-400">No introductions yet.</p> : (
                <ul className="space-y-1 text-xs text-gray-600">
                  {contacts.slice(0, 12).map((ct: any) => (
                    <li key={ct.id}>
                      {ct.from_user_id.slice(-6)} → {ct.to_user_id.slice(-6)}
                      <span className={`ml-2 ${ct.email_status === "sent" ? "text-emerald-600" : ct.email_status === "failed" ? "text-red-500" : "text-gray-400"}`}>
                        {ct.email_status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tools hub admin (S15): CRUD, audience, click counts, link checks ─────────

const EMPTY_TOOL = {
  name: "", purpose: "", description: "", url: "", ctaLabel: "Open",
  category: "", icon: "", visibility: "members", roleIds: [] as string[], gettingStarted: "",
};

function ToolsAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY_TOOL);
  const [editingId, setEditingId] = useState<string>("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/admin/tools`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
      ]);
      if (tRes.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await tRes.json());
      const r = await rRes.json();
      setRoles(Array.isArray(r) ? r : []);
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const isEdit = !!editingId;
    try {
      const res = await fetch(`${API_BASE}/admin/tools${isEdit ? `/${editingId}` : ""}`, {
        method: isEdit ? "PUT" : "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      // Publishing the first real one retires that module's examples server
      // side; drop the banner's cached answer so the admin does not walk to
      // the page and read "nobody here made them" over their own work.
      if (!isEdit) forgetExamplesCache("tools");
      toast.success(isEdit ? "Tool updated" : "Tool added");
      setForm(EMPTY_TOOL);
      setEditingId("");
      load();
    } catch (e: any) { toast.error(e?.message || "Save failed"); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this tool? Click history is kept.")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/tools/${id}`, { method: "DELETE", headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The tool is still on the hub.`));
        return;
      }
    } catch {
      toast.error("That did not reach the server. The tool is still on the hub.");
      return;
    }
    load();
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ids = (data?.tools ?? []).map((t: any) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // A refused reorder used to redraw the old order in silence, which reads
    // as an arrow that does nothing rather than as a refusal.
    try {
      const res = await fetch(`${API_BASE}/admin/tools/order`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(refusal(body, `The server refused that (${res.status}). The order is unchanged.`));
        return;
      }
    } catch {
      toast.error("That did not reach the server. The order is unchanged.");
      return;
    }
    load();
  };

  const checkLinks = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${API_BASE}/admin/tools/check-links`, { method: "POST", headers: authHeaders(password) });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      toast.success(`Checked ${d.checked} link(s)`);
      load();
    } catch (e: any) { toast.error(e?.message || "Check failed"); }
    setChecking(false);
  };

  const statusDot = (t: any) => {
    if (!t.lastCheckedAt) return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" title="never checked" />;
    if (t.lastCheckStatus && t.lastCheckStatus < 400) return <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title={`HTTP ${t.lastCheckStatus}`} />;
    return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title={`HTTP ${t.lastCheckStatus || "unreachable"}`} />;
  };

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Tools</h2>
        <p className="text-sm text-gray-500">
          The Tools Hub module is off. Enable it (at least to Preview) in
          Module Library (top of the {MODULES_GROUP_TITLE} group), then come back here to add tools.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Tools</h2>
          <p className="text-sm text-gray-500 mt-1">
            The village toolbox: links out to where things happen. The Hypha card is
            managed by the DHO address setting, not here.
          </p>
        </div>
        <button onClick={checkLinks} disabled={checking}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          {checking ? "Checking…" : "Check links now"}
        </button>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <div className="space-y-6">
          {/* The category list the tool form's picker reads. Validated on every
              write, refused by name when a tool names one that is missing, and
              editable by nobody until now. */}
          <ToolsCategoriesEditor password={password} />
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Audience</th>
                  <th className="px-4 py-2.5">Opens (30d)</th>
                  <th className="px-4 py-2.5">Link</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.tools ?? []).map((t: any, i: number) => (
                  <tr key={t.id} className={`border-t border-gray-100 ${t.enabled === false ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-900">{t.name}</span>
                      {t.isExample && <ExampleChip className="ml-2 align-middle" />}
                      <div className="text-xs text-gray-400">{t.purpose}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {t.visibility}{t.visibility === "roles" ? `: ${(t.roleIds ?? []).join(", ")}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{t.clicks?.d30 ?? 0}</td>
                    <td className="px-4 py-2.5">{statusDot(t)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => move(t.id, -1)} disabled={i === 0} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↑</button>
                      <button onClick={() => move(t.id, 1)} disabled={i === (data?.tools ?? []).length - 1} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↓</button>
                      <button onClick={() => { setEditingId(t.id); setForm({ ...EMPTY_TOOL, ...t }); }} className="text-xs text-teal-deep font-medium px-2">Edit</button>
                      <button onClick={() => remove(t.id)} className="text-xs text-red-500 px-1">Remove</button>
                    </td>
                  </tr>
                ))}
                {(data?.tools ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">No tools yet. Add the first one below.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">{editingId ? `Edit: ${form.name}` : "Add a tool"}</h3>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name" className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
              <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="One-line purpose" className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https:// link" className="text-sm border border-gray-200 rounded-lg px-3 py-2 sm:col-span-2 font-mono" />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="">Category…</option>
                {(data?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                {["Open", "Join", "View"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="public">Everyone (public)</option>
                <option value="members">Members (signed in)</option>
                <option value="roles">Specific roles</option>
              </select>
              <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="Icon slug (e.g. MessageCircle)" className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
              {form.visibility === "roles" && (
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  {roles.map((r) => (
                    <label key={r.id} className="text-xs text-gray-600 flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5">
                      <input type="checkbox" checked={(form.roleIds ?? []).includes(r.id)}
                        onChange={(e) => setForm({
                          ...form,
                          roleIds: e.target.checked
                            ? [...(form.roleIds ?? []), r.id]
                            : (form.roleIds ?? []).filter((x: string) => x !== r.id),
                        })} />
                      {r.name}
                    </label>
                  ))}
                </div>
              )}
              <textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Longer description (optional)" rows={2} className="text-sm border border-gray-200 rounded-lg px-3 py-2 sm:col-span-2" />
              <input value={form.gettingStarted ?? ""} onChange={(e) => setForm({ ...form, gettingStarted: e.target.value })}
                placeholder="Getting-started note (optional)" className="text-sm border border-gray-200 rounded-lg px-3 py-2 sm:col-span-2" />
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={save} disabled={!form.name || !form.purpose || !form.url || !form.category}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                {editingId ? "Save changes" : "Add tool"}
              </button>
              {editingId && (
                <button onClick={() => { setEditingId(""); setForm(EMPTY_TOOL); }}
                  className="text-sm border border-gray-200 rounded-lg px-4 py-2 text-gray-600">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Token registry + capped mint (S9, Gate D: admins name their tokens) ──────

/**
 * S30-S32: Stays & Payments. Rooms + posted prices, the stay pipeline
 * (requested → active → ended, all human acts), purchases with the manual
 * path, the nightly-posting catch-up button, and the platform payment
 * surfaces (suspensions, recent charges, webhook log).
 */
function StaysAdminTab({ password, onOpenTab }: { password: string; onOpenTab: (tab: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [payments, setPayments] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roomForm, setRoomForm] = useState({ name: "", description: "", capacity: 1 });
  const [priceDraft, setPriceDraft] = useState<Record<string, any>>({});
  /**
   * 0092: which of the village's own tokens each room is priced in, keyed by
   * room. Held per room because a village may run more than one credit token
   * and a lodge and a bunkhouse can honestly take different ones.
   */
  const [villageToken, setVillageToken] = useState<Record<string, string>>({});
  /** 0092: which token each pending stay is about to be activated in. */
  const [activateToken, setActivateToken] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({ userId: "", accommodationId: "", nights: "", amountUsd: "" });
  const [grant, setGrant] = useState({ userId: "", credits: "", note: "", kind: "comp" });
  const [players, setPlayers] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, plRes] = await Promise.all([
        fetch(`${API_BASE}/admin/stays`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/payments`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
      ]);
      if (sRes.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await sRes.json());
      setPayments(pRes.ok ? await pRes.json() : null);
      const pl = await plRes.json();
      setPlayers(Array.isArray(pl) ? pl : []);
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      return d;
    } catch (e: any) {
      toast.error(e?.message || "Request failed");
      return null;
    }
  };

  /**
   * 0092: the payable tokens this deployment issues, and the one a room is
   * already priced in.
   *
   * READ FROM THE ROOM'S OWN POSTED PRICES rather than from a default, so
   * opening the panel on a room somebody priced last month shows that price
   * instead of quietly offering to replace it with a different token's.
   */
  const payableTokens: Array<{ slug: string; name: string }> = data?.payableTokens ?? [];
  const firstPricedVillageToken = (acc: any): string | undefined =>
    payableTokens.map((t) => t.slug).find((slug) => acc.prices?.[slug]);

  const addRoom = async () => {
    if (!roomForm.name.trim()) return toast.error("Name the room");
    const d = await post("/admin/stays/accommodations", roomForm);
    if (d) { forgetExamplesCache("stays"); toast.success("Room added. Now post its prices"); setRoomForm({ name: "", description: "", capacity: 1 }); load(); }
  };

  const savePrices = async (acc: any) => {
    const draft = priceDraft[acc.id] ?? {};
    const val = (k: string, fallback?: number) => {
      const raw = draft[k];
      if (raw === undefined) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const prices: any[] = [];
    const cg = val("cg", acc.prices?.["stay-credit"]?.guest);
    const cm = val("cm", acc.prices?.["stay-credit"]?.member);
    const ug = val("ug", acc.prices?.usd?.guest ? acc.prices.usd.guest / 100 : undefined);
    const um = val("um", acc.prices?.usd?.member ? acc.prices.usd.member / 100 : undefined);
    if (cg) prices.push({ tokenType: "stay-credit", audience: "guest", amountMinor: Math.floor(cg) });
    if (cm) prices.push({ tokenType: "stay-credit", audience: "member", amountMinor: Math.floor(cm) });
    if (ug) prices.push({ tokenType: "usd", audience: "guest", amountMinor: Math.round(ug * 100) });
    if (um) prices.push({ tokenType: "usd", audience: "member", amountMinor: Math.round(um * 100) });
    /*
     * 0092: THE VILLAGE'S OWN CREDITS, alongside stay credits and usd.
     *
     * This is the sink that gives the cycle pool's token somewhere to go: a
     * guest pays for a night in the same credits gratitude routed to them.
     * Either accepted, never a rate between the two, so the room simply posts
     * a price in each and the stay is activated in one of them.
     *
     * The PUT deactivates every posted price for the room and re-inserts what
     * it is sent, so an unchanged rate has to travel too. `val` reads the
     * stored figure as its fallback, which is what keeps a price somebody did
     * not touch from being switched off.
     */
    const vSlug = villageToken[acc.id] ?? firstPricedVillageToken(acc) ?? payableTokens[0]?.slug ?? "";
    if (vSlug) {
      const vg = val("vg", acc.prices?.[vSlug]?.guest);
      const vm = val("vm", acc.prices?.[vSlug]?.member);
      if (vg) prices.push({ tokenType: vSlug, audience: "guest", amountMinor: Math.floor(vg) });
      if (vm) prices.push({ tokenType: vSlug, audience: "member", amountMinor: Math.floor(vm) });
    }
    const d = await post(`/admin/stays/accommodations/${acc.id}/prices`, { prices }, "PUT");
    if (d) { toast.success("Prices posted"); setPriceDraft((p) => ({ ...p, [acc.id]: {} })); load(); }
  };

  const recordManual = async () => {
    const d = await post("/admin/stays/purchases/manual", {
      userId: manual.userId,
      accommodationId: manual.accommodationId,
      nights: Number(manual.nights),
      amountMinor: Math.round((Number(manual.amountUsd) || 0) * 100),
    });
    if (d) { toast.success(`${d.creditsGranted} credit(s) granted`); setManual({ userId: "", accommodationId: "", nights: "", amountUsd: "" }); load(); }
  };

  const grantCredits = async () => {
    const path = grant.kind === "comp" ? "/admin/stays/comp" : "/admin/stays/adjust";
    const d = await post(path, { userId: grant.userId, credits: Number(grant.credits), note: grant.note });
    if (d) { toast.success(grant.kind === "comp" ? "Comped" : "Adjusted"); setGrant({ userId: "", credits: "", note: "", kind: grant.kind }); load(); }
  };

  const money = (minor: number) => `$${(Number(minor || 0) / 100).toFixed(2)}`;
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Stays & Payments</h2>
        <p className="text-sm text-gray-500">
          The Stays module is off. Turn it on in the Module Library (top of the {MODULES_GROUP_TITLE} group, it is
          funds-bearing, and the legal card will walk you through the posture),
          then come back here to post rooms and rates.
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Stays & Payments</h2>
        <p className="text-sm text-gray-500 mb-4">
          One credit hosts one night. Rates snapshot at activation; nightly
          credits post automatically after the configured hour, and the button
          below catches up on demand. Stays are never ended automatically.
        </p>
        <TokenNamingLink what="Stay credits" onOpenTab={onOpenTab} />
        <button
          onClick={async () => { const d = await post("/admin/stays/post-nights"); if (d) { toast.success(`${d.posted} night(s) posted across ${d.swept} stay(s)`); load(); } }}
          className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
        >
          Post nights now
        </button>
      </div>

      {/* Rooms + posted prices */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Rooms & posted prices</h3>
        <div className="space-y-4">
          {(data?.accommodations ?? []).map((a: any) => (
            <div key={a.id} className={`border rounded-lg p-4 ${a.active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-gray-900">
                  {a.name} {!a.active && <span className="text-xs text-gray-400">(inactive)</span>}
                  {a.isExample && <ExampleChip className="ml-2 align-middle" />}
                  {/* Capacity was recorded and never shown anywhere. A flag,
                      not a block: whoever activates a stay is the one who
                      knows whether the room is really full. */}
                  <span className={`ml-2 text-xs font-normal ${a.overCapacity ? "text-amber-700" : "text-gray-400"}`}>
                    {a.activeStays ?? 0} of {a.capacity} {a.overCapacity ? "over capacity" : "in residence"}
                  </span>
                </p>
                {/* Both write routes refuse an example room, and the price one
                    would otherwise have deactivated every posted rate before
                    it got to the refusal. The controls come off so the founder
                    learns that from the row, not from a 409 after typing. */}
                {!a.isExample && (
                  <button
                    onClick={async () => { const d = await post(`/admin/stays/accommodations/${a.id}`, { active: !a.active }, "PUT"); if (d) load(); }}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    {a.active ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                {[
                  { k: "cg", label: "Credits/night (guest)", cur: a.prices?.["stay-credit"]?.guest },
                  { k: "cm", label: "Credits/night (member)", cur: a.prices?.["stay-credit"]?.member },
                  { k: "ug", label: "USD/night (guest)", cur: a.prices?.usd?.guest != null ? a.prices.usd.guest / 100 : undefined },
                  { k: "um", label: "USD/night (member)", cur: a.prices?.usd?.member != null ? a.prices.usd.member / 100 : undefined },
                  ...(payableTokens.length
                    ? (() => {
                        const slug = villageToken[a.id] ?? firstPricedVillageToken(a) ?? payableTokens[0].slug;
                        const name = payableTokens.find((t) => t.slug === slug)?.name ?? slug;
                        return [
                          { k: "vg", label: `${name}/night (guest)`, cur: a.prices?.[slug]?.guest },
                          { k: "vm", label: `${name}/night (member)`, cur: a.prices?.[slug]?.member },
                        ];
                      })()
                    : []),
                ].map(({ k, label, cur }) => (
                  <label key={k} className="text-xs text-gray-500">
                    {label}
                    <input
                      type="number" min={0} step={k.startsWith("u") ? "0.01" : "1"}
                      value={priceDraft[a.id]?.[k] ?? cur ?? ""}
                      disabled={a.isExample}
                      onChange={(e) => setPriceDraft((p) => ({ ...p, [a.id]: { ...(p[a.id] ?? {}), [k]: e.target.value } }))}
                      className={`${inputCls} w-full mt-1 disabled:bg-gray-50 disabled:text-gray-400`}
                    />
                  </label>
                ))}
              </div>
              {/* 0092: which of the village's tokens the last two fields are
                  about. Only rendered when the village has more than one, so a
                  deployment with a single credit token sees a plain price
                  field and no question it does not have. */}
              {payableTokens.length > 1 && !a.isExample && (
                <label className="mt-2 block text-xs text-gray-500">
                  Which village token
                  <select
                    value={villageToken[a.id] ?? firstPricedVillageToken(a) ?? payableTokens[0].slug}
                    onChange={(e) => setVillageToken((v) => ({ ...v, [a.id]: e.target.value }))}
                    className={`${inputCls} w-full mt-1`}
                  >
                    {payableTokens.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {a.isExample ? (
                <p className="mt-2 text-xs text-amber-700">
                  A standing example. Its posted rates are here to show what the
                  module does, and nothing you do to them takes effect. Add your
                  own room to clear the examples.
                </p>
              ) : (
                <button onClick={() => savePrices(a)} className="mt-2 text-sm text-teal-deep font-medium hover:underline">
                  Post prices
                </button>
              )}
            </div>
          ))}
        </div>
        {/* Capacity has to be settable here, or the over-capacity flag on the
            rooms above is permanently lit for every multi-bed space (the form
            hard-coded 1) and stewards learn to ignore it — worse than no flag. */}
        <div className="mt-4 border-t border-gray-100 pt-4 grid sm:grid-cols-4 gap-2 items-end">
          <label className="text-xs text-gray-500">Room name
            <input value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          <label className="text-xs text-gray-500">Description
            <input value={roomForm.description} onChange={(e) => setRoomForm({ ...roomForm, description: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          <label className="text-xs text-gray-500">Sleeps
            <input
              type="number"
              min={1}
              value={roomForm.capacity}
              onChange={(e) => setRoomForm({ ...roomForm, capacity: Math.max(1, Number(e.target.value) || 1) })}
              className={`${inputCls} w-full mt-1`}
            />
          </label>
          <button onClick={addRoom} className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">Add room</button>
        </div>
      </div>

      {/* Stays pipeline */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Stays</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3">Guest</th><th className="py-1 pr-3">Room</th><th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Rate</th><th className="py-1 pr-3">Balance</th><th className="py-1 pr-3">Nights left</th>
              <th className="py-1 pr-3">Autopay</th><th className="py-1" />
            </tr></thead>
            <tbody>
              {(data?.stays ?? []).map((s: any) => (
                <tr key={s.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-900">{s.userName}</td>
                  <td className="py-2 pr-3 text-gray-600">{(data?.accommodations ?? []).find((a: any) => a.id === s.accommodationId)?.name ?? s.accommodationId}</td>
                  <td className="py-2 pr-3">{s.status}</td>
                  {/* 0092: the rate means nothing without the token it is in,
                      now that a night can be paid in either. */}
                  <td className="py-2 pr-3">
                    {s.rateSnapshotCredits ?? "-"}
                    {s.rateSnapshotCredits ? ` ${s.rateTokenName ?? s.rateSnapshotToken}` : ""}
                    {s.audienceSnapshot ? ` (${s.audienceSnapshot})` : ""}
                  </td>
                  <td className={`py-2 pr-3 ${s.balance < 0 ? "text-red-600 font-semibold" : ""}`}>{s.balance}</td>
                  <td className="py-2 pr-3">{s.nightsRemaining ?? "-"}</td>
                  <td className="py-2 pr-3">
                    <button onClick={async () => { const d = await post(`/admin/stays/${s.id}`, { autopay: !s.autopay }, "PUT"); if (d) load(); }}
                      className={`text-xs px-2 py-0.5 rounded-full ${s.autopay ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {s.autopay ? "on" : "off"}
                    </button>
                  </td>
                  <td className="py-2 text-right space-x-2 whitespace-nowrap">
                    {/* 0092: activation is the snapshot moment, and it now
                        snapshots WHICH token as well as how much. The desk picks
                        from the rates the room actually posts, so a steward can
                        never activate a stay against a price that does not
                        exist. */}
                    {(s.status === "requested" || s.status === "active") && (
                      <>
                      <select
                        value={activateToken[s.id] ?? "stay-credit"}
                        onChange={(e) => setActivateToken((v) => ({ ...v, [s.id]: e.target.value }))}
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 mr-1"
                      >
                        {Object.keys((data?.accommodations ?? []).find((a: any) => a.id === s.accommodationId)?.prices ?? { "stay-credit": {} })
                          .filter((slug) => slug !== "usd")
                          .map((slug) => (
                            <option key={slug} value={slug}>
                              {payableTokens.find((t) => t.slug === slug)?.name ?? (slug === "stay-credit" ? "Stay Credits" : slug)}
                            </option>
                          ))}
                      </select>
                      <button onClick={async () => { const d = await post(`/admin/stays/${s.id}/activate`, { tokenType: activateToken[s.id] ?? "stay-credit" }); if (d) { toast.success(`Active at ${d.rateSnapshotCredits}/night (${d.audienceSnapshot})`); load(); } }}
                        className="text-xs text-teal-deep font-medium hover:underline">
                        {s.status === "active" ? "Re-rate" : "Activate"}
                      </button>
                      </>
                    )}
                    {s.status !== "ended" && s.status !== "cancelled" && (
                      <button onClick={async () => { if (!window.confirm("End this stay?")) return; const d = await post(`/admin/stays/${s.id}/end`); if (d) load(); }}
                        className="text-xs text-gray-500 hover:text-red-600">End</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.stays ?? []).length === 0 && <p className="text-sm text-gray-400 py-3">No stays yet.</p>}
        </div>
      </div>

      {/* Grants + manual purchase */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-1">Comp / adjust credits</h3>
          <p className="text-xs text-gray-500 mb-3">Comp is a gift. Adjust is a correction (negative removes). Both land on the ledger, audited.</p>
          <div className="space-y-2">
            <select value={grant.userId} onChange={(e) => setGrant({ ...grant, userId: e.target.value })} className={`${inputCls} w-full`}>
              <option value="">Member…</option>
              {players.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={grant.kind} onChange={(e) => setGrant({ ...grant, kind: e.target.value })} className={inputCls}>
                <option value="comp">Comp</option>
                <option value="adjust">Adjust</option>
              </select>
              <input type="number" placeholder="Credits" value={grant.credits} onChange={(e) => setGrant({ ...grant, credits: e.target.value })} className={`${inputCls} w-24`} />
              <input placeholder="Note" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} className={`${inputCls} flex-1`} />
            </div>
            <button onClick={grantCredits} disabled={!grant.userId || !grant.credits}
              className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">Apply</button>
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-1">Record a manual payment</h3>
          <p className="text-xs text-gray-500 mb-3">Cash, Zeffy, bank transfer. Credits are derived from nights × the room's posted rate. You record the money, the server does the math.</p>
          <div className="space-y-2">
            <select value={manual.userId} onChange={(e) => setManual({ ...manual, userId: e.target.value })} className={`${inputCls} w-full`}>
              <option value="">Member…</option>
              {players.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={manual.accommodationId} onChange={(e) => setManual({ ...manual, accommodationId: e.target.value })} className={`${inputCls} flex-1`}>
                <option value="">Room…</option>
                {(data?.accommodations ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input type="number" placeholder="Nights" value={manual.nights} onChange={(e) => setManual({ ...manual, nights: e.target.value })} className={`${inputCls} w-20`} />
              <input type="number" step="0.01" placeholder="USD" value={manual.amountUsd} onChange={(e) => setManual({ ...manual, amountUsd: e.target.value })} className={`${inputCls} w-24`} />
            </div>
            <button onClick={recordManual} disabled={!manual.userId || !manual.accommodationId || !manual.nights}
              className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">Record & grant</button>
          </div>
        </div>
      </div>

      {/* Purchases */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Purchases</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3">When</th><th className="py-1 pr-3">Member</th><th className="py-1 pr-3">Nights</th>
              <th className="py-1 pr-3">Paid</th><th className="py-1 pr-3">Credits</th><th className="py-1 pr-3">Via</th>
              <th className="py-1 pr-3">Status</th><th className="py-1" />
            </tr></thead>
            <tbody>
              {(data?.purchases ?? []).map((p: any) => (
                <tr key={p.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">{players.find((pl: any) => pl.id === p.user_id)?.name ?? p.user_id}</td>
                  <td className="py-2 pr-3">{p.nights ?? "-"}</td>
                  <td className="py-2 pr-3">{money(p.amount_minor)}</td>
                  <td className="py-2 pr-3">{p.credits_granted}</td>
                  <td className="py-2 pr-3">{p.provider}</td>
                  <td className={`py-2 pr-3 ${["disputed", "reversed"].includes(p.status) ? "text-red-600 font-semibold" : ""}`}>{p.status}</td>
                  <td className="py-2 text-right">
                    {p.status === "paid" && (
                      <button onClick={async () => {
                        if (!window.confirm("Hold the credits back for a refund? You then refund the money where it was paid.")) return;
                        const d = await post(`/admin/stays/purchases/${p.id}/refund`);
                        if (d) { toast.success(d.nextStep); load(); }
                      }} className="text-xs text-gray-500 hover:text-red-600">Refund…</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.purchases ?? []).length === 0 && <p className="text-sm text-gray-400 py-3">No purchases yet.</p>}
        </div>
      </div>

      {/* Platform payments: suspensions + log */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Payment guardrails</h3>
        <p className="text-xs text-gray-500 mb-3">
          Disputes and chargebacks suspend purchasing automatically, across every
          module. Lift a suspension once the situation is resolved.
          {payments && !payments.stripeConfigured && " Stripe is NOT configured. Card checkout is off; manual payments still work."}
        </p>
        {(payments?.suspensions ?? []).filter((s: any) => !s.lifted_at).map((s: any) => (
          <div key={s.id} className="flex items-center justify-between border-t border-gray-50 py-2 text-sm">
            <span><b>{s.user_name ?? s.user_id}</b>: {s.reason}</span>
            <button onClick={async () => { const d = await post(`/admin/payments/suspensions/${s.id}/lift`); if (d) { toast.success("Lifted"); load(); } }}
              className="text-xs text-teal-deep font-medium hover:underline">Lift</button>
          </div>
        ))}
        {(payments?.suspensions ?? []).filter((s: any) => !s.lifted_at).length === 0 && (
          <p className="text-sm text-gray-400">No active suspensions.</p>
        )}
        {(payments?.log ?? []).length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer">Webhook log (latest {payments.log.length})</summary>
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {payments.log.map((l: any) => (
                <p key={l.id} className={`text-xs ${l.outcome === "ok" ? "text-gray-500" : "text-red-600"}`}>
                  {new Date(l.at).toLocaleString()}: {l.type} → {l.outcome}{l.module ? ` (${l.module}:${l.order_id ?? ""})` : ""}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * S33-S35: the buy-only exchange. Listings (with the firewalls' refusal
 * reasons shown, not hidden), append-only prices with a required note,
 * treasury stock under the shared mint cap, and the order book.
 */
function ExchangeAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [priceForm, setPriceForm] = useState<Record<string, { usd?: string; note?: string }>>({});
  const [stockForm, setStockForm] = useState({ tokenSlug: "", amount: "" });
  const [swapForm, setSwapForm] = useState<Record<string, { perCycle?: string; perMember?: string; note?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/exchange`, { headers: authHeaders(password) });
      if (res.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      return d;
    } catch (e: any) { toast.error(e?.message || "Request failed"); return null; }
  };

  const money = (minor: number) => `$${(Number(minor || 0) / 100).toFixed(2)}`;
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Exchange</h2>
        <p className="text-sm text-gray-500">
          The Exchange module is off. Turn it on in the Module Library (top of the
          {MODULES_GROUP_TITLE} group; it is funds-bearing, so the legal card applies), then list tokens and post prices here.
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  const settingsBySlug = new Map((data?.settings ?? []).map((s: any) => [s.tokenSlug, s]));

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Exchange</h2>
        <p className="text-sm text-gray-500">
          Recognition and Hypha tokens can never be listed; a token another
          module sells can't be listed twice. Prices are append-only and
          bounded per change; stock comes out of the same per-cycle mint cap
          as hand-mints. Swapping refuses more still: anything a faucet has
          paid a member is never swappable, whatever it was earned for.
        </p>
      </div>

      {/* Gate B's switch. Internal trading is a decision each deployment makes
          for itself, so the caution card is read HERE, by the steward doing it,
          and the acceptance is version-stamped by the server. */}
      <div className={`rounded-xl border p-5 ${data?.tradingEnabled ? "border-teal-deep/30 bg-teal-deep/5" : "border-gray-200 bg-gray-50"}`}>
        <h3 className="font-semibold text-gray-900 mb-1">
          Token-for-token swapping is {data?.tradingEnabled ? "ON" : "OFF"}
        </h3>
        {data?.tradingEnabled ? (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Members can trade one listed token for another at the posted prices,
              within the caps set per token below. Accepted{" "}
              {data.legalAck?.acceptedAt ? new Date(data.legalAck.acceptedAt).toLocaleDateString() : "-"} by{" "}
              {data.legalAck?.acceptedBy ?? "-"} (card {data.legalAck?.cardVersion ?? "-"}).
            </p>
            <button
              onClick={async () => {
                if (!window.confirm("Turn swapping off? Members keep every token they hold; no new swaps can start.")) return;
                const d = await call("/admin/modules/exchange/config", { config: { tradingEnabled: false } }, "PUT");
                if (d) { toast.success("Swapping is off"); load(); }
              }}
              className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-medium"
            >
              Turn swapping off
            </button>
          </>
        ) : (
          <>
            {data?.legalAck?.cardVersion && data.legalAck.cardVersion !== data.legalCardVersion && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                Swapping closed itself: this village accepted card {data.legalAck.cardVersion}, and
                the current one is {data.legalCardVersion}. The terms below were amended. Read them
                again and re-accept to reopen. Nobody's tokens were touched.
              </p>
            )}
            <p className="text-xs text-gray-500 mb-2">
              Before you turn this on, read what it means (card {data?.legalCardVersion}):
            </p>
            <ul className="text-xs text-gray-600 space-y-1.5 mb-3 list-disc pl-4">
              <li>
                Members will trade tokens with each other's village at prices your
                stewards post. Depending on where you operate, that can be a
                regulated activity. This is the point to ask a lawyer, not after.
              </li>
              <li>
                Tokens never convert back to money here. Fiat comes IN only; the
                platform has no path out, by design, and adding one is not a setting.
              </li>
              <li>
                Anything a faucet has paid a member (recognition, rewards, minted
                credits) can never be swapped, whatever else you list.
              </li>
              <li>
                Swaps are final. There is no reversal, no dispute queue, no chargeback;
                the only way back is swapping again at the posted prices.
              </li>
              <li>
                Every token you open needs a per-cycle cap and a per-member cap. Zero
                means zero. Set them before you announce this to anyone.
              </li>
            </ul>
            <button
              onClick={async () => {
                if (!window.confirm(`Accept caution card ${data?.legalCardVersion} and open token-for-token swapping? Your name and the time are recorded.`)) return;
                const d = await call("/admin/modules/exchange/config", {
                  config: { tradingEnabled: true, legalAck: { cardVersion: data?.legalCardVersion } },
                }, "PUT");
                if (d) { toast.success("Swapping is on. Set caps per token below"); load(); }
              }}
              className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
            >
              Accept and open swapping
            </button>
          </>
        )}
      </div>

      {/* L9: the library-credit sale card. Selling a shelf-backed credit
          changes what the token IS, so it opens like trading opened —
          read here, accepted by a named admin, stamped by the server. */}
      {data?.creditSale?.libraryOn && (
        <div className={`rounded-xl border p-5 ${data.creditSale.open ? "border-teal-deep/30 bg-teal-deep/5" : "border-amber-200 bg-amber-50/50"}`}>
          <h3 className="font-semibold text-gray-900 mb-1">
            Selling library credits is {data.creditSale.open ? "OPEN" : "CLOSED"}
          </h3>
          {data.creditSale.open ? (
            <>
              <p className="text-xs text-gray-500 mb-3">
                Library credits can be listed and sold for fiat like any credit token.
                Accepted {data.creditSale.ack?.acceptedAt ? new Date(data.creditSale.ack.acceptedAt).toLocaleDateString() : "-"} by{" "}
                {data.creditSale.ack?.acceptedBy ?? "-"} (card {data.creditSale.ack?.cardVersion}). Swapping stays sealed regardless.
              </p>
              <button
                onClick={async () => {
                  if (!window.confirm("Close credit sales? Existing holders keep every credit; the listing is refused from the next sale on.")) return;
                  const d = await call("/admin/modules/library/config", { config: { creditSaleEnabled: false } }, "PUT");
                  if (d) { toast.success("Credit sales closed"); load(); }
                }}
                className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-medium"
              >
                Close credit sales
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Before you open this, read what it changes (card {data.creditSale.cardVersion}):
              </p>
              <ul className="text-xs text-gray-600 space-y-1.5 mb-3 list-disc pl-4">
                <li>
                  Today every library credit is backed by a physical item someone brought
                  to the shelf. A SOLD credit is backed by money instead, and after the
                  sale, the two are indistinguishable claims on the same shelves.
                </li>
                <li>
                  If more credits circulate than the shelves can honor, the promise
                  behind every credit, including the earned ones, weakens. Stock
                  the treasury conservatively and watch the ledger's two provenances
                  (sys:library-mint = shelf-backed intake; sys:mint = sold stock).
                </li>
                <li>
                  Prepaid credits can be a regulated product (gift-card and escheatment
                  law in some places). This is the point to ask a lawyer, not after.
                </li>
                <li>Fiat still flows IN only, and credits still never swap. This card opens the shop, never the market.</li>
              </ul>
              <button
                onClick={async () => {
                  if (!window.confirm(`Accept caution card ${data.creditSale.cardVersion} and open library-credit sales? Your name and the time are recorded.`)) return;
                  const d = await call("/admin/modules/library/config", {
                    config: { creditSaleEnabled: true, creditSaleAck: { cardVersion: data.creditSale.cardVersion } },
                  }, "PUT");
                  if (d) { toast.success("Credit sales open. List and price library-credit below"); load(); }
                }}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
              >
                Accept and open credit sales
              </button>
            </>
          )}
        </div>
      )}

      {/* Listings */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Listings</h3>
        <div className="space-y-3">
          {(data?.listableTokens ?? []).map((t: any) => {
            const s: any = settingsBySlug.get(t.slug);
            const price = data?.latestPrices?.[t.slug];
            const stock = data?.stock?.[t.slug] ?? 0;
            // No example branch here on purpose. listableTokens() filters
            // them out and drops the flag, so `t.isExample` was always
            // undefined and the branch that read it was dead code. The filter
            // is the safer half of the pair: this list also feeds the "stock
            // the treasury" picker below, and stocking an example token writes
            // real ledger rows against a slug retirement then deletes, which
            // refuses the NEXT boot. The example token is shown, with a chip,
            // in the Tokens table, which reads the unfiltered registry.
            const locked = !!t.reason;
            return (
              <div key={t.slug} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {t.name} <span className="text-xs text-gray-400">({t.slug} · {t.kind})</span>
                    </p>
                    {t.reason ? (
                      <p className="text-xs text-amber-700 mt-0.5">{t.reason}</p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {price ? `${money(price.priceMinor)} each` : "no price posted"} · {stock} in stock
                        {s?.purchasable ? " · LISTED" : " · not listed"}
                      </p>
                    )}
                  </div>
                  {!locked && (
                    <button
                      onClick={async () => {
                        const d = await call(`/admin/exchange/tokens/${t.slug}`, { purchasable: !s?.purchasable }, "PUT");
                        if (d) {
                          // Listing a real token is the exchange's other
                          // retirement trigger, beside creating one.
                          forgetExamplesCache("exchange");
                          toast.success(s?.purchasable ? "Delisted" : "Listed");
                          load();
                        }
                      }}
                      className={`text-sm rounded-lg px-3 py-1.5 font-medium ${s?.purchasable ? "bg-gray-100 text-gray-600" : "bg-teal-deep text-white"}`}
                    >
                      {s?.purchasable ? "Delist" : "List for purchase"}
                    </button>
                  )}
                </div>
                {!locked && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-gray-500">Price (USD each)
                      <input type="number" step="0.01" min="0" value={priceForm[t.slug]?.usd ?? ""}
                        onChange={(e) => setPriceForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), usd: e.target.value } }))}
                        className={`${inputCls} w-24 mt-1 block`} />
                    </label>
                    <label className="text-xs text-gray-500 flex-1 min-w-[180px]">Why this price? (required)
                      <input value={priceForm[t.slug]?.note ?? ""}
                        onChange={(e) => setPriceForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), note: e.target.value } }))}
                        className={`${inputCls} w-full mt-1 block`} />
                    </label>
                    <button
                      onClick={async () => {
                        const f = priceForm[t.slug] ?? {};
                        const d = await call(`/admin/exchange/tokens/${t.slug}/price`, {
                          priceMinor: Math.round((Number(f.usd) || 0) * 100), note: f.note ?? "",
                        });
                        if (d) { toast.success("Price posted"); setPriceForm((p) => ({ ...p, [t.slug]: {} })); load(); }
                      }}
                      className="text-sm text-teal-deep font-medium hover:underline pb-2"
                    >
                      Post price
                    </button>
                  </div>
                )}
                {/* Swapping (v2). Refuses MORE than buying: a token any faucet
                    has paid a member cannot be swapped, however it was earned. */}
                {!locked && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    {data?.swapReasons?.[t.slug] ? (
                      <p className="text-xs text-amber-700">Not swappable: {data.swapReasons[t.slug]}</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="text-xs text-gray-500">Swapped out / cycle
                            <input type="number" min={0} className={`${inputCls} w-24 mt-1 block`}
                              value={swapForm[t.slug]?.perCycle ?? String(s?.maxSwapOutPerCycle ?? 0)}
                              onChange={(e) => setSwapForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), perCycle: e.target.value } }))} />
                          </label>
                          <label className="text-xs text-gray-500">Per member / cycle
                            <input type="number" min={0} className={`${inputCls} w-24 mt-1 block`}
                              value={swapForm[t.slug]?.perMember ?? String(s?.maxSwapOutPerMemberPerCycle ?? 0)}
                              onChange={(e) => setSwapForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), perMember: e.target.value } }))} />
                          </label>
                          <button
                            onClick={async () => {
                              const f = swapForm[t.slug] ?? {};
                              const d = await call(`/admin/exchange/tokens/${t.slug}`, {
                                swappable: true,
                                maxSwapOutPerCycle: Number(f.perCycle ?? s?.maxSwapOutPerCycle ?? 0),
                                maxSwapOutPerMemberPerCycle: Number(f.perMember ?? s?.maxSwapOutPerMemberPerCycle ?? 0),
                              }, "PUT");
                              // Same route, same trigger: any settings write
                              // on a real token retires the example market.
                              if (d) { forgetExamplesCache("exchange"); toast.success(s?.swappable ? "Caps saved" : "Swapping opened"); load(); }
                            }}
                            className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium"
                          >
                            {s?.swappable ? "Save caps" : "Open swapping"}
                          </button>
                          {s?.swappable && (
                            <button
                              onClick={async () => {
                                const d = await call(`/admin/exchange/tokens/${t.slug}`, { swappable: false }, "PUT");
                                if (d) { forgetExamplesCache("exchange"); toast.success("Swapping closed"); load(); }
                              }}
                              className="text-sm text-gray-600 bg-gray-100 rounded-lg px-3 py-1.5 font-medium"
                            >
                              Close swapping
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          0 means ZERO, never unlimited. A cap of 0 keeps this token from being
                          swapped out at all, even while it is open. The spread the village keeps
                          on every swap is one setting for all tokens, in basis points: Game
                          Mechanics → exchange.swap_spread_bps (0 = no spread). Rounding dust
                          always favours the treasury on top of it.
                        </p>
                        {s?.swappable && !s?.swapHaltedAt && (
                          <div className="flex flex-wrap items-end gap-2">
                            <input placeholder="Reason (shown to members)" className={`${inputCls} flex-1 min-w-[180px]`}
                              value={swapForm[t.slug]?.note ?? ""}
                              onChange={(e) => setSwapForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), note: e.target.value } }))} />
                            <button
                              onClick={async () => {
                                const d = await call(`/admin/exchange/tokens/${t.slug}/halt`, { reason: swapForm[t.slug]?.note ?? "" });
                                if (d) { toast.success("Swapping paused"); setSwapForm((p) => ({ ...p, [t.slug]: {} })); load(); }
                              }}
                              className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 font-medium"
                            >
                              Pause swapping
                            </button>
                          </div>
                        )}
                        {s?.swapHaltedAt && (
                          <div className="space-y-2">
                            <p className="text-xs text-amber-700">
                              PAUSED{s.swapHaltReason ? `: ${s.swapHaltReason}` : ""}
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                              <input placeholder="Why is it safe to resume? (a sentence)" className={`${inputCls} flex-1 min-w-[220px]`}
                                value={swapForm[t.slug]?.note ?? ""}
                                onChange={(e) => setSwapForm((p) => ({ ...p, [t.slug]: { ...(p[t.slug] ?? {}), note: e.target.value } }))} />
                              <button
                                onClick={async () => {
                                  const d = await call(`/admin/exchange/tokens/${t.slug}/resume`, { note: swapForm[t.slug]?.note ?? "" });
                                  if (d) { toast.success("Swapping resumed"); setSwapForm((p) => ({ ...p, [t.slug]: {} })); load(); }
                                }}
                                className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium"
                              >
                                Resume
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stock */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Stock the treasury</h3>
        <p className="text-xs text-gray-500 mb-3">
          sys:mint → sys:treasury, under the shared per-cycle mint cap
          ({data?.mintCapPerCycle}). Sales come OUT of this stock. An empty
          treasury fails a sale loudly instead of minting quietly.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <select value={stockForm.tokenSlug} onChange={(e) => setStockForm({ ...stockForm, tokenSlug: e.target.value })} className={inputCls}>
            <option value="">Token…</option>
            {(data?.listableTokens ?? []).filter((t: any) => !t.reason).map((t: any) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
          <input type="number" min={1} placeholder="Amount" value={stockForm.amount}
            onChange={(e) => setStockForm({ ...stockForm, amount: e.target.value })} className={`${inputCls} w-28`} />
          <button
            onClick={async () => {
              const d = await call("/admin/exchange/stock", { tokenSlug: stockForm.tokenSlug, amount: Number(stockForm.amount) });
              if (d) { toast.success(`Treasury now holds ${d.treasuryBalance}`); setStockForm({ tokenSlug: "", amount: "" }); load(); }
            }}
            disabled={!stockForm.tokenSlug || !stockForm.amount}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
          >
            Stock
          </button>
        </div>
      </div>

      {/* Orders */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Orders</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3">#</th><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Member</th>
              <th className="py-1 pr-3">Token</th><th className="py-1 pr-3">Qty</th><th className="py-1 pr-3">Paid</th><th className="py-1 pr-3">Status</th>
            </tr></thead>
            <tbody>
              {(data?.orders ?? []).map((o: any) => (
                <tr key={o.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 text-gray-500">#{o.receipt_no}</td>
                  <td className="py-2 pr-3 text-gray-500">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">{o.user_name ?? o.user_id}</td>
                  <td className="py-2 pr-3">
                    {o.kind === "swap" ? `${o.pay_token_slug} → ${o.token_slug}` : o.token_slug}
                  </td>
                  <td className="py-2 pr-3">
                    {o.kind === "swap" ? `${o.pay_quantity} → ${o.quantity}` : o.quantity}
                  </td>
                  {/* A swap's amount_minor is a VALUATION, not a charge. */}
                  <td className="py-2 pr-3">
                    {o.kind === "swap" ? <span className="text-gray-400">{money(o.amount_minor)} of value</span> : money(o.amount_minor)}
                  </td>
                  <td className={`py-2 pr-3 ${["disputed", "reversed"].includes(o.status) ? "text-red-600 font-semibold" : ""}`}>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.orders ?? []).length === 0 && <p className="text-sm text-gray-400 py-3">No orders yet.</p>}
        </div>
        {(data?.priceHistory ?? []).length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer">Price history (append-only, latest {data.priceHistory.length})</summary>
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {data.priceHistory.map((p: any) => (
                <p key={p.id} className="text-xs text-gray-500">
                  {new Date(p.effective_at).toLocaleString()}: {p.token_slug} → {money(p.price_minor)} · “{p.note}”
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * S37-S40: badge definitions, hand awards (granted/warning/hypha), and the
 * earned engine's evaluate button. The firewalls answer in the UI with the
 * same words the API refuses with.
 */
function BadgesAdminTab({ password }: { password: string }) {
  // Was a hand-typed list of twelve, three short of the registry, so
  // exchange.swap, health.record and mechanics.propose could not be granted
  // or denied from here at all. Reading the registry means a new capability
  // shows up the moment it is added.
  const CAPS = ALL_CAPABILITIES;
  const METRICS = ["quests_consented", "ledger_earned_total", "gratitude_breadth"];
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: "", description: "", kind: "granted", capabilities: [], denies: [], metric: "quests_consented", threshold: "", stackable: false, maxStack: "1" });
  const [award, setAward] = useState({ badgeId: "", userId: "", note: "", days: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/admin/badges`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
      ]);
      if (bRes.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await bRes.json());
      const p = await pRes.json();
      setPlayers(Array.isArray(p) ? p : []);
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      return d;
    } catch (e: any) { toast.error(e?.message || "Request failed"); return null; }
  };

  const createBadge = async () => {
    const body: any = {
      name: form.name, description: form.description, kind: form.kind,
      capabilities: form.capabilities, denies: form.denies,
    };
    if (form.kind === "earned") {
      body.rule = { metric: form.metric, threshold: Number(form.threshold), stackable: form.stackable, maxStack: Number(form.maxStack) || 1 };
    }
    const d = await call("/admin/badges", body);
    if (d) {
      forgetExamplesCache("badges");
    toast.success("Badge created");
      setForm({ name: "", description: "", kind: "granted", capabilities: [], denies: [], metric: "quests_consented", threshold: "", stackable: false, maxStack: "1" });
      load();
    }
  };

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Badges</h2>
        <p className="text-sm text-gray-500">The Badges module is off. Turn it on in the Module Library (top of the {MODULES_GROUP_TITLE} group) first.</p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Badges & Skills</h2>
          <p className="text-sm text-gray-500 max-w-xl">
            Self and hypha badges gate nothing; only warnings may deny, and a
            deny beats role and stage grants (admins excepted). A warning can
            never take away voting or vouching. A voice that was earned stays.
            Earned badges ride settled metrics only, and never applause into
            permissions.
          </p>
        </div>
        <button
          onClick={async () => { const d = await call("/admin/badges/evaluate"); if (d) { toast.success(`${d.newTiers.length} new tier(s) across ${d.badgesEvaluated} earned badge(s)`); load(); } }}
          className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
        >
          Evaluate earned badges
        </button>
      </div>

      {/* Definitions */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Badge definitions</h3>
        <div className="space-y-2 mb-5">
          {(data?.badges ?? []).map((b: any) => (
            <div key={b.id} className={`border rounded-lg px-4 py-3 ${b.active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {b.name} <span className="text-xs text-gray-400">({b.kind})</span>
                    {b.isExample && <ExampleChip className="ml-2 align-middle" />}
                  </p>
                  <p className="text-xs text-gray-500">
                    {b.kind === "earned" && b.rule ? `at ${b.rule.threshold} ${String(b.rule.metric).replace(/_/g, " ")}${b.rule.stackable ? ` · stacks ×${b.rule.maxStack}` : ""} · ` : ""}
                    {(b.capabilities ?? []).length ? `grants ${b.capabilities.join(", ")} · ` : ""}
                    {(b.denies ?? []).length ? `denies ${b.denies.join(", ")} · ` : ""}
                    {b.description || "no description"}
                  </p>
                </div>
                <button
                  onClick={async () => { const d = await call(`/admin/badges/${b.id}`, { active: !b.active }, "PUT"); if (d) load(); }}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  {b.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
          {(data?.badges ?? []).length === 0 && <p className="text-sm text-gray-400">No badges yet.</p>}
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-xs text-gray-500">Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputCls} w-full mt-1`} />
            </label>
            <label className="text-xs text-gray-500">Kind
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, capabilities: [], denies: [] })} className={`${inputCls} w-full mt-1`}>
                {(data?.kinds ?? ["self", "earned", "granted", "warning", "hypha"]).map((k: string) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-500">Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputCls} w-full mt-1`} />
            </label>
          </div>
          {form.kind === "earned" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-gray-500">Metric (settled events only)
                <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className={`${inputCls} w-full mt-1`}>
                  {METRICS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-500">Threshold
                <input type="number" min={1} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} className={`${inputCls} w-24 mt-1 block`} />
              </label>
              <label className="text-xs text-gray-500 flex items-center gap-1.5 pb-2">
                <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} /> stacks
              </label>
              {form.stackable && (
                <label className="text-xs text-gray-500">Max stack
                  <input type="number" min={1} value={form.maxStack} onChange={(e) => setForm({ ...form, maxStack: e.target.value })} className={`${inputCls} w-20 mt-1 block`} />
                </label>
              )}
            </div>
          )}
          {form.kind !== "self" && form.kind !== "hypha" && form.kind !== "warning" && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Grants capabilities</p>
              <div className="flex flex-wrap gap-1.5">
                {CAPS.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, capabilities: toggleIn(form.capabilities, c) })}
                    className={`text-xs px-2 py-1 rounded-full border ${form.capabilities.includes(c) ? "bg-teal-deep text-white border-teal-deep" : "border-gray-200 text-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.kind === "warning" && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Denies capabilities (beats role and stage grants)</p>
              {/*
                0109, R65/R66: the voice keys are not offered here, because a
                voice that was earned is never taken away. The server refuses
                one anyway; a checkbox that always fails would be a door
                painted on a wall.
              */}
              <div className="flex flex-wrap gap-1.5">
                {CAPS.filter(isDeniable).map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, denies: toggleIn(form.denies, c) })}
                    className={`text-xs px-2 py-1 rounded-full border ${form.denies.includes(c) ? "bg-red-600 text-white border-red-600" : "border-gray-200 text-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={createBadge} disabled={!form.name.trim()}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
            Create badge
          </button>
        </div>
      </div>

      {/* Hand awards */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Award a badge</h3>
        <p className="text-xs text-gray-500 mb-3">
          Granted, warning and hypha kinds only. Self is the member's act,
          earned is the engine's. Warnings require a note.
        </p>
        <div className="flex flex-wrap items-end gap-2 mb-5">
          <select value={award.badgeId} onChange={(e) => setAward({ ...award, badgeId: e.target.value })} className={inputCls}>
            <option value="">Badge…</option>
            {(data?.badges ?? []).filter((b: any) => b.active && !["self", "earned"].includes(b.kind)).map((b: any) => (
              <option key={b.id} value={b.id}>{b.name} ({b.kind})</option>
            ))}
          </select>
          <select value={award.userId} onChange={(e) => setAward({ ...award, userId: e.target.value })} className={inputCls}>
            <option value="">Member…</option>
            {players.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="Note (required for warnings)" value={award.note}
            onChange={(e) => setAward({ ...award, note: e.target.value })} className={`${inputCls} flex-1 min-w-[160px]`} />
          {/* Expiry was fully built server-side — the route parses expiresAt,
              the column stores it, a sweep lifts it — and no UI ever sent
              one, so every warning badge was permanent and the sweep never
              fired. Blank still means permanent. */}
          <input
            type="number"
            min={1}
            placeholder="Days"
            title="Days until this lapses. Blank = permanent."
            aria-label="Days until this award expires"
            value={award.days}
            onChange={(e) => setAward({ ...award, days: e.target.value })}
            className={`${inputCls} w-24`}
          />
          <button
            onClick={async () => {
              const d = await call(`/admin/badges/${award.badgeId}/award`, {
                userId: award.userId,
                note: award.note,
                expiresAt: award.days
                  ? new Date(Date.now() + Number(award.days) * 86400000).toISOString()
                  : undefined,
              });
              if (d) { toast.success("Awarded"); setAward({ badgeId: "", userId: "", note: "", days: "" }); load(); }
            }}
            disabled={!award.badgeId || !award.userId}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
          >
            Award
          </button>
        </div>

        <h3 className="font-semibold text-gray-900 mb-2">Current awards</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3">Member</th><th className="py-1 pr-3">Badge</th><th className="py-1 pr-3">Tier</th>
              <th className="py-1 pr-3">By</th><th className="py-1 pr-3">Note</th><th className="py-1 pr-3">Expires</th><th className="py-1" />
            </tr></thead>
            <tbody>
              {(data?.awards ?? []).map((a: any) => (
                <tr key={a.id} className={`border-t border-gray-50 ${a.badge_kind === "warning" ? "bg-red-50/50" : ""}`}>
                  <td className="py-2 pr-3 font-medium text-gray-900">{a.user_name ?? "(anonymized)"}</td>
                  <td className="py-2 pr-3">{a.badge_name} <span className="text-xs text-gray-400">({a.badge_kind})</span></td>
                  <td className="py-2 pr-3">{a.count > 1 ? `×${a.count}` : "-"}</td>
                  <td className="py-2 pr-3 text-gray-500">{a.awarded_by ? "steward" : "engine"}</td>
                  <td className="py-2 pr-3 text-gray-500">{a.note ?? ""}</td>
                  <td className="py-2 pr-3 text-gray-500">{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : "-"}</td>
                  <td className="py-2 text-right">
                    <button onClick={async () => {
                      if (!window.confirm("Revoke this badge?")) return;
                      const d = await call(`/admin/badges/${a.badge_id}/award/${a.user_id}`, undefined, "DELETE");
                      if (d) load();
                    }} className="text-xs text-gray-500 hover:text-red-600">Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.awards ?? []).length === 0 && <p className="text-sm text-gray-400 py-3">No awards yet.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * S41-S46: the material library's steward desk — intake (the guarded mint),
 * the loan pipeline with its single terminal, and the invariants made
 * visible: escrow reconciliation and supply-vs-backing.
 */
function LibraryAdminTab({ password, onOpenTab }: { password: string; onOpenTab: (tab: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<any[]>([]);
  const [intake, setIntake] = useState({ name: "", description: "", categoryId: "", appraisal: "", donorUserId: "", minStage: "", photoUrl: "" });
  const [catLabel, setCatLabel] = useState("");
  const [settleDraft, setSettleDraft] = useState<Record<string, { wear?: string; damage?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/admin/library`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
      ]);
      if (lRes.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await lRes.json());
      const p = await pRes.json();
      setPlayers(Array.isArray(p) ? p : []);
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      return d;
    } catch (e: any) { toast.error(e?.message || "Request failed"); return null; }
  };

  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Material Library</h2>
        <p className="text-sm text-gray-500">The Material Library module is off. Turn it on in the Module Library (top of the {MODULES_GROUP_TITLE} group) first.</p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  const liveLoans = (data?.loans ?? []).filter((l: any) => !l.settled_at);
  const doneLoans = (data?.loans ?? []).filter((l: any) => !!l.settled_at);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Material Library</h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          Intake is a mint: awards are capped per member per lunation and
          high appraisals need a second steward. Every loan ends exactly once,
          through settle. Fees left blank use the computed defaults.
        </p>
        <TokenNamingLink what="Library credits" onOpenTab={onOpenTab} />
      </div>

      {/* Invariants panel */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className={`rounded-xl border p-4 ${data?.reconciliation?.ok ? "border-emerald-200 bg-emerald-50/50" : "border-red-300 bg-red-50"}`}>
          <p className="text-xs text-gray-500 mb-1">Escrow reconciliation</p>
          <p className="text-sm font-semibold text-gray-900">
            {data?.reconciliation?.actual} held / {data?.reconciliation?.expected} expected {data?.reconciliation?.ok ? "✓" : "✗ INVESTIGATE"}
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${data?.supply?.flagged ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
          <p className="text-xs text-gray-500 mb-1">Credits vs backing</p>
          <p className="text-sm font-semibold text-gray-900">
            {data?.supply?.outstanding} issued / {data?.supply?.backing} on shelves
            {data?.supply?.flagged && ": MORE CREDITS THAN SHELVES"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Usage-fee pool</p>
          <p className="text-sm font-semibold text-gray-900">{data?.poolBalance} credit(s)</p>
        </div>
      </div>

      {/* Intake */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Record an intake</h3>
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <input placeholder="Item name" value={intake.name} onChange={(e) => setIntake({ ...intake, name: e.target.value })} className={inputCls} />
          <select value={intake.donorUserId} onChange={(e) => setIntake({ ...intake, donorUserId: e.target.value })} className={inputCls}>
            <option value="">Donor…</option>
            {players.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="number" min={1} placeholder="Appraisal (credits)" value={intake.appraisal} onChange={(e) => setIntake({ ...intake, appraisal: e.target.value })} className={inputCls} />
          <input placeholder="Description" value={intake.description} onChange={(e) => setIntake({ ...intake, description: e.target.value })} className={`${inputCls} sm:col-span-2`} />
          <select value={intake.categoryId} onChange={(e) => setIntake({ ...intake, categoryId: e.target.value })} className={inputCls}>
            <option value="">Category…</option>
            {(data?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {/* L6: a photo makes the shelf browsable. Paste a URL, or upload
              via any image field and paste the /api/uploads path it returns. */}
          <input placeholder="Photo URL (optional)" value={intake.photoUrl}
            onChange={(e) => setIntake({ ...intake, photoUrl: e.target.value })} className={`${inputCls} sm:col-span-2`} />
        </div>
        <button
          onClick={async () => {
            const d = await call("/admin/library/intake", { ...intake, appraisal: Number(intake.appraisal), categoryId: intake.categoryId || null, photoUrl: intake.photoUrl || null });
            if (d) {
              forgetExamplesCache("library");
              toast.success(d.pendingSecondSignoff ? "Recorded. Awaiting a second steward's sign-off" : `Recorded: ${d.award} credit(s) awarded`);
              setIntake({ name: "", description: "", categoryId: "", appraisal: "", donorUserId: "", minStage: "", photoUrl: "" });
              load();
            }
          }}
          disabled={!intake.name.trim() || !intake.donorUserId || !intake.appraisal}
          className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
        >
          Record intake
        </button>
        <div className="mt-3 flex items-end gap-2">
          <input placeholder="New category label" value={catLabel} onChange={(e) => setCatLabel(e.target.value)} className={inputCls} />
          <button onClick={async () => { const d = await call("/admin/library/categories", { label: catLabel }); if (d) { setCatLabel(""); load(); } }}
            disabled={!catLabel.trim()} className="text-sm text-teal-deep font-medium hover:underline pb-2 disabled:opacity-40">
            Add category
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Shelves</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400">
              <th className="py-1 pr-3">Item</th><th className="py-1 pr-3">Value</th><th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Donor</th><th className="py-1" />
            </tr></thead>
            <tbody>
              {(data?.items ?? []).map((i: any) => (
                <tr key={i.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-900">
                    {i.name}
                    {i.isExample && <ExampleChip className="ml-2 align-middle" />}
                  </td>
                  <td className="py-2 pr-3">{i.creditValue}</td>
                  <td className={`py-2 pr-3 ${i.status === "intake_pending" ? "text-amber-700 font-medium" : ""}`}>{i.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3 text-gray-500">{players.find((p: any) => p.id === i.donorUserId)?.name ?? "-"}</td>
                  <td className="py-2 text-right space-x-2 whitespace-nowrap">
                    {i.status === "intake_pending" && (
                      <button onClick={async () => { const d = await call(`/admin/library/items/${i.id}/approve`); if (d) { toast.success(`Signed off: ${d.award} credit(s) awarded`); load(); } }}
                        className="text-xs text-teal-deep font-medium hover:underline">Second sign-off</button>
                    )}
                    {i.status === "available" && (
                      <button onClick={async () => { if (!window.confirm("Write this item off the shelves?")) return; const d = await call(`/admin/library/items/${i.id}`, { status: "written_off" }, "PUT"); if (d) load(); }}
                        className="text-xs text-gray-500 hover:text-red-600">Write off</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.items ?? []).length === 0 && <p className="text-sm text-gray-400 py-3">No items yet.</p>}
        </div>
      </div>

      {/* Loans */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Open loans</h3>
        <div className="space-y-3">
          {liveLoans.map((l: any) => (
            <div key={l.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm">
                  <b>{l.user_name ?? l.user_id}</b> · {l.item_name} · {String(l.status).replace(/_/g, " ")}
                  {l.due_on && <> · due {new Date(l.due_on).toLocaleDateString()}</>} · escrow {l.escrow_credits}
                </p>
                <div className="flex items-center gap-2">
                  {l.status === "reserved" && (
                    <button onClick={async () => { const d = await call(`/admin/library/loans/${l.id}/pickup`); if (d) { toast.success(`Picked up. Due ${d.dueOn}`); load(); } }}
                      className="text-xs bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium">Mark picked up</button>
                  )}
                  <input type="number" min={0} placeholder="wear" value={settleDraft[l.id]?.wear ?? ""} title="Wear fee (blank = computed default)"
                    onChange={(e) => setSettleDraft((s) => ({ ...s, [l.id]: { ...(s[l.id] ?? {}), wear: e.target.value } }))} className={`${inputCls} w-16`} />
                  <input type="number" min={0} placeholder="dmg" value={settleDraft[l.id]?.damage ?? ""} title="Damage fee (blank = 0)"
                    onChange={(e) => setSettleDraft((s) => ({ ...s, [l.id]: { ...(s[l.id] ?? {}), damage: e.target.value } }))} className={`${inputCls} w-16`} />
                  {(["closed", "expired", "disputed"] as const).map((o) => (
                    <button key={o}
                      onClick={async () => {
                        const d = await call(`/admin/library/loans/${l.id}/settle`, {
                          outcome: o, wearFee: settleDraft[l.id]?.wear ?? "", damageFee: settleDraft[l.id]?.damage ?? "",
                        });
                        if (d) { toast.success(`Settled ${o}: ${d.released} released, ${(d.wearFee ?? 0) + (d.damageFee ?? 0)} to the pool`); load(); }
                      }}
                      className={`text-xs rounded-lg px-2.5 py-1.5 font-medium border ${o === "closed" ? "border-emerald-300 text-emerald-700" : o === "expired" ? "border-amber-300 text-amber-700" : "border-red-300 text-red-600"}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {liveLoans.length === 0 && <p className="text-sm text-gray-400">Nothing out.</p>}
        </div>
        {doneLoans.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-gray-500 cursor-pointer">Settled loans ({doneLoans.length})</summary>
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {doneLoans.map((l: any) => (
                <p key={l.id} className="text-xs text-gray-500">
                  {l.user_name ?? l.user_id} · {l.item_name} → {l.status} · wear {l.wear_fee ?? 0} dmg {l.damage_fee ?? 0} · {l.settled_cycle_id}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * S49-S51: the steward's desk for the land's ledger. Snapshot collection is
 * automatic (it rides every cycle close); this tab records regeneration
 * facts — absolute counts, each entry audit-attributed.
 */
function HealthAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ metricKey: "trees_planted", value: "", unit: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/health/regen`, { headers: authHeaders(password) });
      if (res.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const record = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/health/regen`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ metricKey: form.metricKey, value: Number(form.value), unit: form.unit || undefined, note: form.note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      toast.success("Recorded on the land's ledger");
      setForm({ ...form, value: "", note: "" });
      forgetExamplesCache("health");
      load();
    } catch (e: any) { toast.error(e?.message || "Failed"); }
  };

  // Withdraw, not delete. These readings go out to funders and to Hypha, so a
  // wrong one is corrected in the open — the entry stays visible, marked, with
  // the reason attached, and stops counting toward any total.
  const retract = async (id: string) => {
    const note = window.prompt(
      "Why is this reading being withdrawn?\n\nIt stays on the record, marked as withdrawn, and stops counting toward the totals.",
    );
    if (note === null) return;
    if (!note.trim()) { toast.error("A reason is required"); return; }
    const res = await fetch(`${API_BASE}/admin/health/regen/${id}/retract`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ note: note.trim() }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({})))?.error || "Could not withdraw it");
      return;
    }
    toast.success("Withdrawn. It no longer counts toward the totals");
    load();
  };

  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Village Health</h2>
        <p className="text-sm text-gray-500">
          The Village Health module is off. Snapshot collection runs anyway
          (every cycle close freezes its numbers); enable the module in
          Module Library (top of the {MODULES_GROUP_TITLE} group) when there is enough history
          to show, and to record regeneration entries here.
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  const metrics: any[] = data?.metrics ?? [];
  const selected = metrics.find((m) => m.key === form.metricKey);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Village Health: the land's ledger</h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          Record regeneration as it happens: trees in the ground, water under
          protection, hectares in restoration. Absolute counts: the numbers
          the dashboard tiles and the investor-facing impact feed show.
          Lunation snapshots are automatic at every cycle close.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Record an entry</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">Metric
            <select value={form.metricKey} onChange={(e) => setForm({ ...form, metricKey: e.target.value, unit: "" })} className={`${inputCls} block mt-1`}>
              {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Value
            <input type="number" min={0} step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={`${inputCls} w-28 block mt-1`} />
          </label>
          <label className="text-xs text-gray-500">Unit
            <input placeholder={selected?.unit ?? ""} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={`${inputCls} w-20 block mt-1`} />
          </label>
          <label className="text-xs text-gray-500 flex-1 min-w-[180px]">Note (what happened, where)
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`${inputCls} w-full block mt-1`} />
          </label>
          <button onClick={record} disabled={!form.value}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
            Record
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Totals & entries</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {metrics.filter((m) => data?.totals?.[m.key]).map((m) => (
            <div key={m.key} className="border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-lg font-bold text-gray-900">{Number(data.totals[m.key].total).toLocaleString()} <span className="text-xs font-normal text-gray-400">{data.totals[m.key].unit}</span></p>
              <p className="text-xs text-gray-500">{m.label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {(data?.entries ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between text-sm border-t border-gray-50 py-1.5">
              <span className="text-gray-600">
                {new Date(e.recordedAt).toLocaleDateString()}: <b>{e.value} {e.unit}</b> {metrics.find((m) => m.key === e.metricKey)?.label?.toLowerCase() ?? e.metricKey}
                {e.note ? <span className="text-gray-400"> · {e.note}</span> : null}
              </span>
              <button onClick={() => retract(e.id)} className="text-xs text-gray-400 hover:text-red-600">Withdraw</button>
            </div>
          ))}
          {(data?.entries ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * S52: the steward's desk for departures — open-state enumeration with
 * blocking badges, the balance sweep, the terminal resolve (refused with
 * named domains until clean), and the policy editor.
 */

function ExitsAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState("");
  const [state, setState] = useState<any>(null);
  const [policyDraft, setPolicyDraft] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  // The platform's own words, sent down with the policy. Held rather than
  // copied into the bundle so the editor's "still the platform's" marker and
  // the server's refusal can never drift apart.
  const [policyDefaults, setPolicyDefaults] = useState<any>(null);
  const [circles, setCircles] = useState<any[]>([]);
  /**
   * The involuntary-exit form. It used to be `window.prompt`, which is to say
   * the browser's own one-line box, carrying the site's domain, for the act
   * of asking a person to leave the village.
   */
  const [involuntaryOpen, setInvoluntaryOpen] = useState(false);
  const [involuntaryBusy, setInvoluntaryBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, pRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/admin/exits`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
      ]);
      const e = await eRes.json();
      setData(e);
      setPolicyDraft(e.policy);
      setPolicyDefaults(e.defaults ?? null);
      setCircles(Array.isArray(e.circles) ? e.circles : []);
      const p = await pRes.json();
      setPlayers(Array.isArray(p) ? p : []);
      const r = await rRes.json();
      setRoles(Array.isArray(r) ? r : []);
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const loadState = useCallback(async (userId: string) => {
    if (!userId) { setState(null); return; }
    const res = await fetch(`${API_BASE}/admin/players/${userId}/exit-state`, { headers: authHeaders(password) });
    setState(res.ok ? await res.json() : null);
  }, [password]);

  useEffect(() => { loadState(selectedUser); }, [selectedUser, loadState]);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(d.blocking) ? `: ${d.blocking.map((b: any) => `${b.domain}: ${b.count}`).join(", ")}` : "";
        throw new Error(refusal(d, "failed") + detail);
      }
      return d;
    } catch (e: any) { toast.error(e?.message || "Request failed"); return null; }
  };

  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  const openExit = state?.exit;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Departures</h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          Exit is a process, never a delete. Blocking state settles through
          its own domain (loans, stays, orders, debts); positive balances
          sweep by an explicit act; the tombstone comes last. Value rows are
          never deleted. The economy conserves through every departure.
        </p>
      </div>

      {/* Member exit state */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">A member's open state</h3>
        <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={`${inputCls} mb-3`}>
          <option value="">Pick a member…</option>
          {players.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {state && (
          <>
            <div className="space-y-1.5 mb-4">
              {state.states.map((s: any) => (
                <div key={s.domain} className="flex items-start justify-between text-sm gap-3">
                  <span className="text-gray-600"><b className="text-gray-900">{s.domain}</b>: {s.description}</span>
                  {s.count > 0 && (
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${s.blocking ? "bg-red-50 text-red-600 font-semibold" : "bg-gray-100 text-gray-500"}`}>
                      {s.blocking ? `blocks (${s.count})` : s.count}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {/* OUTSIDE `!openExit` on purpose: trigger and dialog were siblings
                inside it, so a successful save unmounted both and Radix had no
                element left to return focus to. Renders nothing while closed. */}
            <InvoluntaryExitDialog
              open={involuntaryOpen}
              memberName={players.find((p: any) => p.id === selectedUser)?.name ?? ""}
              /* The village's own questions, from the published policy.
                 `policyDraft` is what the editor below is holding, so an
                 unsaved edit is not offered here: `data.policy` is what
                 the village has actually published. */
              grounds={Array.isArray(data?.policy?.involuntary?.grounds) ? data.policy.involuntary.grounds : []}
              busy={involuntaryBusy}
              onCancel={() => setInvoluntaryOpen(false)}
              onConfirm={async (note) => {
                setInvoluntaryBusy(true);
                const d = await call("/admin/exits", { userId: selectedUser, kind: "involuntary", note });
                setInvoluntaryBusy(false);
                if (d) { setInvoluntaryOpen(false); toast.success("Exit opened"); load(); loadState(selectedUser); }
              }}
                  />
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              {!openExit ? (
                <>
                  <button onClick={async () => { const d = await call("/admin/exits", { userId: selectedUser, kind: "voluntary" }); if (d) { toast.success("Exit opened"); load(); loadState(selectedUser); } }}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">Open exit</button>
                  <button onClick={() => setInvoluntaryOpen(true)}
                    className="text-sm border border-red-300 text-red-600 rounded-lg px-4 py-2 font-medium">Open involuntary…</button>
                </>
              ) : (
                <>
                  <span className="text-xs text-gray-500 self-center">
                    Exit {openExit.status} since {new Date(openExit.openedAt).toLocaleDateString()}
                    {openExit.noticeEndsAt && ` · notice ends ${new Date(openExit.noticeEndsAt).toLocaleDateString()}`}
                  </span>
                  <button onClick={async () => { const d = await call(`/admin/exits/${openExit.id}/settle-balances`); if (d) { toast.success(`Swept: ${JSON.stringify(d.swept)}`); loadState(selectedUser); } }}
                    className="text-sm border border-teal-deep text-teal-deep rounded-lg px-3 py-2 font-medium">Sweep balances</button>
                  <button onClick={async () => {
                    if (!window.confirm("Resolve this exit? The account becomes a tombstone: identity removed, contributions kept.")) return;
                    const d = await call(`/admin/exits/${openExit.id}/resolve`);
                    if (d) { toast.success(`Resolved${d.vacatedRoles.length ? `. Seats opened: ${d.vacatedRoles.join(", ")}` : ""}`); setSelectedUser(""); load(); }
                  }} className="text-sm bg-red-600 text-white rounded-lg px-3 py-2 font-medium">Resolve (tombstone)</button>
                  <button onClick={async () => { const d = await call(`/admin/exits/${openExit.id}/cancel`); if (d) { toast.success("They're staying"); loadState(selectedUser); load(); } }}
                    className="text-sm text-gray-500 hover:text-gray-900 px-2">They're staying</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Exit list */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Departure record</h3>
        <div className="space-y-1.5">
          {(data?.exits ?? []).map((e: any) => (
            <div key={e.id}>
              <p className="text-sm text-gray-600">
                <b className="text-gray-900">{e.userName}</b>: {e.kind}, {e.status}
                <span className="text-xs text-gray-400"> · opened {new Date(e.openedAt).toLocaleDateString()}{e.resolvedAt ? `, closed ${new Date(e.resolvedAt).toLocaleDateString()}` : ""}</span>
                {e.agreementRef && <span className="text-xs text-teal-deep"> · agreement: {e.agreementRef}</span>}
              </p>
              {/* THE REASON, WHICH NOTHING SHOWED. `resolution` has been on the
                  wire since the exits table existed; this record printed name,
                  kind, status and dates and never the field that says WHY, so
                  a steward's note went into the database and was read by
                  nobody. pre-line because the form composes a reason and then
                  one line per answered question, and that shape is the record. */}
              {e.resolution && (
                <p className="text-xs text-muted-foreground whitespace-pre-line border-l-2 border-gray-200 pl-3 ml-1 mt-1 mb-2">
                  {e.resolution}
                </p>
              )}
            </div>
          ))}
          {(data?.exits ?? []).length === 0 && <p className="text-sm text-gray-400">No departures yet, and the policy is already published. Good.</p>}
        </div>
      </div>

      {/* Policy editor */}
      {policyDraft && (() => {
        const stale = stalePolicyTerms(policyDraft, policyDefaults);
        const setVol = (patch: any) => setPolicyDraft({ ...policyDraft, voluntary: { ...policyDraft.voluntary, ...patch } });
        const setInv = (patch: any) => setPolicyDraft({ ...policyDraft, involuntary: { ...policyDraft.involuntary, ...patch } });
        const setRes = (patch: any) => setPolicyDraft({ ...policyDraft, restorative: { ...policyDraft.restorative, ...patch } });
        const mark = (isStale: boolean) => (
          <span className={`ml-2 text-[11px] rounded px-1.5 py-0.5 border ${isStale ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
            {isStale ? "Still the platform's words" : "The village's own words"}
          </span>
        );
        return (
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-1">The published policy</h3>
          <p className="text-xs text-gray-500 mb-4">
            Every field here is printed at /exit-policy for anyone to read,
            signed in or not. This is the highest-stakes copy on the site: it
            says what happens to a person, and to what they built, when they
            leave{policyDraft.placeholder ? ". The banner above it says these are still the platform's starting terms" : ""}.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <label className="text-xs text-gray-500">Notice period (days)
              <input type="number" min={0} value={policyDraft.voluntary?.noticePeriodDays ?? 0}
                onChange={(e) => setVol({ noticePeriodDays: Number(e.target.value) })}
                className={`${inputCls} w-full mt-1 min-h-[44px]`} />
            </label>
            <label className="text-xs text-gray-500">Restorative intake role
              <select value={policyDraft.restorative?.intakeContactRole ?? ""}
                onChange={(e) => setRes({ intakeContactRole: e.target.value })}
                className={`${inputCls} w-full mt-1 min-h-[44px]`}>
                <option value="">none configured</option>
                {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
              </select>
            </label>
          </div>

          <label className="text-xs text-gray-500 block mb-4">
            <span className="font-medium text-gray-700">How contributed value is honored</span>
            {mark(stale.includes("How contributed value is honored"))}
            {/* The name is the term. Without an explicit one the wrapping
                <label> handed a reader the term, the stale badge and the whole
                hint as a single sentence. Badge and hint both stay, as
                descriptions, in the order a reader would want them. */}
            <textarea rows={3} value={policyDraft.voluntary?.valuationMethod ?? ""}
              aria-label="How contributed value is honored"
              aria-describedby="exit-valuation-hint"
              onChange={(e) => setVol({ valuationMethod: e.target.value })}
              className={`${inputCls} w-full mt-1`} />
            <span id="exit-valuation-hint" className="block text-[11px] text-gray-400 mt-1">
              What a departing member is owed for what they built, and how it is worked out.
            </span>
          </label>

          <StepListEditor
            label="The steps of a voluntary departure"
            hint="Printed as the numbered list under Choosing to leave."
            steps={Array.isArray(policyDraft.voluntary?.unwindSteps) ? policyDraft.voluntary.unwindSteps : []}
            onChange={(next) => setVol({ unwindSteps: next })}
          />
          <p className="text-[11px] mb-4 -mt-2">{mark(stale.includes("The steps of a voluntary departure"))}</p>

          <label className="text-xs text-gray-500 block mb-4">
            <span className="font-medium text-gray-700">If the village asks someone to leave</span>
            {mark(stale.includes("If the village asks someone to leave"))}
            {/* Same shape as the field above: the term names the control, the
                stale badge stops being read as part of that name. */}
            <textarea rows={3} value={policyDraft.involuntary?.process ?? ""}
              aria-label="If the village asks someone to leave"
              onChange={(e) => setInv({ process: e.target.value })}
              className={`${inputCls} w-full mt-1`} />
          </label>

          {/*
            The questions a steward has to answer, on the record, before this
            village asks anybody to leave. They are the village's own, so they
            are edited here rather than compiled into the platform.

            No stale badge beside this one, and that is deliberate: the badge
            reports membership of EXIT_POLICY_TERMS, which gates publishing,
            and this field is deliberately not in that list. A badge here
            would promise a check that does not run. See the comment on
            `grounds` in server/lib/exitPolicy.ts.
          */}
          <StepListEditor
            label="Questions asked before an involuntary exit"
            hint="A steward answers each one yes, no, or does not apply when opening a departure. The answers go on the record."
            steps={Array.isArray(policyDraft.involuntary?.grounds) ? policyDraft.involuntary.grounds : []}
            onChange={(next) => setInv({ grounds: next })}
          />

          {/*
            Two ids that were stored, published to nobody and editable by
            nobody. They are the two facts a member most needs from this page,
            so they get a picker here and a line on the page.
          */}
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <label className="text-xs text-gray-500">Which circle decides an involuntary exit
              <select value={policyDraft.involuntary?.decidingDomainId ?? ""}
                onChange={(e) => setInv({ decidingDomainId: e.target.value })}
                className={`${inputCls} w-full mt-1 min-h-[44px]`}>
                <option value="">not stated on the page</option>
                {circles.map((c: any) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-500">Which circle hears an appeal
              <select value={policyDraft.involuntary?.appealDomainId ?? ""}
                onChange={(e) => setInv({ appealDomainId: e.target.value })}
                className={`${inputCls} w-full mt-1 min-h-[44px]`}>
                <option value="">not stated on the page</option>
                {circles.map((c: any) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
              </select>
            </label>
          </div>

          <StepListEditor
            label="The restorative path"
            hint="Printed under Repair before departure. Its content reaches only the people in the room; these are the steps, never the content."
            steps={Array.isArray(policyDraft.restorative?.steps) ? policyDraft.restorative.steps : []}
            onChange={(next) => setRes({ steps: next })}
          />
          <p className="text-[11px] mb-4 -mt-2">{mark(stale.includes("The restorative path"))}</p>

          {/*
            THE ACKNOWLEDGEMENT.
            Disabled while any printed term is still the platform's, and the
            server refuses the same write for the same reason, so a founder
            who reaches the route another way gets the same answer.
          */}
          <div className={`rounded-lg border p-3 mb-3 ${stale.length ? "border-amber-200 bg-amber-50" : "border-gray-200"}`}>
            <label className="text-xs text-gray-700 flex items-start gap-2">
              <input type="checkbox" checked={!policyDraft.placeholder} disabled={stale.length > 0}
                onChange={(e) => setPolicyDraft({ ...policyDraft, placeholder: !e.target.checked })}
                className="mt-0.5 w-5 h-5 shrink-0 focus:outline-none focus:ring-2 focus:ring-teal-deep" />
              <span>These terms were decided by the community, and the draft banner comes off /exit-policy.</span>
            </label>
            {stale.length > 0 && (
              <p className="text-[11px] text-amber-900 mt-2 pl-7">
                Not yet available. {stale.join(", ")} {stale.length === 1 ? "is" : "are"} still
                word for word what the platform ships. Ticking this would publish the platform's
                boilerplate as the village's settled exit terms. Write {stale.length === 1 ? "it" : "them"} in
                the community's own words first.
              </p>
            )}
          </div>

          <button onClick={async () => { const d = await call("/admin/exit-policy", policyDraft, "PUT"); if (d) { toast.success("Policy published"); load(); } }}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 min-h-[44px] font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep">Publish policy</button>
        </div>
        );
      })()}
    </div>
  );
}

/**
 * S53-S55: the call pipeline desk. Ingest a recording (paste the
 * transcript), synthesize (every suggestion carries a verbatim quote and
 * timestamp or was dropped — the drop count is shown, on purpose), edit
 * the human body beside the untouchable AI body, publish to the forum,
 * accept or dismiss suggestions. Nothing here happens on its own.
 */
function CallsAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", url: "", transcript: "" });
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [bodyDraft, setBodyDraft] = useState("");
  // Task rows carry a role id, and the page printed the raw id where a name
  // belongs. The roles list is small and public, so one fetch names every
  // task on the page.
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/recordings`, { headers: authHeaders(password) });
      if (res.status === 404) { setOff(true); setLoading(false); return; }
      setOff(false);
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // GET /api/roles answers with a BARE ARRAY. Reading `.roles` off it gives
    // undefined and every task quietly keeps showing its raw id.
    fetch(`${API_BASE}/roles`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) setRoleNames(Object.fromEntries(rows.map((r: any) => [r.id, r.name])));
      })
      .catch(() => {});
  }, []);

  // Everything this module does lives in the detail card, and the card only
  // appeared after a click, so the page opened as a list of titles. Open the
  // newest one once. The ref keeps a deliberate close from springing back.
  useEffect(() => {
    if (autoOpened.current || selected || !data?.recordings?.length) return;
    autoOpened.current = true;
    setSelected(data.recordings[0].id);
  }, [data, selected]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    const res = await fetch(`${API_BASE}/admin/recordings/${id}`, { headers: authHeaders(password) });
    if (res.ok) {
      const d = await res.json();
      setDetail(d);
      setBodyDraft(d.synthesis?.body ?? "");
    }
  }, [password]);

  useEffect(() => { loadDetail(selected); }, [selected, loadDetail]);

  const call = async (path: string, body?: any, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "failed"));
      return d;
    } catch (e: any) { toast.error(e?.message || "Request failed"); return null; }
  };

  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";
  const fmtTs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  // A task names the role that should carry it. Real recordings name real
  // roles, and the seeded example tasks name `ex-role-land-steward` and
  // `ex-role-tool-keeper`, which resolve NOWHERE: the map example seed
  // carries circles and no roles, so those two ids were never created by
  // anything and no village will ever have them. Falling back to the raw id
  // put a slug on screen, so an unresolved id is made readable instead.
  const roleLabel = (id: string): string =>
    roleNames[id] ?? id.replace(/^ex-role-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  // `chapters` and `decisions` are MySQL json columns. mysql2 parses them for
  // us today, so this only matters the day a pool is built with jsonStrings
  // set, when the old code would have thrown on .map of a string.
  const asArray = (v: any): any[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    }
    return [];
  };

  if (off) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Call Automation</h2>
        <p className="text-sm text-gray-500">The Call Automation module is off. Turn it on in the Module Library (top of the {MODULES_GROUP_TITLE} group) first.</p>
      </div>
    );
  }
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;

  // Recordings come back mapped (camelCase); syntheses and tasks are raw
  // rows. Read both spellings so the marker does not hinge on which payload
  // a row arrived through, and treat MySQL's 1 as the true it is.
  const flagged = (row: any): boolean =>
    row?.isExample === true || row?.is_example === true || row?.is_example === 1;
  const exampleDetail = flagged(detail?.recording) || flagged(detail?.synthesis);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Call Automation</h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          The weekly call becomes assigned work. Suggestions survive only with
          a verbatim quote and timestamp from the tape; publishing and every
          decision stay human.
        </p>
        {/* The seeded recording, its synthesis and its tasks render here with
            every button a real one has, and each of those buttons 409s. Say
            so once at the top and mark the rows below. */}
        <ExamplesBanner moduleId="automation" noun="recording" layout="mt-3 max-w-2xl text-left" />
        {!data?.assistantConfigured && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 inline-block">
            The assistant is not configured (ANTHROPIC_API_KEY). Ingestion and
            transcripts work; synthesis will refuse honestly.
          </p>
        )}
        {data && data.readyQueue >= data.maxReadyQueue && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2 inline-block">
            Backpressure: {data.readyQueue} unpublished syntheses. Publish or clear before drafting more.
          </p>
        )}
      </div>

      {/* Riverside setup: where recordings get POSTED so they can be
          transcribed. Always visible — a founder needs the URL to configure
          Riverside, and the secret state to know why nothing is arriving. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Riverside, automatic ingestion</h3>
        <p className="text-sm text-gray-500 mb-3 max-w-2xl">
          Point Riverside's webhook at this village and every finished call arrives here on its
          own, ready to transcribe and synthesize. In Riverside, add a webhook with this URL and
          set the shared secret as the <code className="text-xs bg-gray-100 px-1 rounded">x-riverside-secret</code> header.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <code className="text-xs bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 select-all">
            {data?.riversideWebhookUrl ?? "…"}
          </code>
          <button
            type="button"
            onClick={() => {
              if (data?.riversideWebhookUrl) {
                navigator.clipboard?.writeText(data.riversideWebhookUrl).then(
                  () => toast.success("Webhook URL copied"),
                  () => toast.error("Couldn't copy. Select and copy the URL by hand"),
                );
              }
            }}
            className="text-xs text-teal-deep font-medium hover:underline"
          >
            Copy
          </button>
        </div>
        {data?.riversideSecretConfigured ? (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 inline-block">
            Shared secret is set. Deliveries carrying the matching
            x-riverside-secret header are ingested.
          </p>
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
            No shared secret is set, so every delivery to this URL is being
            discarded. Set <span className="font-medium">Riverside webhook secret</span> under
            Integrations, then give Riverside the same value as the
            x-riverside-secret header.
          </p>
        )}
      </div>

      {/* Ingest */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Add a recording</h3>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input placeholder="Title (e.g. Circle Call, July 27)" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} className={`${inputCls} flex-1`} />
            <input placeholder="URL (optional)" value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })} className={`${inputCls} flex-1`} />
          </div>
          <textarea rows={4} placeholder="Paste the transcript: VTT, SRT or plain text. Timestamped cues make the evidence rule sharper."
            value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })}
            className={`${inputCls} w-full font-mono text-xs`} />
          <button
            onClick={async () => {
              const d = await call("/admin/recordings", form);
              if (d) {
                forgetExamplesCache("automation");
                toast.success(`Ingested (${d.segments} segment(s))`);
                setForm({ title: "", url: "", transcript: "" });
                load();
              }
            }}
            disabled={!form.title.trim()}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
          >
            Ingest
          </button>
        </div>
      </div>

      {/* Recordings */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Recordings</h3>
        <div className="space-y-1.5">
          {(data?.recordings ?? []).map((r: any) => (
            <button key={r.id} onClick={() => setSelected(selected === r.id ? "" : r.id)}
              className={`w-full text-left flex items-center justify-between border rounded-lg px-4 py-2.5 text-sm ${selected === r.id ? "border-teal-deep bg-teal-deep/5" : "border-gray-200 hover:bg-gray-50"}`}>
              <span className="font-medium text-gray-900">
                {r.title} <span className="text-xs text-gray-400">({r.source})</span>
                {flagged(r) && <ExampleChip className="ml-2 align-middle" />}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "published" ? "bg-emerald-50 text-emerald-700" : r.status === "synthesized" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                {r.status}{r.synthesis?.dropped_task_count > 0 ? ` · ${r.synthesis.dropped_task_count} dropped` : ""}
              </span>
            </button>
          ))}
          {(data?.recordings ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing ingested yet.</p>}
        </div>
      </div>

      {/* Detail */}
      {detail && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-gray-900">
              {detail.recording.title}
              {exampleDetail && <ExampleChip className="ml-2 align-middle" />}
            </h3>
            {!exampleDetail && !detail.synthesis && detail.transcript && (
              <button onClick={async () => { const d = await call(`/admin/recordings/${detail.recording.id}/synthesize`); if (d) { toast.success(`${d.tasks} task(s) kept, ${d.dropped} dropped by the evidence rule`); load(); loadDetail(selected); } }}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">Synthesize</button>
            )}
            {!exampleDetail && detail.synthesis && !detail.synthesis.published_at && (
              <button onClick={async () => { const d = await call(`/admin/syntheses/${detail.synthesis.id}/publish`); if (d) { toast.success(`Published: ${d.notified} role-holder(s) notified`); load(); loadDetail(selected); } }}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">Publish to forum</button>
            )}
          </div>

          {/* The tape. It was fetched on every open and thrown away, so the
              page could never show what a synthesis had been made FROM, and
              the evidence quotes below had nothing to point back at. Closed
              once a synthesis exists, because by then the summary leads. */}
          {detail.transcript ? (
            <details className="border border-gray-200 rounded-lg" open={!detail.synthesis}>
              <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-gray-900">
                Transcript
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {(detail.transcript.segments ?? []).length} segment(s)
                  {detail.recording.durationS ? `, ${fmtTs(detail.recording.durationS * 1000)} long` : ""}
                </span>
              </summary>
              <div className="max-h-72 space-y-2 overflow-y-auto px-4 pb-3">
                {(detail.transcript.segments ?? []).length > 0 ? (
                  detail.transcript.segments.map((s: any, i: number) => (
                    <p key={i} className="text-sm text-gray-600">
                      <span className="mr-2 text-xs tabular-nums text-gray-400">{fmtTs(s.startMs ?? 0)}</span>
                      {s.text}
                    </p>
                  ))
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-gray-600">{detail.transcript.body}</p>
                )}
              </div>
            </details>
          ) : (
            <p className="text-sm text-gray-400">No transcript yet. Paste one via the transcript endpoint or re-ingest with it.</p>
          )}

          {detail.synthesis && (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">AI body (write-once, untouchable)</p>
                  <div className="text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {detail.synthesis.ai_body}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your edit (what actually publishes)</p>
                  <textarea rows={10} value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)}
                    disabled={!!detail.synthesis.published_at || exampleDetail}
                    className={`${inputCls} w-full`} />
                  {!detail.synthesis.published_at && !exampleDetail && (
                    <button onClick={async () => { const d = await call(`/admin/syntheses/${detail.synthesis.id}/body`, { body: bodyDraft }, "PUT"); if (d) { toast.success("Saved"); loadDetail(selected); } }}
                      className="mt-1 text-sm text-teal-deep font-medium hover:underline">Save edit</button>
                  )}
                </div>
              </div>

              {/* Chapters and decisions were written by the synthesis, stored,
                  served on this very payload, and rendered nowhere. The
                  decisions are the part a village actually returns to. */}
              {(asArray(detail.synthesis.chapters).length > 0 || asArray(detail.synthesis.decisions).length > 0) && (
                <div className="grid md:grid-cols-2 gap-4">
                  {asArray(detail.synthesis.chapters).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">What the call covered</p>
                      <ol className="space-y-1">
                        {asArray(detail.synthesis.chapters).map((c: any, i: number) => (
                          <li key={i} className="flex gap-2 text-sm text-gray-600">
                            {c?.startMs != null && (
                              <span className="shrink-0 pt-px text-xs tabular-nums text-gray-400">{fmtTs(c.startMs)}</span>
                            )}
                            <span>{typeof c === "string" ? c : c?.title}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {asArray(detail.synthesis.decisions).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Decisions the call reached</p>
                      <ul className="space-y-1.5">
                        {asArray(detail.synthesis.decisions).map((d: any, i: number) => (
                          <li key={i} className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                            {typeof d === "string" ? d : d?.text ?? ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Suggested tasks, each one evidenced from the tape
                  {detail.synthesis.dropped_task_count > 0 && (
                    <span className="text-amber-700"> · {detail.synthesis.dropped_task_count} suggestion(s) dropped for failing the evidence rule</span>
                  )}
                </p>
                <div className="space-y-2">
                  {detail.tasks.map((t: any) => (
                    <div key={t.id} className="border border-gray-200 rounded-lg px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900">{t.description}</p>
                        <span className="flex items-center gap-2">
                          {t.role_id && (
                            <span className="text-xs bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full">
                              {roleLabel(t.role_id)}
                            </span>
                          )}
                          {flagged(t) && <ExampleChip />}
                          {t.status === "suggested" && !flagged(t) && !exampleDetail ? (
                            <>
                              <button onClick={async () => { const d = await call(`/admin/call-tasks/${t.id}/accept`); if (d) loadDetail(selected); }}
                                className="text-xs text-emerald-700 font-medium hover:underline">Accept</button>
                              <button onClick={async () => { const d = await call(`/admin/call-tasks/${t.id}/dismiss`); if (d) loadDetail(selected); }}
                                className="text-xs text-gray-400 hover:text-red-600">Dismiss</button>
                            </>
                          ) : (
                            <span className={`text-xs ${t.status === "accepted" ? "text-emerald-700" : "text-gray-400"}`}>{t.status}</span>
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 italic">“{t.quote}”, at {fmtTs(t.timestamp_ms)}</p>
                    </div>
                  ))}
                  {detail.tasks.length === 0 && <p className="text-sm text-gray-400">No suggestions survived, or none were made.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * LANE L7: the founders' demand signal. Unmatched intents by topic sit
 * beside the concierge's unmatched queries, because together they answer
 * "which role or module should exist next". Incognito rows arrive as counts
 * and topics only; their words never reach this tab.
 */
function IntentsAdminTab({ password }: { password: string }) {
  const [demand, setDemand] = useState<any>(null);
  const [conciergeGaps, setConciergeGaps] = useState<any[] | null>(null);
  const [mapOff, setMapOff] = useState(false);
  const [off, setOff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/intents/admin/demand`, { headers: authHeaders(password) });
        if (res.status === 404) { setOff(true); setLoading(false); return; }
        if (res.ok) setDemand(await res.json());
      } catch { setDemand(null); }
      try {
        const res = await fetch(`${API_BASE}/admin/map/concierge-log?unmatched=1`, { headers: authHeaders(password) });
        if (res.status === 404) setMapOff(true);
        else if (res.ok) setConciergeGaps(await res.json());
      } catch { setConciergeGaps(null); }
      setLoading(false);
    })();
  }, [password]);

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (off) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-600">The Introductions module is off. Turn it on in the Module Library.</p>
      </div>
    );
  }
  const counts = demand?.counts ?? {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Active intents", counts.activeIntents],
          ["Surfaced this moon", counts.surfacedThisMoon],
          ["Opened this moon", counts.openedThisMoon],
          ["Model calls this moon", counts.modelCallsThisMoon],
        ].map(([label, n]) => (
          <div key={String(label)} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-gray-900">{Number(n ?? 0)}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="font-semibold text-gray-900">What people asked for and did not get</h3>
        <p className="text-xs text-gray-500">
          Active intents no introduction has touched in 14 days, by topic. This is the demand signal: the next role,
          quest or module lives in this list.
        </p>
        {(demand?.unmatchedByTopic ?? []).length === 0 && (
          <p className="text-sm text-gray-400">Nothing is waiting. Every active intent has seen a proposal.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {(demand?.unmatchedByTopic ?? []).map((t: any) => (
            <span key={t.topic} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              {t.topic} <span className="font-semibold">{t.count}</span>
            </span>
          ))}
        </div>
        <ul className="divide-y divide-gray-100">
          {(demand?.unmatched ?? []).map((i: any, idx: number) => (
            <li key={idx} className="py-2 text-sm text-gray-700">
              <span className="text-xs uppercase text-gray-400 mr-2">{i.kind}</span>
              {i.text ?? <span className="italic text-gray-400">incognito: topics only ({(i.topics ?? []).join(", ") || "untagged"})</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="font-semibold text-gray-900">The concierge's own gaps</h3>
        {mapOff ? (
          <p className="text-sm text-gray-400">The map is off, so there is no concierge log to read.</p>
        ) : (
          <>
            {(conciergeGaps ?? []).length === 0 && <p className="text-sm text-gray-400">No unmatched queries.</p>}
            <ul className="divide-y divide-gray-100">
              {(conciergeGaps ?? []).slice(0, 30).map((q: any) => (
                <li key={q.id} className="py-2 text-sm text-gray-700">{q.query}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// ── Cycle close: settlement, which is a human act ────────────────────────────

/**
 * THE SETTLEMENT DESK, which had no surface at all.
 *
 * `POST /api/admin/cycles/close` shipped with the lunar economy and has had
 * no caller anywhere in the client since, so the only way to settle a
 * lunation was curl. Everything that runs at close was unreachable with it:
 * the value pool, the health snapshot that can only ever be taken at the
 * boundary, the earned-badge re-evaluation, and every governance proposal
 * whose author was told it applies at the next cycle close. Meanwhile the
 * member's dashboard counts down to a moment nobody could reach.
 *
 * No timer may press this (`server/lib/scheduler.ts`): settlement releases
 * value and is deliberately a human act. So the desk reads the settlement out
 * first, asks once in plain words, and then reports what actually happened,
 * which includes reporting a second press as the nothing that it is.
 */
function CyclesTab({ password }: { password: string }) {
  const [openCycle, setOpenCycle] = useState<OpenCycle | null>(null);
  const [pending, setPending] = useState<PendingSettlement | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState<{ settled: boolean; headline: string; lines: string[] } | null>(null);
  /**
   * THE VILLAGE'S HARVEST. A counter, not a flag, because a founder can
   * settle twice in one sitting and a flag that is already true never re-arms
   * the window. It counts only settlements that actually released something:
   * a 200 carrying `closed: 0` is the double press, and the report already
   * refuses to call that a settlement.
   */
  const [harvest, setHarvest] = useState(0);
  const harvesting = useMomentWindow(harvest);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Three reads, one desk: what is open now, what a close would settle,
      // and what every past settlement came to.
      const [cycle, preview, dists] = await Promise.all([
        fetch(`${API_BASE}/game/cycle`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE}/admin/cycles/pending`, { headers: authHeaders(password) })
          .then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE}/game/cycle/distributions`).then((r) => (r.ok ? r.json() : [])),
      ]);
      setOpenCycle(cycle);
      setPending(preview);
      setHistory(Array.isArray(dists) ? dists : []);
    } catch {
      setPending(null);
    }
    setLoading(false);
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const day = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString() : "");
  const intent = settlementIntent(pending);
  const blocked = settlementBlocked(pending);
  const due = pending?.due ?? [];
  const poolName = pending?.pool.tokenName ?? "";

  const settle = async () => {
    setClosing(true);
    try {
      const res = await fetch(`${API_BASE}/admin/cycles/close`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(data, "The close was refused."));
      // The server's own answer decides the words. A 200 carrying `closed: 0`
      // is the double press, and it must never read as a settlement.
      const report = closeReport(data, poolName || String(pending?.pool.token ?? ""));
      setOutcome(report);
      if (report.settled) {
        setHarvest((n) => n + 1);
        playMoment("quest_complete", "arrive");
      }
      setConfirming(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "The close was refused.");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cycle Close</h2>
          <p className="text-sm text-gray-500 mt-1">
            Settling a lunation records what the village acknowledged and releases the
            value pool that follows it. A person does this, never a timer, so read the
            settlement below before you press anything.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 shrink-0"
        >
          Re-read
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <BreathingLoader label="Reading the lunations" size={44} showLabel />
        </div>
      ) : (
        <div className="space-y-6">
          {outcome && (
            <div className={`relative rounded-xl border px-4 py-3 ${outcome.settled ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"}`}>
              {/* The one admin act that releases value, and the only one that
                  earns a moment. Fireflies: many small lights, which is what a
                  settled lunation is. */}
              {harvesting && (
                <span className="absolute top-1 right-2 pointer-events-none">
                  <Celebration
                    kind="fireflies"
                    intensity="moment"
                    size={72}
                    seed={harvest}
                    message={outcome.headline}
                  />
                </span>
              )}
              <p className={`font-semibold ${outcome.settled ? "text-emerald-900" : "text-gray-800"}`}>{outcome.headline}</p>
              <ul className="mt-1 space-y-0.5">
                {outcome.lines.map((line, i) => (
                  <li key={i} className={`text-sm ${outcome.settled ? "text-emerald-800" : "text-gray-600"}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">The open lunation</p>
              {openCycle ? (
                <>
                  <p className="text-lg font-semibold text-gray-900 mt-1">Lunation {openCycle.cycleNumber}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Opened {day(openCycle.startsAt)}, closes {day(openCycle.endsAt)}.
                  </p>
                  <p className="text-sm text-gray-600">
                    {openCycle.daysRemaining} {openCycle.daysRemaining === 1 ? "day" : "days"} left.
                    {openCycle.moonPhaseName ? ` The moon is ${String(openCycle.moonPhaseName).toLowerCase()}.` : ""}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    A lunation settles once it has ended. This one is still running.
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500 mt-1">The open lunation could not be read.</p>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">The value pool</p>
              {pending ? (
                <>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    {pending.pool.size.toLocaleString()} {pending.pool.tokenName}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Split across everyone acknowledged that lunation, in proportion to what
                    they received. Set by gratitude.pool_per_cycle in Game Mechanics.
                  </p>
                  {pending.pool.problem && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                      {pending.pool.problem}
                    </p>
                  )}
                  {pending.unreadableCycles && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                      {pending.unreadableCycles}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-red-600 mt-1">The settlement preview could not be read.</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">What a close would settle</h3>
            {due.length === 0 ? (
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-6">
                {/* An empty list has two causes and they are not the same news.
                    Claiming everything is settled while the server could not
                    read some rows is the product stating a fact it does not
                    have. */}
                {pending?.unreadableCycles
                  ? "The preview stopped before it could list anything. The message above says why."
                  : "Nothing is due. Every finished lunation is already settled."}
              </p>
            ) : (
              <div className="space-y-3">
                {due.map((c) => (
                  <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-gray-900">Lunation {c.cycleNumber}</p>
                      <p className="text-xs text-gray-500">
                        {day(c.startsAt)} to {day(c.endsAt)} · {c.recipients} {c.recipients === 1 ? "member" : "members"} · {c.credited.toLocaleString()} {c.token}
                      </p>
                    </div>
                    {c.fromPersistedSplit && (
                      <p className="text-xs text-amber-800 bg-amber-50 border-b border-amber-200 px-4 py-2">
                        An earlier close already wrote this split. A retry pays from that record,
                        and anything already paid pays once.
                      </p>
                    )}
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-gray-500">
                        <tr className="border-t border-gray-100">
                          <th className="px-4 py-2">Member</th>
                          <th className="px-4 py-2">Received</th>
                          <th className="px-4 py-2">From</th>
                          <th className="px-4 py-2">Would be credited</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.shares.map((s, i) => (
                          <tr key={`${c.id}-${i}`} className="border-t border-gray-100">
                            <td className="px-4 py-2 text-gray-900">{s.name}</td>
                            <td className="px-4 py-2 text-gray-600">{s.received}</td>
                            <td className="px-4 py-2 text-gray-600">
                              {s.distinctSenders} {s.distinctSenders === 1 ? "person" : "people"}
                            </td>
                            <td className="px-4 py-2 text-gray-900">{s.credited.toLocaleString()}</td>
                          </tr>
                        ))}
                        {c.shares.length === 0 && (
                          <tr className="border-t border-gray-100">
                            <td colSpan={4} className="px-4 py-3 text-gray-500">
                              Nobody was acknowledged in this lunation. Closing it only moves the clock on.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

          {confirming ? (
            <div className="border-2 border-teal-deep rounded-xl p-4 bg-white">
              <p className="font-semibold text-gray-900">Close what is due</p>
              <ul className="mt-2 space-y-1">
                {intent.map((line, i) => (
                  <li key={i} className="text-sm text-gray-700">{line}</li>
                ))}
              </ul>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-4">And this happens with it</p>
              <ul className="mt-1 space-y-1 list-disc ml-5">
                {CLOSE_CONSEQUENCES.map((line) => (
                  <li key={line} className="text-sm text-gray-600">{line}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  disabled={closing || blocked}
                  onClick={() => void settle()}
                  className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 hover:bg-teal-deep-dark disabled:opacity-40"
                >
                  {closing ? "Settling..." : "Yes, settle it"}
                </button>
                <button
                  disabled={closing}
                  onClick={() => setConfirming(false)}
                  className="text-sm border border-gray-200 text-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50 disabled:opacity-40"
                >
                  Not yet
                </button>
              </div>
              {blocked && (
                <p className="text-xs text-red-700 mt-2">
                  Fix the pool setting in Game Mechanics first. The server refuses this close.
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={() => { setOutcome(null); setConfirming(true); }}
              disabled={!pending}
              className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 hover:bg-teal-deep-dark disabled:opacity-40"
            >
              Close what is due
            </button>
          )}

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Settlements on record</h3>
            {(history ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No lunation has been settled yet.</p>
            ) : (
              <div className="space-y-3">
                {(history ?? []).slice(0, 6).map((c: any) => (
                  <div key={c.id} className="border border-gray-200 rounded-xl px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-gray-900">Lunation {c.cycleNumber}</p>
                      <p className="text-xs text-gray-500">Closed {day(c.closedAt)}</p>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {(c.totals ?? []).length} {(c.totals ?? []).length === 1 ? "member" : "members"} acknowledged
                      {(c.totals ?? []).some((t: any) => t.credited > 0)
                        ? `, ${(c.totals ?? []).reduce((n: number, t: any) => n + (Number(t.credited) || 0), 0).toLocaleString()} released`
                        : ""}
                      .
                    </p>
                    <p className="text-xs text-gray-400 mt-1 break-words">
                      {(c.totals ?? []).map((t: any) => `${t.name} ${t.received}`).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">
              This is the report the founders carry to Hypha, where the project's real
              value is governed. It is public, and it carries first names only.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ledger reconciliation (S9): the invariants, on demand ────────────────────

function LedgerTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ledger/reconciliation`, { headers: authHeaders(password) });
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Ledger</h2>
          <p className="text-sm text-gray-500 mt-1">
            The same checks the server proves before every boot, on demand. Faucet
            accounts run negative by design. Their negative balance is what they
            have issued, which is why everything still sums to zero.
          </p>
        </div>
        <button onClick={load} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50">
          Re-check
        </button>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : !data ? (
        <p className="text-sm text-red-600">Could not load reconciliation.</p>
      ) : (
        <div className="space-y-6">
          {data.invariants?.ok ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              All invariants hold: per-token conservation ≡ 0, the balance cache matches
              the transfers, no Hypha token has ledger rows, and nothing but faucets is negative.
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold mb-1">Invariant violations. The server will refuse to boot like this:</p>
              <ul className="list-disc ml-5 space-y-0.5">
                {(data.invariants?.problems ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">Tokens in motion</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-t border-gray-100">
                  <th className="px-4 py-2">Token</th>
                  <th className="px-4 py-2">Transfers</th>
                  <th className="px-4 py-2">Volume</th>
                  <th className="px-4 py-2">Held by members</th>
                </tr>
              </thead>
              <tbody>
                {(data.tokens ?? []).map((t: any) => (
                  <tr key={t.tokenType} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{t.name} <span className="text-xs text-gray-400 font-mono">{t.tokenType}</span></td>
                    <td className="px-4 py-2 text-gray-600">{t.transfers}</td>
                    <td className="px-4 py-2 text-gray-600">{t.volume}</td>
                    <td className="px-4 py-2 text-gray-600">{t.heldByMembers}</td>
                  </tr>
                ))}
                {(data.tokens ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400 text-xs">No transfers yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">System accounts</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-t border-gray-100">
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2">Token</th>
                  <th className="px-4 py-2">Balance (ledger units)</th>{/* on purpose: this table is the conservation proof and the proof is over the INT column, so a Voice row reads 10000 for ten. Every MEMBER-facing surface divides, through client/src/lib/tokenAmount.ts */}
                  <th className="px-4 py-2">Issued to date</th>
                </tr>
              </thead>
              <tbody>
                {(data.systemAccounts ?? []).map((s: any, i: number) => (
                  <tr key={`${s.id}-${s.tokenType ?? i}`} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-gray-700">{s.id}</span>
                      {s.faucet && <span className="ml-2 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">faucet</span>}
                      <div className="text-xs text-gray-400">{s.label}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-600 font-mono text-xs">{s.tokenType ?? "-"}</td>
                    <td className="px-4 py-2 text-gray-600">{s.balance ?? "-"}</td>
                    <td className="px-4 py-2 text-gray-600">{s.issuedToDate ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Admin: Seasons ───────────────────────────────────────────────────────
// Seasons are a list and the current one is picked by date, so the banner can
// never keep advertising a season that already turned. Queue the next one and
// the handover happens on its own.

interface SeasonGoal { text: string; done: boolean }
interface SeasonRow {
  id: string; name: string; theme: string; focus: string;
  startsOn: string; endsOn: string; goals: SeasonGoal[];
}

const CADENCES = [
  { value: "solstice-equinox", label: "Solstices & equinoxes" },
  { value: "quarterly", label: "Quarterly (3 months)" },
  { value: "lunar", label: "Lunar (~29.5 days)" },
  { value: "custom", label: "Custom / set by hand" },
];

function SeasonTab({ password }: { password: string }) {
  const [cfg, setCfg] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/seasons`, { headers: authHeaders(password) });
      setCfg(await res.json());
    } catch { /* silent */ }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/seasons`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ seasons: cfg.seasons, cadence: cfg.cadence, timezone: cfg.timezone }),
      });
      if (!res.ok) throw new Error();
      toast.success("Seasons saved");
      load();
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  if (!cfg) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  const seasons: SeasonRow[] = cfg.seasons ?? [];
  const setSeasons = (next: SeasonRow[]) => setCfg({ ...cfg, seasons: next });
  const update = (i: number, patch: Partial<SeasonRow>) =>
    setSeasons(seasons.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addSeason = () => {
    const s = cfg.suggestion ?? { startsOn: "", endsOn: "" };
    setSeasons([...seasons, {
      id: `season-${Date.now()}`, name: "", theme: "", focus: "",
      startsOn: s.startsOn, endsOn: s.endsOn, goals: [],
    }]);
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Seasons</h2>
          <p className="text-sm text-gray-500 mt-1">
            Name your seasons, say what each one is for, and set its goals. The banner shows
            whichever season covers today. Queue the next one and it hands over by itself.
          </p>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50 shrink-0">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {cfg.needsNextSeason && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>No season covers today.</strong> The banner stays hidden until you add one,
          better than showing a season that has already turned.
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-6 max-w-xl">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Rhythm</label>
          <select
            value={cfg.cadence}
            onChange={(e) => setCfg({ ...cfg, cadence: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
          >
            {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Used to suggest dates for the next season.</p>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Timezone</label>
          <input
            type="text"
            value={cfg.timezone ?? ""}
            onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
            placeholder="America/Costa_Rica"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
          />
          <p className="text-[11px] text-gray-400 mt-1">A season turns at midnight where the village is.</p>
        </div>
      </div>

      <div className="space-y-4">
        {seasons.map((s, i) => {
          const isCurrent = cfg.currentId === s.id;
          const upcoming = s.startsOn > (cfg.today ?? "");
          return (
            <div key={s.id} className={`border rounded-xl overflow-hidden ${isCurrent ? "border-teal-deep" : "border-gray-200"}`}>
              <div className={`flex items-center justify-between px-4 py-2 text-xs font-semibold ${isCurrent ? "bg-teal-deep/10 text-teal-deep" : "bg-gray-50 text-gray-500"}`}>
                <span>{isCurrent ? "Running now" : upcoming ? "Upcoming" : "Past"}</span>
                <button onClick={() => setSeasons(seasons.filter((_, idx) => idx !== i))} className="text-red-600 hover:text-red-700 font-medium">
                  Remove
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <input type="text" value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Season name" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <input type="text" value={s.theme} onChange={(e) => update(i, { theme: e.target.value })} placeholder="Theme" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={s.startsOn} onChange={(e) => update(i, { startsOn: e.target.value })} className="px-2 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="date" value={s.endsOn} onChange={(e) => update(i, { endsOn: e.target.value })} className="px-2 py-2 text-sm border border-gray-200 rounded-lg" />
                  </div>
                </div>
                <input type="text" value={s.focus} onChange={(e) => update(i, { focus: e.target.value })} placeholder="What this season is for (shown on the banner)" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Main goals</p>
                  <div className="space-y-1.5">
                    {(s.goals ?? []).map((g, gi) => (
                      <div key={gi} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={g.done}
                          onChange={(e) => update(i, { goals: s.goals.map((x, xi) => xi === gi ? { ...x, done: e.target.checked } : x) })}
                          className="h-4 w-4 accent-teal-deep shrink-0"
                        />
                        <input
                          type="text"
                          value={g.text}
                          onChange={(e) => update(i, { goals: s.goals.map((x, xi) => xi === gi ? { ...x, text: e.target.value } : x) })}
                          placeholder="What this season is trying to achieve"
                          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
                        />
                        <button onClick={() => update(i, { goals: s.goals.filter((_, xi) => xi !== gi) })} className="text-gray-400 hover:text-red-600 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => update(i, { goals: [...(s.goals ?? []), { text: "", done: false }] })}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-teal-deep font-medium hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Add goal
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={addSeason} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
        <Plus className="w-4 h-4" /> Queue the next season
        {cfg.suggestion?.endsOn && (
          <span className="text-xs text-gray-400">({cfg.suggestion.startsOn} → {cfg.suggestion.endsOn})</span>
        )}
      </button>
    </div>
  );
}


// ── One hero image: upload (compressed for you) or point at your own URL ──────

function BrandImageField({
  label, value, fallback, alt, password, onChange, onAltChange, altUnavailable,
}: {
  label: string;
  value: string;
  fallback: string;
  alt: string;
  password: string;
  onChange: (v: string) => void;
  onAltChange: (v: string) => void;
  /**
   * Why this image has no alt text to write, when it has none.
   *
   * The favicon is the one case: it renders as `<link rel="icon">`, so there is
   * no `alt` attribute for a value to reach. The field used to be offered
   * anyway and the value went into storage that nothing read. An accessibility
   * control that discards what a founder types also records the work as done,
   * which is worse than the missing control.
   */
  altUnavailable?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [showUrl, setShowUrl] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/admin/brand/image`, {
        method: "POST", headers: authHeaders(password), body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "Upload failed"));
      onChange(data.url);
      const saved = data.originalBytes && data.bytes
        ? `, ${Math.round(data.originalBytes / 1024)}KB down to ${Math.round(data.bytes / 1024)}KB`
        : "";
      setNote(`Uploaded${saved}. Remember to save.`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    }
    setUploading(false);
  };

  const src = value || fallback;

  return (
    <div>
      <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>

      {/* Preview at the shape it actually renders in, so nothing gets beheaded */}
      <div className="relative aspect-[16/9] w-full rounded-lg bg-gray-100 overflow-hidden border border-gray-200 mb-2">
        {src
          ? <img src={src} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-400">No image yet</div>}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs text-gray-600">
            Compressing…
          </div>
        )}
      </div>

      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-deep text-white text-xs font-medium cursor-pointer hover:opacity-90">
        <Upload className="w-3.5 h-3.5" />
        {value ? "Replace image" : "Upload image"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          disabled={uploading}
          onChange={(e) => { pick(e.target.files?.[0]); e.currentTarget.value = ""; }}
        />
      </label>

      <button
        type="button"
        onClick={() => setShowUrl((s) => !s)}
        className="ml-2 text-[11px] text-gray-500 underline hover:text-gray-700"
      >
        {showUrl ? "hide URL" : "or use a URL"}
      </button>

      {showUrl && (
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="w-full mt-2 px-3 py-2 text-sm border border-gray-200 rounded-lg"
        />
      )}

      {altUnavailable ? (
        <p className="text-[11px] text-gray-500 mt-2 border-l-2 border-gray-200 pl-2">{altUnavailable}</p>
      ) : (
        <label className="block mt-2 text-[11px] text-gray-500">
          Alt text, read aloud by screen readers
          <input
            type="text"
            value={alt}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder="Describe what is in this picture"
            className="w-full mt-1 px-3 py-2 min-h-[44px] text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
          />
        </label>
      )}

      {note && <p className="text-[11px] text-emerald-600 mt-1">{note}</p>}
      <p className="text-[11px] text-gray-400 mt-0.5">
        Landscape works best. Big photos are resized and compressed automatically.
      </p>
    </div>
  );
}

// ── Setup Wizard: the white-label front door — make this site your project's ───

/* Exported for client/src/pages/Admin.setupWizard.test.tsx, which is the only
   caller outside this file. The Admin shell below still renders it directly. */
export function SetupWizard({ password, onOpenTab }: { password: string; onOpenTab: (tab: string) => void }) {
  const [brand, setBrand] = useState<any>(null);
  const [defaults, setDefaults] = useState<any>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  /**
   * Which currency codes the daily rate table actually carries.
   *
   * Read live from the same route the member-facing picker reads, rather
   * than from a list typed here, so this can never drift from what the
   * village can really convert. Empty is a fine answer: the note below the
   * field only speaks when it knows something.
   *
   * ABOVE THE EARLY RETURN, with the other hooks, and it has to stay there.
   * A hook below `if (!brand || !defaults) return` is a hook the first render
   * skips and the second runs, which is exactly the crash the Work With Us
   * tab shipped with.
   */
  const [fxCovered, setFxCovered] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/fx/rates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (!alive) return;
        // ONLY when rates actually arrived. Seeding from `t.base` alone made
        // `known` true with one entry, so a village whose daily job had not run
        // was told there is no rate for USD, which is false.
        const rates = Object.keys(t?.rates ?? {});
        if (!rates.length) return;
        setFxCovered([t.base, ...rates].filter(Boolean).sort());
      })
      .catch(() => { /* No table is not an error here; the note stays quiet. */ });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/brand`, { headers: authHeaders(password) });
      const data = await res.json();
      setBrand(data.brand);
      setDefaults(data.defaults);
    } catch { toast.error("Failed to load setup"); }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const saveBrand = async (section: string, partial: any) => {
    setSavingSection(section);
    try {
      const res = await fetch(`${API_BASE}/admin/brand`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBrand(data.brand);
      toast.success("Saved");
    } catch { toast.error("Save failed"); }
    setSavingSection(null);
  };

  const setField = (group: "project" | "currency" | "images", key: string, value: string) =>
    setBrand({ ...brand, [group]: { ...brand[group], [key]: value } });

  const toggleStep = (key: string) => {
    const next = { ...brand.setup, [key]: !brand.setup[key] };
    setBrand({ ...brand, setup: next });
    saveBrand("setup", { setup: next });
  };

  if (!brand || !defaults) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  /* Identity and Pictures are read from `brand`; the other four still come from
     the flags a founder ticks. See client/src/components/admin/setupProgress.ts. */
  const rows = measureSetup(brand);
  const doneCount = rows.filter((r) => r.done).length;
  const setupComplete = doneCount === rows.length;

  /** Clears the hand-ticked flags so the walkthrough (and its progress bar)
   *  comes back. None of the actual settings are touched, and the two measured
   *  rows keep reading the record either way. */
  const resetSetup = () => {
    const cleared = Object.fromEntries(SETUP_STEPS.map((s) => [s.key, false]));
    setBrand({ ...brand, setup: cleared });
    saveBrand("setup", { setup: cleared });
  };

  /* `project` only. The two `currency` calls came out with the dead boxes, and
     narrowing the type is what stops a third one going back in by hand. */
  const brandField = (group: "project", key: string, label: string, defaultVal: string) => (
    <div key={key}>
      <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
      <input
        type="text"
        value={brand[group][key] ?? ""}
        onChange={(e) => setField(group, key, e.target.value)}
        placeholder={defaultVal}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
      />
      <p className="text-[11px] text-gray-400 mt-0.5">Platform default: {defaultVal}</p>
    </div>
  );

  /**
   * The currency this village's money is quoted in.
   *
   * IT HAD NO FIELD ANYWHERE, which is why every fork shipped declaring
   * Costa Rican colones: `shared/gameConfig.ts` defaults `fiatCurrency` to
   * "CRC" and no screen in client/src let a founder say otherwise.
   * `scripts/check-identity-keys.mjs` has been counting down a pending list
   * whose last entry is this key, and whose stated exit condition is that the
   * founder sets it in Admin. This is that screen.
   *
   * A FREE TEXT BOX WITH SUGGESTIONS, and deliberately not a dropdown. The
   * daily rate table carries fourteen codes; the world has rather more, and
   * the first village to use this platform is itself on one the table does
   * not carry. A closed list would have made this village's own currency
   * unreachable from the screen built to set it.
   *
   * The note is the honest half. `server/lib/fxRates.ts` fetches the ECB
   * daily list, which does not carry CRC (measured 2026-08-21), so a village
   * quoting in an uncovered currency shows amounts unconverted to anyone
   * viewing in another until an admin records a manual rate. That is a real
   * consequence of a choice made here, so it is said here, at the moment of
   * choosing, rather than discovered later on a member's screen.
   */
  const currencyField = () => {
    const raw = String(brand.project?.fiatCurrency ?? "");
    const code = raw.trim().toUpperCase();
    const problem = displayCurrencyProblem(raw.trim());
    const known = fxCovered.length > 0;
    const covered = known && fxCovered.includes(code);
    return (
      <div className="md:col-span-2">
        <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="project-fiat-currency">
          Currency your prices are in (three letter code)
        </label>
        <input
          id="project-fiat-currency"
          type="text"
          // Tied to the box: a bare role="alert" is announced once and is then
          // unreachable, so tabbing back gives the label and nothing about the
          // problem. aria-invalid exposes a state the red text cannot.
          aria-describedby="project-fiat-currency-note"
          aria-invalid={problem ? true : undefined}
          list="fiat-currency-options"
          maxLength={3}
          value={code}
          // Uppercased on the way in, so "chf" and "CHF" cannot become two
          // different villages' worth of stored value.
          onChange={(e) => setField("project", "fiatCurrency", e.target.value.toUpperCase())}
          placeholder={defaults.project?.fiatCurrency ?? ""}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg uppercase"
        />
        <datalist id="fiat-currency-options">
          {fxCovered.map((c) => <option key={c} value={c} />)}
        </datalist>
        {problem ? (
          <p id="project-fiat-currency-note" role="alert" className="text-[11px] text-red-600 mt-0.5">{problem}</p>
        ) : code && known && !covered ? (
          <p id="project-fiat-currency-note" className="text-[11px] text-amber-700 mt-0.5">
            There is no daily rate for {code}, so anyone viewing in another currency sees your
            amounts unconverted until an admin records a rate by hand. Prices themselves are unaffected.
          </p>
        ) : (
          <p id="project-fiat-currency-note" className="text-[11px] text-gray-400 mt-0.5">
            Platform default: {defaults.project?.fiatCurrency ?? ""}. This sets what every price on the
            site is quoted in, and what a member sees before choosing their own display currency.
          </p>
        )}
      </div>
    );
  };

  const imageField = (key: string, label: string, altUnavailable?: string) => (
    <BrandImageField
      key={key}
      label={label}
      value={brand.images[key] ?? ""}
      fallback={defaults.images[key]}
      alt={brand.images[`${key}Alt`] ?? ""}
      password={password}
      onChange={(v) => setField("images", key, v)}
      onAltChange={(v) => setField("images", `${key}Alt`, v)}
      altUnavailable={altUnavailable}
    />
  );

  /*
   * The "Journey page copy" row came out with the four tabs it pointed at.
   * It sent a founder to an editor whose saves the journey pages never read,
   * and a wizard that hands somebody a door to a room that was demolished is
   * worse than one that stays quiet about it.
   */
  const contentEditors = [
    /*
     * ORG CHART AND TEAM PAGE WERE MISSING FROM THIS LIST, and they are the two
     * surfaces a fresh village publishes people on. A founder walked the whole
     * wizard and was never shown the screen where the seats and the team cards
     * are edited, so whatever was already on /team and /roles stayed there and
     * read as the village's own. That is how a fork published four strangers.
     *
     * First in the list on purpose: people are the thing a visitor looks for
     * first and the thing a village is most answerable for.
     */
    { tab: "org-chart", label: "Org Chart", hint: "Your circles, your seats, and who holds them. This is what /roles and /team show." },
    { tab: "team", label: "Team Page", hint: "The portraits and short bios on /team, for the people you want a card for." },
    { tab: "faqs", label: "FAQs", hint: "The Common Questions on each journey page." },
    { tab: "milestones", label: "Build Progress", hint: "Your real build milestones shown on the homepage." },
    { tab: "training-modules", label: "Training modules", hint: "Your community's onboarding/learning modules." },
    { tab: "visit-config", label: "Visit program", hint: "Visit types, logistics, and booking copy." },
    { tab: "investor-summary", label: "Investor summary", hint: "The plain-language money facts on the investor page." },
    { tab: "season", label: "Season", hint: "The current season banner (name, theme, dates)." },
    { tab: "quests-admin", label: "Quests", hint: "Seeded starter quests. Rewrite, add or remove them here so the board is yours." },
  ];

  /* SetupSection is a module-scope import and MUST stay one. It was declared
     here, inside this body, which made a new component type on every render
     and remounted all six steps (and the focused input) on every keystroke.
     See client/src/components/admin/SetupSection.tsx for the full account. */
  const step = { rows, setup: brand.setup, onToggleStep: toggleStep };

  return (
    <div>
      <div className="mb-6">
        {/* Once every step is done this stops being an onboarding wizard and
            becomes the place you come back to — so it changes posture, not just
            its name. The steps stay editable either way. */}
        <h2 className="text-xl font-bold text-gray-900">
          {setupComplete ? "Project Settings" : "Make This Site Yours"}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {setupComplete
            ? "Your project's identity, pictures, and numbers. Change any of it any time."
            : "Everything you need to turn this into your project's coordination game. Blank fields keep the platform default as the suggestion."}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Identity and Pictures are counted from what you have saved here, so they go back to
          unfinished if a field is ever emptied. The other four steps are yours to tick, and say only what you told them.
        </p>
        {!setupComplete ? (
          <div className="flex items-center gap-3 mt-4">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-xs">
              <div className="h-2 bg-teal-deep rounded-full transition-all" style={{ width: `${(doneCount / rows.length) * 100}%` }} />
            </div>
            <span className="text-sm text-gray-500">{doneCount} / {rows.length} steps</span>
          </div>
        ) : (
          <button
            onClick={resetSetup}
            className="mt-3 text-xs text-gray-500 underline hover:text-gray-700"
          >
            Re-run the setup walkthrough
          </button>
        )}
      </div>

      <SetupSection {...step} id="identity" n={1} title="Identity" subtitle="What your project is called.">
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {/* catalystName is a LABEL and not a role: renaming it changes no permission (see client/src/lib/gameApi.ts).
              It is deliberately NOT one of the measured Identity fields in setupProgress.ts, because it ships with a
              working default and counting it would leave Identity unfinished forever for a village happy with it. */}
          {IDENTITY_WIZARD_FIELDS.map(([key, label]) => brandField("project", key, label, defaults.project[key] ?? ""))}
          {currencyField()}
          {/*
            THE TWO CURRENCY BOXES ARE GONE, and they were dead when they were
            here. `mergedConfig()` (server/index.ts) computes
            `pick(registryName, pick(brandName, configName))` for the
            recognition currency, so the token registry beat this box every
            time; `nameLower` is derived from that name and was never read at
            all. Typing here changed a stored value nothing displayed. The
            launch checklist then read the same dead field, so naming the token
            correctly under Tokens left the checklist red forever while typing
            in this box turned it green and changed nothing.

            One name, one place to set it. This line is the door.
          */}
          <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground mb-0.5">What your tokens are called</p>
            <p className="text-xs text-muted-foreground">
              Every token this village runs is named in one place, including the
              one members earn for recognition. A rename there follows to every
              page that says the word.
            </p>
            <button
              type="button"
              onClick={() => onOpenTab("tokens")}
              className="mt-1.5 text-xs font-medium text-teal-deep underline"
            >
              Open Tokens →
            </button>
          </div>
          {brandField("project", "siteUrl", "Main website URL (blank = no outside links)", (defaults.project as any).siteUrl ?? "")}
          {brandField("project", "eventsUrl", "Events page URL (optional)", (defaults.project as any).eventsUrl ?? "")}
          {brandField("project", "contactEmail", "Contact email for enquiries (blank hides every email button)", (defaults.project as any).contactEmail ?? "")}
          {brandField("project", "footerBlurb", "Footer introduction (one sentence)", (defaults.project as any).footerBlurb ?? "")}
        </div>
        {/* `currency` left out of the payload on purpose now that no box here
            writes it. The route merges rather than replaces, so an old stored
            value stays exactly where it is; nothing reads it, and this screen
            no longer adds to it. */}
        <button onClick={() => saveBrand("identity", { project: brand.project })} disabled={savingSection === "identity"} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {savingSection === "identity" ? "Saving..." : "Save identity"}
        </button>
        <p className="text-xs text-gray-400 mt-2">Instantly updates the game layer (profile, gratitude, season banner, pulse). Page marketing copy is edited under Content below.</p>
      </SetupSection>

      <SetupSection {...step} id="images" n={2} title="Pictures" subtitle="Hero images across the site. Upload your own (we host and compress them) or point at a URL you already host.">
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          {imageField("hero", "Homepage hero")}
          {imageField("investorHero", "Investor hero")}
          {imageField("residentHero", "Resident hero")}
          {imageField("stewardHero", "Steward hero")}
          {imageField("prosperityHero", "Prosperity hero")}
          {imageField("masterPlanHero", "Master plan hero")}
          {imageField("logo", "Header logo (~64px tall, transparent)")}
          {imageField("heartLogo", "Footer mark (~90px tall, transparent)")}
          {imageField(
            "favicon",
            "Browser tab icon (square)",
            "A tab icon has no alt text. Browsers name the tab from the page title, so there is nothing here for a screen reader to read.",
          )}
        </div>
        <button onClick={() => saveBrand("images", { images: brand.images })} disabled={savingSection === "images"} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {savingSection === "images" ? "Saving..." : "Save pictures"}
        </button>
        <p className="text-xs text-gray-400 mt-2">The logo, footer mark and tab icon apply live, no deploy. Alt text ships with the pictures and is what a screen reader reads aloud in place of the image. Crawler-facing metadata (og:image, canonical URL) stays neutral in <code>client/index.html</code>; a fork that wants it adds it in its own fork.</p>
        {/* Typography lives with Pictures: both are "how the village looks".
            Self-contained component — see client/src/components/TypographyPanel.tsx. */}
        <LookPanel password={password} />
        <TypographyPanel password={password} />
        <IdentityPackPanel password={password} />
      </SetupSection>

      <SetupSection {...step} id="numbers" n={3} title="Numbers" subtitle="The editable figures on your site.">
        <p className="text-sm text-gray-600 mb-3">
          Village dues live in the Settings tab, and so do the land and money figures the
          investor page and the master plan show. Every one of them ships blank. A blank figure
          means the page shows no figure at all, so your site only ever states what you stated.
        </p>
        <button onClick={() => onOpenTab("settings")} className="px-4 py-2 bg-white border border-gray-200 text-teal-deep rounded-lg text-sm font-medium hover:bg-gray-50">
          Open Settings →
        </button>
      </SetupSection>

      <SetupSection {...step} id="content" n={4} title="Content" subtitle="Rewrite the words, questions, milestones, and quests for your project.">
        <div className="space-y-2">
          {contentEditors.map((c) => (
            <div key={c.tab} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{c.label}</div>
                <div className="text-xs text-gray-500 truncate">{c.hint}</div>
              </div>
              <button onClick={() => onOpenTab(c.tab)} className="shrink-0 px-3 py-1.5 text-xs font-medium text-teal-deep border border-gray-200 rounded-lg hover:bg-gray-50">
                Open →
              </button>
            </div>
          ))}
        </div>
      </SetupSection>

      <SetupSection {...step} id="map" n={5} title="Map & styling" subtitle="How the Living Map draws your land. Blank keeps the map's own look.">
        <MapSkinPanel password={password} />
        <WalkEditorPanel password={password} />
        {/* The vocabulary route has been live since the map shipped and its
            only caller was a CLI importer. This is its first door. */}
        <MapVocabularyPanel password={password} />
      </SetupSection>

      <SetupSection {...step} id="technical" n={6} title="Go live" subtitle="One-time technical setup. Hand these to your developer or Claude Code.">
        <ol className="space-y-4 text-sm text-gray-700">
          <li>
            <p className="font-medium text-gray-900">1. Deploy on Railway</p>
            <p className="text-gray-500 mb-1">From the project folder, with the Railway CLI linked to your service:</p>
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-3 overflow-x-auto">railway up --ci -m "Initial deploy"</pre>
          </li>
          <li>
            <p className="font-medium text-gray-900">2. Add a persistent data volume</p>
            <p className="text-gray-500 mb-1">All player and content data lives here. Without it, every deploy wipes it.</p>
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-3 overflow-x-auto">railway volume add --mount-path /app/data</pre>
          </li>
          <li>
            <p className="font-medium text-gray-900">3. Set environment variables</p>
            <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-3 overflow-x-auto">{`railway variables \\
  --set "ADMIN_PASSWORD=<pick-a-strong-one>" \\
  --set "JOURNEY_PASSWORD=<pick-a-strong-one>" \\
  --set "FRONTEND_URL=https://your-domain"`}</pre>
            <p className="text-gray-500 mt-1">The Resend email API key is set later inside admin, under {CONNECTIONS_GROUP_TITLE}.</p>
          </li>
          <li>
            <p className="font-medium text-gray-900">4. Point your domain</p>
            <p className="text-gray-500">Railway dashboard → your service → Settings → Networking → add your custom domain, then add the CNAME it gives you at your DNS host.</p>
          </li>
          <li>
            <p className="font-medium text-gray-900">5. Social image & favicon</p>
            <p className="text-gray-500">Edit <code>client/index.html</code>: the <code>og:image</code>, <code>twitter:image</code>, and favicon links (these are build-time, not in this wizard).</p>
          </li>
          <li>
            <p className="font-medium text-gray-900">6. Full reference</p>
            <p className="text-gray-500">See <code>PLATFORM_FOUNDATION.md</code> in the repo for the complete white-label architecture and swap points.</p>
          </li>
        </ol>
      </SetupSection>
    </div>
  );
}

// ── Settings: editable project numbers (village dues, etc.) ───────────────────

function SettingsTab({ password }: { password: string }) {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/admin/settings`, { headers: authHeaders(password) })
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => toast.error("Failed to load settings"));
  }, [password]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      toast.success("Settings saved");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  if (!settings) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  const dues = settings.villageDues ?? {};
  const setDues = (patch: any) => setSettings({ ...settings, villageDues: { ...dues, ...patch } });
  const facts = settings.landFacts ?? {};
  const setFact = (key: string, patch: any) =>
    setSettings({ ...settings, landFacts: { ...facts, [key]: { ...(facts[key] ?? {}), ...patch } } });
  /*
   * Every one of these was a literal in a page file until now, so a fork
   * published one specific property's acreage, appraisal and projected return
   * as its own. Free text rather than a number input on purpose: a village may
   * want "$16M+", "1.2M EUR" or "under valuation", and forcing a numeric field
   * would push somebody into inventing a precision they do not have.
   */
  const landFields: Array<{ key: string; label: string; valueHint: string; noteHint: string; where: string }> = [
    /*
     * THE PLACEHOLDERS ARE NOT ANOTHER VILLAGE'S REAL FIGURES.
     *
     * The first draft of this panel used the exact numbers it was written to
     * remove, as "e.g." hints, and the fork test caught all three of them
     * shipping inside Admin's own chunk. A placeholder is content: whatever it
     * says is what the next person copies, and half of them will leave it.
     */
    { key: "acres", label: "Size of the land", valueHint: "how many", noteHint: "acres, hectares, manzanas (blank shows acres)", where: "Master plan" },
    { key: "appraisal", label: "Appraised value", valueHint: "what it came to", noteHint: "when it was made", where: "Master plan, investor page" },
    { key: "appreciation", label: "Change in land value", valueHint: "up or down by", noteHint: "over what period", where: "Investor page" },
    { key: "projectedReturn", label: "Projected return", valueHint: "what your model says", noteHint: "what the model assumes", where: "Investor page" },
    { key: "targetRaise", label: "Target raise", valueHint: "how much", noteHint: "for which phase", where: "Investor page" },
    { key: "plannedHomes", label: "Planned homes", valueHint: "how many", noteHint: "", where: "Master plan" },
    { key: "guestRooms", label: "Guest rooms", valueHint: "how many", noteHint: "", where: "Master plan" },
  ];
  const preview = dues.amount ? `${dues.currency || "$"}${dues.amount} / ${dues.period || "month"}` : "Not shown until you set an amount";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Settings</h2>
          <p className="text-sm text-gray-500 mt-1">The plain numbers on the site you can change any time, no code needed.</p>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="border border-gray-200 rounded-xl p-5 max-w-xl">
        <h3 className="font-semibold text-gray-900 mb-1">Village Dues</h3>
        <p className="text-sm text-gray-500 mb-4">
          Shown on the Resident page. Leave the amount blank while it's still to be confirmed and no figure appears on the site.
        </p>
        <div className="grid grid-cols-[1fr_90px_90px] gap-3 mb-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Amount</label>
            <input
              type="number"
              min={0}
              value={dues.amount ?? ""}
              onChange={(e) => setDues({ amount: e.target.value })}
              placeholder="e.g. 250"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Currency</label>
            <input
              type="text"
              value={dues.currency ?? "$"}
              onChange={(e) => setDues({ currency: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Per</label>
            <input
              type="text"
              value={dues.period ?? "month"}
              onChange={(e) => setDues({ period: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
        </div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Explanation note (shown under the figure)</label>
        <textarea
          value={dues.note ?? ""}
          onChange={(e) => setDues({ note: e.target.value })}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y mb-3"
        />
        <div className="text-sm text-gray-500">
          Preview on site: <span className="font-semibold text-teal-deep">{preview}</span>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl p-5 max-w-3xl mt-6">
        <h3 className="font-semibold text-gray-900 mb-1">Land and money</h3>
        <p className="text-sm text-gray-500 mb-4">
          The figures the master plan and the investor page show. Leave one blank and that
          tile does not appear, so the site never states a number you did not state. These are
          claims about your land, and a visitor will read them as yours.
        </p>
        <div className="space-y-3">
          {landFields.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr_1fr] gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  {f.label} <span className="text-gray-400">({f.where})</span>
                </label>
                <input
                  type="text"
                  value={facts[f.key]?.value ?? ""}
                  onChange={(e) => setFact(f.key, { value: e.target.value })}
                  placeholder={f.valueHint}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Small line under it</label>
                <input
                  type="text"
                  value={facts[f.key]?.note ?? ""}
                  onChange={(e) => setFact(f.key, { note: e.target.value })}
                  placeholder={f.noteHint}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


/**
 * S69: payment products — define what the village asks money for, watch
 * what arrives. Structural fields are immutable after creation (receipts
 * must stay true); activate/deactivate, description and ordering are live.
 */
function ProductsAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<any>({ kind: "fee", name: "", description: "", amountMinor: "", minAmountMinor: "500", recurring: "none", provider: "stripe", tokenSlug: "", tokenAmount: "", zeffyUrl: "", manualInstructions: "", audience: "public", active: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/products`, { headers: authHeaders(password) });
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body: any, method = "POST") => {
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers: authHeaders(password, { "Content-Type": "application/json" }), body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) { toast.error(refusal(d, "failed")); return null; }
    return d;
  };

  const money = (minor: number | null) => (minor == null ? "payer chooses" : `$${(Number(minor) / 100).toFixed(2)}`);
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Payments & Donations</h2>
        <p className="text-sm text-gray-500 mt-1">
          Fees, donations, deposits, waitlist seats, recurring memberships and
          token packs, all sold through the same verified Stripe spine, or via
          your Zeffy form / manual arrangement (confirmed here on reconciliation).
          Money flows in only. The public page is /contribute.
        </p>
      </div>
      {loading && !data ? <div className="text-center py-12 text-gray-400">Loading…</div> : (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Products</h3>
            <div className="space-y-2">
              {(data?.products ?? []).map((p: any) => (
                <div key={p.id} className="border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.name} <span className="text-xs text-gray-400">({p.kind}{p.recurring !== "none" ? ` · ${p.recurring}ly` : ""} · {p.provider})</span>
                      {/* The payload is SELECT *, so the flag is snake-cased. */}
                      {!!p.is_example && <ExampleChip className="ml-2 align-middle" />}
                    </p>
                    <p className="text-xs text-gray-500">
                      {money(p.amount_minor)}
                      {p.token_slug && ` · grants ${p.token_amount} ${p.token_slug}`}
                      {p.audience === "members" && " · members only"}
                    </p>
                  </div>
                  <button
                    onClick={async () => { if (await call(`/admin/products/${p.id}`, { active: !p.active }, "PUT")) load(); }}
                    className={`text-xs rounded-lg px-3 py-1.5 font-medium ${p.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-500"}`}
                  >
                    {p.active ? "Offered" : "Hidden"}
                  </button>
                </div>
              ))}
              {(data?.products ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing defined yet.</p>}
            </div>

            <div className="border-t border-gray-100 mt-4 pt-4 grid grid-cols-2 gap-2">
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={inputCls}>
                {["fee", "donation", "deposit", "waitlist", "membership", "token_pack"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} className={inputCls}>
                <option value="stripe">Stripe (card)</option>
                <option value="zeffy">Zeffy (fee-free link)</option>
                <option value="manual">Manual (cash/bank)</option>
              </select>
              <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`${inputCls} col-span-2`} />
              <input placeholder="Description (shown on /contribute)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={`${inputCls} col-span-2`} />
              <input placeholder={f.kind === "donation" ? "Amount USD (blank = payer chooses)" : "Amount USD"} value={f.amountMinor}
                onChange={(e) => setF({ ...f, amountMinor: e.target.value })} className={inputCls} />
              <select value={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.value })} className={inputCls}>
                <option value="none">one-time</option><option value="month">monthly</option><option value="year">yearly</option>
              </select>
              {f.kind === "token_pack" && (
                <>
                  <select value={f.tokenSlug} onChange={(e) => setF({ ...f, tokenSlug: e.target.value })} className={inputCls}>
                    <option value="">Token…</option>
                    {(data?.listableTokens ?? []).filter((t: any) => !t.reason).map((t: any) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                  </select>
                  <input placeholder="Tokens granted" value={f.tokenAmount} onChange={(e) => setF({ ...f, tokenAmount: e.target.value })} className={inputCls} />
                </>
              )}
              {f.provider === "zeffy" && (
                <input placeholder="Your Zeffy form URL" value={f.zeffyUrl} onChange={(e) => setF({ ...f, zeffyUrl: e.target.value })} className={`${inputCls} col-span-2`} />
              )}
              {f.provider === "manual" && (
                <input placeholder="Instructions shown to the payer" value={f.manualInstructions} onChange={(e) => setF({ ...f, manualInstructions: e.target.value })} className={`${inputCls} col-span-2`} />
              )}
              <button
                onClick={async () => {
                  const body = { ...f, amountMinor: f.amountMinor === "" ? null : Math.round(Number(f.amountMinor) * 100), minAmountMinor: Math.round(Number(f.minAmountMinor) || 500), tokenAmount: f.tokenAmount ? Number(f.tokenAmount) : undefined, tokenSlug: f.tokenSlug || undefined };
                  if (await call("/admin/products", body)) {
                    forgetExamplesCache("commerce");
                    toast.success("Product created");
                    setF({ ...f, name: "", description: "", amountMinor: "" });
                    load();
                  }
                }}
                disabled={f.name.trim().length < 3}
                className="col-span-2 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
              >
                Create product
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Purchases</h3>
            <div className="space-y-1.5">
              {(data?.purchases ?? []).map((o: any) => (
                <div key={o.id} className="text-sm text-gray-600 flex items-center justify-between gap-3 flex-wrap border-b border-gray-50 pb-1.5">
                  <span>
                    #{o.receipt_no}: {o.product_name} · ${(o.amount_minor / 100).toFixed(2)}
                    {o.periods_paid > 1 && ` · ${o.periods_paid} periods`}
                    {" · "}{o.user_name ?? o.payer_email ?? "anonymous"}
                    {" · "}
                    <span className={o.status === "paid" ? "text-emerald-600" : o.status === "reversed" ? "text-red-600" : "text-amber-600"}>{o.status}</span>
                  </span>
                  {o.status === "pending" && (
                    <button
                      onClick={async () => { if (await call(`/admin/products/purchases/${o.id}/confirm`, {})) { toast.success("Confirmed"); load(); } }}
                      className="text-xs text-teal-deep font-medium hover:underline"
                    >
                      Confirm received
                    </button>
                  )}
                </div>
              ))}
              {(data?.purchases ?? []).length === 0 && <p className="text-sm text-gray-400">No purchases yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * S66: the village's own feedback queue. Everything submitted through
 * /feedback lands here, whatever the relay is set to — the relay only
 * controls whether the platform team ALSO sees a copy (content, never
 * names). Status is a five-state pipeline, same vocabulary as submissions.
 */
function FeedbackAdminTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/feedback`, { headers: authHeaders(password) });
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    const res = await fetch(`${API_BASE}/admin/feedback/${id}`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return toast.error("Could not update");
    // A member who reported something now hears about the move. Items from
    // the public form carry no account, so those stay quiet, and the founder
    // can see which happened.
    const data = await res.json().catch(() => ({}));
    if (data?.notified) toast.success("Saved. The member who reported it has been told.");
    load();
  };

  const STATUSES = ["new", "seen", "planned", "done", "declined"];
  const badge = (s: string) =>
    s === "new" ? "bg-amber-50 text-amber-700 border-amber-200"
    : s === "done" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s === "declined" ? "bg-gray-100 text-gray-500 border-gray-200"
    : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Feedback</h2>
        <p className="text-sm text-gray-500 mt-1">
          Bugs and ideas from your members.{" "}
          {data?.relayOn
            ? "The platform relay is ON: a copy of each item (content only, never who) also reaches the team who maintain this software, so a fix can ship to every village."
            : data?.relayDialOn && data?.hubConfigured === false
            ? "The platform relay is switched on and this server has no hub address, so nothing is being sent. Everything stays local to this village until FEEDBACK_HUB_URL is set."
            : "The platform relay is OFF: everything stays local to this village."}{" "}
          The switch lives in Game Mechanics → platform.feedback_relay.
        </p>
      </div>
      {loading && !data ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (data?.items ?? []).length === 0 ? (
        <p className="text-sm text-gray-400 py-8">Nothing yet. The door is at /feedback (also linked in the footer).</p>
      ) : (
        <div className="space-y-3 max-w-3xl">
          {(data?.items ?? []).map((f: any) => (
            <div key={f.id} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 mr-2 ${f.kind === "bug" ? "bg-red-50 text-red-700 border-red-200" : "bg-violet-50 text-violet-700 border-violet-200"}`}>
                      {f.kind}
                    </span>
                    {f.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{f.detail}</p>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    {new Date(f.created_at).toLocaleString()}
                    {f.submitter_name && ` · from ${f.submitter_name}`}
                    {f.page_url && ` · at ${f.page_url}`}
                    {f.relayed_at ? " · relayed to the platform" : data?.relayOn ? " · queued for relay" : " · local only"}
                  </p>
                </div>
                <span className={`text-xs font-medium rounded-full border px-2.5 py-1 ${badge(f.status)}`}>{f.status}</span>
              </div>
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {STATUSES.filter((s) => s !== f.status).map((s) => (
                  <button key={s} onClick={() => setStatus(f.id, s)}
                    className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-100">
                    → {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * S64: a persistent strip above the admin header, gone the day the village
 * is marked launched. It reads the same /api/admin/launch the journey page
 * renders — one registry, no second opinion about what remains.
 */
function LaunchBanner({ password }: { password: string }) {
  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/admin/launch`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, [password]);

  if (!status || status.launchedAt) return null;
  const total = (status.items ?? []).length;
  const done = (status.items ?? []).filter((i: any) => i.state === "ok").length;
  return (
    <a
      href="/journey-to-launch"
      className="block bg-amber-400 text-teal-950 px-6 py-2.5 text-sm font-medium hover:bg-amber-300 transition-colors"
    >
      <span className="font-semibold">🌳 Journey to Launch:</span>{" "}
      {done} of {total} done
      {status.blockingOpen > 0 && ` · ${status.blockingOpen} blocking item${status.blockingOpen === 1 ? "" : "s"} open`}
      {status.blockingOpen === 0 && " · ready when a founder says so"}
      <span className="float-right">→</span>
    </a>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

export default function Admin() {
  const [password, setPassword] = useState<string | null>(null);
  // Live config, same hook the rest of the app already reads its identity
  // from. The panel header used to hardcode "Amora Admin" over
  // "game.amora.cr" — the first screen a founder on a fresh instance opens,
  // telling them they were looking at somebody else's site. siteUrl follows
  // the codebase's established rule (Layout.tsx): blank hides the element,
  // it never renders as an empty line.
  const cfg = useGameConfig();
  const villageName = String(cfg?.project?.name ?? "").trim();
  const siteUrl = String(cfg?.project?.siteUrl ?? "").trim();
  // S62: the tab lives in the URL (?tab=x), not in useState. Before this,
  // no surface anywhere — the launch page, Maia, an email — could point at
  // a specific admin screen; "go to Integrations" had no address. Same
  // `activeTab`/`setActiveTab` contract, so the ~35 call sites are untouched,
  // and back/forward now walk tab history the way a browser should.
  const [activeTab, setActiveTabState] = useState<string>(
    () => new URLSearchParams(window.location.search).get("tab") ?? "submissions",
  );
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    const p = new URLSearchParams(window.location.search);
    p.set("tab", tab);
    window.history.pushState({}, "", `${window.location.pathname}?${p.toString()}`);
    // Choosing from low in the rail leaves you scrolled past the top of the
    // panel you just opened; every tab change starts at its own beginning.
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onPop = () => setActiveTabState(new URLSearchParams(window.location.search).get("tab") ?? "submissions");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Drives where the setup panel sits in the nav and what it's called: a front
  // door while you're still setting up, ordinary settings once you're done.
  const [setupComplete, setSetupComplete] = useState(false);

  // The honest nav (L1): which module tabs render follows which modules are
  // on. AdminGoLive below owns the one /api/admin/modules read and hands the
  // lifecycle map up here; until it arrives this stays null and the filter
  // passes everything through, so a slow link never flashes an empty rail.
  const [moduleLifecycles, setModuleLifecycles] = useState<Record<string, ModuleLifecycle> | null>(null);

  // The nav rail's width, remembered. Phones and small tablets start
  // collapsed — 224px of menu on a 390px screen left the settings themselves
  // in a column too narrow to read — and anything laptop-sized starts open,
  // where there is room for both. A stored choice beats both defaults.
  const [navOpen, setNavOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("admin.navOpen");
    if (saved !== null) return saved === "1";
    return window.innerWidth >= 1024;
  });
  useEffect(() => {
    localStorage.setItem("admin.navOpen", navOpen ? "1" : "0");
  }, [navOpen]);

  useEffect(() => {
    if (!password) return;
    fetch(`${API_BASE}/admin/brand`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      // The wizard and this nav have to agree about what "finished" means, so
      // both ask setupProgress.ts. Reading `setup` here on its own was how the
      // rail could call a village done while its pictures were empty.
      .then((d) => setSetupComplete(setupIsComplete(d?.brand)))
      .catch(() => { /* leave as incomplete; the wizard just stays pinned */ });
  }, [password, activeTab]);

  if (!password) {
    return <AdminGate onAuth={setPassword} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* S64: the journey banner. Every admin sees the road to launch at the
          top of every admin visit until a founder marks the village launched —
          then it retires itself. */}
      <LaunchBanner password={password} />
      <header className="bg-teal-deep text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-tight">{villageName ? `${villageName} Admin` : "Admin"}</h1>
            {siteUrl && (
              <p className="text-xs text-white/60">{siteUrl.replace(/^https?:\/\//, "")}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setPassword(null)}
          className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </header>

      <div className="flex">
        <AdminNav
          groups={filterNavByModules(navGroups(setupComplete), moduleLifecycles)}
          activeTab={activeTab}
          onSelect={setActiveTab}
          open={navOpen}
          setOpen={setNavOpen}
        />

        {/* min-w-0 lets a flex child actually shrink — without it a wide
            table inside sets the floor and the page scrolls sideways. The
            padding steps down on small screens, where 32px a side was a
            tenth of the width. */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-4xl">
          {/* The Go-live card (L1): mounts once, above whichever panel is
              open, keyed by the open tab's module. It also feeds the nav
              filter, so the rail and the card ride one fetch. */}
          <AdminGoLive
            token={password}
            moduleId={TAB_MODULE[activeTab] ?? null}
            onLifecycles={(m) => setModuleLifecycles(m as Record<string, ModuleLifecycle>)}
          />
          {activeTab === "setup" && <SetupWizard password={password} onOpenTab={setActiveTab} />}
          {activeTab === "events-admin" && <EventsAdminPanel password={password} />}
          {activeTab === "submissions" && <SubmissionsTab password={password} />}
          {CONTENT_SECTIONS.map(({ key, label }) =>
            activeTab === key ? (
              <ContentEditorTab key={key} password={password} sectionKey={key} sectionLabel={label} />
            ) : null
          )}
          {activeTab === "email-settings" && <EmailSettingsTab password={password} openIntegrations={() => setActiveTab("integrations")} />}
          {activeTab === "integrations" && <IntegrationsTab password={password} />}
          {activeTab === "feedback" && <FeedbackAdminTab password={password} />}
          {activeTab === "forum-moderation" && <ForumModerationTab password={password} />}
          {activeTab === "message-reports" && <MessageReportsTab password={password} />}
          {activeTab === "products" && <ProductsAdminTab password={password} />}
          {activeTab === "investor-vault" && <InvestorVaultTab password={password} />}
          {activeTab === "uploaded-files" && <UploadedFilesTab password={password} />}
          {activeTab === "training-modules" && <TrainingModulesTab password={password} />}
          {activeTab === "quests-admin" && <QuestsTab password={password} />}
          {activeTab === "quest-claims" && <QuestClaimsTab password={password} />}
          {activeTab === "players" && <PlayersTab password={password} />}
          {activeTab === "game-roles" && <GameRolesTab password={password} />}
          {activeTab === "handover" && <HandoverTab password={password} />}
          {activeTab === "modules" && <ModulesTab password={password} />}
          {activeTab === "housing" && <HousingAdminPanel password={password} />}
          {activeTab === "org-chart" && <OrgChartTab password={password} />}
          {activeTab === "governance-weights" && <VotingWeightsPanel password={password} onOpenTab={setActiveTab} />}
          {activeTab === "brain" && <VillageBrainTab password={password} />}
          {activeTab === "drafts" && <DraftQueueTab password={password} />}
          {activeTab === "seasons-patterns" && <SeasonPatternsTab password={password} />}
          {activeTab === "circles-map" && <CirclesMapTab password={password} />}
          {activeTab === "tools-admin" && <ToolsAdminTab password={password} />}
          {activeTab === "crowdpool-admin" && <CrowdpoolAdminTab password={password} />}
          {activeTab === "stays-admin" && <StaysAdminTab password={password} onOpenTab={setActiveTab} />}
          {activeTab === "exchange-admin" && <ExchangeAdminTab password={password} />}
          {activeTab === "badges-admin" && <BadgesAdminTab password={password} />}
          {activeTab === "library-admin" && <LibraryAdminTab password={password} onOpenTab={setActiveTab} />}
          {activeTab === "health-admin" && <HealthAdminTab password={password} />}
          {activeTab === "resources-admin" && <ResourcesAdminPanel password={password} />}
          {activeTab === "exits-admin" && <ExitsAdminTab password={password} />}
          {activeTab === "calls-admin" && <CallsAdminTab password={password} />}
          {activeTab === "intents-admin" && <IntentsAdminTab password={password} />}
          {/* The same lifecycle map the nav filters on, so the registry and the
              rail can never disagree about which modules this village runs. */}
          {activeTab === "tokens" && <TokensTab password={password} lifecycles={moduleLifecycles} />}
          {activeTab === "ledger" && <LedgerTab password={password} />}
          {activeTab === "cycles" && <CyclesTab password={password} />}
          {activeTab === "variables" && <VariablesTab password={password} />}
          {activeTab === "season" && <SeasonTab password={password} />}
          {activeTab === "settings" && <SettingsTab password={password} />}
          {activeTab === "work-with-us" && <WorkWithUsTab password={password} />}
          {activeTab === "faqs" && <FaqAdminTab password={password} />}
          {activeTab === "milestones" && <MilestonesAdminTab password={password} />}
          {activeTab === "visit-config" && <VisitAdminTab password={password} />}
          {activeTab === "investor-summary" && <InvestorSummaryAdminTab password={password} />}
        </main>
      </div>
    </div>
  );
}