// Service Worker for Kanz Educational Platform (موسوعة الكنز التعليمي)
const CACHE_NAME = 'kanz-cache-v6';

// الأصول الأساسية لضمان عمل واجهة التطبيق بدون اتصال بالإنترنت (Offline App Shell)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icon.png',
  './icon.svg'
];

// تسجيل معالج أحداث الرسائل بشكل مباشر ومتزامن في التقييم الأولي
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// عند التثبيت: حفظ الأصول الأساسية وتفعيل الـ Worker فوراً
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('PWA Precache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// عند التفعيل: مسح إصدارات الكاش القديمة والسيطرة على التبويبات المفتوحة فوراً
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

// استراتيجيات جلب البيانات والموارد
self.addEventListener('fetch', (event) => {
  // تجاهل أي طلبات غير GET
  if (event.request.method !== 'GET') {
    return;
  }

  // تجاهل طلبات الاستكمال (Range) الخاصة بالصوتيات لتجنب أخطاء سفاري وكروم على الموبايل
  if (event.request.headers.has('range')) {
    return;
  }

  const url = new URL(event.request.url);

  // تجاهل الروابط الخارجية (مثل Google Apps Script و Google Drive و Gemini API وروابط الصوت)
  // لضمان الحصول على أحدث البيانات دائماً ودعم استكمال تحميل الملفات الكبيرة
  if (
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/') ||
    event.request.destination === 'audio' ||
    event.request.destination === 'video' ||
    url.pathname.match(/\.(mp3|mp4|wav|m4a|ogg|aac)$/i)
  ) {
    return;
  }

  // 1. طلبات تصفح الصفحات الرئيسية (HTML Navigation): Network-First
  // نحاول جلب أحدث صفحة HTML دائماً، وإذا انقطع النت نستخدم النسخة المحفوظة أوفلاين
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('./index.html') || caches.match('./');
          });
        })
    );
    return;
  }

  // 2. الملفات الثابتة المبنية بأسماء مشفرة بهش (Vite Assets / JS / CSS / Fonts / Images): Cache-First
  if (url.pathname.includes('/assets/') || url.pathname.match(/\.(js|css|svg|png|jpg|jpeg|webp|woff2?|ttf|eot)$/i)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. أي طلبات محلية أخرى: Network-First مع العودة للكاش عند انقطاع الإنترنت
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
