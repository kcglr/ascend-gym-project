// A small static server for the browser tests: the built page inside the same wrapper the Artifact host
// puts around it, with the pictures in assets/ beside it.
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.webp': 'image/webp', '.json': 'application/json' };
const wrap = body => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';

module.exports = async function serve() {
  const missing = [];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/assets/')) {
      const file = path.join(ROOT, 'assets', path.basename(url));
      if (!fs.existsSync(file)) { missing.push(url); res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(wrap(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port + '/', missing, close: () => server.close() };
};
