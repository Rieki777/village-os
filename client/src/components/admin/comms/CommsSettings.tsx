/**
 * COMMS SETTINGS: everything a founder supplies to make the village's email
 * work, in one place, editable then and later (the comms build spec 5.15 and 6).
 *
 * Rye, 2026-10-02: "For all the things you need from me (all founders would
 * need to add them) add them all in the admin setup for the comms so that
 * founders can add/edit these vital details."
 *
 * THE SCREEN, top to bottom:
 *
 *   the setup checklist   thirteen items, each with what is true now, what to
 *                         do next, and its own editor underneath. An item that
 *                         is required and not done opens by itself; every
 *                         other item opens with Change.
 *   the dials             the `comms.*` game variables, through the same card
 *                         and the same route the Module Library uses
 *                         (ModuleSettingsSection), so there is one editor for
 *                         a dial wherever it shows.
 *   Pause all             holds every kind of email except essential mail and
 *                         member notices.
 *
 * It began as the old Email Settings (moved out of Admin.tsx by the foundation
 * lane), and that screen lives on as item 6: the same four inboxes, read from
 * and saved to `/api/admin/email-config`. The old `email-settings` tab key
 * still renders this screen.
 *
 * NOT MODULE-GATED. A village sets up its sending before it turns anything on
 * (client/src/lib/adminNav.ts leaves this tab out of TAB_MODULE on purpose).
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Circle } from "lucide-react";
import { toast } from "sonner";
import type { SetupItem, SetupKey } from "@shared/comms/settings";
import ModuleSettingsSection from "@/components/admin/ModuleSettingsSection";
import { refusal } from "@/components/admin/adminApi";
import { commsCall, type SettingsPayload } from "./commsSettingsApi";
import {
  ApiKeyEditor,
  DeliveryReportsEditor,
  DomainEditor,
  SenderEditor,
  TestEmailEditor,
  primaryCls,
  secondaryCls,
  type EditorProps,
} from "./CommsSetupEditors";
import {
  ConsentWordsEditor,
  InvestorWordsEditor,
  PathContactsEditor,
  PostalAddressEditor,
  RecapQuestionsEditor,
  RehearsalInboxEditor,
  ReplyToEditor,
  WhoRunsCommsEditor,
} from "./CommsSetupWords";

// The investor packet card in Admin edits two of the same inboxes with the
// same field, and imports it from here through the comms barrel.
export { EmailField } from "./EmailField";

/** One editor per checklist item. Keyed by the union, so an item with no editor does not compile. */
const EDITORS: Record<SetupKey, ComponentType<EditorProps>> = {
  "api-key": ApiKeyEditor,
  domain: DomainEditor,
  sender: SenderEditor,
  "delivery-reports": DeliveryReportsEditor,
  "postal-address": PostalAddressEditor,
  "reply-to": ReplyToEditor,
  "path-contacts": PathContactsEditor,
  "consent-words": ConsentWordsEditor,
  "recap-questions": RecapQuestionsEditor,
  "who-runs-comms": WhoRunsCommsEditor,
  "investor-words": InvestorWordsEditor,
  "rehearsal-inbox": RehearsalInboxEditor,
  "test-email": TestEmailEditor,
};

/** What the comms module's lifecycle means for what this screen sets up. */
function lifecycleNote(lifecycle: string): { tone: "amber" | "gray" | "teal"; text: string } {
  if (lifecycle === "preview") {
    return {
      tone: "amber",
      text: "Comms is rehearsing. Every gathering, path and letter email goes to the rehearsal inbox, marked as a rehearsal, and nobody else receives one.",
    };
  }
  if (lifecycle === "members" || lifecycle === "public") {
    return { tone: "teal", text: "Comms is live. Changes here apply to the next email." };
  }
  return {
    tone: "gray",
    text: "Comms is off. Set everything up here first. Password links, confirmations and member notices still go out while it is off.",
  };
}

