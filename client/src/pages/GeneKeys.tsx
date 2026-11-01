/**
 * /profile/gene-keys: FIND YOUR LINES.
 *
 * Four steps, all on the member's own device until the last:
 *
 *   1. When and where. Birth date, birth time (or "I don't know my birth
 *      time"), and the birth town, searched in a list this page downloaded
 *      once, so a typed town never leaves the browser.
 *   2. One more check, only when the time changes the answer. The day is
 *      scanned (the whole day when the time is unknown, half an hour either
 *      side when it is known) and every distinct result is offered with its
 *      window, "From 2:11 pm to 5:18 pm". Assuming noon gets type wrong for
 *      about 13% of people, so the page asks instead of guessing.
 *   3. The reveal: the two lines, the Activation Sequence, how they work best.
 *   4. Who sees it, and whether Maia may use it. Then the save, which carries
 *      the chart (26 activations) and nothing else.
 *
 * The sky maths is shared/geneKeysSky.ts (astronomy-engine), which is why this
 * page is its own lazy chunk: nobody pays for the library until they open it.
 * The page wears the profile's night world, like the seal and the card.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { GENE_KEYS_SITE, viewOf, type Chart, type GeneKeysView } from "@shared/geneKeys";
import { resultsAcross, type TimeWindow } from "@shared/geneKeysSky";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { saveMyGeneKeys, GeneKeysRefusal } from "@/lib/geneKeysApi";
import { GeneKeysLines } from "@/components/geneKeys/GeneKeysLines";
import GeneKeysReveal from "@/components/geneKeys/GeneKeysReveal";
import RolesForYourLines from "@/components/geneKeys/RolesForYourLines";
import { setMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";
import { countryName, loadPlaces, searchPlaces, zoneName, type Place } from "@/components/geneKeys/places";
import { BTN_GOLD, BTN_LINK, BTN_PLAIN, EYEBROW, HINT, INPUT } from "@/components/geneKeys/ui";
import { useGuideName } from "@/hooks/useGuideName";
import { guideNameAtSentenceStart } from "@shared/guideName";

type Step = "form" | "choose" | "result" | "share" | "done";

/**
 * "Roughly when?" for a member who does not know their birth time. Asked BEFORE
 * any windows are shown, so a whole day's seven windows become the one or two
 * inside the part of the day they were born in. Minutes after local midnight;
 * night wraps, so it is two spans of the same calendar day.
 */
export const PARTS = [
  { id: "morning", label: "Morning", spans: [[300, 719]] },
  { id: "afternoon", label: "Afternoon", spans: [[720, 1019]] },
  { id: "evening", label: "Evening", spans: [[1020, 1259]] },
  { id: "night", label: "Night", spans: [[0, 299], [1260, 1439]] },
  { id: "unknown", label: "No idea", spans: [[0, 1439]] },
] as const;
type Part = (typeof PARTS)[number]["id"];

/** The words a member sends to whoever was there, through their own phone's share sheet. Nothing reaches the village. */
const ASK_WORDS =
  "Hi! Do you remember roughly what time I was born? Morning, afternoon, evening or night is enough. I'm finding my Gene Keys and the time changes the result.";

interface Picked {
  chart: Chart;
  view: GeneKeysView;
  /** True when the member chose between windows; false when their time decided it. */
  chosen: boolean;
}

