/**
 * The Forum (S24-S26): threads by category, @mentions on handles, thread
 * follows, community reporting, and the decision primitive. Bodies render as
 * TEXT (React escapes) — there is no HTML pipeline to sanitize.
 */
import Layout from "@/components/Layout";
import BylineChips from "@/components/badges/BylineChips";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { Calendar, ExternalLink, Flag, Gavel, Lock, MapPin, MessageCircle, Pin, Plus, Bell } from "lucide-react";
import { Image } from "@/components/Image";
import { ExampleChip, ExamplesBanner, forgetExamplesCache } from "@/components/ExamplesBanner";
import { ExampleRefusal, readRefusal } from "@/components/ExampleRefusal";
import { toast } from "sonner";
import { REPORT_FAILED, reportFeedback } from "@/lib/reportFeedback";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const KIND_BADGE: Record<string, string> = {
  decision: "bg-purple-50 text-purple-700 border border-purple-200",
  event: "bg-sky-50 text-sky-700 border border-sky-200",
  announcement: "bg-amber/20 text-amber-700",
};

export default function Forum() {
  const [, params] = useRoute("/forum/:id");
  const modules = useModules();
  const forumModule = useModule("forum");
  if (modules.loaded && !forumModule) return <ModuleGate moduleId="forum" name="Forum & Decisions" />;
  return params?.id ? <ThreadView id={params.id} /> : <ThreadList />;
}

