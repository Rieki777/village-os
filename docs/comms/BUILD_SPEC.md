# Village Comms: build spec

**Written:** 2026-10-02, by the integrator of `wt/comms`.
**Read this whole file before you write a line.** Each lane brief points at sections of it.

**Sources:**
- The plan Rye approved: `C:\Users\taren\Desktop\Amora\VILLAGE_COMMS_PLAN_2026-10-02.md`. Rye said yes to every recommendation in its section 11.

**Rye's instructions that shape this build (2026-10-02):**
1. Build all of it, test it end to end, fix what the tests find, and report when it is ready for him to add his Resend credentials.
2. Add a **live vote on a session time**. The gathering's time moves with whichever time is winning; community sessions are the example (section 5.10).
3. **Everything a founder has to supply is added and edited in the Comms admin**, so every founder of every village can do it themselves (section 5.15).

**What we are building:**
- One post office every email passes through.
- One address book with permissions.
- Words a village can edit.
- One journey engine that runs both event emails and path emails.
- Guest RSVPs, attendance and recaps.
- Live time votes.
- Letters (village news).
- A Comms section in Admin.

It ships to every village in the one image. The engine is plumbing that is always on; the automations live in a module, `comms`, that ships off.

---

## 1. Lane rules (every lane, no exceptions)

1. **Worktree.** Make yours with the repo script, from the integration branch:
   `node scripts/new-worktree.mjs <lane-name> --base wt/comms`.
   - Run it from `C:\Users\taren\Desktop\Amora\wt-comms`. It creates `C:\Users\taren\Desktop\Amora\wt-<lane-name>` on `wt/<lane-name>`.
   - Never work in another lane's tree.
   - Never `git stash`: the stash stack is shared by every worktree on this machine. Use a WIP commit.
2. **Commits.** Commit on your branch, by pathspec (`git commit -m "..." -- <paths>`).
   - **Do not push and do not open a pull request.** The integrator merges your branch into `wt/comms`.
   - End by printing `git log --oneline wt/comms..HEAD` and `git status --short`.
3. **Do NOT run the full suite.** Run the test files you added, any existing suite covering the files you touched, and the gate scripts.
   - Say plainly that you skipped the full run and why. The integrator runs it once on the composed tree.
   - `pnpm build` before any e2e file: e2e suites boot `dist/index.js`, and vitest refuses a stale dist.
4. **Gates you run before saying done.** Read the authoritative list with `node scripts/module-facts.mjs`. At minimum:
   - `pnpm check`, and `npx tsc -p tsconfig.tests.json --noEmit` (tests are not typechecked by `pnpm check`);
   - `node scripts/check-voice.mjs`;
   - `node scripts/check-brand-refs.mjs`;
   - `node scripts/check-file-lines.mjs`;
   - `node scripts/check-server-index-size.mjs`;
   - `node scripts/check-admin-reach.mjs`;
   - `node scripts/check-repo-payloads.mjs`;
   - `node scripts/sql-burndown.mjs`;
   - `node scripts/check-migration-compat.mjs` (needs `TEST_DATABASE_URL`, which is in `.env`);
   - `node scripts/check-migration-numbers.mjs`;
   - `node scripts/check-e2e-ports.mjs`;
   - `node scripts/check-capabilities-doc.mjs`;
   - `node scripts/check-tailwind-gray.mjs`;
   - `node scripts/check-mirror-annotations.mjs`;
   - `node scripts/check-doc-links.mjs`;
   - `node scripts/check-dist-budget.mjs` (after `pnpm build`).
   Read every exit code directly, never through a pipe.
5. **House rules from `CLAUDE.md` that bite here:**
   - Expand-only migrations.
   - `--` comments on their own line, never ending in `;`.
   - Dedupe columns NOT NULL.
   - `dbCollection` writes explicit NULLs.
   - A stored `app_config` document never merges new defaults: read through a back-fill helper, and test against the old stored shape.
   - `BigInt("...")`, never `123n`.
   - Never `vitest -t`.
   - Grep tests case-sensitively before changing any string.
6. **SQL lives in `server/repos/`.** One file per table family. Each raw query carries a trailing `// module-review-ok: <reason>` comment, the way `server/repos/memberInvites.ts` does. No raw SQL anywhere else (the burn-down ratchet only goes down).
7. **Time.**
   - Compare instants IN SQL against `CURRENT_TIMESTAMP`.
   - Read an instant you will compute with as `UNIX_TIMESTAMP(col)`. The app pool pins UTC and a test pool does not, so a JavaScript `Date` read from a TIMESTAMP shifts by the host offset.
   - `events.starts_at` and `events.ends_at` are DATETIME in the convention `server/lib/calendar.ts` defines. Go through its helpers, never around them.
8. **Copy.**
   - Every word a person reads passes `scripts/check-voice.mjs`: no em or en dashes, no contrast framing (`not X but Y`, `rather than`), no AI filler words, no rhetorical openers.
   - Platform code and default email words carry no village name. The brand gate is hard-clean in `server/lib` and `shared`; use `{{village.name}}`.
   - Rye's voice is warm, direct, grounded and specific (`second-brain/90 Voice Profile/Rye Voice Profile.md` in the ReGen Civics repo, `C:\Users\taren\Downloads\regen-civics-clean\second-brain`).
9. **Admin is light-only.** Fixed grays on fixed white (`bg-white`, `text-gray-*`). No semantic theme tokens inside `client/src/components/admin/`.
10. **`client/src/pages/Admin.tsx` has zero lines of headroom.** New screens are files under `client/src/components/admin/comms/`. Pay for any line you add to `Admin.tsx` by moving code out.
11. **`server/index.ts` has zero route registrations of headroom.** Routes live in `server/routes/comms*.ts`, which the ratchet exempts. Pay for any counted line you add to `server/index.ts` by moving code out.
12. **Express matches in registration order.** A `requireModule` mount guards only routes registered AFTER it, and the webhook's raw-body route must register BEFORE `express.json()`, like Stripe's. Every such placement gets a test that would fail if it moved.
13. **Never send a real email.**
    - Tests use the fake Resend server (section 8.1) through `RESEND_API_BASE`.
    - Nothing in this build calls api.resend.com from a test, a script or a probe.
14. **Ports.** Pick e2e windows by looping candidates through `node scripts/check-e2e-ports.mjs`, never by eye.
15. **Done means:**
    - your acceptance list is green, with the test names written down;
    - every gate above has exited 0;
    - one short report with the files you touched, decisions you took, and anything left that you could not do.
    Prove behaviour with a control: break the guard, watch a NAMED test fail, restore it byte-identically.

---

## 2. Architecture and file map

```
shared/comms/                    pure, shared by server and client
  kinds.ts                       EmailKind, MessageStatus, SkipReason, LinkPurpose, unions
  contracts.ts                   OutgoingEmail, PostResult, JourneyDefinition, JourneyStep, triggers
  journeyPlan.ts                 the pure step planner (section 5.6)
  timePoll.ts                    the pure tally, leader and settle rules (section 5.10)
  quietHours.ts                  the send window, in a given IANA zone
  mergeFields.ts                 the field catalogue per trigger, and fill()
  markdown.ts, letterHtml.ts     the renderer, ported from ReGen Civics (section 5.5)
  defaults/templates.ts          every default email's words, versioned
  defaults/journeys.ts           every default journey, versioned
server/lib/commsSink.ts          the ONE import domain code uses to tell comms something happened
server/lib/comms/                behaviour; no raw SQL
  transport.ts                   Resend over fetch, honouring RESEND_API_BASE; result, never a throw
  postOffice.ts                  post(), drain(), the urgent path
  permissions.ts, contacts.ts, suppressions.ts
  links.ts                       signed links for every one-click action
  render.ts                      templates, brand theme, merge fields, plain text
  settings.ts                    the comms-settings document with its back-fill reader, commsMode()
  resendAdmin.ts                 domains and webhook setup through the Resend API
  webhook.ts                     Svix verification and applying delivery reports
  journeys.ts                    enroll, stop, touch, the tick
  conditions.ts                  every skip-if and stop rule, by key
  eventEmails.ts, guests.ts, attendance.ts, recaps.ts, timePolls.ts, ics.ts
  paths.ts, letters.ts, outcomes.ts, setup.ts
server/repos/comms*.ts, eventComms.ts, timePolls.ts, pathEnrollments.ts   all SQL
server/routes/comms.ts           /api/admin/comms/*            (admin)
server/routes/commsPublic.ts     /api/comms/*                  (public: unsubscribe, preferences, signed actions)
server/routes/commsEvents.ts     /api/events/:id/(guest-rsvp|time-poll|recap|attendance|comms)
server/routes/commsWebhook.ts    /api/comms/webhooks/resend    (raw body, before express.json)
server/testkit/fakeResend.ts     the fake provider for tests (never imported by server code)
client/src/components/admin/comms/   one file per Comms screen, plus shared bits
client/src/pages/EmailPages.tsx  the public preferences, unsubscribe and action pages, one lazy chunk
client/src/components/comms/     event-page widgets: guest RSVP, time poll, host panel
```

