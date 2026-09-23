/**
 * INVITE SOMEBODY, AT THE TOP OF YOUR OWN PROFILE.
 *
 * Rye's ruling, 2026-09-09: "invite members (all members are by invitation)
 * at the top of the profile that creates a special link that lets that new
 * user sign up."
 *
 * ── THE LINK IS SHOWN ONCE ──────────────────────────────────────────────────
 *
 * The server keeps only a hash of the token, so the link made here is the only
 * copy there will ever be. It stays on screen with a button that copies it, and
 * the list below says what became of every link without ever showing one again.
 *
 * ── WHO SEES THE BUTTON ─────────────────────────────────────────────────────
 *
 * Whoever the server's gate would let make one, which `GET /api/me/invites`
 * answers as `mayInvite`. The power catalogue cannot answer it: it leaves out a
 * switched-off module's keys, and the gate never reads a module's switch.
 * Everybody else reads the sentence that says what opens it, because a panel at
 * the top of somebody's own profile that says nothing reads as broken.
 *
 * ── NOTHING WHILE THE ANSWER IS UNKNOWN ─────────────────────────────────────
 *
 * Null draws nothing, the same contract every other read on this page keeps.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { gameFetch } from "@/lib/gameApi";

type Standing = "open" | "used" | "expired" | "revoked";

interface InviteRow {
  id: string;
  standing: Standing;
  daysLeft: number;
  usedBy: { name: string; handle: string | null } | null;
}

export interface InviteList {
  mayInvite: boolean;
  /** Why the button is not offered, when it is not. */
  closed: string | null;
  /** How long a new link lasts. Absent from an older server. */
  days?: number;
  cap: number;
  open: number;
  invites: InviteRow[];
}

const STANDING_WORDS: Record<Standing, string> = {
  open: "Waiting to be used",
  used: "Used",
  expired: "Expired",
  revoked: "Withdrawn",
};

const DID_NOT_SAVE = "That did not save. Try again in a moment.";

export default function InvitePanel() {
  const [list, setList] = useState<InviteList | null>(null);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const load = useCallback(async (): Promise<InviteList | null> => {
    const res = await gameFetch("/api/me/invites");
    if (!res.ok) return null;
    return (await res.json()) as InviteList;
  }, []);

  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (live && d) setList(d);
      })
      .catch(() => {
        /* Unknown draws nothing. */
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (!list) return null;

  /** Ask the server, show its own sentence when it says no, and read the list back when it says yes. */
  const act = async (route: string, onDone: (body: any) => void) => {
    if (busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await gameFetch(route, { method: "POST", body: JSON.stringify({}) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSaid(String(body?.error ?? DID_NOT_SAVE));
        return;
      }
      onDone(body);
      const fresh = await load();
      if (fresh) setList(fresh);
    } catch {
      setSaid(DID_NOT_SAVE);
    } finally {
      setBusy(false);
    }
  };

  const make = () =>
    act("/api/invites", (body) => {
      setCopied(false);
      setLink(`${window.location.origin}${String(body?.path ?? "")}`);
    });

  const withdraw = (id: string) => act(`/api/invites/${encodeURIComponent(id)}/revoke`, () => undefined);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setSaid("Copying did not work here. Select the link and copy it by hand.");
    }
  };

  const days = list.days ?? 14;

  return (
    <section aria-labelledby="invite-heading" className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="invite-heading" className="font-display text-lg font-semibold text-card-foreground">
            Invite somebody
          </h2>
          {list.mayInvite ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Everybody here arrives by invitation. A link lets one person make an account within {days} days, and
                it counts as your vouch for them.
              </p>
              <button
                type="button"
                onClick={make}
                disabled={busy}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {busy ? "Making a link..." : "Make an invitation link"}
              </button>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{list.closed}</p>
          )}

          {link && (
            <div className="mt-4 space-y-2">
              <label htmlFor="invite-link" className="block text-sm font-medium text-card-foreground">
                Your invitation link
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="invite-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                This is the only time this link is shown. Send it to one person.
              </p>
            </div>
          )}

          {said && (
            <p role="alert" className="mt-3 text-sm text-card-foreground">
              {said}
            </p>
          )}

          {list.invites.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-card-foreground">Your invitations</h3>
              <ul className="mt-2 divide-y divide-border">
                {list.invites.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words text-card-foreground">
                      {inv.standing === "used" && inv.usedBy ? (
                        inv.usedBy.handle ? (
                          <a href={`/profile/${encodeURIComponent(inv.usedBy.handle)}`} className="underline underline-offset-2">
                            Used by {inv.usedBy.name}
                          </a>
                        ) : (
                          `Used by ${inv.usedBy.name}`
                        )
                      ) : (
                        STANDING_WORDS[inv.standing]
                      )}
                      {inv.standing === "open" && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {inv.daysLeft} {inv.daysLeft === 1 ? "day" : "days"} left
                        </span>
                      )}
                    </span>
                    {inv.standing === "open" && (
                      <button
                        type="button"
                        onClick={() => withdraw(inv.id)}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center rounded-lg px-3 py-1 text-sm font-medium text-card-foreground underline underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
