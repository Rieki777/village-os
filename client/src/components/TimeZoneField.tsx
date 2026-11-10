/**
 * "Your time zone" on the member's profile (role journey L6). Saved once, then
 * every time that shows in the app reads in it. Left unset, the browser's zone
 * is used and said so.
 */
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMyTimeZone } from "@/lib/useMyTimeZone";
import { browserTimeZone, isValidTimeZone } from "@shared/memberTimeZone";

export default function TimeZoneField() {
  const { t } = useLingui();
  const { saved, zone, loaded, save } = useMyTimeZone();
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!loaded) return null;
  const value = draft ?? saved ?? "";
  const browser = browserTimeZone();
  const run = async (next: string | null) => {
    if (next !== null && !isValidTimeZone(next)) return setNote(t({ message: "Use a place name, such as Europe/Lisbon.", context: "time zone field" }));
    setNote((await save(next)) ? t({ message: "Saved.", context: "time zone field" }) : t({ message: "That did not save. Try again.", context: "time zone field" }));
    setDraft(null);
  };
  return (
    <section aria-labelledby="my-time-zone" className="rounded-lg border p-4 space-y-2">
      <h3 id="my-time-zone" className="font-semibold"><Trans context="time zone field">Your time zone</Trans></h3>
      <p className="text-sm text-muted-foreground">
        {saved
          ? <Trans context="time zone field">Times across the village show in this zone.</Trans>
          : <Trans context="time zone field">Times across the village show in this zone. You have not chosen one, so we use your browser's ({zone}).</Trans>}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label={t({ message: "Time zone", context: "time zone field" })}
          className="border rounded px-2 py-1 min-w-[16rem]"
          value={value}
          placeholder={browser ?? "Europe/Lisbon"}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" className="border rounded px-3 py-1" onClick={() => run(value.trim())} disabled={!value.trim()}><Trans context="time zone field">Save</Trans></button>
        {browser && browser !== saved && <button type="button" className="border rounded px-3 py-1" onClick={() => run(browser)}><Trans context="time zone field">Use my browser's ({browser})</Trans></button>}
        {saved && <button type="button" className="border rounded px-3 py-1" onClick={() => run(null)}><Trans context="time zone field">Clear</Trans></button>}
      </div>
      {note && <p role="status" className="text-sm">{note}</p>}
    </section>
  );
}
