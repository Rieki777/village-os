const { chromium } = require('playwright');
const SHELL = require('url').pathToFileURL(require('path').resolve(__dirname, 'shell.html')).href;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_EXE });
  const p = await (await b.newContext({ viewport: { width: 1480, height: 1180 } })).newPage();
  const perr=[]; p.on('pageerror',e=>perr.push(String(e)));
  await p.goto(SHELL); await p.waitForTimeout(1800);
  const f = p.frames().find(fr => /grounds-v0/.test(fr.url()));
  await f.click('#enterBtn'); await p.waitForTimeout(2800);
  const out = {};
  // the shell hears grounds-ready and every promise
  out.ready = await p.evaluate(() => window.__seen.map(m=>m.type));
  // ok:true with an authoritative count
  await p.evaluate(() => { window.__reply={ok:true,count:99}; });
  out.accepted = await f.evaluate(async () => {
    const e=EVENTS[0]; evRSVP(e.id); await new Promise(z=>setTimeout(z,500));
    return {count:e.rsvp, stored:!!EV_RSVP[e.id]};
  });
  // ok:false anonymous -> revert, and a way in
  await p.evaluate(() => { window.__reply={ok:false,reason:'anonymous',href:'/login'}; });
  out.refused = await f.evaluate(async () => {
    const e=EVENTS[1]; const before=e.rsvp;
    evRSVP(e.id); await new Promise(z=>setTimeout(z,600));
    const btn=document.querySelector(`[data-ev="${e.id}"]`);
    return {count:e.rsvp-before, stored:!!EV_RSVP[e.id], label:btn?btn.textContent:'',
      maia:/Sign in/.test(document.getElementById('maiaLog').textContent),
      toast:[...document.querySelectorAll('.toast')].some(t=>/yours to keep/.test(t.textContent))};
  });
  // a claim refused the same way
  out.claimRefused = await f.evaluate(async () => {
    const q=SCENE.quests.find(x=>x.at==='greenhouse');
    claimQuest(q.q, BY[q.at].name); await new Promise(z=>setTimeout(z,600));
    return {stored:claimed(q)};
  });
  out.seen = await p.evaluate(() => window.__seen.filter(m=>m.type!=='grounds-ready').map(m=>m.type+':'+(m.on?'on':'off')));
  console.log(JSON.stringify(out,null,1));
  console.log('pageerrors', perr.length, perr.slice(0,2));
  await b.close();
})();
