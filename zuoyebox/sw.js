/* ===========================================================================
 * 作业盒子 / 省钱记账 —— 离线缓存 Service Worker（由 pwa/make-sw.js 自动生成）
 * 生成时间不是版本依据；版本号来自 index.html 的内容哈希，所以内容一变就换缓存。
 * 请勿直接改这个文件，改 pwa/sw-logic.js 或 pwa/make-sw.js 后重新生成。
 * =========================================================================== */
'use strict';

var APP = 'zuoyebox';
var VERSION = '602fefcc27d8';
var SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png"
];

/* ===========================================================================
 * Service Worker 的纯逻辑层（不依赖 self / caches，可在 Node 里直接测）
 *
 * 为什么单独抽出来：Service Worker 里的缓存策略是「装到桌面后能不能离线用」
 * 的命脉，而且是最容易被地址前缀（GitHub Pages 的子路径）搞坏的地方。
 * 抽成纯函数后，test-sw.js 能在 Node 里把边界情况全测一遍。
 * =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SWLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 归一化 scope 路径。
   * '/repo/app/' -> '/repo/app/'；'/app' -> '/app/'；'' -> '/'；'/a//b/' -> '/a/b/'
   * 完整 URL（https://host/a/b/）会先取出 pathname 再归一化。
   */
  function normalizeScope(raw) {
    var s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '/';
    // 完整 URL：只保留 pathname
    var m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*(\/.*)?$/.exec(s);
    if (m) s = m[1] || '/';
    // 去掉 query / hash
    s = s.split('#')[0].split('?')[0];
    // 补前导 /
    if (s.charAt(0) !== '/') s = '/' + s;
    // 折叠重复斜杠
    s = s.replace(/\/{2,}/g, '/');
    // 确保以 / 结尾（scope 一定是一个目录）
    if (s.charAt(s.length - 1) !== '/') s += '/';
    return s;
  }

  /**
   * 把 scope 内的相对请求解析成绝对路径。
   * 关键安全约束：解析结果的目录部分必须仍在 scope 之内，否则返回 null。
   * 例：scope='/repo/app/'，ref='./index.html'  -> '/repo/app/index.html'
   *     scope='/app/'，ref='../secret.txt'      -> null（越出 scope，拒绝）
   */
  function toScopedPath(scope, ref) {
    var base = normalizeScope(scope);
    if (typeof ref !== 'string' || !ref) return null;
    var r = ref.split('#')[0].split('?')[0];
    if (!r) return null;
    // 绝对路径形式：不允许（SW 只管 scope 内的相对资源）
    if (r.charAt(0) === '/') return null;

    // scope 的目录层级（'/repo/app/' -> ['repo','app']）
    var baseStack = base.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
    var stack = baseStack.slice();
    var parts = r.split('/');
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        // 不允许退到 scope 目录之上
        if (stack.length <= baseStack.length) return null;
        stack.pop();
        continue;
      }
      stack.push(seg);
    }
    // 目录部分必须包含完整 scope
    for (var j = 0; j < baseStack.length; j++) {
      if (stack[j] !== baseStack[j]) return null;
    }
    if (!stack.length) return '/';
    return '/' + stack.join('/') + (r.charAt(r.length - 1) === '/' ? '/' : '');
  }

  /** 是否为需要缓存的同源静态资源 */
  function isCacheableAsset(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (u.origin !== self.location.origin) return false;
      if (u.pathname.indexOf(normalizeScope(self.registration.scope)) !== 0) return false;
      return true;
    } catch (e) { return false; }
  }

  /** 判断一个请求该走哪条策略：'skip' | 'cache-first' | 'network-first' */
  function strategyFor(req) {
    if (!req || req.method !== 'GET') return 'skip';
    var url = typeof req.url === 'string' ? req.url : '';
    if (!url) return 'skip';
    // 只处理 http(s) 同源
    var m = /^(https?):\/\//.exec(url);
    if (!m) return 'skip';
    // 图标 / 清单 / 外壳变化少 -> 缓存优先，最快
    if (/\.(png|svg|ico|json|webmanifest)(\?|$)/i.test(url)) return 'cache-first';
    // 页面本身 -> 网络优先，保证能拿到新版本；断网时回缓存
    return 'network-first';
  }

  /** 版本号只能用安全字符，避免注入到缓存名里出问题 */
  function sanitizeVersion(v) {
    var s = typeof v === 'string' ? v : '';
    s = s.replace(/[^A-Za-z0-9._-]/g, '');
    return s || 'dev';
  }

  /** 缓存名 */
  function cacheName(prefix, version) {
    return sanitizeVersion(prefix) + '-v' + sanitizeVersion(version);
  }

  /** 一串 URL 里去掉重复项 */
  function uniqueUrls(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (u) {
      if (typeof u !== 'string' || !u) return;
      if (seen[u]) return;
      seen[u] = true;
      out.push(u);
    });
    return out;
  }

  return {
    normalizeScope: normalizeScope,
    toScopedPath: toScopedPath,
    strategyFor: strategyFor,
    sanitizeVersion: sanitizeVersion,
    cacheName: cacheName,
    uniqueUrls: uniqueUrls
  };
});


var CACHE = SWLogic.cacheName(APP, VERSION);

/* ----------------------------- 安装：预缓存外壳 ----------------------------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个 add：某一个文件缺失也不会让整个安装失败
      return Promise.all(SHELL.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ----------------------------- 激活：清掉旧版本缓存 ----------------------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // 只删本应用自己的旧缓存，不碰别的应用和别人的数据
        if (k === CACHE) return null;
        if (k.indexOf(SWLogic.sanitizeVersion(APP) + '-v') !== 0) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ----------------------------- 取用策略 ----------------------------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var mode = SWLogic.strategyFor(req);
  if (mode === 'skip') return;

  // 同源校验：绝不代理任何第三方请求
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(SWLogic.normalizeScope(self.registration.scope)) !== 0) return;

  if (mode === 'cache-first') {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit || Response.error(); });
      })
    );
    return;
  }

  // network-first：页面始终尽量拿最新的；断网时回缓存
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // 导航请求断网时统一回外壳首页
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

/* ----------------------------- 通知点击：聚焦或打开 App ----------------------------- */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
      return null;
    })
  );
});