function clock(minute: number): string {
  const h = Math.floor(minute / 60), m = minute % 60;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${m < 10 ? "0" : ""}${m} ${h < 12 ? "am" : "pm"}`;
}

export default function GeneKeysPage() {
  const modules = useModules();
  const { user } = useAuth();
  const on = (modules.modules ?? []).some((m) => m.id === "gene-keys" && m.lifecycle !== "off");

  const [step, setStep] = useState<Step>("form");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [unknownTime, setUnknownTime] = useState(false);
  const [part, setPart] = useState<Part>("unknown");
  const [asked, setAsked] = useState<string | null>(null);
  /** The badge this save earned, by name, to say so on the last step. */
  const [badge, setBadge] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placesFailed, setPlacesFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [windows, setWindows] = useState<TimeWindow[]>([]);
  const [mine, setMine] = useState<number | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [visibility, setVisibility] = useState<"show" | "hide">("show");
  const [maia, setMaia] = useState(false);
  // The village's own guide, or "the village guide" while it has no name.
  const guide = useGuideName().name;

  useEffect(() => {
    if (!on || !user) return;
    let live = true;
    loadPlaces()
      .then((p) => live && setPlaces(p))
      .catch(() => live && setPlacesFailed(true));
    return () => {
      live = false;
    };
  }, [on, user]);

  const matches = useMemo(() => (places && !place ? searchPlaces(places, typed) : []), [places, place, typed]);

  // Each step is a new screen: start it at the top, and move focus to its heading so a
  // screen reader says where the member now is. Not on the first paint, which is already there.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById(`gk-${step}-h`)?.focus({ preventScroll: true });
  }, [step]);

  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label="Opening Gene Keys" />
        </div>
      </Layout>
    );
  }
  if (!on) return <ModuleGate moduleId="gene-keys" name="Gene Keys" />;
  if (!user) return <SignInToSee moduleId="gene-keys" name="Gene Keys" />;

  const read = () => {
    if (!date) return setProblem("Add your birth date to continue.");
    if (!unknownTime && !time) return setProblem("Add your birth time, or tick that you don't know it.");
    if (!place) return setProblem("Pick your birth town from the list, or the nearest one with the same clock.");
    setProblem(null);
    setWorking(true);
    // Let "Reading the sky" paint before the scan, which takes a moment on a slow phone.
    window.setTimeout(() => {
      try {
        const [year, month, day] = date.split("-").map(Number);
        let found: TimeWindow[];
        let at: number | null = null;
        if (unknownTime) {
          const spans = PARTS.find((x) => x.id === part)?.spans ?? [[0, 1439]];
          found = spans.flatMap(([from, to]) => resultsAcross({ year, month, day }, place.zone, from, to, 20));
        }
        else {
          const [h, m] = time.split(":").map(Number);
          at = h * 60 + m;
          found = resultsAcross({ year, month, day }, place.zone, Math.max(0, at - 30), Math.min(1439, at + 30), 5);
        }
        setMine(at);
        if (found.length === 1) {
          const chart = found[0].result.chart;
          setPicked({ chart, view: viewOf(chart), chosen: false });
          setStep("result");
        } else {
          setWindows(found);
          setStep("choose");
        }
      } catch {
        setProblem("That date could not be read. Check it and try again.");
      } finally {
        setWorking(false);
      }
    }, 30);
  };

  const save = async () => {
    if (!picked) return;
    setWorking(true);
    setProblem(null);
    try {
      const saved = await saveMyGeneKeys({ chart: picked.chart, source: picked.chosen ? "chosen" : "exact", visibility, maia });
      setMyGeneKeys(saved.mine);
      setBadge(saved.badgeEarned);
      setStep("done");
    } catch (e) {
      setProblem(e instanceof GeneKeysRefusal ? e.message : "Your lines did not save. Try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Layout>
      <div className="sheet-night relative min-h-screen bg-background pt-10 pb-32 text-foreground">
        <div className="container max-w-2xl">
          {step === "form" ? (
            <section aria-labelledby="gk-form-h" className="flex flex-col gap-5">
              <p className={EYEBROW}>Step 1 of 2 · Find your lines</p>
              <h1 id="gk-form-h" tabIndex={-1} className="font-display text-4xl focus:outline-none">
                When and where were you born?
              </h1>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Birth date
                <input className={INPUT} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Birth time
                <input className={INPUT} type="time" value={time} disabled={unknownTime} onChange={(e) => setTime(e.target.value)} />
              </label>
              <label className="flex min-h-11 items-center gap-3 text-base">
                <input type="checkbox" className="h-5 w-5 accent-notice" checked={unknownTime} onChange={(e) => setUnknownTime(e.target.checked)} />
                I don't know my birth time
              </label>
              {unknownTime ? (
                <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                  <legend className="px-1 text-sm font-medium">Roughly when?</legend>
                  <div className="flex flex-wrap gap-2">
                    {PARTS.map((x) => (
                      <label
                        key={x.id}
                        className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-notice ${
                          part === x.id ? "border-notice bg-notice/15 text-notice" : "border-border text-foreground"
                        }`}
                      >
                        <input type="radio" name="gk-part" className="sr-only" checked={part === x.id} onChange={() => setPart(x.id)} />
                        {x.label}
                      </label>
                    ))}
                  </div>
                  <p className={HINT}>Even a rough answer narrows it down. Somebody who was there may know.</p>
                  <button
                    type="button"
                    className={`${BTN_PLAIN} self-start`}
                    onClick={async () => {
                      try {
                        if (navigator.share) {
                          await navigator.share({ text: ASK_WORDS });
                          setAsked("Sent. Come back when they answer.");
                        } else {
                          await navigator.clipboard.writeText(ASK_WORDS);
                          setAsked("Copied. Paste it to whoever was there.");
                        }
                      } catch {
                        // A share sheet the member closed is not an error.
                      }
                    }}
                  >
                    Ask someone who was there
                  </button>
                  {asked ? <p className={HINT}>{asked}</p> : null}
                </fieldset>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gk-town" className="text-sm font-medium">
                  Birth town or city
                </label>
                <input
                  id="gk-town"
                  className={INPUT}
                  type="text"
                  autoComplete="off"
                  placeholder={places ? "Start typing, like Boulder" : "Loading towns"}
                  value={place ? `${place.name}, ${countryName(place.country)}` : typed}
                  onChange={(e) => {
                    setPlace(null);
                    setTyped(e.target.value);
                  }}
                />
                {place ? <p className={HINT}>{zoneName(place.zone)}</p> : null}
                {matches.length ? (
                  <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-card" aria-label="Matching towns">
                    {matches.map((p) => (
                      <li key={`${p.name}|${p.country}|${p.zone}`} className="border-t border-border first:border-t-0">
                        <button
                          type="button"
                          className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
                          onClick={() => {
                            setPlace(p);
                            setTyped("");
                          }}
                        >
                          <span>
                            {p.name}, {countryName(p.country)}
                          </span>
                          <span className="text-xs text-muted-foreground">{zoneName(p.zone)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {places && !place && typed.trim().length >= 2 && !matches.length ? (
                  <p className={HINT}>No town by that name yet. Try the nearest bigger town with the same clock.</p>
                ) : null}
                {placesFailed ? <p className="text-sm text-destructive">The town list did not load. Refresh the page to try again.</p> : null}
              </div>
              {problem ? (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : null}
              <p className={HINT}>We keep your lines and keys. Your birth details never leave this device.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_GOLD} disabled={working} onClick={read}>
                  {working ? "Reading the sky" : "Show my lines"}
                </button>
                <Link href="/profile" className={BTN_PLAIN}>
                  Back to your profile
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">Places from GeoNames.org</p>
            </section>
          ) : null}

          {step === "choose" ? (
            <section aria-labelledby="gk-choose-h" className="flex flex-col gap-4">
              <p className={EYEBROW}>Step 1 of 2 · One more check</p>
              <h1 id="gk-choose-h" tabIndex={-1} className="font-display text-4xl focus:outline-none">
                {mine === null ? "Your lines shift during that day" : "You were born close to a change"}
              </h1>
              <p className="text-base text-muted-foreground">
                {mine === null
                  ? "Pick the window you were born in. Not sure? Pick the one that reads truer to you."
                  : "A few minutes either way gives a different result. Pick the time that matches your birth record."}
              </p>
              <ul className="flex flex-col gap-2">
                {windows.map((w) => {
                  const v = viewOf(w.result.chart);
                  const yours = mine !== null && mine >= w.from && mine < w.to;
                  return (
                    <li key={w.from}>
                      <button
                        type="button"
                        className="flex min-h-16 w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-notice"
                        onClick={() => {
                          setPicked({ chart: w.result.chart, view: v, chosen: !yours });
                          setStep("result");
                        }}
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-foreground text-sm font-medium">
                          {v.profile}
                        </span>
                        <span className="flex flex-1 flex-col">
                          <span className="font-medium">
                            {w.from === 0 && mine === null ? "From midnight" : `From ${clock(w.from)}`} to {clock(w.to - 1)}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {v.names} · {v.type}
                          </span>
                        </span>
                        {yours ? <span className="text-xs text-notice">Your time</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={BTN_PLAIN} onClick={() => setStep("form")}>
                Change my details
              </button>
            </section>
          ) : null}

          {step === "result" && picked ? (
            <section aria-labelledby="gk-result-h" className="flex flex-col gap-5">
              <p className={EYEBROW}>Step 2 of 2 · Your lines</p>
              <GeneKeysReveal view={picked.view} chosen={picked.chosen} headingId="gk-result-h" />
              <GeneKeysLines view={picked.view} whose={null} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_GOLD} onClick={() => setStep("share")}>
                  Next
                </button>
                <button type="button" className={BTN_PLAIN} onClick={() => setStep("form")}>
                  Change my details
                </button>
              </div>
            </section>
          ) : null}

          {step === "share" ? (
            <section aria-labelledby="gk-share-h" className="flex flex-col gap-4">
              <p className={EYEBROW}>Almost done</p>
              <h1 id="gk-share-h" tabIndex={-1} className="font-display text-4xl focus:outline-none">
                Who sees your lines?
              </h1>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Who sees your lines</legend>
                {(
                  [
                    ["show", "Show them on my profile", "Your seal sits by your portrait. Your circle sees your lines."],
                    ["hide", "Keep them to me", "Only you see them. Nobody else, anywhere."],
                  ] as const
                ).map(([value, title, line]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
                    <input
                      type="radio"
                      name="gk-visibility"
                      className="mt-1 h-5 w-5 accent-notice"
                      checked={visibility === value}
                      onChange={() => setVisibility(value)}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{title}</span>
                      <span className="text-sm text-muted-foreground">{line}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-notice" checked={maia} onChange={(e) => setMaia(e.target.checked)} />
                <span className="flex flex-col">
                  <span className="font-medium">Let {guide} use my lines to guide me</span>
                  <span className="text-sm text-muted-foreground">{guideNameAtSentenceStart(guide)} shapes quest and role suggestions to how you work best.</span>
                </span>
              </label>
              <p className={HINT}>You can change both any time on your profile.</p>
              {problem ? (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_GOLD} disabled={working} onClick={save}>
                  {working ? "Saving" : "Save"}
                </button>
                <button type="button" className={BTN_PLAIN} disabled={working} onClick={() => setStep("result")}>
                  Back
                </button>
              </div>
            </section>
          ) : null}

          {step === "done" && picked ? (
            <section aria-labelledby="gk-done-h" className="flex flex-col items-start gap-4">
              <p className={EYEBROW}>Lines found</p>
              <h1 id="gk-done-h" tabIndex={-1} className="font-display text-4xl focus:outline-none">
                {picked.view.names}
              </h1>
              <p className="text-base text-muted-foreground">
                {visibility === "show" ? "Your seal now sits by your portrait." : "Your lines are saved and kept to you."}
              </p>
              {badge ? (
                <p role="status" className="rounded-full border border-notice/60 bg-notice/15 px-4 py-2 text-sm font-semibold text-notice">
                  Badge earned: {badge}
                </p>
              ) : null}
              <RolesForYourLines me={user.id} lines={picked.view.lines} />
              <div className="flex flex-wrap gap-2">
                <Link href="/profile#gene-keys" className={BTN_GOLD}>
                  See them on your profile
                </Link>
              </div>
              <a className={BTN_LINK} href={GENE_KEYS_SITE} target="_blank" rel="noopener noreferrer">
                Explore more in depth on genekeys.com
              </a>
            </section>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
