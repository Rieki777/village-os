/**
 * THE PROVIDER HALF OF COMMS SETTINGS: one editor each for the key, the
 * sending domain, the sender, delivery reports and the test email (the comms
 * build spec 5.15, items 1 to 4 and 13). The village's own words and people
 * (items 5 to 12) are in CommsSetupWords.tsx.
 *
 * Every editor saves through the server and redraws from the server's answer,
 * so what the checklist says is always what was stored. A refusal is shown
 * in the server's own words, on the editor that was refused.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { refusal } from "@/components/admin/adminApi";
import { commsCall, whenOf, whenOfIso, type DomainPanel, type SettingsPayload } from "./commsSettingsApi";

export interface EditorProps {
  data: SettingsPayload;
  password: string;
  /** Take the fresh payload a save answered with. */
  apply(next: SettingsPayload): void;
}

export const inputCls =
  "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-teal-deep/40";
export const primaryCls =
  "min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium hover:bg-teal-deep-dark disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep";
export const secondaryCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep";

/** A sentence the server refused with, kept on the editor it belongs to. */
export function Refused({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2" role="alert">
      {text}
    </p>
  );
}

/** Numbered steps to do by hand in the provider's dashboard. */
export function Steps({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700 mt-2">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

/**
 * Save through one call and redraw from what the server answered. Returns
 * the answer's body on success, null on a refusal (already shown).
 */
export function useSaver(props: EditorProps) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const save = useCallback(
    async (path: string, method: "POST" | "PUT", body: unknown, saidOk: string): Promise<SettingsPayload | null> => {
      setBusy(true);
      setRefused(null);
      const r = await commsCall<SettingsPayload>(path, props.password, { method, body });
      setBusy(false);
      if (!r.ok) {
        const sentence = refusal(r.data, "That was not saved.");
        setRefused(sentence);
        toast.error(sentence);
        return null;
      }
      if (r.data?.checklist) props.apply(r.data);
      if (saidOk) toast.success(saidOk);
      return r.data;
    },
    [props],
  );
  return { busy, refused, setRefused, save };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Your browser would not copy it. Select the text and copy it by hand.");
        }
      }}
      className="inline-flex items-center justify-center w-8 h-8 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

// ── 1. The Resend API key ───────────────────────────────────────────────────

export function ApiKeyEditor(props: EditorProps) {
  const { data } = props;
  const [draft, setDraft] = useState("");
  const { busy, refused, save } = useSaver(props);

  // The key saves through the existing secrets route, which answers with the
  // masked statuses and not with this screen's payload, so the screen is read
  // again after it.
  const submit = async () => {
    const r = await save("/admin/integrations/resend_api_key", "PUT", { value: draft.trim() }, "Key saved");
    if (r === null) return;
    setDraft("");
    const fresh = await commsCall<SettingsPayload>("/admin/comms/settings", props.password);
    if (fresh.ok) props.apply(fresh.data);
  };
  const key = data.key;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {key.configured
          ? `A key is set${key.last4 ? `, ending in ${key.last4}` : ""}${key.source === "env" ? ", from the host's settings" : ""}. It is never shown again once saved.`
          : "Make a key at resend.com/api-keys and paste it here. Choose full access, and this screen can add your domain and connect delivery reports for you."}
      </p>
      {!data.secretsKeySet && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This server has no village-secrets key, so a key typed here cannot be stored safely. Ask whoever runs the server to set
          VILLAGE_SECRETS_KEY, or to set RESEND_API_KEY in the host's settings.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="sr-only">Resend API key</span>
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={key.configured ? "Paste a new key to replace it" : "re_..."}
            className={inputCls}
          />
        </label>
        <button type="button" onClick={submit} disabled={busy || !draft.trim()} className={primaryCls}>
          {busy ? "Saving..." : "Save key"}
        </button>
      </div>
      <Refused text={refused} />
    </div>
  );
}

// ── 2. The sending domain ───────────────────────────────────────────────────

