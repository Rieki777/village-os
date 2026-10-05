/* L8 probe 2: WHICH tenants the bottom band is placing in landscape, and what
   the composited page actually looks like. */
const { chromium } = require('playwright');
const FILE = process.env.GROUNDS_FILE;
const EXE = process.env.PW_EXE;
const OUT = process.env.SHOT_DIR || require('path').resolve(__dirname, '..', '.qa-out');
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  ['portrait-390x844', 390, 844],
  ['LAND-844x390', 844, 390],
  ['LAND-667x375', 667, 375],
  ['LAND-740x360', 740, 360],
];

const TEN = () => {
  const shown = el => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; if (parseFloat(cs.opacity || '1') < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
  const ids = ['help', 'maia', 'walkCard', 'toasts'];
  const out = { vh: innerHeight, over: document.body.dataset.bandOverflow || '0', tenants: [], box: (window.bandBox ? bandBox('bottom') : null), topbox: (window.bandBox ? bandBox('top') : null) };
  for (const id of ids) {
    const el = document.getElementById(id);
    const r = el ? el.getBoundingClientRect() : null;
    out.tenants.push({ id, exists: !!el, shown: shown(el), h: r ? Math.round(r.height) : null, t: r ? Math.round(r.top) : null, b: r ? Math.round(r.bottom) : null, disp: el ? getComputedStyle(el).display : null });
  }
  const root = getComputedStyle(document.documentElement);
  out.vars = {};
  for (const v of ['--band-b-help', '--band-b-maia', '--band-b-walk', '--band-b-toasts', '--band-t-vdrop']) out.vars[v] = root.getPropertyValue(v).trim() || 'UNSET';
  // every fixed overlay currently painted, so an overlap cannot hide
  out.painted = [...document.querySelectorAll('body > *')].filter(e => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' && cs.position !== 'absolute') return false; if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    .map(e => { const r = e.getBoundingClientRect(); return { id: e.id || ('.' + (typeof e.className === 'string' ? e.className.split(' ')[0] : '?')), t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rt: Math.round(r.right), z: getComputedStyle(e).zIndex } });
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files', '--force-device-scale-factor=1'] });
  for (const [name, w, h] of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const warns = [];
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.type() + ': ' + m.text()) });
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    await page.evaluate(() => { if (typeof leaveIntro === 'function') leaveIntro() });
    await page.waitForTimeout(900);
    const btn = await page.evaluate(() => { const b = document.getElementById('pbAttn'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
    await page.touchscreen.tap(btn.x, btn.y);
    await page.waitForTimeout(800);
    const t = await page.evaluate(TEN);
    console.log('\n===== ' + name + ' =====');
    console.log(' over=' + t.over + ' bottomBox=' + JSON.stringify(t.box) + ' topBox=' + JSON.stringify(t.topbox));
    console.log(' vars=' + JSON.stringify(t.vars));
    t.tenants.forEach(x => console.log('  tenant ' + x.id.padEnd(9) + ' shown=' + x.shown + ' disp=' + x.disp + ' h=' + x.h + ' t=' + x.t + ' b=' + x.b));
    console.log(' painted overlays:');
    t.painted.forEach(p => console.log('   ' + p.id.padEnd(14) + ' z=' + String(p.z).padEnd(5) + ' y ' + p.t + '..' + p.b + '  x ' + p.l + '..' + p.rt));
    if (warns.length) console.log(' CONSOLE: ' + warns.join(' ; '));
    await page.screenshot({ path: OUT + '/help-' + name + '.png' });
    // now scroll the list to its end and re-shoot: can the reader reach the last row?
    await page.evaluate(() => { const l = document.querySelector('#help .help-list'); if (l) l.scrollTop = l.scrollHeight });
    await page.waitForTimeout(300);
    const last = await page.evaluate(() => { const rows = [...document.querySelectorAll('#help .help-row')]; if (!rows.length) return null; const r = rows[rows.length - 1].getBoundingClientRect(); const l = document.querySelector('#help .help-list').getBoundingClientRect(); return { rowT: Math.round(r.top), rowB: Math.round(r.bottom), listT: Math.round(l.top), listB: Math.round(l.bottom), inside: r.top >= l.top - 1 && r.bottom <= l.bottom + 1 } });
    console.log(' last row after scroll-to-end: ' + JSON.stringify(last));
    // open a row: does the sheet still fit?
    await page.evaluate(() => { const r = document.querySelector('#help .help-row'); if (r) r.click() });
    await page.waitForTimeout(600);
    const t2 = await page.evaluate(TEN);
    console.log(' after opening row 1: over=' + t2.over + ' help=' + JSON.stringify(t2.tenants[0]));
    await page.screenshot({ path: OUT + '/help-' + name + '-rowopen.png' });
    await ctx.close();
  }
  await browser.close();
  console.log('\nshots in ' + OUT);
})();
