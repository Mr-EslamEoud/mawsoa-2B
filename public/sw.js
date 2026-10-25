// دمج إشعارات OneSignal مع Service Worker الخاص بنا
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Minimal installable Service Worker for Kanz Educational Platform
const CACHE_NAME = 'kanz-cache-v5'; // تم تغيير الرقم إلى 5 لضمان وصول التحديثات الأخيرة لجميع الطلاب

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // تجاهل طلبات الاستكمال (Range) الخاصة بالصوتيات لتجنب أخطاء سفاري وكروم على الموبايل
  if (event.request.headers.has('range')) {
    return;
  }

  const url = new URL(event.request.url);
  
  // تجاهل أي روابط خارجية (مثل روابط الصوت من archive.org) 
  // لكي يتعامل معها مشغل الموبايل الأصلي بشكل طبيعي ويدعم استكمال التحميل (Range Requests)
  if (url.origin !== self.location.origin || url.pathname.includes('/api/proxy-audio') || event.request.destination === 'audio' || event.request.destination === 'video' || url.pathname.match(/\.(mp3|mp4|wav|m4a|ogg|aac)$/i)) {
    return;
  }
  
  // Prefer cached icons (which are dynamically generated from the crisp SVG)
  if (url.pathname.endsWith('/icon.png') || url.pathname.endsWith('/apple-touch-icon.png')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
    return;
  }

  // Network-first pattern to allow prompt web updates instantly without caching block
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
