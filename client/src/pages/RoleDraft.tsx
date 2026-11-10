/**
 * THE ROLE SELECTION BOARD, /roles/select (it was /roles/draft until 9 Nov 2026, which still redirects here) (Rye, 9 Nov 2026, approved from the
 * mockup at https://claude.ai/artifact/LcUhUhgYeF9Kq2wufcHGTv).
 *
 * A visitor picks the characters they play, scouts every open role by its key
 * stats, opens any role's full card, drafts up to three to a shortlist kept in
 * this browser, and applies. Nothing here is a list of its own: the cast is
 * `GET /api/archetypes`, the roles, circles and character tags are `GET
 * /api/org`, and places looking for a steward are the places registry. All of
 * it is what the admin org chart, role drafts and the Saberra bridge keep
 * current. The pure half is shared/roleDraft.ts.
 *
 * WOVEN INTO WHAT EXISTS, NOT BESIDE IT:
 *   - a visitor applies through the open proposal (/propose-a-role, every
 *     pick ticked): email confirm, the circle asked, a holder of the power
 *     to place people in roles adopts, the invitation emailed
 *     (server/routes/openProposals.ts, server/lib/openProposalDecide.ts);
 *   - a member proposes through Propose my roles, which carries several
 *     roles, gold for changed words and season goals tied to the village's
 *     (shared/roleProposals.ts);
 *   - the full card is the same SeatTradingCard /roles draws;
 *   - other ways in: a quest on the board (quest, path, role) and a place
 *     looking for a steward.
 *
 * THE DRAFT is client/src/lib/safeStorage.ts, never bare Web Storage: a
 * browser with site data blocked keeps the draft for the visit and says so.
 * After sign-up, the character page offers what was drafted
 * (components/roleDraft/DraftCarry.tsx).
 */
import { NextForRoles } from "@/components/openProposal/RoleCardBridge";
import { termOf, type OpenProposalTerm } from "@shared/openProposalTerm";
import { civilDayWords } from "@shared/seasonPlans";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, Compass, MapPin, Sparkles, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import InfoTip from "@/components/InfoTip";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import EditRoleButton from "@/components/roleEdit/EditRoleButton";
import { useClassNames } from "@/components/power/useClassNames";
import { readsTerms } from "@/components/characters/RolesThatFit";
import { proposeRoleHref } from "@/components/roleProposal/QuickPath";
import DiscoverStep from "@/components/roleDraft/DiscoverStep";
import SelectStepper from "@/components/roleDraft/SelectStepper";
import ArtImage from "@/components/roleDraft/ArtImage";
import Burst, { reducedMotion } from "@/components/roleDraft/Burst";
import { useVillageName } from "@/hooks/useVillageName";
import { gameFetch, useSeason } from "@/lib/gameApi";
import { useModuleOn } from "@/modules/ModuleProvider";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { fromOrgSeat, seasonForSheet } from "@shared/roleSheetInputs";
import { OPEN_PROPOSAL_MAX_ROLES } from "@shared/openProposals";
import { roleCardView } from "@shared/roleCardView";
import { BEING_WRITTEN, roughHours } from "@shared/roleParams";
import { termsSlotFor } from "@/components/power/SeatTermsSlot";
import {
  ROLE_DRAFT_KEY,
  addPick,
  applyHrefFor,
  boardRoles,
  characterArt,
  charactersKnown,
  fitCountFor,
  roleArtFor,
  draftFromStored,
  openRolesFrom,
  rankForCharacters,
  type DraftRole,
} from "@shared/roleDraft";

interface SeasonDoc {
  name?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  goals?: Array<{ id?: string; text?: string; done?: boolean }>;
}

interface CastMember {
  key: string;
  name: string;
  subtitle: string;
}

interface PlaceInvite {
  key: string;
  name: string;
}

type Load = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; roles: DraftRole[]; org: any };

/**
 * Whether the open proposal takes applications now, and which roles it offers
 * (`GET /api/open-proposals/form`, public). A visitor's board shows only roles
 * the form would take, and no Apply when it is closed (red team, 9 Nov).
 */
