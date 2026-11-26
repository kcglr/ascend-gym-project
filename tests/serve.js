// A small static server for the browser tests. It serves the page in either of its two forms:
//
//   serve()                 The Claude Artifact: dist/artifact/index.html inside the same wrapper the Artifact
//                           host puts around it, with the pictures in assets/ beside it.
//   serve({ site: true })   The installable web app: dist/site the way GitHub Pages serves it, in a folder
//                           named after the repository. `root` picks another folder, and setRoot() swaps the
//                           folder while the server runs, which is what a new deploy looks like to a browser.
//                           setDown(true) makes the host unreachable.
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = '/ascend-gym-project/';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const wrap = body => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';

module.exports = async function serve(opts) {
  opts = opts || {};
  const missing = [], asked = [];
  let root = opts.root || path.join(ROOT, 'dist', 'site'), down = false;
  const send = (res, file) => {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
    fs.createReadStream(file).pipe(res);
  };
  const server = http.createServer((req, res) => {
    if (down) { req.socket.destroy(); return; }
    const url = decodeURIComponent(req.url.split('?')[0]);
    asked.push(url);
    if (opts.site) {
      if (url === BASE.slice(0, -1)) { res.writeHead(301, { location: BASE }); res.end(); return; }
      const rel = url.startsWith(BASE) ? url.slice(BASE.length) || 'index.html' : null;
      const file = rel == null ? null : path.join(root, rel);
      if (!file || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.push(url); res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      send(res, file);
      return;
    }
    if (url.startsWith('/assets/')) {
      const file = path.join(ROOT, 'assets', path.basename(url));
      if (!fs.existsSync(file)) { missing.push(url); res.writeHead(404); res.end(); return; }
      send(res, file);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(wrap(fs.readFileSync(path.join(ROOT, 'dist', 'artifact', 'index.html'), 'utf8')));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { url: origin + (opts.site ? BASE : '/'), origin, missing, asked, setRoot(dir) { root = dir; }, setDown(on) { down = !!on; }, close: () => { server.closeAllConnections && server.closeAllConnections(); server.close(); } };
};
