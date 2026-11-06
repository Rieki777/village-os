/**
 * LINK TO SERA, BY HAND, on the Saberra module card (end-of-moon spec,
 * section 18). A steward pastes the owner id the library gave them for a
 * member; nothing is imported, and the member's library tasks reach their
 * board at the next sync. Owner ids come back only as a six-character tail.
 *
 * Every word is in `@shared/seraPersonLinks`. Lazy-loaded by
 * `SaberraConfigPanel.tsx`. Light-only, like the rest of this folder.
 */
import { useEffect, useMemo, useState } from "react";
import { LINK_HOW_WORDS, LINK_WORDS, seraOwnerIdProblem, type LinksResponse, type MemberLinkRow } from "@shared/seraPersonLinks";
import { MATCH_WORDS, type BackfillCounts } from "@shared/seraPersonMatch";
import { API_BASE, authHeaders } from "./adminApi";
import { villageTime } from "@shared/seraBridgeBoard";

// The same clock as the Sera board: village time, zone named when it is not the viewer's.
const when = (iso: string | null): string => villageTime(iso, LINK_WORDS.never);

function Row({ m, password, onDone }: { m: MemberLinkRow; password: string; onDone: (members: MemberLinkRow[], message: string) => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (method: "PUT" | "DELETE") => {
    if (method === "PUT") {
      const problem = seraOwnerIdProblem(id);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/saberra/links/${encodeURIComponent(m.userId)}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: method === "PUT" ? JSON.stringify({ seraOwnerId: id.trim() }) : undefined,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) setError(String(body?.error ?? "That did not work."));
      else {
        setId("");
        onDone(body.members as MemberLinkRow[], String(body.message ?? ""));
      }
    } catch {
      setError("Could not reach the village.");
    }
    setBusy(false);
  };

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-sm text-gray-900">{m.name}</span>
        <span className="text-xs text-gray-500">
          {m.how ? `${LINK_HOW_WORDS[m.how]} · …${m.ownerTail} · ${LINK_WORDS.lastSync}: ${when(m.lastSyncedAt)}` : LINK_WORDS.notLinked}
        </span>
      </div>
      {m.review && <p className="text-xs text-amber-800">{MATCH_WORDS[m.review.outcome]}</p>}
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`sera-owner-${m.userId}`}>Sera owner id for {m.name}</label>
        <input
          id={`sera-owner-${m.userId}`}
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Sera owner id"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <button type="button" disabled={busy || !id.trim()} onClick={() => send("PUT")} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {m.how ? LINK_WORDS.relink : LINK_WORDS.link}
        </button>
        {m.how && (
          <button type="button" disabled={busy} onClick={() => send("DELETE")} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 disabled:opacity-40">
            {LINK_WORDS.unlink}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-amber-800">{error}</p>}
    </li>
  );
}

export default function SeraLinkPanel({ password }: { password: string }) {
  const [members, setMembers] = useState<MemberLinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/saberra/links`, { headers: authHeaders(password) })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as LinksResponse;
        if (live) setMembers(body.members);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [password]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (members ?? []).filter((m) => !f || m.name.toLowerCase().includes(f));
  }, [members, filter]);
  const linked = (members ?? []).filter((m) => m.how).length;
  const waiting = (members ?? []).filter((m) => m.review).length;
  const [counts, setCounts] = useState<BackfillCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [matchError, setMatchError] = useState("");
  const runMatch = async (dryRun: boolean) => {
    setBusy(true);
    setMatchError("");
    try {
      const r = await fetch(`${API_BASE}/saberra/person-match/backfill`, {
        method: "POST",
        headers: { ...authHeaders(password), "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as BackfillCounts & { members: MemberLinkRow[] };
      setCounts(body);
      setMembers(body.members);
    } catch {
      setMessage("");
      setMatchError("The match did not run just now. Check your connection, then press the button again.");
    }
    setBusy(false);
  };

  if (failed) return <p aria-live="polite" className="text-xs text-amber-800">The links to Sera could not be read just now. Reload the page to try again.</p>;
  if (!members) return <p className="text-xs text-gray-500">Reading the Sera links…</p>;

  return (
    <section aria-labelledby="sera-link-title" className="space-y-3">
      <div className="space-y-1">
        <h3 id="sera-link-title" className="text-sm font-semibold text-gray-900">{LINK_WORDS.title}</h3>
        <p className="text-xs text-gray-500">{LINK_WORDS.intro}</p>
        <p className="text-xs text-gray-500">{linked} of {members.length} members linked{waiting ? `, ${waiting} waiting for a steward` : ""}.</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-gray-500">Match members already here by a keyed hash of their verified email. Only the hash goes to Sera. Count first; nothing is sent until you press Match now.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => runMatch(true)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs">Count who would be matched</button>
          {counts?.dryRun && !counts.note && counts.candidates > 0 && (
            <button type="button" disabled={busy} onClick={() => runMatch(false)} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white">Match now ({counts.candidates})</button>
          )}
        </div>
        {matchError && <p role="alert" className="text-xs text-amber-800">{matchError}</p>}
        {counts && (
          <p className="text-xs text-gray-700" role="status">
            {counts.note
              ? `${counts.candidates} member${counts.candidates === 1 ? "" : "s"} with a verified email and no link. ${counts.note}`
              : counts.dryRun
                ? `${counts.candidates} member${counts.candidates === 1 ? "" : "s"} with a verified email and no link. Nothing sent yet.`
                : `Linked ${counts.linked}, ${counts.review} waiting for a steward, ${counts.failed} did not get an answer.`}
          </p>
        )}
      </div>
      <label className="sr-only" htmlFor="sera-link-filter">Find a member</label>
      <input
        id="sera-link-filter"
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a member"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
      />
      <p aria-live="polite" className="text-xs text-emerald-800 min-h-4">{message}</p>
      <ul className="divide-y divide-gray-100">
        {shown.map((m) => (
          <Row
            key={m.userId}
            m={m}
            password={password}
            onDone={(next, msg) => {
              setMembers(next);
              setMessage(msg);
            }}
          />
        ))}
      </ul>
    </section>
  );
}
