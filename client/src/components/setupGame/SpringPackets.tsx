/**
 * THE SEED PACKETS FOR THE SPRING PLOT. One packet per planting, and every
 * button here goes through the route Comms Settings or Integrations already
 * uses (setupGameApi.ts), so a step done here is done there too.
 *
 * WHO WRITES THE WORDS. Where the closed seed catalog holds a seed for a step
 * (the account, the domain, delivery reports, the sender), its title, what it
 * grants, its cost and its undo come from the catalog through the server. For
 * the key, the test letter and opening the post office, the packet says what
 * the code does today in the platform's own words: the catalog's key seed
 * describes a send-only key the platform mints from a setup key, and that flow
 * is not built yet, so quoting it here would promise something untrue.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { DomainPanel, SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import {
  addDomain,
  checkKeyRights,
  confirmDomain,
  connectReports,
  pasteReportsSecret,
  plantResendKey,
  readComms,
  readDomain,
  said,
  savePostalAddress,
  saveSender,
  sendTestLetter,
  switchModule,
  verifyDomain,
  type SeedState,
} from "./setupGameApi";
import { suggestedDomain, type BeatId } from "./springModel";

export interface PacketProps {
  beat: BeatId | "done";
  /** Looking back at a planting that is already done. */
  revisit: boolean;
  comms: SettingsPayload | null;
  domain: DomainPanel | null;
  seeds: Record<string, SeedState>;
  village: string;
  phase: "before-launch" | "after-launch";
  accountTicked: boolean;
  onAccount: () => void;
  setComms: (p: SettingsPayload) => void;
  setDomain: (d: DomainPanel | null) => void;
  onBack: () => void;
}

interface Words {
  title: string;
  kind: string;
  note: string;
  grants: string;
  who: string;
  cost: string;
  undo: string;
  keystone?: boolean;
}

function wordsFor(beat: BeatId, seeds: Record<string, SeedState>, phase: PacketProps["phase"]): Words {
  const founder = phase === "before-launch" ? "Any founder, before launch." : "A founder, with a second founder's yes after launch.";
  const fromSeed = (id: string, kind: string, note: string, who: string): Words => {
    const s = seeds[id];
    return {
      title: s?.title ?? id,
      kind,
      note,
      grants: s?.consequence ?? "",
      who,
      cost: s?.cost ?? "",
      undo: s?.undo ?? "",
      keystone: s?.keystone,
    };
  };
  switch (beat) {
    case "account":
      return fromSeed("resend-account", "Hand-carried", "Only a founder can do this", "You, on resend.com.");
    case "key":
      return {
        title: "Plant the sending key",
        kind: "Hand-carried",
        note: "The paste goes straight to the root cellar",
        grants:
          "Lets the village send email through Resend. With full access, this screen can also add your domain and connect delivery reports for you.",
        who: "The root cellar holds it. Nobody sees it again, only its last four characters.",
        cost: "Free within Resend's free tier.",
        undo: "Delete the key at resend.com/api-keys, and clear it under Integrations. Email stops at once.",
      };
    case "stones":
      return fromSeed("resend-sending-domain", "Copy and paste", "Tells the internet your letters are real", "You, where your web address lives, with a copy button per record.");
    case "reports":
      return fromSeed("resend-webhook-secret", "One press", "Your agent connects it with the key", "Any founder.");
    case "sign":
      return fromSeed("email-from", "Your words", "The name and address on every letter", "Any founder.");
    case "nursery":
      return {
        title: "Nursery: one test letter",
        kind: "Live check",
        note: "Bees visit when Resend reports it delivered",
        grants: "One test letter to you. Nobody else gets mail.",
        who: "You press send. Resend's delivery report says if it landed.",
        cost: "Free.",
        undo: "Nothing to undo.",
      };
    case "transplant":
      return {
        title: "Open the post office",
        kind: "Keystone",
        note: "Read slowly",
        grants: "Comms switches on for members. Welcomes, receipts and every journey you have switched on start sending.",
        who: founder,
        cost: "Your Resend plan. The free tier covers a small village to start.",
        undo: "Switch Comms back to preview in the Module Library. Pause all in Comms Settings stops every letter at once.",
        keystone: true,
      };
    case "trade":
      return {
        title: "Trade the master key for a sending key",
        kind: "Keystone",
        note: "The paste goes straight to the root cellar",
        grants: "The village keeps sending in its own name. The new key can only send, and only from your domain, so a key that leaks cannot touch your Resend account.",
        who: founder,
        cost: "Free.",
        undo: "Paste the full-access key back. Then delete whichever key you no longer use at resend.com/api-keys.",
        keystone: true,
      };
  }
}

