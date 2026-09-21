/**
 * Reserve a home: slice 1 of the reservation flow (0077).
 *
 * A person picks a home type, tells us how to reach them, and the intent is
 * recorded. NO MONEY MOVES ON THIS PAGE. The deposit is a later step and it
 * reuses server/lib/payments.ts.
 *
 * ── THE HAMLET PLUMBING, AND WHAT ACTUALLY SENDS IT TODAY ────────────────
 * This page READS `?from=map&hamlet=<structureKey>` and `?type=<homeType>`
 * off the query string on first render, so a link carrying them lands someone
 * on the right home in the right hamlet and a shared link keeps the context.
 *
 * `hamlet` is resolved at first render and `type` is not, and the difference
 * is 0131. Which homes exist became this village's own answer rather than a
 * constant compiled into this file, so it arrives over the network and the
 * link's `type` is held raw until it does. See `preselectedHome`.
 *
 * NOTHING PRODUCES `hamlet=` YET, measured 2026-08-14: zero hits for
 * `hamlet=` outside two comments and one column comment, and the map artifact
 * (docs/prototypes/grounds-v0.html) contains no `/reserve` link at all. The
 * two links into this page are Housing.tsx's home cards and
 * ResidentJourney.tsx's deposit stage, and Housing.tsx only forwards a
 * `hamlet` it was handed. So every arrival today has no hamlet: the block
 * below does not render, and the intent is recorded with `structureKey` null,
 * which is a legitimate state this route was built to accept. The producer is
 * one link out of a structure on the map, carrying that structure's own key,
 * and it belongs to the map lane.
 *
 * ── THE EXAMPLE RULE ─────────────────────────────────────────────────────
 * This page shows how many homes are open in the chosen hamlet, and it must
 * never present a number the founder has not set as though it were real. The
 * predicate is presence, and nothing else: the structure key either appears
 * in `entries` from the server or it does not. This page never inspects
 * counts for nullness and never re-derives what "set" means. The server
 * applies that filter once.
 */
import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Link } from "wouter";
import { Home, ArrowLeft, Check, MapPin } from "lucide-react";
import { hamletNumbers, homeChoices, preselectedHome, type PublicHome } from "@/lib/housingForm";

/*
 * THE FOUR HOME TYPES THAT USED TO LIVE HERE ARE GONE (0131).
 *
 * They were a module constant carrying a label and a size for each key, a
 * SECOND COPY of the four tiers in Housing.tsx, and the two copies had
 * already drifted into different wording for the same home: one page hyphenated
 * the range and the other spelled it out, for identical figures. Nothing in
 * this repository imports anything under client/src/pages, so neither copy was
 * reachable by any test and no gate could see the drift. Both are recorded in
 * drizzle/0131_a_village_names_its_own_homes.sql and deliberately not repeated
 * here, because client/src/lib/housingForm.test.ts fails on any of those
 * literals appearing in this file.
 *
 * Both surfaces now read the village's own homes off the one route this page
 * was already fetching. A village that has published none cannot take a
 * reservation for a home it has not described, and this page says so rather
 * than offering four homes nobody chose.
 */

interface HousingEntry {
  structureKey: string;
  label: string | null;
  total: number;
  taken: number;
  open: number;
}

