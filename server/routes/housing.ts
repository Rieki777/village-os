/**
 * Housing: how many homes are open, and who has asked for one.
 *
 * Six routes lifted out of server/index.ts unchanged, and two added by 0131:
 *
 *   GET /api/housing/public                    the counts and the homes, no identity
 *   GET /api/housing/availability              every hamlet, founder only
 *   PUT /api/housing/availability/:structureKey  set or clear one hamlet
 *   GET /api/housing/home-types                every home type, founder only
 *   PUT /api/housing/home-types/:homeType      set or clear one home type
 *   POST /api/housing/reservations             a stranger asks for a home
 *   GET /api/housing/reservations              the intents, founder only
 *   PUT /api/housing/reservations/:id/status   move one along
 *
 * The 0131 pair answers what a home IS: what this village calls it, how big
 * it is and what it costs, in that village's own words. The four tiers used
 * to be a module constant in two page files, so every fork published one
 * American village's dollars and square footage under its own name with no
 * field able to change them.
 *
 * THESE PATHS ARE NOT UNDER /api/map, AND THAT IS LOAD-BEARING. The section
 * comment below says it in full: `app.use("/api/map", requireModule("map"))`
 * would make switching the map off take the reservation form down with it,
 * and a village that never turns the map on could not sell a home. Moving
 * these handlers into a file does not change that, and neither should any
 * later tidy-up that notices housing counts also ride on /api/map/config.
 *
 * ONE PUBLIC ROUTE, FIVE GATED. `GET /api/housing/public` carries counts and
 * no names, so it answers a stranger. Everything that carries `updatedBy`, or
 * a reservation's name, email and phone, goes through `map.publish`: the two
 * reads through `mayStillSee` so an operator keeps their eyes, the two writes
 * through `guardCapability` so a village that has taken the key gets the 409
 * and the admin gets told who holds it. `POST /api/housing/reservations` is
 * the deliberate exception, and its own comment explains why a stranger
 * writes that row and what stands guard instead.
 *
 * `notifyDeps` IS REBUILT HERE FROM TWO NAMES. The two mailing handlers read
 * `notifyDeps.origin()` and `notifyDeps.projectName()`, which is what those
 * calls are called in server/index.ts. Rebuilding the pair under the same
 * name below keeps the handler bodies byte-identical to the ones that moved
 * while keeping this module's slice down to the two functions it calls,
 * rather than taking the whole notify bundle (which carries the pool and the
 * member lookup) to reach two strings.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
// Village Comms: the one door to the email system (server/lib/commsSink.ts).
import { commsSink } from "../lib/commsSink";
import {
  allHomeTypes,
  allRows as housingRows,
  createReservation,
  exceedsTotal,
  isHomeType,
  isReservationStatus,
  listReservations,
  publicEntries as housingPublicEntries,
  publicHomeTypes,
  readAvailabilityPatch,
  readHomeTypePatch,
  reservationById,
  reservationStatusNotice,
  setAvailability as setHousingAvailability,
  setHomeType,
  setReservationStatus,
} from "../lib/housing";

type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "guardCapability"
  | "mayStillSee"
  | "getPool"
  | "overLimit"
  | "clientIp"
  | "escapeHtml"
  | "recipientsForType"
  | "sendResendEmail"
  | "deploymentOrigin"
  | "projectName"
>;

export function register(app: Express, deps: Deps): void {
  const {
    authedUser,
    guardCapability,
    mayStillSee,
    getPool,
    overLimit,
    clientIp,
    escapeHtml,
    recipientsForType,
    sendResendEmail,
    deploymentOrigin,
    projectName,
  } = deps;
  /** See the header: the two names the moved handlers reach for, and no more. */
  const notifyDeps = { origin: deploymentOrigin, projectName };

  /**
   * ── HOUSING AVAILABILITY (0077) ────────────────────────────────────────
   *
   * Rye: the founder sets, per hamlet, how many homes are open for
   * reservation and how many are taken, in TWO places (builder mode on the
   * map, Admin on the main site) writing ONE table, "so the reservation
   * system has the same source of truth".
   *
   * These routes live at `/api/housing` and NOT under `/api/map`, which is
   * deliberate and load-bearing: `app.use("/api/map", requireModule("map"))`
   * would make switching the map off take the reservation form down with it,
   * and a village that never turns the map on could not sell a home. The map
   * still gets its counts on `/api/map/config`; both transports call the same
   * `publicEntries`, so the filter that decides what "set" means exists once.
   */

  /**
   * The public housing read, for site surfaces that are not the map.
   *
   * `entries` carries the per-hamlet counts: the same body as the `housing`
   * block on `/api/map/config` and the same identity-free guarantee. A
   * surface labels its numbers an example whenever its structure key is
   * absent from `entries`.
   *
   * `homes` (0131) carries the home types this village has PUBLISHED, and it
   * rides this route rather than the map's because the map paints hamlets and
   * knows nothing about home types, while both surfaces that draw a home
   * (/housing and /reserve) already fetch this one. The two lists answer
   * different questions about the same subject and neither is derived from
   * the other: a village can price a casita before it has drawn a hamlet, and
   * a hamlet can have homes open before anybody has said what a home costs.
   *
   * An empty `homes` is the honest answer for a village that has not
   * described its homes, and it is what /housing reads as "draw no tier
   * section at all". `configured` is about the hamlet counts and is left
   * meaning exactly what it always meant; a caller asking about homes asks
   * `homes.length`.
   */
  app.get("/api/housing/public", async (_req, res) => {
    const entries = await housingPublicEntries(getPool());
    const homes = await publicHomeTypes(getPool());
    res.json({ entries, configured: entries.length > 0, homes });
  });

  /**
   * All four home types including the unfilled ones, for the founder surface.
   *
   * Gated exactly like `GET /api/housing/availability` beside it, and for the
   * same reason: it carries `updatedBy`, which names a person. `mayStillSee`
   * and not `guardCapability`, because there is no break-glass on a GET and
   * an admin refused a LOOK would have no way back at all.
   */
  app.get("/api/housing/home-types", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see the homes" });
    if (!(await mayStillSee(req, "map.publish"))) {
      return res.status(403).json({ error: "Describing the homes is an appointment" });
    }
    res.json({ rows: await allHomeTypes(getPool()) });
  });

  /**
   * Set (or clear) what one home type is called, how big it is and what it
   * costs. The Admin housing tab lands here.
   *
   * ── WHY THE SAME KEY AS THE COUNTS ─────────────────────────────────────
   * `map.publish`, the same appointment that gates a hamlet's numbers. What a
   * home costs becomes true for every visitor the moment it lands, which is
   * the same property that key already means, and it is already the key the
   * founder holds to run this tab. Minting a second capability for the other
   * half of one admin panel would give a village two keys to hand out for one
   * job and no way to explain the difference.
   *
   * ── THE BODY IS A PATCH ────────────────────────────────────────────────
   * Identical to the availability route above, which is the point:
   *
   *   field absent   the column keeps what it has. Nothing is written.
   *   field null     CLEARED, and the home stops publishing if that was the
   *                  last of name, size and price holding it up.
   *   a value        set to that value, verbatim.
   *
   * `{}` is legal and creates an unfilled row, so a save with nothing typed
   * cannot cost a founder what they already had.
   *
   * NOTHING HERE PARSES A NUMBER. `readHomeTypePatch` trims and clamps to the
   * column width and does no other edit, so a village publishes "0.5
   * hectares" or a price in colones exactly as it typed them. The platform
   * has no opinion about anybody's units or currency, which is the whole
   * reason the compiled-in tiers had to go.
   */
  app.put("/api/housing/home-types/:homeType", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to describe the homes" });
    const maySet = await guardCapability(req, res, "map.publish", {
      status: 403,
      body: { error: "Describing the homes is an appointment" },
    });
    if (!maySet) return;
    const homeType = String(req.params.homeType ?? "");
    // The same guard the reservation POST uses, so a home a founder can
    // describe is always a home a visitor can ask for. A free-text home type
    // is a typo that quietly becomes a category nobody reports on.
    if (!isHomeType(homeType)) {
      return res.status(400).json({ error: "That is not one of the home types" });
    }
    const read = readHomeTypePatch(req.body);
    if (!read.ok) return res.status(400).json({ error: read.error });
    await setHomeType(getPool(), { homeType, ...read.patch, updatedBy: user.id });
    const rows = await allHomeTypes(getPool());
    res.json({ ok: true, row: rows.find((r) => r.homeType === homeType) ?? null });
  });

  /**
   * Every hamlet including the unset ones, for the two founder surfaces.
   *
   * Behind the capability gate because it carries `updatedBy`, which names a
   * person. The public route above carries no identity and therefore needs no
   * gate; splitting them is what lets the public one stay uncredentialed.
   *
   * 0103: a LOOK that refuses, so it asks `mayStillSee`. A village taking
   * `map.publish` on takes the SETTING of the numbers, and it does not take
   * the operator's eyes: there is no break-glass on a GET, so an admin
   * refused here would have no way back at all.
   */
  app.get("/api/housing/availability", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see housing numbers" });
    if (!(await mayStillSee(req, "map.publish"))) {
      return res.status(403).json({ error: "Setting housing numbers is an appointment" });
    }
    res.json({ rows: await housingRows(getPool()) });
  });

  /**
   * Set (or clear) one hamlet's numbers. BOTH founder surfaces land here.
   *
   * Gated on `map.publish` through the one gate in shared/capabilities.ts and
   * nowhere else. That key is appointment-only, deliberately absent from
   * STAGE_UNLOCKS so nobody reaches it by climbing, and it already means
   * "this becomes true for every visitor", which is exactly what a housing
   * count is.
   *
   * 0103 moved the ask from `hasCapability` to `guardCapability`. An admin
   * still passes at step 1 of the gate while the village holds nothing, which
   * is what covers the Admin surface; once a village holds the key the same
   * admin meets the 409 and is told who holds it and what to send.
   *
   * ── THE BODY IS A PATCH: SEND ONLY WHAT YOU ARE CHANGING ───────────────
   * All four writable fields read the same way, and this is the whole
   * contract for anyone building the second surface:
   *
   *   field absent   the row keeps what it has. Nothing is written.
   *   field null     CLEARED. A count goes back to unset, a label goes back
   *                  to letting the map's own name win.
   *   a value        set to that value.
   *
   * `{}` is legal and creates an unset row for a structure key that has none,
   * which is what "add a hamlet" sends. On a key that already exists it
   * changes nothing, so pressing add twice cannot cost a founder their
   * counts.
   *
   * Absent used to mean three different things here, and one of them was
   * destruction: a missing count was a 400, a missing `takenSource` was left
   * alone, and a missing `label` was written as NULL, so a caller sending
   * only the number it meant to change wiped the founder's hamlet name
   * without a word. The uniform rule is also what stops a stale surface
   * clobbering: a control that sends one field cannot revert the three it
   * never mentioned.
   *
   * `null` for a count is not the same as 0: zero homes is a real answer and
   * is never treated as an example.
   *
   * `taken` in the body is the founder's TYPED number, which is `storedTaken`
   * on the read. Sending back the `taken` a founder surface displays writes a
   * live reservation count into the column that has to survive the flip, and
   * the typed number is then gone with nothing able to say it ever existed.
   */
  app.put("/api/housing/availability/:structureKey", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to set housing numbers" });
    // 0103: ACT. A hamlet's count becomes true for every visitor the moment
    // it lands, which is the same reason this key gates the map's publish.
    // `readAvailabilityPatch` reads only the four fields it names, so an
    // `override` riding the body cannot reach a column.
    const maySet = await guardCapability(req, res, "map.publish", {
      status: 403,
      body: { error: "Setting housing numbers is an appointment" },
    });
    if (!maySet) return;
    const structureKey = String(req.params.structureKey ?? "");
    // The map mints these keys and the site stores them verbatim, so the only
    // question here is whether it could be one, never what it should become.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(structureKey)) {
      return res.status(400).json({ error: "That is not a structure key" });
    }
    /*
     * Reading the body and the taken-against-total rule both live in
     * server/lib/housing.ts, where housing.test.ts can reach them. A decision
     * that exists only inside this file is a decision no test has ever run:
     * that is how three different meanings for an absent field, one of them
     * destructive, went unnoticed here in the first place.
     */
    const read = readAvailabilityPatch(req.body);
    if (!read.ok) return res.status(400).json({ error: read.error });
    const before = (await housingRows(getPool())).find((r) => r.structureKey === structureKey) ?? null;
    // Loud on write. The read side clamps `open` to zero as well, which
    // defends rows written before this rule existed; it does not replace it.
    if (exceedsTotal(read.patch, before)) {
      return res.status(400).json({ error: "Homes taken cannot be more than the total" });
    }
    // Spread, so a field the caller left out stays left out all the way to
    // the column list of the upsert.
    await setHousingAvailability(getPool(), {
      structureKey, ...read.patch, updatedBy: user.id,
    });
    const rows = await housingRows(getPool());
    res.json({ ok: true, row: rows.find((r) => r.structureKey === structureKey) ?? null });
  });

  /**
   * Slice 1 of the reservation flow: a person says which home they want and
   * where. NO MONEY MOVES HERE. The deposit is a later step and it reuses
   * server/lib/payments.ts rather than growing a second payment path.
   *
   * Deliberately answers strangers. This form is reached from the public
   * housing pages and from the map, and the person filling it in has usually
   * not signed in yet; that is the point of the step. A signed-in member's id
   * is attached when the header happens to be there, so the intent can be
   * joined to the account later without asking them to log in first.
   *
   * ── THE HOUSE PATTERN FOR ANONYMOUS PUBLIC INTAKE ────────────────────────
   * `POST /api/forms/submit` is the same shape as this route, a stranger
   * writing a row with no token, and it carries a honeypot and a per-IP cap.
   * This one shipped with neither, which made it an unauthenticated unbounded
   * insert: name, email, phone and 2000 characters of notes, as fast as
   * anyone can post them. Both guards below are copied from that route rather
   * than invented here, including the cap, so there is one answer in this
   * codebase to "how hard can a stranger hit a public form".
   *
   * ── AND SO IS THE TELLING-SOMEBODY HALF ──────────────────────────────────
   * The guards were copied and the delivery was not, which left a form that
   * wrote a row and told nobody. The success screen says someone from the
   * founding team will be in touch, and the only place that intent existed
   * was an Admin tab a founder had no reason to open. A lead that reaches a
   * table and no person is a lost lead wearing a receipt.
   *
   * So the same three things `POST /api/forms/submit` does: the pathway inbox
   * gets an email with the whole request in it, the person gets an
   * acknowledgement so they know it landed, and `recordEvent` puts it in the
   * village's own history. The emails are fire-and-forget and never fail the
   * request, because the row is already saved and a Resend outage must not
   * tell a person their reservation did not go through.
   */
  app.post("/api/housing/reservations", async (req, res) => {
    const b = req.body ?? {};
    // Honeypot: a hidden field only bots fill. Answer success, store nothing.
    if (b.hp) return res.json({ ok: true });
    // Rate limit: modest cap per IP to blunt spam floods. Fails open on a
    // database outage, like every other call site, because a guard that takes
    // the form down during an outage costs the village real leads.
    if (await overLimit(`housing-reserve:${clientIp(req)}`, 6, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    const homeType = String(b.homeType ?? "");
    if (!isHomeType(homeType)) {
      return res.status(400).json({ error: "Choose one of the home types" });
    }
    const name = String(b.name ?? "").trim().slice(0, 190);
    const email = String(b.email ?? "").trim().slice(0, 190);
    if (!name) return res.status(400).json({ error: "A name is required" });
    // Deliberately permissive: the delivery attempt is the real test of an
    // address, and a strict pattern here refuses valid addresses for nothing.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "That email address does not look right" });
    }
    const rawKey = b.structureKey == null ? "" : String(b.structureKey);
    /*
     * An unrecognised hamlet is dropped to null rather than refused. The key
     * arrives from a query string a person can edit, and losing a real lead
     * over a mangled URL is worse than recording an intent with no hamlet,
     * which is already a legitimate state for someone who arrived from the
     * housing page with no place in mind.
     */
    const structureKey = /^[A-Za-z0-9_-]{1,64}$/.test(rawKey) ? rawKey : null;
    const user = await authedUser(req).catch(() => null);
    const phone = b.phone == null ? null : String(b.phone).trim().slice(0, 64) || null;
    const notes = b.notes == null ? null : String(b.notes).trim().slice(0, 2000) || null;
    const arrivedFrom = b.arrivedFrom === "map" ? "map" : "site";
    const { id } = await createReservation(getPool(), {
      structureKey,
      homeType,
      name,
      email,
      phone,
      notes,
      arrivedFrom,
      userId: user?.id ?? null,
    });
    // A new reservation is written as `new` (drizzle/0077's default).
    commsSink.fire({ type: "housing_status", reservationId: id, status: "new", email });

    /*
     * The village's own history. Audience 'admin', because the text carries a
     * person's name and the public Pulse is read by everyone. Never awaited:
     * recordEvent swallows its own failures by contract, and an intent that
     * is already saved must not fail on its trace.
     */
    void recordEvent(getPool(), {
      kind: "housing_reservation",
      text: `${name} asked for a ${homeType}${structureKey ? ` in ${structureKey}` : ""}`,
      actorUserId: user?.id ?? null,
      entityType: "housing_reservation",
      entityRef: id,
      audience: "admin",
    });

    const origin = notifyDeps.origin();
    void (async () => {
      /*
       * The hamlet's own name if the founder has set one, because a founder
       * reading this email at a phone screen knows "Ridge Hamlet North" and
       * has no reason to recognise "ridgeA". Falls back to the key, then to
       * saying there was no hamlet at all.
       */
      let hamlet: string | null = null;
      if (structureKey) {
        const row = (await housingRows(getPool()).catch(() => []))
          .find((r) => r.structureKey === structureKey);
        hamlet = row?.label || structureKey;
      }
      const line = (k: string, v: string) =>
        `<p style="margin:4px 0"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`;
      // The resident pathway inbox: this is a person asking to live here, and
      // recipientsForType falls back to every configured inbox when that one
      // is empty, so a village that set up only one address still hears it.
      const recipients = recipientsForType("resident");
      if (recipients.length) {
        await sendResendEmail({
          to: recipients,
          origin: "housing.team_alert",
          // The person who asked, so a founder can hit reply and be talking
          // to them. Same move the contact relay makes.
          replyTo: email,
          subject: `[${notifyDeps.projectName()}] Home reservation request from ${name}`,
          html:
            `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937">` +
            `<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">` +
            `<div style="background:#2D5A5A;color:#fff;padding:22px 24px"><div style="font-size:20px;font-weight:700">Someone wants a home</div></div>` +
            `<div style="padding:22px 24px;line-height:1.6">` +
            line("Name", name) +
            line("Email", email) +
            (phone ? line("Phone", phone) : "") +
            line("Home type", homeType) +
            line("Hamlet", hamlet ?? "none chosen") +
            line("Came from", arrivedFrom === "map" ? "the living map" : "the site") +
            (notes ? `<p style="margin:14px 0 4px"><strong>What they told us</strong></p><p style="margin:0;white-space:pre-wrap">${escapeHtml(notes)}</p>` : "") +
            `<p style="margin-top:20px"><a href="${origin}/admin" style="color:#2D5A5A">Open it in Admin</a></p>` +
            `</div></div></body></html>`,
        });
      }
      // The person who asked. No deposit link and no promise of a date: this
      // step records an intent, and the next move is a human one.
      await sendResendEmail({
        to: [email],
        origin: "housing.ack",
        subject: "We have your reservation request",
        html:
          `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937">` +
          `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">` +
          `<div style="background:#2D5A5A;color:#fff;padding:22px 24px"><div style="font-size:20px;font-weight:700">Your reservation request is in</div></div>` +
          `<div style="padding:22px 24px;line-height:1.6">` +
          `<p>Hi ${escapeHtml(name)},</p>` +
          `<p>We have your request for a ${escapeHtml(homeType)}${hamlet ? ` in ${escapeHtml(hamlet)}` : ""}. Someone from the founding team will read it and get in touch about the deposit and what happens next.</p>` +
          `<p>No payment has been taken, and nothing is held against your name yet.</p>` +
          `<p style="color:#6b7280;font-size:13px;margin-top:20px">The team</p>` +
          `</div></div></body></html>`,
      });
    })().catch((err) => console.error("[housing] reservation notification failed", err));

    res.json({ ok: true, id });
  });

  /**
   * The intents, for the founder. Same capability as the numbers, because
   * these rows carry a name, an email and a phone number.
   */
  app.get("/api/housing/reservations", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see reservations" });
    // 0103: a LOOK that refuses, so the operator keeps the read. See the
    // availability GET above for why `adminSees` and not the pure gate.
    if (!(await mayStillSee(req, "map.publish"))) {
      return res.status(403).json({ error: "Reading reservations is an appointment" });
    }
    res.json({ rows: await listReservations(getPool()) });
  });

  /**
   * Move an intent along. Only `reserved` ever consumes a home, and only for
   * hamlets whose `takenSource` is `reservations`, so an unanswered enquiry
   * never silently takes a home off the map.
   */
  app.put("/api/housing/reservations/:id/status", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to update reservations" });
    // 0103: ACT. Moving somebody's request to `reserved` takes a home off the
    // map and sends them an email, so it belongs on the act path.
    const mayMove = await guardCapability(req, res, "map.publish", {
      status: 403,
      body: { error: "Updating reservations is an appointment" },
    });
    if (!mayMove) return;
    const status = String(req.body?.status ?? "");
    if (!isReservationStatus(status)) {
      return res.status(400).json({ error: "Unknown status" });
    }
    /*
     * SWEEP (the incomplete loop). This route moved somebody's request for a
     * home and told them nothing. The CREATE route two screens up promised
     * them "someone from the founding team will read it and get in touch",
     * and this is the moment that promise comes due.
     *
     * WHY A RAW EMAIL AND NOT THE NOTIFY SPINE. The spine keys on a member
     * id, and the person who filled in the reservation form is usually not a
     * member of anything yet: `housing_reservations.user_id` is nullable and
     * the public form fills in a name, an email and a phone number. An
     * in-app notification for somebody with no account is a row nobody can
     * ever read. The create route already answers this family by email, so
     * this follows it rather than opening a second pattern beside it.
     *
     * WHAT STANDS IN FOR A DEDUPE KEY. Reading the row FIRST and comparing:
     * only a real transition sends, so a founder nudging the dropdown back
     * and forth, or a double-fired change event, cannot mail the same person
     * twice about the same move. It also repairs a quirk of the old shape:
     * MySQL counts CHANGED rows, so re-selecting the status a row already
     * held reported zero affected rows and this route answered 404 for a
     * reservation that plainly exists.
     */
    const before = await reservationById(getPool(), String(req.params.id));
    if (!before) return res.status(404).json({ error: "No such reservation" });
    if (before.status === status) return res.json({ ok: true, notified: false });
    // Compare-and-set on the status we read, so two founders moving the same
    // row at the same moment cannot both believe they made the transition and
    // both write to the person. The loser answers as a no-op.
    if (!(await setReservationStatus(getPool(), before.id, status, before.status))) {
      return res.json({ ok: true, notified: false });
    }
    commsSink.fire({ type: "housing_status", reservationId: before.id, status, email: before.email ?? null });

    // Asked before the hamlet lookup, because two of the four statuses say
    // nothing and a silent move should cost no reads.
    let notice = reservationStatusNotice(status, {
      name: before.name,
      homeType: before.homeType,
      hamlet: null,
    });
    if (notice && before.structureKey) {
      // The founder's own name for the hamlet, because somebody reading this
      // on a phone knows "Ridge Hamlet North" and has no reason to recognise
      // "ridgeA". Falls back to the key, exactly as the create route does.
      const row = (await housingRows(getPool()).catch(() => []))
        .find((r) => r.structureKey === before.structureKey);
      notice = reservationStatusNotice(status, {
        name: before.name,
        homeType: before.homeType,
        hamlet: row?.label || before.structureKey,
      });
    }
    if (notice) {
      void sendResendEmail({
        to: [before.email],
        origin: "housing.status",
        subject: notice.subject,
        html:
          `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937">` +
          `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">` +
          `<div style="background:#2D5A5A;color:#fff;padding:22px 24px"><div style="font-size:20px;font-weight:700">${escapeHtml(notice.heading)}</div></div>` +
          `<div style="padding:22px 24px;line-height:1.6">` +
          notice.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
          `<p style="color:#6b7280;font-size:13px;margin-top:20px">The team</p>` +
          `</div></div></body></html>`,
      }).catch((err) => console.error("[housing] reservation status email failed", err));
    }
    // The founder sees whether the applicant was written to. A status move
    // that quietly mails somebody, and one that quietly does not, used to
    // look identical from the panel.
    res.json({ ok: true, notified: !!notice });
  });
}
