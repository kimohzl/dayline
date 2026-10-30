/* Dayline 웹 앱: 인터넷이 없어도 열리게 화면 파일을 담아 둔다.
 * 인터넷이 되면 늘 새로 받아(최신 버전) 담아 두고, 안 되면 담아 둔 것을 쓴다.
 * 담는 방식을 바꾸면 CACHE 이름을 올린다. */
const CACHE = 'dayline-web-v2';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'js/parser.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/fonts/PretendardVariable.woff2',
  'web/apple-touch-icon.png',
  'web/icon-192.png',
  'web/icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // 브라우저 캐시(Pages는 10분)를 거치지 않고 서버에 새 버전이 있는지 확인
    // (페이지 자체 요청은 옵션을 붙여 다시 만들 수 없어서 주소로)
    (req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
