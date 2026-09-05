import Layout from "@/components/Layout";
import { useVillageName } from "@/hooks/useVillageName";
import { useEffect, useState } from "react";
import {
  MapPin,
  Calendar,
  Clock,
  DollarSign,
  ArrowRight,
  Plane,
  Home as HomeIcon,
  Backpack,
} from "lucide-react";

interface VisitType {
  id: string;
  title: string;
  duration: string;
  format: string;
  cost: string;
  description: string;
  cta_label: string;
  cta_url: string;
  order: number;
}

interface VisitConfig {
  hero_subtitle: string;
  visit_types: VisitType[];
  logistics: {
    getting_there: string;
    accommodation: string;
    what_to_bring: string;
    contact_note: string;
  };
}

export default function Visit() {
  // The hero subtitle is village-set; this is only the sentence shown
  // before one is set, so it names the village rather than a village.
  const villageName = useVillageName("this village");
  const [cfg, setCfg] = useState<VisitConfig | null>(null);
  const [form, setForm] = useState({ name: "", email: "", visitType: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cfgFailed, setCfgFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // A swallowed failure is why this section could sit on "Loading..." with no
    // end: `cfg` stayed null, and null is also the first-paint state, so the
    // page could not tell "not here yet" from "never coming". Measured at 14s
    // with the request failing, still Loading, while the form below kept
    // working, so the page read as half-built rather than as broken.
    fetch("/api/visit-config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { if (alive) { setCfg(data); setCfgFailed(false); } })
      .catch(() => { if (alive) setCfgFailed(true); });
    return () => { alive = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "visit-inquiry", data: form }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please email the team directly.");
    }
    setSubmitting(false);
  };

  return (
    <Layout>
      <section className="bg-teal-band text-white py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-3">
            <MapPin className="w-6 h-6 text-amber-on-band" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase">
              Plan a Visit
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">
            Come and See for Yourself
          </h1>
          <p className="text-white/80 text-lg max-w-3xl leading-relaxed">
            {cfg?.hero_subtitle ?? `Experience the land, meet the people, and decide if ${villageName} is where you belong.`}
          </p>
        </div>
      </section>

      <section className="bg-stone-50 py-20">
        <div className="container max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              Three Ways to Connect
            </h2>
          </div>
          {!cfg && cfgFailed ? (
            <div className="text-center text-stone-600">
              The ways to visit could not be loaded just now. Reload to try again, or use the form below and we will write back.
            </div>
          ) : !cfg ? (
            <div className="text-center text-stone-500">Loading...</div>
          ) : (
            <div className="grid md:grid-cols-3 gap-5">
              {[...cfg.visit_types].sort((a, b) => a.order - b.order).map((v) => (
                <div key={v.id} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 flex flex-col">
                  <h3 className="font-display text-xl font-semibold text-teal-deep mb-3">{v.title}</h3>
                  <div className="space-y-1.5 text-sm text-stone-600 mb-4">
                    <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-stone-400" /> {v.duration}</p>
                    <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-stone-400" /> {v.format}</p>
                    <p className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-stone-400" /> {v.cost}</p>
                  </div>
                  <p className="text-sm text-stone-600 leading-relaxed mb-5 flex-1">{v.description}</p>
                  {v.cta_url ? (
                    <a
                      href={v.cta_url}
                      target={v.cta_url.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 bg-teal-deep text-white font-medium px-4 py-2.5 rounded-xl hover:bg-teal transition-colors"
                    >
                      {v.cta_label || "Learn More"} <ArrowRight className="w-4 h-4" />
                    </a>
                  ) : (
                    <a
                      href="#visit-form"
                      className="inline-flex items-center justify-center gap-2 bg-stone-100 text-teal-deep font-medium px-4 py-2.5 rounded-xl hover:bg-stone-200 transition-colors"
                    >
                      Contact Team <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">Logistics</h2>
          </div>
          {cfg && (
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { Icon: Plane, title: "Getting There", body: cfg.logistics.getting_there },
                { Icon: HomeIcon, title: "Accommodation", body: cfg.logistics.accommodation },
                { Icon: Backpack, title: "What to Bring", body: cfg.logistics.what_to_bring },
              ].map((l) => {
                const Icon = l.Icon;
                return (
                  <div key={l.title} className="bg-stone-50 rounded-2xl border border-stone-200 p-5">
                    <div className="w-10 h-10 rounded-xl bg-teal-deep/10 text-teal-deep flex items-center justify-center mb-3">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-display text-lg font-semibold text-teal-deep mb-2">{l.title}</h3>
                    <p className="text-sm text-stone-600 leading-relaxed">{l.body}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section id="visit-form" className="bg-sage/15 py-20">
        <div className="container max-w-2xl mx-auto px-4">
          <div className="text-center mb-8">
            <Calendar className="w-8 h-8 text-teal-deep mx-auto mb-3" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">Tell Us You're Coming</h2>
            <p className="text-stone-600">{cfg?.logistics.contact_note ?? "Fill in the form below or email the team."}</p>
          </div>
          {submitted ? (
            <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
              <p className="text-teal-deep font-display text-xl mb-2">Thank you.</p>
              <p className="text-stone-600">We'll be in touch within 48 hours to coordinate.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  {/* htmlFor on all four. These fields carry no placeholder
                      either, so an unlinked label left them with nothing at
                      all to announce. */}
                  <label htmlFor="visit-name" className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Name</label>
                  <input
                    id="visit-name"
                    type="text"
                    autoComplete="name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                  />
                </div>
                <div>
                  <label htmlFor="visit-email" className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Email</label>
                  <input
                    id="visit-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="visit-type" className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Visit Type</label>
                <select
                  id="visit-type"
                  value={form.visitType}
                  onChange={(e) => setForm({ ...form, visitType: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep bg-white"
                >
                  <option value="">Choose one</option>
                  {cfg?.visit_types?.map((v) => (
                    <option key={v.id} value={v.id}>{v.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="visit-message" className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Anything we should know?</label>
                <textarea
                  id="visit-message"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep resize-y"
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-teal-deep text-white font-semibold py-3 rounded-xl hover:bg-teal disabled:opacity-50 transition-colors"
              >
                {submitting ? "Sending..." : "Send Request"}
              </button>
            </form>
          )}
        </div>
      </section>
    </Layout>
  );
}