function ChecklistRow({
  item,
  open,
  onToggle,
  children,
}: {
  item: SetupItem;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `comms-setup-${item.key}`;
  return (
    <li className={`border rounded-xl bg-white ${item.done ? "border-gray-200" : item.required ? "border-amber-300" : "border-gray-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <span
          className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${
            item.done ? "bg-green-100 text-green-700" : item.required ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
          }`}
          aria-hidden="true"
        >
          {item.done ? <Check className="w-4 h-4" /> : <Circle className="w-3 h-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            {item.n}. {item.label}
            <span className="sr-only">{item.done ? " (done)" : " (not done yet)"}</span>
            {item.required && (
              <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded align-middle">
                required
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-700 mt-1">{item.detail}</p>
          {!item.done && <p className="text-xs text-gray-500 mt-1">{item.fix}</p>}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={`${secondaryCls} shrink-0 inline-flex items-center gap-1`}
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {open ? "Close" : item.done ? "Change" : "Set up"}
          <span className="sr-only"> {item.label}</span>
        </button>
      </div>
      {open && (
        <div id={panelId} className="border-t border-gray-100 p-4">
          {children}
        </div>
      )}
    </li>
  );
}

function PauseAll({ data, password, apply }: { data: SettingsPayload; password: string; apply: (d: SettingsPayload) => void }) {
  const [busy, setBusy] = useState(false);
  const paused = data.settings.paused;
  const flip = async () => {
    setBusy(true);
    const r = await commsCall<SettingsPayload>("/admin/comms/settings", password, { method: "PUT", body: { paused: !paused } });
    setBusy(false);
    if (!r.ok) {
      toast.error(refusal(r.data, "That was not saved."));
      return;
    }
    apply(r.data);
    toast.success(paused ? "Email is flowing again" : "Automated email is paused");
  };
  return (
    <section
      aria-labelledby="comms-pause-all"
      className={`border rounded-xl p-4 ${paused ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}
    >
      <h3 id="comms-pause-all" className="text-sm font-semibold text-gray-900">
        Pause all {paused ? "(paused now)" : ""}
      </h3>
      <p className="text-sm text-gray-700 mt-1">
        {paused
          ? "Gathering emails, path emails and letters are held in the queue. Password links, confirmations people asked for and member notices still go. A held email that runs past its time is dropped."
          : "Holds every gathering email, path email and letter at once, for when something has gone wrong. Password links, confirmations people asked for and member notices keep going."}
      </p>
      <button type="button" onClick={flip} disabled={busy} className={`${paused ? primaryCls : secondaryCls} mt-3`}>
        {busy ? "Saving..." : paused ? "Let email flow again" : "Pause all automated email"}
      </button>
    </section>
  );
}

export default function CommsSettings({ password, openIntegrations }: { password: string; openIntegrations: () => void }) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The rows somebody opened or closed by hand. The rest follow "required and not done". */
  const [toggled, setToggled] = useState<Partial<Record<SetupKey, boolean>>>({});

  const load = useCallback(async () => {
    const r = await commsCall<SettingsPayload>("/admin/comms/settings", password);
    if (r.ok) {
      setData(r.data);
      setFailed(null);
    } else {
      setFailed(refusal(r.data, "Comms Settings could not be read."));
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900">Comms Settings</h2>
        {failed ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4" role="alert">
            {failed}
          </p>
        ) : (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        )}
      </div>
    );
  }

  const required = data.checklist.filter((i) => i.required);
  const doneRequired = required.filter((i) => i.done).length;
  const note = lifecycleNote(data.lifecycle);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Comms Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Everything the village's email needs from you, in one place. Every item can be changed again later.
        </p>
        <p
          className={`text-sm mt-3 rounded-lg px-3 py-2 border ${
            note.tone === "amber"
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : note.tone === "teal"
                ? "bg-white border-teal-deep/30 text-gray-800"
                : "bg-gray-50 border-gray-200 text-gray-700"
          }`}
        >
          {note.text}{" "}
          <a href="/admin?tab=modules" className="text-teal-deep underline">
            Module Library
          </a>
        </p>
      </div>

      <section aria-labelledby="comms-setup-checklist">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 id="comms-setup-checklist" className="text-base font-semibold text-gray-900">
            Setup checklist
          </h3>
          <p className="text-sm text-gray-600" role="status">
            {data.ready
              ? "Every required step is done. Comms is ready to turn on."
              : `${doneRequired} of ${required.length} required steps done.`}
          </p>
        </div>
        <ol className="space-y-3">
          {data.checklist.map((item) => {
            const Editor = EDITORS[item.key];
            const open = toggled[item.key] ?? (item.required && !item.done);
            return (
              <ChecklistRow
                key={item.key}
                item={item}
                open={open}
                onToggle={() => setToggled((t) => ({ ...t, [item.key]: !open }))}
              >
                <Editor data={data} password={password} apply={setData} />
              </ChecklistRow>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="comms-dials">
        <h3 id="comms-dials" className="text-base font-semibold text-gray-900">
          Dials
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          How the post office and the journeys behave: quiet hours, caps, reminder times, the recap window, guests, time votes, letters,
          how long records are kept, and the send rate. Open and click tracking stay off unless you turn them on, and each says why.
        </p>
        <ModuleSettingsSection moduleId="comms" moduleName="Village Comms" lifecycle={data.lifecycle} moduleNames={{}} password={password} />
      </section>

      <PauseAll data={data} password={password} apply={setData} />

      <p className="text-sm text-gray-600 border-t border-gray-100 pt-5">
        Other keys, such as Stripe and the AI guide, are in{" "}
        <button type="button" onClick={openIntegrations} className="text-teal-deep font-medium hover:underline">
          Integrations
        </button>
        . A key never travels back to a browser once saved.
      </p>
    </div>
  );
}