export function DomainEditor(props: EditorProps) {
  const { data, password } = props;
  const s = data.settings;
  const [draft, setDraft] = useState(s.domain);
  const [panel, setPanel] = useState<DomainPanel | null>(data.domainPanel ?? null);
  const [looking, setLooking] = useState(false);
  const { busy, refused, save } = useSaver(props);

  const look = useCallback(async () => {
    setLooking(true);
    const r = await commsCall<DomainPanel>("/admin/comms/settings/domain", password);
    setLooking(false);
    if (r.ok) setPanel(r.data);
  }, [password]);

  useEffect(() => {
    if (s.domain) void look();
  }, [s.domain, look]);

  const after = (r: SettingsPayload | null) => {
    if (r?.domainPanel) setPanel(r.domainPanel);
  };

  const status = panel?.status ?? s.domainStatus;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="sr-only">Sending domain</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="example.org"
            className={inputCls}
          />
        </label>
        <button
          type="button"
          disabled={busy || !draft.trim() || draft.trim().toLowerCase() === s.domain}
          onClick={async () => after(await save("/admin/comms/settings/domain", "POST", { name: draft }, "Domain added"))}
          className={primaryCls}
        >
          {busy ? "Working..." : s.domain ? "Use this domain" : "Add domain"}
        </button>
      </div>
      <Refused text={refused} />

      {s.domain && (
        <div className="border border-gray-200 rounded-xl p-3 bg-white">
          <p className="text-sm text-gray-800">
            <span className="font-medium">{s.domain}</span>:{" "}
            {status === "verified"
              ? "verified"
              : status === "failed" || status === "temporary_failure"
                ? "Resend could not find the records yet"
                : panel?.byHand || !s.domainId
                  ? "this key cannot check it"
                  : "waiting for its DNS records"}
            {s.domainCheckedAt ? `, checked ${whenOfIso(s.domainCheckedAt)}` : ""}
            {looking ? " (checking...)" : ""}
          </p>
          {panel?.error && <p className="text-xs text-amber-800 mt-1">{panel.error}</p>}

          {panel && panel.records.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <p className="text-xs text-gray-600 mb-2">
                Add each record wherever your domain's DNS is managed. Copy the name and the value exactly.
              </p>
              <table className="min-w-[560px] w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-gray-200">
                    <th className="py-1 pr-2 font-medium">For</th>
                    <th className="py-1 pr-2 font-medium">Type</th>
                    <th className="py-1 pr-2 font-medium">Name</th>
                    <th className="py-1 pr-2 font-medium">Value</th>
                    <th className="py-1 pr-2 font-medium">Priority</th>
                    <th className="py-1 font-medium">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.records.map((r, i) => (
                    <tr key={`${r.type}-${r.name}-${i}`} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2 text-gray-700">{r.record}</td>
                      <td className="py-2 pr-2 text-gray-700">{r.type}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-start gap-1">
                          <code className="break-all text-gray-900">{r.name}</code>
                          <CopyButton value={r.name} label={`the ${r.type} record's name`} />
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-start gap-1">
                          <code className="break-all text-gray-900">{r.value}</code>
                          <CopyButton value={r.value} label={`the ${r.type} record's value`} />
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-gray-700">{r.priority ?? ""}</td>
                      <td className="py-2 text-gray-700">{r.status === "verified" ? "yes" : "not yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(panel?.byHand || !s.domainId) && (
            <div className="mt-3">
              <p className="text-sm text-gray-700">This key can only send, so add and verify the domain in Resend by hand:</p>
              <Steps steps={panel?.steps ?? []} />
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {s.domainId ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => after(await save("/admin/comms/settings/domain/verify", "POST", {}, ""))}
                className={secondaryCls}
              >
                Check verification
              </button>
            ) : s.domainStatus === "verified" ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => after(await save("/admin/comms/settings/domain/confirm", "POST", { verified: false }, "Confirmation taken back"))}
                className={secondaryCls}
              >
                Take back my confirmation
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={async () => after(await save("/admin/comms/settings/domain/confirm", "POST", { verified: true }, "Confirmed"))}
                className={secondaryCls}
              >
                Resend says it is verified
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 3. The sender ───────────────────────────────────────────────────────────

export function SenderEditor(props: EditorProps) {
  const { data } = props;
  const domain = data.settings.domain;
  const [name, setName] = useState(data.sender.name);
  const [address, setAddress] = useState(data.sender.address);
  const { busy, refused, save } = useSaver(props);
  return (
    <div className="space-y-3">
      {data.sender.line && (
        <p className="text-sm text-gray-600">
          Emails go out as <code className="text-gray-900">{data.sender.line}</code>
          {data.sender.source === "env" ? ", from the host's EMAIL_FROM setting. Saving here takes over from it." : "."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 block mb-1">Name people see</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your village's name" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 block mb-1">Address</span>
          <input
            type="email"
            inputMode="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={domain ? `hello@${domain}` : "hello@example.org"}
            className={inputCls}
          />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        {domain ? `The address has to end in @${domain}.` : "Add the sending domain first. The address has to be on it."}
      </p>
      <button
        type="button"
        disabled={busy || !name.trim() || !address.trim()}
        onClick={() => save("/admin/comms/settings/sender", "PUT", { name, address }, "Sender saved")}
        className={primaryCls}
      >
        {busy ? "Saving..." : "Save sender"}
      </button>
      <Refused text={refused} />
    </div>
  );
}

// ── 4. Delivery reports ─────────────────────────────────────────────────────

export function DeliveryReportsEditor(props: EditorProps) {
  const { data } = props;
  const w = data.webhook;
  const [steps, setSteps] = useState<string[]>([]);
  const [handOpen, setHandOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const { busy, refused, save } = useSaver(props);

  const connect = async () => {
    const r = await save("/admin/comms/settings/webhook", "POST", {}, "");
    if (!r) return;
    if (r.byHand) {
      // The key can only send. The steps open below, which says so better
      // than a toast that fades.
      setSteps(r.steps ?? []);
      setHandOpen(true);
    } else {
      toast.success("Delivery reports connected");
    }
  };

  return (
    <div className="space-y-3">
      {w.configured ? (
        <p className="text-sm text-gray-600">
          {w.source === "env"
            ? "Connected through the host's RESEND_WEBHOOK_SECRET setting."
            : `Connected${w.connectedBy ? ` by ${w.connectedBy}` : ""}${w.connectedAt ? ` on ${whenOfIso(w.connectedAt)}` : ""}${w.byHand ? ", by hand" : ""}.`}{" "}
          {w.lastReportAt ? `The last report arrived ${whenOf(w.lastReportAt)}.` : "No report has arrived yet."}
        </p>
      ) : (
        <p className="text-sm text-gray-600">
          One press makes the webhook in Resend and keeps its signing secret here, so every report is checked before it counts.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={connect} disabled={busy} className={primaryCls}>
          {busy ? "Connecting..." : w.configured ? "Connect again" : "Connect delivery reports"}
        </button>
        <button type="button" onClick={() => setHandOpen((v) => !v)} className={secondaryCls} aria-expanded={handOpen}>
          {handOpen ? "Hide the steps by hand" : "Do it by hand instead"}
        </button>
      </div>
      {w.configured && w.source !== "env" && (
        <p className="text-xs text-gray-500">
          Connecting again makes a second webhook in Resend. Remove the older one in Resend's dashboard so its reports stop.
        </p>
      )}
      <Refused text={refused} />

      {handOpen && (
        <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2">
          <Steps
            steps={
              steps.length
                ? steps
                : [
                    "Open resend.com/webhooks and add an endpoint.",
                    `Paste this address as the endpoint: ${w.url || "the address of this site, followed by /api/comms/webhooks/resend"}`,
                    `Tick these events: ${w.events.join(", ")}.`,
                    "Save it, copy the signing secret Resend shows (it starts with whsec_), and paste it below.",
                  ]
            }
          />
          {w.url && (
            <div className="flex items-start gap-2">
              <code className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all flex-1 text-gray-900">{w.url}</code>
              <CopyButton value={w.url} label="the delivery-report address" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <label className="flex-1 min-w-[220px]">
              <span className="sr-only">Signing secret</span>
              <input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="whsec_..."
                className={inputCls}
              />
            </label>
            <button
              type="button"
              disabled={busy || !secret.trim()}
              onClick={async () => {
                if (await save("/admin/comms/settings/webhook", "PUT", { secret }, "Signing secret saved")) setSecret("");
              }}
              className={primaryCls}
            >
              Save secret
            </button>
          </div>
          {w.configured && w.source === "admin" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Disconnect delivery reports? Reports Resend sends after this are refused until you connect again.")) {
                  void save("/admin/comms/settings/webhook", "PUT", { secret: "" }, "Delivery reports disconnected");
                }
              }}
              className={secondaryCls}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── 13. A test email to yourself ────────────────────────────────────────────

export function TestEmailEditor(props: EditorProps) {
  const { data, password } = props;
  const t = data.testEmail;
  const [checking, setChecking] = useState(false);
  const { busy, refused, save } = useSaver(props);

  const send = async () => {
    const r = await save("/admin/comms/settings/test", "POST", {}, "");
    if (!r?.result) return;
    if (r.result.status === "sent") toast.success("Sent. It counts once the delivery report arrives.");
    else toast.error(`Not sent: ${r.result.reason ?? r.result.status}.`);
  };
  const check = async () => {
    setChecking(true);
    const r = await commsCall<SettingsPayload>("/admin/comms/settings", password);
    setChecking(false);
    if (r.ok) props.apply(r.data);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {data.me.email
          ? `The test goes to ${data.me.email}, from the sender above.`
          : "Sign in with your own account to send yourself a test."}{" "}
        {t ? `The last one went to ${t.toEmail} on ${whenOf(t.createdAt)} and is ${t.delivered ? "delivered" : t.status}.` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={send} disabled={busy || !data.me.email} className={primaryCls}>
          {busy ? "Sending..." : "Send me a test"}
        </button>
        {t && !t.delivered && (
          <button type="button" onClick={check} disabled={checking} className={secondaryCls}>
            {checking ? "Checking..." : "Check again"}
          </button>
        )}
      </div>
      {t && !t.delivered && t.status === "sent" && (
        <p className="text-xs text-gray-500">Delivery reports usually arrive within a minute of the email.</p>
      )}
      <Refused text={refused} />
    </div>
  );
}