const RESEND_SIGNUP = "https://resend.com/signup";
const RESEND_KEYS = "https://resend.com/api-keys";

function Facts({ w }: { w: Words }) {
  return (
    <dl className="sg-facts">
      <dt>Grants</dt>
      <dd>{w.grants}</dd>
      <dt>Who</dt>
      <dd>{w.who}</dd>
      <dt>Cost</dt>
      <dd>{w.cost}</dd>
      <dt>Undo</dt>
      <dd>{w.undo}</dd>
    </dl>
  );
}

function Shell({ w, done, children }: { w: Words; done?: boolean; children: ReactNode }) {
  return (
    <section className={`sg-packet${w.keystone && !done ? " keystone" : ""}`} aria-live="polite">
      <div className="sg-phead">
        <h2>{w.title}</h2>
        <span className={`sg-chip${done ? " done" : w.keystone ? " gold" : ""}`}>{done ? "Done" : w.kind}</span>
      </div>
      <div className="sg-prov">Seed packet from the Email guild · {w.note}</div>
      <Facts w={w} />
      <div className="sg-pbody">{children}</div>
    </section>
  );
}

/** Calls a planting, shows what the server said, and redraws from its answer. */
function useDoing() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function doing<T>(call: () => Promise<{ ok: boolean; data: T }>, fallback: string): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const r = await call();
      if (!r.ok) {
        setError(said(r.data, fallback));
        return null;
      }
      return r.data;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, doing };
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <div className="sg-msg" role="alert">
      {text}
    </div>
  ) : null;
}

export default function SpringPacket(props: PacketProps) {
  const { beat, revisit, comms, seeds, phase } = props;
  if (beat === "done") {
    return (
      <section className="sg-packet" aria-live="polite">
        <div className="sg-phead">
          <h2>The spring runs</h2>
          <span className="sg-chip water">Water layer established</span>
        </div>
        <div className="sg-pbody">
          <dl className="sg-facts" style={{ padding: 0 }}>
            <dt>Live check</dt>
            <dd>The latest test letter was reported delivered{comms?.testEmail ? ` to ${comms.testEmail.toEmail}` : ""}.</dd>
            <dt>Sender</dt>
            <dd>{comms?.sender.line || "Not set"}</dd>
            <dt>Harvest</dt>
            <dd>Renew the key once a year.</dd>
          </dl>
          <div className="sg-actions">
            <a className="sg-primary" href="/admin?tab=comms-letters">
              Write your first letter
            </a>
            <a className="sg-link" href="/admin?tab=comms-settings">
              Open Comms Settings
            </a>
          </div>
        </div>
      </section>
    );
  }
  const w = wordsFor(beat, seeds, phase);
  if (revisit) {
    return (
      <Shell w={w} done>
        <div className="sg-msg calm">This planting is done. The words above say what it grants and how to undo it.</div>
        <div className="sg-actions">
          <button type="button" className="sg-primary" onClick={props.onBack}>
            Back to where we are
          </button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell w={w}>
      {beat === "account" && <AccountBody {...props} />}
      {beat === "key" && <KeyBody {...props} />}
      {beat === "stones" && <StonesBody {...props} />}
      {beat === "reports" && <ReportsBody {...props} />}
      {beat === "sign" && <SignBody {...props} />}
      {beat === "nursery" && <NurseryBody {...props} />}
      {beat === "transplant" && <TransplantBody {...props} />}
      {beat === "trade" && <TradeBody {...props} />}
    </Shell>
  );
}

function AccountBody({ onAccount }: PacketProps) {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <ol className="sg-steps">
        <li>
          Open{" "}
          <a href={RESEND_SIGNUP} target="_blank" rel="noreferrer">
            resend.com/signup
          </a>{" "}
          in a new tab.
        </li>
        <li>Sign up with a shared village address, such as ops@, that forwards to every founder.</li>
        <li>Click the link Resend emails you, then come back here.</li>
      </ol>
      <label className="sg-check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I checked the address bar. The page I signed up on was really resend.com.</span>
      </label>
      <div className="sg-actions">
        <button type="button" className="sg-primary" onClick={onAccount}>
          I have the account
        </button>
      </div>
    </>
  );
}

