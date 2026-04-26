// ============================================
// Service Worker for 炒飯記帳本
// 提供離線功能 + 快取資源
// ============================================

const CACHE_NAME = 'fried-rice-v3';
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
  self.skipWaiting(); // 不等舊版 sw 結束
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 個別 add 失敗不會中斷整體 (例如某個外部資源暫時掛掉)
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
      .then(() => self.clients.claim()) // 立即接管所有頁面
  );
});

// ============================================
// 攔截請求:智慧快取策略
// ============================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ⚠️ Google Apps Script API 永遠走網路,不快取
  // (避免拿到舊資料)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return; // 讓瀏覽器自己處理
  }

  // 只處理 GET 請求
  if (event.request.method !== 'GET') return;

  // === HTML 頁面:network-first (有網路時抓最新版,沒網路用快取) ===
  if (event.request.mode === 'navigate' ||
      event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // 抓到新版,順手更新快取
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => {
          // 沒網路 → 用快取
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // === 其他資源 (字體、JS、CSS):cache-first (有快取就用,沒有再抓) ===
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // 有效回應才存
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        });
      })
      .catch(() => {
        // 完全沒網路也沒快取,回個簡單訊息
        return new Response('離線中,此資源無法載入', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
  );
});

// ============================================
// 接收主程式訊息 (例如手動清快取)
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
