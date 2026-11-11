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
 * THE FIREFLY PATH (game feel wave 2, lane 1 option B, 11 Nov 2026). The form
 * is six mossy stones on the journey kit's Trail, one question on each: your
 * role, your moon, why you, your energy, about you, send. Each stone has a
 * companion line, and "Why you" offers starter phrases. Fireflies gather on
 * the one next act. Every stone stays drawn (only the one you stand on shows),
 * so nothing typed is lost when you walk back, and every check the form ever
 * made still runs in one place (`findProblems`): Next judges the stone you
 * stand on, and Send reviews the whole path, in the order it is walked
 * (components/fireflyPath/stones.ts).
 *
 * PHONE AND DESKTOP, each at its best. On a phone: one stone fills the screen,
 * Back and Next stay within thumb reach above the tab bar, and a swipe walks
 * between stones. On a desk: the role card you are proposing for sits beside
 * the stone, Enter moves on, and the arrow keys walk the stones whenever the
 * caret is not in a field.
 *
 * Sending asks the address to confirm; nothing reaches the village until it
 * does (server/routes/openProposals.ts). The words are shared/openProposals.ts.
 * The "sent" and "confirmed" pages are thresholds: two circles that touch, and
 * then meet (the nature kit's Vesica), with dated next steps and doors to walk
 * while you wait.
 *
 * WHAT IS KEPT, said on the form in one line (sheet 19i): a proposal never
 * confirmed is deleted after 48 hours, and a declined one loses its name and
 * address after 90 days (docs/ARCHITECTURE.md, 3.9).
 */
import CastStrip from "@/components/roleDraft/CastStrip";
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
import { ArrowLeft, ArrowRight } from "lucide-react";
import { doorBackOf } from "@shared/seatApplyLinks";
import Trail from "@/components/journey/Trail";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EYEBROW, FIELD as LOOK_FIELD, HINT, WORLD } from "@/components/journey/look";
import Layout from "@/components/Layout";
import { Fireflies, SeedOfLife } from "@/components/journey/nature";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { readStoredJson } from "@/lib/safeStorage";
import { IKIGAI_KEY, ikigaiFromStored, whyFromIkigai } from "@shared/roleDiscover";
import { OPEN_AIM_MAX, OPEN_ANONYMISE_DAYS, OPEN_CONFIRM_HOURS, OPEN_NOTE_MAX, OPEN_PROPOSAL_MAX_ROLES, OPEN_WHY_MAX, OPEN_WORDS } from "@shared/openProposals";
// Form v2's pieces, on their own line so the membership lane's edit to the line above them merges clean.
import TermsEight, { EMPTY_TERMS_STEP, type TermsStepValue } from "@/components/governance/TermsEight";
import { judgeTermsStep, writtenKeys, type TermsWords } from "@shared/termsWords";
import { Practicalities, browserTimeZone, type Practical } from "@/components/openProposal/RoleCardBridge";
import { LAST_STONE, STONES, onStone, orderByStone, ownsKeys, stoneOfField, swipeStep } from "@/components/fireflyPath/stones";
import { Notice, SentThreshold, prefersStill, type SentNote } from "@/components/fireflyPath/Thresholds";
/** The link in the confirmation email lives with the other threshold; App.tsx and the tests still find it here. */
export { ConfirmProposal } from "@/components/fireflyPath/Thresholds";
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
  spot.scrollIntoView?.({ block: "center", behavior: prefersStill() ? "auto" : "smooth" });
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

