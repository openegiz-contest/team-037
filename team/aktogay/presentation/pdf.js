// deck.html → presentation.pdf (1920×1080 на слайд) + превью слайдов в PNG для проверки.
const puppeteer = require('puppeteer');

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto('file:///out/deck.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  console.log('fonts loaded:', [...new Set(fonts)].join(', ') || 'нет (запасные)');
  // Слайды, где содержимое вылезает за 1080 px.
  const overflow = await p.evaluate(() =>
    [...document.querySelectorAll('.slide')]
      .map((s, i) => {
        const r = s.getBoundingClientRect();
        let maxBottom = 0;
        s.querySelectorAll('*').forEach((el) => {
          if (el.classList.contains('foot')) return;
          const e = el.getBoundingClientRect();
          maxBottom = Math.max(maxBottom, e.bottom - r.top);
        });
        return { slide: i + 1, maxBottom: Math.round(maxBottom) };
      })
      .filter((x) => x.maxBottom > 1040),
  );
  console.log('overflow:', JSON.stringify(overflow));
  const n = await p.evaluate(() => document.querySelectorAll('.slide').length);
  for (let i = 0; i < n; i++) {
    const el = (await p.$$('.slide'))[i];
    await el.screenshot({ path: `/out/prev-${String(i + 1).padStart(2, '0')}.png` });
  }
  await p.pdf({ path: '/out/presentation.pdf', width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  console.log('pdf ok, slides:', n);
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
