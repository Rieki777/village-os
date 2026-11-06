/**
 * "MY LINES IN <VILLAGE>": a card a member can post (Rye, 2026-10-23: "Great!").
 *
 * Drawn on a canvas in this device (shareCard.ts) and handed to the phone's
 * share sheet as an image; where a browser cannot share files it downloads
 * instead. It carries what a public profile already shows (Rye, 2026-10-22:
 * key numbers may be public): the profile, its two words, the type and the four
 * Activation keys. NEVER a birth date, time or place: this file never sees one.
 */
import { useState } from "react";
import type { GeneKeysView } from "@shared/geneKeys";
import { useVillageName } from "@/hooks/useVillageName";
import { shareCardBlob, shareCardWords } from "./shareCard";
import { BTN_PLAIN, HINT } from "./ui";

export default function ShareLines({ view }: { view: GeneKeysView }) {
  const village = useVillageName("my village");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const blob = await shareCardBlob(view, village);
      if (!blob) return setSaid("This browser cannot draw the card.");
      const file = new File([blob], "my-lines.png", { type: "image/png" });
      const download = () => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "my-lines.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setSaid("Saved as an image. Post it wherever you like.");
      };
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: shareCardWords(view, village).text });
          setSaid("Shared.");
        } catch (e) {
          // A share sheet the member closed is not an error. A browser that says it can share files
          // and then refuses (desktop Chrome without a share target does) still owes them the card.
          if ((e as { name?: string })?.name !== "AbortError") download();
        }
      } else {
        download();
      }
    } catch {
      setSaid("The card could not be drawn. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={BTN_PLAIN} disabled={busy} onClick={share}>
        {busy ? "Drawing your card" : "Share my lines"}
      </button>
      {said ? (
        <p role="status" className={HINT}>
          {said}
        </p>
      ) : null}
    </div>
  );
}
