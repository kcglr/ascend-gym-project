// Builds index.html: the page shell in app.src.html with ui.css, engine.js and ui.js inlined.
// The art in assets/ stays beside the page and is published with it. Run: node build.js
const fs = require('fs'), path = require('path');
const at = f => path.join(__dirname, f);
const read = f => fs.readFileSync(at(f), 'utf8');
const parts = {
  '/*CSS*/': read('ui.css').trimEnd(),
  '/*ENGINE*/': read('engine.js').split('if (typeof module')[0].trimEnd(),
  '/*UI*/': read('ui.js').trimEnd(),
};
let page = read('app.src.html');
for (const mark of Object.keys(parts)) {
  if (!page.includes(mark)) throw new Error('app.src.html has no ' + mark + ' placeholder');
  page = page.replace(mark, () => parts[mark]);
}
// Every picture the page asks for has to exist, or it would show as a hole on the published page.
// Names are checked three ways: written out in the page, built from a rank, or passed to ic(), sigil() and ob() in ui.js.
const manifest = JSON.parse(read('assets/manifest.json'));
const have = new Set(fs.readdirSync(at('assets')).filter(f => f.endsWith('.webp')));
const E = require('./engine.js');
const ui = parts['/*UI*/'];
const firstArgNames = fn => Array.from(ui.matchAll(new RegExp('\\b' + fn + '\\(([^,)]*)', 'g')), m => Array.from(m[1].matchAll(/'([a-z0-9-]+)'/g), q => q[1])).flat();
const wanted = new Set(Array.from(page.matchAll(/assets\/([a-z0-9-]+)\.webp/g), m => m[1] + '.webp'));
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
fs.writeFileSync(at('index.html'), page);
console.log('index.html written, ' + fs.statSync(at('index.html')).size + ' bytes. Publish it with the ' + have.size + ' pictures in assets/ (' + Math.round(Array.from(have).reduce((n, f) => n + fs.statSync(at('assets/' + f)).size, 0) / 1024) + ' KB).');
