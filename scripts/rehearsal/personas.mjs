/**
 * The six made-up people, each walked once at 390 and once at 1280.
 *
 *   1. neighbour     A Spanish-speaking neighbour on a phone, sent a link on a
 *                    messaging app. The first link she taps is an old one and
 *                    lands on the 404, whose one door takes her home. Then she
 *                    proposes for the Land Steward, confirms by email, reads
 *                    her status page.
 *   2. professional  A professional from the newsletter on a desktop. Reads the
 *                    steward page, opens the Finance Steward's full card,
 *                    proposes with two terms to talk about, confirms, reads the
 *                    status page.
 *   3. member        An existing member proposing a role for next season through
 *                    the member's door, step by step, and submitting.
 *   4. steward       The steward who decides: reads persona 2's proposal,
 *                    invites them to the conversations (our review), offers
 *                    different terms, then adopts; then answers persona 1's
 *                    application with the warm not-invited letter.
 *   5. holder        Persona 2 again, adopted: registers from the invitation,
 *                    aligns with confidentiality and the terms, and reads the
 *                    profile in their first hour, where our first 14 days
 *                    show as a strip of days, then opens the steward
 *                    training from /training and marks a lesson done.
 *                    Finds her light on the map off, turns it on, and reads
 *                    the circles map's today card.
 *   6. reviewer      The founder on the review page: an agent's batch of three
 *                    proposed changes, one edited in place, accepted together.
 *
 * Each walk is a list of acts. An act that fails stops that walk, and the
 * summary names it. The words typed are invented and plain.
 *
 * Selectors follow the pages as they are. When a page changes on purpose, an
 * act here may fail on the next night; that is the rehearsal doing its job,
 * and the fix is to update the act in the same pull request as the page.
 */
import { settle } from "./page.mjs";
import { PEOPLE } from "./seed.mjs";

const emailFor = (who, vp) => `${who}.${vp}@example.test`;

