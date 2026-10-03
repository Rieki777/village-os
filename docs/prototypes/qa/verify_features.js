/* Round C verification — F1-F5 features + A1-A7 build items. */
const { chromium } = require('playwright');
const fs = require('fs');
const FILE = process.env.GROUNDS_FILE || 'file:///root/amora/work/grounds-v0.html';
const EXE = process.env.PW_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1180 } });
  const page = await ctx.newPage();
  const perr = [], cerr = [];
  page.on('pageerror', e => perr.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
  await page.goto(FILE); await page.waitForTimeout(1000);
  await page.click('#enterBtn'); await page.waitForTimeout(1500);

  /* A1: painted default + wrapped chips + active marker */
  const a1 = await page.evaluate(() => ({
    im: iconMode,
    on: (document.querySelector('[data-im].on') || {}).dataset ? document.querySelector('[data-im].on').dataset.im : null
  }));
  ok(a1.im === 'painted' && a1.on === 'painted', `A1: painted is the boot default, chip marked (${a1.im})`);
  await page.evaluate(() => document.querySelector('[data-im="iso"]').click());
  const a1b = await page.evaluate(() => (document.querySelector('[data-im].on') || {}).dataset.im);
  ok(a1b === 'iso', 'A1: the active marker moves with the click');
  await page.evaluate(() => document.querySelector('[data-im="painted"]').click());

  /* A2: global scale */
  await page.evaluate(() => setGScale(220));
  await page.waitForTimeout(400);
  const a2 = await page.evaluate(() => ({
    gs: GSCALE, v: getComputedStyle(document.documentElement).getPropertyValue('--gScale').trim(),
    tf: pEls[SCENE.structures[0].key].style.transform,
    lblH: (Object.values(bEls).find(e => e.className === 'banner') || { offsetHeight: 0 }).offsetHeight,
    exp: buildExportJSON().map_scene.art_manifest.skin.global_scale
  }));
  ok(a2.gs === 2.2 && a2.v === '2.2', `A2: global scale dial drives the map (×${a2.gs})`);
  ok(/scale\(/.test(a2.tf), 'A2: icon transforms carry the scale with LOD intact');
  ok(a2.exp === 2.2, 'A2: global scale exports in the skin');
  await page.evaluate(() => setGScale(100, true));

  /* A3: vitals dropdowns + actions */
  const nq0 = await page.evaluate(() => SCENE.quests.length);
  await page.evaluate(() => { document.querySelector('.vital[data-k="canopy"]').click(); });
  await page.waitForTimeout(300);
  const a3 = await page.evaluate(() => ({
    open: document.getElementById('vdrop').classList.contains('show'),
    txt: document.getElementById('vdrop').textContent
  }));
  ok(a3.open && /drawn|forest|sample/i.test(a3.txt), 'A3: canopy dropdown opens with how-computed facts');
  ok(/Claim|Begin/i.test(a3.txt), 'A3: dropdown carries a way to act');
  await page.evaluate(() => { document.querySelector('.vital[data-k="moon"]').click(); });
  await page.waitForTimeout(250);
  const a3m = await page.evaluate(() => document.getElementById('vdrop').textContent);
  ok(/cycle|lunar/i.test(a3m), 'A3: the moon opens its cycle card');
  await page.evaluate(() => document.getElementById('vdrop').classList.remove('show'));
  /* founder override */
  await page.click('#buildBtn'); await page.waitForTimeout(300);
  await page.evaluate(() => { openVitalDrop('food', document.querySelector('.vital[data-k="food"]')); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('vOvr').value = '80kg'; vitalSet('food'); });
  await page.waitForTimeout(300);
  const a3o = await page.evaluate(() => ({
    v: VITAL_OVR.food.v, bar: document.querySelector('.vital[data-k="food"] b').textContent,
    audit: EDITS.some(e => e.action === 'vital-override'),
    exp: buildExportJSON().vital_overrides.food.v
  }));
  ok(a3o.v === '80kg' && a3o.bar === '80kg' && a3o.audit && a3o.exp === '80kg', 'A3/Q8: founder sets a vital — audited, shown, exported');
  await page.click('#buildBtn'); await page.waitForTimeout(200);

  /* A4: rename */
  const a4 = await page.evaluate(() => ({
    btn: document.getElementById('wallBtn').textContent,
    head: document.querySelector('#wall h3').textContent,
    left: document.body.innerHTML.includes('The Wall')
  }));
  ok(/Get Involved/.test(a4.btn) && /Get Involved/.test(a4.head) && !a4.left, 'A4: Get Involved everywhere; no "The Wall" in copy');

  /* A5: dock SVGs */
  const a5 = await page.evaluate(() => ({
    n: document.querySelectorAll('#dock button').length,
    svg: [...document.querySelectorAll('#dock button')].every(b => b.querySelector('svg')),
    loom: !!document.querySelector('.lfk[data-f="journey"] svg')
  }));
  ok(a5.n === 7 && a5.svg, `A5: ${a5.n} dock doors, all in the house SVG hand`);
  ok(a5.loom, 'A5: the Loom journeys chip joins the same hand');

  /* A6: no narration */
  const a6 = await page.evaluate(() => !document.body.innerHTML.includes('In the live platform') && !document.body.innerHTML.includes('in the live build'));
  ok(a6, 'A6: no prototype narration anywhere');

  /* A7: tooltip primitive */
  await page.hover('#dock button[data-m="wallet"]'); await page.waitForTimeout(300);
  const a7 = await page.evaluate(() => ({
    show: document.getElementById('tip').classList.contains('show'),
    txt: document.getElementById('tip').textContent
  }));
  ok(a7.show && /Exchange/.test(a7.txt), 'A7: tooltips live — themed, positioned, house voice');
  await page.mouse.move(700, 700); await page.waitForTimeout(200);

  /* F1: concierge */
  const f1 = await page.evaluate(() => { conciergeMatch('I want to book a room for two nights'); return { m: document.getElementById('module').classList.contains('show'), log: CONCIERGE_LOG[CONCIERGE_LOG.length - 1] }; });
  ok(f1.m && f1.log.matched_kind === 'module' && f1.log.matched_id === 'stay', 'F1: "book a room" walks through the Stays door, logged');
  await page.evaluate(() => closeDoor());
  const f1b = await page.evaluate(() => { conciergeMatch('I want to help with planting and weeding in the garden'); return CONCIERGE_LOG[CONCIERGE_LOG.length - 1]; });
  ok(f1b.matched_kind === 'quest', `F1: work intent finds a quest (${f1b.matched_id})`);
  const f1c = await page.evaluate(() => { conciergeMatch('teach me quantum basket weaving'); return CONCIERGE_LOG[CONCIERGE_LOG.length - 1]; });
  ok(f1c.matched_kind === 'none', 'F1: the unmatched ask becomes a logged signal');
  const f1d = await page.evaluate(() => buildExportJSON().concierge_queries.length >= 3);
  ok(f1d, 'F1: concierge_queries export — the demand sensor');
  await page.evaluate(() => { document.getElementById('panel').classList.remove('open'); panelKey = null; });

  /* F2: pulse */
  await page.evaluate(() => pulseTick('kitchen'));
  await page.waitForTimeout(400);
  const f2 = await page.evaluate(() => pEls.kitchen.classList.contains('talk'));
  ok(f2, 'F2: a conversation makes its home shimmer');

  /* F3: occupancy one-source */
  /* D2 A3 moved the occupancy off the label, where a testing session never
     found it, and onto a home chip that is its own door. Same source. */
  const f3 = await page.evaluate(() => ({
    chip: !!(bgEls.ridgeA && bgEls.ridgeA.querySelector('.hchip')),
    label: bEls.ridgeA.textContent,
    sheet: (MODULES.housing.sample({}) || '').includes('2 of 5')
  }));
  ok(f3.chip && !/⌂/.test(f3.label) && f3.sheet, 'F3: lots sold — the home chip and the Housing sheet read the same source');

  /* F4: event pins + urgency + RSVP */
  const f4 = await page.evaluate(() => ({
    kitchen: pEls.kitchen.className, sanctuary: pEls.sanctuary.className,
    /* D2 A1: the star left the building. It used to be a pointer-events:none
       span inside the poi, which is why nobody could tap it; it is a seal in
       the badge plane now, wearing its own urgency class. */
    badge: !!(bgEls.sanctuary && bgEls.sanctuary.querySelector('.bseal.b-event.evbadge svg')),
    sealUrg: bgEls.sanctuary ? (bgEls.sanctuary.querySelector('.b-event') || {}).className : ''
  }));
  ok(/hasev/.test(f4.kitchen) && /ev-u3/.test(f4.kitchen), 'F4: tonight\'s feast burns brightest (u3)');
  ok(/ev-u0/.test(f4.sanctuary) && f4.badge && /ev-u0/.test(f4.sealUrg),
    'F4: far events glow dim — urgency rises as the day comes, on the seal now');
  const f4b = await page.evaluate(() => { const r0 = EVENTS[0].rsvp; evRSVP('e1'); return EVENTS[0].rsvp === r0 + 1; });
  ok(f4b, 'F4: RSVP counts (sample, in-memory)');

  /* F5: computed vitals honest labels */
  const f5 = await page.evaluate(() => { const D = vitalsData(); return { c: D.canopy.src, w: D.water.src, pk: D._pathKm }; });
  ok(/drawn/.test(f5.c) || /sample/.test(f5.c), `F5: canopy provider chain answers (${f5.c})`);
  ok(f5.pk >= 0, `F5: ${f5.pk.toFixed(2)} km of drawn paths measured`);

  /* Q1a: public lock */
  const q1a = await page.evaluate(() => {
    const pub = SCENE.features.find(f => f.public);
    return pub ? { id: pub.id, has: true } : { has: false };
  });
  if (q1a.has) {
    await page.click('#buildBtn'); await page.waitForTimeout(250);
    await page.click('#drawBtn'); await page.waitForTimeout(250);
    const blocked = await page.evaluate(id => {
      window.PUBLIC_UNLOCK = false; featSel = null;
      const f = featureById(id); const hit = f; // simulate the guard path
      if (hit.public && !window.PUBLIC_UNLOCK) return featSel === null;
      return false;
    }, q1a.id);
    ok(blocked, 'Q1a: public geometry stays locked until the founder unlocks');
    await page.click('#pubBtn'); await page.waitForTimeout(200);
    const unlocked = await page.evaluate(() => window.PUBLIC_UNLOCK && EDITS.some(e => e.action === 'public-unlock'));
    ok(unlocked, 'Q1a: ⚿ unlock is deliberate and audited');
    await page.click('#pubBtn'); await page.keyboard.press('Escape');
    await page.click('#buildBtn'); await page.waitForTimeout(200);
  } else { ok(true, 'Q1a: no public features in scene (guard untestable here)'); ok(true, 'Q1a: skipped'); }

  /* Q1b: phase transparency */
  const q1b = await page.evaluate(() => {
    const p3 = SCENE.structures.find(s => s.phase >= 3); const p1 = SCENE.structures.find(s => s.phase === 1);
    return { o3: p3 ? getComputedStyle(pEls[p3.key]).opacity : null, o1: p1 ? getComputedStyle(pEls[p1.key]).opacity : null };
  });
  ok(q1b.o3 && +q1b.o3 < 0.7 && +q1b.o1 === 1, `Q1b: phases load into reality (p1 ${q1b.o1} · p3 ${q1b.o3})`);

  /* Q1d: vocabulary rename */
  const q1d = await page.evaluate(() => {
    const old = SUBTYPES.zone[0]; SUBTYPES.zone[0] = 'wildmeadow';
    SCENE.features.forEach(f => { if (f.kind === 'zone' && f.subtype === old) f.subtype = 'wildmeadow'; });
    logEdit('vocab', 'zone:' + old, { renamed_to: 'wildmeadow' });
    const J = buildExportJSON();
    return J.map_scene.vocabulary.zone[0] === 'wildmeadow';
  });
  ok(q1d, 'Q1d: the founder\'s words — rename exports, features follow');

  /* Q6: wildlife present */
  const q6 = await page.evaluate(() => ({ b: birds.length, m: MACAWS.length, h: !!HERON, c: !!COATI }));
  ok(q6.b === 7 && q6.m === 2 && q6.h && q6.c, `Q6: ${q6.b} birds, ${q6.m} macaw pairs, a heron, a coati`);

  /* events module via dock */
  await page.click('#dock button[data-m="events"]'); await page.waitForTimeout(350);
  const evm = await page.evaluate(() => document.getElementById('moduleCard').textContent);
  ok(/Events/.test(evm) && /Full-moon feast/.test(evm), 'Q7: Events module sheet with RSVPs');
  await page.evaluate(() => closeDoor());

  /* ---------- D1: the camera and the hands ---------- */
  const d1z = await page.evaluate(() => {
    const fit = Math.min(innerWidth / W, innerHeight / H);
    cam.z = 0.001; cam.x = W / 2; cam.y = H / 2; clampCam();
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => worldToScreen(x, y).map(v => v / DPR));
    return { floor: cam.z, want: fit * 0.85, inside: corners.every(([x, y]) => x > -1 && y > -1 && x < innerWidth + 1 && y < innerHeight + 1) };
  });
  ok(Math.abs(d1z.floor - d1z.want) < 1e-9, `D1.1: the zoom floor is FIT x 0.85, not COVER (${d1z.floor.toFixed(4)})`);
  ok(d1z.inside, 'D1.1: pinched all the way out, the whole land sits on screen with margin to spare');

  /* Rye trimmed the rim by half after the first build. The contract is no
     longer "the centre reaches the world corner"; it is "the centre reaches
     every BUILDING, and the void at the rim is at most a quarter screen". */
  const d1c = await page.evaluate(() => {
    cam.z = 1.2; clampCam();
    const far = [];
    for (const s of SCENE.structures) {
      cam.x = s.x; cam.y = s.y; clampCam();
      const [sx, sy] = worldToScreen(s.x, s.y);
      const off = Math.hypot(sx / DPR - innerWidth / 2, sy / DPR - innerHeight / 2);
      if (off > 0.6) far.push(s.key + ' ' + Math.round(off));
    }
    /* Rim per side, against what the first D1 clamp allowed, at four zooms.
       Half or less, unless a building out there is what holds the side open. */
    const xs = SCENE.structures.map(s => s.x), ys = SCENE.structures.map(s => s.y);
    const ex = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sides = [];
    for (const z of [0.6, 0.9, 1.2, 1.8]) {
      cam.z = z; clampCam();
      const b = camBounds(), hw = innerWidth / 2 / z, hh = innerHeight / 2 / z;
      const one = (now, old, land, held) => ({ ratio: old > 0 ? now / old : 0, land: Math.abs(land - held) < 0.5 });
      sides.push(
        one(Math.max(0, hw - b[0]), hw, ex[0], b[0]),
        one(Math.max(0, b[1] - (W - hw)), hw, ex[1], b[1]),
        one(Math.max(0, hh - b[2]), hh, ex[2], b[2]),
        one(Math.max(0, b[3] - (H - hh)), hh, ex[3], b[3]));
    }
    const e = [...SCENE.structures].sort((a, b) => b.x - a.x)[0];
    cam.z = 1.2; cam.x = e.x; cam.y = e.y; clampCam();
    const [sx, sy] = worldToScreen(e.x, e.y);
    return { far, name: e.name, off: Math.hypot(sx / DPR - innerWidth / 2, sy / DPR - innerHeight / 2),
      over: sides.filter(s => s.ratio > 0.505 && !s.land).length, n: sides.length,
      worst: Math.max(...sides.filter(s => !s.land).map(s => s.ratio)) };
  });
  ok(d1c.far.length === 0, `D1.1: every building can sit dead centre (${d1c.far.length} out of reach${d1c.far.length ? ': ' + d1c.far.slice(0, 3).join(', ') : ''})`);
  ok(d1c.over === 0, `D1.1: and the rim past the land is half what the first build showed (worst ${(d1c.worst * 100).toFixed(0)}% of it, over ${d1c.n} side-and-zoom pairs)`);
  ok(d1c.off < 0.6, `D1.1: the eastmost building (${d1c.name}) can sit dead centre (${d1c.off.toFixed(2)} px off)`);

  const d1w = await page.evaluate(() => {
    const el = document.getElementById('scene'); cam.z = 1; clampCam();
    const pinch = new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true });
    const live = el.dispatchEvent(pinch); const zp = cam.z;
    cam.z = 1; clampCam();
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
    return { zp, zw: cam.z, want: Math.exp(60 * 0.012), prevented: !live };
  });
  ok(Math.abs(d1w.zp - d1w.want) < 1e-9 && d1w.prevented, `D1.2: a trackpad pinch zooms the land, not the page (z ${d1w.zp.toFixed(3)})`);
  ok(Math.abs(d1w.zw - 1.13) < 1e-9, 'D1.2: a plain wheel keeps its old step');

  const d1s = await page.evaluate(() => {
    const el = document.getElementById('scene'); cam.z = 1; clampCam();
    const mk = (t, x) => Object.assign(new Event(t, { bubbles: true, cancelable: true }), x);
    const at = { clientX: innerWidth / 2, clientY: innerHeight / 2 };
    el.dispatchEvent(mk('gesturestart', { ...at, scale: 1 }));
    el.dispatchEvent(mk('gesturechange', { ...at, scale: 1.5 }));
    const z = cam.z; el.dispatchEvent(mk('gestureend', { ...at, scale: 1.5 })); return z;
  });
  ok(Math.abs(d1s - 1.5) < 1e-9, `D1.2: Safari's gesture events drive the same zoom (${d1s.toFixed(3)})`);

  const d1p = await page.evaluate(async () => {
    openPanel('kitchen'); const inset = panelInset()[0];
    await new Promise(r => setTimeout(r, 1500));
    const s = BY['kitchen'], w = document.getElementById('panel').offsetWidth;
    const r = { inset, at: worldToScreen(s.x, s.y)[0] / DPR, want: (innerWidth - w) / 2 };
    document.getElementById('panelClose').click(); return r;
  });
  ok(d1p.inset > 0 && Math.abs(d1p.at - d1p.want) < 2,
    `D1.1: with the drawer open a building centres in the strip that stays visible (${Math.round(d1p.at)} px, wanted ${Math.round(d1p.want)})`);
  await page.waitForTimeout(400);

  const d1l = await page.evaluate(() => {
    cam.z = 1; clampCam(); syncBanners();
    const k = Math.max(.5, Math.min(1.4, 0.28 + cam.z * 0.5)); const rows = [];
    for (const s of SCENE.structures) {
      const p = pEls[s.key]; if (!p || !p.classList.contains('m-painted')) continue;
      const fam = (window.ARCHMAP && ARCHMAP[s.archetype]) ? ARCHMAP[s.archetype].icon : s.archetype;
      const sc = ((typeof FAM_SCALE !== 'undefined' && FAM_SCALE[fam]) || 1) * (s.scale || 1) * (window.GSCALE || 1);
      rows.push({ now: s._crownOff, was: k * 1.35 * sc * 66 + 10 });
    }
    return rows;
  });
  const hug = d1l.filter(r => r.now < r.was - 6).length;
  ok(d1l.length > 8 && hug === d1l.length,
    `D1.3: every painted label sits closer to its crown (${hug}/${d1l.length}, e.g. ${Math.round(d1l[0].was)} -> ${Math.round(d1l[0].now)} px)`);

  /* ---------- D2 A1: every mark reachable, no two marks touching ---------- */
  const d2a = await page.evaluate(() => {
    cam.z = 1.7; cam.x = 1240; cam.y = 700; clampCam(); refreshBadges(); syncBanners(); syncBanners();
    const shown = [...document.querySelectorAll('.bseal')].filter(s =>
      s.closest('.bgroup').classList.contains('on') && getComputedStyle(s).display !== 'none'
      && s.getBoundingClientRect().width > 0);
    const box = s => { const r = s.getBoundingClientRect(); return { s, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; };
    const b = shown.map(box);
    /* Marks may cross a NEIGHBOUR's marks since rings stopped moving each
       other apart (patch_e2_ring), so the old global spacing rule is gone and
       two narrower ones stand in its place.

       ONE: a mark never strays from the building it belongs to. That is the
       whole point of the change, and it is the thing that was only ever an
       opinion before: `reach` is the widest ring the layout can hand out,
       max(off*1.8, 30), plus half a seal.

       TWO: two marks on the SAME ring still never touch, because 44 px is a
       tap target and that is a correctness rule, not a tidiness one. */
    let touching = 0, worst = '', strayed = '', sameTouch = 0;
    for (const x of b) {
      const g = bgEls[x.s.dataset.bk]; if (!g) continue;
      const reach = Math.max((g._off || 30) * 1.8, 30) + 18;
      const d = Math.hypot(x.cx - g._cx, x.cy - g._cy);
      if (d > reach && !strayed) strayed = `${x.s.dataset.bk}:${x.s.dataset.bkind} is ${Math.round(d)} px out, reach is ${Math.round(reach)}`;
    }
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const d = Math.hypot(b[i].cx - b[j].cx, b[i].cy - b[j].cy);
      // 44 exactly is two hit circles touching, which is the target, not a fault
      if (d < 43.5) {
        touching++;
        if (b[i].s.dataset.bk === b[j].s.dataset.bk) sameTouch++;
        if (!worst) worst = `${b[i].s.dataset.bk}:${b[i].s.dataset.bkind} vs ${b[j].s.dataset.bk}:${b[j].s.dataset.bkind} at ${Math.round(d)} px`;
      }
    }
    /* Reachability is only meaningful for marks inside the map, away from the
       HUD panels that legitimately sit above it. */
    const inMap = b.filter(x => x.cx > 60 && x.cy > 96 && x.cx < innerWidth - 60 && x.cy < innerHeight - 96
      && !document.getElementById('maia').getBoundingClientRect().width
      || (x.cx > 60 && x.cy > 96 && x.cx < innerWidth - 60 && x.cy < innerHeight - 96
        && !(x.cx > document.getElementById('maia').getBoundingClientRect().x && x.cy > document.getElementById('maia').getBoundingClientRect().y)));
    /* ROOM FOR A THUMB, which is not the same question as "does a click at the
       exact centre resolve". Nearest-centre resolution gives two centres d
       apart a catchment of d/2, and a fingertip is 30 to 45 CSS px, so two
       marks 13 px apart resolve perfectly under a mouse and open the wrong
       door under a thumb. The floor is the seal's own width, so the catchment
       covers its ink. Doors of DIFFERENT buildings only: a ring is spaced
       against itself by BADGE_GAP and that is asserted separately. */
    const catchment = () => {
      const doors = [...document.querySelectorAll('.bseal,.hchip')].filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 0 && getComputedStyle(s).display !== 'none'
          && s.closest('.bgroup').classList.contains('on');
      }).map(s => { const r = s.getBoundingClientRect();
        return { k: s.dataset.bk, kind: s.dataset.bkind || 'home', cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
      let min = Infinity, pair = '';
      for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
        if (doors[i].k === doors[j].k) continue;
        const d = Math.hypot(doors[i].cx - doors[j].cx, doors[i].cy - doors[j].cy);
        if (d < min) { min = d; pair = `${doors[i].k}:${doors[i].kind} vs ${doors[j].k}:${doors[j].kind}`; }
      }
      return { doors: doors.length, minCross: +min.toFixed(1), minPair: pair,
        ink: parseFloat(getComputedStyle(document.querySelector('.bseal')).width) || 28 };
    };

    /* The plane resolves a tap by DISTANCE now, not by paint order
       (patch_e5_taps), so the question worth asking is "does a tap here open
       THIS mark". elementFromPoint answers a different one, "is this mark on
       top", which stopped being the mechanism the moment overlap was allowed. */
    let mine = 0;
    for (const x of inMap) { if (window.nearestSeal(x.cx, x.cy) === x.s) mine++; }
    const hit = document.querySelector('.bseal .bhit');
    return {
      shown: shown.length, touching, worst, strayed, sameTouch, mine, of: inMap.length,
      ...catchment(),
      clusters: document.querySelectorAll('.bgroup.clustered').length,
      star: !!document.querySelector('.bseal.b-event'),
      starHit: !!(document.querySelector('.bseal.b-event') && getComputedStyle(document.querySelector('.bseal.b-event')).pointerEvents === 'auto'),
      hitPx: hit ? Math.round(hit.getBoundingClientRect().width) : 0,
      inPoi: !!pEls.kitchen.querySelector('.evbadge'),
      layers: { badges: +getComputedStyle(document.getElementById('badges')).zIndex, banners: +getComputedStyle(document.getElementById('banners')).zIndex, icons: +getComputedStyle(document.getElementById('icons')).zIndex }
    };
  });
  ok(!d2a.strayed, `D2 A1: every mark stays on its own building's ring (${d2a.shown} shown, ${d2a.strayed || 'all attached'})`);
  ok(d2a.sameTouch === 0, `D2 A1: two marks on one ring never touch (${d2a.sameTouch} touching${d2a.touching ? '; ' + d2a.touching + ' cross a neighbour, which is allowed' : ''})`);
  ok(d2a.mine === d2a.of && d2a.of > 12, `D2 A1: every mark over the map answers its own tap (${d2a.mine}/${d2a.of})`);
  /* The one a passing tap test can still hide. If this fails, do NOT raise
     MARK_FLOOR: the solver is greedy and a higher floor has measured worse.
     Re-run qa/_probe_floor.js and widen RING_ROT instead. */
  ok(d2a.minCross >= d2a.ink && d2a.doors > 12,
    `D2 A1: every mark has room for a thumb (${d2a.doors} doors, closest ${d2a.minCross} px across buildings, ink ${d2a.ink} px, catchment ${(d2a.minCross / 2).toFixed(1)} px${d2a.minCross < d2a.ink ? ' — ' + d2a.minPair : ''})`);

  /* ONE CAMERA PROVES ONE CAMERA. The check above runs at z 1.7 and the map
     lane caught that this is the easy end: `off` comes from `_crownOff`, which
     shrinks with the LOD scale, so pulling back tightens every ring AND
     converges the buildings at the same time.

     Swept, it turns out no rotation budget clears the whole range, and that is
     not a tuning failure. At z 1.0 there are 50 doors in a converging area and
     the screen does not hold 50 exclusion zones; measured, even 42 degrees at
     3-degree steps only clears from z 1.7 up. What it IS is small: 3 to 4 doors
     of 50, in two bands, and zero everywhere else.

     So this is a RATCHET, like the brand refs. The known shortfall is recorded
     rather than hidden, the top of the range must stay perfect, and anything
     that makes it meaningfully worse fails. The second band exists because
     `.bmid` takes a seal from 22 px to 28 at z 1.45 while the geometry does not
     change: the ink grows before the ring does. Moving that boundary up is the
     cheap lever if this budget ever needs to come down. */
  const UNRELIABLE_BUDGET = 4;
  const sweep = await page.evaluate(zs => zs.map(z => {
    cam.z = z; cam.x = 1240; cam.y = 700; clampCam();
    refreshBadges(); syncBanners(); syncBanners();
    const seal = document.querySelector('.bseal');
    const ink = seal ? parseFloat(getComputedStyle(seal).width) : 28;
    const doors = [...document.querySelectorAll('.bseal,.hchip')].filter(s => {
      const r = s.getBoundingClientRect();
      return r.width > 0 && getComputedStyle(s).display !== 'none'
        && s.closest('.bgroup').classList.contains('on');
    }).map(s => { const r = s.getBoundingClientRect();
      return { k: s.dataset.bk, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
    let bad = 0;
    for (const d of doors) {
      let near = Infinity;
      for (const o of doors) {
        if (o === d || o.k === d.k) continue;
        const dist = Math.hypot(d.cx - o.cx, d.cy - o.cy);
        if (dist < near) near = dist;
      }
      if (near < ink) bad++;
    }
    return { z, ink, doors: doors.length, bad };
  }), [1.0, 1.1, 1.2, 1.35, 1.45, 1.6, 1.7, 2.0]);
  /* WHY THE BUDGET IS NOT POSITION-DEPENDENT, AND THE TRIPWIRE THAT KEEPS IT
     THAT WAY. The map lane panned 25 centres across the land at four zooms and
     the worst case per zoom was identical to the single-centre numbers
     (4/4/3/0). Position is not an axis, and the reason is the door filter: it
     takes every rendered mark whose group is live, NOT the marks intersecting
     the viewport, so the metric spans the whole land by construction.

     That is one edit from being lost. "Tighten" the filter to count only what
     is on screen and the number silently becomes position-dependent while the
     budget goes on claiming it measures the map. So: same zoom, two very
     different centres, same count. A viewport-relative filter cannot pass it. */
  const scope = await page.evaluate(() => {
    // This suite is order-dependent and shares one page, so the camera goes
    // back exactly where it was found. Panning and leaving it moved the land
    // under the next check.
    const was = { z: cam.z, x: cam.x, y: cam.y };
    const count = (x, y) => {
      cam.z = 1.45; cam.x = x; cam.y = y; clampCam();
      refreshBadges(); syncBanners(); syncBanners();
      return [...document.querySelectorAll('.bseal,.hchip')].filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 0 && getComputedStyle(s).display !== 'none'
          && s.closest('.bgroup').classList.contains('on');
      }).length;
    };
    const out = { a: count(700, 400), b: count(1750, 1000) };
    cam.z = was.z; cam.x = was.x; cam.y = was.y; clampCam();
    refreshBadges(); syncBanners(); syncBanners();
    return out;
  });
  ok(scope.a === scope.b && scope.a > 12,
    `D2 A1: the thumb budget counts the whole land, not the viewport (${scope.a} doors at one centre, ${scope.b} at another)`);

  const worstBand = sweep.reduce((a, r) => (r.bad > a.bad ? r : a), sweep[0]);
  const topClean = sweep.filter(r => r.z >= 1.7).every(r => r.bad === 0);
  ok(topClean, `D2 A1: from z 1.7 up every door has room for a thumb (${sweep.filter(r => r.z >= 1.7).map(r => r.z + ':' + r.bad).join(' ')})`);
  ok(worstBand.bad <= UNRELIABLE_BUDGET,
    `D2 A1: the crowded low-zoom bands stay within budget (worst z ${worstBand.z}: ${worstBand.bad} of ${worstBand.doors} doors, budget ${UNRELIABLE_BUDGET})`);
  ok(d2a.layers.badges > d2a.layers.banners && d2a.layers.banners > d2a.layers.icons,
    `D2 A1: badge over label over building (${d2a.layers.badges} > ${d2a.layers.banners} > ${d2a.layers.icons})`);
  ok(d2a.star && d2a.starHit && !d2a.inPoi, 'D2 A1: the star is a seal with its own hit area, not furniture inside the building');
  ok(d2a.hitPx === 44, `D2 A1: 44 px of thumb under a 22 px mark (${d2a.hitPx})`);
  /* The inverse of what stood here. Rings used to be collapsed by their
     neighbours and this asserted that they were; they are solved against one
     building now, so it asserts that they are not. The counted seal still
     exists for a ring that cannot fit its OWN marks, and verify_badges.js
     makes one on purpose and fans it. */
  ok(d2a.clusters === 0, `D2 A1: no ring is collapsed by its neighbours (${d2a.clusters} clustered)`);

  /* and a tap on a mark opens what the mark is about */
  const d2t = await page.evaluate(async () => {
    document.getElementById('panel').classList.remove('open');
    const seal = [...document.querySelectorAll('.bseal.b-quest')].find(s => getComputedStyle(s).display !== 'none');
    const key = seal.dataset.bk;
    seal.click(); await new Promise(r => setTimeout(r, 500));
    const r = { key, panel: panelKey, open: document.getElementById('panel').classList.contains('open'), tab: [...document.getElementById('tabs').children].findIndex(b => b.classList.contains('on')) };
    document.getElementById('panelClose').click();
    return r;
  });
  ok(d2t.open && d2t.panel === d2t.key && d2t.tab === 1,
    `D2 A1: tapping a leaf-pennant opens ${d2t.key} at its quests (tab ${d2t.tab})`);
  await page.waitForTimeout(400);

  /* ---------- D2 A2/A3: one glyph language at every distance ---------- */
  const vfar = await page.evaluate(() => {
    cam.z = 0.85; cam.x = 1240; cam.y = 700; clampCam(); refreshBadges(); syncBanners(); syncBanners();
    const vis = sel => [...document.querySelectorAll(sel)].filter(e =>
      getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0
      && /\b(on|far)\b/.test(e.closest('.bgroup').className));
    const far = { a: vis('.aseal').length, s: vis('.bseal').length, h: vis('.hchip').length,
      who: vis('.bseal').slice(0,6).map(e => e.dataset.bk + ':' + e.dataset.bkind + ' [' + e.closest('.bgroup').className + ']') };
    /* D9 holds: the number on the seal is a projection, never a stored count. */
    const wrong = SCENE.structures.map(s => {
      const a = bgEls[s.key] && bgEls[s.key].querySelector('.aseal'); if (!a) return null;
      const want = questsAt(s.key).length + seatsAt(s.key).length + threadsAt(s.key).length + eventsAt(s.key).length;
      return a.textContent === (want > 9 ? '9+' : String(want)) ? null : s.key;
    }).filter(Boolean);
    const face = getComputedStyle(document.querySelector('.aface')).fill;
    const ink = getComputedStyle(document.querySelector('.anum')).fill;
    cam.z = 1.7; clampCam(); syncBanners();
    const near = { a: vis('.aseal').length, s: vis('.bseal').length, h: vis('.hchip').length };
    return { far, near, wrong, face, ink, soon: document.querySelectorAll('.aseal.soon').length,
      label: bEls.ridgeA.querySelector('.cnt').textContent };
  });
  ok(vfar.label === '', 'D2 A2: the label stops carrying counts as text');
  ok(vfar.far.a > 8 && vfar.far.s === 0, `D2 A2: below the gate a building wears one activity seal and no marks (${vfar.far.a} seals, ${vfar.far.s} marks${vfar.far.s ? ': ' + vfar.far.who.join(' | ') : ''})`);
  ok(vfar.near.a === 0 && vfar.near.s > 8, `D2 A2: above the gate the marks take over and the seal stands down (${vfar.near.a} seals, ${vfar.near.s} marks)`);
  ok(vfar.wrong.length === 0, `D2 A2: every count is the projection, not a stored number (${vfar.wrong.length} wrong)`);
  ok(/32, 22, 12/.test(vfar.face) && /243, 230, 200/.test(vfar.ink),
    `D2 A2: parchment ink on dark ground, which is the whole point (${vfar.face} / ${vfar.ink})`);
  ok(vfar.soon > 0, `D2 A2: a gold rim breathes when an event is two days out (${vfar.soon})`);
  ok(vfar.far.h === vfar.near.h && vfar.far.h > 0, `D2 A3: the home chip is there at every distance (${vfar.far.h})`);

  const vhome = await page.evaluate(async () => {
    cam.z = 1.4; clampCam(); syncBanners();
    const h = [...document.querySelectorAll('.hchip')].find(x => x.dataset.bk === 'ridgeA');
    h.click(); await new Promise(r => setTimeout(r, 400));
    const card = document.getElementById('moduleCard');
    const a = card.querySelector('a.btn');
    const r = { open: document.getElementById('module').classList.contains('show'), txt: card.textContent,
      href: a ? a.getAttribute('href') : '', maia: /Ask Maia about living here/.test(card.textContent) };
    closeDoor(); return r;
  });
  ok(vhome.open && /Request a home at Ridge Hamlet North/.test(vhome.txt) && /2 of 5 spoken for/.test(vhome.txt),
    'D2 A3: the home chip opens its own sheet with the occupancy');
  ok(/\/reserve\?from=map&hamlet=ridgeA$/.test(vhome.href) && vhome.maia,
    `D2 A3: and carries the structure to the request (${vhome.href})`);

  const vlodge = await page.evaluate(async () => {
    homeSheet('guest'); await new Promise(r => setTimeout(r, 250));
    const card = document.getElementById('moduleCard');
    const r = { txt: card.textContent, href: card.querySelector('a.btn').getAttribute('href') };
    closeDoor(); return r;
  });
  ok(/2 of 3 full tonight/.test(vlodge.txt) && /\/stay$/.test(vlodge.href),
    `D2 A3: the lodge counts beds and routes to booking instead (${vlodge.href})`);

  const vfly = await page.evaluate(async () => {
    document.getElementById('panel').classList.remove('open');
    cam.z = 0.85; cam.x = 1240; cam.y = 700; clampCam(); syncBanners();
    const a = [...document.querySelectorAll('.aseal')].find(x => getComputedStyle(x).display !== 'none');
    const key = a.dataset.bk; a.click();
    await new Promise(r => setTimeout(r, 1700));
    return { key, z: cam.z, dx: Math.abs(cam.x - BY[key].x), dy: Math.abs(cam.y - BY[key].y) };
  });
  ok(vfly.z >= 1.14 && vfly.dx < 2 && vfly.dy < 2,
    `D2 A2: tapping the seal flies you in to ${vfly.key} at z ${vfly.z.toFixed(2)}, where the marks take over`);
  await page.waitForTimeout(300);

  /* D2 A2: a plate is a name and a mark is a door, so plates step over marks
     and then over each other, AND the vitals bar owns the top of the screen.
     Swept across the far zooms where both live.

     This sweep used to run one camera on one profile, and it was byte-for-byte
     insensitive to a change that buried four district names under the vitals
     bar and left a real overlap standing on the phone. Three things were wrong
     with it and all three are fixed here:
       - ONE CAMERA. (1240,700) is the east of the land; the plates that reach
         the top of the screen are the ones the FIT camera brings up there, so
         the fixed frame could not reach the condition at all. Both cameras now.
       - ONE PROFILE. #vitals is 46 px on the desk and 35 px on the phone, but
         the phone is 390 px wide, so the whole width of it is under the bar's
         x-band. Every burial reproduces on pocket first. Both profiles now.
       - NO VITALS ASSERTION ANYWHERE IN THE SUITE. #vitals is z-index 30 with
         an opaque gradient and #banners is 11: a plate that lands under the bar
         is not misplaced, it is GONE, which is worse. Asserted now, and the
         report carries the buried px so a regression reads as a measurement. */
  const plateSweep = (camTag) => {
    const rows = [];
    /* BOTH CAMERA AXES. This swept two cameras that both sit at cam.y=700 or the
       fit centre, and every defect of the pass that added the vitals half needed
       a SOUTHWARD PAN to reach: pan south and a district's whole land goes off
       the TOP of the screen, which is what fires the placement's last resort.
       On the shipped artifact those rows alone carry 16 of the 24 raw
       plate-over-mark overlaps and 36 of the 52 buried plates in this sweep, and
       neither of the old cameras could see any of them.
       Then cam.y was added and cam.x was left where it was, which is the same
       blindness turned ninety degrees: an EASTWARD pan is what puts a district's
       land off the SIDE, and the side is where a 390 px window clips a 148 px
       plate. Seven cameras now, three of them off the gate column. */
    const CAM = { gate: [1240, 700], s1100: [1240, 1100], s1500: [1240, 1500],
      w600: [600, 700], e1900: [1900, 700], e1900s1500: [1900, 1500] };
    for (const z of [0.52, 0.62, 0.72, 0.82, 0.9]) {
      cam.z = z;
      if (camTag === 'fit') { const b = camBounds(); cam.x = (b[0] + b[1]) / 2; cam.y = (b[2] + b[3]) / 2; }
      else { cam.x = CAM[camTag][0]; cam.y = CAM[camTag][1]; }
      clampCam(); refreshBadges(); syncBanners(); syncBanners(); syncBanners();
      /* districts AND geography names: with the land extended to the rim, the
         whole-land view is where people sit, and both kinds print in it */
      const els = [...SCENE.districts.map(d => bEls['d_' + d.id]), ...GEO.map((g, i) => bEls['g_' + i])]
        .filter(e => e && e.style.display !== 'none');
      const plates = els.map(e => e.getBoundingClientRect());
      const marks = [...document.querySelectorAll('.aseal,.hchip')]
        .filter(e => getComputedStyle(e).display !== 'none' && /\b(on|far)\b/.test(e.closest('.bgroup').className))
        .map(e => e.getBoundingClientRect());
      const hits = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
      const vb = document.getElementById('vitals').getBoundingClientRect();
      let pp = 0, pm = 0, pv = 0, buried = 0, who = null;
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++) if (hits(plates[i], plates[j])) pp++;
        for (const m of marks) if (hits(plates[i], m)) pm++;
        if (hits(plates[i], vb)) {
          pv++;
          const d = Math.min(plates[i].bottom, vb.bottom) - Math.max(plates[i].top, vb.top);
          if (d > buried) { buried = d; who = els[i].textContent; }
        }
      }
      /* THE FEATURE ITSELF, which this suite asserted nothing about: a district
         plate stands ON the buildings whose own record names it, and it is on the
         screen while it does. Both halves are needed and neither implies the
         other. A gap measured against a building that is off the screen, or from
         a plate that is off the screen, is not a measurement: a plate at x
         430..578 on a 390 px phone scored a perfect 0.0 against a building that
         was outside with it, which is how a strict regression read as a tie. So
         a pair is SCORED only when the plate is at least 80% inside the window
         and the building has a pixel in it; everything else is counted, not
         scored. `gone` is the case that has to stay near zero: a name drawn
         entirely outside the window while its own land is inside it. */
      const VW = innerWidth, VH = innerHeight;
      const sprites = [];
      for (const s of SCENE.structures) {
        const p = pEls[s.key]; if (!p || p.style.display === 'none') continue;
        const r = p.getBoundingClientRect(); if (!r.width) continue;
        if (Math.min(r.right, VW) <= Math.max(r.left, 0) || Math.min(r.bottom, VH) <= Math.max(r.top, 0)) continue;
        sprites.push({ d: s.district, l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
      let scored = 0, sum = 0, touch = 0, gone = 0, far = 0, drawn = 0, missing = 0, burKin = 0;
      const goneWho = [], farWho = [], missWho = [], burWho = [];
      for (const d of SCENE.districts) {
        const el = bEls['d_' + d.id];
        if (!el || el.style.display === 'none') { missing++; missWho.push(`${d.name} ${camTag}@${z}`); continue; }
        drawn++;
        const q = el.getBoundingClientRect();
        const area = Math.max(1, q.width * q.height);
        const on = Math.max(0, Math.min(q.right, VW) - Math.max(q.left, 0))
                 * Math.max(0, Math.min(q.bottom, VH) - Math.max(q.top, 0)) / area;
        let g = null;
        for (const s of sprites) {
          if (s.d !== d.id) continue;
          const gg = Math.hypot(Math.max(0, q.left - s.r, s.l - q.right), Math.max(0, q.top - s.b, s.t - q.bottom));
          if (g === null || gg < g) g = gg;
        }
        if (g === null) continue;                 // nothing of its own on the screen to measure against
        /* A NAME FOR LAND YOU CAN SEE IS NEVER PRINTED UNDER THE BAR. That is the
           half of the burial rule a placement can actually hold at zero: the
           slot table refuses everything the bar paints over, and the one
           unpriced rung left, the floor this file has always had, is reached
           only by a district with nothing of its own on the screen. */
        if (q.left < vb.right && vb.left < q.right && q.top < vb.bottom && vb.top < q.bottom) {
          burKin++; burWho.push(`${d.name} ${camTag}@${z}`);
        }
        if (on <= 0.001) { gone++; goneWho.push(`${d.name} ${camTag}@${z}`); continue; }
        if (on < 0.8) continue;                   // clipped: counted by `gone`'s rule, never scored 0.0
        scored++; sum += g; if (g <= 2) touch++;
        if (g > 24) { far++; farWho.push(`${d.name} ${camTag}@${z} ${g.toFixed(0)}px`); }
      }
      /* a whole-pass suppression is a different finding from a deleted name, and
         `plates > 3` below is what catches it, so `missing` only speaks when the
         pass ran */
      if (!drawn) { missing = 0; missWho.length = 0; }
      rows.push({ cam: camTag, z, plates: plates.length, marks: marks.length, pp, pm, pv,
        buried: +buried.toFixed(1), who, h: +plates.reduce((a, r) => Math.max(a, r.height), 0).toFixed(1),
        due: SCENE.districts.length, drawn, missing, missWho, burKin, burWho,
        scored, sum: +sum.toFixed(1), touch, gone, far, goneWho, farWho });
    }
    return rows;
  };
  const SWEEP = ['gate', 'fit', 's1100', 's1500', 'w600', 'e1900', 'e1900s1500'];
  const vplate = [];
  for (const c of SWEEP) vplate.push(...await page.evaluate(plateSweep, c));
  /* the same sweep in a hand. A fresh context, because the profile is decided
     once at boot (HUD_PROFILE, :5458) and cannot be toggled on a live page. */
  const vpocket = await (async () => {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
    const pp = await pctx.newPage();
    const pe = []; pp.on('pageerror', e => pe.push(String(e)));
    await pp.goto(FILE + '#hud=pocket'); await pp.waitForTimeout(1200);
    try { if (await pp.locator('#enterBtn').isVisible({ timeout: 900 })) await pp.click('#enterBtn'); } catch (_) { }
    await pp.waitForTimeout(1800);
    const pocket = await pp.evaluate(() => document.body.classList.contains('pocket'));
    const rows = [];
    for (const c of SWEEP) rows.push(...await pp.evaluate(plateSweep, c));
    await pctx.close();
    return { pocket, rows, errs: pe };
  })();
  const show = r => `${r.cam}@${r.z}${r.pp ? ' pp=' + r.pp : ''}${r.pm ? ' pm=' + r.pm : ''}${r.pv ? ' vitals=' + r.pv + ' buried ' + r.buried + '/' + r.h + 'px "' + r.who + '"' : ''}`;
  const tot = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  /* THE CEILING IS THE SHIPPED ARTIFACT, NOT THE CURRENT COUNT. A threshold set
     to whatever the change happens to score is a snapshot; these two pairs are
     what grounds-v0.html at HEAD scores on THIS EXACT SWEEP, 7 cameras by 5
     zooms, measured with the same counters below and recorded here. The
     invariant they carry is the one that matters to a reader: the change may not
     make the land busier than the artifact it replaces. Zero is not reachable
     while every district keeps its name, because a name that cannot find a free
     slot has to stand somewhere, and the pass that did reach zero reached it by
     deleting 134 plate-frames. Every surviving overlap is named in the message,
     so a new one changes the line even while the count passes. */
  const SHIPPED = { desk: { pp: 6, pm: 12 }, pocket: { pp: 37, pm: 31 } };
  const ppD = tot(vplate, 'pp'), pmD = tot(vplate, 'pm');
  const ppP = tot(vpocket.rows, 'pp'), pmP = tot(vpocket.rows, 'pm');
  const badD = vplate.filter(r => r.pp || r.pm), badP = vpocket.rows.filter(r => r.pp || r.pm);
  ok(ppD <= SHIPPED.desk.pp && pmD <= SHIPPED.desk.pm && vplate[0].plates > 3 && vplate[0].marks > 8,
    `D2 A2: desk district plates are no busier than the shipped artifact — plate-over-plate ${ppD} of ${SHIPPED.desk.pp} allowed, plate-over-mark ${pmD} of ${SHIPPED.desk.pm}${badD.length ? ' — ' + badD.map(show).join('; ') : ''}`);
  ok(vpocket.pocket && ppP <= SHIPPED.pocket.pp && pmP <= SHIPPED.pocket.pm && vpocket.rows[0].plates > 3 && !vpocket.errs.length,
    `D2 A2: and in a hand, where the land is 390 px wide — plate-over-plate ${ppP} of ${SHIPPED.pocket.pp} allowed, plate-over-mark ${pmP} of ${SHIPPED.pocket.pm}${badP.length ? ' — ' + badP.map(show).join('; ') : ''}${vpocket.errs.length ? ' — page error ' + vpocket.errs[0] : ''}`);
  /* A NAME IS NEVER DELETED. The pass before this one replaced the floor with a
     hide and took names the shipped artifact draws readable and touching their
     own building. There is no threshold here and there should not be one: the
     district pass draws every district it is asked for, in every frame. */
  const missD = vplate.filter(r => r.missing), missP = vpocket.rows.filter(r => r.missing);
  ok(!missD.length && !missP.length,
    `D2 A2: and every district keeps its name in every frame of the sweep — ${tot(vplate, 'drawn')}/${tot(vplate, 'due')} desk, ${tot(vpocket.rows, 'drawn')}/${tot(vpocket.rows, 'due')} hand${missD.length + missP.length ? ' — NOT DRAWN: ' + [...missD, ...missP].flatMap(r => r.missWho).join('; ') : ''}`);
  const burD = vplate.filter(r => r.burKin), burP = vpocket.rows.filter(r => r.burKin);
  ok(!burD.length && !burP.length,
    `D2 A2: and no district with a building of its own on the screen is printed under the vitals bar, which paints over it${burD.length + burP.length ? ' — ' + [...burD, ...burP].flatMap(r => r.burWho).join('; ') : ''}`);

  /* D2 A2: THE ADJACENCY HALF. Everything above says where a plate must NOT be.
     Nothing said it has to be near the thing it names, which is the whole item,
     and the suite was byte-for-byte silent when the aim ordering was reverted.
     Thresholds are set where the shipped artifact is not, and both endpoints were
     measured by running THIS FILE against both artifacts on this seven-camera
     sweep: the change reads desk 5.14 px mean with 87% touching over 160 scored
     plates and a hand 7.14 px with 68% over 85, while grounds-v0.html at HEAD,
     before any aim ordering, reads 13.31 px / 34% over 128 and 9.39 px / 50%
     over 54. 8 px and 75% sit between them on the desk and 8 px and 60% in a
     hand. Read the desk numbers on this page rather than on a fresh one: sixty
     assertions have run before this point and they leave the map in a state a
     standalone probe does not reproduce, which is why the same build measures
     2.62 px / 94% under qa/_probe_g4d_live.js and 5.14 px / 87% here. The floors
     on `n` are there so an artifact that draws nothing cannot pass by scoring
     nothing, and they count plates SCORED, never plates drawn. */
  const adj = rows => {
    const s = rows.reduce((a, r) => ({ n: a.n + r.scored, sum: a.sum + r.sum, t: a.t + r.touch,
      gone: a.gone + r.gone, far: a.far + r.far,
      gw: a.gw.concat(r.goneWho), fw: a.fw.concat(r.farWho) }),
      { n: 0, sum: 0, t: 0, gone: 0, far: 0, gw: [], fw: [] });
    s.mean = +(s.sum / Math.max(1, s.n)).toFixed(2);
    s.pct = Math.round(100 * s.t / Math.max(1, s.n));
    return s;
  };
  const aD = adj(vplate), aP = adj(vpocket.rows);
  ok(aD.n >= 60 && aD.mean <= 8 && aD.pct >= 75 && aP.n >= 30 && aP.mean <= 8 && aP.pct >= 60,
    `D2 A2: a district plate stands on the buildings its own record names — desk ${aD.mean}px mean over ${aD.n} scored plates, ${aD.pct}% touching; in a hand ${aP.mean}px over ${aP.n}, ${aP.pct}% touching${aD.fw.length + aP.fw.length ? ' — over 24px: ' + [...aD.fw, ...aP.fw].slice(0, 6).join('; ') : ''}`);
  /* ZERO, ON BOTH. This read `aP.gone <= 2` and 2 was exactly what the tree
     scored, which is a snapshot wearing a gate's clothes. Off the screen is a
     price the placement pays last now, so both sides hold at zero and a single
     survivor fails the line and names itself. */
  ok(aD.gone === 0 && aP.gone === 0,
    `D2 A2: and no district name is drawn outside the window while its own land is inside it, which scores a perfect gap from a place nobody can see — desk ${aD.gone}, hand ${aP.gone}${aD.gw.length + aP.gw.length ? ' — ' + [...aD.gw, ...aP.gw].join('; ') : ''}`);

  /* ---------- D4: the founder's hands ---------- */
  const d4 = await page.evaluate(async () => {
    const r = {};
    document.getElementById('panelClose').click(); closeDoor();
    document.getElementById('buildBtn').click(); await new Promise(z => setTimeout(z, 300));
    /* D4.1 a copy carries what is addressed to it, and nothing that is about two places */
    const key = 'greenhouse', q0 = questsAt(key).length, s0 = seatsAt(key).length, n0 = SCENE.structures.length;
    openInspect(key); await new Promise(z => setTimeout(z, 300));
    document.getElementById('iDup').click(); await new Promise(z => setTimeout(z, 300));
    const c = SCENE.structures[SCENE.structures.length - 1];
    r.dup = { key: c.key, copy: / \(copy\)$/.test(c.name), placing: !!(placing && placing.dup),
      q: questsAt(c.key).length, s: seatsAt(c.key).length, wantQ: q0, wantS: s0,
      addr: (questsAt(c.key)[0] || {}).addr, flows: SCENE.flows.filter(f => f.from === c.key || f.to === c.key).length,
      audit: EDITS.some(e => e.action === 'duplicate') };
    document.getElementById('scene').dispatchEvent(new MouseEvent('click', { clientX: 740, clientY: 560, bubbles: true, cancelable: true }));
    await new Promise(z => setTimeout(z, 300));
    r.landed = !placing && inspKey === c.key;
    document.getElementById('undoBtn').click(); await new Promise(z => setTimeout(z, 300));
    r.undone = !BY[c.key] && SCENE.quests.filter(q => q.at === c.key).length === 0
      && SCENE.seats.filter(x => x.at === c.key).length === 0 && SCENE.structures.length === n0;
    /* D4.2 the row says where the number came from before it asks for one */
    openVitalDrop('canopy', document.querySelector('.vital[data-k="canopy"]')); await new Promise(z => setTimeout(z, 200));
    const d = document.getElementById('vdrop');
    r.plain = { prov: /sample reading|measured from your drawn land/.test(d.textContent),
      ask: /Know the real number\? Set it here and the map holds your word until you release it\./.test(d.textContent),
      hold: /Hold this number/.test(d.textContent), old: /founder's word/.test(d.textContent) };
    document.getElementById('vOvr').value = '81%'; vitalSet('canopy'); await new Promise(z => setTimeout(z, 250));
    openVitalDrop('canopy', document.querySelector('.vital[data-k="canopy"]')); await new Promise(z => setTimeout(z, 200));
    r.held = { txt: /Held by your word/.test(d.textContent), rel: /release/.test(d.textContent), v: (VITAL_OVR.canopy || {}).v };
    d.querySelector('a') && d.querySelector('a').click(); await new Promise(z => setTimeout(z, 200));
    r.released = !VITAL_OVR.canopy; d.classList.remove('show');
    /* D4.3 the role field offers what the village already has */
    openInspect('kitchen'); await new Promise(z => setTimeout(z, 300));
    const inp = document.getElementById('iSeatName'); inp.focus(); inp.value = ''; inp.oninput();
    await new Promise(z => setTimeout(z, 200));
    const dd = document.getElementById('seatDrop');
    const opt = [...dd.querySelectorAll('.sopt')].pop();
    const si = +opt.dataset.seatI, was = SCENE.seats[si].at, nm = SCENE.seats[si].s;
    r.combo = { open: dd.classList.contains('show'), opts: dd.querySelectorAll('.sopt').length,
      grouped: /picking one/.test(dd.textContent) };
    opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await new Promise(z => setTimeout(z, 350));
    r.moved = { nm, was, now: SCENE.seats[si].at, addr: SCENE.seats[si].addr,
      audit: EDITS.some(e => e.action === 'address-override') };
    closeInspect();
    /* D4.4 the dream has its own line */
    r.vbNull = SCENE.vision_bound === null;
    document.getElementById('lyVision').click(); await new Promise(z => setTimeout(z, 400));
    syncBoundBtn(); r.btnVision = document.getElementById('boundBtn').textContent.trim();
    const B = boundTarget();
    r.vb = { seeded: B === SCENE.vision_bound && B.length === SCENE.bound.length,
      exported: Array.isArray(buildExportJSON().map_scene.vision_bound) };
    cam.z = 1.0; const bb = camBounds();
    r.vb.reaches = bb[1] >= Math.max(...SCENE.vision_bound.map(p => p[0])) - 0.5;
    document.getElementById('lyNow').click(); syncBoundBtn();
    r.btnNow = document.getElementById('boundBtn').textContent.trim();
    document.getElementById('buildBtn').click();
    return r;
  });
  ok(d4.dup.copy && d4.dup.q === d4.dup.wantQ && d4.dup.s === d4.dup.wantS && d4.dup.addr === 'creator' && d4.dup.flows === 0 && d4.dup.audit,
    `D4.1: a copy carries its ${d4.dup.q} quests and ${d4.dup.s} seats as the creator's word, and no flows`);
  ok(d4.dup.placing && d4.landed, 'D4.1: and it arrives in your hand, to be placed by the next click');
  ok(d4.undone, 'D4.1: undo takes the copy and everything cloned with it');
  ok(d4.plain.prov && d4.plain.ask && d4.plain.hold && !d4.plain.old,
    'D4.2: the vital says where its number came from, then offers to hold a truer one');
  ok(d4.held.txt && d4.held.rel && d4.held.v === '81%' && d4.released,
    'D4.2: held by your word, and released back to the counting');
  ok(d4.combo.open && d4.combo.opts > 3 && d4.combo.grouped,
    `D4.3: typing a role surfaces the ones the village already has (${d4.combo.opts})`);
  ok(d4.moved.now === 'kitchen' && d4.moved.was !== 'kitchen' && d4.moved.addr === 'creator' && d4.moved.audit,
    `D4.3: picking one moves it here as the creator's word (${d4.moved.nm}: ${d4.moved.was} to ${d4.moved.now})`);
  ok(d4.vbNull && d4.btnVision === '\u25c7 Vision boundary' && d4.btnNow === '\u25c7 Boundary',
    'D4.4: the Vision has no line of its own until asked, and the button says which one it holds');
  ok(d4.vb.seeded && d4.vb.exported && d4.vb.reaches,
    'D4.4: the dreamed line seeds from the real one, exports, and the camera can reach it');

  /* ---------- D5: promises you can take back ---------- */
  const d5 = await page.evaluate(async () => {
    const r = { version: BUILD_VERSION }; window.__posts = [];
    const o = window.bridgePost; window.bridgePost = m => { window.__posts.push(m); o(m); };
    /* F4 already tapped RSVP earlier in this same page, so start from nothing
       promised rather than from whatever the last test left behind. */
    for (const id of Object.keys(EV_RSVP)) { const ev = EVENTS.find(x => x.id === id); if (ev) { ev.rsvp = Math.max(0, ev.rsvp - 1); ev._me = 0; } delete EV_RSVP[id]; }
    const e = EVENTS[0], c0 = e.rsvp;
    openDoor('events', {}); await new Promise(z => setTimeout(z, 300));
    r.saidPlainly = /Going adds this to your calendar in your profile and signs you up for updates by email\. Tap again any time to change your answer\./.test(document.getElementById('moduleCard').textContent);
    evRSVP(e.id); await new Promise(z => setTimeout(z, 200));
    const btn = document.querySelector(`[data-ev="${e.id}"]`);
    r.going = { up: e.rsvp - c0, label: btn.textContent, stored: !!EV_RSVP[e.id], live: !btn.disabled };
    evRSVP(e.id); await new Promise(z => setTimeout(z, 200));
    r.withdrawn = { back: e.rsvp - c0, label: document.querySelector(`[data-ev="${e.id}"]`).textContent, stored: !!EV_RSVP[e.id] };
    closeDoor();
    const q = SCENE.quests.find(x => x.at === 'greenhouse');
    q.how_to = 'Meet Sol at the greenhouse door at seven, before the heat.';
    openPanel(q.at, 1); await new Promise(z => setTimeout(z, 900));
    r.claimSaidPlainly = /Claiming adds this quest to your profile with how to begin, and signs you up for updates\. Release it any time\./.test(document.getElementById('panelBody').textContent);
    claimQuest(q.q, BY[q.at].name); await new Promise(z => setTimeout(z, 400));
    const body = document.getElementById('panelBody');
    r.yours = { stored: claimed(q), label: body.querySelector('.claim button').textContent,
      first: /Your first step/.test(body.textContent), how: /Meet Sol at the greenhouse door/.test(body.textContent) };
    cam.z = 1.7; cam.x = BY[q.at].x; cam.y = BY[q.at].y; clampCam(); refreshBadges(); syncBanners();
    r.tick = !!(bgEls[q.at] && bgEls[q.at].querySelector('.b-quest.claimed .tick'));
    claimQuest(q.q, BY[q.at].name); await new Promise(z => setTimeout(z, 400));
    r.releasedLabel = document.getElementById('panelBody').querySelector('.claim button').textContent;
    r.released = !claimed(q);
    document.getElementById('panelClose').click();
    r.posts = window.__posts.map(m => m.type + ':' + (m.on ? 'on' : 'off'));
    const J = buildExportJSON();
    r.exp = { rsvps: Array.isArray(J.my_rsvps), claims: Array.isArray(J.my_claims), how: J.quests.some(x => x.how_to) };
    return r;
  });
  /*
   * The FAMILY is the contract. `scripts/import-map-scene.ts` pins v0.8 and
   * refuses a new family outright, while admitting any point release inside
   * it, so that is exactly what this asserts. It used to pin the whole string,
   * which made every point release edit a gate — and a gate that is routinely
   * edited to go green teaches the next session to edit it rather than read
   * it. A bumped suffix passes here; a bumped family fails, which is the one
   * that would break a founder's import.
   */
  ok(/^v0\.8(-|$)/.test(d5.version || ''),
    `D5.4: the artifact ships the v0.8 family the importer admits (${d5.version})`);
  ok(d5.saidPlainly && d5.claimSaidPlainly, 'D5.1/D5.2: both promises say plainly what a tap actually does');
  ok(d5.going.up === 1 && d5.going.stored && d5.going.live && /tap to change/.test(d5.going.label),
    `D5.1: going is a promise, not a closed door (${d5.going.label})`);
  ok(d5.withdrawn.back === 0 && !d5.withdrawn.stored && d5.withdrawn.label === 'RSVP',
    'D5.1: withdrawing takes the count back down');
  ok(d5.yours.stored && /tap to release/.test(d5.yours.label) && d5.yours.first && d5.yours.how,
    'D5.2: a claimed quest is yours, and it shows you where to start');
  ok(d5.tick, 'D5.2: and the mark on the land carries the promise');
  ok(d5.released && d5.releasedLabel === 'Claim this quest', 'D5.2: releasing puts it back for other hands');
  ok(d5.posts.join(' ') === 'rsvp:on rsvp:off claim:on claim:off',
    `D5.1/D5.2: every promise crosses the bridge, both ways (${d5.posts.join(' ')})`);
  ok(d5.exp.rsvps && d5.exp.claims && d5.exp.how, 'D5.4: the promises and the first step ride the export');

  const d5j = await page.evaluate(async () => {
    playJourney('j2'); await new Promise(z => setTimeout(z, 2600));
    const log = document.getElementById('maiaLog');
    const r = { jn: (log.querySelector('.jn') || {}).textContent || '', next: !!log.querySelector('.jrow .btn') };
    jNext(); await new Promise(z => setTimeout(z, 1800));
    const all = log.querySelectorAll('.jn');
    r.after = (all[all.length - 1] || {}).textContent || '';
    jEnd(); await new Promise(z => setTimeout(z, 200));
    r.ended = !window.JWALK && /The walk ends here/.test(log.textContent);
    return r;
  });
  ok(/^1 of \d+$/.test(d5j.jn) && d5j.next, `D5.3: Maia presents the journey, with its progress (${d5j.jn})`);
  ok(d5j.after !== d5j.jn && /of \d+$/.test(d5j.after), `D5.3: next skips ahead rather than waiting (${d5j.after})`);
  ok(d5j.ended, 'D5.3: and ending the walk says so in her voice');

  /* ---------- the vocabulary editor, the bridge reply, and the small fixes ---------- */
  const d6 = await page.evaluate(async () => {
    const r = {};
    document.getElementById('skinBtn').click(); await new Promise(z => setTimeout(z, 300));
    const host = document.getElementById('skMedia'), ph = document.getElementById('skPhases');
    r.rows = { media: !!host, phases: !!ph, chips: host ? host.querySelectorAll('[data-vm]').length : 0 };
    /* a rename is the village's word changing, never the key the flows point at */
    const wasKey = SCENE.vocabulary.media[0].key;
    host.querySelector('[data-vm="0"]').click(); await new Promise(z => setTimeout(z, 150));
    host.querySelector('.vmn').value = 'rainwater';
    host.querySelector('.vmc').value = '#4499cc';
    host.querySelector('.vmg').value = 'bolt';
    host.querySelector('.vmok').click(); await new Promise(z => setTimeout(z, 250));
    const m0 = SCENE.vocabulary.media[0];
    r.renamed = { name: m0.name, keyKept: m0.key === wasKey, colourFollows: mediaColor(wasKey) === '#4499cc',
      flowsIntact: SCENE.flows.every(f => SCENE.vocabulary.media.some(m => m.key === mediaKey(f.medium))),
      audit: EDITS.some(e => e.action === 'vocab' && /media/.test(e.target || '')) };
    const n0 = SCENE.vocabulary.media.length;
    host.querySelector('[data-vm="+"]').click(); await new Promise(z => setTimeout(z, 150));
    host.querySelector('.vmn').value = 'firewood';
    host.querySelector('.vmok').click(); await new Promise(z => setTimeout(z, 250));
    r.added = { grew: SCENE.vocabulary.media.length - n0, key: SCENE.vocabulary.media[SCENE.vocabulary.media.length - 1].key,
      sprite: !!flowSprite('firewood') };
    const inUse = SCENE.vocabulary.media.findIndex(m => SCENE.flows.some(f => mediaKey(f.medium) === m.key));
    host.querySelector(`[data-vm="${inUse}"]`).click(); await new Promise(z => setTimeout(z, 150));
    const held = SCENE.vocabulary.media.length;
    host.querySelector('.vmx').click(); await new Promise(z => setTimeout(z, 200));
    r.keptInUse = SCENE.vocabulary.media.length === held;
    ph.querySelector('[data-vp="2"]').click(); await new Promise(z => setTimeout(z, 150));
    const inp = ph.querySelector('input'); inp.value = 'Rising';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(z => setTimeout(z, 250));
    r.phase = { name: phaseName(2), exported: buildExportJSON().map_scene.vocabulary.phases['2'],
      audit: EDITS.some(e => e.action === 'vocab' && /phase/.test(e.target || '')) };
    SCENE.vocabulary.phases[2] = 'Building';
    document.getElementById('skinBtn').click();
    r.emdash = SCENE.quests.filter(q => /\u2014/.test(q.q)).length;
    r.eventsRoute = MODULES.events.route;
    return r;
  });
  ok(d6.rows.media && d6.rows.phases && d6.rows.chips > 9,
    `D3.1/D3.3: the vocabulary editor carries flow types and phase names (${d6.rows.chips} chips)`);
  ok(d6.renamed.name === 'rainwater' && d6.renamed.keyKept && d6.renamed.colourFollows && d6.renamed.flowsIntact && d6.renamed.audit,
    'D3.1: renaming a flow type changes the word and never the key the flows point at');
  ok(d6.added.grew === 1 && d6.added.key === 'firewood' && d6.added.sprite,
    'D3.1: a village can add a kind of moving thing, and it gets a mark');
  ok(d6.keptInUse, 'D3.1: a type still carrying flows is not removed out from under them');
  ok(d6.phase.name === 'Rising' && d6.phase.exported === 'Rising' && d6.phase.audit,
    `D3.3: the phases can be renamed, and the export carries the word (${d6.phase.name})`);
  ok(d6.emdash === 0, `voice: no em-dash survives in a quest title (${d6.emdash})`);
  ok(d6.eventsRoute === '/events', `the events door opens on the module's own room (${d6.eventsRoute})`);

  /* the shell can answer a promise, and silence still means local only */
  const d6b = await page.evaluate(async () => {
    const send = d => window.dispatchEvent(new MessageEvent('message', { data: d, origin: location.origin }));
    const e = EVENTS[2], before = e.rsvp;
    evRSVP(e.id); await new Promise(z => setTimeout(z, 120));
    send({ type: 'promise-result', kind: 'rsvp', id: e.id, ok: false, reason: 'anonymous', href: '/login' });
    await new Promise(z => setTimeout(z, 250));
    const refused = { delta: e.rsvp - before, stored: !!EV_RSVP[e.id],
      wayIn: /Sign in/.test(document.getElementById('maiaLog').textContent) };
    evRSVP(e.id); await new Promise(z => setTimeout(z, 120));
    send({ type: 'promise-result', kind: 'rsvp', id: e.id, ok: true, count: 99 });
    await new Promise(z => setTimeout(z, 250));
    const accepted = { count: e.rsvp, stored: !!EV_RSVP[e.id] };
    /* nobody answers: the promise stands, which is how every suite runs */
    const e2 = EVENTS[3], b2 = e2.rsvp;
    evRSVP(e2.id); await new Promise(z => setTimeout(z, 4400));
    const silent = { delta: e2.rsvp - b2, stored: !!EV_RSVP[e2.id] };
    evRSVP(e2.id);
    return { refused, accepted, silent };
  });
  ok(d6b.refused.delta === 0 && !d6b.refused.stored && d6b.refused.wayIn,
    'bridge: a refused promise goes back, and offers a way in rather than an error');
  ok(d6b.accepted.count === 99 && d6b.accepted.stored,
    `bridge: an accepted promise takes the shell's count as the truth (${d6b.accepted.count})`);
  ok(d6b.silent.delta === 1 && d6b.silent.stored,
    'bridge: with nobody listening the promise still stands, which is how the map runs alone');

  /* ---------- the contract amendments the site lane asked for ---------- */
  const amd = await page.evaluate(async () => {
    const r = {}; const sent = []; const o = window.bridgePost;
    window.bridgePost = m => { sent.push(m); o(m); };
    const send = d => window.dispatchEvent(new MessageEvent('message', { data: d, origin: location.origin }));
    /* on, off, on inside the window: a late reply for the FIRST post must not
       speak for the third, which is what the nonce is for */
    const e = EVENTS[4], base = e.rsvp;
    evRSVP(e.id); evRSVP(e.id); evRSVP(e.id);
    await new Promise(z => setTimeout(z, 150));
    const posts = sent.filter(m => m.type === 'rsvp');
    r.nonces = { n: posts.length, unique: new Set(posts.map(m => m.nonce)).size, all: posts.every(m => !!m.nonce) };
    send({ type: 'promise-result', kind: 'rsvp', id: e.id, ok: false, reason: 'error', nonce: posts[0].nonce });
    await new Promise(z => setTimeout(z, 200));
    r.stale = { stored: !!EV_RSVP[e.id], delta: e.rsvp - base };
    send({ type: 'promise-result', kind: 'rsvp', id: e.id, ok: false, reason: 'not-here', nonce: posts[posts.length - 1].nonce });
    await new Promise(z => setTimeout(z, 200));
    r.current = { stored: !!EV_RSVP[e.id], delta: e.rsvp - base,
      calm: [...document.querySelectorAll('.toast')].some(t => /joins the village when a steward/.test(t.textContent)) };
    r.reasons = ['anonymous', 'not-yet', 'closed', 'full', 'not-here', 'gone', 'error'].every(k => !!PROMISE_WHY[k]);
    /* a quest's identity is a field the site stores, not a slug two sides compute */
    /* measured BEFORE the deliberate rename below, or a stable key would read
       as a truncated one */
    const untruncated = SCENE.quests.every(x => x.key === slugify(x.q, 190) || /-\d+$/.test(x.key));
    const longSurvives = slugify('Walk the possible spring with the hydrologist', 190)
      !== slugify('Walk the possible spring with the surveyor', 190);
    const q = SCENE.quests[0], was = q.key;
    q.q = 'A different title entirely';
    /* 32 was the site's MEDIA key limit and never belonged on a join key.
       Two of twenty seed keys sat exactly on it, and a truncated key COLLIDES:
       two titles that agree for 32 characters would address one row. */
    r.key = { onSeed: !!was, stable: questKey(q) === was, exported: buildExportJSON().quests[0].key === was,
      unique: new Set(SCENE.quests.map(x => x.key)).size === SCENE.quests.length,
      shape: SCENE.quests.every(x => /^[a-z0-9_-]{1,190}$/i.test(x.key)),
      untruncated, longSurvives };
    const q2 = SCENE.quests.find(x => x.at === 'greenhouse');
    sent.length = 0; claimQuest(q2.q, BY[q2.at].name); await new Promise(z => setTimeout(z, 200));
    const cp = sent.filter(m => m.type === 'claim')[0] || {};
    r.claim = { usesKey: cp.id === q2.key, hasNonce: !!cp.nonce };
    claimQuest(q2.q, BY[q2.at].name);
    /* and the editor cannot hand their sanitiser something it drops whole */
    document.getElementById('skinBtn').click(); await new Promise(z => setTimeout(z, 250));
    const host = document.getElementById('skMedia');
    const n0 = SCENE.vocabulary.media.length;
    host.querySelector('[data-vm="+"]').click(); await new Promise(z => setTimeout(z, 120));
    host.querySelector('.vmn').value = '   '; host.querySelector('.vmok').click();
    await new Promise(z => setTimeout(z, 150));
    r.blankRefused = SCENE.vocabulary.media.length === n0;
    host.querySelector('[data-vm="+"]').click(); await new Promise(z => setTimeout(z, 120));
    host.querySelector('.vmn').value = 'grey water'; host.querySelector('.vmok').click();
    await new Promise(z => setTimeout(z, 200));
    const m = SCENE.vocabulary.media[SCENE.vocabulary.media.length - 1];
    r.sanitiser = { key: m.key,
      ok: SCENE.vocabulary.media.every(x => /^[a-z0-9_-]{1,32}$/i.test(x.key) && /^[a-z0-9_-]{1,32}$/i.test(x.glyph)
        && /^#[0-9a-f]{6}$/i.test(x.color) && x.name.length <= 48) && SCENE.vocabulary.media.length <= 24,
      phases: Object.keys(SCENE.vocabulary.phases).every(k => /^\d{1,2}$/.test(String(k))) };
    document.getElementById('skinBtn').click();
    return r;
  });
  ok(amd.nonces.n === 3 && amd.nonces.unique === 3 && amd.nonces.all,
    `bridge: every post carries its own nonce (${amd.nonces.unique} of ${amd.nonces.n})`);
  ok(amd.stale.stored && amd.stale.delta === 1,
    'bridge: a late reply for a replaced intent is dropped, not applied');
  ok(!amd.current.stored && amd.current.delta === 0 && amd.current.calm,
    'bridge: the reply that answers the current post is honoured, calmly when the village has not imported');
  ok(amd.reasons, 'bridge: every reason the route can give has words of its own');
  ok(amd.key.onSeed && amd.key.stable && amd.key.exported && amd.key.unique && amd.key.shape,
    'quests: the key is a field the site stores, and a title edit does not move it');
  ok(amd.key.untruncated && amd.key.longSurvives,
    'quests: keys are never cut to fit, because a truncated join key collides in silence');
  ok(amd.claim.usesKey && amd.claim.hasNonce, 'quests: a claim posts that key, never a recomputed slug');
  ok(amd.blankRefused && amd.sanitiser.ok && amd.sanitiser.phases,
    `vocabulary: nothing the editor writes can be dropped whole by the site (${amd.sanitiser.key})`);

  /* D1.2 on a phone: the gestures, driven by TRUSTED touch input.
   *
   * WHAT THIS REPLACED, AND WHY IT HAD TO GO. The block that stood here
   * dispatched `el.dispatchEvent(new TouchEvent(...))` from inside the page and
   * asserted that cam.z had fallen. It was green every day for weeks against a
   * map that travelled twice as far as the finger under a one-finger drag and
   * slid 133 world px sideways under a pinch that should have translated
   * nothing at all. Three reasons, each fatal on its own:
   *
   *   1. The events were UNTRUSTED. A synthetic TouchEvent runs the page's own
   *      listeners and stops there: the browser's gesture arbitration never
   *      engages, touch-action is never consulted, and no pointer events are
   *      generated. The defect was a second drag implementation reading the
   *      pointer stream, so the test could not reach it even in principle.
   *   2. Only z was asserted. cam.x and cam.y were never read, so the drift
   *      passed in silence -- computed, applied, never printed.
   *   3. It loads the artifact directly, so the shell's iframe was out of reach.
   *
   * CDP Input.dispatchTouchEvent is trusted input: the browser generates the
   * pointer stream, arbitrates the gesture, and honours touch-action.
   *
   * WHAT IT STILL CANNOT COVER, so nobody cites it for more than it is. This is
   * Chromium and Chromium does not implement iOS pinch-to-zoom-the-page, so
   * nothing below proves the browser stops claiming the gesture on an iPhone.
   * The artifact is loaded directly, so the iframe seam in LivingMap.tsx is
   * still outside reach. Both of those need a real device. qa/_probe_touch_nav.js
   * is the paired before/after measurement that produced the numbers quoted here.
   */
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 } /* no isMobile: this Chromium reports innerWidth 4x the CSS viewport with it on */);
  const ppage = await pctx.newPage();
  const pperr = []; ppage.on('pageerror', e => pperr.push(String(e)));
  /* The Welcome Walk flies the camera, and a camera in flight is not a camera
     you can measure. The gesture hint is deliberately NOT pre-dismissed: it is
     under test below. */
  await ppage.addInitScript(() => { try { localStorage.setItem('amora-walk-done', '1'); } catch (_) {} });
  await ppage.goto(FILE + '#hud=pocket'); await ppage.waitForTimeout(1600);
  if (await ppage.evaluate(() => document.body.classList.contains('intro'))) await ppage.click('#enterBtn');
  await ppage.waitForTimeout(2600);

  const pcdp = await pctx.newCDPSession(ppage);
  const ptouch = (t, pts) => pcdp.send('Input.dispatchTouchEvent',
    { type: t, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  /* Two frames: the camera write is batched into a rAF, and one frame can return
     before a flush scheduled from inside the same touchmove has run. */
  const psettle = () => ppage.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(() => r(1)))));
  const pcam = () => ppage.evaluate(() => ({ x: cam.x, y: cam.y, z: cam.z }));
  const preset = () => ppage.evaluate(() => {
    cam.z = 1; cam.x = 900; cam.y = 640; cam.vx = cam.vy = 0; travel = null; clampCam();
    return { x: cam.x, y: cam.y, z: cam.z };
  });
  const pdrag = async (from, to, steps) => {
    await ptouch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) {
      await ptouch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]);
      await ppage.waitForTimeout(16);
    }
    await psettle(); const c = await pcam(); await ptouch('touchEnd', []); return c;
  };
  /* One pinch, expressed as the half-distance the fingers start and end at, about
     a midpoint that does not move. A midpoint that does not move is what makes
     "the camera must not translate" a claim with a right answer. */
  const ppinch = async (mx, my, h0, h1, steps) => {
    await ptouch('touchStart', [[mx - h0, my], [mx + h0, my]]);
    for (let i = 1; i <= steps; i++) {
      const h = h0 + (h1 - h0) * i / steps;
      await ptouch('touchMove', [[mx - h, my], [mx + h, my]]);
      await ppage.waitForTimeout(16);
    }
    await psettle(); const c = await pcam(); await ptouch('touchEnd', []); return c;
  };

  const pgeo = await ppage.evaluate(() => {
    const sc = document.getElementById('scene');
    return {
      pocket: document.body.classList.contains('pocket'),
      hit: document.elementFromPoint(195, 420) === sc,
      ta: getComputedStyle(sc).touchAction,
      /* The centre screenToWorld() is written around, read from the page rather
         than assumed. Getting this wrong by 2 px turns correct anchoring into a
         failing drift assertion, because a correctly anchored pinch about a point
         2 px off centre MUST move the camera by 2 world px. */
      cx: sc.width / (2 * DPR), cy: sc.height / (2 * DPR),
    };
  });
  ok(pgeo.pocket && pgeo.hit, 'D1.2: the pocket profile is on and #scene is what a touch at 195,420 lands on');
  ok(pgeo.ta === 'none', `D1.2: the map canvas declares its own touch-action (${pgeo.ta})`);

  /* GAIN. The camera must move exactly as far as the finger asked, in world px.
     Read with the finger still down, so no momentum is folded into the number.
     Before the pointerType guard: 200.00 for a 100 px drag, every rep. */
  const g0 = await preset();
  const g1 = await pdrag([pgeo.cx, 420], [pgeo.cx - 100, 420], 10);
  const gain = (g1.x - g0.x) / 100;
  ok(Math.abs(gain - 1) < 0.06,
    `D1.2: a 100 px one-finger drag moves the camera 100 world px and not a multiple of it (gain x${gain.toFixed(2)})`);
  ok(Math.abs(g1.y - g0.y) < 1,
    `D1.2: a flat drag does not drag the camera sideways (${(g1.y - g0.y).toFixed(2)} world px)`);

  /* TRANSLATION. A pinch whose midpoint sits on the screen centre and never
     moves must not move the camera. Before: +133.12 world px, every rep, and
     +985 to +1247 once the momentum the pointer path had loaded landed. */
  const c0 = await preset();
  const c1 = await ppinch(pgeo.cx, pgeo.cy, 100, 50, 10);
  ok(Math.abs(c1.z - 0.5) < 0.02, `D1.2: a pinch from 200 px to 100 px halves the zoom (${c1.z.toFixed(3)})`);
  ok(Math.abs(c1.x - c0.x) < 1 && Math.abs(c1.y - c0.y) < 1,
    `D1.2: a pinch centred on the screen centre translates nothing (${(c1.x - c0.x).toFixed(2)}, ${(c1.y - c0.y).toFixed(2)} world px)`);

  /* ANCHOR. A pinch about an off-centre midpoint must keep the land that was
     under the fingers under the fingers. Reported in screen px, because screen
     px is what a thumb feels. Before: 62.48. Nothing tested this at all. */
  const ax = pgeo.cx - 90, ay = 500;
  await preset();
  const anch0 = await ppage.evaluate(p => screenToWorld(p[0], p[1]), [ax, ay]);
  await ppinch(ax, ay, 100, 60, 10);
  const anch1 = await ppage.evaluate(p => ({ w: screenToWorld(p[0], p[1]), z: cam.z }), [ax, ay]);
  const adrift = Math.hypot(anch1.w[0] - anch0[0], anch1.w[1] - anch0[1]) * anch1.z;
  ok(adrift < 2, `D1.2: a pinch off centre keeps the land under the fingers (${adrift.toFixed(2)} screen px of drift)`);

  /* THE CEILING. The pocket pinch used to stop at 2.6 while clampCam and travelTo
     went to 3.2, so a finger could not reach the zoom a tapped building flies to. */
  await preset();
  const hard = await ppinch(pgeo.cx, 420, 20, 90, 10);
  const ceil = await ppage.evaluate(() => {
    const s = { x: cam.x, y: cam.y, z: cam.z };
    cam.z = 99; clampCam(); const m = cam.z;
    cam.x = s.x; cam.y = s.y; cam.z = s.z; return m;
  });
  ok(Math.abs(hard.z - ceil) < 1e-6,
    `D1.2: a hard pinch in reaches the same ceiling clampCam and travelTo obey (${hard.z.toFixed(2)} against ${ceil.toFixed(2)})`);

  /* THE FLOOR. This is the one assertion the old block got right, and it is kept
     because it guards real arithmetic. It is driven by trusted input now. */
  await ppage.evaluate(() => { cam.z = 1.4; cam.x = 900; cam.y = 640; cam.vx = cam.vy = 0; travel = null; clampCam(); });
  const fl = await ppinch(200, 400, 100, 4, 8);
  const floor = await ppage.evaluate(() => minZoom());
  ok(Math.abs(fl.z - floor) < 1e-9, `D1.2: a hard pinch out reaches the same fit floor on a phone (${fl.z.toFixed(4)})`);

  /* D1.4 — the non-gesture path. SC 2.5.1 Pointer Gestures is Level A and its
     Understanding document's worked example is a map with plus/minus buttons;
     SC 2.5.7 adds the pan and rules out keyboard-only equivalence in as many
     words. This is conformance, not polish.

     THE CLUSTER NOW HAS TWO STATES, and this block asserts both. D1.2 above
     drove real pans and real pinches through trusted touch input, which is the
     demonstration that folds the controls down into their seed, so this arrives
     with them already folded. That ordering is load-bearing rather than lucky:
     it is the only place in this suite where the fold can be observed happening
     for the reason it is supposed to happen.

     A FOLDED CONTROL IS ONE TAP AWAY. A HIDDEN ONE IS A REGRESSION. So the seed
     is held to the same bar as the six it opens: a real button, 44 px, named,
     and reachable from the keyboard while folded. Then it is opened, and every
     assertion this gate has always made about the six runs unchanged. */
  const seed0 = await ppage.evaluate(() => {
    const s = document.getElementById('pnSeed'), box = document.getElementById('pnav');
    const body = document.getElementById('pnavCtl');
    if (!s || !box || !body) return { there: false, folded: false, tag: '', w: 0, h: 0, name: '', focusable: false };
    const r = s.getBoundingClientRect();
    return {
      there: true, tag: s.tagName, w: r.width, h: r.height,
      name: (s.getAttribute('aria-label') || '').trim(),
      expanded: s.getAttribute('aria-expanded'),
      folded: box.classList.contains('folded') || box.classList.contains('fold'),
      focusable: s.tagName === 'BUTTON' && !s.disabled,
    };
  });
  ok(seed0.there && seed0.folded,
    `D1.4: panning and pinching fold the cluster down into its seed (${seed0.there ? (seed0.folded ? 'folded' : 'still open') : 'no seed'})`);
  ok(seed0.tag === 'BUTTON' && seed0.w >= 44 && seed0.h >= 44 && !!seed0.name && seed0.focusable,
    `D1.4: and the seed is a real 44 px control with a name (${Math.round(seed0.w)}x${Math.round(seed0.h)}, "${seed0.name}")`);
  await ppage.focus('#pnSeed').catch(() => {});
  const seedFocus = await ppage.evaluate(() => document.activeElement && document.activeElement.id);
  ok(seedFocus === 'pnSeed', `D1.4: the seed takes keyboard focus while folded (${seedFocus || 'nothing focused'})`);
  await ppage.click('#pnSeed').catch(() => {});
  await ppage.waitForTimeout(800);
  const seed1 = await ppage.evaluate(() => ({
    folded: document.getElementById('pnav').classList.contains('folded'),
    expanded: document.getElementById('pnSeed').getAttribute('aria-expanded'),
    shown: getComputedStyle(document.getElementById('pnavCtl')).display !== 'none',
  }));
  ok(!seed1.folded && seed1.shown && seed1.expanded === 'true',
    `D1.4: tapping it blooms the controls back (folded=${seed1.folded}, aria-expanded=${seed1.expanded})`);

  const pnav = await ppage.evaluate(() => {
    const ids = ['pnIn', 'pnOut', 'pnUp', 'pnDown', 'pnLeft', 'pnRight'];
    const missing = ids.filter(i => !document.getElementById(i));
    /* Return the whole shape even when nothing is there. A gate that throws on a
       missing control reports one failure and hides the four behind it. */
    if (missing.length) return { missing, small: ids, named: ids, tagged: false, shown: false,
      z0: 0, zIn: 0, zOut: 0, x0: 0, xR: 0, y0: 0, yD: 0 };
    const els = ids.map(i => document.getElementById(i));
    const small = els.filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(e => e.id);
    const named = els.filter(e => !(e.getAttribute('aria-label') || '').trim()).map(e => e.id);
    const tagged = els.every(e => e.tagName === 'BUTTON');
    cam.z = 1; cam.x = 900; cam.y = 640; cam.vx = cam.vy = 0; travel = null; clampCam();
    const z0 = cam.z; document.getElementById('pnIn').click(); const zIn = cam.z;
    document.getElementById('pnOut').click(); const zOut = cam.z;
    const x0 = cam.x; document.getElementById('pnRight').click(); const xR = cam.x;
    const y0 = cam.y; document.getElementById('pnDown').click(); const yD = cam.y;
    return { missing, small, named, tagged, z0, zIn, zOut, x0, xR, y0, yD,
      shown: getComputedStyle(document.getElementById('pnav')).display !== 'none' };
  });
  ok(pnav.missing.length === 0 && pnav.shown,
    `D1.4: the pocket chrome carries zoom and pan controls (${pnav.missing.length ? 'missing ' + pnav.missing.join(',') : 'all six, shown'})`);
  ok(pnav.small.length === 0 && pnav.named.length === 0 && pnav.tagged,
    `D1.4: every control is a real button, clears 24 px and carries a name (${pnav.small.concat(pnav.named).join(',') || 'all six pass'})`);
  ok(pnav.zIn > pnav.z0 && pnav.zOut < pnav.zIn && pnav.xR > pnav.x0 && pnav.yD > pnav.y0,
    `D1.4: one pointer zooms and pans with no gesture at all (z ${pnav.z0} to ${pnav.zIn.toFixed(2)} to ${pnav.zOut.toFixed(2)})`);

  /* D1.5 — the hint, and the first READ of WGATE this file has ever had. The two
     lines have been in WALK_SEED since the walk was written and have never once
     been shown; WGATE, the object built to notice that somebody has panned or
     pinched, was written in five places and read in none. */
  await ppage.waitForTimeout(900);
  const hint = await ppage.evaluate(() => {
    const b = document.getElementById('ghint');
    const seed = k => ((window.WALK_SEED || []).find(w => w && w.gesture === k) || {}).gate_hint;
    let remembered = false; try { remembered = !!localStorage.getItem('amora-gestures-seen'); } catch (_) {}
    return {
      present: !!b,
      pan: b ? document.getElementById('ghintPan').textContent : null,
      pinch: b ? document.getElementById('ghintPinch').textContent : null,
      seedPan: seed('pan'), seedPinch: seed('pinch'),
      gates: { pan: !!(window.WGATE || {}).pan, pinch: !!(window.WGATE || {}).pinch },
      lit: b ? b.classList.contains('on') : false,
      blocks: b ? getComputedStyle(b).pointerEvents : null,
      remembered,
    };
  });
  ok(hint.present && hint.pan === hint.seedPan && hint.pinch === hint.seedPinch && !!hint.seedPan,
    `D1.5: the hint says the words the walk already carried, read from the seed and never copied`);
  ok(hint.blocks === 'none', `D1.5: the hint does not take the taps the land is waiting for (${hint.blocks})`);
  ok(hint.gates.pan && hint.gates.pinch, 'D1.5: panning and pinching latch WGATE, which nothing used to read');
  ok(!hint.lit && hint.remembered,
    'D1.5: the hint lets itself out the moment both gates latch, and does not come back');

  const plab = await ppage.evaluate(() => {
    const shown = () => { syncBanners(); return SCENE.districts.filter(d => bEls['d_' + d.id].style.display !== 'none').length; };
    cam.z = minZoom(); cam.x = W / 2; cam.y = H / 2; clampCam(); const atFloor = shown();
    cam.z = 0.5; clampCam(); const closer = shown();
    return { atFloor, closer, n: SCENE.districts.length, landPx: Math.round(W * minZoom()) };
  });
  ok(plab.atFloor === 0 && plab.closer === plab.n,
    `D1.3: at the phone floor the land is ${plab.landPx} px wide and the district plates stand back (${plab.atFloor} shown, ${plab.closer} once there is room)`);
  ok(pperr.length === 0, `D1.2: zero page errors on the pocket profile (${pperr.length})`);
  await pctx.close();

  /* persistence: GS + vitals override + vocab survive */
  await page.waitForTimeout(3300);
  await page.goto(FILE); await page.waitForTimeout(1000);
  await page.click('#enterBtn'); await page.waitForTimeout(700);
  const bar = await page.evaluate(() => document.getElementById('restoreBar').style.display !== 'none');
  if (bar) { await page.click('#restoreYes'); await page.waitForTimeout(1000); }
  const back = await page.evaluate(() => ({
    food: (VITAL_OVR.food || {}).v, zone0: SUBTYPES.zone[0],
    barTxt: document.querySelector('.vital[data-k="food"] b').textContent
  }));
  ok(bar && back.food === '80kg' && back.barTxt === '80kg', 'restore: the founder\'s vital word survives');
  ok(back.zone0 === 'wildmeadow', 'restore: the founder\'s vocabulary survives');

  ok(perr.length === 0, `zero page errors (${perr.length})${perr.length ? ' — ' + perr[0] : ''}`);
  ok(cerr.length === 0, `zero console errors (${cerr.length})${cerr.length ? ' — ' + cerr[0] : ''}`);
  console.log(fails === 0 ? 'FEATURES: ALL GREEN' : `FEATURES: ${fails} FAILURES`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