**The sink keeps the dependency arrow pointing one way.**
- `server/lib/gatherings.ts` and friends import only `commsSink`. They never import `server/lib/comms/*`.
- `server/index.ts` registers the real handler at boot.
- Until then `commsSink.fire()` is a no-op. It never throws and never awaits longer than a database write.

---

## 3. Data model

All new tables, so every migration is expand-only and the previous release never sees them. The only change to an existing table is none: per-gathering settings live in `event_comms`, keyed by event id.

Style follows `drizzle/0209_a_member_arrives_by_invitation.sql`:
- a header that says why;
- no CHARSET or COLLATE clause;
- `village_id varchar(64) NOT NULL DEFAULT 'local'` where a natural key needs it;
- TIMESTAMP columns nullable except the one with `DEFAULT CURRENT_TIMESTAMP`.

**Person keys.** A member is their user id. Somebody with no account is `guest:<contactId>`. That string goes in `event_rsvps.user_id`, `event_waitlist.user_id` and every `person_key` column, so every existing seat count and waitlist read counts guests with no change. The comment for this goes in 0229 and in `server/lib/comms/guests.ts`.

### 0228 `drizzle/0228_every_email_is_recorded_before_it_is_sent.sql`

```sql
CREATE TABLE IF NOT EXISTS `comms_contacts` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `email_key` varchar(191) NOT NULL,
  `email` varchar(320) NOT NULL,
  `name` varchar(255) NULL,
  `user_id` varchar(64) NULL,
  `first_source` varchar(64) NOT NULL,
  `timezone` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_contacts_email` (`village_id`, `email_key`),
  KEY `comms_contacts_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `comms_permissions` (
  `contact_id` varchar(64) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `state` varchar(16) NOT NULL,
  `basis` varchar(16) NOT NULL,
  `source` varchar(64) NOT NULL,
  `evidence` json NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`contact_id`, `kind`)
);

CREATE TABLE IF NOT EXISTS `comms_suppressions` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `email_key` varchar(191) NOT NULL,
  `reason` varchar(32) NOT NULL,
  `detail` varchar(500) NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `email_key`)
);

CREATE TABLE IF NOT EXISTS `comms_messages` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `idempotency_key` varchar(191) NOT NULL,
  `contact_id` varchar(64) NULL,
  `user_id` varchar(64) NULL,
  `to_email` varchar(320) NOT NULL,
  `email_key` varchar(191) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `origin` varchar(64) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `template_key` varchar(100) NULL,
  `template_version` int NULL,
  `journey_key` varchar(100) NULL,
  `step_key` varchar(64) NULL,
  `enrollment_id` varchar(64) NULL,
  `letter_id` varchar(64) NULL,
  `body_html` mediumtext NULL,
  `body_text` mediumtext NULL,
  `headers` json NULL,
  `attachments` json NULL,
  `reply_to` varchar(320) NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `skip_reason` varchar(64) NULL,
  `rehearsal_to` varchar(320) NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `next_attempt_at` timestamp NULL,
  `send_after` timestamp NULL,
  `expires_at` timestamp NULL,
  `provider` varchar(32) NULL,
  `provider_message_id` varchar(128) NULL,
  `last_error` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  `delivered_at` timestamp NULL,
  `bounced_at` timestamp NULL,
  `complained_at` timestamp NULL,
  `opened_at` timestamp NULL,
  `clicked_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_messages_idem` (`village_id`, `idempotency_key`),
  KEY `comms_messages_due` (`status`, `send_after`),
  KEY `comms_messages_contact` (`contact_id`, `created_at`),
  KEY `comms_messages_email` (`email_key`, `created_at`),
  KEY `comms_messages_provider` (`provider_message_id`),
  KEY `comms_messages_journey` (`journey_key`, `step_key`),
  KEY `comms_messages_letter` (`letter_id`)
);

CREATE TABLE IF NOT EXISTS `comms_provider_events` (
  `id` varchar(191) NOT NULL,
  `type` varchar(64) NOT NULL,
  `provider_message_id` varchar(128) NULL,
  `message_id` varchar(64) NULL,
  `payload` json NOT NULL,
  `received_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` timestamp NULL,
  `outcome` varchar(64) NULL,
  PRIMARY KEY (`id`),
  KEY `comms_provider_events_msg` (`provider_message_id`)
);

CREATE TABLE IF NOT EXISTS `comms_templates` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `template_key` varchar(100) NOT NULL,
  `version` int NOT NULL,
  `subject` varchar(500) NOT NULL,
  `preheader` varchar(255) NULL,
  `body_md` mediumtext NOT NULL,
  `layout` varchar(32) NOT NULL DEFAULT 'plain',
  `platform_version` int NULL,
  `state` varchar(16) NOT NULL DEFAULT 'live',
  `edited_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `template_key`, `version`),
  KEY `comms_templates_live` (`village_id`, `template_key`, `state`)
);

CREATE TABLE IF NOT EXISTS `comms_journeys` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'off',
  `version` int NOT NULL DEFAULT 1,
  `definition` json NULL,
  `platform_version` int NULL,
  `updated_by` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `journey_key`)
);

CREATE TABLE IF NOT EXISTS `comms_journey_versions` (
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `version` int NOT NULL,
  `definition` json NOT NULL,
  `created_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`village_id`, `journey_key`, `version`)
);

CREATE TABLE IF NOT EXISTS `comms_enrollments` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `journey_key` varchar(100) NOT NULL,
  `journey_version` int NOT NULL,
  `contact_id` varchar(64) NOT NULL,
  `subject_ref` varchar(191) NOT NULL,
  `facts` json NULL,
  `state` varchar(16) NOT NULL DEFAULT 'active',
  `stop_reason` varchar(64) NULL,
  `enrolled_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `next_check_at` timestamp NULL,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_enrollments_once` (`village_id`, `journey_key`, `contact_id`, `subject_ref`),
  KEY `comms_enrollments_due` (`state`, `next_check_at`),
  KEY `comms_enrollments_subject` (`subject_ref`)
);
```

### 0229 `drizzle/0229_a_gathering_asks_when_and_remembers_who_came.sql`

```sql
CREATE TABLE IF NOT EXISTS `event_comms` (
  `event_id` varchar(64) NOT NULL,
  `guests` tinyint(1) NULL,
  `reminders` json NULL,
  `ics_sequence` int NOT NULL DEFAULT 0,
  `host_user_id` varchar(64) NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`)
);

CREATE TABLE IF NOT EXISTS `event_guest_requests` (
  `id` varchar(64) NOT NULL,
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `contact_id` varchar(64) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL,
  `confirmed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_guest_requests_token` (`token_hash`),
  KEY `event_guest_requests_event` (`event_id`, `occurrence_key`),
  KEY `event_guest_requests_contact` (`contact_id`)
);

