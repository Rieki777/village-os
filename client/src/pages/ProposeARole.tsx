/**
 * PROPOSE A ROLE, WITHOUT AN ACCOUNT (Rye, 2026-10-30; sheet 19i).
 *
 *   /propose-a-role                 the village's public link
 *   /propose-a-role/<token>         a link made for one person
 *   /propose-a-role/confirm?token=  the link in the confirmation email
 *
 * `?role=<id>` ticks that role when it is on offer: a circle card's Apply link
 * for a visitor or a guest lands here with it (shared/circleCard.ts). A guest
 * who is signed in finds their name and address filled in.
 *
 * Next season's roles, grouped by circle. The person picks up to three, says
 * what they bring to each and why, and gives their name and address. Sending
 * asks the address to confirm; nothing reaches the village until it does
 * (server/routes/openProposals.ts). The words are shared/openProposals.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { ArrowRight, MailCheck } from "lucide-react";
import Layout from "@/components/Layout";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { OPEN_AIM_MAX, OPEN_NOTE_MAX, OPEN_PROPOSAL_MAX_ROLES, OPEN_WHY_MAX, OPEN_WORDS } from "@shared/openProposals";

const FIELD =
  "w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

interface FormRole {
  id: string;
  name: string;
  circle: string;
  aim: string | null;
}

type FormState =
  | { kind: "loading" }
  | { kind: "closed"; message: string }
  | { kind: "open"; village: string; season: { id: string; name: string | null; startsOn: string } | null; roles: FormRole[] }
  | { kind: "failed" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <div className="min-h-screen bg-background py-16">
        <div className="container max-w-2xl">{children}</div>
      </div>
    </Layout>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-live="polite" className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <MailCheck className="h-8 w-8 text-notice" aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1} className="mt-4 font-display text-3xl font-bold text-card-foreground outline-none">
        {title}
      </h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}

/** The link in the confirmation email. */
export function ConfirmProposal() {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    fetch("/api/open-proposals/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        setSaid({ ok: r.ok, message: typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : OPEN_WORDS.confirmGone });
      })
      .catch(() => setSaid({ ok: false, message: OPEN_WORDS.confirmGone }));
  }, []);
  return (
    <Shell>
      {said ? (
        <Notice title={said.ok ? "Confirmed" : "That link didn't work"}>
          <p>{said.message}</p>
          {!said.ok && (
            <a href="/propose-a-role" className={`${BUTTON} mt-6`}>
              Propose again
            </a>
          )}
        </Notice>
      ) : (
        <p role="status" className="text-muted-foreground">
          Confirming...
        </p>
      )}
    </Shell>
  );
}

