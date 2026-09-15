/**
 * The honest label on standing examples.
 *
 * A module that ships OFF has nothing in it, and "No items yet." teaches a
 * founder nothing about what the module is for. Standing examples fill that
 * void — but content presented without a label is content that gets mistaken
 * for real, so every page showing examples says so at the top.
 *
 * The banner explains the idea once at the top of a page, because twelve
 * repetitions of the same sentence is noise that stops being read by the third
 * card. `ExampleChip` is for every surface that one banner cannot label
 * honestly, and there are more of those than the first pass assumed: an admin
 * table mixing real rows with examples; the map, where three modules' examples
 * share a page and retire independently; and any list a MIXTURE can reach,
 * which now includes the forum and the feed (two lenses over one table in one
 * category, retired as a pair, and either page can hold the other's rows) and
 * the network's peer list (adding a real peer is not a retirement trigger).
 *
 * The rule the third review settled: a page-level banner may ADD context, and
 * it may never be the only thing standing between a reader and platform
 * fiction. Where a row carries the flag, the row says so.
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import { readStoredJson, removeStored, writeStoredJson } from "@/lib/safeStorage";

interface ExamplesState {
  modules: string[];
  /** What clears each module's examples, in the reader's words. */
  triggers: Record<string, string>;
}

let cache: ExamplesState | null = null;
let inflight: Promise<ExamplesState> | null = null;
const EMPTY: ExamplesState = { modules: [], triggers: {} };

/**
 * Modules this session has already watched retire.
 *
 * The optimistic drop used to live in `cache` alone, and that could not
 * survive a response that was already in flight when it happened: on a page
 * whose first fetch had not resolved yet the drop cleared a null cache,
 * every listener re-asked, `fetchExampleModules` handed back the SAME pending
 * promise, and its pre-retirement payload put the module straight back — the
 * banner returning over the member's own brand-new content. A separate set
 * that every answer is filtered through cannot be overwritten by a stale one.
 *
 * Safe because retirement is one-way: a module that has received a real item
 * never starts showing examples again. The one case where a drop can be
 * WRONG is a retirement that failed server-side (examples.ts returns without
 * stamping the tombstone so the next trigger retries), which is what
 * `scheduleRetirementCheck` below reconciles.
 */
const retired = new Set<string>();

/**
 * The pairs the server retires together (`RETIRE_TOGETHER`, examples.ts).
 *
 * The forum and the feed are two lenses over `forum_threads` and both list
 * queries are category-wide, so retiring one alone leaves the other's rows
 * rendering with no label. Keeping the rule here rather than at the two call
 * sites means neither page can forget its twin.
 */
export const RETIRES_WITH: Record<string, string[]> = {
  forum: ["feed"],
  feed: ["forum"],
};

/**
 * The previous answer, kept for the length of the tab.
 *
 * The banner used to render nothing until the fetch resolved, so on twelve
 * pages the block was inserted AFTER first paint and pushed the whole page
 * down. A remembered answer lets the first paint be right. It is a hint and
 * never an answer: the fetch still runs on every mount and overwrites it.
 */
const HINT_KEY = "examples-showing";

function loadHint(): ExamplesState | null {
  const stored = readStoredJson("session", HINT_KEY);
  if (stored.status !== "value") return null;
  const d = stored.value as { modules?: unknown; triggers?: unknown } | null;
  if (!d || !Array.isArray(d.modules)) return null;
  return {
    modules: d.modules.map(String),
    triggers:
      d.triggers && typeof d.triggers === "object" ? (d.triggers as Record<string, string>) : {},
  };
}

function saveHint(s: ExamplesState): void {
  // Storage can be denied outright (private mode, a locked-down browser).
  // A missing hint costs one layout shift, so it is never worth throwing.
  writeStoredJson("session", HINT_KEY, s);
}

function clearHint(): void {
  removeStored("session", HINT_KEY);
}

const hint = loadHint();