function ThreadList() {
  const { user } = useAuth();
  const feedModule = useModule("feed");
  const [categories, setCategories] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", category: "", kind: "discussion" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    const qs = category ? `?category=${category}` : "";
    fetch(`/api/forum/threads${qs}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setThreads(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/forum/categories", { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCategories(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);
  useEffect(load, [category]);

  // The in-flight guard the reply and decide buttons already had. Without it
  // an impatient second click on a slow network started a second thread, and
  // the author had no way to tell which of the two the village would answer.
  const post = () => {
    if (busy) return;
    setError("");
    setBusy(true);
    fetch("/api/forum/threads", { method: "POST", headers: headers(), body: JSON.stringify(draft) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not post");
        setComposing(false);
        setDraft({ title: "", body: "", category: "", kind: "discussion" });
        // The server has just retired this module's examples; drop the label
        // now rather than leaving it over the member's own new thread. The
        // feed goes with it (RETIRE_TOGETHER), which the helper knows.
        forgetExamplesCache("forum");
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Layout>
      <section className="py-6 md:py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Village Forum</h1>
          <p className="text-muted-foreground">Conversations, questions, and the decisions we make together.</p>
          {/* The feed is the other lens over this same table (RETIRES_WITH in
              ExamplesBanner says so), and it had one door in the whole client.
              Gated: the feed module ships off and its page 404s until a village
              turns it on. */}
          {feedModule && (
            <p className="text-sm text-muted-foreground mt-2">
              For the day to day of it, open the{" "}
              <Link href="/feed" className="text-teal-deep font-medium hover:underline">Village Feed</Link>.
            </p>
          )}
          <ExamplesBanner moduleId="forum" noun="thread" />
        </div>
      </section>
      <section className="py-4 md:py-8 bg-background">
        <div className="container max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setCategory("")}
              className={`text-xs px-3 py-1.5 rounded-full ${!category ? "bg-teal-deep text-white" : "bg-muted text-muted-foreground"}`}>
              All
            </button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className={`text-xs px-3 py-1.5 rounded-full ${category === c.id ? "bg-teal-deep text-white" : "bg-muted text-muted-foreground"}`}>
                {c.label}
              </button>
            ))}
            {user && (
              <button onClick={() => setComposing(!composing)}
                className="ml-auto inline-flex items-center gap-1.5 text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium">
                <Plus className="w-4 h-4" /> New thread
              </button>
            )}
          </div>

          {composing && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <div className="flex gap-2">
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="text-sm border border-border rounded-lg px-2 py-2 bg-white">
                  <option value="">Category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  className="text-sm border border-border rounded-lg px-2 py-2 bg-white">
                  <option value="discussion">Discussion</option>
                  <option value="decision">Decision (proposal)</option>
                  <option value="event">Event</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Title" className="w-full text-sm border border-border rounded-lg px-3 py-2" />
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4}
                placeholder="Say it. Mention people with @handle."
                className="w-full text-sm border border-border rounded-lg px-3 py-2" />
              {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
              <button onClick={post} disabled={busy || !draft.body.trim() || !draft.category}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {threads.map((t) => (
              <Link key={t.id} href={`/forum/${t.id}`}
                className={`block bg-card border border-border rounded-xl px-4 py-3 hover:border-teal/40 transition-colors ${t.hidden ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2">
                  {t.pinned && <Pin className="w-3.5 h-3.5 text-amber-600" />}
                  {t.locked && <Lock className="w-3.5 h-3.5 text-gray-400" />}
                  <span className="font-semibold text-foreground text-sm">{t.title}</span>
                  {/* Per row, not only in the hero banner: the forum and the
                      feed share this table and this category, the "All" tab
                      sends no category at all, and the two retire together but
                      the banner above names one module. A row that says it is
                      an example is the only marker that cannot go stale. */}
                  {t.isExample && <ExampleChip />}
                  {KIND_BADGE[t.kind] && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${KIND_BADGE[t.kind]}`}>{t.kind}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span>{t.author.name}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{t.replyCount}</span>
                  <span>{new Date(t.lastActivityAt).toLocaleDateString()}</span>
                  {t.eventStartsAt && (
                    <span className="inline-flex items-center gap-1 text-teal-deep font-medium">
                      <Calendar className="w-3 h-3" />
                      {new Date(t.eventStartsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {threads.length === 0 && (
              /* "Start the first one" points at the New thread button, which
                 renders on `user` above. A signed-out reader was being sent
                 to a control that is not on their page, so they get the fact
                 and nothing else. */
              <p className="text-center text-sm text-muted-foreground py-12">
                {user ? "No threads yet. Start the first one." : "No threads yet."}
              </p>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}

function ThreadView({ id }: { id: string }) {
  const { user } = useAuth();
  const [thread, setThread] = useState<any>(null);
  const [gone, setGone] = useState(false);
  // 410 had a state and nothing else did, so every other way the fetch could
  // come back empty landed on the same `thread === null` as the first paint and
  // the page said "Loading..." forever. A 404 from an old link held it there for
  // as long as anyone was willing to wait.
  const [miss, setMiss] = useState<"" | "notfound" | "failed">("");
  const [reply, setReply] = useState("");
  const [outcome, setOutcome] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // F1: which post is open for editing ("thread" or a reply id), and its
  // working text. One at a time — an editor open on six posts at once is
  // how someone saves the wrong one.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Which reply the composer is answering. The POST route has always accepted
  // parentReplyId and the page never sent it, so no member could answer one
  // another: the only nested replies in existence came from the seed.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/forum/threads/${id}`, { headers: headers() })
      .then(async (r) => {
        if (r.status === 410) { setGone(true); return null; }
        if (r.status === 404) { setMiss("notfound"); return null; }
        if (!r.ok) { setMiss("failed"); return null; }
        return r.json();
      })
      .then((d) => { if (d) { setThread(d); setMiss(""); } })
      .catch(() => setMiss("failed"));
  };
  useEffect(load, [id]);

  // Replies arrive flat and time-ordered, each carrying the one it answers.
  // Drawn as a single column, an answer to the first reply sat below the
  // twentieth and read as an unrelated remark.
  //
  // Three ways a reply could otherwise disappear, all handled: a parent
  // hidden from this viewer is filtered out server-side, so its visible
  // children point at an id that is not here and come back to the root; the
  // walk descends only from the root, so any reply a loop made unreachable
  // is appended afterwards; and depth is clamped for the indent alone,
  // because the server puts no limit on how deep a chain runs.
  const threaded = useMemo(() => {
    const all: any[] = thread?.replies ?? [];
    const present = new Set(all.map((r) => r.id));
    const kids = new Map<string, any[]>();
    for (const r of all) {
      const parent = r.parentReplyId && r.parentReplyId !== r.id && present.has(r.parentReplyId) ? r.parentReplyId : "";
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent)!.push(r);
    }
    const out: { r: any; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      for (const r of kids.get(parent) ?? []) {
        out.push({ r, depth });
        walk(r.id, depth + 1);
      }
    };
    walk("", 0);
    if (out.length < all.length) {
      const shown = new Set(out.map((x) => x.r.id));
      for (const r of all) if (!shown.has(r.id)) out.push({ r, depth: 0 });
    }
    return out;
  }, [thread]);

  // In-flight guard: without it an impatient double-tap posts the reply
  // twice, or races the decision primitive's record-once gate into a
  // confusing 409. One action at a time per thread view.
  // A refusal renders beside the control that was pressed. The shared status
  // slot at the foot of the page is teal and also says "Done.", so a refusal
  // landing there read as a confirmation several screens from the button.
  const [refusal, setRefusal] = useState<{ where: string; message: string } | null>(null);

  const act = (path: string, body: any, where = "actions") => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setRefusal(null);
    fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) })
      .then(async (r) => {
        const { ok, data: d, refusal: refused } = await readRefusal(r);
        if (refused) { setRefusal({ where, message: refused }); return; }
        if (!ok) throw new Error(d?.message ?? d?.error ?? "Failed");
        setStatus("Done.");
        setReply("");
        setReplyingTo(null);
        setOutcome("");
        load();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  /**
   * Reporting does not go through act().
   *
   * act() prints "Done." into the shared status slot at the FOOT of the
   * thread, which on a long thread is several screens from the flag the
   * member pressed, and "Done." says nothing about what a report sets in
   * motion. A report is the one action here where the whole value to the
   * member is knowing it landed and that somebody will come back to them.
   * The example refusal keeps its inline slot, since that one belongs beside
   * the control that was refused.
   */
  const report = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setRefusal(null);
    try {
      const r = await fetch(`/api/forum/threads/${id}/report`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ severity: "soft" }),
      });
      const { ok, data, refusal: refused } = await readRefusal(r);
      if (refused) {
        setRefusal({ where: "actions", message: refused });
        return;
      }
      const said = reportFeedback({ ok, status: r.status, error: data?.message ?? data?.error ?? null });
      if (said.tone === "success") toast.success(said.message);
      else toast.error(said.message);
    } catch {
      toast.error(REPORT_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = (kind: "threads" | "replies", postId: string) => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    fetch(`/api/forum/${kind}/${postId}`, {
      method: "PATCH", headers: headers(), body: JSON.stringify({ body: draft }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not save that edit");
        setEditing(null);
        setDraft("");
        load();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  if (gone) {
    return (
      <Layout>
        <div className="container max-w-2xl py-24 text-center text-muted-foreground">
          This thread was hidden by moderation.
          <div className="mt-4"><Link href="/forum" className="text-teal-deep font-medium">← Back to the forum</Link></div>
        </div>
      </Layout>
    );
  }
  if (!thread && miss) {
    return (
      <Layout>
        <div className="container max-w-2xl py-24 text-center">
          <h1 className="font-display text-2xl font-bold text-foreground mb-3">
            {miss === "failed"
              ? "The forum could not be loaded just now."
              : "That conversation is not in the forum."}
          </h1>
          <p className="text-muted-foreground mb-8">
            {miss === "failed"
              ? "Reload to try again."
              : "It may have been removed, or the link may be old."}
          </p>
          <Link href="/forum" className="text-teal-deep font-medium">← Back to the forum</Link>
        </div>
      </Layout>
    );
  }
  if (!thread) return <Layout><div className="container py-24 text-center text-muted-foreground">Loading…</div></Layout>;

  const decided = thread.kind === "decision" && thread.meta?.status === "decided";
  // A thread opened by link or from the feed carried no label at all: the
  // only marker was on the list behind it, so the member learned this was an
  // example by pressing Reply and reading a refusal. The flag is read from
  // the ROW, because the module-level banner would otherwise sit over a real
  // thread whenever the module still has examples elsewhere — and `row` below
  // stops the module answer vetoing the row's own truth.
  const isExample = thread.isExample === true;
  // By SEEDED ID, never by kind. ex-feed-3 is seeded as an announcement, so a
  // kind === "post" test files a feed example under the forum: the wrong
  // trigger sentence, and no label at all once the forum alone has cleared.
  const isFeedRow = String(thread.id).startsWith("ex-feed-");
  const exampleModule = isFeedRow ? "feed" : "forum";
  const exampleNoun = isFeedRow ? "post" : "thread";
  // An event carries structure the body cannot: when, where, and how to say
  // you are coming. Render it the way decisions get their outcome card.
  const eventMeta = thread.kind === "event" && thread.meta?.startsAt ? thread.meta : null;
  const fmtWhen = (startsAt: string, endsAt?: string) => {
    const s = new Date(startsAt);
    const day = s.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return endsAt ? `${day}, ${t(s)} to ${t(new Date(endsAt))}` : `${day}, ${t(s)}`;
  };

  return (
    <Layout>
      <section className="py-10 bg-background">
        <div className="container max-w-3xl space-y-5">
          <Link href="/forum" className="text-xs text-muted-foreground hover:text-foreground">← All threads</Link>
          {isExample && <ExamplesBanner moduleId={exampleModule} noun={exampleNoun} row />}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
              {thread.pinnedAt && <Pin className="w-4 h-4 text-amber-600" />}
              {thread.lockedAt && <Lock className="w-4 h-4 text-gray-400" />}
              <h1 className="font-display text-xl font-bold text-foreground">{thread.title ?? "Post"}</h1>
              {KIND_BADGE[thread.kind] && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${KIND_BADGE[thread.kind]}`}>{thread.kind}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {thread.author.name}{thread.author.handle ? ` (@${thread.author.handle})` : ""}
              <BylineChips userId={thread.author.id} />
              {" · "}{new Date(thread.createdAt).toLocaleString()}
            </p>
            {thread.imageUrl && <Image src={thread.imageUrl} alt={thread.title} ratio={16 / 9} className="rounded-xl mb-4" />}
            {/* F1: edit your own words. The marker below is public and
                permanent — see the PATCH route's rule 2. */}
            {editing === "thread" ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit("threads", thread.id)}
                    disabled={!draft.trim()}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
                  >
                    Save edit
                  </button>
                  <button onClick={() => setEditing(null)} className="text-sm text-muted-foreground px-3">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap">{thread.body}</p>
            )}
            {thread.editedAt && !editing && (
              <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                edited {new Date(thread.editedAt).toLocaleString()}
              </p>
            )}
            {user?.id === thread.author.id && !thread.lockedAt && editing !== "thread" && (
              <button
                onClick={() => { setEditing("thread"); setDraft(thread.body); }}
                className="text-xs text-muted-foreground hover:text-teal-deep mt-2"
              >
                Edit
              </button>
            )}
            {(thread.tags ?? []).length > 0 && (
              <div className="flex gap-1.5 mt-3">
                {thread.tags.map((t: string) => (
                  <span key={t} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">#{t}</span>
                ))}
              </div>
            )}
            {decided && (
              <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">Decision recorded</p>
                <p className="text-sm text-purple-900 whitespace-pre-wrap">{thread.meta.outcome}</p>
              </div>
            )}
            {eventMeta && (
              <div className="mt-4 rounded-xl border border-teal/30 bg-teal/5 p-4 space-y-2">
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <Calendar className="w-4 h-4 text-teal-deep shrink-0" />
                  {fmtWhen(eventMeta.startsAt, eventMeta.endsAt)}
                </p>
                {eventMeta.location && (
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <MapPin className="w-4 h-4 text-teal-deep shrink-0" />
                    {eventMeta.location}
                  </p>
                )}
                {eventMeta.ctaUrl && (
                  <a
                    href={eventMeta.ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-1 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-teal-deep-dark"
                  >
                    {eventMeta.ctaLabel || "Respond"}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
            {/* Subscribe and report are guarded server-side, so on an example
                these controls exist only to be refused. Hiding them says the
                same thing without making the member press one to find out. */}
            {user && !isExample && (
              <div className="flex gap-3 mt-4 text-xs">
                <button onClick={() => act(`/api/forum/threads/${id}/subscribe`, {})} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Bell className="w-3.5 h-3.5" /> Follow
                </button>
                <button onClick={() => void report()} className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-500">
                  <Flag className="w-3.5 h-3.5" /> Report
                </button>
              </div>
            )}
            {refusal?.where === "actions" && <ExampleRefusal message={refusal.message} className="mt-3" />}
          </div>

          <div className="space-y-3">
            {threaded.map(({ r, depth }) => (
              <div
                key={r.id}
                style={{ marginLeft: Math.min(depth, 4) * 20 }}
                className={`bg-card border border-border rounded-xl px-4 py-3 ${r.hidden ? "opacity-50" : ""} ${depth > 0 ? "border-l-2 border-l-teal-deep/30" : ""}`}
              >
                <p className="text-xs text-muted-foreground mb-1">
                  {r.author.name}{r.author.handle ? ` (@${r.author.handle})` : ""}
                  <BylineChips userId={r.author.id} />
                  {" · "}{new Date(r.createdAt).toLocaleString()}
                </p>
                {editing === r.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit("replies", r.id)}
                        disabled={!draft.trim()}
                        className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
                      >
                        Save edit
                      </button>
                      <button onClick={() => setEditing(null)} className="text-sm text-muted-foreground px-2">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">{r.body}</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  {r.editedAt && (
                    <span className="text-[11px] text-muted-foreground italic">
                      edited {new Date(r.editedAt).toLocaleString()}
                    </span>
                  )}
                  {user?.id === r.author.id && !r.hidden && !thread.lockedAt && editing !== r.id && (
                    <button
                      onClick={() => { setEditing(r.id); setDraft(r.body); }}
                      className="text-xs text-muted-foreground hover:text-teal-deep"
                    >
                      Edit
                    </button>
                  )}
                  {user && !r.hidden && !thread.lockedAt && !isExample && (
                    <button
                      onClick={() => { setReplyingTo(replyingTo === r.id ? null : r.id); setReply(""); }}
                      className="text-xs text-muted-foreground hover:text-teal-deep"
                    >
                      {replyingTo === r.id ? "Cancel" : "Reply"}
                    </button>
                  )}
                </div>
                {replyingTo === r.id && (
                  <div className="mt-2 space-y-2 border-t border-border pt-2">
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                      placeholder={`Answering ${r.author.name}…`}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                    <button
                      onClick={() => act(`/api/forum/threads/${id}/replies`, { body: reply, parentReplyId: r.id }, "reply")}
                      disabled={busy || !reply.trim()}
                      className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
                    >
                      Reply
                    </button>
                    {refusal?.where === "reply" && <ExampleRefusal message={refusal.message} />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* One composer at a time: this and the inline one share `reply`,
              so both on screen would mirror each other's typing. */}
          {user && !thread.lockedAt && !isExample && !replyingTo && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
                placeholder="Reply… mention people with @handle."
                className="w-full text-sm border border-border rounded-lg px-3 py-2" />
              <button onClick={() => act(`/api/forum/threads/${id}/replies`, { body: reply }, "reply")} disabled={busy || !reply.trim()}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                Reply
              </button>
              {refusal?.where === "reply" && <ExampleRefusal message={refusal.message} />}
            </div>
          )}
          {thread.lockedAt && !decided && (
            <p className="text-center text-xs text-muted-foreground">This thread is locked.</p>
          )}

          {user && thread.kind === "decision" && !decided && !isExample && (
            <div className="bg-card border border-purple-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-purple-700 flex items-center gap-1.5"><Gavel className="w-3.5 h-3.5" /> Record the outcome</p>
              <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2}
                placeholder="What was decided, and by what process?"
                className="w-full text-sm border border-border rounded-lg px-3 py-2" />
              <button onClick={() => act(`/api/forum/threads/${id}/decide`, { outcome }, "decide")} disabled={busy || !outcome.trim()}
                className="text-sm bg-purple-700 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                Record decision
              </button>
              {refusal?.where === "decide" && <ExampleRefusal message={refusal.message} />}
            </div>
          )}

          {status && <p className="text-xs text-teal-deep">{status}</p>}
        </div>
      </section>
    </Layout>
  );
}