CREATE TABLE IF NOT EXISTS `event_attendance` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `person_key` varchar(100) NOT NULL,
  `status` varchar(16) NOT NULL,
  `marked_by` varchar(64) NOT NULL,
  `marked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`, `occurrence_key`, `person_key`)
);

CREATE TABLE IF NOT EXISTS `event_recaps` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `body_md` mediumtext NOT NULL,
  `missed_note_md` mediumtext NULL,
  `recording_url` varchar(500) NULL,
  `state` varchar(16) NOT NULL DEFAULT 'draft',
  `author_user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  PRIMARY KEY (`event_id`, `occurrence_key`)
);

CREATE TABLE IF NOT EXISTS `event_feedback` (
  `event_id` varchar(64) NOT NULL,
  `occurrence_key` varchar(10) NOT NULL DEFAULT '',
  `person_key` varchar(100) NOT NULL,
  `question_key` varchar(32) NOT NULL,
  `answer` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`event_id`, `occurrence_key`, `person_key`, `question_key`)
);

CREATE TABLE IF NOT EXISTS `event_time_polls` (
  `id` varchar(64) NOT NULL,
  `event_id` varchar(64) NOT NULL,
  `mode` varchar(16) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'open',
  `closes_at` timestamp NULL,
  `settle_minutes` int NOT NULL DEFAULT 0,
  `freeze_hours` int NOT NULL DEFAULT 48,
  `pinned_option_id` varchar(64) NULL,
  `leader_option_id` varchar(64) NULL,
  `leader_since` timestamp NULL,
  `applied_option_id` varchar(64) NULL,
  `show_names` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `locked_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_time_polls_event` (`event_id`)
);

CREATE TABLE IF NOT EXISTS `event_time_poll_options` (
  `id` varchar(64) NOT NULL,
  `poll_id` varchar(64) NOT NULL,
  `starts_at` datetime NULL,
  `weekday` tinyint NULL,
  `start_minute` int NULL,
  `duration_minutes` int NOT NULL DEFAULT 60,
  `position` int NOT NULL DEFAULT 0,
  `removed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `event_time_poll_options_poll` (`poll_id`)
);

CREATE TABLE IF NOT EXISTS `event_time_poll_votes` (
  `poll_id` varchar(64) NOT NULL,
  `option_id` varchar(64) NOT NULL,
  `person_key` varchar(100) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`poll_id`, `option_id`, `person_key`),
  KEY `event_time_poll_votes_person` (`poll_id`, `person_key`)
);
```

### 0230 `drizzle/0230_a_path_remembers_who_walks_it.sql`

```sql
CREATE TABLE IF NOT EXISTS `path_enrollments` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `person_key` varchar(100) NOT NULL,
  `user_id` varchar(64) NULL,
  `contact_id` varchar(64) NULL,
  `path_id` varchar(64) NOT NULL,
  `source` varchar(64) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'active',
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` timestamp NULL,
  `done_at` timestamp NULL,
  `last_rung` varchar(64) NULL,
  `updated_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `path_enrollments_one` (`village_id`, `person_key`, `path_id`),
  KEY `path_enrollments_path` (`path_id`, `state`)
);

CREATE TABLE IF NOT EXISTS `comms_letters` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `subject` varchar(500) NOT NULL,
  `preheader` varchar(255) NULL,
  `body_md` mediumtext NOT NULL,
  `layout` varchar(32) NOT NULL DEFAULT 'plain',
  `audience` json NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'draft',
  `scheduled_for` timestamp NULL,
  `body_hash` char(64) NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `recipient_count` int NOT NULL DEFAULT 0,
  `posted_count` int NOT NULL DEFAULT 0,
  `skipped_count` int NOT NULL DEFAULT 0,
  `created_by` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL,
  `sent_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comms_letters_idem` (`village_id`, `idempotency_key`),
  KEY `comms_letters_due` (`state`, `scheduled_for`)
);