function KeyBody({ comms, setComms }: PacketProps) {
  const [value, setValue] = useState("");
  const { busy, error, doing } = useDoing();
  if (comms && !comms.secretsKeySet) {
    return (
      <div className="sg-msg gold">
        The root cellar has no lock yet. Its lock is VILLAGE_SECRETS_KEY, set on the hosting service by whoever runs your hosting. Once it is
        there, this step opens.
      </div>
    );
  }
  async function plant() {
    const v = value.trim();
    if (!v) return;
    const ok = await doing(() => plantResendKey(v), "Resend's key did not save. Try again.");
    if (ok === null) return;
    setValue("");
    const fresh = await readComms();
    if (fresh.ok) setComms(fresh.data);
  }
  return (
    <>
      <ol className="sg-steps">
        <li>
          On{" "}
          <a href={RESEND_KEYS} target="_blank" rel="noreferrer">
            resend.com/api-keys
          </a>
          , press Create API Key.
        </li>
        <li>Name it for your village and choose Full access, so this screen can set up your domain for you.</li>
        <li>Copy it. Resend shows it only once.</li>
      </ol>
      <p className="sg-why">Paste it here, never into a chat with any AI. Anything pasted into a chat is treated as public.</p>
      <div className="sg-field">
        <label htmlFor="sg-key">Cellar door</label>
        <input
          id="sg-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Starts with re_"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void plant();
          }}
        />
      </div>
      <ErrorLine text={error || (value.trim() && !value.trim().startsWith("re_") ? "Resend keys start with re_. Check you copied the whole key." : "")} />
      <div className="sg-actions">
        <button type="button" className="sg-primary" disabled={busy || !value.trim()} onClick={() => void plant()}>
          {busy ? "Planting" : "Plant it"}
        </button>
      </div>
    </>
  );
}

function TradeBody({ comms, setComms }: PacketProps) {
  const [value, setValue] = useState("");
  const { busy, error, doing } = useDoing();
  const onHost = comms?.key.source === "env";
  const full = comms?.settings.keyRights === "full";
  async function check() {
    const fresh = await doing(() => checkKeyRights(), "Resend could not be asked about the key. Try again in a minute.");
    if (fresh) setComms(fresh);
  }
  async function plant() {
    const v = value.trim();
    if (!v) return;
    const ok = await doing(() => plantResendKey(v), "Resend's key did not save. Try again.");
    if (ok === null) return;
    setValue("");
    // Ask about the new key straight away, so the answer is about this one.
    const fresh = await doing(() => checkKeyRights(), "The key is planted. Press Check the key to look again.");
    if (fresh) setComms(fresh);
  }
  return (
    <>
      {full ? (
        <>
          <ol className="sg-steps">
            <li>
              On{" "}
              <a href={RESEND_KEYS} target="_blank" rel="noreferrer">
                resend.com/api-keys
              </a>
              , press Create API Key.
            </li>
            <li>Name it for your village, choose Sending access, and pick your sending domain{comms?.settings.domain ? `, ${comms.settings.domain}` : ""}.</li>
            <li>Copy it. Resend shows it only once.</li>
            <li>{onHost ? "The key in use is set on the hosting service, so put the new one in RESEND_API_KEY there and come back." : "Paste it here, never into a chat with any AI."}</li>
            <li>Send yourself a test letter in Comms Settings. When it arrives, delete the old full-access key on resend.com.</li>
          </ol>
          {!onHost && (
            <div className="sg-field">
              <label htmlFor="sg-trade">Cellar door</label>
              <input
                id="sg-trade"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Starts with re_"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void plant();
                }}
              />
            </div>
          )}
        </>
      ) : (
        <p className="sg-why">Resend says what a key may do when asked. Nothing comes back out of the cellar, only its answer.</p>
      )}
      <ErrorLine text={error || (value.trim() && !value.trim().startsWith("re_") ? "Resend keys start with re_. Check you copied the whole key." : "")} />
      <div className="sg-actions">
        {full && !onHost && (
          <button type="button" className="sg-primary" disabled={busy || !value.trim()} onClick={() => void plant()}>
            {busy ? "Planting" : "Plant the sending key"}
          </button>
        )}
        <button type="button" className={full && !onHost ? "sg-link" : "sg-primary"} disabled={busy} onClick={() => void check()}>
          {busy ? "Asking Resend" : "Check the key"}
        </button>
      </div>
    </>
  );
}

