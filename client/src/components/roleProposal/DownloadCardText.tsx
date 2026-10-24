/**
 * "Download my card as text" (Rye, 2026-10-24): the member's card in the role
 * card format, saved as role-card.txt, from the proposal's share step or the
 * profile. The route sends it to its owner only, so the button reads it with
 * the member's token and saves what comes back.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { ROLE_CARD_FILENAME_CLIENT, fetchCardText, saveTextFile } from "./roleCardApi";
import { RC_WORDS } from "./roleCardWords";
import { QUIET } from "./parts";

export default function DownloadCardText({ url, className = QUIET }: { url: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setFailed(null);
    const r = await fetchCardText(url);
    setBusy(false);
    if (!r.ok) return setFailed(r.status === 0 ? RC_WORDS.downloadFailed : r.error);
    saveTextFile(r.data, ROLE_CARD_FILENAME_CLIENT);
  };
  return (
    <span className="inline-grid gap-1" data-download-card="">
      <button type="button" onClick={() => void go()} disabled={busy} className={className}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {RC_WORDS.download}
      </button>
      {failed && (
        <span role="alert" className="text-sm text-coral">
          {failed}
        </span>
      )}
    </span>
  );
}
