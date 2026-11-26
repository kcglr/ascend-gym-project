// The service worker of the installable web app. build.js fills in the version and the list of files.
//
// It keeps one complete copy of the app on the device, so the app opens at once and without a network.
// Every request inside the app's folder is answered from that copy. When a new version is deployed the
// browser fetches this file again, sees that it changed, and installs the new copy beside the old one.
// The new copy takes over when the page asks for it ("skip-waiting") or when the app is next opened cold.
const VERSION = '/*VERSION*/';
const FILES = [/*FILES*/];
const PAGE = './';
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = 'ascend:' + SCOPE + ':';
const CACHE = PREFIX + VERSION;

// The page names its version. A page from another version must never be stored under this one.
const rightPage = async res => (await res.clone().text()).includes(VERSION);

async function store(cache, file) {
  const res = await fetch(new Request(file, { cache: 'reload' })); // past the browser's own cache, so a new version is never mixed with old files
  if (!res.ok) throw new Error(file + ' answered ' + res.status);
  if (file === PAGE && !(await rightPage(res))) throw new Error('the host does not serve version ' + VERSION + ' yet'); // the install is tried again later
  // A redirected response cannot answer a page load, so it is stored as a plain one.
  await cache.put(file, res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(FILES.map(file => store(cache, file)))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim(); // the page that installed the first copy is served from it right away
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  const rel = url.pathname.slice(SCOPE.length);
  const file = rel === '' || rel === 'index.html' ? PAGE : rel;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(file, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    // The device may have dropped the copy to free space. Put a file back when the network has the right one.
    if (res.ok && !res.redirected && FILES.includes(file)) {
      const copy = res.clone();
      event.waitUntil((async () => { if (file !== PAGE || await rightPage(copy)) await cache.put(file, copy); })().catch(() => {}));
    }
    return res;
  })());
});