function withoutRetired(s: ExamplesState): ExamplesState {
  if (retired.size === 0) return s;
  return { ...s, modules: s.modules.filter((m) => !retired.has(m)) };
}

/**
 * Bumped when the viewer changes, so an answer fetched for whoever was signed
 * in a moment ago cannot reach the cache OR a component afterwards. `retired`
 * protects the module-scoped drops from the same race; this protects the whole
 * answer. Every subscriber captures it before asking and discards a reply that
 * no longer matches: the cache guard alone closed half the race, because the
 * stale promise still resolved and every mounted banner setState'd from it.
 */
let generation = 0;

/** One fetch per page load, shared by every banner mounted from it. */
function fetchExampleModules(): Promise<ExamplesState> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    const gen = generation;
    // Through gameFetch so the session token rides along: the endpoint hides
    // preview-lifecycle modules from anonymous callers, and an admin
    // previewing a module still needs the label on what they are looking at.
    inflight = gameFetch("/api/examples")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d) => {
        const answer = withoutRetired({
          modules: Array.isArray(d?.modules) ? d.modules.map(String) : [],
          triggers: d?.triggers && typeof d.triggers === "object" ? d.triggers : {},
        });
        if (gen !== generation) return answer; // answered for a past session
        cache = answer;
        saveHint(answer);
        return answer;
      })
      .catch((): ExamplesState => EMPTY)
      .finally(() => { if (gen === generation) inflight = null; });
  }
  return inflight;
}

/** Mounted banners, so a retirement can reach them without a page reload. */
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const notify of Array.from(listeners)) notify();
}

/**
 * A dropped module that the server did NOT actually retire has to come back.
 *
 * `retireExamples` leaves the tombstone unstamped when its DELETE fails, so
 * the next trigger can retry — which means the rows are still on the page.
 * Dropping the banner and stopping there would leave them there unlabelled
 * until the member happened to reload, and unlabelled platform fiction is the
 * exact failure this whole feature exists to prevent.
 *
 * BACKED OFF, because a single check cannot tell "failed" from "not finished
 * yet" and the answer it guesses is the wrong one. Server retirement is
 * fire-and-forget: the publisher's 201 does not wait on it, one pass walks
 * every example table with a COUNT each, and publishing a thread fires the
 * whole thing for the forum AND the feed at once. Over a remote database that
 * routinely takes longer than a couple of seconds, and the old single check
 * answered "still listed, so it failed" and put the banner back over the
 * member's own brand-new content, permanently, with no further check.
 *
 * So ask three times, further apart each time, and only restore on the LAST
 * one. A slow success then reads as a success.
 */
const RETIREMENT_CHECK_MS = [2000, 5000, 15000];

function scheduleRetirementCheck(moduleId: string, attempt = 0): void {
  const gen = generation;
  window.setTimeout(() => {
    void gameFetch("/api/examples")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const modules: string[] = Array.isArray(d?.modules) ? d.modules.map(String) : [];
        if (!d || !modules.includes(moduleId)) return; // gone, as expected
        if (attempt + 1 < RETIREMENT_CHECK_MS.length) {
          scheduleRetirementCheck(moduleId, attempt + 1);
          return;
        }
        // Whether the rows survived is a fact about the village, so the drop
        // is undone whoever is reading; the cached ANSWER is per viewer, so
        // it is only rewritten if the session has not changed underneath us.
        retired.delete(moduleId);
        if (gen !== generation) { notifyListeners(); return; }
        cache = withoutRetired({
          modules,
          triggers: d.triggers && typeof d.triggers === "object" ? d.triggers : {},
        });
        saveHint(cache);
        notifyListeners();
      })
      .catch(() => {
        // A dropped connection says nothing about whether the rows are gone.
      });
  }, RETIREMENT_CHECK_MS[attempt]);
}

