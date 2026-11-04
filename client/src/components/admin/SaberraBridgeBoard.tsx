/**
 * THE SERA BRIDGE BOARD, on the Saberra module card above the connection.
 *
 * A read-only status of the whole bridge as quests: the connection, members'
 * own lists from Sera, feedback to Sera, the review queue, the Needs Owner
 * queue, and the data agreement. Every number comes from
 * GET /api/saberra/bridge; the level counts only checks that are true in that
 * answer, and the tools are a checklist from Saberra's emails, labelled so.
 *
 * Lazy-loaded by `SaberraConfigPanel.tsx`, so the main bundle does not grow.
 */
import { useEffect, useState } from "react";
import {
  SERA_AGREEMENT,
  SERA_TOOLS,
  agreementState,
  bridgeChecks,
  type BridgeAnswer,
} from "@shared/seraBridgeBoard";
import type { QuestFeedAnswer } from "@shared/seraQuestFeed";
import { droppedWords, syncHealth, syncHealthWords } from "@shared/seraSyncHealth";
import { API_BASE, authHeaders } from "./adminApi";
import { LevelRing, QuestCard, ToolBadges, type QuestState } from "./SaberraBridgeQuests";

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function countdown(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  return h > 0 ? `in ${h} h ${m} min` : `in ${m} min`;
}

