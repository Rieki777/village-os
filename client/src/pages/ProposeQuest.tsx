import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Lightbulb, ArrowLeft, CheckCircle2, Sparkles, MessageCircle, ClipboardList, Inbox } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchConfigCached } from "@/lib/gameApi";
import { useTokenNameFor } from "@/hooks/useTokenNameFor";
import GuideChat from "@/components/GuideChat";
import { useGuideName } from "@/hooks/useGuideName";
import { sendProposal, assistantAvailable } from "@/lib/proposals";
import type { IdeaHold, IdeaReceipt } from "@shared/questIdeas";

interface QuestProposal {
  title: string;
  name: string;
  email: string;
  whatYouWantToDo: string;
  resourcesBringing: string;
  resourcesNeeded: string;
  compensation: string;
  timelineMilestones: string;
}

const EMPTY: QuestProposal = {
  title: "", name: "", email: "", whatYouWantToDo: "",
  resourcesBringing: "", resourcesNeeded: "", compensation: "", timelineMilestones: "",
};

/** A receipt that says the idea was held in the inbox. */
type Held = Extract<IdeaReceipt, { queued: false }>;

/**
 * WHY A HELD IDEA IS HELD, and what its sender can do about it.
 *
 * An idea past an allowance, or carrying an email address, is stored in the
 * team's inbox and never reaches the review queue (server/lib/publicForms.ts).
 * This page used to say "Your Quest idea is in." for those too, so a person
 * waited on a queue their idea was never in. Keyed by the server's own union,
 * so a hold-back added there without words here is a compile error.
 */
const HELD_WHY: Record<IdeaHold, (held: Held, team: string) => string> = {
  over_allowance: (h, team) =>
    h.member
      ? `You already have ${h.allowance ?? "several"} Quest ideas waiting for a steward, which is as many as one person can have in the review queue at once. When a steward decides on one of yours, send this one again.`
      : `${h.allowance ?? "Several"} ideas from visitors are already waiting for a steward, which is as many as the review queue holds from people who are not signed in. If you have an account with ${team}, sign in and send it again. Otherwise, try again in a few days.`,
  contained_an_email: () =>
    "Its words carry an email address. A Quest can end up on the public board, so an idea with an address in it stays out of the review queue. Take the address out of the title and your answers, and send it again. The Email field is fine: only the team reads it.",
  empty_payload: () =>
    "It arrived with nothing to title it by. Add a title, or a first line saying what you want to do, and send it again.",
  identifier_too_long: (_h, team) =>
    `It could not be filed for review. Send it again, and if the same thing happens, tell the ${team} team through the contact form.`,
  not_filed: () => "The review queue could not take it just now. Send it again in a little while.",
};

