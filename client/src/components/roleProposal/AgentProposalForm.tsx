/**
 * PROPOSE AN AGENT FOR THIS ROLE, the member door's agent side (0374; the
 * lead, 11 Nov 2026: humans AND agents can apply for and fill roles). Drawn by
 * `/role-proposals/new?agent=1&role=<id>` (pages/RoleProposal.tsx).
 *
 * An agent never proposes itself: the member who keeps it does, and says so.
 * None of a person's parts are asked here (references, the background check,
 * the confidentiality signature, the character picker, personal details). The
 * form asks what the agent is and how to switch it off, and shows what it can
 * reach, read from its live tokens by the server. The circle decides by
 * consent on the proposal's page, exactly as for a person.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trans, useLingui } from "@lingui/react/macro";
import { BreathingLoader } from "@/components/natural";
import { fetchAgentForm, sendAgentProposal, type AgentFormOut } from "./proposalApi";
import { FOCUS, H2, INPUT, LEDE, PANEL, PRIMARY } from "./parts";

const AREA = `${INPUT} min-h-[96px]`;

export default function AgentProposalForm({ roleId }: { roleId: string }) {
  const { t } = useLingui();
  const [form, setForm] = useState<AgentFormOut | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [role, setRole] = useState(roleId);
  const [keeps, setKeeps] = useState(false);
  const [what, setWhat] = useState("");
  const [switchOff, setSwitchOff] = useState("");
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [sent, setSent] = useState<{ href: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAgentForm().then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoadError(r.error);
      setForm(r.data);
      if (r.data.agents.length === 1) setAgentId(r.data.agents[0].id);
      if (!r.data.roles.some((x) => x.id === roleId)) setRole(r.data.roles[0]?.id ?? "");
    });
    return () => {
      alive = false;
    };
  }, [roleId]);

  if (loadError) return <p role="alert" className={`${PANEL} text-foreground`}>{loadError}</p>;
  if (!form) return <div className="flex justify-center py-16"><BreathingLoader label={t({ message: "Opening the form", context: "agent proposal" })} /></div>;

  if (sent) {
    return (
      <div className={`${PANEL} space-y-3`} role="status" data-testid="agent-proposal-sent">
        <h2 className={H2}><Trans context="agent proposal: sent">Sent to the circle</Trans></h2>
        <p className={LEDE}>{sent.message}</p>
        <Link href={sent.href} className={`w-fit ${PRIMARY}`}><Trans context="agent proposal: sent">See where it stands</Trans></Link>
      </div>
    );
  }

  const agent = form.agents.find((a) => a.id === agentId) ?? null;
  const keeperName = form.keeper.name;
  const roleRow = form.roles.find((r) => r.id === role) ?? null;
  const fieldError = (f: string) => (error?.field === f ? <p role="alert" className="mt-1 text-sm font-medium text-destructive">{error.text}</p> : null);

  async function send() {
    setSending(true);
    setError(null);
    const r = await sendAgentProposal({ agentUserId: agentId, keeper: keeps, what, switchOff, why, aim: "", roles: role ? [{ roleId: role, note }] : [] });
    setSending(false);
    if (!r.ok) return setError({ text: r.error, field: r.field });
    setSent({ href: r.data.href, message: r.data.message });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      data-testid="agent-proposal-form"
    >
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-foreground"><Trans context="agent proposal: title">Propose an agent for this role</Trans></h1>
        <p className={LEDE}>
          <Trans context="agent proposal: intro">An agent never proposes itself. You propose it on its behalf, as the member who keeps it, and the circle decides by consent, the way it does for a person.</Trans>
        </p>
        {form.message && <p role="status" className={LEDE}>{form.message}</p>}
      </header>

      <section className={`${PANEL} space-y-3`} aria-labelledby="ap-role">
        <h2 id="ap-role" className={H2}><Trans context="agent proposal">The role</Trans></h2>
        {form.roles.length === 0 ? (
          <p className={LEDE}><Trans context="agent proposal">No role is open to an agent right now.</Trans></p>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium"><Trans context="agent proposal">Role</Trans></span>
            <select className={INPUT} value={role} onChange={(e) => setRole(e.target.value)}>
              {form.roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.circle})</option>)}
            </select>
          </label>
        )}
        {roleRow?.aim && <p className={LEDE}>{roleRow.aim}</p>}
        {fieldError("roles")}
      </section>

      <section className={`${PANEL} space-y-3`} aria-labelledby="ap-agent">
        <h2 id="ap-agent" className={H2}><Trans context="agent proposal">The agent</Trans></h2>
        {form.noAgents ? (
          <p className={LEDE}>{form.noAgents}</p>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium"><Trans context="agent proposal">Which agent</Trans></span>
            <select className={INPUT} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">{t({ message: "Pick the agent", context: "agent proposal" })}</option>
              {form.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {fieldError("agent")}
        {agent && (
          <div className="rounded-lg border border-border bg-muted p-3" data-testid="agent-reach">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Trans context="agent proposal">What it can reach</Trans></p>
            {agent.reach.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {agent.reach.map((x) => <li key={x.scope}>{x.words}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm"><Trans context="agent proposal">It holds no live access token, so it reaches nothing through the village's connector today.</Trans></p>
            )}
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium"><Trans context="agent proposal">What it is</Trans></span>
          <textarea className={AREA} value={what} onChange={(e) => setWhat(e.target.value)} maxLength={600} />
        </label>
        {fieldError("what")}
        <label className="block space-y-1">
          <span className="text-sm font-medium"><Trans context="agent proposal">How to switch it off</Trans></span>
          <textarea className={AREA} value={switchOff} onChange={(e) => setSwitchOff(e.target.value)} maxLength={600} />
        </label>
        <p className="text-xs text-muted-foreground">{form.switchOffPlatform}</p>
        {fieldError("switchOff")}
      </section>

      <section className={`${PANEL} space-y-3`} aria-labelledby="ap-why">
        <h2 id="ap-why" className={H2}><Trans context="agent proposal">Why this agent</Trans></h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium"><Trans context="agent proposal">Why it suits the role</Trans></span>
          <textarea className={AREA} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1200} />
        </label>
        {fieldError("why")}
        <label className="block space-y-1">
          <span className="text-sm font-medium"><Trans context="agent proposal">What it brings to the role (optional)</Trans></span>
          <textarea className={AREA} value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
        </label>
      </section>

      <section className={`${PANEL} space-y-2`} aria-labelledby="ap-keeper">
        <h2 id="ap-keeper" className={H2}><Trans context="agent proposal">Who keeps it</Trans></h2>
        <label className="flex min-h-[44px] items-start gap-2">
          <input type="checkbox" className={`mt-1 size-5 accent-dash-gold ${FOCUS}`} checked={keeps} onChange={(e) => setKeeps(e.target.checked)} />
          <span>
            <Trans context="agent proposal">I keep this agent, {keeperName}: I am responsible for what it does in this role, and I can switch it off.</Trans>
          </span>
        </label>
        {fieldError("keeper")}
      </section>

      {error && !["roles", "agent", "what", "switchOff", "why", "keeper"].includes(error.field ?? "") && <p role="alert" className="text-sm font-medium text-destructive">{error.text}</p>}
      <button type="submit" className={PRIMARY} disabled={sending || !form.roles.length || !!form.noAgents}>
        {sending ? t({ message: "Sending", context: "agent proposal" }) : t({ message: "Send to the circle", context: "agent proposal" })}
      </button>
    </form>
  );
}
