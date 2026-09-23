import Layout from "@/components/Layout";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, CheckCircle2, ArrowRight, Users, Home, TrendingUp, Sparkles, Send } from "lucide-react";
import { useState } from "react";
import { authToken, useVillageLinks } from "@/lib/gameApi";
import { useVillageContent } from "@/hooks/useVillageContent";
import { useVillageName } from "@/hooks/useVillageName";
import { useTokenName } from "@/hooks/useTokenNames";

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
 * wording, preserved as data in server/seeds/brochure-legal-seed.json, not
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
 * wording is preserved as data in server/seeds/pages-covenant-seed.json and
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

// The covenant names the village in one line, so the list is built after
// the config answers rather than frozen at module load.
const buildCommitments = (villageName: string) => [
  "Treat all beings with respect, compassion, and authentic communication",
  "Participate in community governance through our sociocratic circles",
  "Contribute to the regeneration of the land and ecosystem",
  "Support fellow community members in their growth and wellbeing",
  `Honor the values and agreements of the ${villageName} community`,
  "Practice Nonviolent Communication and authentic relating",
  "Meet financial obligations as agreed with the community",
  "Show up for community life, circles, celebrations, and shared care",
];

const pathOptions = [
  { id: "investor", label: "Investor / Capital Contributor", icon: TrendingUp, color: "border-amber text-amber" },
  { id: "steward", label: "Village Steward / Co-Creator", icon: Users, color: "border-sage text-sage" },
  { id: "resident", label: "Resident / Future Villager", icon: Home, color: "border-teal text-teal" },
  { id: "prosperity", label: "Prosperity Creator / Business Builder", icon: Sparkles, color: "border-teal-light text-teal-light" },
];

