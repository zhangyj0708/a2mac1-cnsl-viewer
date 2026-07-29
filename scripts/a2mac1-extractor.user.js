// ==UserScript==
// @name         A2MAC1 CNSL 数据提取器
// @namespace    a2mac1-cnsl-scraper
// @version      0.1.0
// @description  在 A2MAC1 3D Data v3 页面注入提取按钮，自动抓取文件列表和下载链接
// @author       CNSL Platform
// @match        https://ibp.a2mac1.com/*
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ── 注入 UI ──
  function injectUI() {
    const panel = document.createElement('div');
    panel.id = 'cnsl-extractor-panel';
    panel.innerHTML = `
      <style>
        #cnsl-extractor-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          background: #1e293b;
          color: #f1f5f9;
          border-radius: 12px;
          padding: 16px;
          width: 320px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          box-shadow: 0 10px 40px rgba(0,0,0,.3);
          user-select: none;
        }
        #cnsl-extractor-panel .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          cursor: move;
        }
        #cnsl-extractor-panel .title {
          font-weight: 700;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #cnsl-extractor-panel button {
          width: 100%;
          padding: 8px 12px;
          margin: 4px 0;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all .15s;
        }
        #cnsl-extractor-panel .btn-primary {
          background: #3b82f6;
          color: #fff;
        }
        #cnsl-extractor-panel .btn-primary:hover { background: #2563eb; }
        #cnsl-extractor-panel .btn-success {
          background: #22c55e;
          color: #fff;
        }
        #cnsl-extractor-panel .btn-success:hover { background: #16a34a; }
        #cnsl-extractor-panel .btn-secondary {
          background: #475569;
          color: #e2e8f0;
        }
        #cnsl-extractor-panel .btn-secondary:hover { background: #334155; }
        #cnsl-extractor-panel .btn-close {
          background: none;
          color: #94a3b8;
          font-size: 18px;
          width: auto;
          padding: 0 4px;
        }
        #cnsl-extractor-panel .status {
          margin-top: 8px;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 11px;
          text-align: center;
          display: none;
        }
        #cnsl-extractor-panel .status.show { display: block; }
        #cnsl-extractor-panel .status.info { background: #1e3a5f; color: #93c5fd; }
        #cnsl-extractor-panel .status.success { background: #14532d; color: #86efac; }
        #cnsl-extractor-panel .status.error { background: #7f1d1d; color: #fca5a5; }
        #cnsl-extractor-panel .minimized .content { display: none; }
        #cnsl-extractor-panel .count { font-size: 20px; font-weight: 700; color: #60a5fa; }
      </style>
      <div class="header">
        <span class="title">📐 CNSL 提取器</span>
        <div>
          <button class="btn-close" id="cnsl-minimize" title="最小化">_</button>
          <button class="btn-close" id="cnsl-close" title="关闭">&times;</button>
        </div>
      </div>
      <div class="content">
        <button class="btn-primary" id="cnsl-extract-files">📦 提取当前页面文件列表</button>
        <button class="btn-success" id="cnsl-copy-downloads">📋 复制所有下载链接</button>
        <button class="btn-secondary" id="cnsl-download-all">⬇️ 批量下载全部</button>
        <button class="btn-secondary" id="cnsl-export-json">📤 导出 JSON</button>
        <div class="status" id="cnsl-status"></div>
        <div style="margin-top:8px;text-align:center">
          <span class="count" id="cnsl-file-count">0</span>
          <span style="font-size:11px;color:#94a3b8"> 个文件</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // 拖拽
    let dragging = false, offsetX, offsetY;
    panel.querySelector('.header').addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      offsetX = e.clientX - panel.offsetLeft;
      offsetY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.right = 'auto';
      panel.style.top = (e.clientY - offsetY) + 'px';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // 按钮事件
    document.getElementById('cnsl-close').addEventListener('click', () => panel.remove());
    document.getElementById('cnsl-minimize').addEventListener('click', () => panel.classList.toggle('minimized'));
    document.getElementById('cnsl-extract-files').addEventListener('click', extractFiles);
    document.getElementById('cnsl-copy-downloads').addEventListener('click', copyDownloadLinks);
    document.getElementById('cnsl-download-all').addEventListener('click', downloadAll);
    document.getElementById('cnsl-export-json').addEventListener('click', exportJSON);
  }

  // ── 状态 ──
  let cachedFiles = [];

  function setStatus(msg, type) {
    const el = document.getElementById('cnsl-status');
    el.textContent = msg;
    el.className = 'status show ' + type;
    setTimeout(() => el.classList.remove('show'), 4000);
  }

  function updateCount(n) {
    document.getElementById('cnsl-file-count').textContent = n;
  }

  // ── 拦截 get-files 请求 ──
  function extractFiles() {
    setStatus('正在拦截 get-files 请求...', 'info');

    // 方法1: 从 Network 拦截（需要 Performance API）
    const entries = performance.getEntriesByType('resource');
    const getFilesEntry = entries.find(e =>
      e.name.includes('/get-files') && e.name.includes('api-version=2.0')
    );

    if (getFilesEntry) {
      setStatus('找到 get-files 请求，正在获取数据...', 'info');
      fetch(getFilesEntry.name, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          cachedFiles = Array.isArray(data) ? data : (data.files || []);
          updateCount(cachedFiles.length);
          setStatus(`成功提取 ${cachedFiles.length} 个文件`, 'success');

          // 同时提取产品信息
          extractProductInfo();
        })
        .catch(err => setStatus('提取失败: ' + err.message, 'error'));
    } else {
      // 方法2: 主动触发 get-files API
      setStatus('未找到缓存请求，请手动触发...', 'info');
      // 尝试从 URL 或页面元素提取 productId 和 nodeId
      const productId = extractProductId();
      if (productId) {
        setStatus(`找到 productId: ${productId}，正在获取文件...`, 'info');
        fetchFilesFromAPI(productId);
      } else {
        setStatus('未找到 productId。请先打开 3D Data v3 页面', 'error');
      }
    }
  }

  function extractProductId() {
    // 从 URL 参数提取
    const urlParams = new URLSearchParams(location.search);
    let pid = urlParams.get('productId');
    if (pid) return pid;

    // 从路径提取
    const match = location.pathname.match(/products\/(A[A-Za-z0-9]+)/);
    if (match) return match[1];

    // 从页面元素提取
    const links = document.querySelectorAll('a[href*="productId="]');
    for (const link of links) {
      const p = new URLSearchParams(link.href.split('?')[1]);
      const id = p.get('productId');
      if (id) return id;
    }

    return null;
  }

  function fetchFilesFromAPI(productId) {
    // 需要 nodeId，这里使用默认值或从页面提取
    const nodeId = extractNodeId() || '000000AUWL3CEU02';
    const hierarchyId = '00000005ZT4GEU01';

    fetch(`https://ibp.a2mac1.com/api/visual/files/hierarchy/${hierarchyId}/hierarchy-node/${nodeId}/get-files?api-version=2.0`, {
      credentials: 'include'
    })
      .then(r => r.json())
      .then(data => {
        cachedFiles = Array.isArray(data) ? data : (data.files || []);
        updateCount(cachedFiles.length);
        setStatus(`成功提取 ${cachedFiles.length} 个文件`, 'success');
      })
      .catch(err => setStatus('API 请求失败: ' + err.message, 'error'));
  }

  function extractNodeId() {
    // 从页面上的 get-files 请求 URL 提取
    const entries = performance.getEntriesByType('resource');
    const entry = entries.find(e => e.name.includes('/get-files'));
    if (entry) {
      const match = entry.name.match(/hierarchy-node\/([A-Za-z0-9]+)/);
      if (match) return match[1];
    }
    return null;
  }

  function extractProductInfo() {
    // 提取品牌和车型信息
    const productId = extractProductId();
    const modelEl = document.querySelector('[class*="product"][class*="name"], [class*="vehicle"][class*="name"], h1, h2');
    const model = modelEl ? modelEl.textContent.trim() : '';

    if (productId && model) {
      console.log('[CNSL Extractor] 产品信息:', { productId, model });
    }
  }

  // ── 复制下载链接 ──
  function copyDownloadLinks() {
    if (cachedFiles.length === 0) {
      setStatus('请先提取文件列表', 'error');
      return;
    }

    const downloadable = cachedFiles.filter(f => f.isDownloadable !== false);
    const links = downloadable.map(f => {
      const token = f.token || '';
      const name = f.name || f.id || 'file';
      return `https://ibp.a2mac1.com/files/downloads/files?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(name)}.zip&api-version=1.1`;
    });

    const text = links.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setStatus(`已复制 ${links.length} 个下载链接`, 'success');
    }).catch(() => {
      setStatus('复制失败，请检查剪贴板权限', 'error');
    });
  }

  // ── 批量下载 ──
  function downloadAll() {
    if (cachedFiles.length === 0) {
      setStatus('请先提取文件列表', 'error');
      return;
    }

    const downloadable = cachedFiles.filter(f => f.isDownloadable !== false);
    if (!confirm(`即将下载 ${downloadable.length} 个文件，继续？`)) return;

    setStatus(`开始批量下载 ${downloadable.length} 个文件...`, 'info');
    let i = 0;
    const interval = setInterval(() => {
      if (i >= downloadable.length) {
        clearInterval(interval);
        setStatus(`全部 ${downloadable.length} 个文件下载任务已触发`, 'success');
        return;
      }
      const f = downloadable[i];
      const token = f.token || '';
      const name = f.name || f.id || 'file';
      const url = `https://ibp.a2mac1.com/files/downloads/files?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(name)}.zip&api-version=1.1`;
      window.open(url, '_blank');
      i++;
    }, 800);
  }

  // ── 导出 JSON ──
  function exportJSON() {
    if (cachedFiles.length === 0) {
      setStatus('请先提取文件列表', 'error');
      return;
    }

    const data = {
      exportedAt: new Date().toISOString(),
      url: location.href,
      productId: extractProductId(),
      nodeId: extractNodeId(),
      hierarchyId: '00000005ZT4GEU01',
      totalFiles: cachedFiles.length,
      files: cachedFiles.map(f => ({
        id: f.id,
        name: f.name,
        token: f.token,
        partTypeId: f.partTypeId,
        partId: f.partId,
        versionIds: f.versionIds,
        isDownloadable: f.isDownloadable,
        isTransparent: f.isTransparent,
        downloadUrl: f.token
          ? `https://ibp.a2mac1.com/files/downloads/files?token=${encodeURIComponent(f.token)}&filename=${encodeURIComponent(f.name || 'file')}.zip&api-version=1.1`
          : '',
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `a2mac1-${data.productId || 'export'}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('JSON 已导出', 'success');
  }

  // ── 启动 ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }

  console.log('[CNSL Extractor] A2MAC1 数据提取器已就绪');
  console.log('[CNSL Extractor] 使用说明:');
  console.log('  1. 导航到 3D Data v3 页面');
  console.log('  2. 点击右下角面板的"提取当前页面文件列表"');
  console.log('  3. 使用"复制下载链接"或"批量下载"');
})();