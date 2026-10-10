/**
 * THE VILLAGE'S OWN HALF OF COMMS SETTINGS: the postal address, the reply-to
 * inboxes, who writes back for each path, the tick-box words, the recap
 * questions, who runs comms, the investor review and the rehearsal inbox (the
 * comms build spec 5.15, items 5 to 12). The provider half is in
 * CommsSetupEditors.tsx.
 *
 * Each editor saves only the field it shows, so a save never writes the
 * platform's defaults into the village's document by accident: a village that
 * never touched the tick-box words keeps inheriting better ones.
 *
 * Light-only, like every admin surface.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_CONSENT_TEXT, DEFAULT_RECAP_QUESTIONS } from "@shared/comms/settings";
import { refusal } from "@/components/admin/adminApi";
import { commsCall, whenOfIso, type SettingsPayload } from "./commsSettingsApi";
import { EmailField } from "./EmailField";
import { Refused, inputCls, primaryCls, secondaryCls, useSaver, type EditorProps } from "./CommsSetupEditors";

const SETTINGS = "/admin/comms/settings";

// ── 5. The postal address ───────────────────────────────────────────────────

export function PostalAddressEditor(props: EditorProps) {
  const [draft, setDraft] = useState(props.data.settings.postalAddress);
  const { busy, refused, save } = useSaver(props);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">Postal address</span>
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"Street and number\nTown, postcode\nCountry"}
          className={`${inputCls} font-sans`}
        />
      </label>
      <p className="text-xs text-gray-500">It goes in the footer of every email the village sends in bulk, the way it would on an envelope.</p>
      <button
        type="button"
        disabled={busy || draft.trim() === props.data.settings.postalAddress.trim()}
        onClick={() => save(SETTINGS, "PUT", { postalAddress: draft }, "Postal address saved")}
        className={primaryCls}
      >
        {busy ? "Saving..." : "Save address"}
      </button>
      <Refused text={refused} />
    </div>
  );
}

// ── 6. The reply-to inbox for each path: the old Email Settings ────────────

interface Inboxes {
  investor: string;
  steward: string;
  resident: string;
  prosperity: string;
}

/**
 * The four inboxes each kind of form is routed to, read from and saved to
 * `/api/admin/email-config` exactly as the old Email Settings screen did, so
 * every route and every link that knew that screen keeps working. The same
 * inboxes receive replies to each path's emails.
 */
export function ReplyToEditor(props: EditorProps) {
  const { password } = props;
  const [cfg, setCfg] = useState<Inboxes>({ investor: "", steward: "", resident: "", prosperity: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await commsCall<Partial<Inboxes>>("/admin/email-config", password);
    if (r.ok) {
      setCfg({
        investor: r.data.investor ?? "",
        steward: r.data.steward ?? "",
        resident: r.data.resident ?? "",
        prosperity: r.data.prosperity ?? "",
      });
    } else {
      toast.error("Failed to load email settings");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    const r = await commsCall("/admin/email-config", password, { method: "PUT", body: cfg });
    if (r.ok) {
      toast.success("Email settings saved");
      // The checklist reads the same document, so it is asked again.
      const fresh = await commsCall<SettingsPayload>(SETTINGS, password);
      if (fresh.ok) props.apply(fresh.data);
    } else {
      toast.error(refusal(r.data, "Failed to save"));
    }
    setSaving(false);
  };

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>;
  return (
    <div className="space-y-4">
      <EmailField
        label="Business Inquiries (Prosperity / Contact)"
        value={cfg.prosperity}
        onChange={(v) => setCfg({ ...cfg, prosperity: v })}
        hint="Receives business and contact form submissions, and replies to the Prosperity Creator path."
      />
      <EmailField
        label="Investor"
        value={cfg.investor}
        onChange={(v) => setCfg({ ...cfg, investor: v })}
        hint="Receives investor enquiries and document requests, and replies to the investor path."
      />
      <EmailField
        label="Core Team (Steward)"
        value={cfg.steward}
        onChange={(v) => setCfg({ ...cfg, steward: v })}
        hint="Receives Village Steward applications, and replies to the steward path."
      />
      <EmailField
        label="Resident"
        value={cfg.resident}
        onChange={(v) => setCfg({ ...cfg, resident: v })}
        hint="Receives Resident applications and waitlist signups, and replies to the resident path."
      />
      <button type="button" onClick={save} disabled={saving} className={primaryCls}>
        {saving ? "Saving..." : "Save inboxes"}
      </button>
    </div>
  );
}

// ── 7. Who writes back for each path ────────────────────────────────────────

export function PathContactsEditor(props: EditorProps) {
  const { data } = props;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.paths.map((p) => [p.id, data.settings.pathContacts[p.id] ?? ""])),
  );
  const { busy, refused, save } = useSaver(props);
  const known = new Set(data.members.map((m) => m.id));
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        At three weeks, each path's journey asks this person to write to whoever is walking it. With nobody named, the request goes to the path's
        inbox above.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.paths.map((p) => (
          <label key={p.id} className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">{p.label}</span>
            <select
              value={draft[p.id] ?? ""}
              onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })}
              className={inputCls}
            >
              <option value="">Nobody yet</option>
              {draft[p.id] && !known.has(draft[p.id]) && <option value={draft[p.id]}>A member who has left</option>}
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => save(SETTINGS, "PUT", { pathContacts: draft }, "Path contacts saved")}
        className={primaryCls}
      >
        {busy ? "Saving..." : "Save path contacts"}
      </button>
      <Refused text={refused} />
    </div>
  );
}

