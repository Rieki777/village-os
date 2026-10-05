/**
 * WORDS, in the Comms section of Admin (the comms build spec 5.5 and 6).
 *
 * Every email the village sends, grouped by the journey that sends it, with
 * the editor beside the list (WordsEditor.tsx). A village starts on the
 * platform's words and holds its own copy from its first save; each line says
 * which, and says so when the platform's words have improved since.
 *
 * The routes are server/routes/commsWords.ts. The tab follows the comms module
 * (client/src/lib/adminNav.ts), and so do its routes.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import WordsEditor from "./WordsEditor";
import { fetchWordsList, type WordsList } from "./wordsApi";

export default function CommsWords({ password }: { password: string }) {
  const [list, setList] = useState<WordsList | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const answer = await fetchWordsList(password);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError("");
    setList(answer.body);
    setSelected((current) => current ?? answer.body.groups[0]?.items[0]?.key ?? null);
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  const choose = (key: string) => {
    if (key === selected) return;
    if (dirty && !window.confirm("Leave these words without saving them?")) return;
    setDirty(false);
    setSelected(key);
  };

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">Words</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The words of every email your village sends. Change any of them, see the email as it will arrive, and send it to yourself
          first. Every save is a new version, and any version can come back.
        </p>
      </div>

      {list && !list.postalAddressSet && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Every email's footer carries your village's postal address, and none is set yet. Add it in Comms Settings.
        </p>
      )}
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!list && !error && <p className="py-12 text-center text-sm text-gray-400">Loading...</p>}

      {list && (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Emails" className="space-y-4">
            {list.groups.map((group) => (
              <div key={group.id}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.title}</p>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => choose(item.key)}
                        aria-current={item.key === selected ? "true" : undefined}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          item.key === selected ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white hover:border-gray-400"
                        }`}
                      >
                        <span className="block text-sm font-medium text-gray-900">{item.label}</span>
                        <span className="block truncate text-xs text-gray-500" title={item.subject}>
                          {item.subject}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                            {item.source === "village" ? `Yours, v${item.version}` : "Platform words"}
                          </span>
                          {item.upgradeAvailable && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">Improved version available</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="min-w-0">
            {selected ? (
              <WordsEditor key={selected} password={password} templateKey={selected} onChanged={load} onDirty={setDirty} />
            ) : (
              <p className="text-sm text-gray-500">Choose an email to read its words.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
