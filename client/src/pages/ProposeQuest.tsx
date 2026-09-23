import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Lightbulb, ArrowLeft, CheckCircle2, Sparkles, MessageCircle, ClipboardList } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchConfigCached } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import GuideChat from "@/components/GuideChat";
import { submitProposal, assistantAvailable } from "@/lib/proposals";

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

export default function ProposeQuest() {
  const { user } = useAuth();
  const tokenName = useTokenName("Recognition");
  /*
   * A generic stand-in until /api/game/config answers, and on a village that
   * has not named itself yet. This read "Amora" on every instance, so the
   * platform's first tenant's name was what every founder's page showed on
   * first paint, whatever they had called their own village. The word is
   * chosen for the sentences that interpolate it, which already carry their
   * own article: "It moves to the {projectName} team".
   *
   * S3 pages lane: a previous pass fixed only the loading-state flash. Three
   * PERMANENT sentences still shipped the literal, and unlike a flash they
   * were what a founder's member read after the config had landed: the
   * confirmation screen shown once a proposal is accepted, the label on the
   * "what do you need" field, and the fine print under the submit button.
   */
  const [projectName, setProjectName] = useState("village");
  // LANE Q: the guide's name is a per-deployment persona set in the Setup
  // Wizard, and this page hardcoded "Maia" in two places. A fork that renamed
  // its guide had the button and the chat header calling her by the platform's
  // first tenant's name. WorkWithUs.tsx already reads it from this document.
  const [assistantName, setAssistantName] = useState("Maia");
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
  const [error, setError] = useState("");

  useEffect(() => {
    fetchConfigCached().then((c) => { if (c?.project?.name) setProjectName(c.project.name); });
    assistantAvailable().then((ok) => { setAiAvailable(ok); if (ok) setMode("ai"); });
    fetch("/api/work-with-us-config")
      .then((r) => r.json())
      .then((w) => { if (w?.assistantName) setAssistantName(w.assistantName); })
      .catch(() => { /* the default stands */ });
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
      setError("Please share your name, email, and what you'd like to do.");
      return;
    }
    setSubmitting(true);
    const ok = await submitProposal("quest-proposal", form, hp);
    setSubmitting(false);
    if (ok) setSubmitted(true);
    else setError("Something went wrong sending your proposal. Please try again.");
  };

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
                Your quest idea is in.
              </h1>
              <p className="text-muted-foreground mb-8">
                Thank you for bringing your gift. The {projectName} team will review your
                proposal and reach out to explore it with you. Every quest starts as
                someone caring enough to imagine it.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/quests">
                  <a className="px-5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition">
                    Back to Quests
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
                  Propose Another
                </button>
              </div>
            </motion.div>
          </div>
        </section>
      </Layout>
    );
  }

  const field =
    "w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

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
                Back to Quests
              </a>
            </Link>
            <div className="w-16 h-16 rounded-full bg-amber/15 flex items-center justify-center mx-auto mb-6">
              <Lightbulb className="w-8 h-8 text-amber-600" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              Propose a Quest
            </h1>
            <p className="text-xl text-muted-foreground">
              This is for everyone with an idea to bring value to the community. Tell
              us what you want to create. It moves to the {projectName} team as a
              proposal, and we'll reach out to explore it with you.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Talk it through, or fill it in yourself */}
      {aiAvailable && (
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

      {mode === "ai" && aiAvailable && (
        <section className="pb-24 bg-background">
          <div className="container max-w-2xl mx-auto">
            <GuideChat
              kind="quest-proposal"
              projectName={projectName}
              assistantName={assistantName}
              empty={EMPTY}
              onSubmitted={() => setSubmitted(true)}
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
                placeholder="Describe the quest: what you'd create, and the value it brings to the village."
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
                placeholder={`${tokenName} only, cash, revenue share, a joint venture, or nothing. It's a gift, totally up to you.`}
                className={`${field} resize-y`}
              />
            </div>

            <div>
              <label htmlFor="quest-timeline" className="block text-sm font-medium text-foreground mb-2">
                Execution timeline &amp; payment milestones, if any
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
              {submitting ? "Sending…" : "Submit Your Quest Proposal"}
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