CREATE TABLE IF NOT EXISTS `comms_letter_recipients` (
  `letter_id` varchar(64) NOT NULL,
  `email_key` varchar(191) NOT NULL,
  `contact_id` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `skip_reason` varchar(64) NULL,
  `message_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`letter_id`, `email_key`)
);
```

**Column meanings the DDL cannot carry.** Write these into each migration's header.

- `comms_permissions`:
  - `kind`: one of `events`, `paths`, `letters`, `notices`. `essential` is never stored.
  - `state`: `yes` or `no`.
  - `basis`: `asked`, `implied`, `account` or `imported`.
  - `evidence`: the form id, and the words the person saw when they said yes.
- `comms_suppressions.reason`: `bounced`, `complained`, `unsubscribed_all`, `manual` or `erased`.
- `comms_messages`:
  - `status`: `queued`, `sending`, `sent`, `delivered`, `bounced`, `complained`, `failed`, `skipped`, `expired`, `rehearsed` or `cancelled`.
  - `origin`: what made the email, for example `auth.reset`, `notify.immediate`, `journey`, `event.changed` or `letter`.
  - The body columns are cleared by retention.
- `comms_enrollments.subject_ref`: one of `event:<id>:<occ>`, `path:<pathId>`, `form:<submissionId>`, `account` or `poll:<pollId>`.

---

## 4. Contracts

These are fixed by the foundation lane and changed only by the integrator. Names may gain fields; nothing is renamed.

```ts
// shared/comms/kinds.ts
export const EMAIL_KINDS = ["essential", "events", "paths", "letters", "notices"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const MESSAGE_STATUSES = ["queued","sending","sent","delivered","bounced","complained","failed","skipped","expired","rehearsed","cancelled"] as const;
export const SKIP_REASONS = ["no_permission","suppressed","over_cap","paused","module_off","not_configured","bad_address","expired","duplicate"] as const;
export const LINK_PURPOSES = ["unsubscribe","preferences","guest_confirm","cant_make_it","time_vote","recap_answer","letters_confirm","rsvp_next"] as const;

// shared/comms/contracts.ts
export interface OutgoingEmail {
  idempotencyKey: string;               // stable per logical email; hashed to 64 hex if over 191 chars
  kind: EmailKind;
  origin: string;
  to: { email: string; name?: string | null; userId?: string | null; contactId?: string | null };
  subject: string;
  html: string;
  text: string;
  preheader?: string | null;
  replyTo?: string | null;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  source?: { templateKey?: string; templateVersion?: number; journeyKey?: string; stepKey?: string; enrollmentId?: string; letterId?: string };
  sendAfter?: Date | null;              // null: as soon as possible
  expiresAt?: Date | null;              // an unsent row past this becomes `expired`
  urgent?: boolean;                     // attempt now, inside this request (essential mail, confirmations)
  bypassCap?: boolean;
}
export interface PostResult { status: MessageStatus | "duplicate"; messageId: string | null; reason?: string }

export type CommsTrigger =
  | { type: "rsvp_changed"; eventId: string; occurrenceKey: string; personKey: string; status: "going" | "maybe" | "declined" | "withdrawn" }
  | { type: "waitlist_joined" | "waitlist_promoted"; eventId: string; occurrenceKey: string; personKey: string }
  | { type: "gathering_changed"; eventId: string; fields: Array<"time" | "place" | "online" | "title"> }
  | { type: "gathering_cancelled" | "gathering_published"; eventId: string }
  | { type: "path_joined" | "path_left"; personKey: string; userId?: string | null; email?: string | null; name?: string | null; pathId: string; source: string; consent?: boolean }
  | { type: "form_submitted"; formType: string; submissionId: string; email: string | null; name: string | null; consentPaths: boolean }
  | { type: "submission_status"; submissionId: string; formType: string; status: string }
  | { type: "housing_status"; reservationId: string; status: string; email: string | null }
  | { type: "member_joined"; userId: string }
  | { type: "member_admitted"; userId: string }
  | { type: "stage_advanced"; userId: string; stage: string };

// server/lib/commsSink.ts
export const commsSink: { fire(t: CommsTrigger): void; register(handler: (t: CommsTrigger) => Promise<void>): void };
// fire() schedules the handler with setImmediate, catches and logs everything, never throws.

// server/lib/comms/postOffice.ts
export function post(deps: PostOfficeDeps, email: OutgoingEmail): Promise<PostResult>;
export function drain(deps: PostOfficeDeps, opts?: { limit?: number; budgetMs?: number }): Promise<{ sent: number; failed: number; skipped: number; expired: number; requeued: number }>;

// server/lib/comms/transport.ts
export type TransportResult = { ok: true; providerId: string } | { ok: false; retryable: boolean; status?: number; error: string };
export interface Transport { name: string; send(m: TransportMessage): Promise<TransportResult> }

// server/lib/comms/journeys.ts
export function enroll(deps, input: { journeyKey: string; contactId: string; subjectRef: string; facts?: Record<string, unknown>; anchorAt?: Date }): Promise<{ enrollmentId: string; created: boolean }>;
export function stop(deps, where: { journeyKey?: string; contactId?: string; subjectRef?: string }, reason: string): Promise<number>;
export function touch(deps, subjectRefPrefix: string): Promise<number>;   // sets next_check_at = now for matching active enrollments
export function tick(deps, opts?: { limit?: number }): Promise<{ checked: number; posted: number; stopped: number }>;
```

The rest are named in their sections:
- `ensureContact`, `permissionFor` and `setPermission` (5.3)
- `signLink` and `verifyLink` (5.4)
- `renderTemplate` and `renderLetter` (5.5)

---

## 5. Behaviour

### 5.1 Post office

**One door.**
- Every email any code sends goes through `post()`, which writes the `comms_messages` row first and sends second.
- `sendResendEmail` keeps its name and its result shape (`{ sent, reason }`) for the existing callers, and becomes a thin call to `post()` with `kind: "essential"` and `urgent: true`.
- The spine's `NotifyDeps.sendEmail` posts `kind: "notices"`:
  - idempotency key `notify:<notificationId>`;
  - `digest:<userId>:<YYYY-MM-DD>` for the daily digest;
  - the existing `brief:<week>:<user>` key for the weekly brief.
- `scripts/check-one-mail-door.mjs`:
  - fails if any file outside `server/lib/comms/transport.ts` calls the provider;
  - fails on any `fetch` to a provider host, or any import of a mail SDK, outside it;
  - wired into the `ci.yml` gate list beside its siblings;
  - prints what it scanned and what it found, so a pass shows its denominator.

**`post()`:**
1. Validate the address. Bad addresses become `skipped:bad_address`.
2. Upsert the contact.
3. Insert the row (a duplicate idempotency key returns `duplicate` with the existing row's id).
4. If `urgent`, attempt the send in this request with a 10 second timeout.
5. Otherwise leave it queued for the drain.

**Checks, made at insert time and again at send time:**
- Suppression: blocks everything except `essential`. Essential mail to a suppressed address still goes, because the person just asked for it.
- Permission: `permissionFor(emailKey, kind)`.
- The pause switch: holds every kind except `essential` and `notices`.
- The module lifecycle (5.16).
- The daily cap: `comms.daily_cap` automated emails per contact per 24 hours. It counts kinds `paths` and `letters`; `events`, `essential` and `notices` are exempt.
- Over the cap, the row is deferred: `send_after` moves to the next window, never dropped.

**`drain()`:**
- Selects queued rows that are due by `send_after` and `next_attempt_at`, oldest first.
- Claims each with `UPDATE ... SET status='sending' WHERE id=? AND status='queued'`, then sends at `comms.send_rate_per_second`.
- Stops at `limit` (default 200) or `budgetMs` (default 120000).
- Expired rows become `expired`.
- A `sending` row older than 10 minutes goes back to `queued`. Resend's idempotency key, which equals our row id, makes the resend safe.
- Retryable failures (network, 429, 5xx) back off at 1m, 5m, 30m, 2h and 6h, then become `failed`. A 4xx is `failed` at once, with the provider's message in `last_error`.

**Expiry defaults** (set by the caller):
- notices: `comms.notice_expiry_minutes` after insert (default 120), because a late notice surprises more than a missed one, which is regen's rule kept;
- event reminders: the gathering's start;
- recaps: 7 days;
- everything else: none.

**Jobs:** `registerJob("comms-post-office", 60_000, drain)` and the journeys tick. Both return early with a reason when nothing is configured.

**Admin "run now"** (`POST /api/admin/comms/run`, body `{ job }`) runs drain, journeys or polls synchronously and answers the summary. The e2e suites drive time through it, because they run with the scheduler off.

### 5.2 Transport and Resend

- **The endpoint.** Resend over `fetch` against `process.env.RESEND_API_BASE || "https://api.resend.com"`. The key comes from the secrets plane (`resend_api_key`, env fallback `RESEND_API_KEY`).
- **Headers on every send:**
  - `Idempotency-Key: <row id>`;
  - `tags: [{name:"msg", value:<row id>}, {name:"kind", value:<kind>}]`;
  - for every kind except `essential`: `List-Unsubscribe: <https one-click link>, <mailto:sender?subject=unsubscribe>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - Plus `html`, `text`, `reply_to` and `attachments` when present.
- **Batch sending** is optional: up to 100 per call, never with attachments.
- **No key, no sender, or no verified domain:** `post()` records `skipped:not_configured` and tells the caller. It never throws.
- **`server/lib/comms/resendAdmin.ts`** calls:
  - `GET /domains`, `POST /domains`, `GET /domains/:id` and `POST /domains/:id/verify`, for status and the DNS records to show;
  - `POST /webhooks`, with our URL and the events `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed` and `suppressed`. It stores the returned `signing_secret` as the secret `resend_webhook_secret`.
  - A key without the rights answers with the manual steps instead.

### 5.3 Address book, permissions, suppressions

- **`ensureContact({ email, name?, userId?, source, timezone? })`:**
  - The key is the address trimmed and lowercased; nothing else is folded.
  - It links `user_id` when known and keeps the first source.
- **Permissions:**
  - `essential`: always yes.
  - `events`: yes for a gathering the person said yes to.
  - `paths`:
    - a member who chose a path at sign-up or in their profile: yes, basis `account`;
    - a non-member: only after ticking the form's box (`comms-settings.consentText` is the words), basis `asked`, with evidence.
  - `letters`: only on an explicit yes; a non-member confirms by email (double opt-in).
  - `notices`: follows `users.prefs` exactly as today. The preferences page writes `emailsOff` for members.
- **Defaults:** a backfilled or newly seen address gains no kind beyond what its source implies.
- **Unsubscribe, one-click or from the page:**
  - writes `no` for that kind, or `suppressions.unsubscribed_all` for "stop everything";
  - also stops that person's active enrollments in journeys of that kind.
- **Webhook suppressions:**
  - `bounced` when the bounce is permanent or of unknown type;
  - `complained` on a complaint;
  - `email.suppressed` writes `bounced`.
- **Manual suppress and restore** in People. Restoring a `complained` address asks for a reason, which is stored in `detail`.

### 5.4 Signed links and the public pages

- **Format:** `signLink(purpose, payload, ttlDays)` gives `base64url(json).base64url(hmac)`, using HMAC-SHA256 under a key derived with HKDF from `VILLAGE_SECRETS_KEY`, label `comms-links-v1`. With no secrets key (development only) it uses a per-process random key.
- **Payload:** ids only. Never an email address or a name.
- **Expiry and failure:** expiry is in the payload. `verifyLink` returns null on any mismatch, expiry or wrong purpose.
- **No action on GET.** Every page shows what will happen and acts on a POST. One-click unsubscribe is the RFC 8058 POST. Link scanners GET every link in an email, and a GET that acts is a GET that a scanner fires.
- **Rate limits:** every public route uses `overLimit` with a per-IP bucket.
- **Pages,** in one lazy chunk, `client/src/pages/EmailPages.tsx`:
  - `/email/preferences?t=` shows every kind with its switch, a 30-day pause, and "stop everything". It works for members and non-members alike.
  - `/email/unsubscribe?t=` shows a confirm button that POSTs.
  - `/email/a?t=` is the action page for guest confirm, can't make it, vote, recap answers, RSVP to the next gathering, and letters confirm. It shows the result and lets the person change their answer.

### 5.5 Words

**The renderer.** Port ReGen Civics' markdown letters (at `C:\Users\taren\Downloads\regen-civics-clean`, read on `origin/main`):
- sources: `shared/emailMarkdown.ts`, `shared/letterHtml.ts`, `shared/letterLayout.ts` and `server/lib/emailHtml.ts`;
- target: `shared/comms/markdown.ts` and `shared/comms/letterHtml.ts`.

What the port does:
- keeps table-based buttons and `{{merge}}` tokens;
- styles from the village's brand seed through `shared/brandTokens.ts`, with the logo from `brand.images.logo`;
- produces a plain-text part and a preheader;
- adds a footer: the village name, the postal address from comms settings, "Why you got this", and the preferences link.

Sanitise with the same allowlist idea as `server/lib/emailHtml.ts`. Check whether a sanitizer is already a dependency before adding one, and follow `CLAUDE.md`'s rule about ESM-only packages.

**Merge fields.** `shared/comms/mergeFields.ts` declares the catalogue per trigger; the editor's picker reads it.

| Group | Fields |
|---|---|
| common | `village.name`, `village.url`, `person.firstName`, `person.name`, `links.preferences`, `footer.address` |
| gathering | `gathering.title`, `gathering.when` (village time), `gathering.whenLocal` (the reader's zone when known), `gathering.where`, `gathering.joinLink`, `gathering.url`, `gathering.cantMakeIt`, `gathering.calendarLinks`, `gathering.hostName`, `gathering.description` |
| poll | `poll.options` (a block of one-click links), `poll.closesAt`, `poll.leading` |
| recap | `recap.body`, `recap.recording`, `recap.questions` (rendered links), `nextGathering.title`, `nextGathering.when`, `nextGathering.rsvpLink` |
| path | `path.name`, `path.nextStep`, `path.nextStepLink`, `path.pageUrl`, `path.contactName`, `path.contactEmail` |
| letter | `letter.body` |

A missing value renders its declared fallback. A preview that would show an empty field shows the editor a warning.

**Templates:**
- **Platform defaults** live in `shared/comms/defaults/templates.ts`, keyed by template key, each with a `version`.
- **Reads:** the village's live row when one exists, else the platform default.
- **Adopting.** Turning a journey on, or saving an edit, copies the current default into `comms_templates` with `platform_version` set. From then on the village holds its own copy.
- **Edits** create a new version and retire the old one; restore makes an old version live again.
- **Platform upgrades.** When `platform_version` is less than the default's version, Words shows "an improved version is available" side by side, and adopting is one click. Nothing changes a village's words by itself.
- **Preview equals send.** The preview endpoint calls the same `renderTemplate` the post office's callers use, with sample data or a real person.
- **Send me a test:** an `essential` post to the requesting admin, with origin `comms.test`.

**The default template keys,** all written by lane B3 in Rye's voice and voice-gate clean:
- **Gatherings:** `gathering.confirm`, `gathering.guest_confirm`, `gathering.reminder_day`, `gathering.reminder_soon`, `gathering.changed`, `gathering.cancelled`, `gathering.waitlisted`, `gathering.promoted`, `gathering.host_nudge`, `gathering.recap_came`, `gathering.recap_missed`.
- **Time polls:** `poll.invite`, `poll.locked`, `poll.moved`.
- **Paths:** `path.<id>.welcome`, `path.<id>.first_step`, `path.<id>.meet_us`, `path.<id>.stories` and `path.<id>.check_in`, for each of `resident`, `investor`, `steward` and `prosperity-creator`.
- **Joining and membership:** `member.welcome.day0`, `member.welcome.first_quest`, `member.welcome.meet_us`, `member.welcome.check_in`, `joining.received`, `joining.meet_us`, `joining.check_in`.
- **Letters and consent:** `letters.confirm` and `letter.layout`.

### 5.6 Journeys

**Definitions** live in `shared/comms/defaults/journeys.ts`:

```ts
interface JourneyDefinition {
  key: string; kind: "event" | "path" | "joining" | "member" | "poll";
  trigger: "rsvp_going" | "guest_confirmed" | "gathering_published" | "path_joined" | "membership_requested" | "member_joined";
  emailKind: EmailKind; version: number;
  steps: JourneyStep[]; stops: StopKey[];
}
interface JourneyStep {
  key: string;
  anchor: "enrolled" | "event_start" | "event_end";
  offsetMinutes: number;                 // negative = before the anchor
  window: "any" | "daytime";             // daytime = comms.quiet_* in the reader's zone (village zone when unknown)
  audience: "all" | "came" | "missed";
  templateKey: string;
  skipIf: ConditionKey[];
  catchUp: "skip" | "latest";            // what a late enrollment does with steps already past
  maxLateMinutes: number;                // a step more than this late is skipped
}
```

**The defaults:**

| Journey | Trigger | Steps |
|---|---|---|
| `gathering.going` | `rsvp_going` and `guest_confirmed` | `confirm` (enrolled +0, urgent); `day` (event_start −1440, skip if signed up less than 36 hours before); `soon` (event_start −120). Stops: withdrew, cancelled, gathering removed. |
| `gathering.host` | `gathering_published`; enrolls the host | `nudge` (event_end +`comms.host_nudge_minutes`). Skipped if a recap was already sent or nobody RSVP'd. |
| `member.welcome` | `member_joined` | day 0, 3, 7, 14 |
| `joining.request` | `membership_requested` | day 0, 5, 14. Stops: admitted, declined. |
| `path.<id>` | `path_joined` | day 0, 2, 5, 10, 21 |

- Path goals and skip rules are in 5.11.
- Path, member and joining steps use `window: "daytime"`. Event steps use `"any"`, because they are bound to the clock of the gathering.
- No gathering step is sent while the gathering's time poll is open (condition `time_still_being_voted`). The steps wait for the lock.

**The planner** is `shared/comms/journeyPlan.ts`, pure and exhaustively unit-tested. It takes the definition, the enrollment (with `enrolledAt`), the live facts (event start and end, poll state, attendance, and the condition answers), `now`, the reader's zone and the set of step keys already posted. It returns:
- `due[]`, with each step's `sendAfter` after the window is applied;
- `skipped[]`, each with its reason;
- `nextCheckAt`;
- `finished`.

**Catch-up:**
- a step whose time passed before enrollment and is more than `maxLateMinutes` late is skipped;
- `latest` sends only the most recent of several overdue steps;
- this is the rule that stops "In 7 days" going out a day before.

**The tick:**
1. Reads active enrollments with `next_check_at <= now` (bounded).
2. Loads facts, live.
3. Applies stop rules.
4. Posts each due step with key `j:<journey>:<step>:<enrollmentId>`.
5. Writes `next_check_at`.

`touch("event:<id>")` runs on every change to a gathering, so moved times re-plan on the next tick.

**Village state** sits in `comms_journeys`:
- `state` is off or on;
- `definition` is NULL while the platform default applies;
- every save writes `comms_journey_versions` and bumps `version`;
- enrollments keep the version they started on.

**Journeys screen:**
- the timeline of each journey, with each step's numbers (5.12 outcomes);
- buttons: Turn on, Turn off, Send me a test (per step), and Walk someone through it;
- step editing: offset, window, audience, words link, skip rules;
- each journey's number of active enrollments, with a Stop action.

Walk someone through it runs the planner against a real or made-up person and draws every email they would get and when.

### 5.7 Event emails

Handlers in `server/lib/comms/eventEmails.ts`. They are fired by the sink from `rsvp()`, `withdrawRsvp()`, the waitlist routes, `firePromotionSink`, `updateGathering()` and `deleteGathering()`.

- **RSVP going:**
  - `ensureContact` for the member or guest;
  - enroll in `gathering.going`, with subject `event:<id>:<occ>`.
  - The `confirm` step posts urgently. It carries an `.ics` file (`server/lib/comms/ics.ts`: METHOD:REQUEST, a stable UID `<eventId>-<occ>@<host>`, SEQUENCE from `event_comms.ics_sequence`) and add-to-calendar links for Google and Outlook.
- **Withdraw:** stop the person's enrollment. No email.
- **Waitlist joined:** `gathering.waitlisted`. **Promoted:** `gathering.promoted`, then enroll.
- **Time or place changed:**
  - bump `ics_sequence`;
  - post `gathering.changed` to everyone going, with an updated `.ics`;
  - `touch` the subject, so reminders re-plan.
- **Cancelled:**
  - post `gathering.cancelled` (`.ics` METHOD:CANCEL) to everyone going or waitlisted;
  - stop every enrollment on the subject.
- **Online gatherings:** the join link is `/events/:id/join`, which redirects to the gathering's current `online_url`, so a changed room never breaks an old email.
- **Can't make it:**
  - the signed link `cant_make_it` shows a confirm page;
  - the POST calls `withdrawRsvp`, which frees the seat and serves the waitlist.
- **Per-gathering controls** live in the Calendar panel's editor and on the gathering page, for anyone holding `event.manage`:
  - reminders: village default, custom (choose offsets), or off;
  - guests: village default, on, or off;
  - who hosts.
  All stored in `event_comms`.

### 5.8 Guests

A guest is somebody with no account on an invite-only village. They may RSVP when all of these hold:
- the `comms` module is `members` or `public`;
- the gathering's layer is `public`;
- its status is `scheduled`;
- its seat price is zero;
- its guest setting resolves to on.

**The flow:**
1. A form on the gathering page asks for name, email, and optionally the time zone (read from the browser).
2. We write `event_guest_requests` (pending, a token hash, expiry 48 hours) and post `gathering.guest_confirm` (urgent, essential, because they just asked).
3. Confirming calls `rsvp(pool, eventId, "guest:<contactId>", "going", ...)` inside the existing row lock, so capacity holds exactly. The `guest_confirmed` trigger then enrolls them.

**Rules:**
- No reminder before confirmation.
- A contact seen before confirms in one click from a signed `rsvp_next` link in any later email.
- Rate limits are per IP and per address.
- The organiser's list shows the name with "guest" and never the address.
- `listRsvps` and every name join learn the `guest:` prefix, reading the name from `comms_contacts`.

### 5.9 Attendance, recaps, feedback

- **Attendance.** The host ticks who came on the gathering page, writing `event_attendance` per date and per person (`came` or `missed`). "Everyone who said yes came" is one button.
- **Recap.** The composer is on the gathering page and in the Calendar panel. It has:
  - the body (markdown);
  - an optional note for people who missed it;
  - an optional recording link;
  - a draft button (5.14).
- **Sending the recap:**
  - With attendance marked, people who came get `gathering.recap_came` and people who said yes and missed it get `gathering.recap_missed`.
  - With no attendance, everyone who said yes gets `gathering.recap_came`, whose words read right either way.
  - Each email carries the two questions from settings as signed `recap_answer` links. The first is a one-click yes or no on the page; the second is a text box.
  - It also carries the next gathering with an `rsvp_next` link.
- **Answers** land in `event_feedback`. The host sees them in the recap panel.
- **Nudges.** The host nudge (5.6) links straight to the composer. No separate survey email is ever sent.

### 5.10 Live time vote (Rye, 2026-10-02)

Anyone holding `event.manage` can give a gathering a time vote. There are two modes:

- **`once`**, for a single gathering. Two to eight candidate starts (DATETIME, same convention as `events.starts_at`), each with a duration.
- **`weekly`**, for a recurring series such as community sessions. Candidate weekly slots: weekday plus start minute in village time, plus a duration. The series' recurrence follows the winner.

**Voting** is approval voting: tick every time you can make. A vote is one row per option per person.
- Members vote on the gathering page.
- Guests vote from one-click `time_vote` links in `poll.invite`, or from their confirmation email.
- Changing a vote is free while the poll is open.

**Live.** The gathering's own time follows the leader as votes arrive, so what Rye asked for is literal: whichever time is winning IS the time on the calendar and the gathering page, marked "time still being voted". The page refreshes the tally every 10 seconds while visible.

**Rules** live in `shared/timePoll.ts`, pure and unit-tested. They are copied from ReGen Civics' season schedule (`shared/seasonSchedule.ts` there) and made general:
- **Leader:** the most approvals. A tie keeps the current leader. With no votes, the first option leads.
- **Applied time:** the pin when set; else the leader once it has led for `settle_minutes` (default `comms.time_poll_settle_minutes`, 0, so it follows live); else the time last applied.
- **Once mode:**
  - the poll locks at `closes_at`;
  - the default is the earliest candidate minus `freeze_hours` (default `comms.time_poll_freeze_hours`, 48);
  - the host can lock now, reopen, or pin.
  - On lock: post `poll.locked` (with `.ics`) to everyone who voted or RSVP'd. Gathering reminders start, because `time_still_being_voted` turns false.
- **Weekly mode:**
  - the vote stays open;
  - an occurrence inside the next `freeze_hours` never moves;
  - a move posts `poll.moved` once per move to everyone RSVP'd to the series' upcoming dates and everyone who voted;
  - reminders already sent stay sent.
- **Every move:**
  - writes `events.starts_at`, and `ends_at` or `recurrence`, through `updateGathering`, so seat fees, the waitlist and the sink all see an ordinary edit;
  - bumps `ics_sequence`;
  - fires `gathering_changed` with field `time`. Once mode emails nothing for moves while open; weekly mode emails once per move.
- **Names.** Voter names are shown to signed-in members when `show_names` is on (default on). The public sees counts.
- **Job:** `registerJob("comms-time-polls", 60_000, ...)` locks due polls and applies settled leaders, and "run now" drives it.

### 5.11 Paths

- **`path_enrollments`** is written whenever:
  - somebody chooses a path at sign-up (`server/routes/register.ts`);
  - a profile edit adds or drops one (`server/routes/profile.ts`, by diffing old and new);
  - a public form maps to a path through `FORM_TYPE_TO_PATHWAY` and its box is ticked;
  - a housing request arrives (resident);
  - an investor packet is requested (investor);
  - a Work With Us proposal arrives (prosperity-creator);
  - steward interest arrives (steward).
  Leaving a path sets `left_at` and stops the journey.
- **Backfill.** Members' current `users.paths` are recorded with source `backfill` and get NO email unless an admin chooses "include people already on this path" on the journey.
- **The tick-box** on every public form that feeds a path reads `comms-settings.consentText`. The default words are "Walk me through the next steps by email. A few emails over the next month, and you can stop any time." Unticked means the acknowledgement only.
- **Each path journey,** day 0, 2, 5, 10 and 21:
  - welcome;
  - first step, skipped when done;
  - come meet us: the next public gathering with `rsvp_next`, skipped if already RSVP'd;
  - stories;
  - a person checks in.

**First steps and goals.** Each condition is one query in `server/lib/comms/conditions.ts`:

| Path | First step done when | Goal (stops the journey) |
|---|---|---|
| resident | has a housing request or a visit inquiry | housing reservation `reserved` |
| investor | packet requested | `investor_path_facts` `agreement_signed`; until that has a writer, an `investor-call` submission accepted |
| steward | raised a hand for a seat | seated in a role |
| prosperity-creator | a Work With Us proposal | a venture listed; until that has a writer, the proposal accepted |
| joining | (none) | admitted, or the request declined |
| member.welcome | claimed a first quest | consented a quest, or came to a gathering |

**Day 21 hands off to a person.** It posts the check-in, and it also sends the path's contact person a notification through the spine (new type `comms_path_handoff`, with its `emailCadenceFor` case): "<first name> has been on the <path> path for three weeks. Write to them." The contact person is `comms-settings.pathContacts[pathId]` (a user id), falling back to the path's team inbox.

**The investor journey** is held until `comms-settings.investorWordsReviewed` is set. Until then it sends only the welcome and the hand-off. Rye ruled the wording needs his eyes or counsel's.

**Rung emails** are optional per journey. The tick compares `last_rung` with `server/repos/pathLadders.ts`'s derived rung, and posts "you reached X, here is the next step" when it moves.

### 5.12 Letters and outcomes

**Letters** port the ReGen Civics Outbound safe send (`server/lib/newsletter-issue-email.ts` there):
- **The confirm token** is bound to the body hash, the audience and the count, and lasts 15 minutes.
- **On confirm:**
  - an idempotency key;
  - a status claim;
  - a recipient snapshot into `comms_letter_recipients`, then one `post()` per recipient (kind `letters`, which re-checks permission at send time);
  - schedule or send now;
  - History with per-letter numbers;
  - cancel or reschedule.
- **Audiences:**
  - every member with `letters` yes;
  - people on a path;
  - a gathering's attendees;
  - every contact with `letters` yes.
- **Caps:** at most `comms.letters_per_day` (default 3) and 10 minutes apart.

**Outcomes** (`server/lib/comms/outcomes.ts`). For each journey step:
- sent, delivered, bounced, unsubscribed after;
- what people did next: RSVP'd, came, took the path's next step, reached the goal within 7 days of the step.

Shown on the Journeys screen. Opens are not tracked.

### 5.13 Members see it, and may propose changes (ruling 2026-09-25)

- **A member page lists every journey:** whether it is on, its steps and timing, and each email's words rendered with sample data. It also shows the comms dials. It is read-only.
- **Each item has a "Propose a change" door.**
  - Use the village's existing proposal path for dials if one fits; find it first (search `mechanics_proposals`, `mayStillSee`, `proposal.open`).
  - Otherwise use a `submissions` row of type `comms-change`, which lands in the admin queue.
- **Writes stay gated on `comms.manage`.**

### 5.14 Helpers

**Draft a recap.** A button in the composer builds a draft from facts:
- the gathering, the date, how many came, and the host's notes;
- the linked call synthesis when the automation module has one.

When the platform assistant is configured, it may polish the host's notes. Find the existing call path first and reuse it. It never sends: a person reads it and presses Send, per the ruling of 2026-09-24.

### 5.15 Setup and settings: every vital detail a founder supplies, in Admin (Rye, 2026-10-02)

One **Settings** screen opens with the setup checklist. Every item is editable in place, then and later. The Overview shows a banner pointing here until the required items are green.

| # | Item | Where it is stored | Required to turn on |
|---|---|---|---|
| 1 | The Resend API key (write-only, last 4 shown) | secret `resend_api_key` | yes |
| 2 | Sending domain: add it, show its DNS records, check verification | Resend Domains API; domain in `comms-settings.domain` | yes |
| 3 | Sender name and address (the address is on the verified domain) | `comms-settings.senderName`, `email-config.sender` | yes |
| 4 | Delivery reports: one button creates the webhook and stores its secret; manual paste as fallback | secret `resend_webhook_secret`; `comms-settings.webhookConnectedAt` | yes |
| 5 | Postal address for the footer | `comms-settings.postalAddress` | yes |
| 6 | Reply-to inboxes per path: the old Email Settings, moved here | `email-config` inboxes | no (falls back to the sender) |
| 7 | Who writes back for each path | `comms-settings.pathContacts` | no |
| 8 | The words of the tick-box on public forms | `comms-settings.consentText` | no (default given) |
| 9 | The two recap questions | `comms-settings.recapQuestions` | no (default given) |
| 10 | Who runs comms: holders of `comms.manage`, with a link to grant it to a role | the capability gate | no |
| 11 | Investor words reviewed | `comms-settings.investorWordsReviewed` (who and when) | only for the investor journey |
| 12 | Rehearsal inbox: who receives every email while rehearsing | `comms-settings.rehearsalTo` (default the admins) | no |
| 13 | Test email to yourself, delivered | the latest `comms.test` row being `delivered` | yes |

Below the checklist sit the dials:
- quiet hours and the daily cap;
- default reminder times and the host nudge;
- the recap window;
- guests by default;
- time-vote freeze and settle;
- letters per day;
- retention;
- the send rate;
- open and click tracking, both off, with a sentence on why;
- Pause all.

Dials are game variables (5.18). Everything else is the `comms-settings` document, read through `readCommsSettings()`, which back-fills defaults on read.

**Launch and go-live:**
- `shared/launchRequirements.ts` gains real checks for the sender, the verified domain and delivery reports, replacing the manual domain tick.
- `client/src/components/admin/goLivePlan.ts` step 7 points at Comms Settings.

### 5.16 Rehearsal, pause, and the module

**The `comms` module** (`shared/modules.ts`):
- `tier: "included"`, `dataClass: "member-pii"`, `group: "connect"`, `setup: "required"`;
- a readiness reader that answers ready when items 1 to 5 and 13 are green;
- `capabilities: ["comms.manage"]`;
- `variableKeys`: the `comms.*` list;
- `apiPrefixes`: `/api/admin/comms`, plus the module-gated public prefixes.

**Its lifecycle** decides what sends:

| Lifecycle | What happens |
|---|---|
| `off` | No journey enrolls or sends; guest RSVP, time-vote emails and letters are off. The post office, unsubscribe, preferences, the webhook, essential mail and member notices run regardless: they are plumbing. |
| `preview` | **Rehearsal.** Everything runs, and every email of kind `events`, `paths` or `letters` goes to `comms-settings.rehearsalTo` instead of the person. The subject is prefixed "Rehearsal:" and a banner names who it would have reached. Rows record status `rehearsed` and `rehearsal_to`. Essential mail and notices still reach the real person. |
| `members` / `public` | Live. Guest RSVPs need `public`. |

**Pause all** (`comms-settings.paused`) holds every kind except `essential` and `notices`. Rows stay queued and may expire.

### 5.17 Privacy

- Every new table holding an address or a person joins three things:
  - erasure (`server/lib/erasure.ts`);
  - the profile export;
  - the retention sweep (`comms.retention_months`, default 18).
- Bodies are cleared after 30 days, and raw provider events are deleted after 30 days.
- Erasure deletes the person's contact, permissions, enrollments, path enrollments, guest requests, votes, attendance and feedback. It also blanks their message rows' address and bodies.
- Sensitive notices (restorative intake, conflict) never carry content into an email. They link to the app, as #386 does.

### 5.18 Settings registry

**Game variables** (`shared/gameVariables.ts`, category "Email and reminders"):

| Key | Default |
|---|---|
| `comms.quiet_start_hour` | 8 |
| `comms.quiet_end_hour` | 20 |
| `comms.daily_cap` | 2 |
| `comms.event_reminder_minutes` | "1440,120" |
| `comms.host_nudge_minutes` | 60 |
| `comms.recap_window_days` | 3 |
| `comms.guests_default` | on |
| `comms.time_poll_freeze_hours` | 48 |
| `comms.time_poll_settle_minutes` | 0 |
| `comms.letters_per_day` | 3 |
| `comms.retention_months` | 18 |
| `comms.send_rate_per_second` | 2 |
| `comms.notice_expiry_minutes` | 120 |
| `comms.open_tracking` | off |
| `comms.click_tracking` | off |

**The `comms-settings` document** (`app_config`):
- `senderName`, `domain`, `domainId`, `postalAddress`, `consentText`;
- `recapQuestions` (two strings);
- `pathContacts` (path id to user id);
- `investorWordsReviewed` (`{ by, at }` or null);
- `rehearsalTo` (string array);
- `paused` (boolean);
- `webhookConnectedAt`.

**Secrets:** add `resend_webhook_secret` to `BASE_SECRET_KEYS`.

**Env:** `RESEND_API_BASE` (tests only), with one line in `docs/FORK_RUNBOOK.md`.

---

## 6. Admin and member surfaces

**Admin nav group "Comms"** sits after "Day to day" in `adminNavGroups.ts`. Update `adminNavGroups.test.ts`, which pins group order. Keys and files:

| Key | Screen | File |
|---|---|---|
| `comms-overview` | Overview | `client/src/components/admin/comms/CommsOverview.tsx` |
| `comms-journeys` | Journeys | `client/src/components/admin/comms/CommsJourneys.tsx` |
| `comms-words` | Words | `client/src/components/admin/comms/CommsWords.tsx` |
| `comms-people` | People | `client/src/components/admin/comms/CommsPeople.tsx` |
| `comms-letters` | Letters | `client/src/components/admin/comms/CommsLetters.tsx` |
| `comms-sent` | Sent mail | `client/src/components/admin/comms/CommsSentMail.tsx` |
| `comms-settings` | Settings | `client/src/components/admin/comms/CommsSettings.tsx` |

- The old `email-settings` key renders `CommsSettings`, so old links still land.
- The tabs take `password` like every other tab and fetch with `API_BASE` and `authHeaders` from `client/src/components/admin/adminApi`.
- Each tab is imported statically; `Admin.tsx` is already lazy.
- **Event-page widgets** in `client/src/components/comms/`: `GuestRsvpForm`, `TimePollPanel`, `HostRecapPanel`, `AttendanceList`.
- **Member pages:**
  - the email kinds section in `NotifyPrefsPanel`;
  - the transparency page from 5.13;
  - `EmailPages.tsx` from 5.4.

---

## 7. Hook points (fired through `commsSink`, after the transaction commits)

| Trigger | Where |
|---|---|
| `rsvp_changed` | `rsvp()` in `server/lib/gatherings.ts` after the seat transaction, and `withdrawRsvp()` |
| `waitlist_joined` | the waitlist route in `server/index.ts` (around 11951) |
| `waitlist_promoted` | `firePromotionSink` in `server/lib/calendarCommunity.ts` |
| `gathering_changed`, `gathering_cancelled`, `gathering_published` | `updateGathering()`, by comparing the fields it set; `createGathering()` when status is scheduled |
| `path_joined`, `path_left` | `server/routes/register.ts`, `server/routes/profile.ts` |
| `form_submitted` | `POST /api/forms/submit` (around `server/index.ts:7840`) |
| `submission_status` | the status route (around 7914) |
| `housing_status` | `server/routes/housing.ts` create and status |
| `member_joined` | `memberJoined` in `server/lib/arrival.ts` |
| `member_admitted` | `server/lib/vouches.ts:197`, `server/lib/inviteDoor.ts:94` and the admission at `server/index.ts:7964` |
| `stage_advanced` | `recordStageEvent` (`server/index.ts:2956`) |
| investor packet | `POST /api/investor-docs/request`, as `form_submitted` with `formType: "investor-doc-request"` |

---

## 8. Testing

### 8.1 The fake provider

`server/testkit/fakeResend.ts` is a `node:http` server for tests only.
- **It implements** `POST /emails`, `POST /emails/batch`, `GET/POST /domains`, `GET /domains/:id`, `POST /domains/:id/verify` and `POST /webhooks`.
- **It records** every request.
- **It can be told to answer** 429, 500 or 422 for the next N calls.
- **It can deliver signed webhooks** (Svix format: `svix-id`, `svix-timestamp`, `svix-signature`, `v1,<base64 hmac>` over `id.timestamp.body` with the secret's base64 key after `whsec_`) to a URL. Kinds: delivered, bounced (permanent), complained and failed.
- **It answers** domains as `verified` or `pending` on request.

E2e suites boot the built server with `RESEND_API_BASE=http://127.0.0.1:<port>` and a test key. They seed the sender, the verified domain and the webhook secret through the real admin routes.

### 8.2 What each lane proves

- **Unit tests:**
  - planner, poll rules, quiet hours, catch-up;
  - merge fields and escaping;
  - markdown to HTML and text;
  - link signing (tamper, expiry, purpose);
  - Svix verification;
  - permission logic.
- **Repository tests:** each against a provisioned schema (`provisionTestDb`).
- **One e2e suite per lane**, booting the built server, scheduler off, driving time with "run now" and by moving anchors in SQL inside the test.
- **Controls:** for each guard named in an acceptance list, break it, watch a named test fail, and restore it.

---

## 9. Lanes

| Wave | Lane | Scope (sections) |
|---|---|---|
| A | F foundation | 3 (all three migrations), 4 (contracts as code), the `comms` module def with `comms.manage` everywhere a capability lives (capabilities lists, consequence line, registry, `docs/CAPABILITIES.md`), the `comms.*` variables, the notification kinds, `resend_webhook_secret`, `commsSink` and every hook call in 7, the route-module skeletons and their registrations (webhook before `express.json()`), the Comms nav group with placeholder screens, `EmailSettingsTab` moved out of `Admin.tsx`, `sendResendEmail` and its config readers moved out of `server/index.ts`, `links.ts` complete, `fakeResend.ts` complete, a minimal `post()` (insert plus urgent send), minimal `enroll/stop/touch`, `EmailPages.tsx` routes as stubs, `docs/modules/comms.md` skeleton, `MODULE_DOCS`, `FORK_RUNBOOK` line, one smoke e2e |
| B | B1 post office | 5.1, 5.2 (transport, not resendAdmin), the webhook (5.3 suppressions on delivery reports), every existing send rerouted, `check-one-mail-door.mjs`, Sent mail screen |
| B | B2 people | 5.3, 5.4 pages and member panel, backfill, 5.17, People screen |
| B | B3 words | 5.5 renderer, templates and versions, ALL default copy, Words screen |
| B | B4 setup | 5.15, 5.16, 5.2 `resendAdmin`, Overview screen, launch requirements, go-live plan, module readiness |
| C | C1 journeys | 5.6 engine, planner, tick, Journeys screen, simulate |
| C | C2 event emails | 5.7, the `.ics` builder, the join redirect |
| C | C3 guests and recaps | 5.8, 5.9, the event-page widgets |
| C | C4 time vote | 5.10 |
| D | D1 paths | 5.11 |
| D | D2 letters and outcomes | 5.12 |
| D | D3 member view, helpers, docs | 5.13, 5.14, `docs/modules/comms.md` complete, `PROVISIONING`, go-live words |
| E | integrator | merge, the full gates, the full suite on the composed tree, the end-to-end walk (section 10), fixes |

---

## 10. The end-to-end walk the integrator runs before calling it ready

Set-up: boot the built server on a private scratch schema against the fake provider. Seed through real routes: bootstrap, founder, invites, members. Then:

1. **Setup.** Complete every item in Settings through the UI with Playwright:
   - key, domain (verified by the fake), sender, delivery reports, address;
   - the test email to yourself is delivered.
2. **Rehearsal.** Turn the module to preview, RSVP as a member, and see the confirmation land at the rehearsal inbox, marked.
3. **Live gathering emails.** Turn it live and RSVP:
   - the confirmation arrives with an `.ics`;
   - "run now" at the right moments sends the day-before and starting-soon reminders;
   - moving the gathering re-plans them and sends "changed";
   - cancelling sends one notice and nothing after.
4. **Guests.** A guest asks, confirms, receives reminders; capacity holds under a concurrent burst.
5. **Recap.** Mark attendance and send the recap: the came and missed versions reach the right people; answers land; the next-gathering RSVP works in one click.
6. **Time vote.** On a once poll, votes move the time live, and the lock sends "time is set" with an `.ics`. On a weekly series, a move outside the freeze sends one notice.
7. **Paths.** A public form with the box ticked starts the path journey, and day 2 lands inside quiet hours. The goal stops it. Day 21 notifies the path contact. No tick, no journey.
8. **Letters.** Preview, test, confirm, send; History counts match.
9. **Delivery reports.** A bounce from the fake suppresses the address, and the next post is skipped with the reason. A complaint does the same. One-click unsubscribe works signed out, and the header is present on the recorded request.
10. **Coverage.** Every existing send (password reset, form acknowledgement, housing, investor packet, notices, digest, weekly brief) appears in Sent mail.
11. **Phone width.** Playwright screenshots of every Comms screen, the public pages and the event widgets.

Fix what this finds, then push `wt/comms` and read CI.
