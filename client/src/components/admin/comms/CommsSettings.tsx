/**
 * COMMS SETTINGS: everything a founder supplies to make the village's email
 * work, in one place (the comms build spec 5.15 and 6).
 *
 * IT STARTS AS THE OLD EMAIL SETTINGS, moved out of client/src/pages/Admin.tsx
 * unchanged in behaviour: the four inboxes each kind of form is routed to,
 * read from and saved to `/api/admin/email-config`. The old `email-settings`
 * tab key still renders this screen, so every link to it still lands. The
 * setup lane (B4) adds the checklist above the inboxes: the provider key, the
 * sending domain and its DNS records, the sender, delivery reports, the
 * postal address and the test email.
 *
 * NOT MODULE-GATED. A village sets up its sending before it turns anything
 * on, so this tab shows whatever the comms module's lifecycle is
 * (client/src/lib/adminNav.ts leaves it out of TAB_MODULE on purpose).
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";

interface EmailConfig {
  investor: string;
  steward: string;
  resident: string;
  prosperity: string;
}

/**
 * Hoisted OUT of the settings component on purpose (the cursor-jump bug): a
 * component type created inside a render is a NEW type every keystroke, so
 * React unmounted and remounted the input mid-word and focus fell to the top
 * of the section. Module scope = stable identity = the cursor stays where the
 * person is typing. Exported because the investor packet card in Admin edits
 * two of the same inboxes with the same field.
 */
export function EmailField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      {/* type=text, not email: these fields take a comma-separated LIST so
          several people can receive updates, and the browser's single-email
          validation would fight that. */}
      <input
        type="text"
        inputMode="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
        placeholder="one@example.org, two@example.org"
      />
      <p className="text-xs text-gray-400 mt-1">{hint} Several people? Separate addresses with commas.</p>
    </div>
  );
}

export default function CommsSettings({ password, openIntegrations }: { password: string; openIntegrations: () => void }) {
  const [cfg, setCfg] = useState<EmailConfig>({
    investor: "", steward: "", resident: "", prosperity: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, { headers: authHeaders(password) });
      const data = await res.json();
      setCfg({
        investor: data.investor ?? "",
        steward: data.steward ?? "",
        resident: data.resident ?? "",
        prosperity: data.prosperity ?? "",
      });
    } catch {
      toast.error("Failed to load email settings");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/email-config`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Email settings saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Comms Settings</h2>
          <p className="text-sm text-gray-500 mt-1">
            Form submissions are routed to the matching inbox via Resend.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading}
          className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep-dark disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-5 max-w-xl">
          <EmailField
            label="Business Inquiries (Prosperity / Contact)"
            value={cfg.prosperity}
            onChange={(v) => setCfg({ ...cfg, prosperity: v })}
            hint="Receives business and contact form submissions."
          />
          <EmailField
            label="Investor"
            value={cfg.investor}
            onChange={(v) => setCfg({ ...cfg, investor: v })}
            hint="Receives investor enquiries and document requests."
          />
          <EmailField
            label="Core Team (Steward)"
            value={cfg.steward}
            onChange={(v) => setCfg({ ...cfg, steward: v })}
            hint="Receives Village Steward applications."
          />
          <EmailField
            label="Resident"
            value={cfg.resident}
            onChange={(v) => setCfg({ ...cfg, resident: v })}
            hint="Receives Resident applications and waitlist signups."
          />

          <div className="border-t border-gray-100 pt-5">
            <p className="text-sm text-gray-600">
              API keys (Resend, Anthropic, Stripe) moved to{" "}
              <button onClick={openIntegrations} className="text-teal-deep font-medium hover:underline">
                Integrations
              </button>,{" "}
              one place for every third-party connection, and keys never travel
              back to a browser once saved.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
