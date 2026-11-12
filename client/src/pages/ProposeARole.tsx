/**
 * APPLY FOR A ROLE, WITHOUT AN ACCOUNT (Rye, 2026-10-30; sheet 19i), as the
 * founding-team application (the lead, 11 Nov 2026; Phase A, lane A1).
 *
 *   /propose-a-role?role=<id>       "Apply: [role name]", from the role's card
 *   /propose-a-role                 the open roles, to choose one
 *   /propose-a-role/<token>         a link made for one person
 *   /propose-a-role/confirm?token=  the link in the confirmation email
 *
 * ONE ROLE PER APPLICATION. The role card's Apply link names it, and it is
 * already chosen. With no role named, the page shows the open roles, one door
 * each, and never lets more than one be chosen. A link naming several (the
 * draft board) applies for the first one the village still offers.
 *
 * SIX STEPS, "Step N of 6": Get to know us, About you, Your value, The terms,
 * Your first day, Review & submit. The Firefly Path's mechanics are kept
 * (game feel wave 2): every step stays drawn and only the one you are on
 * shows, so Back loses nothing; every check runs in one place
 * (`findProblems`): Continue judges the step you are on, and Send reviews the
 * whole application in walking order, names every gap, and puts the cursor on
 * the first one (components/fireflyPath/stones.ts). The answers are saved on
 * this device as you go, without references or files
 * (components/fireflyPath/applyDraft.ts).
 *
 * THE FOUNDING REGISTER (Phase A brief): the same night world, quieter.
 * Larger display type, more space, gold rules, the step circles as the only
 * geometry, one firefly cluster on the one primary act, and no game words.
 * Every village word (the ways to get to know us, the compensation shape, the
 * first cycle) is a village setting (shared/foundingApplication.ts).
 *
 * PHONE AND DESKTOP, each at its best. On a phone: one step fills the screen,
 * Back and Continue stay within thumb reach above the tab bar, and a swipe
 * walks between steps. On a desk: the role sits beside the step, every step
 * name shows on the gold rule, Enter moves on, and the arrow keys walk the
 * steps whenever the caret is not in a field.
 *
 * Sending asks the address to confirm; nothing reaches the village until it
 * does (server/routes/openProposals.ts). The sent and confirmed thresholds
 * are components/fireflyPath/Thresholds.tsx.
 *
 * WHAT IS KEPT, said on the form in one line (sheet 19i): an application never
 * confirmed is deleted after 48 hours, and a declined one loses its name and
 * address after 90 days (docs/ARCHITECTURE.md, 3.9).
 */
import { goalsToFirstMoon } from "@/components/openProposal/RoleCardBridge";
import { MembershipAtApplication, type MembershipChoice } from "@/components/openProposal/MembershipAtApplication";
import { AttachmentFields, linksToSend } from "@/components/openProposal/ProposalAttachments";
import type { ProposalLink } from "@shared/proposalAttachments";
import { AskSera, DraftMark } from "@/components/proposalDrafts/AskSera";
import { DRAFT_WORDS, goalsFromDraft, isTextDraft, placeDraftGoals, unconfirmedDrafts, type DraftMarks, type DraftableGoal } from "@shared/seraDrafts";
import { BLANK_GOAL, GOAL_LIMITS } from "@shared/proposalGoals";
import { CARD_LIMITS } from "@shared/openProposalCard";
import { BreathingLoader } from "@/components/natural";
import { AboutYouFacts, ReferencesBlock, EMPTY_ABOUT_YOU, aboutYouBody, aboutYouProblem, type AboutYouValue } from "@/components/openProposal/AboutYou";
import { termOf, type OpenProposalTerm } from "@shared/openProposalTerm";
import { civilDayWords } from "@shared/seasonPlans";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "@/i18n/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { doorBackOf } from "@shared/seatApplyLinks";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EYEBROW, FIELD as LOOK_FIELD, HINT, LABEL, TILE, WORLD } from "@/components/journey/look";
import Layout from "@/components/Layout";
import { Fireflies } from "@/components/journey/nature";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { readStoredJson, removeStored, writeStoredJson } from "@/lib/safeStorage";
import { IKIGAI_KEY, ikigaiFromStored, whyFromIkigai } from "@shared/roleDiscover";
import { OPEN_AIM_MAX, OPEN_ANONYMISE_DAYS, OPEN_CONFIRM_HOURS, OPEN_WHY_MAX, OPEN_WORDS, SELF_KNOWLEDGE_MAX } from "@shared/openProposals";
import { foundingSetupOf, type FoundingSetup } from "@shared/foundingApplication";
import TermsEight, { EMPTY_TERMS_STEP, type TermsStepValue } from "@/components/governance/TermsEight";
import { judgeTermsStep, writtenKeys, type TermsWords } from "@shared/termsWords";
import { Practicalities, SeasonServes, browserTimeZone, type Practical } from "@/components/openProposal/RoleCardBridge";
import { LAST_STONE, STONES, enterWalksOn, onStone, orderByStone, ownsKeys, stoneOfField, swipeStep } from "@/components/fireflyPath/stones";
import { Notice, SentThreshold, prefersStill, type SentNote } from "@/components/fireflyPath/Thresholds";
import { CompensationShape, FirstDayFacts, GOLD_RULE, KnowUsStep, OtherRole, RoleChoice, StepMark, ValueItems } from "@/components/fireflyPath/ApplySteps";
import { draftKey, fromDraft, toDraft } from "@/components/fireflyPath/applyDraft";
/** The link in the confirmation email lives with the other threshold; App.tsx and the tests still find it here. */
export { ConfirmProposal } from "@/components/fireflyPath/Thresholds";

