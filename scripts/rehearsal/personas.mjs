/**
 * The five made-up people, each walked once at 390 and once at 1280.
 *
 *   1. neighbour     A Spanish-speaking neighbour on a phone, sent a link on a
 *                    messaging app. Proposes for the Land Steward, confirms by
 *                    email, reads her status page.
 *   2. professional  A professional from the newsletter on a desktop. Reads the
 *                    steward page, opens the Finance Steward's full card,
 *                    proposes with two terms to talk about, confirms, reads the
 *                    status page.
 *   3. member        An existing member proposing a role for next season through
 *                    the member's door, step by step, and submitting.
 *   4. steward       The steward who decides: reads persona 2's proposal, offers
 *                    different terms, then adopts.
 *   5. holder        Persona 2 again, adopted: registers from the invitation,
 *                    aligns with confidentiality and the terms, and reads the
 *                    profile in their first hour.
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
 * THE FIREFLY PATH (wave 2): the open form is six stones, one question each,
 * and only the stone you stand on is shown. Next judges its stone and moves on.
 */
async function stoneNext(page, want) {
  await page.locator("[data-stone-next]").click();
  await page.waitForTimeout(200);
  const now = await page.getAttribute("form[data-open-proposal]", "data-stone-now");
  if (want && now !== want) {
    const said = await alerts(page);
    throw new Error(`held on stone "${now}" on the way to "${want}": ${said.join(" | ").slice(0, 240)}`);
  }
}

// ── 1. The neighbour ──────────────────────────────────────────────────────

export async function neighbour(w, ctx) {
  const page = await w.open();
  const email = emailFor("neighbour", w.vp);
  await w.step("arrive on the roles page", async () => {
    await w.goto("/roles?utm_source=whatsapp");
    await page.locator("main").waitFor();
  });
  await w.look("roles");
  await w.step("pick the Land Steward", async () => {
    await w.goto("/roles/select");
    const pick = page.getByRole("button", { name: /(Select|Elegir|Seleccionar) Land Steward/i }).first();
    await pick.scrollIntoViewIfNeeded();
    await pick.click();
    await page.waitForTimeout(400);
  });
  // Phase A: a listed role is applied for ("Apply", or the Spanish "Postular"/"Aplicar").
  await w.look("select-picked", { next: page.getByRole("link", { name: /aplic|postul|apply|propon|propose/i }).last() });
  await w.step("open the proposal form", async () => {
    const link = page.getByRole("link", { name: /aplic|postul|apply|propon|propose/i }).last();
    if (await link.count()) await link.click();
    else await w.goto(`/propose-a-role?role=${ctx.seed.roles.land}`);
    await page.locator("form[data-open-proposal]").waitFor();
    await settle(page);
  });
  await w.step("fill the proposal", async () => {
    await stoneNext(page, "moon");
    await page.fill("#propose-aim", "Que el agua y la tierra se lean cada luna.");
    await page.getByLabel(/^(The goal|La meta)$/).first().fill("Caminar la quebrada con los vecinos");
    await page.getByLabel(/^(Done when|Listo cuando)$/).first().fill("cuando tengamos el primer mapa del agua");
    const serve = page.getByRole("checkbox", { name: /Clean water all year/ }).first();
    if (await serve.count()) await serve.check();
    await stoneNext(page, "why");
    await page.fill("#propose-why", "Vivo río arriba y camino la quebrada desde niña.");
    await stoneNext(page, "energy");
    const commit = page.locator("#propose-terms-commitment");
    if (await commit.count()) await commit.selectOption({ label: "30%" }).catch(() => {});
    await stoneNext(page, "about");
    await check(page, /agree to the background check|acepto la verificación de antecedentes/i);
    const tz = page.getByLabel(/time zone|zona horaria/i).first();
    if (await tz.count()) await tz.fill("America/Costa_Rica").catch(() => {});
    await stoneNext(page, "send");
    await check(page, /I align with the Membership agreement/i);
    await check(page, /confidentiality agreement|acuerdo de confidencialidad/i);
    await page.fill("#propose-name", "Lucía Mora");
    await page.fill("#propose-email", email);
  });
  await w.look("form-filled", { next: page.locator("form[data-open-proposal] button[type=submit]") });
  await w.step("send the proposal", () => sendOpenForm(page));
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
  await w.step("open the Finance Steward's full card", async () => {
    await w.goto("/roles/select");
    const card = page.getByRole("button", { name: /Full card for Finance Steward/i }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.getByRole("region", { name: /The full card for Finance Steward/i }).waitFor();
  });
  await w.look("full-card");
  await w.step("open the proposal form", async () => {
    await w.goto(`/propose-a-role?role=${ctx.seed.roles.finance}`);
    await page.locator("form[data-open-proposal]").waitFor();
    await settle(page);
  });
  await w.step("fill the proposal with two terms to talk about", async () => {
    await stoneNext(page, "moon");
    await page.fill("#propose-aim", "One set of numbers every member trusts, by the end of the season.");
    await page.getByLabel("The goal", { exact: true }).first().fill("Publish the first weekly view of our money");
    await page.getByLabel("Done when", { exact: true }).first().fill("every circle has read it");
    const serve = page.getByRole("checkbox", { name: /Clear and trusted money/ }).first();
    if (await serve.count()) await serve.check();
    await stoneNext(page, "why");
    await page.fill("#propose-why", "Fifteen years keeping the books for cooperatives; I want my craft to hold a living place.");
    await stoneNext(page, "energy");
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
    await stoneNext(page, "about");
    await check(page, /agree to the background check/i);
    const tz = page.getByLabel(/time zone/i).first();
    if (await tz.count()) await tz.fill("Europe/London").catch(() => {});
    await stoneNext(page, "send");
    await check(page, /I align with the Membership agreement/i);
    await check(page, /confidentiality agreement/i);
    await page.fill("#propose-name", "Ana Whitfield");
    await page.fill("#propose-email", email);
  });
  await w.look("form-filled", { next: page.locator("form[data-open-proposal] button[type=submit]") });
  await w.step("send the proposal", () => sendOpenForm(page));
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
    const adopt = page.getByRole("button", { name: /Adopt for the village/i }).first();
    await adopt.scrollIntoViewIfNeeded();
    if (await adopt.isDisabled()) throw new Error("adopt is disabled");
    await adopt.click();
    await settle(page, 1500);
    const said = await alerts(page);
    if (said.some((s) => /not|cannot|refus|409/i.test(s))) throw new Error(`adopt refused: ${said.join(" | ").slice(0, 200)}`);
  });
  await w.look("adopted");
  await w.step("the applicant is invited", () => waitForMail(ctx.mail, applicant, /adopt/i));
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
}

export const PERSONAS = [
  { id: "neighbour", run: neighbour, locale: "es-CR", member: null },
  { id: "professional", run: professional, locale: "en-GB", member: null },
  { id: "member", run: member, locale: "en-GB", member: (seed, vp) => (vp === "phone" ? seed.memberPhone : seed.memberDesktop) },
  { id: "steward", run: steward, locale: "en-GB", member: (seed) => seed.founder },
  { id: "holder", run: holder, locale: "en-GB", member: null },
];

export { PEOPLE };
