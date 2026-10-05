/**
 * PEOPLE, in the Comms section of Admin (the comms build spec 5.3 and 6).
 *
 * Everybody the village writes to: search the address book, open a person,
 * and see what they agreed to receive and on what grounds, whether email to
 * them is stopped and why, every email they were sent with what became of it,
 * and the journeys they are on, each with a Stop button. A person here can
 * stop all email to an address and lift a stop; lifting a stop that came from
 * a spam complaint asks for the reason, and the reason is kept in the
 * village's admin record. The whole address book downloads as a CSV.
 *
 * Reads `/api/admin/comms/people*` (server/routes/commsPeople.ts), which ask
 * the one capability gate for `comms.manage`.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import type { MessageStatus, PermissionBasis, PermissionKind, SkipReason, SuppressionReason } from "@shared/comms/kinds";
import { KIND_WORDS } from "@shared/comms/preferences";
import { API_BASE, authHeaders, refusal } from "../adminApi";

interface PersonRow {
  id: string;
  email: string;
  name: string | null;
  userId: string | null;
  firstSource: string;
  createdAt: number;
  messages: number;
  lastMessageAt: number | null;
  suppression: string | null;
}

interface Answer {
  kind: PermissionKind;
  state: "yes" | "no";
  derived: boolean;
  basis: PermissionBasis | null;
  source: string | null;
  pausedUntil: string | null;
}

interface Email {
  id: string;
  kind: string;
  origin: string;
  subject: string;
  status: string;
  skipReason: string | null;
  lastError: string | null;
  createdAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
}

interface Journey {
  id: string;
  journeyKey: string;
  subjectRef: string;
  state: string;
  stopReason: string | null;
  enrolledAt: number;
}

interface PersonDetail {
  person: { id: string; email: string; name: string | null; userId: string | null; firstSource: string; timezone: string | null; createdAt: number };
  member: { id: string; name: string } | null;
  answers: Answer[];
  suppression: { reason: string; detail: string | null; createdBy: string | null; createdAt: number } | null;
  emails: Email[];
  journeys: Journey[];
}

const PAGE = 50;

const STATUS_WORDS: Record<MessageStatus, string> = {
  queued: "Waiting to send",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  skipped: "Not sent",
  expired: "Too late, not sent",
  rehearsed: "Went to the rehearsal inbox",
  cancelled: "Cancelled",
};

const SKIP_WORDS: Record<SkipReason, string> = {
  no_permission: "no yes on record",
  suppressed: "address stopped",
  over_cap: "over the daily limit",
  paused: "the village paused email",
  module_off: "comms is off",
  not_configured: "sending is not set up",
  bad_address: "the address cannot receive email",
  expired: "too late to send",
  duplicate: "already sent once",
};

const SUPPRESSION_WORDS: Record<SuppressionReason, string> = {
  bounced: "Bounced",
  complained: "Marked our email as spam",
  unsubscribed_all: "Asked to stop everything",
  manual: "Stopped by a person here",
  erased: "Erased",
};

const BASIS_WORDS: Record<PermissionBasis, string> = {
  asked: "they said so",
  implied: "follows from something they did",
  account: "from their account",
  imported: "brought in with a list",
};

const words = <T extends string>(table: Record<T, string>, key: string | null | undefined, fallback = ""): string =>
  key && key in table ? table[key as T] : key ?? fallback;

const day = (epochSeconds: number | null | undefined): string =>
  epochSeconds ? new Date(epochSeconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const when = (epochSeconds: number | null | undefined): string =>
  epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

export default function CommsPeople({ password }: { password: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreReason, setRestoreReason] = useState("");
  const [stopNote, setStopNote] = useState("");

  const loadList = useCallback(async () => {
    setListError("");
    try {
      const params = new URLSearchParams({ q: search, offset: String(offset), limit: String(PAGE) });
      const res = await fetch(`${API_BASE}/admin/comms/people?${params}`, { headers: authHeaders(password) });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(refusal(d, "The address book could not be read."));
      setRows(d.people ?? []);
      setTotal(Number(d.total ?? 0));
    } catch (e: any) {
      setRows(null);
      setListError(e?.message || "The address book could not be read.");
    }
  }, [password, search, offset]);

  const loadPerson = useCallback(
    async (id: string) => {
      setDetailError("");
      try {
        const res = await fetch(`${API_BASE}/admin/comms/people/${encodeURIComponent(id)}`, { headers: authHeaders(password) });
        const d = await res.json().catch(() => null);
        if (!res.ok) throw new Error(refusal(d, "That person could not be read."));
        setDetail(d);
      } catch (e: any) {
        setDetail(null);
        setDetailError(e?.message || "That person could not be read.");
      }
    },
    [password],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (openId) void loadPerson(openId);
  }, [openId, loadPerson]);

  /**
   * One write, then both views read again, so the screen shows what the
   * village holds. Each caller names its whole route, so
   * scripts/check-admin-reach.mjs can see the door to every write.
   */
  const act = async (url: string, body: Record<string, unknown>, done: string) => {
    if (!openId) return;
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(refusal(d, "That did not save."));
      setNote(done);
      setRestoreReason("");
      setStopNote("");
    } catch (e: any) {
      setNote(`${e?.message || "That did not save."} Nothing changed.`);
    } finally {
      setBusy(false);
      await Promise.all([loadPerson(openId), loadList()]);
    }
  };

  const downloadCsv = async () => {
    setListError("");
    try {
      const res = await fetch(`${API_BASE}/admin/comms/people-export`, { headers: authHeaders(password) });
      if (!res.ok) throw new Error(refusal(await res.json().catch(() => null), "The CSV could not be built."));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "people.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setListError(e?.message || "The CSV could not be built.");
    }
  };

  const held = detail?.suppression ?? null;
  const complained = held?.reason === "complained";
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">People</h2>
        <p className="text-sm text-gray-500 mt-1">
          Everybody the village writes to, what each person agreed to receive, and every email they were sent.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setSearch(q.trim());
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search by address or name"
          placeholder="Search by address or name"
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
        />
        <button type="submit" className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium">
          Search
        </button>
        <button type="button" onClick={() => void downloadCsv()} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700">
          Download CSV
        </button>
      </form>

      {listError && (
        <p role="alert" className="text-sm text-red-700">
          {listError}
        </p>
      )}

      {rows && rows.length === 0 && !listError && (
        <p className="text-sm text-gray-500">{search ? "Nobody matches that search." : "Nobody is in the address book yet."}</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">First met</th>
                <th className="px-3 py-2 font-medium">Emails</th>
                <th className="px-3 py-2 font-medium">Stopped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-gray-100 ${openId === r.id ? "bg-gray-50" : ""}`}>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left text-gray-900 underline underline-offset-2" onClick={() => setOpenId(r.id)}>
                      {r.email}
                    </button>
                    {r.userId && <span className="ml-2 text-xs text-gray-500">member</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.name ?? ""}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {r.firstSource}, {day(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.messages}</td>
                  <td className="px-3 py-2 text-gray-700">{r.suppression ? words(SUPPRESSION_WORDS, r.suppression) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>
              {offset + 1} to {offset + rows.length} of {total}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40">
                Previous
              </button>
              <button type="button" disabled={offset + rows.length >= total} onClick={() => setOffset(offset + PAGE)} className="px-2 py-1 border border-gray-300 rounded disabled:opacity-40">
                Next
              </button>
            </span>
          </div>
        </div>
      )}

      {detailError && (
        <p role="alert" className="text-sm text-red-700">
          {detailError}
        </p>
      )}

      {detail && (
        <section aria-label="Person" className="border border-gray-200 rounded-xl bg-white p-4 space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{detail.person.email}</h3>
            <p className="text-sm text-gray-500">
              {detail.person.name ? `${detail.person.name}. ` : ""}
              {detail.member ? `Member: ${detail.member.name}. ` : "No account. "}
              First met through {detail.person.firstSource} on {day(detail.person.createdAt)}.
              {detail.person.timezone ? ` Their time zone is ${detail.person.timezone}.` : ""}
            </p>
          </div>

          {note && (
            <p role="status" className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2">
              {note}
            </p>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Email to this address</h4>
            {held ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  Stopped: {words(SUPPRESSION_WORDS, held.reason)}, since {day(held.createdAt)}.
                  {held.detail ? ` Note: ${held.detail}` : ""}
                </p>
                {complained && (
                  <label className="block text-sm text-gray-700">
                    Why is it right to write to this address again?
                    <textarea
                      value={restoreReason}
                      onChange={(e) => setRestoreReason(e.target.value)}
                      rows={2}
                      maxLength={400}
                      className="mt-1 block w-full border border-gray-300 rounded-lg p-2 text-sm bg-white text-gray-900"
                    />
                  </label>
                )}
                <button
                  type="button"
                  disabled={busy || (complained && !restoreReason.trim())}
                  onClick={() =>
                    void act(
                      `${API_BASE}/admin/comms/people/${encodeURIComponent(detail.person.id)}/restore`,
                      { reason: restoreReason.trim() },
                      "Email to this address can go again.",
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-800 disabled:opacity-40"
                >
                  Lift the stop
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">Email can go to this address. Essential mail always goes.</p>
                <label className="block text-sm text-gray-700">
                  A note on why (optional)
                  <input
                    value={stopNote}
                    onChange={(e) => setStopNote(e.target.value)}
                    maxLength={500}
                    className="mt-1 block w-full border border-gray-300 rounded-lg p-2 text-sm bg-white text-gray-900"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      `${API_BASE}/admin/comms/people/${encodeURIComponent(detail.person.id)}/suppress`,
                      { detail: stopNote.trim() },
                      "Email to this address is stopped, except essential mail.",
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-sm text-red-700 disabled:opacity-40"
                >
                  Stop all email to this address
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">What they agreed to</h4>
            <table className="w-full text-sm">
              <tbody>
                {detail.answers.map((a) => (
                  <tr key={a.kind} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-800">{KIND_WORDS[a.kind].label}</td>
                    <td className="py-1.5 pr-3 font-medium text-gray-900">{a.state === "yes" ? "Yes" : "No"}</td>
                    <td className="py-1.5 text-gray-500">
                      {a.basis ? words(BASIS_WORDS, a.basis) : "nothing said yet"}
                      {a.source ? `, ${a.source}` : ""}
                      {a.pausedUntil ? `. Paused until ${new Date(a.pausedUntil).toLocaleDateString()}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Journeys</h4>
            {detail.journeys.length === 0 ? (
              <p className="text-sm text-gray-500">On no journey.</p>
            ) : (
              <ul className="space-y-1">
                {detail.journeys.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                    <span className="font-medium text-gray-900">{j.journeyKey}</span>
                    <span className="text-gray-500">
                      {j.subjectRef}, since {day(j.enrolledAt)}, {j.state === "active" ? "on it" : `stopped (${j.stopReason ?? j.state})`}
                    </span>
                    {j.state === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `${API_BASE}/admin/comms/people/${encodeURIComponent(detail.person.id)}/journeys/${encodeURIComponent(j.id)}/stop`,
                            {},
                            "That journey is stopped for this person.",
                          )
                        }
                        className="px-2 py-0.5 rounded border border-gray-300 bg-white text-xs text-gray-800 disabled:opacity-40"
                      >
                        Stop
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Every email</h4>
            {detail.emails.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing has been written to this address yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-600">
                    <tr>
                      <th className="py-1 pr-3 font-medium">When</th>
                      <th className="py-1 pr-3 font-medium">Subject</th>
                      <th className="py-1 pr-3 font-medium">Kind</th>
                      <th className="py-1 font-medium">What became of it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.emails.map((m) => (
                      <tr key={m.id} className="border-t border-gray-100 align-top">
                        <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{when(m.createdAt)}</td>
                        <td className="py-1.5 pr-3 text-gray-900">{m.subject}</td>
                        <td className="py-1.5 pr-3 text-gray-500">
                          {m.kind}, {m.origin}
                        </td>
                        <td className="py-1.5 text-gray-700">
                          {words(STATUS_WORDS, m.status)}
                          {m.skipReason ? `: ${words(SKIP_WORDS, m.skipReason)}` : ""}
                          {m.lastError ? ` (${m.lastError})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