type FormRoleSteps = { id: string; name: string; conversations?: Array<{ role: string; minutes: number; finalApproval?: boolean }>; bookingUrl?: string | null };
type FormState = { open: boolean; offered: Set<string> | null; message: string | null; term: OpenProposalTerm | null; roles: FormRoleSteps[] };

function useProposalForm(): FormState | null {
  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/open-proposals/form")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        if (!d) return setForm({ open: false, offered: null, message: null, term: null, roles: [] });
        const ids = Array.isArray(d.roles) ? d.roles.map((r: any) => String(r?.id ?? "")).filter(Boolean) : null;
        setForm({
          open: !!d.open,
          offered: ids ? new Set(ids) : null,
          message: typeof d.message === "string" ? d.message : null,
          term: termOf(d.term) ?? null,
          roles: Array.isArray(d.roles) ? d.roles.filter((r: any) => r && typeof r.id === "string") : [],
        });
      })
      .catch(() => {
        if (live) setForm({ open: false, offered: null, message: null, term: null, roles: [] });
      });
    return () => {
      live = false;
    };
  }, []);
  return form;
}

const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The cast, read live, in the order the village keeps it. */
function useCast(): CastMember[] {
  const [cast, setCast] = useState<CastMember[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!live || !Array.isArray(d)) return;
        setCast(
          d
            .filter((a: any) => a && typeof a.key === "string")
            .map((a: any) => ({ key: a.key, name: String(a.name ?? a.key), subtitle: String(a.subtitle ?? "") })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return cast;
}

/**
 * Places with an open stewardship invitation, from the places registry. The
 * registry names invitations at the members' tier only, so a visitor usually
 * gets none and the board links the map instead.
 */
function usePlaceInvites(): PlaceInvite[] {
  const [places, setPlaces] = useState<PlaceInvite[]>([]);
  // The registry is behind the places module; asking while it is off is a 404 on every visit (role audit, 10 Nov 2026).
  const placesOn = useModuleOn("places");
  useEffect(() => {
    if (!placesOn) return;
    let live = true;
    gameFetch("/api/place-registry")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d || !Array.isArray(d.places)) return;
        setPlaces(
          d.places
            .filter((p: any) => p && p.invitationOpen === true && typeof p.key === "string")
            .map((p: any) => ({ key: p.key, name: String(p.name ?? p.key) })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [placesOn]);
  return places;
}

export default function RoleDraft() {
  const { t } = useLingui();
  const villageName = useVillageName();
  const cast = useCast();
  const places = usePlaceInvites();
  const form = useProposalForm();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const season = useSeason();
  const classNames = useClassNames();

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const stored = useMemo(() => {
    const read = readStoredJson("local", ROLE_DRAFT_KEY);
    return { draft: draftFromStored(read.status === "value" ? read.value : null), blocked: read.status === "unavailable" };
  }, []);
  const [chars, setChars] = useState<string[]>(stored.draft.chars);
  const [picks, setPicks] = useState<string[]>(stored.draft.picks);
  const [onlyFits, setOnlyFits] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(stored.blocked);
  const [step, setStep] = useState(0);
  const [burst, setBurst] = useState(0);
  const [applyBurst, setApplyBurst] = useState(0);
  const [, navigate] = useLocation();

  useEffect(() => {
    gameFetch("/api/org")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((org) => {
        if (!org || !Array.isArray(org.roles)) throw new Error("bad shape");
        const roles = openRolesFrom(org);
        setLoad({ kind: "ready", roles, org });
        // A drafted role that has since been filled or closed leaves the draft.
        setPicks((p) => p.filter((id) => roles.some((r) => r.id === id)));
      })
      .catch(() => setLoad({ kind: "failed" }));
  }, []);

  // Written on every change, through the one helper that survives blocked storage.
  useEffect(() => {
    if (load.kind !== "ready") return;
    setSaveBlocked(writeStoredJson("local", ROLE_DRAFT_KEY, { chars, picks }).status !== "saved");
  }, [chars, picks, load.kind]);

  const castName = (key: string) => cast.find((c) => c.key === key)?.name ?? key;
  // A reader the chart sends terms to holds terms.read: a member, who applies through a role application.
  const member = load.kind === "ready" && readsTerms(load.org);
  const allRoles = load.kind === "ready" ? load.roles : [];
  // ONE set feeds the board, the character counts and the tray: listed roles the open form would take (boardRoles).
  const roles = boardRoles(allRoles, { member, form: form ? { open: form.open, offered: form.offered } : null });
  const tagsKnown = charactersKnown(roles);
  const visitorClosed = !member && form !== null && !form.open;
  const ranked = rankForCharacters(roles, chars);
  const shown = onlyFits && chars.length ? ranked.filter((r) => r.fits.length > 0) : ranked;
  const fitCount = (key: string) => fitCountFor(roles, key);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const applyHref = visitorClosed ? null : applyHrefFor(picks, member);

  useEffect(() => {
    if (!chars.length) setOnlyFits(false);
  }, [chars.length]);
  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  // Each step is a section of this one page. A step button or Next glides to it; reading down the page moves the bar too.
  const STEP_IDS = ["sel-season", "sel-chars", "sel-scout", "sel-select", "sel-apply"] as const;
  const go = (i: number) => {
    setStep(i);
    const el = document.getElementById(STEP_IDS[i]);
    el?.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#sel-season") window.setTimeout(() => go(0), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let best = -1;
        let ratio = 0;
        STEP_IDS.forEach((id, i) => {
          if (i === 3) return; // the tray stays in view beside the board, so it never wins on its own: Next and the step button take you there
          const r = seen.get(id) ?? 0;
          if (r > ratio) {
            ratio = r;
            best = i;
          }
        });
        if (best >= 0) setStep(best);
      },
      { threshold: [0.15, 0.4, 0.7] },
    );
    for (const id of STEP_IDS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [load.kind]);
  const applyWithBurst = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    setApplyBurst((n) => n + 1);
    window.setTimeout(() => navigate(href), reducedMotion() ? 0 : 650);
  };

  const toggleChar = (key: string) => setChars((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const togglePick = (id: string) => {
    const next = addPick(picks, id);
    setFull(next.full);
    if (next.picks.length > picks.length) setBurst((n) => n + 1);
    setPicks(next.picks);
  };

  const ctx = { now: new Date(), season: seasonForSheet(season), classNames };
  const pickCount = picks.length;
  const moonEnds = form?.term ? civilDayWords(form.term.endsOn) : "";
  // The village's goals for this season, live (the Season tab in Admin). Done ones drop off.
  const seasonRaw = season as unknown as { current?: SeasonDoc | null } & SeasonDoc | null;
  const seasonDoc: SeasonDoc | null = seasonRaw?.current ?? seasonRaw ?? null;
  const seasonName = typeof seasonDoc?.name === "string" ? seasonDoc.name.trim() : "";
  const seasonDates = seasonDoc?.startsOn && seasonDoc?.endsOn ? `${civilDayWords(seasonDoc.startsOn)} to ${civilDayWords(seasonDoc.endsOn)}` : "";
  const goals = (Array.isArray(seasonDoc?.goals) ? seasonDoc!.goals : [])
    .filter((g) => g && typeof g.text === "string" && g.text.trim())
    .map((g, i) => ({ id: String(g.id ?? i), text: String(g.text).trim(), done: !!g.done }));
  const playing = chars.map(castName).join(", ");

  return (
    <Layout>
      <div className="min-h-screen bg-background py-10 sm:py-14">
        <div className="container max-w-6xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-notice">{t({ message: "Open roles · select yours", context: "role draft eyebrow" })}</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-foreground text-balance">{t`Select your roles at ${villageName}`}</h1>
          <p className="mt-3 max-w-[66ch] text-muted-foreground">
            {t`Pick the characters you play, scout every open role by what it asks, open any card in full, and select up to three. Your selection stays in this browser until you apply, and nothing is sent before then.`}
          </p>

          <div className="sm:sticky sm:top-24 z-20 -mx-4 bg-background/95 px-4 pb-3 pt-1 backdrop-blur">
            <SelectStepper
              labels={[
                t({ message: "This season's goals", context: "role draft step" }),
                t({ message: "Your R-Ikigai and your characters", context: "role draft step" }),
                t({ message: "Scout the open roles", context: "role draft step" }),
                t({ message: "Select up to three", context: "role draft step" }),
                t({ message: "Apply", context: "role draft step" }),
              ]}
              step={step}
              reached={4}
              onGo={go}
              barLabel={t({ message: "Your progress through the four steps", context: "role draft steps" })}
            />
          </div>

          <section id="sel-season" className="sel-rise mt-8 scroll-mt-52 rounded-2xl border-2 border-notice bg-card p-5" aria-labelledby="sel-season-h">
            <h2 id="sel-season-h" className="font-display text-2xl font-bold text-card-foreground">
              {seasonName ? t({ message: `This season's goals: ${seasonName}`, context: "role draft season" }) : t({ message: "This season's goals", context: "role draft season" })}
            </h2>
            {seasonDates && <p className="mt-1 text-sm font-semibold text-muted-foreground">{seasonDates}</p>}
            <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">
              {t`A role card shows the work the village needs done. Your proposal is the other half: what you would like to contribute each moon and this season, and how it serves these goals.`}
            </p>
            {goals.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-start gap-2 text-sm text-card-foreground">
                    <Check className={`mt-0.5 size-4 shrink-0 ${g.done ? "text-muted-foreground" : "text-notice"}`} aria-hidden="true" />
                    <span>
                      {g.text}
                      {g.done && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t({ message: "Done", context: "role draft goal" })}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t`No goals are set for this season yet.`}</p>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => go(1)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {t({ message: "Next: your R-Ikigai and characters", context: "role draft next" })}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </section>
          <div id="sel-chars" className="scroll-mt-52"></div>
          <DiscoverStep cast={cast} chars={chars} onToggleChar={toggleChar} roles={roles} onDraft={(id) => { if (!picks.includes(id)) togglePick(id); }}>
          <section aria-labelledby="draft-chars">
            <h2 id="draft-chars" className="font-display text-2xl font-bold text-foreground">{t`Who do you play? Pick one or more.`}</h2>
            {load.kind === "ready" && roles.length > 0 && !tagsKnown && (
              <p className="mt-1 text-sm text-muted-foreground">{t`This village has not tagged its roles by character for visitors yet, so every role is shown for every character.`}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cast.map((c) => {
                const on = chars.includes(c.key);
                const n = fitCount(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    data-on={on}
                    onClick={() => toggleChar(c.key)}
                    className={`sel-lift group relative flex min-h-11 flex-col overflow-hidden rounded-2xl border-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${on ? "border-notice bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}
                  >
                    <ArtImage src={characterArt(c.key)} className="relative aspect-[4/5] w-full" imgClassName="object-top" />
                    {on && (
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-notice px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-background">
                        <Check className="size-3.5" aria-hidden="true" />
                        {t({ message: "You play this", context: "role draft character" })}
                      </span>
                    )}
                    <span className="flex flex-col gap-1 p-3">
                      <span className="font-display text-lg font-bold leading-tight">{c.name}</span>
                      <span className={`text-xs ${on ? "text-primary-foreground/85" : "text-muted-foreground"}`}>{c.subtitle}</span>
                      {load.kind === "ready" && tagsKnown && (
                        <span className={`text-xs font-semibold ${on ? "text-primary-foreground" : "text-foreground"}`}>
                          {n === 1 ? t({ message: "1 open role fits", context: "role draft character count" }) : t({ message: `${n} open roles fit`, context: "role draft character count" })}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => go(2)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {t({ message: "Next: scout the open roles", context: "role draft next" })}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </section>
          </DiscoverStep>

          <div id="sel-scout" className="sel-rise mt-10 grid scroll-mt-52 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <section aria-labelledby="draft-roles" className="min-w-0">
              <h2 id="draft-roles" className="font-display text-2xl font-bold text-foreground">{t({ message: "Open roles", context: "role draft heading" })}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" aria-pressed={!onlyFits} onClick={() => setOnlyFits(false)} className={`${CHIP} ${!onlyFits ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}>
                  {t({ message: "All open roles", context: "role draft filter" })}
                </button>
                <button
                  type="button"
                  aria-pressed={onlyFits}
                  disabled={!chars.length || !tagsKnown}
                  onClick={() => setOnlyFits(true)}
                  className={`${CHIP} disabled:opacity-50 ${onlyFits ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}
                >
                  {t({ message: "Only roles that fit", context: "role draft filter" })}
                </button>
              </div>

              {load.kind === "loading" && <p className="mt-6 text-muted-foreground">{t({ message: "Loading the open roles…", context: "role draft" })}</p>}
              {load.kind === "failed" && (
                <p role="alert" className="mt-6 rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
                  {t`We could not load the open roles just now. Refresh the page to try again, or see them on the Roles page.`}{" "}
                  <Link href="/roles" className="font-semibold underline underline-offset-2">{t({ message: "Roles page", context: "role draft link" })}</Link>
                </p>
              )}
              {load.kind === "ready" && shown.length === 0 && (
                <p className="mt-6 text-muted-foreground">
                  {roles.length === 0 ? t`No role is open right now. New roles open each season.` : t`No open role carries these characters yet. Every role is still open to you.`}
                </p>
              )}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {shown.map(({ role, fits }) => {
                  const drafted = picks.includes(role.id);
                  const roleName = role.name;
                  const fitsNames = fits.map(castName).join(", ");
                  const isOpen = open === role.id;
                  const openPlaces = role.openPlaces;
                  const answers = role.accountabilities;
                  const hours = role.timeCommitment ?? "";
                  const seats = role.seats;
                  return (
                    <article key={role.id} data-on={drafted} className={`sel-lift flex min-w-0 flex-col overflow-hidden rounded-2xl border-2 bg-card ${isOpen ? "sm:col-span-2" : ""} ${drafted ? "border-notice" : "border-border"}`}>
                      <div className="relative h-36 bg-primary text-primary-foreground">
                        <ArtImage src={roleArtFor(role)} className="absolute inset-0" imgClassName="object-top" />
                        <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/55 to-transparent" aria-hidden="true" />
                        {fits.length > 0 && (
                          <span className="absolute right-2 top-2 rounded-full bg-notice px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-background">
                            <Sparkles className="mr-1 inline size-3" aria-hidden="true" />
                            {t({ message: `Fits ${fitsNames}`, context: "role draft badge" })}
                          </span>
                        )}
                        {drafted && (
                          <span className="absolute left-2 top-2 grid size-8 place-items-center rounded-full bg-notice text-background" aria-hidden="true">
                            <Check className="size-4" />
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
                          <h3 className="font-display text-lg font-bold leading-tight break-words">{roleName}</h3>
                          <p className="text-sm text-primary-foreground/90">{role.circleName}</p>
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 border-b border-border text-center text-sm">
                        <div className="border-r border-border px-2 py-2">
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            <InfoTip tip={t`We don't pay for hours. We pay for contracted work and the contributions you lay out each moon and season. Hours are an estimate: full time is roughly 30 to 40 hours a week, half time roughly 20.`}>
                              {t({ message: "Time", context: "role draft stat" })}
                            </InfoTip>
                          </dt>
                          <dd className="font-semibold text-foreground">
                            {role.timeCommitment
                              ? roughHours(hours)
                              : t({ message: "~20 h half time, ~30 to 40 h full time", context: "role draft stat" })}
                          </dd>
                        </div>
                        <div className="px-2 py-2">
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t({ message: "Places", context: "role draft stat" })}</dt>
                          <dd className="font-semibold text-foreground">
                            {role.openPlaces > 0
                              ? t({ message: `${openPlaces} of ${seats} open`, context: "role draft stat" })
                              : role.recruiting
                                ? t({ message: "Recruiting", context: "role draft stat" })
                                : t({ message: "Open again", context: "role draft stat" })}
                          </dd>
                        </div>
                      </dl>
                      <div className="flex-1 px-4 py-3 text-sm">
                        <p className={role.aim ? "text-foreground" : "italic text-muted-foreground"}>{role.aim ?? t`This role has not written its aim yet.`}</p>
                        {role.accountabilities > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {role.accountabilities === 1 ? t`Answers for 1 thing` : t({ message: `Answers for ${answers} things`, context: "role draft stat" })}
                          </p>
                        )}
                      </div>
                      {isOpen && load.kind === "ready" && (
                        <div ref={cardRef} tabIndex={-1} role="region" aria-label={t`The full card for ${roleName}`} className="border-t border-border p-3 outline-none">
                          <SeatTradingCard
                            input={fromOrgSeat(role.raw, load.org.circles, load.org.people, load.org.village, { raiseHand: false })}
                            ctx={ctx}
                            embedded
                            settings={termsSlotFor(role.raw as Record<string, any>)}
                          />
                          <EditRoleButton roleId={role.id} className="mt-3" onSaved={() => window.location.reload()} />
                        </div>
                      )}
                      <div className="flex gap-2 px-4 pb-4">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={t({ message: `Full card for ${roleName}`, context: "role draft button label" })}
                          onClick={() => setOpen(isOpen ? null : role.id)}
                          className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {t({ message: "Full card", context: "role draft button" })}
                        </button>
                        {roleCardView(role.raw).beingWritten ? (
                          <p className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-dashed border-border px-4 text-sm font-semibold text-muted-foreground">
                            {BEING_WRITTEN}
                          </p>
                        ) : (
                        <button
                          type="button"
                          aria-pressed={drafted}
                          aria-label={t({ message: `Select ${roleName}`, context: "role draft button label" })}
                          aria-disabled={!drafted && pickCount >= OPEN_PROPOSAL_MAX_ROLES}
                          onClick={() => togglePick(role.id)}
                          className={`min-h-11 flex-1 rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:opacity-50 ${drafted ? "border-2 border-primary bg-card text-primary" : "bg-primary text-primary-foreground"}`}
                        >
                          {drafted && <Check className="mr-1 inline size-4" aria-hidden="true" />}
                          {drafted ? t({ message: "Selected", context: "role draft button" }) : t({ message: "Select", context: "role draft button" })}
                        </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="mt-6 flex justify-end">
                <button type="button" onClick={() => go(3)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {t({ message: "Next: review my selection", context: "role draft next" })}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </section>

            <aside id="sel-select" aria-label={t({ message: "Your selection", context: "role draft tray" })} className="relative order-first scroll-mt-52 rounded-2xl border-2 border-primary bg-card p-4 lg:order-last lg:sticky lg:top-56">
              <Burst play={burst} />
              <h2 className="font-display text-xl font-bold text-card-foreground">{t({ message: "Your selection", context: "role draft tray" })}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {chars.length ? t({ message: `Playing as ${playing}.`, context: "role draft tray" }) : t`No character picked yet.`}
              </p>
              {pickCount > 0 ? (
                <ol className="mt-3 grid gap-2">
                  {picks.map((id, i) => {
                    const r = byId.get(id);
                    if (!r) return null;
                    const rn = r.name;
                    return (
                      <li key={id} className="sel-rise flex min-h-12 items-center gap-2 rounded-xl border border-border px-2 py-1 text-sm">
                        <ArtImage src={roleArtFor(r)} className="relative size-10 shrink-0 rounded-lg" />
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-notice text-xs font-bold text-background" aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0 flex-1 font-semibold text-card-foreground break-words">{rn}</span>
                        <button type="button" onClick={() => togglePick(id)} aria-label={t`Remove ${rn} from your selection`} className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">{t`Select up to three roles. The order is your preference.`}</p>
              )}
              {full && <p role="status" className="mt-2 text-sm text-foreground">{t`Your selection holds three. Take one off to select another.`}</p>}
              {visitorClosed && pickCount > 0 && (
                <p role="status" className="mt-3 rounded-xl bg-muted p-3 text-sm text-foreground">
                  {form?.message ?? t`Applications are closed right now. Your selection stays here, and you can apply when they open.`}
                </p>
              )}
              {applyHref && (
                <Link href={applyHref} onClick={(e) => applyWithBurst(e, applyHref)} className="relative mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {member
                    ? pickCount === 1
                      ? t`Apply for this role`
                      : t`Apply for these ${pickCount} roles`
                    : pickCount === 1
                      ? t`Apply with my pick`
                      : t`Apply with my ${pickCount} picks`}
                  <ArrowRight className="size-4" aria-hidden="true" />
                  <Burst play={applyBurst} />
                </Link>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {saveBlocked
                  ? t`This browser won't keep your selection (private mode or site data blocked). It stays until you leave the page.`
                  : t`Kept in this browser only. Nothing is sent until you apply.`}
              </p>
            </aside>
          </div>

          <section id="sel-apply" className="mt-12 grid scroll-mt-52 gap-6 lg:grid-cols-2" aria-labelledby="draft-next">
            <div>
              <h2 id="draft-next" className="font-display text-2xl font-bold text-foreground">{t`What happens after you apply`}</h2>
              {member ? (
                <ol aria-label={t({ message: "After you apply", context: "role draft steps" })} className="mt-3 grid list-decimal gap-2 pl-5 text-sm text-foreground">
                  <li>{t`One role application carries all your picks, with the terms each role offers.`}</li>
                  <li>{t`Each role's circle is asked to consent, and a holder of the power to place people in roles adopts it, never their own.`}</li>
                  <li>{t`Once you are approved into a role, you align with the village's confidentiality agreement (NDA), before you see any confidential records.`}</li>
                  <li>
                    {t`Planning for next season instead? Propose my roles lets you change any words (your changes show in gold) and tie your season goals to the village's.`}{" "}
                    {picks[0] && (
                      <Link href={proposeRoleHref(picks[0])} className="font-semibold underline underline-offset-2">
                        {t({ message: "Propose my roles", context: "role draft link" })}
                      </Link>
                    )}
                  </li>
                </ol>
              ) : (
                <ol aria-label={t({ message: "After you apply", context: "role draft steps" })} className="mt-3 grid list-decimal gap-2 pl-5 text-sm text-foreground">
                  <li>{t`You align with the Love Letter, the village's membership agreement, when you apply. Aligning is the village's way of signing.`}</li>
                  <li>{t`You confirm your email within 48 hours. Nothing reaches the village before you do.`}</li>
                  <li>{t`You meet the people the role works with, in the order the role sets, when it sets one.`}</li>
                  <li>{t`Each role's circle is asked to consent. A holder of the power to place people in roles adopts or declines your application, and never their own.`}</li>
                  <li>{t`If it is adopted, an invitation to make your account comes to your email.`}</li>
                  <li>{t`Once you are approved into a role, you align with the village's confidentiality agreement (NDA), before you see any confidential records.`}</li>
                  <li>
                    {form?.term
                      ? t`Your role runs from adoption to the next new moon, ${moonEnds}. Each moon you lay out what you will contribute.`
                      : t`Your role starts on the first day of next season.`}
                  </li>
                </ol>
              )}
              {/* Each drafted role's conversations in order, when the role sets them (Rye's answer 7). */}
              {!member && <NextForRoles roles={(form?.roles ?? []).filter((r) => picks.includes(r.id))} />}
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">{t({ message: "Other ways in", context: "role draft heading" })}</h2>
              <ul className="mt-3 grid gap-2 text-sm">
                <li>
                  <Link href="/quests" className="inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline underline-offset-2">
                    <Compass className="size-4" aria-hidden="true" />
                    {t`Start with a quest. Quests walk a path, and a path leads to a role.`}
                  </Link>
                </li>
                {places.length > 0 ? (
                  <li>
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      <MapPin className="size-4" aria-hidden="true" />
                      {t`Places looking for a steward:`}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2 pl-6">
                      {places.map((p) => (
                        <li key={p.key}>
                          <Link href="/map" className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-foreground hover:bg-muted">{p.name}</Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : (
                  <li>
                    <Link href="/map" className="inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline underline-offset-2">
                      <MapPin className="size-4" aria-hidden="true" />
                      {t`See the places and their open roles on the Living Map`}
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
