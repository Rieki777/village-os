/**
 * The front door of a role proposal: a welcome, three questions in the
 * member's own words, and the switch to the six steps.
 *
 * The three answers are typed here and saved as typed. The guide does not
 * write them. Full control is the six steps, and switching does not clear
 * anything already written.
 */
import GrowingText from "@/components/sessions/GrowingText";
import { guideName } from "@shared/roleProposalHonesty";
import { OWN_WORDS_MAX } from "@shared/roleProposals";
import type { OrgView } from "./StepRoles";
import type { SeasonState } from "./StepSeason";
import { RP_WORDS } from "./proposalWords";
import { H2, LEDE, PANEL, PRIMARY, SECONDARY } from "./parts";

export type ProposalPath = "quick" | "full";
export type FrontScreen = "welcome" | "yours" | "steps";

/** A link with no step is the quick path. A link that names a step stays on the six steps. */
export function pathFromUrl(): ProposalPath {
  if (typeof window === "undefined") return "full";
  const q = new URLSearchParams(window.location.search);
  const path = q.get("path");
  if (path === "quick") return "quick";
  if (path === "full") return "full";
  return q.get("step") ? "full" : "quick";
}

export function rememberPath(path: ProposalPath): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("path", path);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

/** A role card opens the quick path with that role ready to add. */
export function proposeRoleHref(roleId: string): string {
  const q = new URLSearchParams({ role: roleId, path: "quick" });
  return `/role-proposals/new?${q.toString()}`;
}

/** The role a card linked here, once. */
export function roleFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("role")?.trim() ?? "";
}

/** Keep a role from the page that started the draft, onto the draft's own address. */
export function keepRoleOn(href: string): string {
  if (typeof window === "undefined") return href;
  const role = roleFromUrl();
  if (!role) return href;
  const url = new URL(href, window.location.origin);
  if (!url.searchParams.get("role")) url.searchParams.set("role", role);
  if (!url.searchParams.get("path")) url.searchParams.set("path", "quick");
  return `${url.pathname}${url.search}`;
}

export function PathToggle({ path, onPath }: { path: ProposalPath; onPath: (next: ProposalPath) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`${RP_WORDS.quickPath} or ${RP_WORDS.fullControl}`}>
      <button type="button" className={path === "quick" ? PRIMARY : SECONDARY} aria-pressed={path === "quick"} onClick={() => onPath("quick")}>
        {RP_WORDS.quickPath}
      </button>
      <button type="button" className={path === "full" ? PRIMARY : SECONDARY} aria-pressed={path === "full"} onClick={() => onPath("full")}>
        {RP_WORDS.fullControl}
      </button>
    </div>
  );
}

export function WelcomeScreen({ org, onStart }: { org: OrgView | null | "failed"; onStart: () => void }) {
  const who = guideName(org && org !== "failed" ? org.roles : []);
  return (
    <div className="grid gap-4">
      <h2 id="rp-welcome" tabIndex={-1} className={`${H2} outline-none`}>{RP_WORDS.welcomeTitle}</h2>
      <p className={LEDE}>{RP_WORDS.welcomeLede}</p>
      <p className={LEDE}>{RP_WORDS.guideHere(who)}</p>
      <button type="button" className={PRIMARY} onClick={onStart}>
        {RP_WORDS.startQuestions}
      </button>
    </div>
  );
}

const QUESTIONS = [
  { key: "love", label: RP_WORDS.love, hint: RP_WORDS.loveHint },
  { key: "offer", label: RP_WORDS.offer, hint: "" },
  { key: "why", label: RP_WORDS.whyHere, hint: "" },
] as const;

export function YourWordsScreen({
  season,
  onChange,
  onNext,
}: {
  season: SeasonState;
  onChange: (next: SeasonState) => void;
  onNext: () => void;
}) {
  const set = (key: "love" | "offer" | "why", value: string) => onChange({ ...season, ownWords: { ...season.ownWords, [key]: value } });
  return (
    <div className="grid gap-4">
      <div>
        <h2 id="rp-your-words" tabIndex={-1} className={`${H2} outline-none`}>{RP_WORDS.yourWordsTitle}</h2>
        <p className={`${LEDE} mt-1`}>{RP_WORDS.yourWordsLede}</p>
      </div>
      <p className="text-sm font-semibold text-notice" data-words-kept="">
        {RP_WORDS.yourWordsKept}
      </p>
      {QUESTIONS.map((q) => (
        <div key={q.key} className={`${PANEL} grid gap-2`}>
          <GrowingText id={`own-${q.key}`} label={q.label} placeholder={q.hint || undefined} value={season.ownWords[q.key]} onValue={(v) => set(q.key, v)} max={OWN_WORDS_MAX} minRows={3} mic />
        </div>
      ))}
      <button type="button" className={PRIMARY} onClick={onNext}>
        {RP_WORDS.onToRoles}
      </button>
    </div>
  );
}
