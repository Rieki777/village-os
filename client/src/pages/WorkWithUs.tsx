import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { fetchConfigCached } from "@/lib/gameApi";
import { readStoredJson, removeStored, writeStoredJson } from "@/lib/safeStorage";
import { useAuth } from "@/contexts/AuthContext";
import GuideChat from "@/components/GuideChat";
import { submitProposal } from "@/lib/proposals";
import {
  Handshake,
  MessageCircle,
  ClipboardList,
  CheckCircle2,
  ArrowRight,
  Paperclip,
  X,
} from "lucide-react";

// ── Shared proposal shape ────────────────────────────────────────────────────

interface Proposal {
  name: string;
  email: string;
  phone: string;
  background: string;
  work: string;
  serves: string;
  materialsCost: string;
  timeToImplement: string;
  needsFromUs: string;
  maintenance: string;
  reciprocity: string[];
  reciprocityDetail: string;
  attachment: string;
  attachmentName: string;
}

interface ReciprocityOption { value: string; title: string; desc: string }
interface WwuConfig {
  intro: string;
  assistantName: string;
  assistantGreeting: string;
  reciprocityOptions: ReciprocityOption[];
}

const EMPTY: Proposal = {
  name: "", email: "", phone: "", background: "",
  work: "", serves: "", materialsCost: "", timeToImplement: "",
  needsFromUs: "", maintenance: "", reciprocity: [], reciprocityDetail: "",
  attachment: "", attachmentName: "",
};

const PROPOSAL_FIELDS: { key: keyof Proposal; label: string; hint: string; required: boolean; rows?: number }[] = [
  { key: "work", label: "The work", hint: "Describe what you're proposing, in plain terms. What is it?", required: true, rows: 3 },
  { key: "serves", label: "How it serves the community", hint: "How would this serve the community, the land, the guests, the ecosystem, or the mission?", required: true, rows: 3 },
  { key: "materialsCost", label: "Cost of materials", hint: "What materials, supplies, or inputs are required, and what do they cost? Note anything the village may already have.", required: true, rows: 3 },
  { key: "timeToImplement", label: "Time to implement", hint: "How long from approval to completion? Note any phases, seasonality, or dependencies.", required: true, rows: 2 },
  { key: "needsFromUs", label: "What you'd need from us", hint: "Information or access, decisions and by when, meeting time, site access, utilities, equipment, or labor.", required: true, rows: 3 },
  { key: "maintenance", label: "Maintenance & longevity", hint: "What keeps it alive and well? Ongoing care, who's responsible, cost over time, expected lifespan.", required: true, rows: 3 },
];

const RECIPROCITY_FALLBACK: ReciprocityOption[] = [
  { value: "Financial - Cash", title: "Financial: Cash", desc: "A direct payment for your work, materials, or service: upfront, on milestones, or on completion." },
  { value: "Tokens", title: "Tokens", desc: "Value held within the community ecosystem, credit you can use at the café and across the village." },
  { value: "Joint Venture", title: "Joint Venture", desc: "You operate autonomously, and the community holds a share, e.g. 10% of revenue in exchange for rent or water infrastructure." },
  { value: "Memorandum of Understanding", title: "Memorandum of Understanding", desc: "A clear, living exchange of contribution, e.g. you grow vegetables, share some harvest, and add to the beauty of the land." },
];


// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkWithUs() {
  const { user } = useAuth();
  /*
   * A generic stand-in until /api/game/config answers, and on a village that
   * has not named itself yet. This read "Amora" on every instance, so the
   * platform's first tenant's name was what every founder's page showed on
   * first paint, whatever they had called their own village.
   */
  const [projectName, setProjectName] = useState("this village");
  /* Four of the five sentences below put the name mid-sentence and two start
   * with it, and a real village name is already capitalised, so this is a
   * no-op for every named village and grammar for the stand-in. */
  const projectNameSentenceStart = projectName.charAt(0).toUpperCase() + projectName.slice(1);
  const [wwu, setWwu] = useState<WwuConfig | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"ai" | "form">("form");
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<Proposal>(EMPTY);

  useEffect(() => {
    fetchConfigCached().then((c) => { if (c?.project?.name) setProjectName(c.project.name); });
    fetch("/api/work-with-us-config").then((r) => r.json()).then(setWwu).catch(() => { /* fallback copy */ });
    fetch("/api/assistant/status")
      .then((r) => r.json())
      .then((d) => { setAiAvailable(!!d.available); setMode(d.available ? "ai" : "form"); })
      .catch(() => { setAiAvailable(false); setMode("form"); });
    // restore a saved form draft
    const saved = readStoredJson("local", "amora-work-with-us-draft");
    if (saved.status === "value" && saved.value && typeof saved.value === "object") {
      setForm({ ...EMPTY, ...(saved.value as Partial<Proposal>) });
    }
  }, []);

  // Prefill name/email for a signed-in member (only if they haven't typed yet).
  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.name || "", email: f.email || user.email || "" }));
  }, [user]);

  const reciprocityOptions = wwu?.reciprocityOptions?.length ? wwu.reciprocityOptions : RECIPROCITY_FALLBACK;
  const assistantName = wwu?.assistantName || "Maia";

  const saveDraft = (next: Proposal) => {
    setForm(next);
    writeStoredJson("local", "amora-work-with-us-draft", next);
  };

  const onSubmitted = () => {
    setSubmitted(true);
    removeStored("local", "amora-work-with-us-draft");
  };

  if (submitted) {
    return (
      <Layout>
        <section className="bg-teal-band text-white py-24">
          <div className="container max-w-2xl mx-auto px-4 text-center">
            <CheckCircle2 className="w-14 h-14 text-amber-on-band mx-auto mb-6" />
            <h1 className="font-display text-4xl font-bold mb-4">Your proposal is with us</h1>
            <p className="text-white/80 text-lg">
              Thank you for offering your gifts to {projectName}. We review every proposal with care.
              Please allow up to a month for a thoughtful response, and room for conversation and revision.
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="bg-teal-band text-white py-16">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-3">
            <Handshake className="w-6 h-6 text-amber-on-band" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase">Work With Us</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">
            Build and grow alongside {projectName}
          </h1>
          <p className="text-white/80 text-lg max-w-2xl leading-relaxed">
            {wwu?.intro ??
              `${projectNameSentenceStart} grows through the people who bring their gifts to it. We welcome ideas, offerings, and ventures: a garden, a piece of infrastructure, a service, a craft, a program, or something we haven't yet imagined. Propose it here.`}
          </p>
        </div>
      </section>

      {/* Mode toggle */}
      <div className="bg-stone-50 border-b border-stone-200">
        <div className="container max-w-3xl mx-auto px-4 flex gap-2 py-3">
          {aiAvailable && (
            <button
              onClick={() => setMode("ai")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === "ai" ? "bg-teal-deep text-white" : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
              }`}
            >
              <MessageCircle className="w-4 h-4" /> Talk it through with {assistantName}
            </button>
          )}
          <button
            onClick={() => setMode("form")}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              mode === "form" ? "bg-teal-deep text-white" : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
            }`}
          >
            <ClipboardList className="w-4 h-4" /> Fill the form yourself
          </button>
        </div>
      </div>

      <section className="bg-stone-50 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          {mode === "ai" && aiAvailable ? (
            <GuideChat
              kind="work-with-us"
              projectName={projectName}
              assistantName={assistantName}
              greeting={wwu?.assistantGreeting}
              empty={EMPTY}
              onSubmitted={onSubmitted}
              onFallback={() => { setAiAvailable(false); setMode("form"); }}
              onRefineInForm={(p) => { saveDraft({ ...EMPTY, ...form, ...p }); setMode("form"); }}
            />
          ) : (
            /* ProposalForm's one use of the name opens a sentence with it. */
            <ProposalForm projectName={projectNameSentenceStart} reciprocityOptions={reciprocityOptions} form={form} setForm={saveDraft} onSubmitted={onSubmitted} />
          )}
        </div>
      </section>

      <p className="text-center text-xs text-stone-400 max-w-2xl mx-auto px-4 pb-12">
        This form is an invitation to propose and does not constitute an offer, agreement, or commitment.
        Any partnership is subject to mutual agreement and formal terms.
      </p>
    </Layout>
  );
}

// ── The structured form ──────────────────────────────────────────────────────

