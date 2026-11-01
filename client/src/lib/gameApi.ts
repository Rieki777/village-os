// Platform game API client. All project-specific naming comes from /api/game/config.
import { useEffect, useState } from "react";
import { writeStored } from "./safeStorage";
// Both type-only, so neither module reaches the bundle. The server serves
// these two unions verbatim, and re-typing their members here would be the
// hand-kept mirror the house rules warn about: a branch added in `shared/`
// and missed here renders nothing, with no error anywhere.
import type { StageRule } from "@shared/gameConfig";
import type { Capability } from "@shared/capabilities";
import type { PlanWindowPayload } from "@shared/seasonPlans";
import { removeStored, storedText } from "./safeStorage";
import { villageWord, type CatalystLabel } from "@shared/villageWord";

/**
 * The ONE localStorage key for the session token. Exported so nothing else
 * re-types the literal: eight hand-written copies is eight chances for a
 * fork's rename to miss one and split the session in half (a page reading a
 * key nothing writes reads as permanently signed out).
 *
 * "village-auth-token" since readiness R066: the key named the first village,
 * in every village's browser. Nobody is signed out by the rename, because
 * `authToken()` below moves a session still held under the old key the first
 * time it reads, and `clearAuthToken()` drops both, so a sign-out can never
 * be undone by the old key being moved back.
 */
export const TOKEN_KEY = "village-auth-token";

/** Where the session lived until R066. Read only to move it; never written. */
export const LEGACY_TOKEN_KEY = "amora-auth-token"; // brand-ok: the old session key, read once to move a member's session to TOKEN_KEY (R066)

export interface BrandImages {
  hero?: string;
  investorHero?: string;
  residentHero?: string;
  stewardHero?: string;
  prosperityHero?: string;
  masterPlanHero?: string;
  logo?: string;
  heartLogo?: string;
  favicon?: string;
  /*
   * The alt text the Setup Wizard collects, now on the wire.
   *
   * Undefined means the village never typed one, so a render site uses its own
   * default sentence. An empty string is a deliberate "decorative" and must
   * reach the `alt` attribute as an empty string, so every read site uses
   * `altOr(...)` below and never `||`.
   *
   * `favicon` has no entry here on purpose: a browser tab icon is a
   * `<link rel="icon">` and carries no alt text at all.
   */
  heroAlt?: string;
  investorHeroAlt?: string;
  residentHeroAlt?: string;
  stewardHeroAlt?: string;
  prosperityHeroAlt?: string;
  masterPlanHeroAlt?: string;
  logoAlt?: string;
  heartLogoAlt?: string;
}

/**
 * The village's alt text for an image, or the page's own default.
 *
 * `||` would be wrong here and quietly so: it turns a deliberate `alt=""` back
 * into a sentence a screen reader then announces over a decorative picture.
 * Only an ABSENT value inherits.
 */
