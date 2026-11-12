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
let js = "(function(){\n'use strict';\n" + files.map((f) => `// ---- ${f}\n${read('src/js/' + f)}`).join('\n') + '\n})();\n';
if (/<\/script/i.test(js)) throw new Error('script close tag inside the JS bundle');

const ASSETS = ['model.json', 'model.bin', 'albedo.webp', 'normal.jpg', 'mat.jpg', 'ao.jpg', 'three.min.js'];
const head = [];
if (single) {
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
  const v = Object.fromEntries(ASSETS.map((a) => [a, hash('public/assets/' + a)]));
  head.push(`<script>window.__GC_BUILD=${JSON.stringify({ mode: 'site', assets: 'assets/', api: 'api/rpc', v })};</script>`);
}
const html = tpl.replace('/*{{CSS}}*/', () => css).replace('/*{{JS}}*/', () => js).replace('<!--{{ASSETS}}-->', () => head.join('\n'));
for (const mark of ['/*{{CSS}}*/', '/*{{JS}}*/', '<!--{{ASSETS}}-->', '/*{{FONTS}}*/']) if (html.includes(mark)) throw new Error('placeholder left in the page: ' + mark);

const out = single ? 'dist/gundichest.html' : 'public/index.html';
if (!existsSync(join(ROOT, dirname(out)))) mkdirSync(join(ROOT, dirname(out)), { recursive: true });
writeFileSync(join(ROOT, out), html);
console.log(`built ${out}  ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB  (js ${(js.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