function ProposalForm({
  projectName, reciprocityOptions, form, setForm, onSubmitted,
}: {
  projectName: string;
  reciprocityOptions: ReciprocityOption[];
  form: Proposal;
  setForm: (p: Proposal) => void;
  onSubmitted: () => void;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hp, setHp] = useState(""); // honeypot: real people never fill this
  const [uploading, setUploading] = useState(false);

  const set = (key: keyof Proposal, value: any) => setForm({ ...form, [key]: value });
  const toggleRecip = (v: string) =>
    set("reciprocity", form.reciprocity.includes(v) ? form.reciprocity.filter((x) => x !== v) : [...form.reciprocity, v]);

  const uploadAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/work-with-us/attachment", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? data.error ?? "Could not attach that file.");
      else setForm({ ...form, attachment: data.filename, attachmentName: data.originalName || file.name });
    } catch {
      setError("Could not attach that file.");
    }
    setUploading(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setError("Your name and email are needed so we know who we're speaking with."); return; }
    for (const f of PROPOSAL_FIELDS) if (f.required && !String(form[f.key]).trim()) { setError(`Please answer: ${f.label}.`); return; }
    if (form.reciprocity.length === 0) { setError("Choose at least one form of reciprocity that fits."); return; }
    setError("");
    setSubmitting(true);
    const ok = await submitProposal("work-with-us", form, hp);
    setSubmitting(false);
    if (ok) onSubmitted(); else setError("Something went wrong sending your proposal. Please try again.");
  };

  // The field key doubles as the control's id, so the label this helper
  // already renders is tied to the textarea it already renders. Six of these
  // go on the page and every one of them reached a screen reader unnamed.
  const field = (key: keyof Proposal, label: string, hint: string, required: boolean, rows = 3) => (
    <div>
      <label htmlFor={`work-${String(key)}`} className="block text-sm font-semibold text-foreground mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      <textarea
        id={`work-${String(key)}`}
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value)}
        rows={rows}
        className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep resize-y"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:p-8 space-y-8">
      {/* About you */}
      <div>
        <h2 className="font-display text-xl font-bold text-teal-deep mb-1">About you</h2>
        <p className="text-sm text-muted-foreground mb-4">So we know who we're speaking with.</p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="work-name" className="block text-sm font-semibold text-foreground mb-1">Name <span className="text-red-500">*</span></label>
            <input id="work-name" autoComplete="name" type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep" />
          </div>
          <div>
            <label htmlFor="work-email" className="block text-sm font-semibold text-foreground mb-1">Email <span className="text-red-500">*</span></label>
            <input id="work-email" autoComplete="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep" />
          </div>
          <div>
            <label htmlFor="work-phone" className="block text-sm font-semibold text-foreground mb-1">Phone / WhatsApp</label>
            <input id="work-phone" autoComplete="tel" type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep" />
          </div>
          <div>
            <label htmlFor="work-background" className="block text-sm font-semibold text-foreground mb-1">What you do / where you're based</label>
            <input id="work-background" type="text" value={form.background} onChange={(e) => set("background", e.target.value)} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep" />
          </div>
        </div>
      </div>

      {/* The idea */}
      <div>
        <h2 className="font-display text-xl font-bold text-teal-deep mb-1">Your proposal</h2>
        <p className="text-sm text-muted-foreground mb-4">Tell us about your idea. Specificity is a gift to both of us.</p>
        <div className="space-y-5">
          {PROPOSAL_FIELDS.map((f) => (
            <div key={f.key}>{field(f.key, f.label, f.hint, f.required, f.rows)}</div>
          ))}
        </div>
      </div>

      {/* Reciprocity */}
      <div>
        <h2 className="font-display text-xl font-bold text-teal-deep mb-1">The exchange</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {projectName} is built on reciprocity, and there's more than one way to be valued here. Select any that fit. <span className="text-red-500">*</span>
        </p>
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {reciprocityOptions.map((o) => {
            const on = form.reciprocity.includes(o.value);
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => toggleRecip(o.value)}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  on ? "border-teal-deep bg-teal-deep/5" : "border-stone-200 hover:bg-stone-50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? "bg-teal-deep border-teal-deep" : "border-stone-300"}`}>
                    {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                  <span className="font-semibold text-teal-deep text-sm">{o.title}</span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">{o.desc}</p>
              </button>
            );
          })}
        </div>
        <label htmlFor="work-reciprocity" className="block text-sm font-semibold text-foreground mb-1">Tell us more about the exchange you're proposing</label>
        <p className="text-xs text-muted-foreground mb-2">Amounts, structure, percentages, a blend, or something we haven't listed.</p>
        <textarea id="work-reciprocity" value={form.reciprocityDetail} onChange={(e) => set("reciprocityDetail", e.target.value)} rows={3} className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg outline-none focus:border-teal-deep resize-y" />
      </div>

      {/* Optional attachment */}
      <div>
        <h2 className="font-display text-xl font-bold text-teal-deep mb-1">Bring a picture (optional)</h2>
        <p className="text-sm text-muted-foreground mb-3">A sketch, a photo, or a one-pager helps us see it. Image or PDF, up to 10MB.</p>
        {form.attachment ? (
          <div className="inline-flex items-center gap-2 bg-teal-deep/5 border border-teal-deep/20 rounded-lg px-3 py-2 text-sm text-teal-deep">
            <Paperclip className="w-4 h-4" /> {form.attachmentName || "Attached"}
            <button type="button" onClick={() => setForm({ ...form, attachment: "", attachmentName: "" })} className="text-stone-400 hover:text-red-500 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:-m-3">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 cursor-pointer bg-white border border-stone-200 rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">
            <Paperclip className="w-4 h-4" /> {uploading ? "Attaching…" : "Attach a file"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => uploadAttachment(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      {/* Honeypot — hidden from people, tempting to bots */}
      <input
        type="text"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="w-full md:w-auto inline-flex items-center justify-center gap-2 bg-teal-deep text-white font-semibold px-8 py-3 rounded-xl hover:bg-teal disabled:opacity-50 transition-colors">
        {submitting ? "Sending…" : "Submit proposal"} <ArrowRight className="w-4 h-4" />
      </button>
      <p className="text-xs text-stone-400">Your answers save as you go, so you can come back and finish later.</p>
    </form>
  );
}
