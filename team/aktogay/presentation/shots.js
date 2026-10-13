// Скриншоты разделов интерфейса для презентации (живой стенд).
const puppeteer = require('puppeteer');
const BASE = 'http://aktogay-ui/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const send = (value, arg = 0) =>
    p.evaluate(
      (v, a) =>
        fetch('ditto/api/2/things/org.aktogay:control/features/command/properties', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: v, arg: a, seq: Date.now() }),
        }).then((r) => r.status),
      value,
      arg,
    );
  const shot = async (hash, file, wait) => {
    await p.evaluate((h) => (window.location.hash = h), hash);
    await sleep(wait);
    await p.screenshot({ path: `/out/${file}` });
    console.log('saved', file);
  };

  await p.goto(`${BASE}?quality=high#/`, { waitUntil: 'domcontentloaded' });
  await sleep(15000);
  await p.screenshot({ path: '/out/shot-mine.png' });
  console.log('saved shot-mine.png');

  console.log('breakdown', await send('breakdown', 0));
  await sleep(45000);
  await shot('#/effect', 'shot-effect.png', 12000);
  await shot('#/scenarios', 'shot-scenarios.png', 4000);
  await shot('#/twins/org.aktogay.smart%3Atruck-105', 'shot-twins.png', 8000);
  console.log('cancel_all', await send('cancel_all'));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