function dropModule(id: string, confirmed: boolean): void {
  if (retired.has(id)) return;
  // A module that was not showing examples has nothing to drop, and the
  // check below would be a pointless request. Gratitude publishes a
  // retirement trigger and seeds no rows at all, so it lands here every send.
  if (cache && !cache.modules.includes(id)) return;
  retired.add(id);
  if (cache) cache = withoutRetired(cache);
  notifyListeners();
  // `confirmed` means the caller already has the server's own answer that the
  // tombstone was stamped (the admin clear route awaits the retirement and
  // reports it). Reconciling a fact we were told is how the guess gets a
  // chance to be wrong.
  if (!confirmed) scheduleRetirementCheck(id);
}

/**
 * Call after publishing something real in `moduleId`, or with no argument
 * when the session changes.
 *
 * Clearing the cache alone is not enough — a mounted banner holds its answer
 * in state and its effect only re-runs when moduleId changes, so the label
 * would survive on screen above the member's own brand-new content until they
 * happened to reload. That is the inverse of the honesty this feature exists
 * for: real content wearing an example label.
 *
 * The module is dropped OPTIMISTICALLY rather than re-fetched, because
 * retirement is fire-and-forget on the server (the publisher's response never
 * waits on housekeeping) and an immediate re-fetch races it.
 *
 * The pair goes with it, always: publishing a real thread retires the forum
 * AND the feed, and so does the admin clear button. It used to retire only the
 * module its label named, and this helper faithfully mirrored that — which
 * left the twin's example rows rendering on the same page under a banner that
 * had just been dropped.
 *
 * `confirmed` says the caller already holds the server's answer that the
 * tombstone was stamped, so the reconciliation poll is skipped.
 */
export function forgetExamplesCache(
  moduleId?: string,
  opts: { confirmed?: boolean } = {},
): void {
  if (!moduleId) {
    // The viewer changed. /api/examples answers per viewer — preview-
    // lifecycle modules are hidden from non-admins — so an admin who signs in
    // without a reload would otherwise keep the anonymous answer and lose the
    // banner on every module they are previewing, which is the case the
    // auth-aware fetch was added for. `retired` survives on purpose:
    // retirement is a fact about the village, not about who is reading.
    generation += 1;
    cache = null;
    inflight = null;
    // The remembered first-paint answer is per viewer too, and it outlives a
    // reload. Left behind, a sign-out followed by a reload in the same tab
    // painted the admin's answer to whoever is reading now.
    clearHint();
    notifyListeners();
    return;
  }
  for (const id of [moduleId, ...(RETIRES_WITH[moduleId] ?? [])]) {
    dropModule(id, opts.confirmed === true);
  }
}

export function useShowingExamples(moduleId: string): boolean {
  return useExamplesState(moduleId).showing;
}

