/**
 * Your agent (round 4, lane L6): the one Profile section where a member
 * connects their own agent to the village.
 *
 * Five parts. Bring your agent (personal access tokens, setup cards, the
 * skills, an agent inbox URL). Run the assistant on your key (the member's own
 * LLM key, encrypted at rest, last4 only ever comes back). About me for my
 * agent (a note with a privacy tier and the consent sentence). What the
 * assistant has said about you (every sentence, its source, correct or
 * withdraw). Drafts waiting for your yes (RSVPs the assistant proposed).
 *
 * Every call goes through gameFetch. Nothing here stores a token, a key or a
 * secret anywhere but the state that shows it once; the panel is the only
 * place a member ever sees the value, and closing the reveal is the end of it.
 */
import { useEffect, useState } from "react";
import { Bot, Copy, KeyRound, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";

type Setup = {
  origin: string;
  skillsUrl: string;
  openapiUrl: string;
  tokenEnvVar: string;
  scopes: string[];
  readScopes: string[];
  intentsOpen: boolean;
  memberSecrets: boolean;
  memberSecretsSentence: string;
  providers: string[];
  signatureHeader: string;
};

type TokenRow = {
  id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null;
  expiresAt: string; revokedAt: string | null; live: boolean;
};

type Inbox = { id: string; url: string; enabled: boolean; consecutiveFailures: number; disabledReason: string | null; lastDeliveryAt: string | null; lastStatus: string | null } | null;
type Delivery = { id: string; kind: string; attempts: number; deliveredAt: string | null; droppedAt: string | null; lastError: string | null; createdAt: string };
type KeyView = { provider: string; last4: string; baseUrl: string | null; model: string | null; setAt: string } | null;
type Profile = { aboutMe: string; aboutTier: "private" | "assistant" | "members"; matchingConsent: boolean };
type Statement = { id: string; text: string; sources: string[]; status: string; correction: string | null; createdAt: string };
type Draft = { id: string; kind: string; payload: { eventId: string; status: string }; source: string; status: string; createdAt: string; event: { id: string; title: string; startsAt: string; status: string } | null };

const SCOPE_WORDS: Record<string, string> = {
  "calendar.read": "read the calendar",
  "directory.read": "read circles, roles and the people you may already see",
  "me.read": "read your own profile and your RSVPs",
  "rsvp.write": "answer a gathering, after your yes",
  "intents.write": "post what you seek or offer, after your yes",
};

const TIER_WORDS: Record<Profile["aboutTier"], string> = {
  private: "Private: nobody reads it, not even the assistant",
  assistant: "Assistant: the in-app assistant may read it when you ask it something",
  members: "Members: other members' agents may read it through the directory",
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "");

async function json<T>(res: Response): Promise<{ ok: boolean; status: number; data: T | any }> {
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-muted/60 p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-card-foreground mb-3">{icon}{title}</h3>
      {children}
    </section>
  );
}

