import Layout from "@/components/Layout";
import { useVillageName } from "@/hooks/useVillageName";
import { usePageContent } from "@/hooks/usePageContent";
import { VISIT_PAGE } from "@shared/pageContent/visit";
import { useEffect, useState } from "react";
import {
  MapPin,
  Calendar,
  Clock,
  Wallet,
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
  // The headline and the after-sending line are the village's own, from
  // Admin, Pages, Visit (shared/pageContent/visit.ts). Null until they arrive.
  const page = usePageContent(VISIT_PAGE);
  const headline = page?.hero.fields.headline;
  const thanks = page?.form.fields.thanks ?? "";
  /*
   * A CLEARED SENTENCE HIDES ITS PARAGRAPH. These read `cfg?.x ?? fallback`,
   * which keeps an empty string, so a founder who cleared the subtitle or the
   * contact note in Visit Program got an empty paragraph with its margin and
   * no words. The fallback still covers the moment before the program loads
   * (and a program saved before the key existed); a blank the village saved
   * draws nothing.
   */
  const subtitle = (cfg?.hero_subtitle ?? `Experience the land, meet the people, and decide if ${villageName} is where you belong.`).trim();
  const contactNote = (cfg?.logistics?.contact_note ?? "Fill in the form below or email the team.").trim();

  /*
   * A PROGRAMME WITH NOTHING IN IT DRAWS NO HEADING. The platform's starter
   * programme ships with no logistics (where the land is, where to sleep and
   * what to bring are one village's facts), and a village may list no ways
   * to visit. "Logistics" or "Pick a way to visit" over an empty grid reads as
   * a page that failed to load, so each section waits for something to show;
   * the form below still takes a visit request either way.
   */
  const visitTypes = Array.isArray(cfg?.visit_types) ? [...cfg.visit_types].sort((a, b) => a.order - b.order) : [];
  const logistics = cfg
    ? [
        { Icon: Plane, title: "Getting there", body: cfg.logistics?.getting_there },
        { Icon: HomeIcon, title: "Accommodation", body: cfg.logistics?.accommodation },
        { Icon: Backpack, title: "What to bring", body: cfg.logistics?.what_to_bring },
      ].filter((l) => String(l.body ?? "").trim())
    : [];

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
      setError("That didn't go through. Try again, or email the team.");
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
              Plan a visit
            </span>
          </div>
          {/* A village's own longer headline steps down a size on a phone:
              at its 48-character limit it ran five lines deep at 320px. */}
          <h1 className={`font-display ${Array.from(headline ?? "").length > 32 ? "text-3xl" : "text-4xl"} md:text-5xl font-bold mb-4 break-words${headline ? "" : " invisible"}`}>
            {headline || "\u00a0"}
          </h1>
          {subtitle && (
            <p className="text-white text-lg max-w-3xl leading-relaxed break-words">
              {subtitle}
            </p>
          )}
        </div>
      </section>

      {!(cfg && visitTypes.length === 0) && (
      <section className="bg-stone-50 py-20">
        <div className="container max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              Pick a way to visit
            </h2>
          </div>
          {!cfg && cfgFailed ? (
            <div className="text-center text-stone-600">
              The ways to visit didn't load. Reload to try again, or use the form below.
            </div>
          ) : !cfg ? (
            <div className="text-center text-stone-500">Opening the ways to visit…</div>
          ) : (
            // Fewer than three cards sit centred at their own width, so the
            // starter programme's two do not leave a hole on the right.
            <div className={`grid gap-5 ${visitTypes.length >= 3 ? "md:grid-cols-3" : visitTypes.length === 2 ? "md:grid-cols-2 max-w-3xl mx-auto" : "max-w-md mx-auto"}`}>
              {visitTypes.map((v) => (
                <div key={v.id} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 flex flex-col">
                  {v.title?.trim() && <h3 className="font-display text-xl font-semibold text-teal-deep mb-3">{v.title}</h3>}
                  {/* The cost line carried a dollar sign beside every village's
                      price, whatever its currency, and beside "Free". The
                      wallet says "what it costs" in no currency at all. A
                      line the program left blank draws no icon on its own. */}
                  <div className="space-y-1.5 text-sm text-stone-600 mb-4">
                    {v.duration?.trim() && <p className="flex items-center gap-2"><Clock className="w-4 h-4 shrink-0 text-stone-400" /> {v.duration}</p>}
                    {v.format?.trim() && <p className="flex items-center gap-2"><MapPin className="w-4 h-4 shrink-0 text-stone-400" /> {v.format}</p>}
                    {v.cost?.trim() && <p className="flex items-center gap-2"><Wallet className="w-4 h-4 shrink-0 text-stone-400" /> {v.cost}</p>}
                  </div>
                  {/* A cleared description draws no empty paragraph; the space
                      it held still pushes the button to the card's foot. */}
                  {v.description?.trim() ? (
                    <p className="text-sm text-stone-600 leading-relaxed mb-5 flex-1">{v.description}</p>
                  ) : (
                    <div className="flex-1" />
                  )}
                  {v.cta_url ? (
                    <a
                      href={v.cta_url}
                      target={v.cta_url.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 bg-teal-deep text-white font-medium px-4 py-2.5 rounded-xl hover:bg-teal-deep-dark transition-colors"
                    >
                      {v.cta_label || "Learn more"} <ArrowRight className="w-4 h-4" />
                    </a>
                  ) : (
                    /* No link of its own: the button leads to the form below,
                       under the label the village wrote for it. It used to
                       say "Contact the team" whatever the label said, so all
                       three seeded cards (blank links, own labels) read the
                       same and the labels never showed. */
                    <a
                      href="#visit-form"
                      className="inline-flex items-center justify-center gap-2 bg-stone-100 text-teal-deep font-medium px-4 py-2.5 rounded-xl hover:bg-stone-200 transition-colors"
                    >
                      {v.cta_label?.trim() || "Contact the team"} <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {logistics.length > 0 && (
      <section className="bg-white py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">Logistics</h2>
          </div>
            <div className={`grid gap-4 ${logistics.length >= 3 ? "md:grid-cols-3" : logistics.length === 2 ? "md:grid-cols-2 max-w-3xl mx-auto" : "max-w-md mx-auto"}`}>
              {logistics.map((l) => {
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
        </div>
      </section>
      )}

      <section id="visit-form" className="bg-sage/15 py-20">
        <div className="container max-w-2xl mx-auto px-4">
          <div className="text-center mb-8">
            <Calendar className="w-8 h-8 text-teal-deep mx-auto mb-3" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">Tell us you're coming</h2>
            {contactNote && <p className="text-stone-600">{contactNote}</p>}
          </div>
          {submitted ? (
            <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
              <p className="text-teal-deep font-display text-xl mb-2">Thank you.</p>
              {thanks.trim() && <p className="text-stone-600 break-words">{thanks}</p>}
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
              {visitTypes.length > 0 && (
              <div>
                <label htmlFor="visit-type" className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">Visit type</label>
                <select
                  id="visit-type"
                  value={form.visitType}
                  onChange={(e) => setForm({ ...form, visitType: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep bg-white"
                >
                  <option value="">Choose one</option>
                  {visitTypes.map((v) => (
                    <option key={v.id} value={v.id}>{v.title}</option>
                  ))}
                </select>
              </div>
              )}
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
                className="w-full bg-teal-deep text-white font-semibold py-3 rounded-xl hover:bg-teal-deep-dark disabled:opacity-50 transition-colors"
              >
                {submitting ? "Sending…" : "Send request"}
              </button>
            </form>
          )}
        </div>
      </section>
    </Layout>
  );
}