/** Every module showing examples, for surfaces that span modules. */
export function useExampleModules(): { modules: string[]; loaded: boolean } {
  // `modules` may be seeded from the remembered answer so a caller that
  // renders banners from it paints them on the first frame. `loaded` never
  // is: a hint is a guess, and FirstWalk changes what it SAYS based on this
  // ("your examples have retired" is not a thing to guess at).
  const [state, setState] = useState<{ modules: string[]; loaded: boolean }>(() => ({
    modules: withoutRetired(cache ?? hint ?? EMPTY).modules,
    loaded: !!cache,
  }));
  useEffect(() => {
    let alive = true;
    const sync = () => {
      // The generation is captured HERE, not only inside the fetch: a request
      // started before a sign-in still resolves, and without this every
      // subscriber setStates from the anonymous answer if it happens to land
      // last. A viewer change notifies every listener, so the discarded answer
      // is always replaced by a fresh one.
      const gen = generation;
      void fetchExampleModules().then((next) => {
        if (alive && gen === generation) setState({ modules: next.modules, loaded: true });
      });
    };
    sync();
    listeners.add(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, []);
  return state;
}

/** Showing state plus the module's own trigger line, from one shared fetch. */
export function useExamplesState(moduleId: string): { showing: boolean; trigger: string | null } {
  const [state, setState] = useState(() => {
    // The hint only seeds the FIRST paint, so the banner does not appear a
    // beat late and shove the page down. Everything after this is the fetch.
    const seed = withoutRetired(cache ?? hint ?? EMPTY);
    return {
      showing: seed.modules.includes(moduleId),
      trigger: seed.triggers[moduleId] ?? null,
    };
  });
  useEffect(() => {
    let alive = true;
    const sync = () => {
      // A cleared cache re-fetches; a module-scoped drop answers from it. The
      // captured generation discards an answer fetched for a past viewer, the
      // way the cache write already does. See useExampleModules.
      const gen = generation;
      void fetchExampleModules().then((next) => {
        if (alive && gen === generation) {
          setState({
            showing: next.modules.includes(moduleId),
            trigger: next.triggers[moduleId] ?? null,
          });
        }
      });
    };
    sync();
    listeners.add(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, [moduleId]);
  return state;
}

/**
 * `layout` carries the box, so a caller can override it whole rather than
 * appending classes that fight the default. The default is written for the
 * module pages, every one of which drops the banner into a centred hero: the
 * banner used to inherit `text-center` and render as full-width centred prose.
 * The admin passes its own, because nothing there is centred.
 */
/**
 * `row` is for a page showing ONE item whose own `is_example` says what it is.
 *
 * The module answer is then not allowed a veto. It is false on the first paint
 * before /api/examples resolves, false for the seconds a retirement is being
 * reconciled, and false for a module cleared while its twin still holds rows —
 * and in each of those the row is still an example, still on screen, and would
 * carry no marker at all. The row knows; the module answer only adds the
 * trigger sentence when it happens to be there.
 */
export function ExamplesBanner({
  moduleId,
  noun,
  layout = "mb-6 max-w-2xl mx-auto text-left",
  row = false,
}: { moduleId: string; noun: string; layout?: string; row?: boolean }) {
  const { showing, trigger } = useExamplesState(moduleId);
  const headingId = `standing-examples-${moduleId}`;
  if (!showing && !row) return null;
  if (row) {
    return (
      <aside
        aria-labelledby={headingId}
        className={`${layout} rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100`}
      >
        <p id={headingId} className="font-medium">This is a standing example.</p>
        <p className="mt-1 leading-relaxed">
          Nobody here made it. It shows what this module is for, and nothing you
          do to it takes effect.{" "}
          {trigger ?? `Publishing your first real ${noun} clears them for good.`}
        </p>
      </aside>
    );
  }
  return (
    // An aside is a landmark a screen reader can reach and announce; the old
    // role="note" carried no accessible name at all, so the content was met
    // before the label that explains it.
    <aside
      aria-labelledby={headingId}
      className={`${layout} rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100`}
    >
      <p id={headingId} className="font-medium">These are standing examples.</p>
      <p className="mt-1 leading-relaxed">
        {/* A categorical claim, not a list. "They cannot be borrowed, booked,
            bought or replied to" reads as the whole of what is refused, and
            every page offers something outside it: the tools hub opens an
            example's real URL, the network prints an address you can write
            to, quests and the map refuse things the sentence never named. */}
        Nobody here made them. They show what this module is for, and nothing
        you do to one takes effect.{" "}
        {/* The module's own words for what clears them. "Your first real
            listing" is true of the exchange and unhelpful, because a TOKEN is
            what actually retires it. The generic line stays as the fallback
            for a fork that has not written its own. */}
        {trigger ?? `Publishing your first real ${noun} clears them for good.`}
      </p>
    </aside>
  );
}

/**
 * The row-level marker.
 *
 * Used where one banner cannot tell the truth: the admin tables mix real rows
 * with examples, and /map draws circles, roles and quests from three modules
 * that retire independently. Small on purpose — it says which row, and the
 * banner above says what that means.
 */
export function ExampleChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    >
      example
    </span>
  );
}