export default function ReserveHome() {
  /*
   * Read once, on first render. `useState` with an initialiser and not a
   * `useEffect`: reading the query string in an effect renders one frame with
   * no hamlet, which flashes the example label on a hamlet that is set.
   */
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const hamlet = useMemo(() => {
    const raw = params.get("hamlet") ?? "";
    return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : "";
  }, [params]);
  const arrivedFrom = params.get("from") === "map" ? "map" : "site";

  /*
   * The home a link asked for, held raw until the village's own homes land.
   *
   * It CANNOT be resolved at first render any more, because which homes exist
   * is now this village's answer and arrives over the network. Trusting the
   * string would preselect a home a founder has since cleared, and the person
   * would submit a request for a home this village does not offer.
   */
  const wantedType = params.get("type") ?? "";
  const [homeType, setHomeType] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  /*
   * The honeypot, the house pattern from POST /api/forms/submit. A field only
   * a script fills. It is state like any other field so React owns it and a
   * value set by anything else is visible on submit.
   */
  const [hp, setHp] = useState("");

  const [entries, setEntries] = useState<HousingEntry[] | null>(null);
  /** The homes this village published (0131). Same route, same round trip. */
  const [homes, setHomes] = useState<PublicHome[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/housing/public")
      .then((r) => (r.ok ? r.json() : { entries: [], homes: [] }))
      .then((d) => {
        if (!alive) return;
        setEntries(Array.isArray(d?.entries) ? d.entries : []);
        setHomes(Array.isArray(d?.homes) ? d.homes : []);
      })
      /*
       * A failed read leaves both as empty lists. For hamlets that means
       * every number is labelled an example; for homes it means this page
       * offers none. Fail-closed both ways: a network blip must never promote
       * example numbers to real ones, and must never offer a home this
       * village has not described.
       */
      .catch(() => {
        if (!alive) return;
        setEntries([]);
        setHomes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Resolve the link's `?type=` once, when the homes arrive, and never over a
   * choice the person has already made. `preselectedHome` is the predicate
   * and it lives in @/lib/housingForm so a test can run it: presence in the
   * published list is the whole of it, so a stale link lands on the form with
   * nothing chosen rather than on a home this village no longer offers.
   */
  useEffect(() => {
    if (homes === null) return;
    setHomeType((current) => current || preselectedHome(homes, wantedType));
  }, [homes, wantedType]);

  const choices = homeChoices(homes);

  /*
   * Presence in `entries` IS the predicate, and it has THREE answers. See
   * `hamletNumbers` in @/lib/housingForm, where a test can run it: this page
   * used to ask `entries?.find(...)` directly, which reads null as absent and
   * absent as example, so a hamlet the founder HAD set was announced as unset
   * for the length of the fetch and then corrected.
   */
  const numbers = hamletNumbers(entries, hamlet);
  const hamletName = entries?.find((e) => e.structureKey === hamlet)?.label || hamlet;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!homeType) return setError("Choose a home type to continue.");
    if (!name.trim()) return setError("Please add your name.");
    if (!email.trim()) return setError("Please add an email address.");
    setSending(true);
    try {
      const res = await fetch("/api/housing/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeType,
          name,
          email,
          phone,
          notes,
          structureKey: hamlet || null,
          arrivedFrom,
          hp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "That did not go through. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("That did not go through. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Layout>
        <section className="py-24 bg-background">
          <div className="container max-w-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
              <Check className="w-7 h-7 text-teal" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground mb-4">
              Your reservation request is in
            </h1>
            {/*
              This screen used to promise a person that someone would be in
              touch while the server told nobody: the intent landed in a table
              and the only surface that showed it was an Admin tab a founder
              had no reason to open. The route now emails the pathway inbox
              and sends this person their own copy, so the sentence below is
              true and the confirmation line is checkable by the reader.
            */}
            <p className="text-muted-foreground mb-8">
              We have your details and the home you have in mind. A copy is on its way to{" "}
              {email}. Someone from the founding team will be in touch to walk you through the
              deposit and what happens next.
            </p>
            <Link
              href="/housing"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium"
            >
              Back to housing options
            </Link>
          </div>
        </section>
      </Layout>
    );
  }

  /*
   * NO HOMES PUBLISHED, SO NOTHING TO RESERVE (0131).
   *
   * This page used to offer four homes the platform shipped knowing about,
   * with their sizes, so a village that had never described a home still took
   * reservations against another village's square footage. The server refuses
   * a homeType outside the four keys, so the form cannot be submitted with
   * nothing chosen anyway:
   * the choice is between saying this plainly and drawing a chooser that
   * offers homes nobody at this village chose.
   *
   * `unknown` is NOT this state and must never render it. It is the in-flight
   * window, and a page that announces "no homes yet" for the length of a
   * round trip and then draws four has told a visitor something false.
   */
  if (choices.kind === "none") {
    return (
      <Layout>
        <section className="py-24 bg-background">
          <div className="container max-w-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
              <Home className="w-7 h-7 text-teal" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground mb-4">
              The homes are not listed yet
            </h1>
            <p className="text-muted-foreground mb-8">
              Nobody here has published what the homes are or what they cost, so there is
              nothing to hold for you today. Come back, or reach the founding team through
              the housing page and tell them what you are looking for.
            </p>
            <Link
              href="/housing"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-deep text-white font-medium"
            >
              Back to housing
            </Link>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="py-16 bg-background">
        <div className="container max-w-2xl">
          <Link
            href="/housing"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Housing options
          </Link>

          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
            Reserve your home
          </h1>
          <p className="text-muted-foreground mb-8">
            Tell us which home you want and where you want it. This holds your place in the
            queue. The deposit comes after we have spoken.
          </p>

          {hamlet && (
            <div className="mb-8 p-5 rounded-2xl bg-card shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-teal" />
                <span className="font-display font-semibold text-foreground">{hamletName}</span>
              </div>
              {numbers.kind === "set" ? (
                <p className="text-sm text-muted-foreground">
                  {numbers.open} of {numbers.total} homes still open here.
                </p>
              ) : numbers.kind === "example" ? (
                <p className="text-sm text-muted-foreground">
                  Example numbers. The founder has not set this hamlet yet.
                </p>
              ) : null}
            </div>
          )}

          <form onSubmit={submit} className="space-y-6">
            <fieldset>
              <legend className="font-display text-lg font-semibold text-foreground mb-3">
                Which home?
              </legend>
              {/* The village's own homes, named and sized in its own words.
                  A home with no size and no price cannot reach this list:
                  the server publishes a home type only once it has a name and
                  one of the two, so a button here always says something about
                  the home behind it. Blank fields draw nothing. */}
              {choices.kind === "unknown" ? (
                <p className="text-sm text-muted-foreground">Loading the homes.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {choices.homes.map((home) => (
                    <button
                      key={home.homeType}
                      type="button"
                      onClick={() => setHomeType(home.homeType)}
                      aria-pressed={homeType === home.homeType}
                      className={`text-left p-4 rounded-xl border transition ${
                        homeType === home.homeType
                          ? "border-teal bg-teal/10"
                          : "border-border bg-card hover:border-teal/40"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <Home className="w-4 h-4 text-teal" />
                        {home.name}
                      </span>
                      {home.size && (
                        <span className="block text-sm text-muted-foreground mt-1">{home.size}</span>
                      )}
                      {home.price && (
                        <span className="block text-sm text-muted-foreground">{home.price}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-border bg-card"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-border bg-card"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1">
                Phone <span className="text-muted-foreground font-normal">(optional)</span>
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1">
                Anything we should know?
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card"
              />
            </label>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={sending}
              className="w-full px-6 py-4 rounded-xl bg-teal-deep text-white font-medium disabled:opacity-60"
            >
              {sending ? "Sending" : "Request this home"}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              No payment is taken on this page.
            </p>

            {/*
              Honeypot. Off screen, out of the tab order, hidden from assistive
              tech, so no person reaches it. A filled one gets a success answer
              from the server and stores nothing, which is what keeps a bot
              from learning it was caught. Kept LAST in the form because
              `space-y-6` gives every child after the first a top margin, and
              putting it first would push the whole form down.

              The NAME is `hp` and not something like `company` on purpose. A
              honeypot is only safe while nothing but a bot can fill it, and a
              password manager filling a field it recognises as an
              organisation would make the server silently drop a real person's
              reservation and answer success. `hp` matches no autofill
              heuristic and matches the field POST /api/forms/submit already
              uses. `tabIndex={-1}` keeps it off the keyboard path, which is
              also what makes the focusable input inside `aria-hidden` safe.
            */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
              <input
                type="text"
                name="hp"
                tabIndex={-1}
                autoComplete="off"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
              />
            </div>
          </form>
        </div>
      </section>
    </Layout>
  );
}
