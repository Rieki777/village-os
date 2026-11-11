/**
 * PROPOSE A ROLE, WITHOUT AN ACCOUNT (Rye, 2026-10-30; sheet 19i).
 *
 *   /propose-a-role                 the village's public link
 *   /propose-a-role/<token>         a link made for one person
 *   /propose-a-role/confirm?token=  the link in the confirmation email
 *
 * `?role=<id>` ticks that role when it is on offer: a circle card's Apply link
 * for a visitor or a guest lands here with it (shared/circleCard.ts). A guest
 * who is signed in finds their name and address filled in.
 *
 * Next season's roles, grouped by circle. The person picks up to three, says
 * what they bring to each and why, and gives their name and address. Sending
 * asks the address to confirm; nothing reaches the village until it does
 * (server/routes/openProposals.ts). The words are shared/openProposals.ts.
 *
 * WHAT IS KEPT, said on the form in one line (sheet 19i): a proposal never
 * confirmed is deleted after 48 hours, and a declined one loses its name and
 * address after 90 days (docs/ARCHITECTURE.md, 3.9).
 */
import CastStrip from "@/components/roleDraft/CastStrip";
import Burst from "@/components/roleDraft/Burst";
import { EMPTY_ROLE_CARD, goalsToFirstMoon, RoleAsks, SeasonServes, type RoleCardState } from "@/components/openProposal/RoleCardBridge";
import { MembershipAtApplication, type MembershipChoice } from "@/components/openProposal/MembershipAtApplication";
import { AttachmentFields, linksToSend } from "@/components/openProposal/ProposalAttachments";
import type { ProposalLink } from "@shared/proposalAttachments";
import { AskSera, DraftMark } from "@/components/proposalDrafts/AskSera";
import { DRAFT_WORDS, goalsFromDraft, isTextDraft, placeDraftGoals, unconfirmedDrafts, type DraftMarks } from "@shared/seraDrafts";
import { GOAL_LIMITS, parseGoals } from "@shared/proposalGoals";
import { CARD_WORDS } from "@shared/openProposalCard";
import { BreathingLoader } from "@/components/natural";
import { AboutYouFacts, ReferencesBlock, EMPTY_ABOUT_YOU, aboutYouBody, aboutYouProblem, type AboutYouValue } from "@/components/openProposal/AboutYou";
import { termOf, type OpenProposalTerm } from "@shared/openProposalTerm";
import { civilDayWords } from "@shared/seasonPlans";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "@/i18n/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { doorBackOf } from "@shared/seatApplyLinks";
import Layout from "@/components/Layout";
import { BTN_PRIMARY, FIELD as LOOK_FIELD, WORLD } from "@/components/journey/look";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { readStoredJson } from "@/lib/safeStorage";
import { IKIGAI_KEY, ikigaiFromStored, whyFromIkigai } from "@shared/roleDiscover";
import { OPEN_AIM_MAX, OPEN_ANONYMISE_DAYS, OPEN_CONFIRM_HOURS, OPEN_NOTE_MAX, OPEN_PROPOSAL_MAX_ROLES, OPEN_WHY_MAX, OPEN_WORDS } from "@shared/openProposals";
// Form v2's pieces, on their own line so the membership lane's edit to the line above them merges clean.
import TermsEight, { EMPTY_TERMS_STEP, type TermsStepValue } from "@/components/governance/TermsEight";
import { judgeTermsStep, writtenKeys, type TermsWords } from "@shared/termsWords";
import { NextForRoles, Practicalities, browserTimeZone, type Practical } from "@/components/openProposal/RoleCardBridge";
/** The goals are asked on each role card now (guide v2); the global pick is left empty. */
const NO_GLOBAL_SERVES: Record<string, string> = {};

// The sheet's field and main button (docs/DESIGN_RULE.md, components/journey/look.ts).
const FIELD = `${LOOK_FIELD} py-3`;
const BUTTON = `${BTN_PRIMARY} py-3`;