function CopyLine({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 min-w-0 break-all rounded-lg bg-card border border-border px-3 py-2 text-xs text-card-foreground">{value}</code>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-2 text-xs text-card-foreground hover:bg-muted"
        aria-label="Copy"
      >
        <Copy className="w-3.5 h-3.5" />{done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function YourAgentPanel() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");

  // Tokens
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState<string[]>([]);
  const [minting, setMinting] = useState(false);
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const [card, setCard] = useState<"claude" | "hermes" | "openclaw" | "curl">("claude");

  // Inbox
  const [inbox, setInbox] = useState<Inbox>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [inboxUrl, setInboxUrl] = useState("");
  const [inboxSecret, setInboxSecret] = useState("");
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxNote, setInboxNote] = useState("");

  // Key
  const [keyView, setKeyView] = useState<KeyView>(null);
  const [provider, setProvider] = useState("anthropic");
  const [keyValue, setKeyValue] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNote, setKeyNote] = useState("");

  // Profile
  const [profile, setProfile] = useState<Profile>({ aboutMe: "", aboutTier: "private", matchingConsent: false });
  const [consentSentence, setConsentSentence] = useState("");
  const [profileNote, setProfileNote] = useState("");

  // Statements and drafts
  const [statements, setStatements] = useState<Statement[]>([]);
  const [correcting, setCorrecting] = useState<{ id: string; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const load = async () => {
    try {
      const [s, t, i, k, p, st, d] = await Promise.all([
        gameFetch("/api/agent/setup").then(json<Setup>),
        gameFetch("/api/agent/tokens").then(json<{ tokens: TokenRow[] }>),
        gameFetch("/api/agent/inbox").then(json<{ inbox: Inbox; deliveries: Delivery[] }>),
        gameFetch("/api/agent/key").then(json<{ key: KeyView }>),
        gameFetch("/api/agent/profile").then(json<{ profile: Profile; consentSentence: string }>),
        gameFetch("/api/agent/statements").then(json<{ statements: Statement[] }>),
        gameFetch("/api/agent/drafts").then(json<{ drafts: Draft[] }>),
      ]);
      if (s.ok) { setSetup(s.data); setTokenScopes((prev) => (prev.length ? prev : s.data.readScopes)); }
      if (t.ok) setTokens(t.data.tokens ?? []);
      if (i.ok) { setInbox(i.data.inbox ?? null); setDeliveries(i.data.deliveries ?? []); if (i.data.inbox?.url) setInboxUrl(i.data.inbox.url); }
      if (k.ok) setKeyView(k.data.key ?? null);
      if (p.ok) { setProfile(p.data.profile); setConsentSentence(p.data.consentSentence); }
      if (st.ok) setStatements(st.data.statements ?? []);
      if (d.ok) setDrafts(d.data.drafts ?? []);
    } catch {
      setError("Could not load this section. Reload the page");
    }
  };
  useEffect(() => { void load(); }, []);

  const mint = async () => {
    setMinting(true); setError("");
    const r = await gameFetch("/api/agent/tokens", { method: "POST", body: JSON.stringify({ name: tokenName, scopes: tokenScopes }) }).then(json<any>);
    setMinting(false);
    if (!r.ok) { setError(r.data?.error ?? "Could not mint a token"); return; }
    setRevealed({ token: r.data.token, name: tokenName });
    setTokenName("");
    void load();
  };
  /*
   * THE FOUR IN THIS FILE THAT DID NOT ASK (save honesty).
   *
   * Every other handler here goes through `json<T>` and reads `r.ok` before
   * it says a word. These four threw the answer away and let `load()` stand
   * in for it, so a refused revoke redrew the same token, a refused key
   * removal cleared the note that would have explained it, and a correction
   * to a public statement about somebody closed its own editor and lost the
   * text they had typed. Each now returns before it touches the screen.
   */
  const revoke = async (id: string) => {
    const r = await gameFetch(`/api/agent/tokens/${id}`, { method: "DELETE" }).then(json<any>);
    if (!r.ok) { setError(r.data?.error ?? "Could not revoke that token"); return; }
    void load();
  };

  const saveInbox = async () => {
    setInboxBusy(true); setInboxNote(""); setInboxSecret("");
    const r = await gameFetch("/api/agent/inbox", { method: "PUT", body: JSON.stringify({ url: inboxUrl }) }).then(json<any>);
    setInboxBusy(false);
    if (!r.ok) { setInboxNote(r.data?.error ?? "Could not save the inbox"); return; }
    setInboxSecret(r.data.secret);
    void load();
  };
  const testInbox = async () => {
    setInboxBusy(true); setInboxNote("");
    const r = await gameFetch("/api/agent/inbox/test", { method: "POST", body: "{}" }).then(json<any>);
    setInboxBusy(false);
    if (!r.ok) { setInboxNote(r.data?.error ?? "Could not send a test"); return; }
    setInboxNote(r.data.sent > 0 ? "Delivered. Your agent should have it now" : "Queued. The first attempt did not get through; the village will retry");
    void load();
  };
  const removeInboxNow = async () => {
    const r = await gameFetch("/api/agent/inbox", { method: "DELETE" }).then(json<any>);
    if (!r.ok) { setInboxNote(r.data?.error ?? "Could not remove the inbox"); return; }
    setInboxUrl(""); setInboxSecret(""); void load();
  };

  const saveKey = async () => {
    setKeyBusy(true); setKeyNote("");
    const r = await gameFetch("/api/agent/key", { method: "PUT", body: JSON.stringify({ provider, key: keyValue, baseUrl, model }) }).then(json<any>);
    setKeyBusy(false);
    if (!r.ok) { setKeyNote(r.data?.error ?? "Could not save the key"); return; }
    setKeyValue(""); setKeyNote("Saved. The assistant answers on your key from now on");
    void load();
  };
  const removeKey = async () => {
    const r = await gameFetch("/api/agent/key", { method: "DELETE" }).then(json<any>);
    if (!r.ok) { setKeyNote(r.data?.error ?? "Could not remove the key"); return; }
    setKeyNote(""); void load();
  };

  const saveProfile = async (next: Partial<Profile>) => {
    setProfileNote("");
    const merged = { ...profile, ...next };
    setProfile(merged);
    const r = await gameFetch("/api/agent/profile", { method: "PUT", body: JSON.stringify(merged) }).then(json<any>);
    if (!r.ok) setProfileNote(r.data?.error ?? "Could not save");
    else setProfileNote("Saved");
  };

  const decideStatement = async (id: string, action: "correct" | "withdraw", correction?: string) => {
    const r = await gameFetch(`/api/agent/statements/${id}/${action}`, { method: "POST", body: JSON.stringify({ correction }) }).then(json<any>);
    // The editor stays open with the text still in it, which is the rule the
    // rest of this round settled on for a refused piece of writing.
    if (!r.ok) { setError(r.data?.error ?? "Could not record that"); return; }
    setCorrecting(null); void load();
  };
  const decideDraft = async (id: string, action: "confirm" | "reject") => {
    const r = await gameFetch(`/api/agent/drafts/${id}/${action}`, { method: "POST", body: "{}" }).then(json<any>);
    if (!r.ok) setError(r.data?.error ?? "Could not decide that draft");
    void load();
  };

  const origin = setup?.origin ?? "";
  const envVar = setup?.tokenEnvVar ?? "VILLAGE_AGENT_TOKEN";
  const skillsUrl = setup?.skillsUrl ?? "";
  const cards: Record<typeof card, { label: string; text: string }> = {
    claude: {
      label: "Claude Code",
      text: [
        `# in your shell, once (the value is the token you copied above)`,
        `export ${envVar}=...`,
        `export VILLAGE_ORIGIN=${origin}`,
        `# then tell Claude Code where the skills live:`,
        `# "Read ${skillsUrl} and follow the village-calendar skill; call the API with $${envVar}."`,
      ].join("\n"),
    },
    hermes: {
      label: "Hermes",
      text: [
        `# ~/.hermes/skills/village-calendar/SKILL.md`,
        `curl -s ${origin}/api/agent/v1/skills/village-calendar/SKILL.md -o ~/.hermes/skills/village-calendar/SKILL.md`,
        `# environment for the agent process`,
        `${envVar}=...`,
        `VILLAGE_ORIGIN=${origin}`,
      ].join("\n"),
    },
    openclaw: {
      label: "OpenClaw",
      text: [
        `# add the skills folder from the village, then set:`,
        `${envVar}=...`,
        `VILLAGE_ORIGIN=${origin}`,
        `# skills index: ${skillsUrl}`,
      ].join("\n"),
    },
    curl: {
      label: "Any OpenAI-compatible agent (curl)",
      text: [
        `curl -s ${origin}/api/agent/v1/calendar \\`,
        `  -H "Authorization: Bearer $${envVar}"`,
        `# the two-call RSVP write, call one:`,
        `curl -s -X POST ${origin}/api/agent/v1/events/EVENT_ID/rsvp \\`,
        `  -H "Authorization: Bearer $${envVar}" -H "Content-Type: application/json" \\`,
        `  -d '{"status":"going"}'`,
        `# read the echo to the member, get a yes, then call two with confirm:true, confirmToken and the same echo.`,
      ].join("\n"),
    },
  };

  return (
    <div className="bg-card rounded-2xl shadow-lg p-6 sm:p-8">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-5 h-5 text-notice" />
        <h2 className="font-display text-xl font-bold text-card-foreground">Your agent</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Connect your own agent to this village, or run the village assistant on your own key. You hold the token; the village never writes anything until you say yes.
      </p>
      {error && <p role="alert" className="text-xs text-destructive mb-4">{error}</p>}

      <div className="space-y-5">
        {/* ── Bring your agent ── */}
        <Card title="Bring your agent" icon={<KeyRound className="w-4 h-4 text-notice" />}>
          <p className="text-xs text-muted-foreground mb-3">
            A personal access token lets your agent read what you already see here and make two writes, each one shown to you first. Tokens expire in 90 days and you can revoke one any time.
          </p>

          {tokens.length > 0 && (
            <ul className="space-y-2 mb-4">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-card-foreground">
                      {t.name} <span className="text-xs text-muted-foreground font-mono">{t.prefix}...</span>
                      {!t.live && <span className="ml-2 text-xs text-muted-foreground">({t.revokedAt ? "revoked" : "expired"})</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.scopes.join(", ")} · expires {when(t.expiresAt).slice(0, 10)}{t.lastUsedAt ? ` · last used ${when(t.lastUsedAt)}` : " · never used"}
                    </div>
                  </div>
                  {t.live && (
                    <button type="button" onClick={() => revoke(t.id)} className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80">
                      <Trash2 className="w-3.5 h-3.5" /> Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {revealed && (
            <div role="status" className="rounded-xl border border-notice/60 bg-muted p-3 mb-4">
              <p className="text-xs text-notice mb-2">
                Your token for <strong>{revealed.name}</strong>. This is the only time it is shown; copy it now and give it to your agent as <code>{envVar}</code>.
              </p>
              <CopyLine value={revealed.token} />
              <button type="button" onClick={() => setRevealed(null)} className="mt-2 text-xs text-notice underline">I have copied it</button>
            </div>
          )}

          <div className="rounded-lg bg-card border border-border p-3 mb-4">
            <label htmlFor="agent-token-name" className="block text-xs font-medium text-card-foreground mb-1">Mint a token</label>
            <input
              id="agent-token-name"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="A name you will recognise, like laptop Claude Code"
              className="w-full min-w-0 text-sm border border-border rounded-lg px-3 py-2 mb-2"
              maxLength={80}
            />
            {/* Densest rows on the page and the smallest before this: 250x17 at
                390px. A scope is a permission somebody grants an agent, so it is
                worth a finger-sized row even though four of them get taller. The
                comment sits OUT here: a map callback returns one element, and a
                comment node beside the label is a second one. */}
            <div className="grid sm:grid-cols-2 gap-1.5 mb-2">
              {(setup?.scopes ?? []).map((s) => (
                <label key={s} className="flex min-h-11 items-start gap-3 py-2 text-xs text-card-foreground">
                  <input
                    type="checkbox"
                    checked={tokenScopes.includes(s)}
                    onChange={(e) => setTokenScopes(e.target.checked ? [...tokenScopes, s] : tokenScopes.filter((x) => x !== s))}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span><code className="text-[11px]">{s}</code>: {SCOPE_WORDS[s] ?? s}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={mint}
              disabled={minting || !tokenName.trim() || tokenScopes.length === 0}
              className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
            >
              {minting ? "Minting…" : "Mint token"}
            </button>
          </div>

          <div className="mb-4">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(Object.keys(cards) as (typeof card)[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCard(k)}
                  className={`text-xs rounded-full px-3 py-1 border ${card === k ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-card-foreground border-border"}`}
                >
                  {cards[k].label}
                </button>
              ))}
            </div>
            <pre className="overflow-x-auto rounded-lg bg-background text-foreground text-[11px] leading-relaxed p-3 whitespace-pre-wrap break-words">{cards[card].text}</pre>
            <p className="text-xs text-muted-foreground mt-2">
              The skills your agent should read: <a className="text-foreground underline" href={setup?.skillsUrl ?? "#"} target="_blank" rel="noreferrer">skills index</a>, <a className="text-foreground underline" href={setup?.openapiUrl ?? "#"} target="_blank" rel="noreferrer">OpenAPI</a>. Two lines every skill carries: show the exact write and get a yes; a hidden field is hidden.
            </p>
          </div>

          <div className="rounded-lg bg-card border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <Webhook className="w-4 h-4 text-notice" />
              <span className="text-xs font-medium text-card-foreground">Agent inbox (optional)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              An https URL your agent listens on. The village sends it the week ahead and, once introductions are on, your opportunities, signed with a secret shown once.
            </p>
            {!setup?.memberSecrets ? (
              <p className="text-xs text-notice">{setup?.memberSecretsSentence ?? ""}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-2">
                  <input
                    aria-label="Agent inbox URL"
                    value={inboxUrl}
                    onChange={(e) => setInboxUrl(e.target.value)}
                    placeholder="https://your-agent.example/village"
                    className="flex-1 min-w-[12rem] text-sm border border-border rounded-lg px-3 py-2"
                  />
                  <button type="button" onClick={saveInbox} disabled={inboxBusy || !inboxUrl.trim()} className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40">Save</button>
                  {inbox && <button type="button" onClick={testInbox} disabled={inboxBusy} className="text-sm border border-border rounded-lg px-3 py-1.5 disabled:opacity-40">Send a test</button>}
                  {inbox && <button type="button" onClick={removeInboxNow} className="text-sm text-destructive px-2 py-1.5">Remove</button>}
                </div>
                {inboxSecret && (
                  <div role="status" className="rounded-xl border border-notice/60 bg-muted p-3 mb-2">
                    <p className="text-xs text-notice mb-2">Your inbox secret. Shown once; the village does not keep it. Verify <code>{setup.signatureHeader}</code> with it.</p>
                    <CopyLine value={inboxSecret} />
                    <button type="button" onClick={() => setInboxSecret("")} className="mt-2 text-xs text-notice underline">I have copied it</button>
                  </div>
                )}
                {inbox && (
                  <p className="text-xs text-muted-foreground">
                    {inbox.enabled ? "On" : `Off: ${inbox.disabledReason ?? "switched off"}`}
                    {inbox.lastStatus ? ` · last: ${inbox.lastStatus}` : ""}
                    {inbox.lastDeliveryAt ? ` · delivered ${when(inbox.lastDeliveryAt)}` : ""}
                    {deliveries.length > 0 ? ` · ${deliveries.filter((d) => d.deliveredAt).length} of the last ${deliveries.length} delivered` : ""}
                  </p>
                )}
                {inboxNote && <p className="text-xs text-card-foreground mt-1">{inboxNote}</p>}
              </>
            )}
          </div>
        </Card>

        {/* ── Run the assistant on your key ── */}
        <Card title="Run the assistant on your key" icon={<ShieldCheck className="w-4 h-4 text-notice" />}>
          <p className="text-xs text-muted-foreground mb-3">
            Store your own LLM key and the in-app assistant answers your questions on it, on your budget. It is encrypted at rest and only the last four characters ever come back to this page.
          </p>
          {!setup?.memberSecrets ? (
            <p className="text-xs text-notice">{setup?.memberSecretsSentence ?? ""}</p>
          ) : (
            <>
              {keyView && (
                <p className="text-xs text-card-foreground mb-2">
                  Set: <strong>{keyView.provider}</strong> ending in <code>{keyView.last4}</code>{keyView.baseUrl ? ` at ${keyView.baseUrl}` : ""}{keyView.model ? ` (${keyView.model})` : ""}, {when(keyView.setAt)}.
                  <button type="button" onClick={removeKey} className="ml-2 text-destructive underline">Remove</button>
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2 min-w-0">
                <select aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full min-w-0 text-sm border border-border rounded-lg px-3 py-2 bg-card">
                  <option value="anthropic">Anthropic</option>
                  <option value="openai_compatible">OpenAI-compatible</option>
                </select>
                <input aria-label="API key" type="password" autoComplete="off" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder="Your API key" className="w-full min-w-0 text-sm border border-border rounded-lg px-3 py-2" />
                {provider === "openai_compatible" && (
                  <>
                    <input aria-label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL, like https://openrouter.ai/api/v1" className="w-full min-w-0 text-sm border border-border rounded-lg px-3 py-2" />
                    <input aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name, as the provider names it" className="w-full min-w-0 text-sm border border-border rounded-lg px-3 py-2" />
                  </>
                )}
              </div>
              {provider === "openai_compatible" && <p className="text-xs text-muted-foreground mb-2">OpenAI-compatible covers OpenRouter, Ollama and most gateways: a base URL, a key and a model name.</p>}
              <button type="button" onClick={saveKey} disabled={keyBusy || keyValue.trim().length < 8} className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40">
                {keyBusy ? "Saving…" : keyView ? "Replace key" : "Save key"}
              </button>
              {keyNote && <p className="text-xs text-card-foreground mt-2">{keyNote}</p>}
            </>
          )}
        </Card>

        {/* ── About me for my agent ── */}
        <Card title="About me for my agent" icon={<Bot className="w-4 h-4 text-notice" />}>
          <p className="text-xs text-muted-foreground mb-2">A note your agent reads to serve you. Yours to write, yours to clear. You choose who else may read it.</p>
          <label htmlFor="agent-about" className="sr-only">About me for my agent</label>
          <textarea
            id="agent-about"
            value={profile.aboutMe}
            onChange={(e) => setProfile({ ...profile, aboutMe: e.target.value })}
            onBlur={() => saveProfile({ aboutMe: profile.aboutMe })}
            rows={3}
            maxLength={2000}
            placeholder="What you are here for, what you cook, when you are around, what to leave you out of."
            className="w-full text-sm border border-border rounded-lg px-3 py-2 mb-2"
          />
          <div className="space-y-1 mb-2">
            {(Object.keys(TIER_WORDS) as Profile["aboutTier"][]).map((tier) => (
              <label key={tier} className="flex items-start gap-2 text-xs text-card-foreground">
                <input type="radio" name="agent-about-tier" checked={profile.aboutTier === tier} onChange={() => saveProfile({ aboutTier: tier })} className="mt-0.5" />
                <span>{TIER_WORDS[tier]}</span>
              </label>
            ))}
          </div>
          <label className="flex min-h-11 items-start gap-3 py-2 text-xs text-card-foreground">
            <input type="checkbox" checked={profile.matchingConsent} onChange={(e) => saveProfile({ matchingConsent: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{consentSentence || "The assistant may use this note and my profile to suggest introductions."}</span>
          </label>
          {profileNote && <p className="text-xs text-muted-foreground mt-1">{profileNote}</p>}
        </Card>

        {/* ── What the assistant has said about you ── */}
        <Card title="What the assistant has said about you" icon={<ShieldCheck className="w-4 h-4 text-notice" />}>
          {statements.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet. When the assistant says a sentence about you, it lands here with its source, and you can correct or withdraw it.</p>
          ) : (
            <ul className="space-y-2">
              {statements.map((s) => (
                <li key={s.id} className="rounded-lg bg-card border border-border px-3 py-2">
                  <p className="text-sm text-card-foreground">{s.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {when(s.createdAt)} · source: {s.sources.length ? s.sources.join(", ") : "the conversation"} · {s.status}
                    {s.correction ? ` · you said: ${s.correction}` : ""}
                  </p>
                  {s.status === "active" && (
                    <div className="mt-1 flex flex-wrap gap-3">
                      <button type="button" onClick={() => setCorrecting({ id: s.id, text: "" })} className="text-xs text-foreground underline">Correct</button>
                      <button type="button" onClick={() => decideStatement(s.id, "withdraw")} className="text-xs text-destructive underline">Withdraw</button>
                    </div>
                  )}
                  {correcting?.id === s.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        aria-label="What is true instead"
                        value={correcting.text}
                        onChange={(e) => setCorrecting({ id: s.id, text: e.target.value })}
                        placeholder="What is true instead"
                        className="flex-1 min-w-[10rem] text-sm border border-border rounded-lg px-3 py-1.5"
                      />
                      <button type="button" onClick={() => decideStatement(s.id, "correct", correcting.text)} disabled={!correcting.text.trim()} className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Save</button>
                      <button type="button" onClick={() => setCorrecting(null)} className="text-sm text-muted-foreground px-2">Cancel</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Drafts waiting for your yes ── */}
        <Card title="Drafts waiting for your yes" icon={<KeyRound className="w-4 h-4 text-notice" />}>
          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing waiting. When the assistant proposes an RSVP for you, it appears here and nothing happens until you confirm it.</p>
          ) : (
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2">
                  <div className="text-sm text-card-foreground">
                    Say <strong>{d.payload.status}</strong> to <strong>{d.event?.title ?? d.payload.eventId}</strong>
                    {d.event ? <span className="text-xs text-muted-foreground"> ({when(d.event.startsAt)})</span> : null}
                    <span className="block text-xs text-muted-foreground">proposed by the {d.source === "token" ? "agent" : "assistant"} · {when(d.createdAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => decideDraft(d.id, "confirm")} className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5">Yes, send it</button>
                    <button type="button" onClick={() => decideDraft(d.id, "reject")} className="text-sm border border-border rounded-lg px-3 py-1.5">No</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
