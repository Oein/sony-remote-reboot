// Builds the web app the camera serves: minifies the HTML, CSS and JS and copies the rest.
// usage: node build.mjs [outDir]   (outDir defaults to ../app/build/generated/webAssets/web)
import { minify as minifyHtml } from 'html-minifier-terser';
import { transform } from 'lightningcss';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { minify as minifyJs } from 'terser';

const src = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(src, '../app/build/generated/webAssets/web'));
// Only what the page loads: not this script, the package files or node_modules
const SHIPPED = ['.html', '.css', '.js', '.webmanifest', '.png', '.ttf'];
const SKIP = new Set(['build.mjs']);
// The camera sends these gzipped (name.gzip: the Android build would take a .gz for its own) to browsers
// that take it; images are compressed already
const GZIPPED = ['.html', '.css', '.js', '.webmanifest', '.ttf'];

// iOS Safari 15 and the Chrome of a few years back: what phones still run
const cssTargets = { safari: 15 << 16, ios_saf: 15 << 16, chrome: 90 << 16 };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let before = 0;
let after = 0;
for (const name of readdirSync(src)) {
  const path = join(src, name);
  if (SKIP.has(name) || !statSync(path).isFile() || !SHIPPED.includes(extname(name))) continue;
  const target = join(out, name);
  const ext = extname(name);
  const text = () => readFileSync(path, 'utf8');
  let result;
  if (ext === '.js') {
    // safari10 works around old WebKit scoping bugs; the code is plain ES5, keep it that way
    result = (await minifyJs(text(), { ecma: 5, safari10: true, compress: { passes: 2 }, mangle: true })).code;
  } else if (ext === '.css') {
    result = transform({ filename: name, code: Buffer.from(text()), minify: true, targets: cssTargets }).code.toString();
  } else if (ext === '.html') {
    result = await minifyHtml(text(), {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      minifyCSS: true,
      minifyJS: true,
    });
  } else if (ext === '.webmanifest') {
    result = JSON.stringify(JSON.parse(text()));
  }
  if (result === undefined) copyFileSync(path, target);
  else writeFileSync(target, result);
  before += statSync(path).size;
  if (GZIPPED.includes(ext)) {
    const gz = gzipSync(readFileSync(target), { level: 9 });
    writeFileSync(`${target}.gzip`, gz);
    after += gz.length;
  } else {
    after += statSync(target).size;
  }
}
console.log(`web: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB sent (minified, gzipped) in ${out}`);
