// Generates home-screen / favicon images for every stage into icons/app/<stage>/.
// Usage (needs Node + Playwright, and @phosphor-icons/core unpacked somewhere):
//   node tools/make-app-icons.js <path-to>/@phosphor-icons/core/package
// The glyph is Phosphor "check-circle" (duotone), white on the stage colour.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const STAGES = {
  main:    ['#4c6ef5', '#364fc7'], // gradient: top-left → bottom-right
  staging: ['#f08c00', '#d9480f'],
  alpha:   ['#d6336c', '#a61e4d'],
  dev:     ['#7950f2', '#5f3dc4'],
  local:   ['#6c757d', '#343a40'],
};
const GLYPH = 'check-circle';

const pkg = process.argv[2];
if (!pkg) { console.error('Usage: node tools/make-app-icons.js <phosphor-core-package-dir>'); process.exit(1); }
const glyph = fs.readFileSync(path.join(pkg, 'assets/duotone', `${GLYPH}-duotone.svg`), 'utf8')
  .match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

// rounded: transparent corners (browser tabs, Android "any" icons).
// Full-bleed (iOS and Android "maskable"): the phone applies its own shape.
function svg({ from, to, rounded, glyphScale }) {
  const r = rounded ? 56 : 0; // on a 256 canvas
  const g = 256 * glyphScale, o = (256 - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="256" height="256" rx="${r}" fill="url(#bg)"/>
  <svg x="${o}" y="${o}" width="${g}" height="${g}" viewBox="0 0 256 256" fill="#fff">${glyph}</svg>
</svg>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [stage, [from, to]] of Object.entries(STAGES)) {
    const dir = path.join(__dirname, '..', 'icons', 'app', stage);
    fs.mkdirSync(dir, { recursive: true });
    const outputs = [
      ['favicon.svg', null, { rounded: true, glyphScale: 0.66 }],
      ['favicon-32.png', 32, { rounded: true, glyphScale: 0.70 }],
      ['icon-192.png', 192, { rounded: true, glyphScale: 0.60 }],
      ['icon-512.png', 512, { rounded: true, glyphScale: 0.60 }],
      ['icon-maskable-512.png', 512, { rounded: false, glyphScale: 0.50 }], // inside the safe zone
      ['apple-touch-icon.png', 180, { rounded: false, glyphScale: 0.58 }],
    ];
    for (const [file, size, opts] of outputs) {
      const markup = svg({ from, to, ...opts });
      if (!size) { fs.writeFileSync(path.join(dir, file), markup + '\n'); continue; }
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
      await page.screenshot({ path: path.join(dir, file), omitBackground: true });
    }
    console.log('made', stage);
  }
  await browser.close();
})();