/** The form's page: the sheet's night ground, wide enough on a desk for the role card beside the stone. */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Layout>
      <div className={`${WORLD} py-10 sm:py-14`}>
        <div className={`container ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</div>
      </div>
    </Layout>
  );
}

/** The companion: one quiet line per stone, beside a Seed of Life that closes a circle for each stone walked. */
function Companion({ walked, now, children, labels }: { walked: number; now: number; children: React.ReactNode; labels: readonly string[] }) {
  const { t } = useLingui();
  const stoneNumber = now + 1;
  const stoneCount = STONES.length;
  return (
    <div className="flex items-start gap-3" data-companion="">
      <SeedOfLife size="sm" total={STONES.length} walked={walked} current={now} labels={labels} label={t({ message: `Stone ${stoneNumber} of ${stoneCount}`, context: "open proposal stones" })} />
      <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm leading-relaxed text-foreground">{children}</p>
    </div>
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
  /** Every problem found on the last press of Next or Send, each with the field it is on (audit M1). */
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const error = problems[0] ?? null;
  const problemOn = (field: string) => problems.find((p) => p.field === field)?.message ?? null;
  const [sent, setSent] = useState<SentNote | null>(null);
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
  /** THE PATH: the stone you stand on, the furthest one reached, and the ones stood on. */
  const [stone, setStone] = useState(0);
  const [reached, setReached] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  /** What to put the cursor on after the next draw: the stone's heading, or a field with a problem. */
  const [aimAt, setAimAt] = useState<{ n: number; target: string | null } | null>(null);
  const touch = useRef<{ x: number; y: number; owned: boolean } | null>(null);
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

  // After a step along the path: the cursor on the new stone's heading, or on the field that needs a look.
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

  const circles = useMemo(() => {
    const by = new Map<string, FormRole[]>();
    if (form.kind === "open") for (const r of form.roles) by.set(r.circle, [...(by.get(r.circle) ?? []), r]);
    return Array.from(by.entries());
  }, [form]);

  const count = Object.keys(picked).length;
  const chosenRoles = form.kind === "open" ? form.roles.filter((r) => r.id in picked) : [];
  /** The roles picked and the candidate's note on each: the only role words a draft is asked from. */
  const askRoles = Object.entries(picked).map(([roleId, note]) => ({ roleId, note }));
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = { ...p };
      if (id in next) delete next[id];
      else if (Object.keys(next).length < OPEN_PROPOSAL_MAX_ROLES) next[id] = "";
      return next;
    });

  /**
   * EVERY CHECK THE FORM MAKES, in one place (audit M1, B1). Next keeps the
   * ones on its own stone; Send keeps all of them. The server judges all of it again.
   */
  const findProblems = (): FormProblem[] => {
    const found: FormProblem[] = [];
    const add = (field: string, message: string, target = targetFor(field)) => found.push({ field, message, target });
    const goals = Object.keys(picked).flatMap((id) => (cards[id] ?? EMPTY_ROLE_CARD).goals);
    // A draft from Sera is named on the stone it sits on: the aim and goals on your moon, the story line on about you.
    const moonDrafts = unconfirmedDrafts({ aim, story: "", marks, goals });
    if (moonDrafts.length > 0) found.push({ field: "drafts:moon", message: DRAFT_WORDS.blocked(moonDrafts), target: null });
    const aboutDrafts = unconfirmedDrafts({ aim: "", story: about.story, marks, goals: [] });
    if (aboutDrafts.length > 0) found.push({ field: "drafts:about", message: DRAFT_WORDS.blocked(aboutDrafts), target: null });
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
    return orderByStone(found);
  };

  /** Stand on a stone. `keep` leaves the problems listed (a jump from the review to a field). */
  const goTo = (i: number, opts: { keep?: boolean; target?: string | null } = {}) => {
    const s = Math.max(0, Math.min(LAST_STONE, i));
    if (!opts.keep) setProblems([]);
    setStone(s);
    setReached((r) => Math.max(r, s));
    setVisited((v) => (v.has(s) ? v : new Set(Array.from(v).concat(s))));
    setAimAt((a) => ({ n: (a?.n ?? 0) + 1, target: opts.target ?? null }));
  };

  /** A problem's own place: its stone, then its field. */
  const show = (p: FormProblem) => goTo(stoneOfField(p.field), { keep: true, target: p.target ?? "#propose-problems" });

  /** Next: this stone is judged on its own, and the path goes on only when it holds. */
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
    if (sending) return;
    // THE FINAL REVIEW: every problem on the whole path at once, in the order it is walked.
    const found = findProblems();
    if (found.length > 0) {
      setProblems(found);
      // A gap on this stone gets the cursor; one further back is listed, each with a way to it.
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
        // A refusal (a rate limit's words among them) lands on its field's stone; one with no field stays here on Send.
        const field = typeof data?.field === "string" ? data.field : null;
        const p = { field, message: typeof data?.error === "string" ? data.error : OPEN_WORDS.notSent, target: targetFor(field) };
        setProblems([p]);
        show(p);
        return;
      }
      setSent({
        message: typeof data?.message === "string" ? data.message : OPEN_WORDS.sent(email.trim()),
        to: email.trim(),
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
    // Enter in a field walks on; on the last stone it sends.
    if (stone < LAST_STONE) next();
    else void send();
  };

  // A desk's keys: Ctrl or Cmd with Enter moves on even from a long answer; the arrows walk the stones whenever the caret is not in a field.
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (stone < LAST_STONE) next();
      else void send();
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
    return <SentThreshold sent={sent} roles={chosenRoles} onFixAddress={() => { setSent(null); goTo(LAST_STONE, { target: "#propose-email" }); }} />;
  }

  const seasonName = form.season?.name || t({ message: "next season", context: "open proposal season" });
  const village = form.village;
  const moonFrom = form.term ? civilDayWords(form.term.startsOn) : "";
  const moonTo = form.term ? civilDayWords(form.term.endsOn) : "";
  // Only when a door sent the visitor here with `from`; a shared link stands on its own.
  const cameFrom = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") ? doorBackOf(window.location.search, "", window.location.origin) : null;
  const invalid = (field: string) => (problems.some((p) => p.field === field) ? { "aria-invalid": true, "aria-describedby": `propose-problem-${field}` } : {});

  const labels = [
    t({ message: "Your role", context: "open proposal stone" }),
    t({ message: "Your moon", context: "open proposal stone" }),
    t({ message: "Why you", context: "open proposal stone" }),
    t({ message: "Your energy", context: "open proposal stone" }),
    t({ message: "About you", context: "open proposal stone" }),
    t({ message: "Send", context: "open proposal stone" }),
  ] as const;
  const companion = [
    t({ message: "Start with the role that calls you. Pick up to three, and tell us what you bring to each if you like.", context: "open proposal companion" }),
    t({ message: "Now your first moon in it: a few goals you would like to reach, and your aim for the season.", context: "open proposal companion" }),
    t({ message: "Tell us in a few lines why you, and why now. You can start with one of these.", context: "open proposal companion" }),
    t({ message: "None of this is final. Choose your commitment, and mark what you would like to talk through. We agree it together.", context: "open proposal companion" }),
    t({ message: "A little about you, so the people who decide can meet you. Links, files and references are all optional.", context: "open proposal companion" }),
    t({ message: "Read it through once, then send. Nothing reaches the village until you confirm your email.", context: "open proposal companion" }),
  ];
  const starters = [
    t({ message: "What I have tended before:", context: "open proposal why starter" }),
    t({ message: "What brought me here:", context: "open proposal why starter" }),
    t({ message: "What I want to learn:", context: "open proposal why starter" }),
    t({ message: "What I would bring in my first moon:", context: "open proposal why starter" }),
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
  const nextName = labels[Math.min(stone + 1, LAST_STONE)];
  const pickedNames = chosenRoles.map((r) => r.name).join(", ");
  const commitment = termsStep.commitmentPct;
  const refsGiven = about.references.filter((r) => r.name.trim()).length;
  const goalCount = Object.keys(picked).reduce((n, id) => n + (cards[id] ?? EMPTY_ROLE_CARD).goals.filter((g) => g.title.trim()).length, 0);
  /** The review on the Send stone: each stone in a line, with a way back to it. */
  const review: Array<[number, string]> = [
    [0, pickedNames || t({ message: "No role picked yet", context: "open proposal review" })],
    [1, goalCount === 1 ? t({ message: "1 goal for your first moon", context: "open proposal review" }) : t({ message: `${goalCount} goals for your first moon`, context: "open proposal review" })],
    [2, why.trim() ? (why.trim().length > 90 ? `${why.trim().slice(0, 90)}…` : why.trim()) : t({ message: "Not written yet", context: "open proposal review" })],
    [3, commitment == null ? t({ message: "Commitment not chosen yet", context: "open proposal review" }) : t({ message: `Commitment: ${commitment}%`, context: "open proposal review" })],
    [4, refsGiven === 1 ? t({ message: "1 reference", context: "open proposal review" }) : refsGiven > 1 ? t({ message: `${refsGiven} references`, context: "open proposal review" }) : t({ message: "No references, so a background check instead", context: "open proposal review" })],
  ];

  /** The role card you are proposing for, beside the stone on a desk. */
  const roleCard = (
    <div className={`${CARD} grid gap-4`} data-role-beside="">
      <p className={EYEBROW}>{t({ message: "Your role card", context: "open proposal beside" })}</p>
      {chosenRoles.length === 0 ? (
        <p className={HINT}>{t`Pick a role on the first stone and its card shows here while you walk.`}</p>
      ) : (
        chosenRoles.map((r) => {
          const pct = r.terms?.commitmentPct;
          return (
            <div key={r.id} className="grid gap-1 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{r.circle}</p>
              <p className="font-display text-xl leading-tight text-card-foreground">{r.name}</p>
              {r.aim && <p className="text-sm text-muted-foreground">{r.aim}</p>}
              {typeof pct === "number" && <p className="text-sm font-semibold text-foreground">{t({ message: `The role asks: ${pct}% commitment`, context: "open proposal beside" })}</p>}
              {r.alwaysChecked && <p className="text-sm text-foreground">{t({ message: "A background check happens for this role whatever the references say.", context: "open proposal role" })}</p>}
            </div>
          )
        })
      )}
      <p className="hidden text-xs text-muted-foreground [@media(hover:hover)]:block">{t({ message: "Enter moves on. When the cursor is not in a field, the arrow keys walk between stones.", context: "open proposal keys" })}</p>
    </div>
  );

  const panel = (i: number) => ({
    hidden: stone !== i,
    "data-stone": STONES[i],
    "aria-labelledby": `stone-${i}-h`,
    className: "grid gap-6",
  });
  const heading = (i: number) => (
    <h2 id={`stone-${i}-h`} tabIndex={-1} className="font-display text-3xl leading-tight text-card-foreground outline-none">
      {labels[i]}
    </h2>
  );

  return (
    <Shell wide>
      <div className="mb-6 max-w-3xl">
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
          {/* B7: a member who is signed in has an account already, so the form does not tell them they need none. */}
          {form.term
            ? me
              ? t`Pick up to ${maxRoles} roles for this moon, from ${moonFrom} to the next new moon on ${moonTo}, say what you bring, and send it. Your name and email come from your account.`
              : t`Pick up to ${maxRoles} roles for this moon, from ${moonFrom} to the next new moon on ${moonTo}, say what you bring, and send it. You don't need an account.`
            : form.season
              ? me
                ? t`Pick up to ${maxRoles} roles for ${seasonName}, say what you bring, and send it. Your name and email come from your account.`
                : t`Pick up to ${maxRoles} roles for ${seasonName}, say what you bring, and send it. You don't need an account.`
              : t`The village hasn't set its next season yet, so there's nothing to propose for right now. Check back soon.`}
        </p>
      </div>

      {form.season && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <form
            onSubmit={submit}
            onKeyDown={onKeys}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            noValidate
            className="relative min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            data-open-proposal=""
            data-hides-fab=""
            data-stone-now={STONES[stone]}
          >
            {/* The path: six stones over water, each a real button. A stone ahead opens once you have walked to it. */}
            <div data-form-trail="" className="-mt-2 mb-6">
              <Trail
                labels={labels}
                step={stone}
                reached={reached}
                visited={visited}
                onGo={(i) => goTo(i)}
                barLabel={t({ message: "Your path through the form, six stones", context: "open proposal stones" })}
              />
            </div>

            {/* On a phone the role card cannot sit beside the stone, so its name rides along above it. */}
            {stone > 0 && pickedNames && (
              <p className="-mt-2 mb-4 text-sm text-muted-foreground lg:hidden" data-role-chip="">
                {t({ message: `Proposing for: ${pickedNames}`, context: "open proposal stones" })}
              </p>
            )}

            {problems.length > 0 && (
              <div id="propose-problems" tabIndex={-1} role="alert" className="mb-6 rounded-lg border border-border bg-muted p-4 text-sm text-foreground outline-none" data-problems="">
                <p className="font-semibold">
                  {stone === LAST_STONE
                    ? problems.length === 1
                      ? t`One thing to fix before we can send this:`
                      : t`${problems.length} things to fix before we can send this:`
                    : problems.length === 1
                      ? t`One thing to look at before the next stone:`
                      : t`${problems.length} things to look at before the next stone:`}
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

            <div className="mb-6">
              <Companion walked={reached} now={stone} labels={labels}>
                {companion[stone]}
              </Companion>
            </div>

            {/* STONE 1: your role. */}
            <section {...panel(0)}>
              {heading(0)}
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
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{circle}</h3>
                    {roles.map((r) => {
                      const on = r.id in picked;
                      return (
                        <div key={r.id} className={`rounded-xl border p-4 ${on ? "border-notice bg-notice/10" : "border-border"}`} data-role={r.id}>
                          <label className="flex min-h-11 cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-5 shrink-0 accent-notice"
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
                        </div>
                      );
                    })}
                  </div>
                ))}
                <Beside id="propose-problem-roles" message={problemOn("roles")} />
              </fieldset>
            </section>

            {/* STONE 2: your moon. The aim, then each role's own card: its goals, the first moon's goals, the season goal it serves. */}
            <section {...panel(1)}>
              {heading(1)}
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
              {chosenRoles.length === 0 && <p className={HINT}>{t`Pick a role on the first stone, and its goals are asked here.`}</p>}
              {chosenRoles.map((r) => (
                <RoleAsks
                  key={r.id}
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
              ))}
            </section>

            {/* STONE 3: why you, with starter phrases to begin from. */}
            <section {...panel(2)}>
              {heading(2)}
              <div className="flex flex-wrap gap-2" data-starters="">
                {starters.map((s) => (
                  <button key={s} type="button" onClick={() => startWith(s)} className="jw-btn inline-flex min-h-11 items-center rounded-full border border-border bg-muted px-4 text-sm text-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {s}
                  </button>
                ))}
              </div>
              <div>
                <label htmlFor="propose-why" className="mb-2 block text-sm font-semibold text-card-foreground">
                  {t`Why you, and why now`}
                </label>
                <textarea id="propose-why" required rows={7} maxLength={OPEN_WHY_MAX} value={why} onChange={(e) => setWhy(e.target.value)} className={FIELD} {...invalid("why")} />
                <Beside id="propose-problem-why" message={problemOn("why")} />
                <p className={`mt-2 ${HINT}`}>{t`A few lines is enough. The people who decide read every word.`}</p>
              </div>
            </section>

            {/* STONE 4: your energy. The commitment and the eight settings with each role's suggestion (joining lane PR 3), then when you can meet. */}
            <section {...panel(3)}>
              {heading(3)}
              <section aria-labelledby="propose-terms-h" tabIndex={-1} className="grid scroll-mt-24 gap-4 outline-none" data-terms-section="">
                <h3 id="propose-terms-h" className="font-display text-2xl font-bold text-card-foreground">
                  {t({ message: "The terms", context: "open proposal section" })}
                </h3>
                <TermsEight
                  roles={chosenRoles.map((r) => ({ id: r.id, name: r.name, words: r.terms?.words, commitmentPct: r.terms?.commitmentPct ?? null }))}
                  value={termsStep}
                  onChange={setTermsStep}
                  problem={problemOn("terms")}
                  idPrefix="propose-terms"
                />
              </section>
              <Practicalities value={practical} onChange={setPractical} part="rest" />
            </section>

            {/* STONE 5: about you. The links and files sit here, and the references with the background-check wording. */}
            <section {...panel(4)}>
              {heading(4)}
              <div className="grid scroll-mt-24 gap-5" data-about-you-section="">
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
                <ReferencesBlock value={about} onChange={setAbout} idPrefix="propose-about" alwaysChecked={chosenRoles.some((r) => r.alwaysChecked === true)} invalid={problems.some((p) => p.field === "checkConsent" || p.field === "references")} />
              </div>
            </section>

            {/* STONE 6: send. A look back along the path, the agreements, then who you are and the button. */}
            <section {...panel(5)}>
              {heading(5)}
              <ul className="grid gap-2" data-review="">
                {review.map(([i, line]) => (
                  <li key={i} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-2">
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
            </section>

            {/* The honeypot. Named `hp` so no autofill heuristic fills it; see ReserveHome.tsx. */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
              <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </div>

            {/*
              THE ONE NEXT ACT, within thumb reach. On a phone the bar rides just
              above the tab bar (--tabbar-h, index.css); on a desk that band is
              0 and it rests at the card's foot. Fireflies gather on it.
            */}
            <div className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-20 -mx-5 mt-8 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:-mx-8 sm:px-6" data-stone-bar="">
              <button type="button" onClick={back} disabled={stone === 0} className={`${BTN_SECONDARY} disabled:invisible`} data-stone-back="">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t({ message: "Back", context: "open proposal stones" })}
              </button>
              {stone < LAST_STONE ? (
                <Fireflies key={`next-${stone}`} className="min-w-0 flex-1 justify-end sm:flex-none">
                  <button type="button" onClick={next} className={`${BUTTON} w-full sm:w-auto`} data-stone-next="">
                    {t({ message: `Next: ${nextName}`, context: "open proposal stones" })}
                    <ArrowRight className="size-5" aria-hidden="true" />
                  </button>
                </Fireflies>
              ) : (
                <Fireflies key="send" className="min-w-0 flex-1 justify-end sm:flex-none">
                  <button type="submit" disabled={sending || count === 0} className={`${BUTTON} w-full sm:w-auto`}>
                    {sending ? t({ message: "Sending...", context: "open proposal send" }) : t({ message: "Send my proposal", context: "open proposal send" })}
                    {!sending && <ArrowRight className="size-5" aria-hidden="true" />}
                  </button>
                </Fireflies>
              )}
            </div>
          </form>

          {/* A desk has the width: the role card stays beside the stone. */}
          <aside className="hidden lg:sticky lg:top-24 lg:grid lg:gap-4">{roleCard}</aside>
        </div>
      )}
    </Shell>
  );
}
