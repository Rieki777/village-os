import Layout from "@/components/Layout";
import { m, AnimatePresence } from "framer-motion";
import { Heart, CheckCircle2, ArrowRight, Users, Home, TrendingUp, Sparkles, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { authToken, gameFetch, useGameConfig, useVillageLinks } from "@/lib/gameApi";
import { useOptionalAuth } from "@/contexts/AuthContext";
import {
  LETTER_PAGE_SECTION,
  LETTER_WORDS,
  letterSourceFrom,
  renderMembershipLetter,
  type ServedLetter,
} from "@shared/membershipLetter";
import { useVillageContent } from "@/hooks/useVillageContent";
import { useVillageName } from "@/hooks/useVillageName";
import { usePageVars } from "@/hooks/usePageContent";
import { LETTER_PATH_IDS, LOVE_LETTER_PAGE } from "@shared/pageContent/loveLetter";
import { resolvePage } from "@shared/pageContent/resolve";

/**
 * S2 brochure lane, 2026-08-30: this page used to state, nine times, that
 * membership is in "Amora 508(c)(1)(a)" and that monthly contributions are
 * tax-deductible. That is 26 U.S. Code § 508(c)(1)(A), the automatic-exemption
 * category for US churches. Correct for Amora (see the Church of the
 * Regenerative Earth in the project's own docs), and simply false for any
 * fork operating outside the US, or with no equivalent entity at all. This is
 * the same class of harm as the Costa Rica property/tax claims in
 * WhyCostaRica.tsx, arguably sharper: it is a direct promise about the
 * signer's own tax return, made on the page that collects their money.
 *
 * `legal.membership` (GET /api/content/legal, same section WhyCostaRica.tsx
 * and ResidentRights.tsx read) carries Amora's real entity name and its own
 * wording, preserved as data in server/seeds/amora/brochure-legal-seed.json, not
 * deleted. Where a village has not published its own, this renders no tax
 * claim at all. Never a hedge, never an invented "ask a lawyer" caveat that
 * itself implies deductibility might apply. Absence, not a guess.
 */
/**
 * The two paragraphs of the covenant that describe THIS village's own land
 * and THIS village's own plan (S3 pages lane, 2026-08-31).
 *
 * Same mechanism as `legal` above, different section key: the generic
 * content routes key on whatever string is in the URL, so a new section
 * needs no server route, only a door in Admin (CONTENT_SECTIONS in
 * Admin.tsx, where `covenant` is now registered beside `legal`).
 *
 * Why these two and not the whole letter: every other paragraph here is
 * about joining a village and is true of any of them. These two are not.
 * One described "acres of sacred Costa Rican jungle, ocean-kissed"; the
 * other promised a governance council "once we've sold 33 lots". A founder
 * in Vermont was asking their members to SIGN a description of somebody
 * else's land and somebody else's sales target. That is worse than a name
 * in a heading, because a signature is supposed to mean the signer read it.
 *
 * Unset falls back to the same sentence with the geography and the number
 * taken out, never to a hedge and never to an invented fact. Amora's own
 * wording is preserved as data in server/seeds/amora/pages-covenant-seed.json and
 * needs one authenticated admin PUT to /api/admin/content/covenant, exactly
 * as the brochure lane's legal seed does.
 */
interface CovenantContent {
  /** The opening invitation. May describe the land, if the village has one to describe. */
  opening?: string;
  /** How and when this village will form its governance. */
  governance?: string;
}

interface LegalContent {
  membership?: {
    /** e.g. "Amora 508(c)(1)(a)". Blank falls back to the village name. */
    entityLabel?: string;
    /** The full paragraph in the letter body. Omitted entirely when blank. */
    contributionParagraph?: string;
    /** The short line above the contribution-level selector. */
    contributionShortNote?: string;
    /** The fine-print line under the submit button. */
    footerNote?: string;
  };
}

/**
 * THE LETTER IS THE SERVER'S WORDS (seat settings PR9).
 *
 * A signed-in member who sends this form ALIGNS with the letter: the server
 * keeps its exact words in the alignment store, under the member's account.
 * So the page draws the letter the server rendered (`GET /api/membership-letter`)
 * and sends back the version it drew; the server refuses a member's signing
 * whose version is not the letter as it stands, and the page then shows the
 * letter again. The parts come from shared/membershipLetter.ts, the one
 * rendering both sides use, which also draws the letter from the page's own
 * config and content while the server's copy is on its way.
 *
 * ONE CLICK FROM THE ACCOUNT, NO TYPED NAME (Rye, 2026-10-01). A member does
 * not type their name or email: the account names them. The form's own words
 * say "align" to a member. A visitor without an account still fills in the
 * form and signs it as before: there is no account to align from, and nothing
 * is kept for them in the alignment store. The letter's own sentence about
 * signing is the village's words, kept as written.
 */

/**
 * WHAT HAPPENS NEXT, AS THE PRODUCT DOES IT.
 *
 * The thank-you used to say "You are now part of the community", promise a
 * welcome email "within 48 hours" and a personal welcome call, and invite the
 * signer to a first Community Circle. None of it was true. Membership waits on
 * the people who look after joining accepting the letter (`intake.moderate`,
 * `PUT /api/admin/submissions/:id/status`) or on enough vouches
 * (server/routes/vouches.ts), and no code sends a welcome email, books a call
 * or invites anybody to a circle. So the page says only what the product does:
 *
 *   - the letter waits with the people who look after joining;
 *   - a signer with an account hears the answer as a notice, because the
 *     status route notifies the account a row names (server/lib/submissionNotices.ts),
 *     and their profile shows where it stands under What you have aligned with;
 *   - members who know them can vouch on their public page. Said only while
 *     the village counts vouches and the signer still needs some, read from
 *     `GET /api/me/vouches`, which is the same rule VouchPanel uses to hide;
 *   - a stranger has no account to notify, so somebody writes to the address
 *     they gave, the promise the Ask to join page already makes.
 *
 * Unknown draws nothing: a vouch read that fails leaves its line out.
 */
function NextStep({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
      <p>{children}</p>
    </div>
  );
}

/** What each path choice needs that is not words. Its label is the village's (Admin, Pages, Membership letter). */
const PATH_LOOK: Record<(typeof LETTER_PATH_IDS)[number], { icon: typeof Users; color: string }> = {
  investor: { icon: TrendingUp, color: "border-amber text-amber" },
  steward: { icon: Users, color: "border-sage text-sage" },
  resident: { icon: Home, color: "border-teal text-teal" },
  prosperity: { icon: Sparkles, color: "border-teal-light text-teal-light" },
};

export default function LoveLetter() {
  const { content: legal } = useVillageContent<LegalContent>("legal");
  const { content: covenant } = useVillageContent<CovenantContent>("covenant");
  // The village's own words for this page and for the letter itself (Admin,
  // Pages, Membership letter), stored as `page-love-letter`. The server reads
  // the same section to render the letter it serves, so the two agree.
  const { content: pageDoc, loading: pageLoading } = useVillageContent<Record<string, unknown>>(LETTER_PAGE_SECTION);
  const pageVars = usePageVars();
  const villageName = useVillageName();
  const cfg = useGameConfig();
  const user = useOptionalAuth()?.user ?? null;
  const membership = legal?.membership;
  // The village's own name alone when no entity is published: a name, not a
  // legal claim. Everywhere this file used to say "Amora 508(c)(1)(a)".
  // S3 pages lane: the fallback was the literal "Amora", so a founder who
  // had never published a legal entity signed their members into somebody
  // else's church on the line that collects their money.
  const entityName = membership?.entityLabel?.trim() || villageName;
  const contributionShortNote = membership?.contributionShortNote?.trim();
  const footerNote =
    membership?.footerNote?.trim() ||
    "Ask your community how membership contributions are structured, and whether any part is tax-deductible where you live.";
  // This page's words, `{entity}` included. Null until the saved words have
  // arrived, so the defaults never flash first.
  const page = useMemo(
    () => (pageVars && !pageLoading ? resolvePage(LOVE_LETTER_PAGE, pageDoc, { ...pageVars, entity: entityName }) : null),
    [pageVars, pageLoading, pageDoc, entityName],
  );
  const hero = page?.hero.fields;
  const words = page?.form;
  const contribution = page?.contribution;
  // A level with no amount or no label cannot be picked honestly, so it is not offered.
  const tiers = (contribution?.lists.tiers ?? []).filter((t) => (t.value ?? "").trim() !== "" && (t.label ?? "").trim() !== "");
  const suggestedLine = [contributionShortNote, contribution?.fields.suggested].filter(Boolean).join(" ");

  // The server's letter once it lands; until then the same rendering from
  // this page's own config and content. A member aligns only with the
  // server's, because only that one carries a version to send back.
  const [letter, setLetter] = useState<ServedLetter | null>(null);
  const [letterFailed, setLetterFailed] = useState(false);
  const readLetter = useCallback(async () => {
    try {
      const res = await fetch("/api/membership-letter");
      if (!res.ok) throw new Error(String(res.status));
      setLetter((await res.json()) as ServedLetter);
      setLetterFailed(false);
    } catch {
      setLetterFailed(true);
    }
  }, []);
  useEffect(() => {
    void readLetter();
  }, [readLetter]);
  // Neither fallback inside states a fact about any particular place or plan (shared/membershipLetter.ts).
  const local = renderMembershipLetter(letterSourceFrom(cfg, { covenant, legal, [LETTER_PAGE_SECTION]: pageDoc }));
  const parts = letter?.parts ?? local.parts;
  const letterTitle = letter?.title ?? local.title;

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    paths: [] as string[],
    why: "",
    contribution: "",
    customAmount: "",
    goodNeighbor: false,
    commitmentAck: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  // The server's vouch sentence, once a signer with an account is in and the village still counts vouches for them.
  const [vouchesLeft, setVouchesLeft] = useState("");
  const signerId = user?.id ?? "";
  useEffect(() => {
    if (!submitted || !signerId) return;
    let live = true;
    gameFetch("/api/me/vouches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.state && !d.state.off && !d.state.met) setVouchesLeft(String(d.sentence ?? ""));
      })
      .catch(() => {
        /* Unknown draws nothing. */
      });
    return () => {
      live = false;
    };
  }, [submitted, signerId]);
  // The covenant form's failure path used to name one village's inbox, so a
  // would-be member of any other village was told, on the worst screen of the
  // flow, to write to strangers. With no published address the sentence stops
  // early rather than inventing a recipient.
  const { contactEmail } = useVillageLinks();
  const emailFallback = contactEmail ? ` or email ${contactEmail}` : "";

  const togglePath = (pathId: string) => {
    setForm(prev => ({
      ...prev,
      paths: prev.paths.includes(pathId)
        ? prev.paths.filter(p => p !== pathId)
        : [...prev.paths, pathId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.goodNeighbor || !form.commitmentAck) {
      setError("Please acknowledge both commitments to proceed.");
      return;
    }
    if (form.paths.length === 0) {
      setError("Please select at least one path.");
      return;
    }
    if (!form.contribution) {
      setError("Please select a monthly contribution level.");
      return;
    }
    if (form.contribution === "custom" && !form.customAmount.trim()) {
      setError("Please describe your custom contribution amount.");
      return;
    }
    if (user && !letter) {
      setError(LETTER_WORDS.unreadable);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      /*
       * THE SIGNATURE CARRIES WHO SIGNED IT, when there is somebody to name.
       *
       * This form has never sent a token, in any commit, and `authedUser` on
       * the server reads `Authorization: Bearer` alone with no cookie
       * fallback. So every signature this page has ever stored was anonymous,
       * and a signed-in member who signed the Love Letter left a row that
       * could not be connected back to their account. Accepting one now
       * admits the person who signed it, and without this header there is
       * nobody named to admit.
       *
       * A stranger signing without an account sends no header and is stored
       * exactly as before.
       */
      const token = authToken();
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: "membership-508",
          data: {
            // A member's account names them; nobody types their own name to align (Rye, 2026-10-01).
            name: user ? user.name : form.name,
            email: user ? user.email : form.email,
            phone: form.phone,
            paths: form.paths,
            why: form.why,
            monthlyContribution: form.contribution === "custom" ? `custom: ${form.customAmount}` : form.contribution,
            acknowledgedGoodNeighbor: form.goodNeighbor,
            acknowledgedCommitments: form.commitmentAck,
            signedAt: new Date().toISOString(),
            // The words this page drew. A member is aligned with exactly these, or refused.
            ...(letter ? { letterVersion: letter.version } : {}),
          },
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else if (res.status === 409) {
        // The letter changed since this page drew it: show the new words, and ask again.
        const body = await res.json().catch(() => null);
        if (body?.letter) setLetter(body.letter as ServedLetter);
        else void readLetter();
        setError(String(body?.message ?? LETTER_WORDS.changed));
      } else {
        setError(`Something went wrong. Please try again${emailFallback}.`);
      }
    } catch {
      setError(`Could not connect. Please try again${emailFallback}.`);
    }
    setSubmitting(false);
  };

  if (submitted) {
    const firstName = (user ? user.name : form.name).trim().split(/\s+/)[0] ?? "";
    const handle = user?.handle?.trim() ?? "";
    return (
      <Layout>
        <section className="py-24 bg-background">
          <div className="container max-w-2xl mx-auto">
            <m.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <m.div
                className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-8"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Heart className="w-12 h-12 text-primary" fill="currentColor" />
              </m.div>
              <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-6">
                Thank you{firstName ? `, ${firstName}` : ""}.
              </h1>
              {user && (
                <p className="text-base text-foreground mb-8">
                  {LETTER_WORDS.done}{" "}
                  <Link href="/profile" className="font-semibold text-primary underline underline-offset-2">
                    {LETTER_WORDS.kept}
                  </Link>
                </p>
              )}
              <div className="bg-card border border-primary/20 rounded-2xl p-8 mb-8 text-left">
                <h2 className="font-display text-2xl font-bold text-foreground mb-4">What happens next</h2>
                <div data-next-steps="" className="space-y-4 text-muted-foreground">
                  <NextStep>Your letter is with the people who look after joining {villageName}.</NextStep>
                  {user ? (
                    <NextStep>You will get a notice when they answer, and your profile shows where it stands.</NextStep>
                  ) : (
                    <NextStep>
                      Someone will write to you at{" "}
                      <span className="font-medium text-foreground break-words">{form.email.trim()}</span>.
                    </NextStep>
                  )}
                  {user && handle && vouchesLeft && (
                    <NextStep>
                      Members who know you can also vouch for you on{" "}
                      <Link href={`/profile/${encodeURIComponent(handle)}`} className="font-semibold text-primary underline underline-offset-2">
                        your page
                      </Link>
                      . {vouchesLeft}
                    </NextStep>
                  )}
                </div>
              </div>
              {page?.thanks.fields.quote && (
              <p className="text-lg font-accent text-primary italic mb-8 break-words">
                "{page.thanks.fields.quote}"
              </p>
              )}
              <a
                href="/"
                className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-full font-semibold hover:bg-teal-deep-dark transition"
              >
                Return Home
                <ArrowRight className="w-5 h-5" />
              </a>
            </m.div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="py-16 bg-background">
        <div className="container max-w-3xl mx-auto">

          {/* Header */}
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Heart className="w-8 h-8 text-primary" />
            </div>
            <h1 className={`font-display text-4xl md:text-5xl font-bold text-foreground mb-4 break-words${hero ? "" : " invisible"}`}>
              {hero?.headline || "\u00a0"}
            </h1>
            <p className={`text-xl text-muted-foreground max-w-2xl mx-auto break-words${hero ? "" : " invisible"}`}>
              {hero?.lede}
              {user ? ` ${LETTER_WORDS.readReflect}` : " Read. Reflect. Sign."}
            </p>
          </m.div>

          {/* The Letter */}
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card p-6 sm:p-8 md:p-12 rounded-2xl shadow-lg font-accent text-lg leading-relaxed mb-10 border border-border"
          >
            <p className="mb-6 text-foreground">{parts.greeting}</p>

            <p className="mb-6 text-muted-foreground">{parts.opening}</p>

            <p className="mb-6 text-muted-foreground">{parts.joining}</p>

            {/* With no commitments the line leading into them goes too, as it does in the stored words. */}
            {parts.commitments.length > 0 && (
              <>
                <p className="mb-4 text-foreground font-semibold">{parts.commitLead}</p>

                <ul className="space-y-3 mb-8">
                  {parts.commitments.map((commitment, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Heart className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                      <span className="text-muted-foreground min-w-0 break-words">{commitment}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mb-6 text-muted-foreground">{parts.inReturn}</p>

            <p className="mb-6 text-muted-foreground">{parts.governance}</p>

            {parts.contribution && (
              <p className="mb-6 text-muted-foreground">{parts.contribution}</p>
            )}

            <p className="text-foreground font-semibold italic">
              {parts.closing}<br />
              <span className="font-display text-xl not-italic">{parts.signature}</span>
            </p>
          </m.div>

          {/* Membership Form. Drawn once this page's words have arrived. */}
          {page && words && contribution && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-primary/5 border border-primary/20 rounded-2xl p-6 sm:p-8 md:p-12"
          >
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-2 break-words">
              {user ? LETTER_WORDS.heading(letterTitle) : words.fields.visitorHeading}
            </h2>
            <p className="text-muted-foreground mb-8 break-words">
              {user ? LETTER_WORDS.lede(villageName, pageVars?.member ?? "member") : words.fields.visitorLede}
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Name + Email: a member's account already holds both, so a member types neither. */}
              {user ? (
                <p data-aligning-as="" className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                  {LETTER_WORDS.asYou(user.name)}
                </p>
              ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  {/* htmlFor on every label here. The text was already above
                      each field; nothing tied the two together, so a screen
                      reader met five unnamed controls on the form that
                      introduces someone to the village. */}
                  <label htmlFor="letter-name" className="block text-sm font-medium text-foreground mb-2">
                    Full Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="letter-name"
                    type="text"
                    autoComplete="name"
                    required
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Your full name"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label htmlFor="letter-email" className="block text-sm font-medium text-foreground mb-2">
                    Email Address <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="letter-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              )}

              {/* Phone */}
              <div>
                <label htmlFor="letter-phone" className="block text-sm font-medium text-foreground mb-2">
                  Phone / WhatsApp (optional)
                </label>
                <input
                  id="letter-phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+1 555 000 0000"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Which paths */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">
                  Which path(s) are you on? <span className="text-destructive">*</span>
                </label>
                <p className="text-sm text-muted-foreground mb-4">Select all that apply, you can walk multiple paths.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  {words.lists.paths.map(path => {
                    const id = path.id ?? "";
                    const look = PATH_LOOK[id as keyof typeof PATH_LOOK];
                    if (!look) return null;
                    return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => togglePath(id)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        form.paths.includes(id)
                          ? `${look.color} bg-primary/5`
                          : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      <look.icon className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium min-w-0 break-words">{path.label}</span>
                      {form.paths.includes(id) && (
                        <CheckCircle2 className="w-4 h-4 ml-auto flex-shrink-0" />
                      )}
                    </button>
                    );
                  })}
                </div>
              </div>

              {/* Monthly contribution */}
              <div>
                <label htmlFor="letter-contribution" className="block text-sm font-medium text-foreground mb-2 break-words">
                  {contribution.fields.heading}
                </label>
                {suggestedLine && (
                <p className="text-sm text-muted-foreground mb-3 break-words">
                  {suggestedLine}
                </p>
                )}
                <select
                  id="letter-contribution"
                  value={form.contribution}
                  onChange={e => setForm(p => ({ ...p, contribution: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select contribution level</option>
                  {tiers.map((tier, i) => (
                    <option key={`${i}-${tier.value}`} value={tier.value}>
                      {tier.label}
                    </option>
                  ))}
                  <option value="custom">{contribution.fields.customLabel}</option>
                </select>
                {form.contribution === "custom" && (
                  <input
                    type="text"
                    aria-label="Your custom monthly contribution"
                    placeholder={contribution.fields.customPlaceholder}
                    value={form.customAmount}
                    onChange={e => setForm(p => ({ ...p, customAmount: e.target.value }))}
                    className="mt-3 w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                )}
              </div>

              {/* Why */}
              <div>
                <label htmlFor="letter-why" className="block text-sm font-medium text-foreground mb-2">
                  What called you to {villageName}? <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="letter-why"
                  required
                  value={form.why}
                  onChange={e => setForm(p => ({ ...p, why: e.target.value }))}
                  rows={4}
                  placeholder="Share what resonates for you, what you're hoping to co-create, and what gifts you'd bring to the village..."
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              {/* Acknowledgements */}
              <div className="space-y-4 pt-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.goodNeighbor}
                    onChange={e => setForm(p => ({ ...p, goodNeighbor: e.target.checked }))}
                    className="mt-1 h-4 w-4 flex-shrink-0 accent-teal-deep"
                  />
                  <span className="text-sm text-muted-foreground">
                    I have read and agree to the{" "}
                    <a href="/good-neighbor" className="text-primary underline" target="_blank">
                      {words.fields.standardsLabel}
                    </a>{" "}
                    and understand the community standards expected of all members. <span className="text-destructive">*</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.commitmentAck}
                    onChange={e => setForm(p => ({ ...p, commitmentAck: e.target.checked }))}
                    className="mt-1 h-4 w-4 flex-shrink-0 accent-teal-deep"
                  />
                  <span className="text-sm text-muted-foreground min-w-0 break-words">
                    {words.fields.ackLabel} <span className="text-destructive">*</span>
                  </span>
                </label>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <m.p
                    role="alert"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-xl"
                  >
                    {error}
                  </m.p>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-4 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-teal-deep-dark transition disabled:opacity-60 flex items-center justify-center gap-3"
              >
                {submitting ? (
                  <>
                    <m.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-5 h-5 flex-shrink-0 border-2 border-white/30 border-t-white rounded-full"
                    />
                    {user ? LETTER_WORDS.busy : "Signing your membership..."}
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 flex-shrink-0" />
                    <span className="min-w-0 break-words">{user ? LETTER_WORDS.button(villageName) : words.fields.submitLabel}</span>
                  </>
                )}
              </button>

              {user && (
                <p className="text-xs text-center text-muted-foreground">
                  {letterFailed && !letter ? LETTER_WORDS.unreadable : LETTER_WORDS.kept}
                </p>
              )}

              <p className="text-xs text-center text-muted-foreground">{footerNote}</p>
            </form>
          </m.div>
          )}
        </div>
      </section>
    </Layout>
  );
}