// The sheet's field and main button (docs/DESIGN_RULE.md, components/journey/look.ts).
const FIELD = `${LOOK_FIELD} py-3`;
const BUTTON = `${BTN_PRIMARY} py-3`;
/** Nothing a season goal does not have: the "serves" list a card sends is at most this long (shared/openProposalCard.ts). */
const SERVES_MAX = CARD_LIMITS.serves;

interface FormRole {
  id: string;
  name: string;
  circle: string;
  aim: string | null;
  accountabilities?: string[];
  timeCommitment?: string | null;
  /** The role's suggested wording for the eight settings and the commitment it asks (joining lane PR 3). */
  terms?: { words?: TermsWords; commitmentPct?: number | null };
  conversations?: Array<{ role: string; minutes: number; finalApproval?: boolean }>;
  bookingUrl?: string | null;
  /** A check happens for this role whatever the references say (0370). */
  alwaysChecked?: boolean;
}

type FormState =
  | { kind: "loading" }
  | { kind: "closed"; message: string }
  | { kind: "open"; village: string; season: { id: string; name: string | null; startsOn: string } | null; term: OpenProposalTerm | null; goals: Array<{ id: string; text: string }>; roles: FormRole[]; setup: FoundingSetup }
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
    case "selfKnowledge": return "#propose-self";
    case "card": return "[data-goals-list]";
    case "serves": return "[data-value-serves]";
    case "terms": return "[data-terms-section]";
    case "agreed": return "[data-agreements] input[type=checkbox][required]";
    // The tick itself, where the box is (final verification: the cursor went to the top of the stone).
    case "checkConsent":
    case "references": return "#propose-about-consent";
    case "about":
    case "links":
    case "files": return "[data-about-you-section]";
    case "membership": return "[data-agreements]";
    case "timeZone": return "#card-tz";
    case "earliestStart": return "#card-start";
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
  spot.scrollIntoView?.({ block: "center", behavior: prefersStill() ? "auto" : "smooth" });
  const focusable = spot.matches("input,textarea,select,button,[tabindex]") ? spot : (firstUnanswered(spot) ?? spot.querySelector<HTMLElement>("input,textarea,select,button"));
  const at = focusable ?? spot;
  // A field found inside a section is centred itself, so the cursor is never off screen.
  if (at !== spot) at.scrollIntoView?.({ block: "center", behavior: "auto" });
  at.focus({ preventScroll: true });
}

/**
 * The first field in a section still waiting for an answer, in reading order:
 * a choice group with nothing picked, an empty list, an empty one-line field,
 * or an empty note box marked required. Null when every field holds
 * something, and the first control is used.
 */