export default function ProposeQuest() {
  const { user } = useAuth();
  // The example compensation names the village's pay tokens, never the
  // recognition token: Gratitude never pays work (Rye, 2026-11-01: "Gratitude
  // ONLY for the recognition token and NOT for the credit or earned equity
  // tokens"). Registry names by slug, so a village's rename reaches it.
  const creditsName = useTokenNameFor("credits", "Credits");
  const equityName = useTokenNameFor("earned-equity", "Equity");
  /*
   * A generic stand-in until /api/game/config answers, and on a village that
   * has not named itself yet. This read "Amora" on every instance, so the
   * platform's first tenant's name was what every founder's page showed on
   * first paint, whatever they had called their own village. The word is
   * chosen for the sentences that interpolate it, which already carry their
   * own article: "the {projectName} team will reach out".
   *
   * S3 pages lane: a previous pass fixed only the loading-state flash. Three
   * PERMANENT sentences still shipped the literal, and unlike a flash they
   * were what a founder's member read after the config had landed: the
   * confirmation screen shown once a proposal is accepted, the label on the
   * "what do you need" field, and the fine print under the submit button.
   */
  const [projectName, setProjectName] = useState("village");
  // The guide's name is the village's own (workWithUs.assistantName), and an
  // unnamed guide reads "the village guide" (shared/guideName.ts).
  const guide = useGuideName();
  const assistantName = guide.name;
  const [aiAvailable, setAiAvailable] = useState(false);
  const [mode, setMode] = useState<"ai" | "form">("form");
  const [form, setForm] = useState<QuestProposal>({
    ...EMPTY,
    name: user?.name ?? "",
    email: user?.email ?? "",
  });
  const [hp, setHp] = useState(""); // honeypot: real people never fill this
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Where the idea went, as the server said. Null reads as queued: an older server says nothing.
  const [idea, setIdea] = useState<IdeaReceipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchConfigCached().then((c) => { if (c?.project?.name) setProjectName(c.project.name); });
    assistantAvailable().then((ok) => { setAiAvailable(ok); if (ok) setMode("ai"); });
  }, []);

  // Prefill for a signed-in member, without clobbering anything they've typed.
  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.name || "", email: f.email || user.email || "" }));
  }, [user]);

  const set = (k: keyof QuestProposal, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || !form.whatYouWantToDo.trim()) {
      setError("Add your name, email, and what you'd like to do.");
      return;
    }
    setSubmitting(true);
    const answer = await sendProposal("quest-proposal", form, hp);
    setSubmitting(false);
    if (answer.ok) {
      setIdea(answer.idea);
      setSubmitted(true);
    } else setError("That didn't send. Try again.");
  };

  if (submitted && idea && !idea.queued) {
    return (
      <Layout>
        <section className="py-24 bg-gradient-to-b from-teal/10 to-background min-h-[60vh]">
          <div className="container">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl mx-auto text-center bg-card border border-border rounded-2xl p-10 shadow-sm"
            >
              <div className="w-16 h-16 rounded-full bg-amber/15 flex items-center justify-center mx-auto mb-6">
                <Inbox className="w-8 h-8 text-amber-600" aria-hidden="true" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                Your Quest idea is saved, and held back from review.
              </h1>
              <p className="text-muted-foreground mb-3">
                It is in the {projectName} team's inbox. It is not in the queue a steward reads to put
                Quests on the board.
              </p>
              <p className="text-foreground mb-8">{HELD_WHY[idea.held](idea, projectName)}</p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => {
                    setIdea(null);
                    setSubmitted(false);
                    setMode("form");
                  }}
                  className="px-5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition"
                >
                  Change it and send again
                </button>
                <Link href="/quests">
                  <a className="px-5 py-3 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors">
                    Back to the Quest Board
                  </a>
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </Layout>
    );
  }

  if (submitted) {
    return (
      <Layout>
        <section className="py-24 bg-gradient-to-b from-teal/10 to-background min-h-[60vh]">
          <div className="container">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xl mx-auto text-center bg-card border border-teal/20 rounded-2xl p-10 shadow-sm"
            >
              <div className="w-16 h-16 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8 text-teal-700" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                Your Quest idea is in.
              </h1>
              <p className="text-muted-foreground mb-8">
                Thank you for bringing your gift. The {projectName} team will reach out
                to explore it with you. Every Quest starts as someone caring enough to
                imagine it.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/quests">
                  <a className="px-5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition">
                    Back to the Quest Board
                  </a>
                </Link>
                <button
                  onClick={() => {
                    setForm((p) => ({
                      ...p,
                      title: "",
                      whatYouWantToDo: "",
                      resourcesBringing: "",
                      resourcesNeeded: "",
                      compensation: "",
                      timelineMilestones: "",
                    }));
                    setSubmitted(false);
                  }}
                  className="px-5 py-3 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors"
                >
                  Propose another
                </button>
              </div>
            </motion.div>
          </div>
        </section>
      </Layout>
    );
  }

  const field =
    "w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <Layout>
      {/* Hero */}
      <section className="py-16 bg-gradient-to-b from-teal/10 to-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto text-center"
          >
            <Link href="/quests">
              <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
                <ArrowLeft className="w-4 h-4" />
                Back to the Quest Board
              </a>
            </Link>
            <div className="w-16 h-16 rounded-full bg-amber/15 flex items-center justify-center mx-auto mb-6">
              <Lightbulb className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              Propose a Quest
            </h1>
            <p className="text-xl text-muted-foreground">
              Tell us about the Quest you want to create. Anyone can propose one, and
              the {projectName} team will reach out to explore it with you.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Talk it through, or fill it in yourself */}
      {aiAvailable && guide.loaded && (
        <div className="bg-background">
          <div className="container max-w-2xl mx-auto flex flex-wrap gap-2 pb-6">
            <button
              onClick={() => setMode("ai")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === "ai" ? "bg-teal-deep text-white" : "bg-card border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <MessageCircle className="w-4 h-4" /> Talk it through with {assistantName}
            </button>
            <button
              onClick={() => setMode("form")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === "form" ? "bg-teal-deep text-white" : "bg-card border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <ClipboardList className="w-4 h-4" /> Fill the form yourself
            </button>
          </div>
        </div>
      )}

      {mode === "ai" && aiAvailable && guide.loaded && (
        <section className="pb-24 bg-background">
          <div className="container max-w-2xl mx-auto">
            <GuideChat
              kind="quest-proposal"
              projectName={projectName}
              assistantName={assistantName}
              empty={EMPTY}
              onSubmitted={(receipt, sent) => {
                // A held idea comes back into the form, so it can be changed and sent again.
                if (receipt && !receipt.queued) setForm((f) => ({ ...EMPTY, ...f, ...sent }));
                setIdea(receipt);
                setSubmitted(true);
              }}
              onFallback={() => { setAiAvailable(false); setMode("form"); }}
              onRefineInForm={(p) => { setForm({ ...EMPTY, ...form, ...p }); setMode("form"); }}
            />
          </div>
        </section>
      )}

      {/* Form */}
      <section className={`pb-24 bg-background ${mode === "ai" && aiAvailable ? "hidden" : ""}`}>
        <div className="container">
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="max-w-2xl mx-auto bg-card border border-border rounded-2xl shadow-sm p-6 md:p-8 space-y-6"
          >
            {/* Honeypot — visually hidden */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="hidden"
              aria-hidden="true"
            />

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="quest-name" className="block text-sm font-medium text-foreground mb-2">
                  Your name <span className="text-destructive">*</span>
                </label>
                <input
                  id="quest-name"
                  autoComplete="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Your full name"
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="quest-email" className="block text-sm font-medium text-foreground mb-2">
                  Email <span className="text-destructive">*</span>
                </label>
                <input
                  id="quest-email"
                  autoComplete="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="your@email.com"
                  className={field}
                />
              </div>
            </div>

            <div>
              <label htmlFor="quest-title" className="block text-sm font-medium text-foreground mb-2">
                Quest title <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="quest-title"
                type="text"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Give your idea a short name"
                className={field}
              />
            </div>

            <div>
              <label htmlFor="quest-what" className="block text-sm font-medium text-foreground mb-2">
                What do you want to do? <span className="text-destructive">*</span>
              </label>
              <textarea
                id="quest-what"
                required
                rows={4}
                value={form.whatYouWantToDo}
                onChange={(e) => set("whatYouWantToDo", e.target.value)}
                placeholder="Describe the Quest: what you'd create, and what it brings to the village."
                className={`${field} resize-y`}
              />
            </div>

            <div>
              <label htmlFor="quest-bringing" className="block text-sm font-medium text-foreground mb-2">
                What resources are you bringing?
              </label>
              <textarea
                id="quest-bringing"
                rows={3}
                value={form.resourcesBringing}
                onChange={(e) => set("resourcesBringing", e.target.value)}
                placeholder="Your skills, time, tools, materials, funding, relationships…"
                className={`${field} resize-y`}
              />
            </div>

            <div>
              <label htmlFor="quest-needed" className="block text-sm font-medium text-foreground mb-2">
                What do you need from {projectName}?
              </label>
              <textarea
                id="quest-needed"
                rows={3}
                value={form.resourcesNeeded}
                onChange={(e) => set("resourcesNeeded", e.target.value)}
                placeholder="Land access, materials, budget, people, introductions, space…"
                className={`${field} resize-y`}
              />
            </div>

            <div>
              <label htmlFor="quest-compensation" className="block text-sm font-medium text-foreground mb-2">
                What compensation, if any, do you want?
              </label>
              <textarea
                id="quest-compensation"
                rows={2}
                value={form.compensation}
                onChange={(e) => set("compensation", e.target.value)}
                placeholder={`${creditsName}, ${equityName}, cash, revenue share, a joint venture, or nothing. It's a gift, totally up to you.`}
                className={`${field} resize-y`}
              />
            </div>

            <div>
              <label htmlFor="quest-timeline" className="block text-sm font-medium text-foreground mb-2">
                Timeline &amp; payment milestones, if any
              </label>
              <textarea
                id="quest-timeline"
                rows={3}
                value={form.timelineMilestones}
                onChange={(e) => set("timelineMilestones", e.target.value)}
                placeholder="Rough phases, dates, and any milestone-based payments you'd propose."
                className={`${field} resize-y`}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition disabled:opacity-50"
            >
              <Sparkles className="w-5 h-5" />
              {submitting ? "Sending…" : "Send your Quest proposal"}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              Your proposal goes straight to the {projectName} team. No idea is too small. The
              village is built from them.
            </p>
          </motion.form>
        </div>
      </section>
    </Layout>
  );
}