// ── 8. The tick-box words ───────────────────────────────────────────────────

export function ConsentWordsEditor(props: EditorProps) {
  const current = props.data.settings.consentText;
  const [draft, setDraft] = useState(current);
  const { busy, refused, save } = useSaver(props);
  const own = current !== DEFAULT_CONSENT_TEXT;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">The words beside the box</span>
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${inputCls} font-sans`} />
      </label>
      <p className="text-xs text-gray-500">
        Every public form that leads to a path shows these words beside its tick-box. Ticked, the person is walked through the next steps by
        email. Left unticked, they get the acknowledgement and nothing more.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !draft.trim() || draft.trim() === current}
          onClick={() => save(SETTINGS, "PUT", { consentText: draft }, "Tick-box words saved")}
          className={primaryCls}
        >
          {busy ? "Saving..." : "Save words"}
        </button>
        {own && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await save(SETTINGS, "PUT", { consentText: "" }, "Back to the platform's words")) setDraft(DEFAULT_CONSENT_TEXT);
            }}
            className={secondaryCls}
          >
            Use the platform's words
          </button>
        )}
      </div>
      <Refused text={refused} />
    </div>
  );
}

// ── 9. The two recap questions ──────────────────────────────────────────────

export function RecapQuestionsEditor(props: EditorProps) {
  const current = props.data.settings.recapQuestions;
  const [first, setFirst] = useState(current[0]);
  const [second, setSecond] = useState(current[1]);
  const { busy, refused, save } = useSaver(props);
  const own = current[0] !== DEFAULT_RECAP_QUESTIONS[0] || current[1] !== DEFAULT_RECAP_QUESTIONS[1];
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">First question, answered yes or no with one click</span>
        <input type="text" value={first} onChange={(e) => setFirst(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">Second question, answered in a few words</span>
        <input type="text" value={second} onChange={(e) => setSecond(e.target.value)} className={inputCls} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !first.trim() || !second.trim()}
          onClick={() => save(SETTINGS, "PUT", { recapQuestions: [first, second] }, "Recap questions saved")}
          className={primaryCls}
        >
          {busy ? "Saving..." : "Save questions"}
        </button>
        {own && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await save(SETTINGS, "PUT", { recapQuestions: null }, "Back to the platform's questions")) {
                setFirst(DEFAULT_RECAP_QUESTIONS[0]);
                setSecond(DEFAULT_RECAP_QUESTIONS[1]);
              }
            }}
            className={secondaryCls}
          >
            Use the platform's questions
          </button>
        )}
      </div>
      <Refused text={refused} />
    </div>
  );
}

// ── 10. Who runs comms ──────────────────────────────────────────────────────

export function WhoRunsCommsEditor({ data }: EditorProps) {
  return (
    <div className="space-y-2">
      {data.holders.length ? (
        <ul className="list-disc pl-5 text-sm text-gray-700">
          {data.holders.map((h) => (
            <li key={h.id}>{h.name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">Nobody holds the power to run comms through a role yet, so the admins do it.</p>
      )}
      <p className="text-xs text-gray-500">
        Running comms is an appointment: a role carries the power, and whoever is seated in that role holds it.{" "}
        <a href="/admin?tab=game-roles" className="text-teal-deep underline">
          Give it to a role in Game Roles
        </a>
      </p>
    </div>
  );
}

// ── 11. Investor words reviewed ─────────────────────────────────────────────

export function InvestorWordsEditor(props: EditorProps) {
  const r = props.data.settings.investorWordsReviewed;
  const { busy, refused, save } = useSaver(props);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {r
          ? `Reviewed by ${r.by} on ${whenOfIso(r.at)}.`
          : "The investor path's emails wait for a person to read them. Until then it sends only its welcome and its three-week check-in."}{" "}
        <a href="/admin?tab=comms-words" className="text-teal-deep underline">
          Read them in Words
        </a>
      </p>
      {r ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => save(SETTINGS, "PUT", { investorWordsReviewed: false }, "Review cleared")}
          className={secondaryCls}
        >
          Clear the review
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => save(SETTINGS, "PUT", { investorWordsReviewed: true }, "Marked as reviewed")}
          className={primaryCls}
        >
          I have read the investor emails
        </button>
      )}
      <Refused text={refused} />
    </div>
  );
}

// ── 12. The rehearsal inbox ─────────────────────────────────────────────────

export function RehearsalInboxEditor(props: EditorProps) {
  const named = props.data.settings.rehearsalTo;
  const [draft, setDraft] = useState(named.join(", "));
  const { busy, refused, save } = useSaver(props);
  const list = draft
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        While comms is in preview, every gathering, path and letter email goes to these addresses instead of to the person, marked as a
        rehearsal. Password links and member notices still reach their person.{" "}
        {named.length ? "" : `With none named, rehearsals go to the admins${props.data.admins.length ? `: ${props.data.admins.join(", ")}` : ""}.`}
      </p>
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">Rehearsal inbox</span>
        <input
          type="text"
          inputMode="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="one@example.org, two@example.org"
          className={inputCls}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || list.length === 0}
          onClick={() => save(SETTINGS, "PUT", { rehearsalTo: list }, "Rehearsal inbox saved")}
          className={primaryCls}
        >
          {busy ? "Saving..." : "Save inbox"}
        </button>
        {named.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await save(SETTINGS, "PUT", { rehearsalTo: [] }, "Rehearsals go to the admins again")) setDraft("");
            }}
            className={secondaryCls}
          >
            Send rehearsals to the admins
          </button>
        )}
      </div>
      <Refused text={refused} />
    </div>
  );
}
