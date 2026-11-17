// 우리집노트는 https://joonseonhwang.github.io/house/ 로 이동했다. 옛 서비스워커는 스스로 해제한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.registration.unregister()));
