/**
 * `/aligned`: THE VILLAGE'S REGISTER OF WHAT IT HAS ALIGNED WITH (seat settings PR6).
 *
 * Every set of terms in the alignment store, every version, for a member
 * holding `terms.read`. A visitor gets the sign-in card; a signed-in guest is
 * answered 401 by the server and gets the same card without the doors.
 *
 * It follows the Decisions page: the record grouped by the year each text was
 * written in the village's zone, newest first, read a page at a time, and no
 * count anywhere (R55). A year with one text and a year with forty get the
 * same heading.
 *
 * KINDS. "Seat terms" and, since seat settings PR9, "Membership letter". The
 * kinds come from the server, which reads them from REGISTER_KINDS
 * (shared/alignedRegister.ts); the filter draws once there are two, which the
 * letter made true, and "Village agreement" will arrive with no change here.
 *
 * SEARCH runs on the server, over a BM25 index built for that one request
 * from the rows this member may read. It never reaches the concierge.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Search, ScrollText } from "lucide-react";
import Layout from "@/components/Layout";
import { SignInDoors } from "@/components/modules/ModuleGate";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import RegisterEntry from "@/components/alignment/RegisterEntry";
import { fetchRegister } from "@/components/alignment/alignmentsApi";
import { ALIGNED_WORDS, type RegisterRow } from "@shared/alignedRegister";

type Phase = "loading" | "ready" | "members" | "error";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function Aligned() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [kinds, setKinds] = useState<Array<{ id: string; label: string }>>([]);
  const [kind, setKind] = useState<string | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [read, setRead] = useState(0);
  const [more, setMore] = useState(false);
  const [readingMore, setReadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setPhase("loading");
    void fetchRegister({ q: query || undefined, kind: kind ?? undefined }).then((a) => {
      if (!alive) return;
      if (a.ok) {
        setKinds(a.data.kinds ?? []);
        setRows(a.data.rows ?? []);
        setRead((a.data.rows ?? []).length);
        setMore(!!a.data.more);
        setPhase("ready");
      } else if (a.status === 401) setPhase("members");
      else {
        setError(a.error);
        setPhase("error");
      }
    });
    return () => {
      alive = false;
    };
  }, [user, query, kind]);

  /** Merged by id, never appended: offset paging over a growing record can hand back a row already here. */
  const readMore = async () => {
    if (readingMore) return;
    setReadingMore(true);
    const a = await fetchRegister({ offset: read, kind: kind ?? undefined });
    if (a.ok) {
      setRows((prev) => {
        const byId = new Map(prev.map((r) => [r.textId, r]));
        for (const r of a.data.rows ?? []) byId.set(r.textId, r);
        return Array.from(byId.values());
      });
      setRead((n) => n + (a.data.rows ?? []).length);
      setMore(!!a.data.more);
    } else setError(a.error);
    setReadingMore(false);
  };

  const years = useMemo(() => {
    const by = new Map<string, RegisterRow[]>();
    for (const r of rows) {
      const list = by.get(r.year);
      if (list) list.push(r);
      else by.set(r.year, [r]);
    }
    return Array.from(by.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <Layout>
      <section className="bg-teal-band py-10 text-white">
        <div className="container max-w-5xl px-4">
          <span className="text-sm font-medium uppercase tracking-widest text-amber-on-band">{ALIGNED_WORDS.eyebrow}</span>
          <h1 className="mt-1 flex items-center gap-3 font-display text-3xl font-bold sm:text-4xl">
            <ScrollText className="size-8 shrink-0" aria-hidden="true" />
            {ALIGNED_WORDS.title}
          </h1>
          <p className="mt-2 max-w-2xl leading-relaxed text-white">{ALIGNED_WORDS.lede}</p>
        </div>
      </section>

      <div className="container max-w-5xl px-4 py-8">
        {!user || phase === "members" ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-card-foreground">
            <h2 className="font-display text-2xl font-bold text-foreground">{ALIGNED_WORDS.membersOnly}</h2>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">{ALIGNED_WORDS.membersOnlyLine}</p>
            {!user && (
              <div className="mt-5">
                <SignInDoors next="/aligned" />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <form role="search" onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="aligned-search" className="block text-sm font-semibold text-foreground">
                  {ALIGNED_WORDS.searchLabel}
                </label>
                <input
                  id="aligned-search"
                  type="search"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={ALIGNED_WORDS.searchPlaceholder}
                  maxLength={200}
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button type="submit" className={`${buttonClass} bg-teal-deep text-white hover:bg-teal-deep-dark`}>
                <Search className="size-4" aria-hidden="true" />
                {ALIGNED_WORDS.search}
              </button>
            </form>

            {kinds.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={ALIGNED_WORDS.kinds}>
                {[{ id: null as string | null, label: ALIGNED_WORDS.everyKind }, ...kinds].map((k) => (
                  <button
                    key={k.id ?? "all"}
                    type="button"
                    aria-pressed={kind === k.id}
                    onClick={() => setKind(k.id)}
                    className={`${buttonClass} rounded-full border ${kind === k.id ? "border-teal-deep bg-teal-deep text-white" : "border-border bg-card text-foreground hover:bg-muted"}`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            )}

            {phase === "loading" && (
              <div className="flex justify-center py-16">
                <BreathingLoader label={ALIGNED_WORDS.loading} />
              </div>
            )}
            {phase === "error" && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}

            {phase === "ready" && query && (
              <section aria-labelledby="aligned-results-h">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="aligned-results-h" className="font-display text-xl font-bold text-foreground">
                    {ALIGNED_WORDS.results(query)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("");
                      setQuery("");
                    }}
                    className={`${buttonClass} border border-border bg-card text-foreground hover:bg-muted`}
                  >
                    {ALIGNED_WORDS.clear}
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="mt-3 text-muted-foreground">{ALIGNED_WORDS.noResults}</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {rows.map((r) => (
                      <li key={r.textId}>
                        <RegisterEntry row={r} headingLevel={3} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {phase === "ready" && !query && rows.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
                <p className="mx-auto max-w-md leading-relaxed text-muted-foreground">{ALIGNED_WORDS.empty}</p>
              </div>
            )}

            {phase === "ready" &&
              !query &&
              years.map(([year, list]) => (
                <section key={year} aria-labelledby={`aligned-y-${year}`}>
                  <h2 id={`aligned-y-${year}`} className="border-b border-border pb-1 font-display text-xl font-bold text-foreground">
                    {year}
                  </h2>
                  <ul className="mt-3 space-y-3">
                    {list.map((r) => (
                      <li key={r.textId}>
                        <RegisterEntry row={r} headingLevel={3} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

            {/* The rest of the record when somebody wants it. No count and no sense of a page left unfinished (R55). */}
            {phase === "ready" && !query && more && (
              <div>
                <button
                  type="button"
                  onClick={() => void readMore()}
                  disabled={readingMore}
                  className={`${buttonClass} border border-border bg-card text-foreground hover:bg-muted disabled:opacity-60`}
                >
                  {readingMore ? ALIGNED_WORDS.readingMore : ALIGNED_WORDS.more}
                </button>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ALIGNED_WORDS.moreLine}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