export function firstUnanswered(spot: HTMLElement): HTMLElement | null {
  for (const el of Array.from(spot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select"))) {
    if (el.disabled || (el instanceof HTMLInputElement && el.type === "hidden")) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (!spot.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`)) return el;
      continue;
    }
    if (el instanceof HTMLInputElement && el.type === "checkbox") continue;
    // A note box is optional unless it says otherwise; a one-line field or a list is an answer.
    if (el instanceof HTMLTextAreaElement && !el.required) continue;
    if (el.value.trim() === "") return el;
  }
  return null;
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

/** The form's page: the sheet's night ground, wide enough on a desk for the role beside the step. */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Layout>
      <div className={`${WORLD} py-10 sm:py-16`}>
        <div className={`container ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</div>
      </div>
    </Layout>
  );
}

/** The role named by the link: the first one the village still offers, and whether any it named is gone. */
function roleFromLink(wanted: readonly string[], roles: readonly FormRole[]): { id: string | null; gone: boolean } {
  const offered = wanted.filter((id) => roles.some((r) => r.id === id));
  return { id: offered[0] ?? null, gone: wanted.length > 0 && offered.length < wanted.length && offered.length === 0 };
}

/** The address bar follows the role chosen, so a reload or a shared link opens the same application. */
function showRoleInAddress(roleId: string | null) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  q.delete("role");
  if (roleId) q.set("role", roleId);
  const s = q.toString();
  window.history.replaceState?.(window.history.state, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
}

export default function ProposeARole() {
  const params = useParams<{ token?: string }>();
  const link = params.token ? decodeURIComponent(params.token) : "";
  const [form, setForm] = useState<FormState>({ kind: "loading" });
  const [roleId, setRoleId] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [knowUs, setKnowUs] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  const [aim, setAim] = useState("");
  const [items, setItems] = useState<DraftableGoal[]>([{ ...BLANK_GOAL }]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [selfKnowledge, setSelfKnowledge] = useState("");
  const [rampUp, setRampUp] = useState(false);
  const [sending, setSending] = useState(false);
  /** Every problem found on the last press of Continue or Send, each with the field it is on (audit M1). */
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const error = problems[0] ?? null;
  const problemOn = (field: string) => problems.find((p) => p.field === field)?.message ?? null;
  const [sent, setSent] = useState<SentNote | null>(null);
  const [practical, setPractical] = useState<Practical>(() => ({ timeZone: browserTimeZone(), windows: [], earliestStart: "" }));
  /** The eight settings answered and the commitment chosen (components/governance/TermsEight.tsx). */
  const [termsStep, setTermsStep] = useState<TermsStepValue>(EMPTY_TERMS_STEP);
  const [agreed, setAgreed] = useState({ nda: false });
  /** Links to their work and files, for the deciders only (Rye, 10 Nov 2026). Files are never saved in the draft. */
  const [links, setLinks] = useState<ProposalLink[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  /** About you: facts, references and the consent (components/openProposal/AboutYou.tsx). */
  const [about, setAbout] = useState<AboutYouValue>(EMPTY_ABOUT_YOU);
  /** The words Sera drafted, until they are edited or kept (shared/seraDrafts.ts). Never sent. */
  const [marks, setMarks] = useState<DraftMarks>({});
  /** The membership alignment made here (Rye's answer 8). */
  const [membership, setMembership] = useState<MembershipChoice>({ kind: "none" });
  const [letterRead, setLetterRead] = useState(0);
  /** THE STEPS: the one you are on, and the furthest reached. */
  const [stone, setStone] = useState(0);
  const [reached, setReached] = useState(0);
  /** The draft for this role has been read back (or there was none), so saving may begin. */
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  /** What to put the cursor on after the next draw: the step's heading, or a field with a problem. */
  const [aimAt, setAimAt] = useState<{ n: number; target: string | null } | null>(null);
  const touch = useRef<{ x: number; y: number; owned: boolean } | null>(null);
  const me = useOptionalAuth()?.user ?? null;
  const { t } = useLingui();

  useEffect(() => {
    // The role a card's Apply link (or the draft board) named: the first the village still offers.
    const wanted = new URLSearchParams(window.location.search).getAll("role").map((r) => r.trim()).filter(Boolean);
    fetch(`/api/open-proposals/form${link ? `?link=${encodeURIComponent(link)}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const roles: FormRole[] = Array.isArray(d?.roles) ? d.roles : [];
        setForm(
          d?.open
            ? { kind: "open", village: String(d.village ?? ""), season: d.season ?? null, term: termOf(d.term) ?? null, goals: Array.isArray(d.goals) ? d.goals : [], roles, setup: foundingSetupOf(d.founding) }
            : { kind: "closed", message: String(d?.message ?? OPEN_WORDS.closed) },
        );
        if (d?.open) {
          const picked = roleFromLink(wanted, roles);
          setRoleId(picked.id);
          setGone(picked.gone);
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

  // THE SAVED DRAFT, read back once the role is known: the words, the step they were on. Never references or files.
  useEffect(() => {
    if (form.kind !== "open" || !roleId || draftFor === roleId) return;
    const read = readStoredJson("local", draftKey(roleId, link));
    const d = fromDraft(read.status === "value" ? read.value : null, new Date(), LAST_STONE);
    if (d) {
      setKnowUs(d.knowUs.filter((w) => form.setup.knowUs.includes(w)));
      if (d.why) setWhy(d.why);
      if (d.name) setName(d.name);
      if (d.email) setEmail(d.email);
      setAbout((a) => ({ ...a, ...d.about }));
      setSelfKnowledge(d.selfKnowledge);
      setLinks(d.links);
      setAim(d.aim);
      if (d.items.length) setItems(d.items);
      setMarks(d.marks);
      setTermsStep({ answers: d.terms.answers, commitmentPct: d.terms.commitmentPct });
      setRampUp(d.rampUp);
      setPractical((p) => ({ timeZone: d.practical.timeZone || p.timeZone, windows: d.practical.windows, earliestStart: d.practical.earliestStart }));
      setStone(d.step);
      setReached(d.reached);
      setRestored(true);
    }
    setDraftFor(roleId);
  }, [form, roleId, link, draftFor]);

  // THE DRAFT, saved as they go. Only the fields toDraft names: references, consent, files and agreements cannot reach it.
  useEffect(() => {
    if (!roleId || draftFor !== roleId || sent) return;
    writeStoredJson(
      "local",
      draftKey(roleId, link),
      toDraft({ step: stone, reached, knowUs, why, name, email, about: { based: about.based, languages: about.languages, story: about.story }, selfKnowledge, links, aim, items, marks, terms: termsStep, rampUp, practical }, new Date()),
    );
  }, [roleId, draftFor, link, sent, stone, reached, knowUs, why, name, email, about.based, about.languages, about.story, selfKnowledge, links, aim, items, marks, termsStep, rampUp, practical]);

  // After a step: the cursor on the new step's heading, or on the field that needs a look.
  useEffect(() => {
    if (!aimAt) return;
    if (aimAt.target) {
      goToProblem(aimAt.target);
      return;
    }
    const h = document.getElementById(`stone-${stone}-h`);
    document.querySelector<HTMLElement>("[data-open-proposal]")?.scrollIntoView?.({ block: "start", behavior: prefersStill() ? "auto" : "smooth" });
    h?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aimAt]);

  const role = useMemo(() => (form.kind === "open" && roleId ? (form.roles.find((r) => r.id === roleId) ?? null) : null), [form, roleId]);

  const labels = [
    t({ message: "Get to know us", context: "founding application step" }),
    t({ message: "About you", context: "founding application step" }),
    t({ message: "Your value", context: "founding application step" }),
    t({ message: "The terms", context: "founding application step" }),
    t({ message: "Your first day", context: "founding application step" }),
    t({ message: "Review & submit", context: "founding application step" }),
  ] as const;

  /** The value items as the card sends them: blank rows out, the draft flag off. */
  const filledItems = items.filter((g) => g.title.trim() || g.doneWhen.trim() || g.serves);
  /** The season goals the items are tagged to, in order, as the card's "serves" (at most three; each item keeps its own tag). */
  const servesOf = (): Array<{ goalId: string; how: string; roleId: string }> => {
    const ids: string[] = [];
    for (const g of filledItems) if (g.serves && !ids.includes(g.serves)) ids.push(g.serves);
    return ids.slice(0, SERVES_MAX).map((goalId) => ({
      goalId,
      how: filledItems.filter((g) => g.serves === goalId).map((g) => g.title.trim()).filter(Boolean).join("; ").slice(0, CARD_LIMITS.how),
      roleId: roleId as string,
    }));
  };

  /**
   * EVERY CHECK THE FORM MAKES, in one place (audit M1, B1). Continue keeps the
   * ones on its own step; Send keeps all of them. The server judges all of it again.
   */
  const findProblems = (): FormProblem[] => {
    const found: FormProblem[] = [];
    const add = (field: string, message: string, target = targetFor(field)) => found.push({ field, message, target });
    const valueDrafts = unconfirmedDrafts({ aim, story: "", marks, goals: items });
    if (valueDrafts.length > 0) found.push({ field: "drafts:moon", message: DRAFT_WORDS.blocked(valueDrafts), target: null });
    const aboutDrafts = unconfirmedDrafts({ aim: "", story: about.story, marks, goals: [] });
    if (aboutDrafts.length > 0) found.push({ field: "drafts:about", message: DRAFT_WORDS.blocked(aboutDrafts), target: null });
    if (!name.trim()) add("name", OPEN_WORDS.needName);
    if (!email.trim()) add("email", OPEN_WORDS.needEmail);
    if (!why.trim()) add("why", OPEN_WORDS.needWhy);
    const aboutProblem = aboutYouProblem(about, role?.alwaysChecked === true);
    if (aboutProblem) add("checkConsent", aboutProblem);
    if (!aim.trim()) add("aim", OPEN_WORDS.needAim);
    if (!roleId) add("roles", OPEN_WORDS.needRole);
    // Your value: at least one item, each named, each with how we will know it is done, each tagged when the season has goals.
    const prefix = `#value-${roleId ?? ""}`;
    if (filledItems.length === 0) add("card", t({ message: "Add at least one value item.", context: "founding application check" }), `${prefix}-0-title`);
    items.forEach((g, i) => {
      if (!(g.title.trim() || g.doneWhen.trim() || g.serves)) return;
      const n = i + 1;
      if (!g.title.trim()) add("card", t({ message: `Say what value ${n} brings.`, context: "founding application check" }), `${prefix}-${i}-title`);
      else if (!g.doneWhen.trim()) add("card", t({ message: `Say how we will know value ${n} is done.`, context: "founding application check" }), `${prefix}-${i}-done`);
      if (form.kind === "open" && form.goals.length > 0 && !g.serves) add("serves", t({ message: `Choose the season goal value ${n} serves.`, context: "founding application check" }), `${prefix}-${i}-serves`);
    });
    // Every written setting answered and the commitment chosen, in the shared rules' words.
    if (role) {
      const judgedTerms = judgeTermsStep({ answers: termsStep.answers, commitmentPct: termsStep.commitmentPct }, writtenKeys([{ words: role.terms?.words, commitmentPct: role.terms?.commitmentPct ?? null }]));
      if (!judgedTerms.ok) add("terms", judgedTerms.error);
    }
    if (!agreed.nda) add("agreed", t({ message: "Tick that you will align with the village's confidentiality agreement once you are approved.", context: "founding application check" }));
    return orderByStone(found);
  };

  /** Stand on a step. `keep` leaves the problems listed (a jump from the review to a field). */
  const goTo = (i: number, opts: { keep?: boolean; target?: string | null } = {}) => {
    const s = Math.max(0, Math.min(LAST_STONE, i));
    if (!opts.keep) setProblems([]);
    setStone(s);
    setReached((r) => Math.max(r, s));
    setAimAt((a) => ({ n: (a?.n ?? 0) + 1, target: opts.target ?? null }));
  };

  /** A problem's own place: its step, then its field. */
  const show = (p: FormProblem) => goTo(stoneOfField(p.field), { keep: true, target: p.target ?? "#propose-problems" });

  /** Continue: this step is judged on its own, and the application goes on only when it holds. Step 1 never holds anyone. */
  const next = () => {
    if (stone >= LAST_STONE) return;
    const mine = onStone(findProblems(), stone);
    if (mine.length > 0) {
      setProblems(mine);
      setAimAt((a) => ({ n: (a?.n ?? 0) + 1, target: mine[0].target ?? "#propose-problems" }));
      return;
    }
    goTo(stone + 1);
  };
  const back = () => goTo(stone - 1);

  const send = async () => {
    if (sending || !roleId) return;
    // THE FINAL REVIEW: every problem in the whole application at once, in the order it is walked.
    const found = findProblems();
    if (found.length > 0) {
      setProblems(found);
      const here = stoneOfField(found[0].field) === LAST_STONE;
      setAimAt((a) => ({ n: (a?.n ?? 0) + 1, target: here ? (found[0].target ?? "#propose-problems") : "#propose-problems" }));
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
        roles: [{ roleId, note: "" }],
        card: {
          roles: [{ roleId, moves: [], firstMoon: goalsToFirstMoon(filledItems) }],
          timeZone: practical.timeZone.trim(),
          windows: practical.windows,
          earliestStart: practical.earliestStart,
          // The eight settings, each answered, and the commitment chosen: the server judges both again.
          terms: { answers: termsStep.answers },
          commitmentPct: termsStep.commitmentPct ?? undefined,
          serves: servesOf(),
          agreed,
        },
        // Step 1's ticks, the ramp-up, and Human Design or Gene Keys (never served to the people who decide).
        knowUs,
        ...(rampUp ? { rampUp: true } : {}),
        ...(selfKnowledge.trim() ? { selfKnowledge: selfKnowledge.trim() } : {}),
        // The site language they are reading this in: their emails and status page follow it (shared/applicantLanguage.ts).
        locale: i18n.locale,
        ...(membership.kind === "aligned" ? { membership: { letterVersion: membership.letterVersion } } : {}),
        ...(linksToSend(links).length ? { links: linksToSend(links) } : {}),
        ...aboutYouBody(about),
      };
      // With files, the application goes as one field of a multipart post (server/routes/openProposals.ts).
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
        // A refusal (a rate limit's words among them) lands on its field's step; one with no field stays on Review & submit.
        const field = typeof data?.field === "string" ? data.field : null;
        const p = { field, message: typeof data?.error === "string" ? data.error : OPEN_WORDS.notSent, target: targetFor(field) };
        setProblems([p]);
        show(p);
        return;
      }
      // Sent: the draft has done its work.
      removeStored("local", draftKey(roleId, link));
      const sentTo = email.trim();
      setSent({
        message: t({ message: `Check ${sentTo}. We sent a link to confirm it's you. Your application reaches us once you open it.`, context: "founding application sent" }),
        to: sentTo,
        at: new Date(),
        replyDays: typeof data?.replyDays === "number" ? data.replyDays : null,
      });
      window.scrollTo?.({ top: 0 });
    } catch {
      setProblems([{ field: null, message: OPEN_WORDS.notSent, target: null }]);
    } finally {
      setSending(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stone < LAST_STONE) next();
    else void send();
  };

  // A desk's keys: Ctrl or Cmd with Enter moves on even from a long answer; the arrows walk the steps whenever the caret is not in a field.
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (stone < LAST_STONE) next();
      else void send();
      return;
    }
    // Enter in a one-line field walks on: before Send the form has no submit button, so the page says it itself.
    if (e.key === "Enter" && stone < LAST_STONE && enterWalksOn(e.target)) {
      e.preventDefault();
      next();
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || ownsKeys(e.target)) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft" && stone > 0) {
      e.preventDefault();
      back();
    }
  };

  // A phone's swipe: the finger moving left walks on, right walks back. A swipe that starts in a field is the field's.
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY, owned: ownsKeys(e.target) } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const p = e.changedTouches[0];
    if (!start || !p || start.owned) return;
    const step = swipeStep(p.clientX - start.x, p.clientY - start.y);
    if (step === 1) next();
    else if (step === -1 && stone > 0) back();
  };

  if (form.kind === "loading") {
    return (
      <Shell>
        <BreathingLoader label={t({ message: "Opening the application", context: "founding application" })} showLabel />
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
    return <SentThreshold sent={sent} roles={role ? [role] : []} onFixAddress={() => { setSent(null); goTo(stoneOfField("email"), { target: "#propose-email" }); }} />;
  }

  // Only when a door sent the visitor here with `from`; a shared link stands on its own.
  const cameFrom = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") ? doorBackOf(window.location.search, "", window.location.origin) : null;
  const backDoor = cameFrom && (
    <Link
      href={cameFrom.href}
      className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      data-door-back=""
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {cameFrom.card ? t`Back to the role` : cameFrom.circle ? t`Back to the circle` : t`Back to the roles`}
    </Link>
  );
  const setup = form.setup;
  const choose = (id: string | null) => {
    setRoleId(id);
    setGone(false);
    setProblems([]);
    setStone(0);
    setReached(0);
    setRestored(false);
    showRoleInAddress(id);
  };

  // NO ROLE NAMED: the open roles, one door each. One application is for one role.
  if (!role) {
    return (
      <Shell>
        {backDoor}
        <p className={EYEBROW}>{form.village}</p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-foreground sm:text-5xl">{t({ message: "Join the founding team", context: "founding application choose" })}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {form.season
            ? t({ message: "Choose the role you are applying for. Each application is for one role.", context: "founding application choose" })
            : t`The village hasn't set its next season yet, so there's nothing to propose for right now. Check back soon.`}
        </p>
        {gone && (
          <p role="status" className={`mt-6 ${TILE} text-sm text-foreground`} data-role-gone="">
            {t({ message: "The role in your link is not open any more. These are open now.", context: "founding application choose" })}
          </p>
        )}
        {form.season && (
          <div className={`mt-8 ${GOLD_RULE} pt-8`}>
            <RoleChoice roles={form.roles} onPick={(id) => choose(id)} />
          </div>
        )}
      </Shell>
    );
  }

  const invalid = (field: string) => (problems.some((p) => p.field === field) ? { "aria-invalid": true, "aria-describedby": `propose-problem-${field}` } : {});
  const intro = [
    t({ message: "Before you apply, come and meet us. Tick what you have done so far.", context: "founding application intro" }),
    t({ message: "Who you are, and why this role, now. A few honest lines is enough: the people who decide read every word.", context: "founding application intro" }),
    t({ message: "The value you would bring in your first months, item by item, each tagged to the seasonal goal it serves.", context: "founding application intro" }),
    t({ message: "A starting point we agree together. Choose your commitment, and mark anything you would like to talk through.", context: "founding application intro" }),
    t({ message: "What your first month with us would look like, and when you could begin.", context: "founding application intro" }),
    t({ message: "Read it through once, then send. Nothing reaches us until you confirm your email.", context: "founding application intro" }),
  ];
  const starters = [
    t({ message: "What I have built before:", context: "founding application why starter" }),
    t({ message: "Why this role:", context: "founding application why starter" }),
    t({ message: "Why now:", context: "founding application why starter" }),
    t({ message: "What I would bring in my first month:", context: "founding application why starter" }),
  ];
  const startWith = (phrase: string) => {
    const next = why.trim() ? `${why.trimEnd()}\n\n${phrase} ` : `${phrase} `;
    setWhy(next.slice(0, OPEN_WHY_MAX));
    window.setTimeout(() => {
      const box = document.getElementById("propose-why") as HTMLTextAreaElement | null;
      box?.focus();
      box?.setSelectionRange?.(box.value.length, box.value.length);
    }, 0);
  };
  const askRoles = [{ roleId: role.id, note: "" }];
  const commitment = termsStep.commitmentPct;
  const stepNumber = stone + 1;
  const stepCount = STONES.length;
  const nextName = labels[Math.min(stone + 1, LAST_STONE)];
  const ticked = knowUs.length;
  const ways = setup.knowUs.length;
  const valueCount = filledItems.length;
  const missingTag = form.goals.length > 0 ? items.map((g, i) => (g.title.trim() && !g.serves ? i + 1 : 0)).filter(Boolean) : [];
  const short = (s: string) => (s.trim().length > 90 ? `${s.trim().slice(0, 90)}…` : s.trim());
  const notYet = t({ message: "Not written yet", context: "founding application review" });
  const startDay = practical.earliestStart;
  /** Review & submit: each step in a line, with a way back to it. */
  const review: Array<[number, string]> = [
    [0, ways === 0 ? t({ message: "Nothing to tick", context: "founding application review" }) : t({ message: `${ticked} of ${ways} done`, context: "founding application review" })],
    [1, why.trim() ? `${name.trim() || notYet} · ${short(why)}` : notYet],
    [2, valueCount === 1 ? t({ message: `1 value item. Aim: ${short(aim) || notYet}`, context: "founding application review" }) : t({ message: `${valueCount} value items. Aim: ${short(aim) || notYet}`, context: "founding application review" })],
    [
      3,
      commitment == null
        ? t({ message: "Commitment not chosen yet", context: "founding application review" })
        : rampUp
          ? t({ message: `Commitment: ${commitment}%, with a ramp-up`, context: "founding application review" })
          : t({ message: `Commitment: ${commitment}%`, context: "founding application review" }),
    ],
    [4, startDay ? t({ message: `Earliest start: ${startDay}`, context: "founding application review" }) : t({ message: "No start date given", context: "founding application review" })],
  ];

  const panel = (i: number) => ({
    hidden: stone !== i,
    "data-stone": STONES[i],
    "aria-labelledby": `stone-${i}-h`,
    className: "grid gap-8",
  });
  const heading = (i: number) => (
    <div className="grid gap-3">
      <h2 id={`stone-${i}-h`} tabIndex={-1} className="font-display text-3xl leading-tight text-card-foreground outline-none sm:text-4xl">
        <span className={`block ${EYEBROW}`}>{t({ message: `Step ${stepNumber} of ${stepCount}`, context: "founding application steps" })}</span>
        <span className="sr-only"> · </span>
        {labels[i]}
      </h2>
      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{intro[i]}</p>
    </div>
  );
  const pct = role.terms?.commitmentPct;
  const termFrom = form.term ? civilDayWords(form.term.startsOn) : "";
  const termTo = form.term ? civilDayWords(form.term.endsOn) : "";
  const roleBeside = (
    <div className={`${CARD} grid gap-3`} data-role-beside="">
      <p className={EYEBROW}>{role.circle}</p>
      <p className="font-display text-2xl leading-tight text-card-foreground">{role.name}</p>
      {role.aim && <p className="text-sm leading-relaxed text-muted-foreground">{role.aim}</p>}
      {typeof pct === "number" && <p className={`${GOLD_RULE} pt-3 text-sm text-foreground`}>{t({ message: `The role asks ${pct}% of your commitment`, context: "founding application beside" })}</p>}
      {role.alwaysChecked && <p className="text-sm text-foreground">{t({ message: "A background check happens for this role whatever the references say.", context: "open proposal role" })}</p>}
      <p className="hidden text-xs text-muted-foreground [@media(hover:hover)]:block">{t({ message: "Enter moves on. When the cursor is not in a field, the arrow keys walk between steps.", context: "founding application keys" })}</p>
    </div>
  );

  return (
    <Shell wide>
      <header className="mb-8 max-w-3xl">
        {backDoor}
        <p className={EYEBROW}>{role.circle}</p>
        <h1 className="mt-2 break-words font-display text-4xl leading-tight text-foreground sm:text-5xl">{t({ message: `Apply: ${role.name}`, context: "founding application title" })}</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {me
            ? t({ message: "Six steps. Your name and email come from your account, and your answers are saved on this device as you go.", context: "founding application lede" })
            : t({ message: "Six steps, and no account needed. Your answers are saved on this device as you go.", context: "founding application lede" })}
        </p>
        {/* A village whose applications are for one lunar cycle names its days (Rye, 9 Nov 2026), in plain words. */}
        {form.term && (
          <p className="mt-1 text-sm text-muted-foreground" data-term-days="">
            {t({ message: `This application is for the cycle from ${termFrom} to ${termTo}.`, context: "founding application lede" })}
          </p>
        )}
        {restored && (
          <p className="mt-2 text-sm text-foreground" data-draft-restored="">
            {t({ message: "We kept your answers from last time. References and files are never saved, so add them again.", context: "founding application draft" })}
          </p>
        )}
        {form.roles.length > 1 && <OtherRole onChoose={() => choose(null)} />}
      </header>

      {!form.season ? (
        <p className="text-muted-foreground">{t`The village hasn't set its next season yet, so there's nothing to propose for right now. Check back soon.`}</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <form
            onSubmit={submit}
            onKeyDown={onKeys}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            noValidate
            className="relative min-w-0 scroll-mt-28 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-10"
            data-open-proposal=""
            data-hides-fab=""
            data-stone-now={STONES[stone]}
          >
            <div className={`mb-8 border-b border-notice/40 pb-6`}>
              <StepMark labels={labels} now={stone} reached={reached} onGo={(i) => goTo(i)} />
            </div>

            {problems.length > 0 && (
              <div id="propose-problems" tabIndex={-1} role="alert" className="mb-8 rounded-lg border border-border bg-muted p-4 text-sm text-foreground outline-none" data-problems="">
                <p className="font-semibold">
                  {stone === LAST_STONE
                    ? problems.length === 1
                      ? t`One thing to fix before we can send this:`
                      : t`${problems.length} things to fix before we can send this:`
                    : problems.length === 1
                      ? t({ message: "One thing to look at before you continue:", context: "founding application check" })
                      : t({ message: `${problems.length} things to look at before you continue:`, context: "founding application check" })}
                </p>
                <ul className="mt-2 grid gap-1">
                  {problems.map((p, i) => {
                    const where = labels[stoneOfField(p.field)];
                    return (
                      <li key={`${p.field}-${i}`}>
                        <button type="button" onClick={() => show(p)} className="min-h-11 text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
                          {stoneOfField(p.field) !== stone ? `${where}: ${p.message}` : p.message}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* STEP 1: get to know us. Never locks. */}
            <section {...panel(0)}>
              {heading(0)}
              <KnowUsStep ways={setup.knowUs} note={setup.knowUsNote} ticked={knowUs} onChange={setKnowUs} />
            </section>

            {/* STEP 2: about you. Who you are, why you and why now, your work, references, and Human Design or Gene Keys. */}
            <section {...panel(1)}>
              {heading(1)}
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="propose-name" className={`mb-2 block ${LABEL}`}>
                    {t({ message: "Your name", context: "open proposal field" })}
                  </label>
                  <input id="propose-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={FIELD} {...invalid("name")} />
                  <Beside id="propose-problem-name" message={problemOn("name")} />
                </div>
                <div>
                  <label htmlFor="propose-email" className={`mb-2 block ${LABEL}`}>
                    {t({ message: "Your email", context: "open proposal field" })}
                  </label>
                  <input id="propose-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} {...invalid("email")} />
                  <Beside id="propose-problem-email" message={problemOn("email")} />
                </div>
              </div>
              <p className={`-mt-4 ${HINT}`}>{t({ message: "We'll only write to you about this application.", context: "founding application" })}</p>
              <div className="grid gap-3">
                <label htmlFor="propose-why" className={LABEL}>
                  {t`Why you, and why now`}
                </label>
                <div className="flex flex-wrap gap-2" data-starters="">
                  {starters.map((s) => (
                    <button key={s} type="button" onClick={() => startWith(s)} className="jw-btn inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm text-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {s}
                    </button>
                  ))}
                </div>
                <textarea id="propose-why" required rows={7} maxLength={OPEN_WHY_MAX} value={why} onChange={(e) => setWhy(e.target.value)} className={FIELD} {...invalid("why")} />
                <Beside id="propose-problem-why" message={problemOn("why")} />
              </div>
              <div className="grid scroll-mt-24 gap-6" data-about-you-section="">
                <AboutYouFacts
                  value={about}
                  onChange={setAbout}
                  idPrefix="propose-about"
                  storyAssist={
                    <>
                      {(!about.story.trim() || isTextDraft(about.story, marks.story)) && <AskSera founding kind="story" roles={askRoles} why={why} aim={aim} onDraft={(r) => { if (r.story) { setAbout((a) => ({ ...a, story: r.story! })); setMarks((m) => ({ ...m, story: r.story })); } }} />}
                      {isTextDraft(about.story, marks.story) && <DraftMark founding onKeep={() => setMarks((m) => ({ ...m, story: undefined }))} />}
                    </>
                  }
                />
                <div>
                  <label htmlFor="propose-self" className={`mb-2 block ${LABEL}`}>
                    {t({ message: "Your Human Design or Gene Keys (optional)", context: "founding application about" })}
                  </label>
                  <input id="propose-self" maxLength={SELF_KNOWLEDGE_MAX} value={selfKnowledge} onChange={(e) => setSelfKnowledge(e.target.value)} className={FIELD} {...invalid("selfKnowledge")} />
                  <p className={`mt-2 ${HINT}`}>{t({ message: "For your own profile once you join. The people who decide never see it.", context: "founding application about" })}</p>
                  <Beside id="propose-problem-selfKnowledge" message={problemOn("selfKnowledge")} />
                </div>
                <AttachmentFields
                  links={links}
                  onLinks={setLinks}
                  files={files}
                  onFiles={setFiles}
                  invalid={error && (error.field === "links" || error.field === "files") ? { field: error.field, message: error.message } : null}
                />
                <ReferencesBlock value={about} onChange={setAbout} idPrefix="propose-about" alwaysChecked={role.alwaysChecked === true} invalid={problems.some((p) => p.field === "checkConsent" || p.field === "references")} />
              </div>
            </section>

            {/* STEP 3: your value. The aim in a line, then the items, each tagged to a season goal. */}
            <section {...panel(2)}>
              {heading(2)}
              <div>
                <label htmlFor="propose-aim" className={`mb-2 block ${LABEL}`}>
                  {t({ message: "Your aim in this role, in a line", context: "founding application value" })}
                </label>
                <input id="propose-aim" required maxLength={OPEN_AIM_MAX} value={aim} onChange={(e) => setAim(e.target.value)} className={FIELD} {...invalid("aim")} />
                <Beside id="propose-problem-aim" message={problemOn("aim")} />
                <div className="mt-2 grid gap-2">
                  {(!aim.trim() || isTextDraft(aim, marks.aim)) && <AskSera founding kind="aim" roles={askRoles} why={why} aim={aim} onDraft={(r) => { if (r.aim) { setAim(r.aim.slice(0, OPEN_AIM_MAX)); setMarks((m) => ({ ...m, aim: r.aim!.slice(0, OPEN_AIM_MAX) })); } }} />}
                  {isTextDraft(aim, marks.aim) && <DraftMark founding onKeep={() => setMarks((m) => ({ ...m, aim: undefined }))} />}
                </div>
              </div>
              <ValueItems
                roleId={role.id}
                items={items}
                onChange={setItems}
                goals={form.goals}
                missingTag={problems.some((p) => p.field === "serves") ? missingTag : []}
                assist={
                  <AskSera
                    founding
                    kind="goals"
                    roles={askRoles}
                    why={why}
                    aim={aim}
                    onDraft={(reply) => setItems((now) => placeDraftGoals(now, goalsFromDraft((reply.goals ?? []).filter((g) => g.roleId === role.id)).map((g) => ({ ...g, moves: "" })), GOAL_LIMITS.max))}
                  />
                }
              />
              <Beside id="propose-problem-card" message={problemOn("card") ?? problemOn("serves")} />
            </section>

            {/* STEP 4: the terms. Commitment and the eight settings, the ramp-up, and the shape of compensation. */}
            <section {...panel(3)}>
              {heading(3)}
              <section aria-label={labels[3]} tabIndex={-1} className="grid scroll-mt-24 gap-4 outline-none" data-terms-section="">
                <TermsEight
                  roles={[{ id: role.id, name: role.name, words: role.terms?.words, commitmentPct: role.terms?.commitmentPct ?? null }]}
                  value={termsStep}
                  onChange={setTermsStep}
                  problem={problemOn("terms")}
                  idPrefix="propose-terms"
                />
              </section>
              <label htmlFor="propose-ramp" className={`${TILE} flex min-h-11 cursor-pointer items-start gap-3`} data-ramp-up="">
                <input id="propose-ramp" type="checkbox" className="mt-0.5 size-5 shrink-0 accent-notice" checked={rampUp} onChange={(e) => setRampUp(e.target.checked)} />
                <span className="grid gap-1">
                  <span className="font-semibold text-foreground">{t({ message: "I would like a ramp-up", context: "founding application terms" })}</span>
                  <span className={HINT}>{t({ message: "Partial pay while you build to your full commitment. We agree the steps together.", context: "founding application terms" })}</span>
                </span>
              </label>
              <CompensationShape setup={setup} />
            </section>

            {/* STEP 5: your first day. The first cycle, the first conversations, and when you could begin. */}
            <section {...panel(4)}>
              {heading(4)}
              <FirstDayFacts setup={setup} />
              <div className={`${GOLD_RULE} pt-6`}>
                <Practicalities value={practical} onChange={setPractical} />
              </div>
            </section>

            {/* STEP 6: review & submit. Everything read back, the agreements, then send. */}
            <section {...panel(5)}>
              {heading(5)}
              <ul className="grid gap-2" data-review="">
                {review.map(([i, line]) => (
                  <li key={i} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3">
                    <span className="grid min-w-0">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">{labels[i]}</span>
                      <span className="break-words text-sm text-foreground">{line}</span>
                    </span>
                    <button type="button" onClick={() => goTo(i)} className="min-h-11 shrink-0 px-2 text-sm font-medium text-notice underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      {t({ message: "Change", context: "open proposal review" })}
                    </button>
                  </li>
                ))}
              </ul>
              <div data-agreements="" className="scroll-mt-24">
                <SeasonServes goals={form.goals} serves={{}} onServes={() => {}} showGoals={false} agreed={agreed} onAgreed={setAgreed} membership={<MembershipAtApplication signedIn={!!me} choice={membership} onChoice={setMembership} refreshKey={letterRead} />} />
                <Beside id="propose-problem-agreed" message={problemOn("agreed") ?? problemOn("membership")} />
              </div>
              <div className="grid gap-1 text-sm text-muted-foreground">
                <p data-after-approval="">{t({ message: "We will write to this address with every reply. If we invite you to join, you will get an email with a button to create your profile.", context: "founding application review" })}</p>
                <p data-kept-for="">{t({ message: `If you don't confirm within ${OPEN_CONFIRM_HOURS} hours, we delete what you sent. If we say no, or say yes and you never make your account, we remove your name and email ${OPEN_ANONYMISE_DAYS} days later.`, context: "founding application review" })}</p>
                {/* The same words as OPEN_AI_DRAFTS, which the confirmation email carries (Rye, 9 Nov 2026). */}
                <p data-ai-drafts="">{t`An AI may help draft our replies to you; a person always reads and sends them, and no AI takes part in choosing.`}</p>
              </div>
            </section>

            {/* The honeypot. Named `hp` so no autofill heuristic fills it; see ReserveHome.tsx. */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
              <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </div>

            {/*
              THE ONE PRIMARY ACT, within thumb reach. On a phone the bar rides just
              above the tab bar (--tabbar-h, index.css); on a desk that band is 0 and
              it rests at the card's foot. One firefly cluster gathers on it.
            */}
            <div className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-20 -mx-5 mt-10 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:-mx-10 sm:px-8" data-stone-bar="">
              <button type="button" onClick={back} disabled={stone === 0} className={`${BTN_SECONDARY} disabled:invisible`} data-stone-back="">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {/* On a phone the arrow says it, so Continue has the width; a screen reader still hears "Back". */}
                <span className="max-sm:sr-only">{t({ message: "Back", context: "open proposal stones" })}</span>
              </button>
              {stone < LAST_STONE ? (
                <Fireflies key={`next-${stone}`} className="min-w-0 flex-1 justify-end sm:flex-none">
                  <button type="button" onClick={next} className={`${BUTTON} w-full sm:w-auto`} data-stone-next="">
                    <span className="min-w-0 break-words">{t({ message: `Continue to ${nextName}`, context: "founding application steps" })}</span>
                    <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
                  </button>
                </Fireflies>
              ) : (
                <Fireflies key="send" className="min-w-0 flex-1 justify-end sm:flex-none">
                  <button type="submit" disabled={sending} className={`${BUTTON} w-full sm:w-auto`}>
                    {sending ? t({ message: "Sending...", context: "open proposal send" }) : t({ message: "Send my application", context: "founding application send" })}
                    {!sending && <ArrowRight className="size-5" aria-hidden="true" />}
                  </button>
                </Fireflies>
              )}
            </div>
          </form>

          {/* A desk has the width: the role stays beside the step. */}
          <aside className="hidden lg:sticky lg:top-24 lg:grid lg:gap-4">{roleBeside}</aside>
        </div>
      )}
    </Shell>
  );
}
