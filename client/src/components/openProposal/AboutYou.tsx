/**
 * ABOUT YOU (joining lane PR 2; the contract is shared/proposalAbout.ts).
 *
 *   AboutYouFacts    where you are based, your languages, your story with us
 *   ReferencesBlock  up to three references and the background-check consent
 *   AboutYouView     what the people who decide a proposal read
 *
 * Used by the open form (/propose-a-role) and by the member door's "About you"
 * step, so both ask the same things in the same words. The fields wear the
 * classes the rest of the site's forms wear (the profile's cards and inputs):
 * a `fieldClass` can be handed in where a host draws its own.
 *
 * The references are third-party data. The form says who sees them, and the
 * server keeps them for the deciders only, away from every AI.
 */
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  ABOUT_BASED_MAX,
  ABOUT_LANGUAGES_MAX,
  ABOUT_STORY_MAX,
  CHECK_WORDS,
  REFERENCES_MAX,
  REFERENCE_CONTACT_MAX,
  REFERENCE_HOW_MAX,
  REFERENCE_NAME_MAX,
  ABOUT_WORDS,
  checkConsentVersion,
  checkLine,
  checkNeeded,
  parseReferences,
  type BackgroundCheck,
  type ProposalAbout,
  type ProposalReference,
} from "@shared/proposalAbout";

export const ABOUT_FIELD =
  "w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "mb-2 block text-sm font-semibold text-card-foreground";

export interface AboutYouValue {
  based: string;
  languages: string;
  story: string;
  references: ProposalReference[];
  consent: boolean;
}

export const EMPTY_ABOUT_YOU: AboutYouValue = { based: "", languages: "", story: "", references: [], consent: false };

const BLANK_REF: ProposalReference = { name: "", how: "", contact: "" };

/** The value as the answers hold it, from anything. */
export function aboutYouOf(v: unknown): AboutYouValue {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const refs = Array.isArray(o.references) ? (o.references as any[]).map((r) => ({ name: s(r?.name), how: s(r?.how), contact: s(r?.contact) })) : [];
  return { based: s(o.based), languages: s(o.languages), story: s(o.story), references: refs, consent: o.consent === true };
}

/** Whether the references are all blank (a blank row is one with nothing in it). */
export const referencesBlank = (refs: readonly ProposalReference[]): boolean => refs.every((r) => !r.name.trim() && !r.how.trim() && !r.contact.trim());

/** Whether the consent tick is required: references all blank, or a role picked is always checked. */
export function consentRequired(v: AboutYouValue, alwaysChecked: boolean): boolean {
  const judged = parseReferences(v.references);
  // A half-filled reference is a problem of its own; it does not count as given.
  const given = judged.ok ? judged.value : [];
  return checkNeeded(given, alwaysChecked).needed;
}

/** The step's verdict, in the shared rules' own words. */
export function aboutYouProblem(raw: unknown, alwaysChecked: boolean): string | null {
  const v = aboutYouOf(raw);
  const judged = parseReferences(v.references);
  if (!judged.ok) return judged.error;
  if (checkNeeded(judged.value, alwaysChecked).needed && !v.consent) return ABOUT_WORDS.needConsent;
  return null;
}

/** What goes to the server for the section: the references, the facts, and the tick with the wording version shown. */
export function aboutYouBody(v: AboutYouValue): { references: ProposalReference[]; about: ProposalAbout; checkConsent?: { given: true; version: string } } {
  const about: ProposalAbout = {};
  if (v.based.trim()) about.based = v.based.trim();
  if (v.languages.trim()) about.languages = v.languages.trim();
  if (v.story.trim()) about.story = v.story.trim();
  const refs = v.references.map((r) => ({ name: r.name.trim(), how: r.how.trim(), contact: r.contact.trim() })).filter((r) => r.name || r.how || r.contact);
  return { references: refs, about, ...(v.consent ? { checkConsent: { given: true as const, version: checkConsentVersion() } } : {}) };
}

