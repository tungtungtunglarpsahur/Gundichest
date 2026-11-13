// Builds the GundiChest page from src/.
//   node tools/build.mjs            -> public/index.html   (site: assets stay separate files in public/assets)
//   node tools/build.mjs --single   -> dist/gundichest.html (one self-contained file, offline only)
// No npm packages are needed; everything it reads is in the repository.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const single = process.argv.includes('--single');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const b64 = (p) => readFileSync(join(ROOT, p)).toString('base64');
const hash = (p) => createHash('sha1').update(readFileSync(join(ROOT, p))).digest('hex').slice(0, 10);

const tpl = read('src/index.html');
let css = read('src/style.css');
const fonts = [
  ['Luckiest Guy', 'src/fonts/luckiest-guy-latin-400-normal.woff2', '400'],
  ['Outfit', 'src/fonts/outfit-latin-wght-normal.woff2', '100 900'],
].map(([fam, file, weight]) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');}`);
css = css.replace('/*{{FONTS}}*/', fonts.join('\n'));

const files = readdirSync(join(ROOT, 'src/js')).filter((f) => f.endsWith('.js')).sort();
// server/crashmath.js is shared: the page draws Rugpull and Rocket with the same curve the server pays by
let js = "(function(){\n'use strict';\n" + `// ---- server/crashmath.js\n${read('server/crashmath.js')}\n` + files.map((f) => `// ---- ${f}\n${read('src/js/' + f)}`).join('\n') + '\n})();\n';
if (/<\/script/i.test(js)) throw new Error('script close tag inside the JS bundle');

// The logo is drawn once (src/logo.svg) and used as the favicon and, as a symbol, inside the page.
const logo = read('src/logo.svg').trim();
const sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
  logo.replace(/^<svg[^>]*>/, '<symbol id="gmark" viewBox="0 0 100 100">').replace(/<\/svg>$/, '</symbol>') + '</svg>';

const ASSETS = ['model.json', 'model.bin', 'albedo.webp', 'normal.jpg', 'mat.jpg', 'ao.jpg', 'three.min.js'];
const head = [], meta = [];
if (single) {
  meta.push(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}">`);
  head.push(`<script>window.__GC_BUILD=${JSON.stringify({ mode: 'single' })};</script>`);
  head.push(`<script type="application/json" id="asset-manifest">${read('public/assets/model.json')}</script>`);
  head.push(`<script type="text/plain" id="asset-model">${b64('public/assets/model.bin')}</script>`);
  for (const [name, file, mime] of [['albedo', 'albedo.webp', 'image/webp'], ['normal', 'normal.jpg', 'image/jpeg'], ['mat', 'mat.jpg', 'image/jpeg'], ['ao', 'ao.jpg', 'image/jpeg']]) {
    head.push(`<script type="text/plain" id="asset-tex-${name}" data-mime="${mime}">${b64('public/assets/' + file)}</script>`);
  }
  const three = read('public/assets/three.min.js');
  if (/<\/script/i.test(three)) throw new Error('script close tag inside three.min.js');
  head.push(`<script>${three}</script>`);
} else {
  writeFileSync(join(ROOT, 'public/favicon.svg'), logo + '\n');
  // Link previews want a full address for the image; on Vercel the build knows the site's own.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
  const og = (host ? 'https://' + host : '') + '/og.png';
  meta.push(
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="GundiChest">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="GundiChest">',
    '<meta property="og:description" content="Open chests, collect cards and trade them with friends.">',
    `<meta property="og:image" content="${og}">`,
    '<meta name="twitter:card" content="summary_large_image">',
  );
  const v = Object.fromEntries(ASSETS.map((a) => [a, hash('public/assets/' + a)]));
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12);
  head.push(`<script>window.__GC_BUILD=${JSON.stringify({ mode: 'site', assets: 'assets/', api: 'api/rpc', commit, v })};</script>`);
}
const html = tpl.replace('/*{{CSS}}*/', () => css).replace('/*{{JS}}*/', () => js).replace('<!--{{ASSETS}}-->', () => head.join('\n'))
  .replace('<!--{{HEAD}}-->', () => meta.join('\n')).replace('<!--{{LOGO}}-->', () => sprite);
for (const mark of ['/*{{CSS}}*/', '/*{{JS}}*/', '<!--{{ASSETS}}-->', '/*{{FONTS}}*/', '<!--{{HEAD}}-->', '<!--{{LOGO}}-->']) if (html.includes(mark)) throw new Error('placeholder left in the page: ' + mark);

const out = single ? 'dist/gundichest.html' : 'public/index.html';
if (!existsSync(join(ROOT, dirname(out)))) mkdirSync(join(ROOT, dirname(out)), { recursive: true });
writeFileSync(join(ROOT, out), html);
console.log(`built ${out}  ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB  (js ${(js.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