function CopyRow({ label, value, seen }: { label: ReactNode; value: string; seen: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sg-copyrow">
      <div>
        <small>
          {label}
          {seen ? <span className="sg-seen"> · seen</span> : null}
        </small>
        <code>{value}</code>
      </div>
      <button
        type="button"
        className="sg-copybtn"
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function StonesBody({ comms, domain, setComms, setDomain }: PacketProps) {
  const [name, setName] = useState(() => suggestedDomain(comms));
  const { busy, error, doing } = useDoing();
  const named = comms?.settings.domain ?? "";
  async function after(p: SettingsPayload | null) {
    if (!p) return;
    setComms(p);
    if (p.domainPanel) setDomain(p.domainPanel);
    else {
      const d = await readDomain();
      if (d.ok) setDomain(d.data);
    }
  }
  if (!named) {
    return (
      <>
        <p className="sg-why">Which web address do your letters come from? It is usually the one in your founders' own email addresses.</p>
        <div className="sg-field">
          <label htmlFor="sg-domain">Your village's web address</label>
          <input id="sg-domain" type="text" placeholder="yourvillage.org" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ErrorLine text={error} />
        <div className="sg-actions">
          <button type="button" className="sg-primary" disabled={busy || !name.trim()} onClick={async () => after(await doing(() => addDomain(name.trim()), "Resend did not take that domain."))}>
            {busy ? "Asking Resend" : "Lay the stones"}
          </button>
        </div>
      </>
    );
  }
  if (domain?.byHand) {
    return (
      <>
        <ol className="sg-steps">
          {domain.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <ErrorLine text={error} />
        <div className="sg-actions">
          <button type="button" className="sg-primary" disabled={busy} onClick={async () => after(await doing(() => confirmDomain(true), "That did not save."))}>
            Resend says it is verified
          </button>
        </div>
      </>
    );
  }
  const records = domain?.records ?? [];
  return (
    <>
      <ol className="sg-steps">
        <li>Sign in where {named} lives (Cloudflare, GoDaddy, Namecheap, Squarespace or another) and open its DNS settings.</li>
        <li>Add each record below. Press Copy and paste the value.</li>
        <li>Come back and press Check the sky. DNS can take a few hours.</li>
      </ol>
      <div style={{ display: "grid", gap: 8 }}>
        {records.map((r, i) => (
          <CopyRow
            key={`${r.type}-${r.name}-${i}`}
            seen={/verified|valid/i.test(String(r.status))}
            value={r.value}
            label={
              <>
                {i + 1}. {r.record} · type <b>{r.type}</b>, name <b>{r.name}</b>
                {r.priority !== null ? (
                  <>
                    , priority <b>{r.priority}</b>
                  </>
                ) : null}
              </>
            }
          />
        ))}
        {records.length === 0 ? <div className="sg-msg calm">Resend has not handed over the records yet. Press Check the sky.</div> : null}
      </div>
      {domain?.error ? <div className="sg-msg">{domain.error}</div> : null}
      <ErrorLine text={error} />
      <div className="sg-actions">
        <button type="button" className="sg-primary" disabled={busy} onClick={async () => after(await doing(() => verifyDomain(), "Resend could not check just now."))}>
          {busy ? "Looking at the sky" : "Check the sky"}
        </button>
      </div>
    </>
  );
}

function ReportsBody({ comms, setComms }: PacketProps) {
  const [steps, setSteps] = useState<string[] | null>(null);
  const [secret, setSecret] = useState("");
  const { busy, error, doing } = useDoing();
  async function connect() {
    const p = await doing(() => connectReports(), "Delivery reports did not connect.");
    if (!p) return;
    if (p.byHand && p.steps) setSteps(p.steps);
    setComms(p);
  }
  async function paste() {
    const p = await doing(() => pasteReportsSecret(secret.trim()), "That secret did not save.");
    if (p) {
      setSecret("");
      setComms(p);
    }
  }
  return (
    <>
      {steps ? (
        <>
          <ol className="sg-steps">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="sg-field">
            <label htmlFor="sg-whsec">The signing secret</label>
            <input id="sg-whsec" type="password" autoComplete="off" placeholder="Starts with whsec_" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
        </>
      ) : (
        <p className="sg-why">Reports arrive at {comms?.webhook.url || "this village's own address"}.</p>
      )}
      <ErrorLine text={error} />
      <div className="sg-actions">
        {steps ? (
          <button type="button" className="sg-primary" disabled={busy || !secret.trim()} onClick={() => void paste()}>
            Plant the secret
          </button>
        ) : (
          <button type="button" className="sg-primary" disabled={busy} onClick={() => void connect()}>
            {busy ? "Connecting" : "Connect delivery reports"}
          </button>
        )}
      </div>
    </>
  );
}

function SignBody({ comms, village, setComms }: PacketProps) {
  const domain = comms?.settings.domain ?? "";
  const [name, setName] = useState(() => comms?.sender.name || village);
  const [local, setLocal] = useState(() => {
    const a = comms?.sender.address ?? "";
    return a.includes("@") ? a.slice(0, a.indexOf("@")) : "hello";
  });
  const [postal, setPostal] = useState(() => comms?.settings.postalAddress ?? "");
  const { busy, error, doing } = useDoing();
  const senderDone = !!comms?.checklist.find((i) => i.key === "sender")?.done;
  async function save() {
    if (!senderDone || name !== comms?.sender.name) {
      const p = await doing(() => saveSender(name.trim(), `${local.trim()}@${domain}`), "The sender did not save.");
      if (!p) return;
      setComms(p);
    }
    const q = await doing(() => savePostalAddress(postal.trim()), "The postal address did not save.");
    if (q) setComms(q);
  }
  return (
    <>
      <div className="sg-field">
        <label htmlFor="sg-sender-name">The name on every letter</label>
        <input id="sg-sender-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="sg-field">
        <label htmlFor="sg-sender-local">The address it comes from</label>
        <input id="sg-sender-local" type="text" value={local} onChange={(e) => setLocal(e.target.value)} aria-describedby="sg-at-domain" />
        <span id="sg-at-domain" className="sg-why">
          @{domain || "your domain"}
        </span>
      </div>
      <div className="sg-field">
        <label htmlFor="sg-postal">Postal address for the footer</label>
        <textarea id="sg-postal" value={postal} onChange={(e) => setPostal(e.target.value)} />
      </div>
      <p className="sg-why">Bulk email law asks for a real postal address in every letter's footer.</p>
      <ErrorLine text={error} />
      <div className="sg-actions">
        <button type="button" className="sg-primary" disabled={busy || !name.trim() || !local.trim() || !postal.trim() || !domain} onClick={() => void save()}>
          {busy ? "Signing" : "Sign the letters"}
        </button>
      </div>
    </>
  );
}

function NurseryBody({ comms, setComms }: PacketProps) {
  const { busy, error, doing } = useDoing();
  const [watching, setWatching] = useState(false);
  const t = comms?.testEmail ?? null;
  useEffect(() => {
    if (!watching) return;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries += 1;
      const r = await readComms();
      if (r.ok) setComms(r.data);
      const delivered = !!r.data?.checklist?.find?.((i) => i.key === "test-email")?.done;
      if (delivered || tries > 30) {
        window.clearInterval(id);
        setWatching(false);
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [watching, setComms]);
  async function send() {
    const p = await doing(() => sendTestLetter(), "The test letter did not go out.");
    if (!p) return;
    setComms(p);
    setWatching(true);
  }
  return (
    <>
      {t ? (
        <div className="sg-msg calm">
          Latest test letter to {t.toEmail}: {t.delivered ? "reported delivered." : `${t.status}. ${watching ? "Watching for Resend's delivery report." : ""}`}
        </div>
      ) : null}
      <ErrorLine text={error} />
      <div className="sg-actions">
        <button type="button" className="sg-primary" disabled={busy || watching} onClick={() => void send()}>
          {watching ? "Waiting for the report" : t ? "Send another test letter" : "Send me a test letter"}
        </button>
      </div>
    </>
  );
}

function TransplantBody({ comms, phase, setComms }: PacketProps) {
  const [ready, setReady] = useState(false);
  const [filling, setFilling] = useState(false);
  const { busy, error, doing } = useDoing();
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const frame = window.requestAnimationFrame(() => setFilling(true));
    const id = window.setTimeout(() => setReady(true), reduce ? 1500 : 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(id);
    };
  }, []);
  async function open() {
    const r = await doing(() => switchModule("comms", "members"), "Comms did not switch on.");
    if (r === null) return;
    const fresh = await readComms();
    if (fresh.ok) setComms(fresh.data);
  }
  return (
    <>
      <div className="sg-msg gold">
        {phase === "before-launch"
          ? "Before launch, any founder can do this alone. After launch, switching a module on takes the power to switch modules, or a vote."
          : "Your village has launched. If you do not hold the power to switch modules, the Module Library will offer you a proposal instead."}
      </div>
      <p className="sg-why">Comms is {comms?.lifecycle ?? "off"} right now.</p>
      <div className={`sg-readbar${filling ? " go" : ""}`} aria-hidden="true">
        <i />
      </div>
      <ErrorLine text={error} />
      <div className="sg-actions">
        <button type="button" className="sg-primary gold" disabled={!ready || busy} onClick={() => void open()}>
          {ready ? "Yes, open the post office" : "Take a moment to read the packet"}
        </button>
        <a className="sg-link" href="/modules/comms">
          Open the Module Library instead
        </a>
      </div>
    </>
  );
}