export function AboutYouFacts({
  value,
  onChange,
  fieldClass = ABOUT_FIELD,
  idPrefix = "about",
  storyAssist,
}: {
  value: AboutYouValue;
  onChange: (next: AboutYouValue) => void;
  fieldClass?: string;
  idPrefix?: string;
  /** "Ask Sera for a first draft" and the draft mark for the story line, when the page can offer them (shared/seraDrafts.ts). */
  storyAssist?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <div className="grid gap-4" data-about-facts="">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-based`} className={LABEL}>
            {t({ message: "Where you are based (optional)", context: "about you" })}
          </label>
          <input id={`${idPrefix}-based`} maxLength={ABOUT_BASED_MAX} value={value.based} onChange={(e) => onChange({ ...value, based: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-languages`} className={LABEL}>
            {t({ message: "Languages you work in (optional)", context: "about you" })}
          </label>
          <input id={`${idPrefix}-languages`} maxLength={ABOUT_LANGUAGES_MAX} value={value.languages} onChange={(e) => onChange({ ...value, languages: e.target.value })} className={fieldClass} />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-story`} className={LABEL}>
          {t({ message: "Your story with us, in a line (optional)", context: "about you" })}
        </label>
        <input id={`${idPrefix}-story`} maxLength={ABOUT_STORY_MAX} value={value.story} onChange={(e) => onChange({ ...value, story: e.target.value })} className={fieldClass} />
        {storyAssist && <div className="mt-2 grid gap-2">{storyAssist}</div>}
      </div>
    </div>
  );
}

export function ReferencesBlock({
  value,
  onChange,
  alwaysChecked,
  fieldClass = ABOUT_FIELD,
  idPrefix = "about",
  invalid,
}: {
  value: AboutYouValue;
  onChange: (next: AboutYouValue) => void;
  /** A role picked is always background-checked. */
  alwaysChecked: boolean;
  fieldClass?: string;
  idPrefix?: string;
  invalid?: boolean;
}) {
  const { t } = useLingui();
  const rows = Array.from({ length: REFERENCES_MAX }, (_, i) => value.references[i] ?? BLANK_REF);
  const setRow = (i: number, next: ProposalReference) => onChange({ ...value, references: rows.map((r, k) => (k === i ? next : r)) });
  const needed = consentRequired(value, alwaysChecked);
  return (
    <fieldset className="grid gap-4" data-references="" aria-invalid={invalid || undefined}>
      <legend className="mb-1 text-sm font-semibold text-card-foreground">{t({ message: "References (optional)", context: "about you" })}</legend>
      <p className="text-sm text-muted-foreground">{t({ message: "Up to three people who know your work. Each needs a name, how you know them, and an email or phone number.", context: "about you" })}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)]" data-reference-row={i}>
          <input
            aria-label={t({ message: `Reference ${i + 1}: name`, context: "about you" })}
            placeholder={t({ message: "Name", context: "about you reference" })}
            maxLength={REFERENCE_NAME_MAX}
            autoComplete="off"
            value={r.name}
            onChange={(e) => setRow(i, { ...r, name: e.target.value })}
            className={fieldClass}
          />
          <input
            aria-label={t({ message: `Reference ${i + 1}: how you know them`, context: "about you" })}
            placeholder={t({ message: "How you know them", context: "about you reference" })}
            maxLength={REFERENCE_HOW_MAX}
            autoComplete="off"
            value={r.how}
            onChange={(e) => setRow(i, { ...r, how: e.target.value })}
            className={fieldClass}
          />
          <input
            aria-label={t({ message: `Reference ${i + 1}: email or phone`, context: "about you" })}
            placeholder={t({ message: "Email or phone", context: "about you reference" })}
            maxLength={REFERENCE_CONTACT_MAX}
            autoComplete="off"
            value={r.contact}
            onChange={(e) => setRow(i, { ...r, contact: e.target.value })}
            className={fieldClass}
          />
        </div>
      ))}
      <div className="grid gap-2 rounded-lg border border-border bg-muted p-4 text-sm text-foreground" data-check-words="">
        <p className="font-semibold">{t({ message: "References and a background check", context: "about you" })}</p>
        {alwaysChecked && (
          <p data-check-role="" className="font-semibold">
            {t({ message: "A check happens for this role whatever the references say.", context: "about you" })}
          </p>
        )}
        <p>{t({ message: "If you leave the three references blank, we'll run a background check instead. We cover its cost. The provider depends on your country.", context: "about you" })}</p>
        <p>{t({ message: "We contact your references only after our first conversation, and only with your OK.", context: "about you" })}</p>
        <p className="text-muted-foreground">{t({ message: "Only the people who decide your proposal see your references. No AI reads them. We delete them when we delete your proposal, or when we remove your name and email.", context: "about you" })}</p>
        {needed && (
          <label className="flex min-h-11 items-start gap-3 font-semibold" data-check-consent="">
            <input type="checkbox" id={`${idPrefix}-consent`} className="mt-1 size-5 shrink-0 accent-primary" checked={value.consent} onChange={(e) => onChange({ ...value, consent: e.target.checked })} />
            <span>{t({ message: "I have read this and I agree to the background check.", context: "about you" })}</span>
          </label>
        )}
      </div>
    </fieldset>
  );
}

/** What the server sends a decider (and nobody else). */
export interface ServedAboutYou {
  references: ProposalReference[];
  about: ProposalAbout;
  backgroundCheck: BackgroundCheck | null;
}

export function AboutYouView({ about }: { about: ServedAboutYou | null | undefined }) {
  const { t } = useLingui();
  if (!about) return null;
  const { references, backgroundCheck } = about;
  const facts = [
    about.about.based && { label: t({ message: "Based in", context: "about you" }), text: about.about.based },
    about.about.languages && { label: t({ message: "Languages", context: "about you" }), text: about.about.languages },
    about.about.story && { label: t({ message: "Story with us", context: "about you" }), text: about.about.story },
  ].filter(Boolean) as Array<{ label: string; text: string }>;
  if (!facts.length && !references.length && !backgroundCheck) return null;
  const consent = backgroundCheck?.consent;
  const day = consent ? new Date(consent.at).toISOString().slice(0, 10) : "";
  return (
    <section aria-labelledby="op-aboutyou" className="grid gap-3" data-aboutyou="">
      <h2 id="op-aboutyou" className="text-lg font-bold text-foreground">
        {t({ message: "About you, references and background check", context: "about you heading" })}
      </h2>
      <p className="text-sm text-muted-foreground">{t({ message: "Only the people who decide this proposal see these. No AI reads them. They are deleted with the proposal.", context: "about you" })}</p>
      {facts.length > 0 && (
        <dl className="grid gap-1 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-wrap gap-x-3">
              <dt className="font-semibold text-foreground">{f.label}</dt>
              <dd className="min-w-0 break-words text-foreground">{f.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {references.length > 0 && (
        <ul className="grid gap-2" data-references-list="">
          {references.map((r, i) => (
            <li key={i} className="rounded-lg border border-border bg-card p-3 text-sm">
              <span className="font-semibold text-foreground">{r.name}</span>
              <span className="block text-muted-foreground">{r.how}</span>
              <span className="block break-all text-foreground">{r.contact}</span>
            </li>
          ))}
        </ul>
      )}
      {backgroundCheck && (
        <div className="grid gap-1 text-sm text-foreground" data-check-line="">
          <p className="font-semibold">{checkLine(backgroundCheck)}</p>
          <p className="text-muted-foreground">{consent ? ABOUT_WORDS.consentGiven(day) : ABOUT_WORDS.noConsent}</p>
        </div>
      )}
    </section>
  );
}

export { CHECK_WORDS };
