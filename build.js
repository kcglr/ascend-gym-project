// Builds both forms of the page from the same sources. Run: node build.js
//
//   dist/site/      The installable web app that GitHub Pages serves: the page with its styles and scripts
//                   inlined, the pictures, fonts and icons beside it, a web app manifest and a service worker.
//   dist/artifact/  The page as a Claude Artifact takes it: a body fragment, published with the pictures in assets/.
//
// It stops if a picture or an icon the page asks for does not exist, or if the site would miss a file.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const at = (...f) => path.join(__dirname, ...f);
const read = f => fs.readFileSync(at(f), 'utf8');
const list = (dir, ext) => fs.readdirSync(at(dir)).filter(f => f.endsWith(ext)).sort();
const E = require('./engine.js');

// Fills the placeholders of a template in one pass, so text that was put in is never searched again.
function fillIn(name, template, parts) {
  const seen = new Set();
  const out = template.replace(/\/\*[A-Z]+\*\/|<!--[A-Z]+-->/g, mark => {
    if (!(mark in parts)) return mark;
    seen.add(mark);
    return parts[mark];
  });
  for (const mark of Object.keys(parts)) if (!seen.has(mark)) throw new Error(name + ' has no ' + mark + ' placeholder');
  return out;
}

const css = read('ui.css').trimEnd();
const engine = read('engine.js').split('if (typeof module')[0].trimEnd();
const ui = read('ui.js').trimEnd();
const source = read('app.src.html');
const body = (source.match(/<!--BODY-->\n([\s\S]*?)\n<!--\/BODY-->/) || [])[1];
if (!body) throw new Error('app.src.html has no <!--BODY--> ... <!--/BODY--> part');

// ---------- the Claude Artifact ----------
const artifact = fillIn('app.src.html', source, { '/*CSS*/': css, '/*ENGINE*/': engine, '/*UI*/': ui });