export default function ProposeARole() {
  const params = useParams<{ token?: string }>();
  const link = params.token ? decodeURIComponent(params.token) : "";
  const [form, setForm] = useState<FormState>({ kind: "loading" });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [why, setWhy] = useState("");
  const [aim, setAim] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const me = useOptionalAuth()?.user ?? null;

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("role") ?? "";
    fetch(`/api/open-proposals/form${link ? `?link=${encodeURIComponent(link)}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const roles: FormRole[] = Array.isArray(d?.roles) ? d.roles : [];
        setForm(d?.open ? { kind: "open", village: String(d.village ?? ""), season: d.season ?? null, roles } : { kind: "closed", message: String(d?.message ?? OPEN_WORDS.closed) });
        // The role the Apply link was for, ticked, when the village still offers it.
        if (d?.open && wanted && roles.some((r) => r.id === wanted)) setPicked((p) => (Object.keys(p).length ? p : { [wanted]: "" }));
      })
      .catch(() => setForm({ kind: "failed" }));
  }, [link]);

  // A guest who is signed in: their own name and address, which they can still change.
  useEffect(() => {
    if (!me) return;
    setName((n) => n || String(me.name ?? ""));
    setEmail((e) => e || String(me.email ?? ""));
  }, [me]);

  const circles = useMemo(() => {
    const by = new Map<string, FormRole[]>();
    if (form.kind === "open") for (const r of form.roles) by.set(r.circle, [...(by.get(r.circle) ?? []), r]);
    return Array.from(by.entries());
  }, [form]);

  const count = Object.keys(picked).length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = { ...p };
      if (id in next) delete next[id];
      else if (Object.keys(next).length < OPEN_PROPOSAL_MAX_ROLES) next[id] = "";
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/open-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, why, aim, hp, link: link || undefined, roles: Object.entries(picked).map(([roleId, note]) => ({ roleId, note })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError({ field: typeof data?.field === "string" ? data.field : null, message: typeof data?.error === "string" ? data.error : OPEN_WORDS.notSent });
      setSent(typeof data?.message === "string" ? data.message : OPEN_WORDS.sent(email.trim()));
    } catch {
      setError({ field: null, message: OPEN_WORDS.notSent });
    } finally {
      setSending(false);
    }
  };

  if (form.kind === "loading") {
    return (
      <Shell>
        <p role="status" className="text-muted-foreground">
          Loading...
        </p>
      </Shell>
    );
  }
  if (form.kind === "failed") {
    return (
      <Shell>
        <p role="alert" className="text-foreground">
          This page didn't load. Check your connection and try again.
        </p>
      </Shell>
    );
  }
  if (form.kind === "closed") {
    return (
      <Shell>
        <Notice title="Not open right now">
          <p>{form.message}</p>
        </Notice>
      </Shell>
    );
  }
  if (sent) {
    return (
      <Shell>
        <Notice title="Check your email">
          <p>{sent}</p>
        </Notice>
      </Shell>
    );
  }

  const seasonName = form.season?.name || "next season";
  const invalid = (field: string) => (error?.field === field ? { "aria-invalid": true, "aria-describedby": "propose-error" } : {});

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold text-foreground">{OPEN_WORDS.heading(form.village)}</h1>
        <p className="mt-3 text-muted-foreground">{form.season ? OPEN_WORDS.lede(seasonName) : OPEN_WORDS.noSeason}</p>
      </div>

      {form.season && (
        <form onSubmit={submit} className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm" data-open-proposal="">
          {error && (
            <p id="propose-error" role="alert" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
              {error.message}
            </p>
          )}

          <fieldset className="space-y-4" {...invalid("roles")}>
            <legend className="mb-2 text-sm font-semibold text-card-foreground">
              {OPEN_WORDS.pickRoles} <span className="font-normal text-muted-foreground">({count} of {OPEN_PROPOSAL_MAX_ROLES})</span>
            </legend>
            {circles.map(([circle, roles]) => (
              <div key={circle} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{circle}</h2>
                {roles.map((r) => {
                  const on = r.id in picked;
                  return (
                    <div key={r.id} className={`rounded-xl border p-4 ${on ? "border-primary bg-primary/5" : "border-border"}`} data-role={r.id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-primary"
                          checked={on}
                          disabled={!on && count >= OPEN_PROPOSAL_MAX_ROLES}
                          onChange={() => toggle(r.id)}
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className="break-words font-semibold text-card-foreground">{r.name}</span>
                          {r.aim && <span className="break-words text-sm text-muted-foreground">{r.aim}</span>}
                        </span>
                      </label>
                      {on && (
                        <label className="mt-3 grid gap-1 text-sm font-medium text-card-foreground">
                          {OPEN_WORDS.noteLabel} <span className="font-normal text-muted-foreground">(optional)</span>
                          <textarea
                            rows={3}
                            maxLength={OPEN_NOTE_MAX}
                            value={picked[r.id]}
                            onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.value }))}
                            className={FIELD}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </fieldset>

          <div>
            <label htmlFor="propose-why" className="mb-2 block text-sm font-semibold text-card-foreground">
              {OPEN_WORDS.whyLabel}
            </label>
            <textarea id="propose-why" required rows={5} maxLength={OPEN_WHY_MAX} value={why} onChange={(e) => setWhy(e.target.value)} className={FIELD} {...invalid("why")} />
          </div>
          <div>
            <label htmlFor="propose-aim" className="mb-2 block text-sm font-semibold text-card-foreground">
              {OPEN_WORDS.aimLabel}
            </label>
            <input id="propose-aim" maxLength={OPEN_AIM_MAX} value={aim} onChange={(e) => setAim(e.target.value)} className={FIELD} {...invalid("aim")} />
          </div>
          <div>
            <label htmlFor="propose-name" className="mb-2 block text-sm font-semibold text-card-foreground">
              {OPEN_WORDS.nameLabel}
            </label>
            <input id="propose-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={FIELD} {...invalid("name")} />
          </div>
          <div>
            <label htmlFor="propose-email" className="mb-2 block text-sm font-semibold text-card-foreground">
              {OPEN_WORDS.emailLabel}
            </label>
            <input id="propose-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} {...invalid("email")} />
            <p className="mt-2 text-sm text-muted-foreground">{OPEN_WORDS.emailNote}</p>
          </div>
          {/* The honeypot. Named `hp` so no autofill heuristic fills it; see ReserveHome.tsx. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
            <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>
          <button type="submit" disabled={sending || count === 0} className={`${BUTTON} w-full`}>
            {sending ? "Sending..." : OPEN_WORDS.send}
            {!sending && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
          </button>
        </form>
      )}
    </Shell>
  );
}
