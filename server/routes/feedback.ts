/**
 * The feedback domain (S66): what a member reports, and what the village does
 * with it.
 *
 *   GET  /api/feedback/config        what the form must disclose before anyone types
 *   POST /api/feedback               a bug or an idea, from a member or a stranger
 *   GET  /api/admin/feedback         the local queue, and whether the relay is real
 *   PUT  /api/admin/feedback/:id     triage, and the sentence the reporter gets back
 *
 * MOVED OUT OF server/index.ts UNCHANGED. Every line of the four handlers
 * below is byte for byte what stood in the monolith, with one substitution:
 * `mergedConfig().project.name` is now `projectName()`, the same function under
 * the name AppDeps already gives it. Registration happens at exactly the point
 * these routes used to be registered, because Express matches in registration
 * order.
 *
 * WHY THE TWO RELAY QUESTIONS ARE NOT HERE. `feedbackIsShared` and
 * `feedbackHubUrl` moved to `server/lib/feedback.ts`, beside `recordFeedback`
 * and `relayFeedback` that answer to them. They were module-level helpers in
 * server/index.ts, and the relay job there still asks them, so a copy in this
 * module would have been a second answer to "is anything actually leaving",
 * which is the one question this domain must never answer two ways.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { boolVar } from "../lib/variables";
import { recordEvent } from "../lib/events";
import { feedbackHubUrl, feedbackIsShared, feedbackStatusNotice, recordFeedback } from "../lib/feedback";

type Deps = Pick<
  AppDeps,
  "isAdmin" | "authedUser" | "getPool" | "notify" | "overLimit" | "clientIp" | "projectName"
>;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, getPool, notify, overLimit, clientIp, projectName } = deps;

  /**
   * What the submission form needs to disclose, honestly, before anyone types.
   *
   * Two things decide it: the dial the village set, and whether this
   * deployment was told where the hub is. The hub is no longer defaulted to
   * anybody's address, so a deployment with the dial ON and `FEEDBACK_HUB_URL`
   * unset shares nothing. Reporting the dial on its own would promise a person
   * their words are travelling somewhere while they stay home.
   */
  app.get("/api/feedback/config", async (_req, res) => {
    res.json({
      relayOn: feedbackIsShared(),
      villageName: projectName(),
    });
  });

  app.post("/api/feedback", async (req, res) => {
    // Same anti-abuse posture as every public form: honeypot + IP limit.
    if (typeof req.body?.hp === "string" && req.body.hp.length > 0) return res.json({ success: true });
    if (await overLimit(`feedback:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "That's a lot of feedback for one hour. Thank you, and give it a rest" });
    }
    const kind = req.body?.kind === "bug" ? "bug" : req.body?.kind === "idea" ? "idea" : null;
    const title = String(req.body?.title ?? "").trim();
    const detail = String(req.body?.detail ?? "").trim();
    if (!kind || title.length < 4 || detail.length < 10) {
      return res.status(400).json({ error: "Say what kind it is, a short title, and enough detail to act on" });
    }
    const user = await authedUser(req);
    // The disclosure the form showed IS the consent, so it is recorded with
    // the item rather than re-derived from the setting at relay time.
    const mayRelay = feedbackIsShared();
    const r = await recordFeedback(getPool(), {
      kind, title, detail,
      pageUrl: typeof req.body?.pageUrl === "string" ? req.body.pageUrl : null,
      submittedBy: user?.id ?? null,
    }, mayRelay);
    void recordEvent(getPool(), {
      kind: "audit", text: `feedback:${kind}:${title.slice(0, 60)}`,
      actorUserId: user?.id ?? null, entityType: "feedback", entityRef: r.id, audience: "admin",
    });
    res.json({
      success: true,
      id: r.id,
      shared: feedbackIsShared(),
    });
  });

  app.get("/api/admin/feedback", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const [rows] = await getPool().query<any[]>(
      "SELECT f.*, u.name AS submitter_name FROM feedback_items f LEFT JOIN users u ON u.id = f.submitted_by " +
        "ORDER BY f.created_at DESC LIMIT 300",
    );
    /*
     * Three facts, because two of them can disagree and an admin who cannot
     * see the disagreement cannot fix it. `relayOn` is whether anything is
     * actually leaving. `relayDialOn` is what the village set. `hubConfigured`
     * is whether the server was told where to send. A dial reading ON beside a
     * queue that is going nowhere needs a screen that says which half is
     * missing.
     */
    res.json({
      items: rows,
      relayOn: feedbackIsShared(),
      relayDialOn: boolVar("platform.feedback_relay"),
      hubConfigured: feedbackHubUrl().length > 0,
    });
  });

  app.put("/api/admin/feedback/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const status = String(req.body?.status ?? "");
    if (!["new", "seen", "planned", "done", "declined"].includes(status)) {
      return res.status(400).json({ error: "unknown status" });
    }
    /*
     * SWEEP (the incomplete loop). Triage moved and the member who reported
     * the problem was never told, so the honest answer to "did anyone see
     * this?" was "open the admin panel and find out", which is exactly the
     * door they do not have.
     *
     * Read first, for three reasons: to know WHO to write to, to know
     * whether the status actually moved, and because MySQL counts CHANGED
     * rows, so re-selecting the status an item already held reported zero
     * affected rows and answered 404 for an item that plainly exists.
     */
    const [[before]] = await getPool().query<any[]>(
      "SELECT id, kind, title, status, submitted_by FROM feedback_items WHERE id = ? LIMIT 1",
      [req.params.id],
    );
    if (!before) return res.status(404).json({ error: "no such item" });
    if (String(before.status) === status) return res.json({ success: true, notified: false });
    await getPool().query("UPDATE feedback_items SET status = ? WHERE id = ?", [status, req.params.id]);

    /*
     * The public form takes feedback from strangers too, and `submitted_by`
     * is null for those. There is no address on the row and no account to
     * put a notification in, so an anonymous report stays anonymous.
     *
     * The key is (item, status): one word per item per landing place, so a
     * founder who sets "planned" twice, or walks an item back and forward
     * again, rings once. It says the member's OWN title back to them,
     * because a village clearing a backlog produces a run of these and
     * "your report" alone would not tell them which.
     */
    const notice = feedbackStatusNotice(status, String(before.kind ?? "bug"));
    let notified = false;
    if (before.submitted_by && notice) {
      const title = String(before.title ?? "").slice(0, 120);
      await notify({
        userId: String(before.submitted_by),
        type: "feedback",
        title: `${notice.headline}: ${title}`,
        body: notice.line,
        link: "/profile",
        dedupeKey: `feedback:${String(before.id)}:${status}`,
      });
      notified = true;
    }
    res.json({ success: true, notified });
  });
}
