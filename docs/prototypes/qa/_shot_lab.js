const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_EXE });
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1200 }, deviceScaleFactor: 4 })).newPage();
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, 'charge_lab.html')).href);
  await p.waitForTimeout(600);
  await p.screenshot({ path: process.env.SHOT_DIR + '/charge-lab.png', fullPage: true });
  console.log('ok');
  await b.close();
})();