interface FormRole {
  id: string;
  name: string;
  circle: string;
  aim: string | null;
  /** The open card's own sections, to answer with the applicant's card (shared/openProposalCard.ts). */
  accountabilities?: string[];
  timeCommitment?: string | null;
  /** The role's suggested wording for the eight settings and the commitment it asks (joining lane PR 3). */
  terms?: { words?: TermsWords; commitmentPct?: number | null };
  /** Filled by the role-conversations lane and PR-A; nothing shows until they are. */
  conversations?: Array<{ role: string; minutes: number; finalApproval?: boolean }>;
  bookingUrl?: string | null;
  /** A check happens for this role whatever the references say (0370). */
  alwaysChecked?: boolean;
}

type FormState =
  | { kind: "loading" }
  | { kind: "closed"; message: string }
  | { kind: "open"; village: string; season: { id: string; name: string | null; startsOn: string } | null; term: OpenProposalTerm | null; goals: Array<{ id: string; text: string }>; roles: FormRole[] }
  | { kind: "failed" };

/** One thing to fix before sending: the field's name, the words, and where to look for it on the page. */
interface FormProblem {
  field: string | null;
  message: string;
  target: string | null;
}

/** Where on the form each field name the server or the checks use can be found. */
function targetFor(field: string | null): string | null {
  switch (field) {
    case "why": return "#propose-why";
    case "aim": return "#propose-aim";
    case "name": return "#propose-name";
    case "email": return "#propose-email";
    case "roles": return "#propose-roles";
    case "serves": return "[data-card-serves]";
    case "card": return "[data-role-card]";
    case "terms": return "[data-terms-section]";
    case "agreed": return "[data-agreements] input[type=checkbox][required]";
    case "checkConsent":
    case "references":
    case "about":
    case "links":
    case "files": return "[data-about-you-section]";
    case "membership": return "[data-agreements]";
    default: return null;
  }
}

/** Scroll to what needs fixing and put the cursor there, so a press on Send never looks like nothing happened. */
function goToProblem(target: string | null) {
  if (typeof document === "undefined") return;
  const el = target ? document.querySelector<HTMLElement>(target) : null;
  const form = document.querySelector<HTMLElement>("[data-open-proposal]");
  const spot = el ?? form?.querySelector<HTMLElement>("#propose-problems") ?? null;
  if (!spot) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  spot.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
  const focusable = spot.matches("input,textarea,select,button,[tabindex]") ? spot : spot.querySelector<HTMLElement>("input,textarea,select,button");
  (focusable ?? spot).focus({ preventScroll: true });
}

/** The words for a problem shown beside its field. */
function Beside({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 border-l-4 border-notice pl-3 text-sm font-medium text-foreground" data-field-problem="">
      {message}
    </p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <div className={`${WORLD} py-12 sm:py-16`}>
        <div className="container max-w-2xl">{children}</div>
      </div>
    </Layout>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-live="polite" className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <MailCheck className="h-8 w-8 text-notice" aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1} className="mt-4 font-display text-3xl font-bold text-card-foreground outline-none">
        {title}
      </h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}

/** The link in the confirmation email. */
export function ConfirmProposal() {
  const { t } = useLingui();
  const gone = t`That link has run out or was already used. Send your proposal again, and open the new link within ${OPEN_CONFIRM_HOURS} hours.`;
  const [said, setSaid] = useState<{ ok: boolean; message: string; statusPath?: string | null } | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    fetch("/api/open-proposals/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        // The applicant's own page (role journey L5): shown once here as well as mailed, and only an address of its own.
        const statusPath = typeof data?.statusPath === "string" && data.statusPath.startsWith("/application-status/") ? data.statusPath : null;
        setSaid({ ok: r.ok, message: typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : gone, statusPath });
      })
      .catch(() => setSaid({ ok: false, message: gone }));
  }, []);
  return (
    <Shell>
      {said ? (
        <Notice title={said.ok ? t({ message: "Confirmed", context: "open proposal confirm" }) : t`That link didn't work`}>
          <p>{said.message}</p>
          {said.ok && said.statusPath && (
            <>
              <a href={said.statusPath} className={`${BUTTON} mt-6`} data-status-link="">
                {t`Follow where your proposal is`}
              </a>
              <p className="mt-3 text-sm text-muted-foreground">{t`We emailed you this link too. Keep it to yourself: it is how we know it is you.`}</p>
            </>
          )}
          {!said.ok && (
            <a href="/propose-a-role" className={`${BUTTON} mt-6`}>
              {t({ message: "Propose again", context: "open proposal confirm" })}
            </a>
          )}
        </Notice>
      ) : (
        <BreathingLoader label={t({ message: "Confirming your proposal", context: "open proposal" })} showLabel />
      )}
    </Shell>
  );
}

