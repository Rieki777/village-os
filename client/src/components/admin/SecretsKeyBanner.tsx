/**
 * THE SEALING KEY, SAID BEFORE ANYBODY TYPES A KEY.
 *
 * Every key saved under Admin, Integrations is sealed with VILLAGE_SECRETS_KEY,
 * and with no usable key the server refuses the save (server/lib/secrets.ts).
 * That refusal used to be the first thing a founder learned about the key: they
 * fetched a Stripe key, pasted it, pressed Save and were told to go and set a
 * variable. On 2026-10-02 it was worse. The variable WAS set, in the wrong shape,
 * and every message still said "not set", which sent the founder back to a step
 * they had already done.
 *
 * So the page says it first. `GET /api/admin/integrations` carries
 * `villageSecretsKey: { configured, problem }`, where `problem` is the server's
 * own sentence naming what is wrong (unset, quotes, a pasted NAME=, base64, the
 * wrong length) and never any part of the value. This banner prints that
 * sentence and the steps, and each card's Save button says why it will refuse
 * instead of letting a founder type a key only to have it bounce.
 *
 * Its own file because client/src/pages/Admin.tsx is on a line ratchet that only
 * turns down. Light-only, like the rest of this folder (the admin workspace is
 * fixed-light by ruling; scripts/check-tailwind-gray.mjs LIGHT_SURFACES), so the
 * inks are the fixed ones the neighbouring Integrations cards use.
 */

/** What the server says about the key. Absent on a server older than this file, which reads as fine. */
export interface VillageSecretsKeyStatus {
  configured: boolean;
  problem: string | null;
}

/** The banner's id, so a refusing Save button can point a screen reader at the reason. */
export const SECRETS_KEY_BANNER_ID = "village-secrets-key-banner";

/** Windows PowerShell has no openssl. Node is already there for anybody running this platform. */
const NODE_ONE_LINER = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

/** True only when the server said, in so many words, that the key is not usable. */
export function sealingBlocked(status: VillageSecretsKeyStatus | null | undefined): boolean {
  return !!status && !status.configured;
}

export default function SecretsKeyBanner({ status }: { status?: VillageSecretsKeyStatus | null }) {
  if (!sealingBlocked(status)) return null;
  const code = "font-mono text-[11px] bg-white border border-amber-200 rounded px-1 py-0.5 break-all";
  return (
    <section
      id={SECRETS_KEY_BANNER_ID}
      aria-labelledby={`${SECRETS_KEY_BANNER_ID}-title`}
      className="mb-6 max-w-2xl bg-amber-50 border border-amber-200 rounded-xl p-5"
    >
      <h3 id={`${SECRETS_KEY_BANNER_ID}-title`} className="text-sm font-semibold text-amber-900">
        This deployment cannot save integration keys yet
      </h3>
      <p className="text-sm text-amber-900 mt-1">{status?.problem}</p>
      <p className="text-xs text-amber-800 mt-2">
        Every Save on this page is refused until that is fixed. Keys set in the hosting environment
        keep working meanwhile.
      </p>
      <ol className="list-decimal pl-5 mt-3 space-y-2 text-xs text-gray-700">
        <li>
          <span className="font-semibold text-gray-900">Generate the key.</span> On Mac or Linux:{" "}
          <code className={code}>openssl rand -hex 32</code>. On Windows PowerShell, which has no
          openssl: <code className={code}>{NODE_ONE_LINER}</code>
        </li>
        <li>
          <span className="font-semibold text-gray-900">Save it in a password manager first.</span>{" "}
          Losing or changing it makes every key saved in Integrations unreadable, so each would have
          to be typed again.
        </li>
        <li>
          <span className="font-semibold text-gray-900">On Railway:</span> open the project, then the
          web service (the one serving the village's address, never the database), then Variables,
          then New Variable. The name is <code className={code}>VILLAGE_SECRETS_KEY</code> and the
          value is ONLY the 64 characters: no quotes, no spaces, no name. Then Deploy if Railway
          shows staged changes, and wait for the deploy to read Active.
        </li>
        <li>
          <span className="font-semibold text-gray-900">On any other host:</span> set the same
          environment variable and restart.
        </li>
        <li>
          <span className="font-semibold text-gray-900">Come back here and save your keys.</span>
        </li>
      </ol>
    </section>
  );
}

/**
 * A card's Save button. While the key is not usable it says so on its face and
 * stays shut, at full strength so the reason can be read: a faded "Save" that
 * does nothing explains nothing, and an open one takes a pasted key and bounces
 * it. Clearing a key needs no sealing key and is a separate button the card
 * keeps.
 */
export function SealedSaveButton({
  status,
  busy,
  empty,
  onSave,
}: {
  status?: VillageSecretsKeyStatus | null;
  busy: boolean;
  empty: boolean;
  onSave: () => void;
}) {
  if (sealingBlocked(status)) {
    return (
      <button
        type="button"
        disabled
        aria-describedby={SECRETS_KEY_BANNER_ID}
        className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 font-medium cursor-not-allowed"
      >
        Save needs VILLAGE_SECRETS_KEY: see the steps above
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={busy || empty}
      className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
    >
      Save
    </button>
  );
}
