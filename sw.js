// ============================================
// Service Worker for 炒飯記帳本 (修正版)
// 提供離線功能 + 快取資源
// ============================================

const CACHE_NAME = 'fried-rice-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  // 字體 (Google Fonts CSS)
  'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700;900&family=Noto+Sans+TC:wght@400;500;700;900&family=Zen+Kurenaido&display=swap',
  // Chart.js
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// ============================================
// 安裝:預先快取核心資源
// ============================================
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.log('[SW] 快取失敗:', url, err))
        )
      );
    })
  );
});

// ============================================
// 啟用:清掉舊版快取
// ============================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ============================================
// 工具:檢查請求是否可以快取
// ============================================
function isCacheable(request) {
  const url = new URL(request.url);

  // 只快取 http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // 排除瀏覽器擴充功能
  if (url.protocol === 'chrome-extension:' ||
      url.protocol === 'moz-extension:' ||
      url.protocol === 'safari-extension:') {
    return false;
  }

  // 排除 Apps Script API (避免拿到舊資料)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('script.googleusercontent.com')) {
    return false;
  }

  // 只快取 GET
  if (request.method !== 'GET') return false;

  return true;
}

// 安全快取 (寫入前再檢查一次)
function safeCachePut(cache, request, response) {
  if (!isCacheable(request)) return Promise.resolve();
  if (!response || response.status !== 200) return Promise.resolve();
  // 只快取基本同源或 cors 回應
  if (response.type === 'opaque' || response.type === 'opaqueredirect') {
    return Promise.resolve();
  }
  return cache.put(request, response).catch(err => {
    console.log('[SW] 快取寫入失敗:', request.url, err.message);
  });
}

// ============================================
// 攔截請求:智慧快取策略
// ============================================
self.addEventListener('fetch', event => {
  // 不可快取的請求,讓瀏覽器自己處理
  if (!isCacheable(event.request)) return;

  const url = new URL(event.request.url);

  // === HTML 頁面:network-first ===
  if (event.request.mode === 'navigate' ||
      event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => safeCachePut(cache, event.request, copy));
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // === 其他資源:cache-first ===
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => safeCachePut(cache, event.request, copy));
          }
          return response;
        });
      })
      .catch(() => {
        return new Response('離線中,此資源無法載入', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
  );
});

// ============================================
// 接收主程式訊息
// ============================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