function villageDate(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return d.toLocaleString("en-US", { timeZone: SERA_AGREEMENT.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function BridgeView({ a, now, onFeed }: { a: BridgeAnswer; now: number; onFeed?: (dryRun: boolean) => Promise<QuestFeedAnswer | string> }) {
  const [feed, setFeed] = useState<QuestFeedAnswer | string | null>(null);
  const [feeding, setFeeding] = useState(false);
  const press = async (dryRun: boolean) => {
    if (!onFeed) return;
    setFeeding(true);
    setFeed(await onFeed(dryRun));
    setFeeding(false);
  };
  const shown = feed && typeof feed !== "string" ? feed : a.questFeed?.last ?? null;
  const [showChecks, setShowChecks] = useState(false);
  const checks = bridgeChecks(a, now);
  const health = syncHealth(a.sync ?? null, now);
  const done = checks.filter((c) => c.done).length;
  const allDone = done === checks.length;
  const conn = [a.connection.mayCall, a.connection.addressSet, a.connection.held > 0].filter(Boolean).length;
  const list = [a.lists.linkedPeople > 0, a.lists.imported > 0, a.lists.listsOn > 0].filter(Boolean).length;
  const agree = agreementState(now);
  const st = (k: number, of: number): QuestState => (k >= of ? "done" : k > 0 ? "active" : "waiting");

  return (
    <section aria-labelledby="sera-bridge-title" className="space-y-4">
      <div className="flex items-center gap-4">
        <LevelRing done={done} of={checks.length} />
        <div>
          <h3 id="sera-bridge-title" className="font-semibold text-gray-900">
            The Sera bridge{allDone ? ": complete" : ""}
          </h3>
          <p className="text-xs text-gray-500">
            {plural(done, "check")} of {checks.length} done. Each check is a fact this village's server reads, never an estimate.
          </p>
        </div>
      </div>
      <div className="text-xs text-gray-600">
        <button
          type="button"
          aria-expanded={showChecks}
          aria-controls="sera-bridge-checks"
          onClick={() => setShowChecks((v) => !v)}
          className="min-h-[44px] inline-flex items-center gap-1 rounded px-1 text-teal-deep underline focus:outline-none focus:ring-2 focus:ring-teal-deep"
        >
          <span aria-hidden="true">{showChecks ? "▾" : "▸"}</span>
          {showChecks ? "Hide the checks" : "See the checks"}
        </button>
        {showChecks && (
          <ul id="sera-bridge-checks" className="mt-1 space-y-0.5">
            {checks.map((c) => (
              <li key={c.id}>
                <span aria-hidden="true">{c.done ? "✓" : "○"}</span> {c.label}
                <span className="sr-only">{c.done ? ": done" : ": not done"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuestCard title="Connection" state={st(conn, 3)} steps={{ done: conn, of: 3 }}>
          <p>Key {a.connection.mayCall ? "set" : "not set"}, address {a.connection.addressSet ? "set" : "not set"}.</p>
          <p>{plural(a.connection.held, "fact")} held.</p>
          <p>
            {a.connection.privacySet
              ? "Privacy connection set: a steward can remove a member's tasks in Sera."
              : "Removing a member's tasks in Sera needs a full-scope connection (not set)."}
          </p>
          {a.connection.tokens?.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer">Which key each act uses</summary>
              <ul className="mt-1 space-y-0.5">
                {a.connection.tokens.map((t) => (
                  <li key={t.act}>
                    {t.act}: {t.uses === "sync" ? "the routine sync key" : t.uses === "privacy" ? "the privacy key" : "the connection key (no separate sync key)"}
                    {t.set ? "" : ", not set"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </QuestCard>

        <QuestCard title="Members' lists from Sera" state={a.lists.ready ? st(list, 3) : "building"} steps={a.lists.ready ? { done: list, of: 3 } : undefined}>
          {a.lists.ready ? (
            <>
              <p>{plural(a.lists.linkedPeople, "member")} linked to Sera, {plural(a.lists.listsOn, "list")} turned on.</p>
              <p>{plural(a.lists.imported, "task")} imported, {a.lists.importedOpen} still open.</p>
              <p>
                {a.lists.lastBatch
                  ? `Last import: ${plural(a.lists.lastBatch.tasks, "task")}, ${villageDate(a.lists.lastBatch.at)}.`
                  : "No import yet. A steward imports from Admin, Players."}
              </p>
            </>
          ) : (
            <p>The list tables are not in this database yet.</p>
          )}
        </QuestCard>

        <QuestCard title="Sync health" state={health.state === "ok" ? "done" : health.state === "never" ? "waiting" : "active"}>
          <p role={health.state === "stale" || health.state === "failed" ? "alert" : undefined}>{syncHealthWords(health)}</p>
          {droppedWords(a.sync ?? null) && <p>{droppedWords(a.sync ?? null)}</p>}
        </QuestCard>

        <QuestCard title="Linked to Sera" state={!a.lists.ready ? "building" : a.lists.people?.length ? "done" : "waiting"}>
          {!a.lists.ready ? (
            <p>The list tables are not in this database yet.</p>
          ) : a.lists.people?.length ? (
            <ul className="space-y-1">
              {a.lists.people.map((p, i) => (
                <li key={i}>
                  <span className="font-semibold">{p.name || "A member"}</span>: list {p.listOn ? "on" : "off"}, {plural(p.imported, "task")} imported,{" "}
                  {p.lastImportAt ? `last import ${villageDate(p.lastImportAt)}` : "no import yet"},{" "}
                  {p.lastSyncedAt ? `last synced ${villageDate(p.lastSyncedAt)}` : "not synced yet"}.
                </li>
              ))}
            </ul>
          ) : (
            <p>Not linked yet. No member is linked to Sera; a steward links one in Admin, Players.</p>
          )}
        </QuestCard>

        <QuestCard title="Member feedback to Sera" state={a.feedback.ready ? (a.feedback.sent > 0 ? "done" : "active") : "building"}>
          {a.feedback.ready ? (
            <>
              <p>
                {a.feedback.sent} sent, {a.feedback.queued} queued, {a.feedback.failed} failed.
              </p>
              <p>
                {a.feedback.membersOff
                  ? `${plural(a.feedback.membersOff, "member")} turned feedback off; nothing of theirs is sent.`
                  : "Every member has feedback on."}
              </p>
              <p>
                {a.feedback.notesReleased
                  ? "Notes are released to Sera."
                  : `Notes held until the agreement: ${a.feedback.notesHeld}.`}
              </p>
            </>
          ) : (
            <p>Being built. Remove and Redirect reasons will be sent from day one; notes are held until the agreement.</p>
          )}
        </QuestCard>

        <QuestCard title="Quest feed" state={a.questFeed?.last ? "done" : "waiting"}>
          {shown ? (
            <p>
              {shown.dryRun ? "Dry run: " : `Last run ${villageDate(shown.at)}: `}
              {shown.read} read, {shown.queued} {shown.dryRun ? "would be queued" : "queued"}, {shown.alreadySeen} already seen,{" "}
              {shown.droppedForEmail} dropped by Sera for an email{shown.refusedHere ? `, ${shown.refusedHere} refused here` : ""}.
              {shown.status !== "ok" && ` (${shown.status}${shown.detail ? `: ${shown.detail}` : ""})`}
            </p>
          ) : (
            <p>No quest feed run yet.</p>
          )}
          {typeof feed === "string" && <p role="alert">{feed}</p>}
          <p>{plural(a.questFeed?.waiting ?? 0, "quest")} from Sera waiting for a steward.</p>
          {onFeed && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={feeding} onClick={() => press(true)} className="min-h-[44px] rounded px-2 text-teal-deep underline focus:outline-none focus:ring-2 focus:ring-teal-deep">
                Dry run
              </button>
              {feed && typeof feed !== "string" && feed.dryRun && feed.status === "ok" && (
                <button type="button" disabled={feeding} onClick={() => press(false)} className="min-h-[44px] rounded px-2 text-teal-deep underline focus:outline-none focus:ring-2 focus:ring-teal-deep">
                  Bring them into review
                </button>
              )}
            </div>
          )}
        </QuestCard>

        <QuestCard title="Review queue" state={a.reviewQueue.waiting > 0 ? "active" : "done"}>
          <p>{a.reviewQueue.waiting > 0 ? `${plural(a.reviewQueue.waiting, "suggestion")} waiting.` : "Nothing waiting."}</p>
          {a.reviewQueue.waiting > 0 && (
            <a href="/review" className="inline-flex items-center min-h-[44px] text-teal-deep underline focus:outline-none focus:ring-2 focus:ring-teal-deep rounded">
              Open the review queue
            </a>
          )}
        </QuestCard>

        <QuestCard title="Needs Owner" state={!a.needsOwner.ready ? "building" : a.needsOwner.waiting > 0 ? "active" : "done"}>
          <p>
            {!a.needsOwner.ready
              ? "The queue is not in this database yet."
              : a.needsOwner.waiting > 0
                ? `${plural(a.needsOwner.waiting, "task")} from Sera waiting for an owner.`
                : "No task is waiting for an owner."}
          </p>
          {!!a.needsOwner.items?.length && (
            <ul className="space-y-0.5">
              {a.needsOwner.items.map((it, i) => (
                <li key={i}>{it.title}{it.role ? `, for ${it.role}` : ""}</li>
              ))}
            </ul>
          )}
        </QuestCard>

        <QuestCard title="Data agreement" state={agree.phase === "before" ? "active" : "done"}>
          <p>
            With {SERA_AGREEMENT.party}, {SERA_AGREEMENT.label}.
          </p>
          <p>{agree.phase === "before" ? `Starts ${countdown(agree.ms)}.` : "The agreed time has passed. Notes release once it is signed."}</p>
        </QuestCard>
      </ul>

      <div className="space-y-2">
        <h4 className="font-semibold text-gray-900 text-sm">Sera tools</h4>
        <p className="text-xs text-gray-500">From Saberra's emails of Nov 2, not read from the service.</p>
        <ToolBadges tools={SERA_TOOLS} />
      </div>
    </section>
  );
}

export default function SaberraBridgeBoard({ password }: { password: string }) {
  const [a, setA] = useState<BridgeAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/saberra/bridge`, { headers: authHeaders(password) })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as BridgeAnswer;
        if (live) setA(body);
      })
      .catch(() => live && setFailed(true));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [password]);

  if (failed) return <p className="text-xs text-amber-800">The bridge board could not be read just now.</p>;
  if (!a) return <p className="text-xs text-gray-500">Reading the bridge…</p>;
  const onFeed = async (dryRun: boolean): Promise<QuestFeedAnswer | string> => {
    try {
      const r = await fetch(`${API_BASE}/saberra/quest-feed`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ dryRun }),
      });
      const body = await r.json().catch(() => ({}));
      return r.ok ? (body as QuestFeedAnswer) : String(body?.error ?? "The quest feed did not run.");
    } catch {
      return "Could not reach the village.";
    }
  };
  return <BridgeView a={a} now={now} onFeed={onFeed} />;
}