export default function ProposeARole() {
  const params = useParams<{ token?: string }>();
  const link = params.token ? decodeURIComponent(params.token) : "";
  const [form, setForm] = useState<FormState>({ kind: "loading" });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [why, setWhy] = useState("");
  const [aim, setAim] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  /** Every problem found on the last press of Send, each with the field it is on (audit M1). */
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const error = problems[0] ?? null;
  const setError = (e: { field: string | null; message: string } | null) => setProblems(e ? [{ ...e, target: targetFor(e.field) }] : []);
  const problemOn = (field: string) => problems.find((p) => p.field === field)?.message ?? null;
  const [sent, setSent] = useState<string | null>(null);
  /** The applicant's own card (components/openProposal/RoleCardBridge.tsx). */
  const [cards, setCards] = useState<Record<string, RoleCardState>>({});
  const [practical, setPractical] = useState<Practical>(() => ({ timeZone: browserTimeZone(), windows: [], earliestStart: "" }));
  /** The eight settings answered and the commitment chosen (components/governance/TermsEight.tsx). */
  const [termsStep, setTermsStep] = useState<TermsStepValue>(EMPTY_TERMS_STEP);
  const [agreed, setAgreed] = useState({ nda: false });
  /** Links to their work and files, for the deciders only (Rye, 10 Nov 2026). */
  const [links, setLinks] = useState<ProposalLink[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  /** About you: facts, references and the consent (components/openProposal/AboutYou.tsx). */
  const [about, setAbout] = useState<AboutYouValue>(EMPTY_ABOUT_YOU);
  /** The words Sera drafted, until they are edited or kept (shared/seraDrafts.ts). Never sent. */
  const [marks, setMarks] = useState<DraftMarks>({});
  /** The membership alignment made here (Rye's answer 8); it answers the Love Letter tick. */
  const [membership, setMembership] = useState<MembershipChoice>({ kind: "none" });
  const [letterRead, setLetterRead] = useState(0);
  /** How many of the roles the link named the village no longer offers. */
  const [unoffered, setUnoffered] = useState(0);
  const me = useOptionalAuth()?.user ?? null;
  const { t } = useLingui();
  const maxRoles = OPEN_PROPOSAL_MAX_ROLES;
  const confirmHours = OPEN_CONFIRM_HOURS;
  const anonymiseDays = OPEN_ANONYMISE_DAYS;

  useEffect(() => {
    // Every role a link or the draft board sent, in order (role draft board, 9 Nov).
    const wanted = new URLSearchParams(window.location.search).getAll("role").map((r) => r.trim()).filter(Boolean);
    fetch(`/api/open-proposals/form${link ? `?link=${encodeURIComponent(link)}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const roles: FormRole[] = Array.isArray(d?.roles) ? d.roles : [];
        setForm(d?.open ? { kind: "open", village: String(d.village ?? ""), season: d.season ?? null, term: termOf(d.term) ?? null, goals: Array.isArray(d.goals) ? d.goals : [], roles } : { kind: "closed", message: String(d?.message ?? OPEN_WORDS.closed) });
        // The roles the Apply link or the draft was for, ticked while the village still offers them.
        if (d?.open && wanted.length) {
          const offered = wanted.filter((id) => roles.some((r) => r.id === id)).slice(0, OPEN_PROPOSAL_MAX_ROLES);
          setUnoffered(wanted.filter((id) => !roles.some((r) => r.id === id)).length);
          if (offered.length) setPicked((p) => (Object.keys(p).length ? p : Object.fromEntries(offered.map((id) => [id, ""]))));
        }
      })
      .catch(() => setForm({ kind: "failed" }));
  }, [link]);

  // R-Ikigai answers the person ticked on the draft board become their own words in "Why you", once, and only into an empty field.
  useEffect(() => {
    const read = readStoredJson("local", IKIGAI_KEY);
    const words = whyFromIkigai(ikigaiFromStored(read.status === "value" ? read.value : null));
    if (words) setWhy((w) => w || words);
  }, []);

  // A guest who is signed in: their own name and address, which they can still change.
  useEffect(() => {
    if (!me) return;
    setName((n) => n || String(me.name ?? ""));
    setEmail((e) => e || String(me.email ?? ""));
  }, [me]);

  const circles = useMemo(() => {
    const by = new Map<string, FormRole[]>();
    if (form.kind === "open") for (const r of form.roles) by.set(r.circle, [...(by.get(r.circle) ?? []), r]);
    return Array.from(by.entries());
  }, [form]);

  const count = Object.keys(picked).length;
  /** The roles picked and the candidate's note on each: the only role words a draft is asked from. */
  const askRoles = Object.entries(picked).map(([roleId, note]) => ({ roleId, note }));
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = { ...p };
      if (id in next) delete next[id];
      else if (Object.keys(next).length < OPEN_PROPOSAL_MAX_ROLES) next[id] = "";
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    // Every problem at once, so nobody meets them one press at a time. The server judges all of it again.
    const found: FormProblem[] = [];
    const add = (field: string, message: string, target = targetFor(field)) => found.push({ field, message, target });
    const pending = unconfirmedDrafts({ aim, story: about.story, marks, goals: Object.keys(picked).flatMap((id) => (cards[id] ?? EMPTY_ROLE_CARD).goals) });
    if (pending.length > 0) found.push({ field: null, message: DRAFT_WORDS.blocked(pending), target: null });
    if (!why.trim()) add("why", OPEN_WORDS.needWhy);
    if (!aim.trim()) add("aim", OPEN_WORDS.needAim);
    if (count === 0) add("roles", OPEN_WORDS.needRole);
    if (form.kind === "open") {
      const today = new Date().toISOString().slice(0, 10);
      const seasonKeys = new Set(form.goals.map((g) => g.id));
      const chosen = form.roles.filter((r) => r.id in picked);
      for (const r of chosen) {
        const own = (r.accountabilities ?? []).map((a) => a.trim());
        const asked = (cards[r.id] ?? EMPTY_ROLE_CARD).goals.map((g) => ({ ...g, roleId: r.id }));
        const judged = parseGoals(asked, { roleGoalsOf: () => own, seasonKeys, today });
        if (!judged.ok) add("card", chosen.length > 1 ? `${r.name}: ${judged.error}` : judged.error, `[data-role-card="${r.id}"]`);
      }
      if (chosen.length > 0 && form.goals.length > 0 && chosen.every((r) => Object.keys(cards[r.id]?.serves ?? {}).length === 0)) {
        add("serves", CARD_WORDS.needGoal, `[data-card-serves="${chosen[0].id}"]`);
      }
      // The consent is asked before anything goes, in the words the shared rules use.
      const aboutProblem = aboutYouProblem(about, chosen.some((r) => r.alwaysChecked === true));
      if (aboutProblem) add("checkConsent", aboutProblem);
      // Every written setting answered and the commitment chosen, in the shared rules' words.
      const judgedTerms = judgeTermsStep({ answers: termsStep.answers, commitmentPct: termsStep.commitmentPct }, writtenKeys(chosen.map((r) => ({ words: r.terms?.words, commitmentPct: r.terms?.commitmentPct ?? null }))));
      if (!judgedTerms.ok) add("terms", judgedTerms.error);
    }
    if (!agreed.nda) add("agreed", CARD_WORDS.agreed);
    if (!name.trim()) add("name", OPEN_WORDS.needName);
    if (!email.trim()) add("email", OPEN_WORDS.needEmail);
    if (found.length > 0) {
      setProblems(found);
      // After the list has drawn, go to the first one.
      window.setTimeout(() => goToProblem(found[0].target), 0);
      return;
    }
    setSending(true);
    setProblems([]);
    try {
      const proposal = {
        name,
        email,
        why,
        aim,
        hp,
        link: link || undefined,
        roles: Object.entries(picked).map(([roleId, note]) => ({ roleId, note })),
        // The applicant's own card, one section per section of the open card.
        card: {
          roles: Object.keys(picked).map((roleId) => {
            const c = cards[roleId] ?? EMPTY_ROLE_CARD;
            return {
              roleId,
              moves: Object.entries(c.moves).map(([text, target]) => ({ text, target })),
              firstMoon: goalsToFirstMoon(c.goals),
            };
          }),
          timeZone: practical.timeZone.trim(),
          windows: practical.windows,
          earliestStart: practical.earliestStart,
          // The eight settings, each answered, and the commitment chosen: the server judges both again.
          terms: { answers: termsStep.answers },
          commitmentPct: termsStep.commitmentPct ?? undefined,
          // Guide v2: each role card names the season goals its work serves.
          serves: Object.keys(picked).flatMap((roleId) => Object.entries(cards[roleId]?.serves ?? {}).map(([goalId, how]) => ({ goalId, how, roleId }))),
          // The NDA promise only: the membership letter is aligned with below, never ticked.
          agreed,
        },
        // The site language they are reading this in: their emails and status page follow it (shared/applicantLanguage.ts).
        locale: i18n.locale,
        // The letter version the applicant aligned with here; recorded once the address confirms.
        ...(membership.kind === "aligned" ? { membership: { letterVersion: membership.letterVersion } } : {}),
        // Links only when there are some: a proposal without them sends what it always sent.
        ...(linksToSend(links).length ? { links: linksToSend(links) } : {}),
        // About you: references, facts and the consent with the wording version shown.
        ...aboutYouBody(about),
      };
      // With files, the proposal goes as one field of a multipart post (server/routes/openProposals.ts).
      let request: RequestInit;
      if (files.length) {
        const fd = new FormData();
        fd.append("proposal", JSON.stringify(proposal));
        for (const f of files) fd.append("files", f, f.name);
        request = { method: "POST", body: fd };
      } else {
        request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) };
      }
      const res = await fetch("/api/open-proposals", request);
      const data = await res.json().catch(() => ({}));
      // The letter changed while they read it: show it again, untick, and say so.
      if (!res.ok && data?.field === "membership") setLetterRead((n) => n + 1);
      if (!res.ok) {
        const field = typeof data?.field === "string" ? data.field : null;
        setError({ field, message: typeof data?.error === "string" ? data.error : OPEN_WORDS.notSent });
        window.setTimeout(() => goToProblem(targetFor(field)), 0);
        return;
      }
      setSent(typeof data?.message === "string" ? data.message : OPEN_WORDS.sent(email.trim()));
    } catch {
      setError({ field: null, message: OPEN_WORDS.notSent });
    } finally {
      setSending(false);
    }
  };

  if (form.kind === "loading") {
    return (
      <Shell>
        <BreathingLoader label={t({ message: "Opening the form", context: "open proposal" })} showLabel />
      </Shell>
    );
  }
  if (form.kind === "failed") {
    return (
      <Shell>
        <p role="alert" className="text-foreground">
          {t`This page didn't load. Check your connection and try again.`}
        </p>
      </Shell>
    );
  }
  if (form.kind === "closed") {
    return (
      <Shell>
        <Notice title={t`Not open right now`}>
          <p>{form.message}</p>
        </Notice>
      </Shell>
    );
  }
  if (sent) {
    return (
      <Shell>
        <div className="relative">
          <Burst play={1} />
          <Notice title={t({ message: "Check your email", context: "open proposal sent" })}>
            <p>{sent}</p>
            {/* The steps after confirming, for the roles picked (Rye's answer 7): conversations in order, the booking link. */}
            {form.kind === "open" && <NextForRoles roles={form.roles.filter((r) => r.id in picked)} />}
          </Notice>
        </div>
      </Shell>
    );
  }

  const seasonName = form.season?.name || t({ message: "next season", context: "open proposal season" });
  const village = form.village;
  const moonFrom = form.term ? civilDayWords(form.term.startsOn) : "";
  const moonTo = form.term ? civilDayWords(form.term.endsOn) : "";
  // Only when a door sent the visitor here with `from`; a shared link stands on its own.
  const cameFrom = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") ? doorBackOf(window.location.search, "", window.location.origin) : null;
  const invalid = (field: string) => (error?.field === field ? { "aria-invalid": true, "aria-describedby": `propose-problem-${field}` } : {});

  return (
    <Shell>
      <div className="mb-8">
        {/* Back to the board or the role card the visitor came from (role audit, 10 Nov 2026). */}
        {cameFrom && (
          <Link
            href={cameFrom.href}
            className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            data-door-back=""
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {cameFrom.card ? t`Back to the role` : cameFrom.circle ? t`Back to the circle` : t`Back to the roles`}
          </Link>
        )}
        <h1 className="font-display text-4xl font-bold text-foreground">{t`Propose a role in ${village}`}</h1>
        <CastStrip href="/roles/select" size="size-16" />
        <p className="mt-3 text-muted-foreground">
          {form.term
            ? t`Pick up to ${maxRoles} roles for this moon, from ${moonFrom} to the next new moon on ${moonTo}, say what you bring, and send it. You don't need an account.`
            : form.season
              ? t`Pick up to ${maxRoles} roles for ${seasonName}, say what you bring, and send it. You don't need an account.`
              : t`The village hasn't set its next season yet, so there's nothing to propose for right now. Check back soon.`}
        </p>
      </div>

      {form.season && (
        <form onSubmit={submit} noValidate className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm" data-open-proposal="" data-hides-fab="">
          {/* The trail through the form: four parts, each a jump. */}
          <nav aria-label={t({ message: "Parts of this form", context: "open proposal" })} className="-mt-2 flex flex-wrap gap-x-5 text-sm" data-form-trail="">
            {[
              [t({ message: "Your season", context: "open proposal section" }), "#propose-roles"],
              [t({ message: "About you", context: "open proposal section" }), "[data-about-you-section]"],
              [t({ message: "The terms", context: "open proposal section" }), "[data-terms-section]"],
              [t({ message: "Send", context: "open proposal section" }), "#propose-name"],
            ].map(([label, sel], i) => (
              <button key={sel} type="button" onClick={() => goToProblem(sel)} className="min-h-11 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {i + 1}. {label}
              </button>
            ))}
          </nav>
          {problems.length > 0 && (
            <div id="propose-problems" tabIndex={-1} role="alert" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground outline-none" data-problems="">
              <p className="font-semibold">{problems.length === 1 ? t`One thing to fix before we can send this:` : t`${problems.length} things to fix before we can send this:`}</p>
              <ul className="mt-2 grid gap-1">
                {problems.map((p, i) => (
                  <li key={`${p.field}-${i}`}>
                    {p.target ? (
                      <button type="button" onClick={() => goToProblem(p.target)} className="min-h-11 text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
                        {p.message}
                      </button>
                    ) : (
                      p.message
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Guide v2: why you and your aim, then each role card (its goals, the first moon's goals, the season goal it serves), then the practicalities. */}
          <div>
            <label htmlFor="propose-why" className="mb-2 block text-sm font-semibold text-card-foreground">
              {t`Why you, and why now`}
            </label>
            <textarea id="propose-why" required rows={5} maxLength={OPEN_WHY_MAX} value={why} onChange={(e) => setWhy(e.target.value)} className={FIELD} {...invalid("why")} />
            <Beside id="propose-problem-why" message={problemOn("why")} />
          </div>
          <div>
            <label htmlFor="propose-aim" className="mb-2 block text-sm font-semibold text-card-foreground">
              {t`Your aim for the season`}
            </label>
            <input id="propose-aim" required maxLength={OPEN_AIM_MAX} value={aim} onChange={(e) => setAim(e.target.value)} className={FIELD} {...invalid("aim")} />
            <Beside id="propose-problem-aim" message={problemOn("aim")} />
            {count > 0 && (
              <div className="mt-2 grid gap-2">
                {(!aim.trim() || isTextDraft(aim, marks.aim)) && <AskSera kind="aim" roles={askRoles} why={why} aim={aim} onDraft={(r) => { if (r.aim) { setAim(r.aim.slice(0, OPEN_AIM_MAX)); setMarks((m) => ({ ...m, aim: r.aim!.slice(0, OPEN_AIM_MAX) })); } }} />}
                {isTextDraft(aim, marks.aim) && <DraftMark onKeep={() => setMarks((m) => ({ ...m, aim: undefined }))} />}
              </div>
            )}
          </div>
          <fieldset id="propose-roles" tabIndex={-1} className="scroll-mt-24 space-y-4 outline-none" {...invalid("roles")}>
            <legend className="mb-2 text-sm font-semibold text-card-foreground">
              {t`Pick up to ${maxRoles} roles`} <span className="font-normal text-muted-foreground">{t({ message: `(${count} of ${maxRoles})`, context: "open proposal roles count" })}</span>
            </legend>
            {unoffered > 0 && (
              <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
                {unoffered === 1
                  ? t`1 role you picked is not open any more. Pick from the roles below.`
                  : t`${unoffered} roles you picked are not open any more. Pick from the roles below.`}
              </p>
            )}
            {circles.map(([circle, roles]) => (
              <div key={circle} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{circle}</h2>
                {roles.map((r) => {
                  const on = r.id in picked;
                  return (
                    <div key={r.id} className={`rounded-xl border p-4 ${on ? "border-notice bg-notice/10" : "border-border"}`} data-role={r.id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-notice"
                          checked={on}
                          disabled={!on && count >= OPEN_PROPOSAL_MAX_ROLES}
                          onChange={() => toggle(r.id)}
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className="break-words font-semibold text-card-foreground">{r.name}</span>
                          {r.aim && <span className="break-words text-sm text-muted-foreground">{r.aim}</span>}
                        </span>
                      </label>
                      {on && r.alwaysChecked && (
                        <p className="mt-3 text-sm text-foreground" data-role-checked="">
                          {t({ message: "A background check happens for this role whatever the references say.", context: "open proposal role" })}
                        </p>
                      )}
                      {on && (
                        <label className="mt-3 grid gap-1 text-sm font-medium text-card-foreground">
                          {t`What you bring to this role`} <span className="font-normal text-muted-foreground">{t({ message: "(optional)", context: "open proposal field" })}</span>
                          <textarea
                            rows={3}
                            maxLength={OPEN_NOTE_MAX}
                            value={picked[r.id]}
                            onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.value }))}
                            className={FIELD}
                          />
                        </label>
                      )}
                      {on && (
                        <RoleAsks
                          roleId={r.id}
                          roleName={r.name}
                          aim={r.aim}
                          commitmentPct={r.terms?.commitmentPct ?? null}
                          accountabilities={r.accountabilities ?? []}
                          goals={form.goals}
                          value={cards[r.id] ?? EMPTY_ROLE_CARD}
                          onChange={(next) => setCards((c) => ({ ...c, [r.id]: next }))}
                          assist={
                            <AskSera
                              kind="goals"
                              roles={[{ roleId: r.id, note: picked[r.id] }]}
                              why={why}
                              aim={aim}
                              onDraft={(reply) =>
                                setCards((c) => {
                                  const card = c[r.id] ?? EMPTY_ROLE_CARD;
                                  return { ...c, [r.id]: { ...card, goals: placeDraftGoals(card.goals, goalsFromDraft((reply.goals ?? []).filter((g) => g.roleId === r.id)), GOAL_LIMITS.max) } };
                                })
                              }
                            />
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <Beside id="propose-problem-roles" message={problemOn("roles")} />
          </fieldset>

          {/* The practicalities, then the agreements, then who you are (guide v2; role audit, 10 Nov 2026). */}
          {/* About you: after the goals, before the terms. The links and files moved here from below. */}
          <section aria-labelledby="propose-about-h" className="grid scroll-mt-24 gap-5 border-t border-border pt-6" data-about-you-section="">
            <h2 id="propose-about-h" className="font-display text-2xl font-bold text-card-foreground">
              {t({ message: "About you", context: "open proposal section" })}
            </h2>
            <AboutYouFacts
              value={about}
              onChange={setAbout}
              idPrefix="propose-about"
              storyAssist={
                count > 0 ? (
                  <>
                    {(!about.story.trim() || isTextDraft(about.story, marks.story)) && <AskSera kind="story" roles={askRoles} why={why} aim={aim} onDraft={(r) => { if (r.story) { setAbout((a) => ({ ...a, story: r.story! })); setMarks((m) => ({ ...m, story: r.story })); } }} />}
                    {isTextDraft(about.story, marks.story) && <DraftMark onKeep={() => setMarks((m) => ({ ...m, story: undefined }))} />}
                  </>
                ) : null
              }
            />
            <Practicalities value={practical} onChange={setPractical} part="about" />
            <AttachmentFields
              links={links}
              onLinks={setLinks}
              files={files}
              onFiles={setFiles}
              invalid={error && (error.field === "links" || error.field === "files") ? { field: error.field, message: error.message } : null}
            />
            <ReferencesBlock value={about} onChange={setAbout} idPrefix="propose-about" alwaysChecked={form.roles.some((r) => r.id in picked && r.alwaysChecked === true)} invalid={error?.field === "checkConsent" || error?.field === "references"} />
          </section>
          <Practicalities value={practical} onChange={setPractical} part="rest" />
          {/* The terms: all eight settings with each role's suggestion, then the commitment (joining lane PR 3). */}
          <section aria-labelledby="propose-terms-h" tabIndex={-1} className="grid scroll-mt-24 gap-4 border-t border-border pt-6 outline-none" data-terms-section="">
            <h2 id="propose-terms-h" className="font-display text-2xl font-bold text-card-foreground">
              {t({ message: "The terms", context: "open proposal section" })}
            </h2>
            <TermsEight
              roles={form.roles.filter((r) => r.id in picked).map((r) => ({ id: r.id, name: r.name, words: r.terms?.words, commitmentPct: r.terms?.commitmentPct ?? null }))}
              value={termsStep}
              onChange={setTermsStep}
              problem={error?.field === "terms" ? error.message : null}
              idPrefix="propose-terms"
            />
          </section>
          <div data-agreements="" className="scroll-mt-24">
          <SeasonServes goals={form.goals} serves={NO_GLOBAL_SERVES} onServes={() => {}} showGoals={false} agreed={agreed}
            onAgreed={setAgreed}
            membership={<MembershipAtApplication signedIn={!!me} choice={membership} onChoice={setMembership} refreshKey={letterRead} />}
          />
            <Beside id="propose-problem-agreed" message={problemOn("agreed") ?? problemOn("membership")} />
          </div>
          <div>
            <label htmlFor="propose-name" className="mb-2 block text-sm font-semibold text-card-foreground">
              {t({ message: "Your name", context: "open proposal field" })}
            </label>
            <input id="propose-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={FIELD} {...invalid("name")} />
            <Beside id="propose-problem-name" message={problemOn("name")} />
          </div>
          <div>
            <label htmlFor="propose-email" className="mb-2 block text-sm font-semibold text-card-foreground">
              {t({ message: "Your email", context: "open proposal field" })}
            </label>
            <input id="propose-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} {...invalid("email")} />
            <Beside id="propose-problem-email" message={problemOn("email")} />
            <p className="mt-2 text-sm text-muted-foreground">{t`We'll only write to you about this proposal.`}</p>
            <p className="mt-1 text-sm text-muted-foreground" data-after-approval="">
              {t`We will write to this address with every reply. If we approve your proposal, you will get an email with a button to create your profile, where your tasks and our replies live.`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground" data-kept-for="">
              {t`If you don't confirm within ${confirmHours} hours, we delete what you sent. If the village says no, or says yes and you never make your account, we remove your name and email ${anonymiseDays} days later.`}
            </p>
            {/* The same words as OPEN_AI_DRAFTS, which the confirmation email carries (Rye, 9 Nov 2026). */}
            <p className="mt-1 text-sm text-muted-foreground" data-ai-drafts="">
              {t`An AI may help draft our replies to you; a person always reads and sends them, and no AI takes part in choosing.`}
            </p>
          </div>
          {/* The honeypot. Named `hp` so no autofill heuristic fills it; see ReserveHome.tsx. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
            <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>
          <button type="submit" disabled={sending || count === 0} className={`${BUTTON} w-full`}>
            {sending ? t({ message: "Sending...", context: "open proposal send" }) : t({ message: "Send my proposal", context: "open proposal send" })}
            {!sending && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
          </button>
        </form>
      )}
    </Shell>
  );
}