export function altOr(value: string | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export interface PublicGameConfig {
  project: {
    name: string;
    tagline: string;
    memberName: string;
    /** What this village calls whoever runs it. A LABEL, never a role: see
     *  `useCatalyst` below and `shared/gameConfig.ts`. Absent on a server too
     *  old to serve it, which is why every reader goes through the hook. */
    catalystName?: string;
    roleName?: string;
    seatName?: string;
    /** What this village calls the thing a member signs. Absent on a server
     *  too old to serve it, so every reader needs a fallback. */
    commitmentName?: string;
    location: string;
    adminPath: string;
    /** Blank = the village has no outside site; render no link. */
    siteUrl?: string;
    eventsUrl?: string;
    /** Blank = this village has published no contact address; render no
     *  "email us" control. See useVillageLinks below for why blank hides. */
    contactEmail?: string;
    footerBlurb?: string;
    /** The money this village trades in, as a three-letter code ("CRC").
     *  Blank = none declared; `defaultDisplayCurrency` then falls back to the
     *  platform's own. Read by the display-currency picker. */
    fiatCurrency?: string | null;
    country?: string | null;
  };
  currency: {
    name: string;
    nameLower: string;
    /** What the village calls all its tokens together (Admin then Tokens). Older servers omit it. */
    collectiveName?: string;
    /** The VALUE token the cycle pool distributes across recognition — named
     *  in the token registry (Admin → Tokens), so a fork's rename reaches
     *  every page that mentions it. Recognition itself carries no financial
     *  value; this is the tracked value it steers each cycle. */
    value?: { slug: string; name: string };
    /** Every registry token's name, by slug (readiness R084). Read through
     *  `useTokenNameFor` (client/src/hooks/useTokenNameFor.ts). Older servers omit it. */
    names?: Record<string, string>;
  };
  images: BrandImages;
  paths: { id: string; label: string; role: string; route: string }[];
  stages: GameStagePublic[];
  season: SeasonState;
  /** Whether this village serves the brochure pages (shared/brochure.ts).
   *  Absent on a server older than 1.2.0, which reads as off. */
  brochurePages?: boolean;
  /** The story pages this village switched off one by one, while the rest
   *  are served. Absent on an older server, which reads as none. */
  brochureHidden?: string[];
  /** Site-wide words from Admin, Pages, Whole site. Absent on an older server. */
  site?: {
    footerSignoff: string;
    /** Every story page's name and second line, resolved (Admin, Pages, Whole site). */
    menu?: Record<string, { label: string; subtitle: string }>;
    /** The story pages whose names the village changed; the footer keeps its own wording otherwise. */
    menuChanged?: string[];
  };
}

export interface SeasonEntry {
  id: string;
  name: string;
  theme: string;
  focus: string;
  startsOn: string;
  endsOn: string;
  goals: { text: string; done: boolean }[];
}

/** Computed server-side: `current` is chosen by date, so a banner can never
 *  advertise a season that already ended. Null current = show nothing. */
export interface SeasonState {
  current: SeasonEntry | null;
  upcoming: SeasonEntry | null;
  needsNextSeason: boolean;
  /** Null while the current season has no end date. */
  daysLeft: number | null;
  /** True while the current season runs until somebody starts the next. */
  openEnded?: boolean;
  daysUntilStart: number;
  timezone: string;
  cadence: string;
  today: string;
  /** The whole dated calendar, in order. A seat's term is decided against it. */
  seasons?: SeasonEntry[];
  /** When a seat vote opened now would land. A voted seat's term is measured from it. */
  seatVoteLandsAt?: string | null;
  /** The season members plan now and its window (season plans RC1), or null when none has opened. */
  planWindow?: PlanWindowPayload | null;
}

// One shared, cached fetch of the public config so many components don't each hit it.
let _configCache: Promise<PublicGameConfig | null> | null = null;
// The resolved config, so a component mounting after it arrived starts with it
// instead of rendering empty, painting, and rendering again in an effect.
let _configNow: PublicGameConfig | null = null;
export function fetchConfigCached(): Promise<PublicGameConfig | null> {
  if (!_configCache) {
    _configCache = fetch("/api/game/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { _configNow = c; return c; })
      .catch(() => null);
  }
  return _configCache;
}

/** Every mounted reader of the config, so a fresh one reaches them all at once. */
const _configReaders = new Set<(c: PublicGameConfig) => void>();

/**
 * READ THE CONFIG AGAIN AND HAND IT TO EVERY READER ON THE PAGE.
 *
 * The cache above is filled once per page load, so a founder who saved a new
 * name or new pictures in Admin went on seeing the old ones in their own tab,
 * header and all, until a full reload, under a note saying the change shows
 * instantly (audit item 24). A save that changes identity calls this after
 * the server answers: the shell, every page hook and the brand images then
 * repaint with what the server now serves. A failed read changes nothing.
 */
export async function refreshGameConfig(): Promise<PublicGameConfig | null> {
  const fresh = await fetch("/api/game/config")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!fresh) return null;
  _configNow = fresh;
  _configCache = Promise.resolve(fresh);
  _configReaders.forEach((read) => read(fresh));
  return fresh;
}

/**
 * The whole live config, null until loaded. The shell (Layout) reads its
 * identity — logo, name, outside links, footer copy — from here rather than
 * from literals, which is what makes a fork's shell the fork's without a
 * code change. Callers must treat null as "unknown, reserve the space",
 * never as "this village has no identity".
 */
export function useGameConfig(): PublicGameConfig | null {
  const [config, setConfig] = useState<PublicGameConfig | null>(() => _configNow);
  useEffect(() => {
    let alive = true;
    fetchConfigCached().then((c) => { if (alive && c) setConfig(c); });
    _configReaders.add(setConfig);
    return () => {
      alive = false;
      _configReaders.delete(setConfig);
    };
  }, []);
  return config;
}

/**
 * The village's own outward destinations, and the rule that a blank one HIDES
 * its control rather than rendering it broken.
 *
 * The rule already existed for links: Layout.tsx and Quests.tsx both guard
 * with `{siteUrl && (...)}`, so a village with no outside site shows no "Main
 * Site" button instead of a dead one. This hook is that same rule given one
 * home, extended to the contact address, because the shopfront pages carried
 * the opposite arrangement and it failed silently.
 *
 * Why silently: a compiled-in `mailto:` on a page shipped to thirteen villages
 * opens a perfectly normal mail composer addressed to a fourteenth. The
 * visitor sends their investment enquiry, sees no error, and the founder whose
 * site it was never learns the lead existed. A wrong URL is at least visibly
 * wrong when the page loads. A wrong recipient is not visible to anybody.
 *
 * So: HIDE, never disable. A disabled button still promises that the pack
 * exists and is being withheld; an absent one promises nothing, which is the
 * true statement about a village that has not set an address yet. Every one of
 * these controls sits in a row beside a sibling that still works, so nothing
 * is left with a hole where a button was.
 *
 * Returns "" (never undefined) so callers can guard with a plain truthiness
 * check, and `mailTo` returns "" for a blank address so the same check covers
 * links and mail alike.
 */
export function useVillageLinks(): {
  siteUrl: string;
  eventsUrl: string;
  contactEmail: string;
  mailTo: (subject: string) => string;
} {
  const config = useGameConfig();
  const p = config?.project;
  const contactEmail = String(p?.contactEmail ?? "").trim();
  return {
    siteUrl: String(p?.siteUrl ?? "").trim(),
    eventsUrl: String(p?.eventsUrl ?? "").trim(),
    contactEmail,
    mailTo: (subject: string) =>
      contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}` : "",
  };
}

/**
 * THE VILLAGE'S OWN WORD FOR WHOEVER RUNS IT.
 *
 * "Catalyst" out of the box; a village that says founder, steward or elder
 * sets its own in Admin, Make This Yours, and every member-facing sentence
 * that names one follows.
 *
 * IT IS A LABEL AND NOTHING ELSE. There is no Catalyst role, no Catalyst
 * capability and no gate anywhere reads this. Whoever could act before can
 * act now, and `shared/capabilities.ts` is untouched. What changes is the
 * word a member reads in a sentence about them.
 *
 * The ADMIN PANEL keeps its own name. A place is not a person: "the admin
 * panel" is where the work happens and stays what it is called, `/admin`
 * included; only the human takes the village's word.
 *
 * Why the fallback is a literal here rather than a null: this hook is read
 * inside sentences, and a sentence with a hole in it while the config loads
 * reads worse than one holding the platform default for a beat. Same shape as
 * `?? "Gratitude"` on the currency name.
 */
export const CATALYST_FALLBACK = "Catalyst";
export const ROLE_FALLBACK = "Role";
export const SEAT_FALLBACK = "Seat";

/** The article, the plural and the word together: shared/villageWord.ts, kept importable from here. */
export { articleFor, pluralFor, villageWord, type CatalystLabel } from "@shared/villageWord";

/** The label, live. Reads the platform default until the config arrives. */
export function useCatalyst(): CatalystLabel {
  return villageWord(useGameConfig()?.project?.catalystName, CATALYST_FALLBACK);
}

/**
 * What this village calls a POSITION somebody can hold. Default "Role".
 *
 * Separate from `useSeat` on purpose, and the separation is the point: a role
 * exists whether or not anybody holds it, a seat is one person holding it for
 * one season, and an org page that cannot say both cannot say who holds what
 * since when. See shared/gameConfig.ts for the full argument.
 */
export function useRoleWord(): CatalystLabel {
  return villageWord(useGameConfig()?.project?.roleName, ROLE_FALLBACK);
}

/**
 * The village's verb for putting someone into a role. Default "Seat" ("Seat someone").
 * The NOUN is always the role word: Rye ruled on 2026-10-21 that members say role,
 * never "a seat", so this word labels the act and never the thing held.
 */
export function useSeatWord(): CatalystLabel {
  return villageWord(useGameConfig()?.project?.seatName, SEAT_FALLBACK);
}

/** Live (brand-overlaid) hero image URLs, empty until loaded — callers fall back
 * to their own default so the page never renders imageless. */
export function useBrandImages(): BrandImages {
  const [images, setImages] = useState<BrandImages>(() => _configNow?.images ?? {});
  useEffect(() => {
    fetchConfigCached().then((c) => { if (c?.images) setImages(c.images); });
    const read = (c: PublicGameConfig) => { if (c.images) setImages(c.images); };
    _configReaders.add(read);
    return () => { _configReaders.delete(read); };
  }, []);
  return images;
}

/**
 * A figure this village has stated about its own land or its own offer.
 *
 * `value` empty means the village has not stated it, and a page that has
 * nothing to state says nothing rather than showing a figure. That is the
 * whole point of the type: these numbers used to be module constants, so a
 * fork published one specific project's appraisal and projected return as its
 * own the first time anybody opened /investor.
 */
export interface LandFact {
  value?: string;
  note?: string;
}

export interface VillageSettings {
  villageDues?: { amount?: string; period?: string; currency?: string; note?: string };
  landFacts?: Record<string, LandFact>;
}

let _settingsCache: Promise<VillageSettings | null> | null = null;
export function fetchSettingsCached(): Promise<VillageSettings | null> {
  if (!_settingsCache) {
    _settingsCache = fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _settingsCache;
}

/**
 * The village's own figures, null until loaded.
 *
 * Callers must treat null as "not loaded yet" and an empty `value` as "this
 * village has not said", and must render neither as a number. `statedFacts`
 * below does that filtering once so no page has to remember to.
 */
export function useVillageSettings(): VillageSettings | null {
  const [settings, setSettings] = useState<VillageSettings | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSettingsCached().then((s) => { if (alive && s) setSettings(s); });
    return () => { alive = false; };
  }, []);
  return settings;
}

/**
 * Keep only the figures this village actually stated, in the order asked for.
 *
 * A page passes the keys it can draw and gets back the ones that have a value.
 * An unstated figure is dropped rather than rendered blank or defaulted, so a
 * tile row shrinks to what is true instead of showing an empty box or, worse,
 * somebody else's number.
 */
export function statedFacts<T extends { key: string }>(
  settings: VillageSettings | null,
  wanted: T[],
): Array<T & { value: string; note: string }> {
  const facts = settings?.landFacts ?? {};
  return wanted
    .map((w) => ({ ...w, value: String(facts[w.key]?.value ?? "").trim(), note: String(facts[w.key]?.note ?? "").trim() }))
    .filter((w) => w.value.length > 0);
}

/** The one source every season-driven surface reads, so a banner, a page header
 *  and the pulse can never disagree about what season it is. */
let _seasonCache: Promise<SeasonState | null> | null = null;
export function fetchSeasonCached(): Promise<SeasonState | null> {
  if (!_seasonCache) {
    _seasonCache = fetch("/api/season")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _seasonCache;
}

export function useSeason(): SeasonState | null {
  const [season, setSeason] = useState<SeasonState | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSeasonCached().then((s) => { if (alive) setSeason(s); });
    return () => { alive = false; };
  }, []);
  return season;
}

export function authToken(): string | null {
  // Every request goes through here, so a browser blocking site data used to
  // throw on any page that fetched anything. A blocked store reads as no
  // session, which is true: it never held one. The member is told why when
  // they sign in (client/src/lib/signInStorage.ts).
  return storedText("local", TOKEN_KEY) ?? movedLegacyToken();
}

/**
 * A session still under the old key, moved to the new one (R066).
 *
 * Asked only when the new key holds nothing, so it runs once per browser and
 * costs a single read after that. The token is returned whether or not the
 * move lands: a store that refuses the write keeps the old key, and the member
 * stays signed in on it rather than being signed out by a full disk.
 */
function movedLegacyToken(): string | null {
  const old = storedText("local", LEGACY_TOKEN_KEY);
  if (!old) return null;
  if (writeStored("local", TOKEN_KEY, old).status === "saved") removeStored("local", LEGACY_TOKEN_KEY);
  return old;
}

/**
 * The ONE way to drop the session client-side. Components that reached for
 * localStorage directly wrote/removed a key nobody else used — the bug that
 * left the notification bell and the module manifest permanently anonymous.
 */
export function clearAuthToken(): void {
  // Dropping a session never refuses. See AuthContext.logout. BOTH keys: a
  // session left under the old one would be moved straight back on the next
  // read, which would undo the sign-out (R066).
  removeStored("local", TOKEN_KEY);
  removeStored("local", LEGACY_TOKEN_KEY);
}

export async function gameFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = authToken();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export interface GameStagePublic {
  id: string;
  name: string;
  description: string;
  /**
   * How this rung is earned, AS PLAYED. The server overlays the quests
   * threshold from the variables registry before serving, so `min` is the
   * number the gate compares against on this village and not the platform
   * default. A rung with no numeric side ("granted", "membership") carries
   * only its type.
   */
  rule: StageRule;
  /**
   * What this rung multiplies the base sending allowance by, AS PLAYED. Read
   * off the variables registry before serving, the same as `rule` above, so a
   * village that tuned it is never shown the platform default.
   */
  gratitudeMultiplier: number;
}

export interface GameMe {
  // `gratitudeMultiplier` is on GameStagePublic itself now, so the old
  // intersection here said the same thing twice.
  stage: GameStagePublic;
  stageIndex: number;
  stages: GameStagePublic[];
  /** `balance` is MINOR units, `decimals` is its scale. See client/src/lib/tokenAmount.ts. */
  /**
   * `budget` mirrors `GratitudeBudget` in server/lib/gratitude.ts. `cap` is the
   * most any one person may receive and `fullSends` is how many gifts of that
   * size the allowance holds, which is what the wall draws as hearts. Both are
   * SERVER-DERIVED from the same two functions that refuse a send, so nothing
   * on the client recomputes either one: a ceiling worked out twice is how the
   * caps R73 replaced drifted apart.
   */
  gratitude: {
    balance: number;
    decimals?: number;
    budget: { total: number; spent: number; remaining: number; cycleId: string; cap: number; fullSends: number };
  };
  quests: QuestClaim[];
  journeys: Record<string, string[]>;
  membership: boolean;
  trainingComplete: boolean;
  /**
   * Progress toward the training rung, counting MANDATORY modules only.
   *
   * `trainingComplete` is a boolean and a boolean is the wrong shape for a rung
   * somebody is working toward: the quest rungs can say "1 of 3" and this one
   * could only say "not yet". Absent on a server older than this field, where
   * the rung falls back to naming its requirement without the count.
   */
  training?: { done: number; required: number };
  /**
   * Consented quests to this member's name, which is what the one numeric
   * rung counts. Read it against `stages[n].rule` to say how far along a
   * quests rung somebody is; the two booleans above answer the other rungs.
   */
  consentedQuests: number;
  nextAction: { id: string; label: string; href: string };
  /**
   * The most recent rung this member crossed, and the capability keys it
   * opened, straight from `recordStageEvent`'s own diff. Null for a member
   * who has never advanced. The dashboard celebrates it once and never again.
   */
  lastAdvance: { fromStage: string; toStage: string; unlocked: string[]; at: string } | null;
}

/**
 * ONE ROW OF THE CAPABILITY MAP, as `/api/game/progression` serves it.
 *
 * The payload used to carry only what a member HOLDS, which is a wall of
 * chips with no direction in it. Every key this village runs is here now,
 * closed ones included, each with the rung that opens it, so a profile can
 * show where climbing leads. `key` is the shared union, so a capability
 * added there and missed here is a type error and never a silent gap.
 *
 * `opens` is the EFFECTIVE rung, already resolved against this village's own
 * unlock variables. `{ via: "appointment" }` means nobody climbs to it: a
 * role, a badge or an admin grants it, and no amount of progress will.
 *
 * Keys of modules this village has switched off are absent entirely, because
 * their routes stop mounting and a rung promising to open one would name a
 * door with nothing behind it.
 */
export interface ProgressionCapability {
  key: Capability;
  label: string;
  held: boolean;
  opens: { via: "stage"; stage: string } | { via: "appointment" };
  /**
   * The classes this power suits, named the way this village names them
   * (shared/powerAffinity.ts). Set on powers the village entrusts and empty on
   * the rest. `yours` marks a class this member plays, and only on a power
   * that is `recommended`. Absent from a server that predates the map.
   */
  suits?: Array<{ key: string; name: string; yours?: boolean }>;
  /**
   * The power is put to this member as one that suits them: they reached
   * Contributor, they play a class it suits, and they do not hold it yet.
   */
  recommended?: boolean;
  /**
   * This member's hand for the power while it is up (shared/powerHands.ts):
   * filed, and not yet answered. Absent when there is no hand, once the hand is
   * answered, on a power the member holds, and from a server that predates
   * hands.
   */
  hand?: { status: "new" | "reviewing" | "in-conversation"; submittedAt: string };
}

export interface QuestClaim {
  id: string;
  questId: string;
  questTitle: string;
  status: "claimed" | "submitted" | "consented" | "declined";
  claimedAt: string;
  artifactUrl: string;
  note: string;
  /** What the witness granted for this piece of work. */
  amount?: number;
  /**
   * What the ledger actually credited, which is `amount` multiplied by any
   * standing badge the member holds. Present only once the consent has
   * posted. It differs from `amount` exactly when a badge bonus applied, and
   * that difference is what the reward moment names.
   */
  credited?: number;
  /**
   * The reward moment names this consent's pay (server/lib/rewardMoment.ts,
   * `claimsAnnouncedHere`), so the quest page does not celebrate it again.
   */
  announcedByRewardMoment?: boolean;
}

export async function fetchGameMe(): Promise<GameMe | null> {
  if (!authToken()) return null;
  try {
    const res = await gameFetch("/api/game/me");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
