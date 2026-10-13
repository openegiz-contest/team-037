# Исходники presentation.pdf

- `deck.html` — слайды (1920×1080), `shot-*.png` — скриншоты интерфейса со стенда.
- `shots.js` — снимает скриншоты с работающего стенда (headless Chrome в сети compose).
- `pdf.js` — печатает `deck.html` в `presentation.pdf` и сохраняет превью слайдов.

```bash
# из этой папки, при запущенном make aktogay
docker run --rm --network openegiz_default -v "$PWD:/out" -w /home/pptruser \
  ghcr.io/puppeteer/puppeteer:23.6.0 sh -c "cp /out/shots.js /out/pdf.js . && node shots.js && node pdf.js"
cp presentation.pdf ../../../presentation.pdf
```