/** Waits for an email to `to` whose subject matches, and returns it. */
async function waitForMail(mail, to, subject, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = mail
      .emails()
      .filter((e) => JSON.stringify(e.body?.to ?? "").includes(to) && (!subject || subject.test(String(e.body?.subject ?? ""))))
      .pop();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no email to ${to}${subject ? ` matching ${subject}` : ""} within ${ms / 1000}s`);
}

/** The first link in an email's text whose path matches. */
function linkIn(email, pathRe) {
  const text = String(email.body?.text ?? "") + " " + String(email.body?.html ?? "");
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const url = m[0].replace(/[).,]+$/, "");
    try {
      if (pathRe.test(new URL(url).pathname)) return url;
    } catch {}
  }
  throw new Error(`no ${pathRe} link in the email "${email.body?.subject}"`);
}

/** Opens a link from an email on this rehearsal's own server. */
async function openMailLink(w, url) {
  const u = new URL(url);
  await w.goto(u.pathname + u.search);
}

async function alerts(page) {
  return page.evaluate(() => [...document.querySelectorAll("[role=alert]")].map((e) => e.innerText.trim()).filter(Boolean));
}

/** Sends the open proposal form and requires that it was accepted. */
async function sendOpenForm(page) {
  const submit = page.locator("form[data-open-proposal] button[type=submit]");
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await settle(page, 1500);
  const still = await page.locator("form[data-open-proposal]").count();
  const said = await alerts(page);
  if (still && said.length) throw new Error(`the form refused: ${said.join(" | ").slice(0, 240)}`);
  if (still) throw new Error("the form is still on screen after send");
}

async function check(page, label) {
  const box = page.getByLabel(label).first();
  if (await box.count() && await box.isVisible()) await box.check();
}

/**
 * THE APPLICATION (Phase A, 11 Nov 2026): six steps, Get to know us, About
 * you, Your value, The terms, Your first day, Review & submit, and only the
 * step you stand on is shown. Continue judges its step and moves on.
 */
async function stoneNext(page, want) {
  await page.locator("[data-stone-next]").click();
  await page.waitForTimeout(200);
  const now = await page.getAttribute("form[data-open-proposal]", "data-stone-now");
  if (want && now !== want) {
    const said = await alerts(page);
    throw new Error(`held on step "${now}" on the way to "${want}": ${said.join(" | ").slice(0, 240)}`);
  }
}

/**
 * About you comes in three short panes (design G2, M7): You, Your story, Who can
 * speak for you. Continue walks them in turn; the background-check tick is on the
 * last one, ticked once it shows.
 */
async function throughAbout(page, consent) {
  for (let i = 0; i < 4; i++) {
    const now = await page.getAttribute("form[data-open-proposal]", "data-stone-now");
    if (now !== "about") return;
    await check(page, consent);
    await stoneNext(page);
  }
  const now = await page.getAttribute("form[data-open-proposal]", "data-stone-now");
  if (now === "about") throw new Error(`held on About you: ${(await alerts(page)).join(" | ").slice(0, 240)}`);
}

/** The first value item on Your value: what it brings, how we know it is done, and the season goal it serves. */
async function valueItem(page, what, doneWhen, goal) {
  const list = page.locator("[data-goals-list]");
  await list.locator('input[id$="-0-title"]').fill(what);
  await list.locator('input[id$="-0-done"]').fill(doneWhen);
  const pick = list.locator('select[id$="-0-serves"]');
  if (await pick.count()) {
    const options = await pick.locator("option").allTextContents();
    const at = options.findIndex((o) => goal.test(o));
    await pick.selectOption({ index: at > 0 ? at : 1 });
  }
}

// ── 1. The neighbour ──────────────────────────────────────────────────────

export async function neighbour(w, ctx) {
  const page = await w.open();
  const email = emailFor("neighbour", w.vp);
  // An old link from the chat lands on the 404: the night world, one lit door
  // home, inside the first screen on a phone (Phase B, quiet states).
  await w.step("follow an old link and land off the trail", async () => {
    await w.goto("/roles/an-old-link-from-the-chat");
    await page.getByRole("heading", { level: 1, name: /Fuera del sendero|Off the trail/i }).waitFor();
  });
  await w.look("off-trail", { next: page.getByRole("link", { name: /Volver a la aldea|Back to the village/i }) });
  await w.step("take the one door home", async () => {
    const home = page.getByRole("link", { name: /Volver a la aldea|Back to the village/i });
    if ((await home.count()) !== 1) throw new Error("the 404 should offer exactly one door home");
    await home.click();
    await page.waitForURL((u) => new URL(u).pathname !== "/roles/an-old-link-from-the-chat");
  });
  await w.step("arrive on the roles page", async () => {
    await w.goto("/roles?utm_source=whatsapp");
    await page.locator("main").waitFor();
  });
  await w.look("roles");
  // Phase D: the season's goals are the commons, circles with moss for each goal reached. The seed reaches one.
  await w.step("see the season's goals as the commons", async () => {
    const drawing = page.getByRole("img", { name: /goals as circles|metas de esta temporada como círculos/i }).first();
    await drawing.scrollIntoViewIfNeeded();
    if ((await drawing.locator("[data-state=reached]").count()) !== 1) throw new Error("the commons should show one goal reached, with moss");
    if ((await drawing.locator("[data-state=seed]").count()) !== 3) throw new Error("the commons should show three goals still seeds");
  });
  // QA2-02: the founding team leads /roles, and the game's roots sit inside "Other ways to join"
  // with no second "Step one" under it.
  await w.step("one step one only: the roots sit inside Other ways to join", async () => {
    await page.locator("[data-founding-team]").waitFor();
    await page.locator("[data-other-ways] [data-archetype-step=nested]").waitFor({ state: "attached" });
    if (await page.locator("[data-archetype-step=step]").count()) throw new Error("a second Step one sits under the founding team");
  });
  // QA2-01: the founding roles are applied for from their own card, never picked on the game's board.
  await w.step("the game's board leaves the founding roles off", async () => {
    await w.goto("/roles/select");
    await page.locator("[data-founding-elsewhere]").waitFor();
    for (const name of [/Land Steward/, /Finance Steward/]) {
      if (await page.getByRole("heading", { level: 3, name }).count()) throw new Error(`a founding role is on the game's board: ${name}`);
    }
  });
  await w.look("select-founding-line", { next: page.locator("[data-founding-elsewhere] a") });
  await w.step("follow the line back to the founding team", async () => {
    await page.locator("[data-founding-elsewhere] a").click();
    await page.waitForURL((u) => new URL(u).pathname === "/roles");
    const section = page.locator("[data-founding-team]");
    await section.waitFor();
    const row = section.getByRole("button", { name: /Land Steward/ }).first();
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await page.locator(`[data-apply-role="${ctx.seed.roles.land}"]`).first().waitFor();
    await settle(page);
  });
  await w.look("founding-land", { next: page.locator(`[data-apply-role="${ctx.seed.roles.land}"]`).first() });
  await w.step("open the application", async () => {
    const link = page.locator(`[data-apply-role="${ctx.seed.roles.land}"]`).first();
    if (await link.count()) await link.click();
    else await w.goto(`/propose-a-role?role=${ctx.seed.roles.land}`);
    await page.locator("form[data-open-proposal]").waitFor();
    await settle(page);
  });
  await w.step("fill the application", async () => {
    // Get to know us: one way ticked; the step never locks.
    await check(page, /Visit the land/i);
    await stoneNext(page, "about");
    await page.fill("#propose-name", "Lucía Mora");
    await page.fill("#propose-email", email);
    await page.fill("#propose-why", "Vivo río arriba y camino la quebrada desde niña.");
    await throughAbout(page, /agree to the background check|acepto la verificación de antecedentes/i);
    await page.fill("#propose-aim", "Que el agua y la tierra se lean cada luna.");
    await valueItem(page, "Caminar la quebrada con los vecinos", "cuando tengamos el primer mapa del agua", /Clean water all year/);
    await stoneNext(page, "terms");
    const commit = page.locator("#propose-terms-commitment");
    if (await commit.count()) await commit.selectOption({ label: "30%" }).catch(() => {});
    await stoneNext(page, "first");
    const tz = page.getByLabel(/time zone|zona horaria/i).first();
    if (await tz.count()) await tz.fill("America/Costa_Rica").catch(() => {});
    await stoneNext(page, "review");
    await check(page, /I align with the Membership agreement/i);
    await check(page, /confidentiality agreement|acuerdo de confidencialidad/i);
  });
  await w.look("form-filled", { next: page.locator("form[data-open-proposal] button[type=submit]") });
  await w.step("send the application", () => sendOpenForm(page));
  await w.look("sent", { full: false });
  const confirm = await w.step("the confirm email arrives", () => waitForMail(ctx.mail, email, /./));
  await w.step("open the confirm link", async () => {
    await openMailLink(w, linkIn(confirm, /\/propose-a-role\/confirm/));
  });
  await w.look("confirmed");
  await w.step("open the status page", async () => {
    const withStatus = ctx.mail.emails().filter((e) => JSON.stringify(e.body?.to ?? "").includes(email) && /application-status/.test(String(e.body?.text ?? "")));
    if (!withStatus.length) throw new Error("no email carries a status link");
    await openMailLink(w, linkIn(withStatus.pop(), /\/application-status\//));
  });
  await w.look("status");
  return { email };
}

// ── 2. The professional ───────────────────────────────────────────────────

export async function professional(w, ctx) {
  const page = await w.open();
  const email = emailFor("professional", w.vp);
  await w.step("arrive on the steward page from the newsletter", async () => {
    await w.goto("/steward?utm_source=newsletter&utm_medium=email");
    await page.locator("main").waitFor();
  });
  // The steward page is one flow since 2026-11-11: its one main act is the founding team's invitation.
  await w.look("steward", { next: page.getByRole("link", { name: /Join the founding team/i }) });
  await w.step("tick the first steps the professional has taken", async () => {
    const boxes = page.locator("#first-steps [role=checkbox]");
    if (!(await boxes.count())) throw new Error("the steward page shows no first steps");
    await boxes.first().click();
  });
  await w.step("find a role", async () => {
    const first = page.getByRole("link", { name: /Join the founding team/i }).first();
    if (await first.count()) await first.click();
    else await w.goto("/roles");
    await settle(page);
  });
  await w.look("find-your-role");
  // Phase A: the founding team leads /roles; the professional reads the Finance Steward's card there.
  await w.step("read the founding team's Finance Steward card", async () => {
    await w.goto("/roles");
    const section = page.getByRole("region", { name: /Join the founding team|equipo fundador/i });
    await section.waitFor();
    const row = section.getByRole("button", { name: /Finance Steward/ }).first();
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await section.locator("[data-testid=pay-split]").first().waitFor();
    await settle(page);
  });
  await w.look("founding-card", { next: page.getByRole("link", { name: /Apply for this role/ }).first() });
  // QA2-02: no second "Step one" under the founding team; the roots sit inside "Other ways to join".
  await w.step("one step one only: the roots sit inside Other ways to join", async () => {
    await page.locator("[data-other-ways] [data-archetype-step=nested]").waitFor({ state: "attached" });
    if (await page.locator("[data-archetype-step=step]").count()) throw new Error("a second Step one sits under the founding team");
    if (await page.getByText(/^Step one$/i).count()) throw new Error("the page still reads Step one");
  });
  // QA2-01: the Finance Steward is not on the game's board; one line points back to the founding team.
  await w.step("the game's board leaves the Finance Steward off", async () => {
    await w.goto("/roles/select");
    await page.locator("[data-founding-elsewhere]").waitFor();
    if (await page.getByRole("button", { name: /Full card for Finance Steward/i }).count()) throw new Error("the Finance Steward is on the game's board");
    if (await page.getByRole("heading", { level: 3, name: /Finance Steward/ }).count()) throw new Error("the Finance Steward is on the game's board");
  });
  await w.look("select-founding-line", { next: page.locator("[data-founding-elsewhere] a") });
  await w.step("open the application", async () => {
    await w.goto(`/propose-a-role?role=${ctx.seed.roles.finance}`);
    await page.locator("form[data-open-proposal]").waitFor();
    await settle(page);
  });
  await w.step("fill the application with two terms to talk about", async () => {
    await check(page, /community call/i);
    await check(page, /Visit the land/i);
    await stoneNext(page, "about");
    await page.fill("#propose-name", "Ana Whitfield");
    await page.fill("#propose-email", email);
    await page.fill("#propose-why", "Fifteen years keeping the books for cooperatives; I want my craft to hold a living place.");
    await throughAbout(page, /agree to the background check/i);
    await page.fill("#propose-aim", "One set of numbers every member trusts, by the end of the season.");
    await valueItem(page, "Publish the first weekly view of our money", "every circle has read it", /Clear and trusted money/);
    await stoneNext(page, "terms");
    const groups = page.locator("[role=radiogroup]");
    const n = await groups.count();
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i);
      const label = (await g.getAttribute("aria-label")) ?? "";
      if (/Allowance|Bonus/.test(label)) {
        await g.getByLabel(/talk/i).check();
        await page.waitForTimeout(150);
        await page.getByLabel(new RegExp(`talk about: ${label}`)).fill(label === "Allowance" ? "Could the tools allowance cover my accounting software?" : "I would like to understand how the share is worked out.");
      } else {
        const accept = g.getByLabel(/accept/i);
        if (await accept.count()) await accept.check();
      }
    }
    const commit = page.locator("#propose-terms-commitment");
    if (await commit.count()) await commit.selectOption({ label: "100%" }).catch(() => {});
    await check(page, /I would like a ramp-up/i);
    await stoneNext(page, "first");
    const tz = page.getByLabel(/time zone/i).first();
    if (await tz.count()) await tz.fill("Europe/London").catch(() => {});
    await stoneNext(page, "review");
    await check(page, /I align with the Membership agreement/i);
    await check(page, /confidentiality agreement/i);
  });
  await w.look("form-filled", { next: page.locator("form[data-open-proposal] button[type=submit]") });
  await w.step("send the application", () => sendOpenForm(page));
  await w.look("sent", { full: false });
  const confirm = await w.step("the confirm email arrives", () => waitForMail(ctx.mail, email, /./));
  await w.step("open the confirm link", () => openMailLink(w, linkIn(confirm, /\/propose-a-role\/confirm/)));
  await w.look("confirmed");
  await w.step("open the status page", async () => {
    const withStatus = ctx.mail.emails().filter((e) => JSON.stringify(e.body?.to ?? "").includes(email) && /application-status/.test(String(e.body?.text ?? "")));
    if (!withStatus.length) throw new Error("no email carries a status link");
    await openMailLink(w, linkIn(withStatus.pop(), /\/application-status\//));
  });
  await w.look("status");
  ctx.carry[`professional-${w.vp}`] = { email };
  return { email };
}

// ── 3. The member ─────────────────────────────────────────────────────────

export async function member(w) {
  const page = await w.open();
  await w.step("open the member's door", async () => {
    await w.goto("/role-proposals/new");
    // B7 (wave 2): with this moon's roles open, the door asks which first; this member plans next season.
    const season = page.locator('[data-door="season"]');
    await Promise.race([season.waitFor().catch(() => {}), page.getByRole("button", { name: /Start the three questions/i }).waitFor().catch(() => {})]);
    if (await season.count()) await season.click();
    await page.getByRole("button", { name: /Start the three questions/i }).waitFor();
  });
  await w.look("door", { next: page.getByRole("button", { name: /Start the three questions/i }) });
  await w.step("start the questions", async () => {
    await page.getByRole("button", { name: /Start the three questions/i }).click();
    await settle(page);
  });
  let reachedShare = false;
  for (let i = 0; i < 16 && !w.stopped; i++) {
    const done = await w.step(`answer step ${i + 1}`, async () => {
      if (/step=share/.test(page.url())) return true;
      for (const ta of await page.locator("main textarea:visible").all()) if (!(await ta.inputValue())) await ta.fill("We would bring care to the kitchen and the shared table.").catch(() => {});
      for (const inp of await page.locator("main input[type=text]:visible").all()) if (!(await inp.inputValue())) await inp.fill("Shared meals").catch(() => {});
      const pick = page.locator("main input[type=checkbox]:visible, main input[type=radio]:visible").first();
      if ((await pick.count()) && !(await pick.isChecked())) await pick.check().catch(() => {});
      const sel = page.locator("main select:visible").first();
      if (await sel.count()) await sel.selectOption({ index: 1 }).catch(() => {});
      const next = page.locator("main button:visible").filter({ hasNotText: /^(Back|Quick path|All the steps|Speak instead of typing|Save and come back|Remove|Ask)/ }).last();
      if (!(await next.count())) throw new Error("no next act on this step");
      if (await next.isDisabled()) throw new Error(`the next act is disabled: ${(await next.innerText()).trim()}`);
      await next.click();
      await settle(page);
      return /step=share/.test(page.url());
    });
    if (i === 0) await w.look("first-step");
    if (done) {
      reachedShare = true;
      break;
    }
  }
  if (!reachedShare && !w.stopped) await w.step("reach the share step", async () => { throw new Error("did not reach the share step in 16 steps"); });
  const submit = page.getByRole("button", { name: /^Submit for next season/i }).last();
  await w.look("share", { next: submit });
  await w.step("add a goal for the season when asked", async () => {
    if (!(await submit.isDisabled())) return;
    // The share step asks for a seasonal goal the quick questions do not cover.
    const here = new URL(page.url());
    here.searchParams.set("step", "season");
    await w.goto(here.pathname + here.search);
    await page.getByRole("button", { name: /Add a seasonal goal/i }).click();
    await page.waitForTimeout(400);
    for (const f of await page.locator("main textarea:visible, main input[type=text]:visible").all()) if (!(await f.inputValue())) await f.fill("A shared meal every week").catch(() => {});
    await page.waitForTimeout(1200);
    here.searchParams.set("step", "share");
    await w.goto(here.pathname + here.search);
  });
  await w.step("submit for next season", async () => {
    const submit = page.getByRole("button", { name: /^Submit for next season/i }).last();
    if (await submit.isDisabled()) {
      const why = await page.evaluate(() => document.body.innerText.match(/Write at least[^\n]*/)?.[0] ?? "");
      throw new Error(`submit is disabled${why ? `: ${why}` : ""}`);
    }
    await submit.click();
    await settle(page);
    const yes = page.getByRole("button", { name: /^Yes, submit it/i }).last();
    if (!(await yes.count())) throw new Error("no confirmation was asked after Submit");
    await yes.click();
    await settle(page, 1500);
    const said = await alerts(page);
    if (said.length) throw new Error(`the submit was refused: ${said.join(" | ").slice(0, 200)}`);
    if (await page.getByRole("button", { name: /^Yes, submit it/i }).count()) throw new Error("the confirmation is still on screen after Yes");
  });
  await w.look("submitted");
}

// ── 4. The steward ────────────────────────────────────────────────────────

export async function steward(w, ctx) {
  const page = await w.open();
  const applicant = ctx.carry[`professional-${w.vp}`]?.email;
  let id;
  await w.step("find the professional's proposal", async () => {
    if (!applicant) throw new Error("persona 2 did not send a proposal at this width");
    const res = await fetch(`${ctx.base}/api/admin/open-proposals`, { headers: { authorization: `Bearer ${ctx.seed.founder}` } });
    const json = await res.json();
    id = (json.proposals ?? []).find((p) => p.email === applicant)?.id;
    if (!id) throw new Error("the proposal is not in the steward's list");
    await w.goto(`/open-proposals/${id}`);
    await page.locator("[data-terms-we-offer]").waitFor();
  });
  await w.look("reads");
  // Our review comes first (Phase A): the steward invites the professional to the conversations before anything else.
  await w.step("invite to the conversations", async () => {
    const invite = page.getByRole("button", { name: /Invite to the conversations/i }).first();
    await invite.scrollIntoViewIfNeeded();
    await invite.click();
    await settle(page, 1500);
    // The page's answer to the click, and nothing else on it (the open-talks warning is an alert of its own).
    const said = (await page.locator("[data-decision-said]").innerText().catch(() => "")).trim();
    if (!/^Invited/.test(said)) throw new Error(`invite not answered as invited: ${said.slice(0, 200)}`);
    await page.locator("[data-terms-we-offer]").waitFor();
  });
  await w.look("invited");
  await w.step("the applicant is invited to the conversations", () => waitForMail(ctx.mail, applicant, /invitation to talk/i));
  await w.step("offer different terms", async () => {
    await page.locator("[data-term-row=allowance] textarea").fill("A tools allowance each moon that covers accounting software, agreed ahead of time.");
    await page.locator("[data-term-row=bonus] textarea").fill("A share of the moon's value when its goals are met; we walk you through it in our first conversation.");
    await page.getByRole("button", { name: /Save revision 1/i }).click();
    await page.waitForTimeout(1200);
  });
  await w.look("counter-offer", { next: page.getByRole("button", { name: /Adopt for the village/i }) });
  await w.step("the applicant hears the terms changed", () => waitForMail(ctx.mail, applicant, /terms/i));
  await w.step("adopt", async () => {
    const know = page.getByLabel(/I know, and I want to adopt anyway/i);
    if (await know.count()) await know.check();
    // A second width's walk finds the role's places taken by the first: adopting is then for when one opens, chosen on purpose.
    const forASeat = page.getByLabel(/Adopt them for when a place opens/i);
    if (await forASeat.count()) await forASeat.check();
    const adopt = page.getByRole("button", { name: /^Adopt/i }).first();
    await adopt.scrollIntoViewIfNeeded();
    if (await adopt.isDisabled()) throw new Error("adopt is disabled");
    await adopt.click();
    await settle(page, 1500);
    const said = await alerts(page);
    if (said.some((s) => /not|cannot|refus|409/i.test(s))) throw new Error(`adopt refused: ${said.join(" | ").slice(0, 200)}`);
  });
  await w.look("adopted");
  await w.step("the applicant is invited", () => waitForMail(ctx.mail, applicant, /adopt/i));
  // The neighbour's application, answered with the not-invited letter: warm, never personal.
  const neighbour = emailFor("neighbour", w.vp);
  let nid;
  await w.step("find the neighbour's application", async () => {
    const res = await fetch(`${ctx.base}/api/admin/open-proposals`, { headers: { authorization: `Bearer ${ctx.seed.founder}` } });
    nid = ((await res.json()).proposals ?? []).find((p) => p.email === neighbour)?.id;
    if (!nid) throw new Error("the neighbour's application is not waiting");
    await w.goto(`/open-proposals/${nid}`);
    await page.locator("[data-our-review]").waitFor();
  });
  await w.look("our-review");
  await w.step("send the not-invited letter", async () => {
    await page.getByRole("button", { name: /Send the not-invited letter/i }).first().click();
    await page.getByRole("button", { name: /Yes, send the letter/i }).click();
    await settle(page, 1500);
  });
  await w.look("not-invited");
  await w.step("the neighbour receives the not-invited letter", () => waitForMail(ctx.mail, neighbour, /Gracias por postularte|Thank you for applying/i));
}

// ── 5. The holder's first hour ────────────────────────────────────────────

export async function holder(w, ctx) {
  const page = await w.open();
  const email = ctx.carry[`professional-${w.vp}`]?.email;
  const password = "RehearsalHolder123!";
  await w.step("open the invitation", async () => {
    if (!email) throw new Error("persona 2 did not send a proposal at this width");
    const invite = await waitForMail(ctx.mail, email, /adopt/i);
    await openMailLink(w, linkIn(invite, /\/register/));
    await page.locator("input[type=password]").first().waitFor();
  });
  await w.look("register", { next: page.locator("main button[type=submit]").first() });
  await w.step("make the account", async () => {
    const pw = page.locator("input[type=password]");
    for (let i = 0; i < (await pw.count()); i++) await pw.nth(i).fill(password);
    const boxes = page.locator("main input[type=checkbox]");
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => {});
    await page.locator("main button[type=submit]").first().click();
    await page.waitForURL((u) => !/\/register/.test(u.pathname), { timeout: 15_000 });
    await settle(page, 1500);
  });
  await w.look("landing");
  await w.step("align with confidentiality", async () => {
    await w.goto("/profile");
    const box = page.locator("[data-role-start-steps]");
    await box.waitFor();
    await box.locator("input[type=checkbox]").first().check().catch(() => {});
    await box.getByRole("button", { name: /^Align$/ }).first().click();
    await page.waitForTimeout(600);
    const pw = page.locator("[data-reconfirm] input[type=password], [data-role-start-steps] input[type=password]").first();
    if (await pw.count()) {
      await pw.fill(password);
      await page.getByRole("button", { name: /Confirm it is you/i }).first().click();
      await page.waitForTimeout(1500);
    }
  });
  await w.step("align with the terms", async () => {
    await w.goto("/profile");
    const link = page.getByRole("link", { name: /Align with Terms/i }).first();
    if (!(await link.count())) return; // nothing left to align with
    await link.click();
    await settle(page);
    const align = page.getByRole("button", { name: /^Align$/ }).first();
    await align.scrollIntoViewIfNeeded();
    await align.click();
    await page.waitForTimeout(800);
    const pw = page.locator("input[type=password]").first();
    if (await pw.count()) {
      await pw.fill(password);
      await page.getByRole("button", { name: /Confirm it is you/i }).first().click();
      await page.waitForTimeout(1500);
    }
    if (!(await page.getByText(/You aligned on/i).count())) throw new Error("the terms page does not say they aligned");
  });
  await w.step("nothing waits before the role starts", async () => {
    // Asked of the server as the holder, so a click that only looked done cannot pass.
    const token = await page.evaluate(() => localStorage.getItem("village-auth-token"));
    const res = await fetch(`${ctx.base}/api/profile/role-start-steps`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json();
    const left = (body.waiting ?? []).flatMap((a) => a.steps.map((s) => s.step?.kind ?? s.step?.key ?? JSON.stringify(s.step)));
    if (left.length) throw new Error(`still waiting on: ${left.join(", ").slice(0, 200)}`);
  });
  await w.step("read the profile", async () => {
    await w.goto("/profile");
    await settle(page, 1500);
  });
  await w.look("profile");
  // The moon garden (Phase C, lane C2): My moon opens on this moon as a golden
  // spiral of days with its four chapters and one bed per role, and the board
  // draws no ring or percent.
  await w.step("see this moon on a spiral, with a bed for the role", async () => {
    if (w.vp === "phone") await page.getByRole("button", { name: /^Roles$/ }).first().click();
    const header = page.locator("[data-testid=moon-garden-header]");
    await header.waitFor({ timeout: 15_000 });
    await header.scrollIntoViewIfNeeded();
    const days = await page.locator("[data-testid=moon-spiral] [data-day]").count();
    if (days < 28 || days > 31) throw new Error(`the spiral draws ${days} days`);
    if (!(await page.locator("[data-testid=moon-chapter]").innerText()).trim()) throw new Error("the moon board names no chapter");
    if (!(await page.locator("[data-testid=role-bed]").count())) throw new Error("the role has no garden bed");
    // The spiral and the beds themselves (a role card's own words may carry a percent, such as a commitment).
    const drawn = [await header.innerText(), ...(await page.locator("[data-testid=role-bed]").allInnerTexts())].join(" ").replace(/\s+/g, " ");
    const band = drawn.match(/Task score|Role coverage|\d+%/);
    if (band) throw new Error(`the moon garden shows a score: "${band[0]}"`);
    if (await page.getByText("Task score", { exact: true }).count()) throw new Error("the moon board still draws the task score rings");
  });
  await w.look("moon-garden", { next: page.locator("[data-testid=moon-act]").first() });
  // The prune (11 Nov 2026): a profile wears no rung and keeps no totals beside a name.
  await w.step("the profile shows no rung, no ladder count and no stat row", async () => {
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    const rank = text.match(/Stage \d+|Stage reached|Powers open|Quests done|Paths walked/);
    if (rank) throw new Error(`the profile still ranks a person: "${rank[0]}"`);
  });
  // Phase B: Profile Today shows someone newly seated our first 14 days as a strip
  // of days (and no week strip beside it). The welcome, which waits on the
  // Welcome Steward, is named next; a day opens its own steps.
  await w.step("see our first 14 days on Profile Today", async () => {
    const strip = page.locator("[data-first-fourteen]").first();
    await strip.waitFor({ timeout: 15_000 });
    await strip.scrollIntoViewIfNeeded();
    const next = await strip.locator("[data-next-step]").getAttribute("data-next-step");
    if (next !== "welcome") throw new Error(`the next step reads ${next}, not the welcome`);
    if (await page.locator("[data-week-strip]").count()) throw new Error("the week strip shows beside the first 14 days");
    await strip.locator('button[data-day="3"]').click();
    if ((await strip.locator("[data-chosen-day]").getAttribute("data-chosen-day")) !== "3") throw new Error("day 3 did not open");
    if (!(await strip.locator('[data-step="technical-operations-conversation"]').count())) throw new Error("day 3 does not hold the Technical Operations conversation");
  });
  await w.look("first-fourteen");
  // The five archetypes as roots (11 Nov 2026): a new holder picks the roots
  // they grow from, and the quests board shows what grows from them first,
  // with one switch to see everything.
  await w.step("pick a root on the characters page", async () => {
    await w.goto("/profile/characters");
    await settle(page, 1500);
    await page.getByRole("button", { name: /Grow from this root|Save this look/ }).first().click();
    await page.waitForTimeout(1500);
    if (!(await page.getByRole("heading", { name: "Your roots" }).count())) throw new Error("the page does not show the roots just picked");
  });
  await w.look("roots");
  await w.step("see the quests that grow from those roots, and switch to all", async () => {
    await w.goto("/quests");
    await settle(page, 1500);
    const sw = page.getByRole("switch", { name: "Show only what matches my roots" });
    if ((await sw.getAttribute("aria-checked")) !== "true") throw new Error("the roots filter is not on by default once a root is picked");
    await sw.click();
    if ((await sw.getAttribute("aria-checked")) !== "false") throw new Error("the roots filter did not turn off");
    await sw.click();
  });
  await w.look("quests-by-roots");
  // The open work board (Phase C, decision 5): a plain list grouped by
  // circle, each card naming the season goal it grows with a small status
  // mark, and a goal filter that reads back the village's count of open
  // quests for that goal (the commons links here as /quests?goal=<id>). The
  // starter quests are examples, which never lead and never count, so the
  // "Fits you" card and the count are the board's own tests' to prove.
  await w.step("filter the open work by a season goal", async () => {
    await page.getByRole("heading", { name: "Open work" }).waitFor();
    if (!(await page.locator("[data-circle-group]").count())) throw new Error("the open work is not grouped by circle");
    if (!(await page.locator("article [data-status]").count())) throw new Error("the cards carry no status mark");
    const goal = page.locator("[data-goal-filter]:not([data-goal-filter=All])").first();
    await goal.click();
    await page.locator("[data-goal-thread]").waitFor();
    const cards = await page.locator("[data-circle-group] article").count();
    const growing = await page.locator("[data-circle-group] article [data-goal]").count();
    if (!cards || cards !== growing) throw new Error(`the goal filter shows ${cards} cards, ${growing} of them growing that goal`);
  });
  await w.look("open-work-goal");
  // Two training pages (the lead, 11 Nov 2026): /training chooses, and each
  // path has its own page with its own words. A holder takes the steward one
  // and marks a lesson done; the record is the server's, so it is read back.
  const doors = page.getByRole("navigation", { name: "Training pages" });
  await w.step("open the training chooser", async () => {
    await w.goto("/training");
    await doors.waitFor();
  });
  await w.look("training-chooser", { next: doors.locator('a[href="/training/steward"]') });
  await w.step("choose the steward training", async () => {
    await doors.locator('a[href="/training/steward"]').click();
    await page.waitForURL((u) => u.pathname === "/training/steward", { timeout: 15_000 });
    await settle(page, 1500);
  });
  await w.step("mark the first lesson done", async () => {
    await page.getByRole("button", { name: /Mark as done/ }).first().click();
    await page.getByText("Marked done.").waitFor({ timeout: 10_000 });
    const token = await page.evaluate(() => localStorage.getItem("village-auth-token"));
    const res = await fetch(`${ctx.base}/api/game/training/completed`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!Array.isArray(body.completed) || body.completed.length !== 1) throw new Error(`the server holds ${JSON.stringify(body.completed)} after one lesson`);
  });
  await w.look("training-steward");
  await w.step("the resident training reads the same record", async () => {
    await w.goto("/training/resident");
    await page.getByText(/^1 of \d+ lessons done$/).waitFor({ timeout: 10_000 });
  });
  await w.look("training-resident");
  // The living map (Phase D, D2): her light on the map is off until she
  // chooses it, on her own settings; then the circles map glows as hearths
  // joined by threads, with today's card naming circles and never people.
  await w.step("find her light on the map off, and turn it on", async () => {
    await w.goto("/profile#map-light");
    const box = page.getByRole("checkbox", { name: "Show my light on the map" });
    await box.waitFor();
    if (await box.isChecked()) throw new Error("a new member's light on the map should be off until they choose it");
    await box.scrollIntoViewIfNeeded();
    // A click, then wait: the switch follows the server's answer, so it turns
    // on only once the save lands (check() wants the state to change at once).
    await box.click();
    await page.waitForFunction(
      () => (document.querySelector("[data-map-light-setting] input[type=checkbox]"))?.checked === true,
      null,
      { timeout: 10_000 },
    );
    // Asked of the server as the holder, so a switch that only looked on cannot pass.
    const token = await page.evaluate(() => localStorage.getItem("village-auth-token"));
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${ctx.base}/api/map/my-light`, { headers: { authorization: `Bearer ${token}` } });
      if ((await res.json()).on === true) return;
      await page.waitForTimeout(300);
    }
    throw new Error("the server does not say her light is on");
  });
  await w.look("map-light", { journey: false, full: false });
  await w.step("open the circles map and read today", async () => {
    await w.goto("/map/circles");
    await page.locator("[data-hearths]").first().waitFor({ state: "attached" });
    const card = page.locator("[data-today-on-map]:visible").first();
    await card.waitFor();
    if ((await card.locator("[data-my-light]").getAttribute("data-my-light")) !== "on") throw new Error("today's card does not say her light is on");
  });
  await w.look("living-map", { journey: false });
}

// ── 6. The reviewer ───────────────────────────────────────────────────────

/**
 * The founder on the review page (/admin/proposals): an agent's batch of three proposed changes waits; the founder
 * reads each beside what is live, edits the role's aim in place (saved as a draft), selects the batch and accepts it.
 */
export async function reviewer(w, ctx) {
  const auth = { authorization: `Bearer ${ctx.seed.founder}`, "content-type": "application/json" };
  const call = async (method, route, body) => {
    const res = await fetch(`${ctx.base}${route}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  let ids = [];
  await w.step("an agent proposes a batch of three", async () => {
    const minted = await call("POST", "/api/agent/tokens", { name: `review ${w.vp}`, scopes: ["admin"] });
    if (minted.status !== 200) throw new Error(`no agent token: ${JSON.stringify(minted.json).slice(0, 200)}`);
    const res = await fetch(`${ctx.base}/api/agent/v1/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${minted.json.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "propose_changes",
          arguments: {
            batch: "Phase A content",
            items: [
              { kind: "page_content", target: { section: "page-home" }, body: { hero: { headline: "A village held by the people who live in it" } }, summary: "Reword the homepage headline so it says who holds the village." },
              { kind: "role_card", target: { roleId: ctx.seed.roles.finance }, body: { words: { aim: "Our money is clear, trusted and shown every moon." } }, summary: "Give the Finance Steward card an aim that says the books are shown each moon." },
              { kind: "faq_add", target: { pathway: "steward" }, body: { question: "How long does a first reply take?", answer: "We reply within a week, and the status page always says where your proposal stands." }, summary: "Add an FAQ for stewards on how long a first reply takes." },
            ],
          },
        },
      }),
    });
    const out = (await res.json()).result;
    if (out?.isError) throw new Error(`the proposal was refused: ${JSON.stringify(out.structuredContent).slice(0, 240)}`);
    ids = out.structuredContent.ids;
  });
  const page = await w.open();
  await w.step("open the review page", async () => {
    await w.goto("/admin/proposals");
    await page.locator(`[data-proposal="${ids[1]}"]`).waitFor();
  });
  await w.look("review", { next: page.getByTestId("accept-selected") });
  const edited = w.vp === "phone" ? "Our money is clear and trusted, and the books are open to every member each moon." : "Our money is clear and trusted, and every member can read the books, in plain words, each moon.";
  await w.step("edit the role's aim in place", async () => {
    const box = page.locator(`[data-proposal="${ids[1]}"] [data-field="words.aim"] textarea`);
    await box.scrollIntoViewIfNeeded();
    await box.fill(edited);
    await page.getByText(/Edits saved/).first().waitFor({ timeout: 8000 });
    const back = await call("GET", "/api/admin/proposals");
    const draft = back.json?.changes?.find((c) => c.id === ids[1])?.draft;
    if (draft?.words?.aim !== edited) throw new Error("the edit was not saved on the server");
  });
  await w.look("edited");
  await w.step("select the batch and accept", async () => {
    const all = page.getByLabel(/^Select all$/).first();
    await all.scrollIntoViewIfNeeded();
    await all.check();
    await page.getByTestId("accept-selected").click();
    await page.getByTestId("accept-outcome").waitFor({ timeout: 15_000 });
    const said = (await page.getByTestId("accept-outcome").innerText()).trim();
    if (!/^3 accepted/.test(said)) throw new Error(`not all three landed: ${said.slice(0, 240)}`);
  });
  await w.look("accepted");
  await w.step("the role card says what was accepted", async () => {
    const card = await call("GET", `/api/org/role-edit/${ctx.seed.roles.finance}`);
    if (card.json?.state?.words?.aim !== edited) throw new Error(`the card reads: ${card.json?.state?.words?.aim}`);
    const lessons = await call("GET", "/api/admin/proposals/lessons");
    if (!JSON.stringify(lessons.json).includes(edited)) throw new Error("the lessons do not show the edit");
  });
}

export const PERSONAS = [
  { id: "neighbour", run: neighbour, locale: "es-CR", member: null },
  { id: "professional", run: professional, locale: "en-GB", member: null },
  { id: "member", run: member, locale: "en-GB", member: (seed, vp) => (vp === "phone" ? seed.memberPhone : seed.memberDesktop) },
  { id: "steward", run: steward, locale: "en-GB", member: (seed) => seed.founder },
  { id: "holder", run: holder, locale: "en-GB", member: null },
  { id: "reviewer", run: reviewer, locale: "en-GB", member: (seed) => seed.founder },
];

export { PEOPLE };