// Every picture the page asks for has to exist, or it would show as a hole on the published page.
// Names are checked three ways: written out in the page, built from a rank, or passed to ic(), sigil() and ob() in ui.js.
const manifest = JSON.parse(read('assets/manifest.json'));
const have = new Set(list('assets', '.webp'));
const firstArgNames = fn => Array.from(ui.matchAll(new RegExp('\\b' + fn + '\\(([^,)]*)', 'g')), m => Array.from(m[1].matchAll(/'([a-z0-9-]+)'/g), q => q[1])).flat();
const wanted = new Set(Array.from(artifact.matchAll(/assets\/([a-z0-9-]+)\.webp/g), m => m[1] + '.webp'));
for (const r of E.RANKS) wanted.add('rank-' + r.id.toLowerCase() + '.webp');
for (const n of firstArgNames('ob')) wanted.add(n + '.webp');
const listed = new Set([...Object.values(manifest.ranks), ...Object.values(manifest.objects), manifest.hero, manifest.aura, manifest.banner, manifest.bg, manifest.glyphs.file]);
const glyphs = JSON.parse((ui.match(/const GLYPHS = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
const problems = [];
for (const f of wanted) if (!have.has(f)) problems.push('the page asks for ' + f + ', which is not in assets/');
for (const f of listed) if (!have.has(f)) problems.push('assets/manifest.json lists ' + f + ', which is not in assets/');
for (const f of have) if (!listed.has(f)) problems.push('assets/' + f + ' is not in assets/manifest.json (run python3 art/process.py)');
if (glyphs.join() !== manifest.glyphs.order.join()) problems.push('GLYPHS in ui.js and the icon order in assets/manifest.json differ');
for (const n of [...firstArgNames('ic'), ...firstArgNames('sigil')]) if (!glyphs.includes(n)) problems.push('ui.js asks for an icon called ' + n + ', which the icon sheet does not have');
if (problems.length) throw new Error('art problems:\n  ' + Array.from(new Set(problems)).join('\n  '));

// ---------- the installable web app ----------
// What goes beside the page, as [path on the site, source file].
const files = [
  ['manifest.webmanifest', 'pwa/manifest.webmanifest'],
  ...list('assets', '.webp').map(f => ['assets/' + f, 'assets/' + f]),
  ...list('pwa/fonts', '.woff2').map(f => ['fonts/' + f, 'pwa/fonts/' + f]),
  ['fonts/LICENSE.txt', 'pwa/fonts/LICENSE.txt'],
  ...list('pwa/icons', '.png').map(f => ['icons/' + f, 'pwa/icons/' + f]),
  ...list('pwa/splash', '.jpg').map(f => ['splash/' + f, 'pwa/splash/' + f]),
].map(([to, from]) => ({ to, from, bytes: fs.readFileSync(at(from)) }));
const onSite = new Set(files.map(f => f.to));

// An iPhone shows a launch picture only if one matches its screen exactly, so there is one <link> per screen size.
const splash = JSON.parse(read('pwa/splash/splash.json')).map(s =>
  `<link rel="apple-touch-startup-image" media="screen and (device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)" href="splash/${s.file}">`).join('\n');

// The day the app itself last changed, from git. A commit that only touches the notes or the tests keeps the day.
let day = '';
try { day = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'engine.js', 'ui.js', 'ui.css', 'app.src.html', 'assets', 'pwa'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}

const worker = read('pwa/sw.js');
const draft = fillIn('pwa/shell.html', read('pwa/shell.html'), {
  '<!--SPLASH-->': splash, '/*FONTS*/': read('pwa/fonts/fonts.css').trimEnd(), '/*CSS*/': css, '/*BASE*/': read('pwa/pwa.css').trimEnd(),
  '<!--BODY-->': body, '/*ENGINE*/': engine, '/*SHELL*/': read('pwa/pwa.js').trimEnd(), '/*UI*/': ui,
});
// The version is a fingerprint of everything the site serves: the same sources always give the same version,
// and any change to the page, a picture or the worker gives a new one, which is what makes installed copies update.
const print = crypto.createHash('sha256').update(draft).update(worker).update(day);
for (const f of files) print.update(f.to + '\0').update(f.bytes);
const version = print.digest('hex').slice(0, 10);
const page = fillIn('pwa/pwa.js', draft, { '/*VERSION*/': version, '/*BUILT*/': day });

// The copy kept for offline use: the page and everything it can show. The large install icons and the launch
// pictures are fetched by the phone itself when the app is installed, and are left out.
const offline = ['./', ...files.map(f => f.to).filter(f => /^manifest\.webmanifest$|^assets\/|^fonts\/.*\.woff2$|^icons\/(favicon-32|apple-touch-icon|icon-192)\.png$/.test(f))];
const sw = fillIn('pwa/sw.js', worker, { '/*VERSION*/': version, '/*FILES*/': offline.map(f => JSON.stringify(f)).join(', ') });

// Nothing the page or the manifest points at may be missing from the site, and nothing the page shows may be missing offline.
const site = [];
const refs = new Set([...page.matchAll(/(?:href|src)="([\w.\/-]+)"/g), ...page.matchAll(/url\(["']?([\w.\/-]+)["']?\)/g)].map(m => m[1])); // plain paths only: the ones ui.js builds are checked above
for (const r of refs) {
  if (!onSite.has(r)) site.push('the page points at ' + r + ', which is not on the site');
  else if (!/^splash\/|^manifest|^icons\//.test(r) && !offline.includes(r)) site.push(r + ' is shown by the page but is not kept for offline use');
}
for (const f of files) if (/^assets\/|^fonts\/.*woff2$/.test(f.to) && !offline.includes(f.to)) site.push(f.to + ' is not kept for offline use');
const webapp = JSON.parse(read('pwa/manifest.webmanifest'));
for (const icon of webapp.icons) {
  const f = files.find(x => x.to === icon.src);
  if (!f) { site.push('the web app manifest lists ' + icon.src + ', which is not on the site'); continue; }
  const size = f.bytes.readUInt32BE(16) + 'x' + f.bytes.readUInt32BE(20); // a PNG states its width and height right after its header
  if (size !== icon.sizes) site.push(icon.src + ' is ' + size + ', but the web app manifest says ' + icon.sizes);
}
if (site.length) throw new Error('site problems:\n  ' + Array.from(new Set(site)).join('\n  '));

// ---------- write ----------
fs.rmSync(at('dist'), { recursive: true, force: true });
const write = (to, data) => { fs.mkdirSync(path.dirname(at('dist', to)), { recursive: true }); fs.writeFileSync(at('dist', to), data); };
write('artifact/index.html', artifact);
write('site/index.html', page);
write('site/sw.js', sw);
for (const f of files) write('site/' + f.to, f.bytes);

const kb = n => Math.round(n / 1024) + ' KB';
const sum = pick => files.filter(f => pick(f.to)).reduce((n, f) => n + f.bytes.length, 0);
console.log('dist/artifact/index.html  ' + kb(Buffer.byteLength(artifact)) + '. Publish it with the ' + have.size + ' pictures in assets/ (' + kb(sum(f => f.startsWith('assets/'))) + ').');
console.log('dist/site/                version ' + version + (day ? ' of ' + day : '') + ': the page ' + kb(Buffer.byteLength(page)) + ', ' + files.length + ' files beside it ('
  + kb(sum(() => true)) + '), ' + offline.length + ' of them kept for offline use (' + kb(Buffer.byteLength(page) + sum(f => offline.includes(f))) + ').');