export default function LoveLetter() {
  const { content: legal } = useVillageContent<LegalContent>("legal");
  const { content: covenant } = useVillageContent<CovenantContent>("covenant");
  const villageName = useVillageName();
  const tokenName = useTokenName("recognition");
  const commitments = buildCommitments(villageName);
  const membership = legal?.membership;
  // The village's own name alone when no entity is published: a name, not a
  // legal claim. Everywhere this file used to say "Amora 508(c)(1)(a)".
  // S3 pages lane: the fallback was the literal "Amora", so a founder who
  // had never published a legal entity signed their members into somebody
  // else's church on the line that collects their money.
  const entityName = membership?.entityLabel?.trim() || villageName;
  const contributionParagraph = membership?.contributionParagraph?.trim();
  const contributionShortNote = membership?.contributionShortNote?.trim();
  const footerNote =
    membership?.footerNote?.trim() ||
    "Ask your community how membership contributions are structured, and whether any part is tax-deductible where you live.";

  // Neither fallback states a fact about any particular place or plan. They
  // say the same thing the originals said, minus the parts only Amora knew.
  const openingParagraph =
    covenant?.opening?.trim() ||
    "Something in you called you here. Maybe it was the land itself, alive with possibility. Maybe it was the vision of a village where all beings belong and thrive. Maybe it was simply the feeling that the world you want to live in needs to be built.";
  const governanceParagraph =
    covenant?.governance?.trim() ||
    "How residents govern themselves, and how we steward this land together, will be co-created by the first residents. Nothing here is handed down. You are not joining a finished system; you are helping write it.";

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
            name: form.name,
            email: form.email,
            phone: form.phone,
            paths: form.paths,
            why: form.why,
            monthlyContribution: form.contribution === "custom" ? `custom: ${form.customAmount}` : form.contribution,
            acknowledgedGoodNeighbor: form.goodNeighbor,
            acknowledgedCommitments: form.commitmentAck,
            signedAt: new Date().toISOString(),
          },
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(`Something went wrong. Please try again${emailFallback}.`);
      }
    } catch {
      setError(`Could not connect. Please try again${emailFallback}.`);
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <Layout>
        <section className="py-24 bg-background">
          <div className="container max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <motion.div
                className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-8"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Heart className="w-12 h-12 text-primary" fill="currentColor" />
              </motion.div>
              <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-6">
                Welcome to the {villageName} Family
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed mb-8">
                Your membership form has been received. You are now part of the {entityName} community.
              </p>
              <div className="bg-card border border-primary/20 rounded-2xl p-8 mb-8 text-left">
                <h2 className="font-display text-2xl font-bold text-foreground mb-4">What happens next</h2>
                <div className="space-y-4 text-muted-foreground">
                  <div className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <p>You'll receive a welcome email from the {villageName} team within 48 hours with your membership details.</p>
                  </div>
                  <div className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <p>We'll schedule a personal welcome call to learn more about your vision and which path calls to you most.</p>
                  </div>
                  <div className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <p>You'll be invited to your first Community Circle and introduced to the founding community.</p>
                  </div>
                </div>
              </div>
              <p className="text-lg font-accent text-primary italic mb-8">
                "You are not just joining a place. You are becoming part of something alive."
              </p>
              <a
                href="/"
                className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-full font-semibold hover:bg-teal-deep-dark transition"
              >
                Return Home
                <ArrowRight className="w-5 h-5" />
              </a>
            </motion.div>
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
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Heart className="w-8 h-8 text-primary" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              The {villageName} Love Letter
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Our founding covenant, and your official membership in {entityName}.
              Read. Reflect. Sign.
            </p>
          </motion.div>

          {/* The Letter */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card p-8 md:p-12 rounded-2xl shadow-lg font-accent text-lg leading-relaxed mb-10 border border-border"
          >
            <p className="mb-6 text-foreground">Dear Future {villageName} Family Member,</p>

            <p className="mb-6 text-muted-foreground">{openingParagraph}</p>

            <p className="mb-6 text-muted-foreground">
              By signing this Love Letter, you are not just joining a community. You are becoming a
              co-creator of the most beautiful village we can imagine together. You are saying yes to
              regeneration, of the land, of community, of yourself.
            </p>

            <p className="mb-4 text-foreground font-semibold">As a member of {entityName}, you commit to:</p>

            <ul className="space-y-3 mb-8">
              {commitments.map((commitment, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Heart className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <span className="text-muted-foreground">{commitment}</span>
                </li>
              ))}
            </ul>

            <p className="mb-6 text-muted-foreground">
              In return, you become a full member of {entityName}, gaining access
              to community spaces, governance participation, {tokenName} economy, and the opportunity to
              deepen your involvement through roles, residency, or business creation.
            </p>

            <p className="mb-6 text-muted-foreground">{governanceParagraph}</p>

            {contributionParagraph && (
              <p className="mb-6 text-muted-foreground">{contributionParagraph}</p>
            )}

            <p className="text-foreground font-semibold italic">
              With love and anticipation,<br />
              <span className="font-display text-xl not-italic">The {villageName} Community</span>
            </p>
          </motion.div>

          {/* Membership Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12"
          >
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-2">
              Sign Your Membership
            </h2>
            <p className="text-muted-foreground mb-8">
              Fill in your details below to officially join the {villageName} Family and become a member of {entityName}.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Name + Email */}
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
                  {pathOptions.map(path => (
                    <button
                      key={path.id}
                      type="button"
                      onClick={() => togglePath(path.id)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        form.paths.includes(path.id)
                          ? `${path.color} bg-primary/5`
                          : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      <path.icon className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm font-medium">{path.label}</span>
                      {form.paths.includes(path.id) && (
                        <CheckCircle2 className="w-4 h-4 ml-auto flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monthly contribution */}
              <div>
                <label htmlFor="letter-contribution" className="block text-sm font-medium text-foreground mb-2">
                  Monthly Membership Contribution
                </label>
                <p className="text-sm text-muted-foreground mb-3">
                  {contributionShortNote ? `${contributionShortNote} ` : ""}Suggested: $33-$108/month.
                </p>
                <select
                  id="letter-contribution"
                  value={form.contribution}
                  onChange={e => setForm(p => ({ ...p, contribution: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select contribution level</option>
                  <option value="33">$33/month, Seed level</option>
                  <option value="55">$55/month, Sprout level</option>
                  <option value="88">$88/month, Grove level</option>
                  <option value="108">$108/month, Forest level</option>
                  <option value="custom">I'd like to discuss a custom amount</option>
                </select>
                {form.contribution === "custom" && (
                  <input
                    type="text"
                    aria-label="Your custom monthly contribution"
                    placeholder="Tell us what works for you (e.g. $20/month, in-kind, barter)"
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
                      Good Neighbor Criteria
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
                  <span className="text-sm text-muted-foreground">
                    I have read the Love Letter above and commit to the values and agreements of the {villageName} community as a member of {entityName}. <span className="text-destructive">*</span>
                  </span>
                </label>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.p
                    role="alert"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-xl"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-teal-deep-dark transition disabled:opacity-60 flex items-center justify-center gap-3"
              >
                {submitting ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                    Signing your membership...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Sign the Love Letter &amp; Join the {villageName} Family
                  </>
                )}
              </button>

              <p className="text-xs text-center text-muted-foreground">{footerNote}</p>
            </form>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
