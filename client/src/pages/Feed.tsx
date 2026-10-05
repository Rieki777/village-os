/**
 * The Village Feed (S27-S29): a LENS over one forum category plus the
 * village's own milestones — not a second content store. The heart button is
 * a REAL send from the tapper's cycle budget, through the same payment path
 * as every written acknowledgment.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { Calendar, Heart, Megaphone, MessageCircle, Sparkles, Send } from "lucide-react";
import { Image } from "@/components/Image";
import { ExampleChip, ExamplesBanner, forgetExamplesCache } from "@/components/ExamplesBanner";
import { ExampleRefusal, readRefusal } from "@/components/ExampleRefusal";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const SYSTEM_ICON: Record<string, React.ElementType> = {
  quest: Sparkles, stage: Sparkles, season: Calendar, cycle: Calendar, join: Sparkles,
};

export default function Feed() {
  const modules = useModules();
  const feedModule = useModule("feed");
  const introModule = useModule("introductions");
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  // The feed's own filters, and the page beyond the newest twenty.
  //
  // `?tag`, `?kind` and `?before` have been supported by the API since the
  // feed shipped, and the page never sent any of them: it was frozen at the
  // twenty most recent items, so the village's memory ended a few weeks back
  // and there was no way to read further. `items` accumulates across pages;
  // `nextBefore` is null once the server has nothing older.
  const [kind, setKind] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [more, setMore] = useState<string | null>(null);
  const [older, setOlder] = useState<any[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // The refusal, keyed to the post: the shared error slot lives in the
  // composer at the top of the page, so hearting the fifteenth post flashed
  // a line off-screen. Declared with the other state, ABOVE the early return
  // below: a hook after a conditional return changes the hook count between
  // renders the moment the module catalogue loads.
  const [refusedPost, setRefusedPost] = useState<{ id: string; message: string } | null>(null);

  const query = (before?: string) => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (tag.trim()) p.set("tag", tag.trim().toLowerCase());
    if (before) p.set("before", before);
    return p.toString() ? `/api/feed?${p}` : "/api/feed";
  };

  const load = () => {
    setOlder([]); // a changed filter starts a new list, not an appended one
    fetch(query(), { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); setMore(d?.nextBefore ?? null); })
      .catch(() => {});
  };
  const loadMore = () => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    fetch(query(more), { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setOlder((prev) => [...prev, ...(d?.items ?? [])]);
        setMore(d?.nextBefore ?? null);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };
  useEffect(() => { if (feedModule) load(); }, [feedModule?.id, kind, tag]);

  if (modules.loaded && !feedModule) return <ModuleGate moduleId="feed" name="Village Feed" />;

  const post = () => {
    setError("");
    fetch("/api/forum/threads", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ category: data?.categorySlug, kind: "post", body: draft }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "That didn't send. Try again.");
        setDraft("");
        // Drops the forum's label with it: the two are retired as a pair
        // server-side (RETIRE_TOGETHER), and the helper keeps that rule.
        forgetExamplesCache("feed");
        load();
      })
      .catch((e) => setError(e.message));
  };

  const heart = (item: any) => {
    setRefusedPost(null);
    fetch(`/api/feed/threads/${item.id}/heart`, { method: "POST", headers: headers(), body: "{}" })
      .then(async (r) => {
        const { ok, data: d, refusal } = await readRefusal(r);
        if (refusal) { setRefusedPost({ id: item.id, message: refusal }); return; }
        if (!ok) throw new Error(d?.message ?? d?.error ?? "That didn't send. Try again.");
        load();
      })
      .catch((e) => setError(e.message));
  };

  return (
    <Layout>
      <section className="py-6 md:py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Village Feed</h1>
          {/* R47: the line a reader acts on first, the Lore line last and quiet. */}
          <p className="text-muted-foreground">
            Tap a heart to thank someone. Each one is a real gift from your
            sending budget.
          </p>
          <p className="text-sm italic text-muted-foreground mt-1">
            Everyday life, woven with the village's milestones.
          </p>
          {/* Introductions is where a member says what they are looking for and
              is matched with someone who has it, and the feed is where they are
              already reading. Gated: the module ships off and its page 404s. */}
          {introModule && (
            <p className="text-sm text-muted-foreground mt-2">
              Looking for someone in particular? Say so in{" "}
              <Link href="/introductions" className="text-teal-deep font-medium hover:underline">Introductions</Link>.
            </p>
          )}
          <ExamplesBanner moduleId="feed" noun="post" />
        </div>
      </section>
      <section className="py-4 md:py-8 bg-background">
        <div className="container max-w-xl space-y-4">
          {user && data && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                placeholder="Share a moment… mention people with @handle."
                className="w-full text-sm border border-border rounded-lg px-3 py-2" />
              <div className="flex items-center justify-between">
                {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : <span />}
                <button onClick={post} disabled={!draft.trim()}
                  className="inline-flex items-center gap-1.5 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                  <Send className="w-3.5 h-3.5" /> Post
                </button>
              </div>
            </div>
          )}

          {/* The filters the API always understood and the page never sent. */}
          {data && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {[
                { v: "", label: "Everything" },
                { v: "post", label: "Posts" },
                { v: "system", label: "Village happenings" },
              ].map((f) => (
                <button
                  key={f.v || "all"}
                  onClick={() => setKind(f.v)}
                  aria-pressed={kind === f.v}
                  className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
                    kind === f.v
                      ? "bg-teal-deep text-white border-teal-deep"
                      : "bg-white text-muted-foreground border-border hover:border-teal-deep/40"
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="filter by tag"
                aria-label="Filter the feed by tag"
                className="text-xs border border-border rounded-full px-3 py-1.5 w-36"
              />
            </div>
          )}

          {[...(data?.items ?? []), ...older].map((item: any) => {
            if (item.itemType === "system") {
              const Icon = SYSTEM_ICON[item.kind] ?? Sparkles;
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground">
                  <Icon className="w-4 h-4 text-teal-deep/60 shrink-0" />
                  <span>{item.body}</span>
                </div>
              );
            }
            return (
              <div key={item.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">{item.author.name}</span>
                  {item.author.handle && <span>@{item.author.handle}</span>}
                  {/* The lens is category-wide, so the forum's example threads
                      appear here too. Once one of the pair has retired the hero
                      banner is gone and the row's own flag is all that is left
                      to say what the card is. */}
                  {item.isExample && <ExampleChip />}
                  {item.kind === "announcement" && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-amber/20 text-amber-700 px-1.5 py-0.5 rounded-full">
                      <Megaphone className="w-3 h-3" /> announcement
                    </span>
                  )}
                  {item.kind === "event" && item.meta?.startsAt && (
                    <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full">
                      {new Date(item.meta.startsAt).toLocaleDateString()}
                    </span>
                  )}
                  {/* toLocaleString() prints "7/31/2026, 1:32:55 AM": seconds nobody needs,
                      59px of it, and the widest thing on the card. It was the whole
                      reason /feed panned 53px sideways at 320. /forum renders the same
                      posts as a date alone, so this now matches it. */}
                  <span className="ml-auto shrink-0">{new Date(item.at).toLocaleDateString()}</span>
                </div>
                {item.title && <p className="font-semibold text-foreground text-sm mb-1">{item.title}</p>}
                <p className="text-sm text-foreground whitespace-pre-wrap">{item.body}</p>
                {item.imageUrl && <Image src={item.imageUrl} alt={item.title || "Photo attached to this post"} ratio={16 / 9} className="rounded-lg mt-2" />}
                {/* The tags a card carries. The filter above has always
                    accepted a tag and no card ever showed one, so the only way
                    to use it was to guess a word. Tapping a chip fills the
                    filter, which the effect above already watches. */}
                {/* The chip a thumb aims at is 44px tall; the chip an eye
                    reads is the same 19px pill it always was, centred inside
                    it. Measured before: the tag row's own 19px boxes left
                    three of them with a 39 to 40px hit area, because the 44px
                    overlay the global rule adds was being clipped by the row
                    above. */}
                {(item.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-x-1.5 mt-1">
                    {item.tags.map((t: string) => (
                      <button
                        key={t}
                        onClick={() => setTag(t)}
                        aria-label={`Show only posts tagged ${t}`}
                        className="inline-flex items-center min-h-[44px]"
                      >
                        <span className="text-[10px] bg-muted text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-full">
                          #{t}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Tap targets clear WCAG 2.5.8's 24px floor: a heart sends a
                    REAL gift from the sender's budget, so a thumb that misses
                    by 4px is not a cosmetic problem. Negative margin keeps the
                    row's visual rhythm while the hit area grows. */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => !item.heartedByMe && user && heart(item)}
                    disabled={item.heartedByMe || !user}
                    title={item.heartedByMe ? "Already sent" : `Sends ${data?.heartAmount ?? 1} recognition from your budget`}
                    aria-label={`${item.heartCount} recognition, ${item.heartedByMe ? "already sent" : "send one"}`}
                    className={`inline-flex items-center gap-1.5 text-sm min-h-[44px] px-2 -mx-2 ${item.heartedByMe ? "text-rose-500" : "text-muted-foreground hover:text-rose-500"} disabled:cursor-default`}
                  >
                    <Heart className={`w-4 h-4 ${item.heartedByMe ? "fill-rose-500" : ""}`} />
                    {item.heartCount}
                  </button>
                  <Link
                    href={`/forum/${item.id}`}
                    aria-label={`${item.replyCount} replies, open the thread`}
                    className="inline-flex items-center gap-1.5 text-sm min-h-[44px] px-2 text-muted-foreground hover:text-foreground"
                  >
                    <MessageCircle className="w-4 h-4" /> {item.replyCount}
                  </Link>
                </div>
                {refusedPost && refusedPost.id === item.id && (
                  <ExampleRefusal message={refusedPost.message} className="mt-2" />
                )}
              </div>
            );
          })}
          {data && data.items.length === 0 && older.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">
              {/* "Share the first moment" is an instruction, and the composer
                  it points at renders on `user` alone (above). A signed-out
                  reader was being told to use a control that is not on their
                  page. The fact is true for everybody; the instruction is
                  only offered to the reader who has the box to type in. This
                  is the shape Network.tsx already uses for its peers list. */}
              {kind || tag
                ? "Nothing matches that filter. Clear it to see more."
                : user
                  ? "No posts yet. Share the first moment."
                  : "No posts yet."}
            </p>
          )}
          {more && (
            <div className="pt-2 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm text-teal-deep border border-border rounded-lg px-4 py-2 hover:bg-teal-deep/5 disabled:opacity-40"
              >
                {loadingMore ? "Looking further back…" : "Show older"}
              </button>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
