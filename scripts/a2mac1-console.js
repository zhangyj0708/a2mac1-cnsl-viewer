/* ============================================================
   A2MAC1 CNSL — 浏览器 Console 提取脚本 v0.6.14
   用法: 在 A2MAC1 3D Data v3 页面按 F12 → Console → 粘贴全部代码 → 回车

   功能:
   1. 自动提取车型名称、productId、nodeId
   2. 自动提取尺寸数据（A/B/C 方向 + min 值）
   3. 自动提取所有 3D 文件列表 + 下载链接
   4. 一键导出 JSON，导入本地工具
   ============================================================ */

(async function () {
  'use strict';

  var BASE = 'https://ibp.a2mac1.com';
  var HIERARCHY_ID = '00000005ZT4GEU01';

  console.log('%c📐 A2MAC1 CNSL 数据提取器 v0.6.14', 'font-size:16px;color:#3b82f6;font-weight:bold');
  console.log('%c正在自动提取所有数据...', 'color:#64748b');

  // ═══════════════════ 1. 提取产品信息 ═══════════════════
  function extractProductId() {
    var urlParams = new URLSearchParams(location.search);
    var pid = urlParams.get('productId');
    if (pid) return pid;
    var match = location.pathname.match(/products\/(A[A-Za-z0-9]+)/);
    if (match) return match[1];
    return null;
  }

  function extractNodeId() {
    var entries = performance.getEntriesByType('resource');
    // 先尝试 get-files
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.indexOf('/get-files') !== -1) {
        var match = e.name.match(/hierarchy-node\/([A-Za-z0-9]+)/);
        if (match) return match[1];
      }
    }
    // 回退：从 data-access 请求取
    for (var j = 0; j < entries.length; j++) {
      var ej = entries[j];
      if (ej.name.indexOf('data-access') !== -1) {
        var m = ej.name.match(/itemId=([A-Za-z0-9]+)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  // 从页面 DOM 提取车型名称
  function extractVehicleName() {
    // 尝试多种选择器
    var selectors = [
      '.product-title', '.product-name', '.vehicle-name',
      '[data-testid="product-title"]', 'h1', 'title',
      '.breadcrumb-item:last-child', '.page-title'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.textContent && el.textContent.trim().length > 1) {
        return el.textContent.trim();
      }
    }
    // 页面标题
    if (document.title) {
      var t = document.title.replace(/\s*[-|]\s*A2MAC1.*/, '').trim();
      if (t) return t;
    }
    return null;
  }

  // ═══════════════════ 2. 获取文件列表 ═══════════════════
  async function fetchFiles(productId, nodeId) {
    var entries = performance.getEntriesByType('resource');
    var getFilesUrl = null;

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.indexOf('/get-files') !== -1 && e.name.indexOf('api-version=2.0') !== -1) {
        getFilesUrl = e.name;
        break;
      }
    }

    if (getFilesUrl) {
      console.log('✅ 从缓存获取文件列表');
      var res = await fetch(getFilesUrl, { credentials: 'include' });
      var data = await res.json();
      return Array.isArray(data) ? data : (data.files || []);
    }

    if (!productId) {
      console.error('❌ 未找到 productId');
      return [];
    }

    var nid = nodeId || '000000AUWL3CEU02';
    var url = BASE + '/api/visual/files/hierarchy/' + HIERARCHY_ID + '/hierarchy-node/' + nid + '/get-files?api-version=2.0';
    console.log('🔄 请求文件列表: ' + url);
    var res2 = await fetch(url, { credentials: 'include' });
    var data2 = await res2.json();
    return Array.isArray(data2) ? data2 : (data2.files || []);
  }

  // ═══════════════════ 3. 获取尺寸数据 ═══════════════════
  // 参考 opencli-plugin-a2mac1: 同时尝试 GET 和 POST
  async function fetchDimensions(productId, nodeId) {
    if (!productId || !nodeId) return null;

    var dataUrl = BASE + '/api/products/' + productId + '/hierarchies/' + HIERARCHY_ID + '/nodes/' + nodeId + '/data';

    // 先尝试 POST（opencli-plugin-a2mac1 使用的方式）
    console.log('🔄 [POST] 请求尺寸数据: ' + dataUrl);
    try {
      var res = await fetch(dataUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: '{}'
      });
      if (res.ok) {
        var json = await res.json();
        console.log('✅ [POST] 尺寸数据获取成功');
        return json;
      }
      console.warn('⚠️ [POST] 返回 ' + res.status + '，尝试 GET...');
    } catch (e) {
      console.warn('⚠️ [POST] 失败: ' + e.message + '，尝试 GET...');
    }

    // 回退 GET
    var getUrl = dataUrl + '?hideMappedProperties=false&hideMappedProductTypesProperties=true&hierarchyId=' + HIERARCHY_ID;
    console.log('🔄 [GET] 请求尺寸数据: ' + getUrl);
    try {
      var res2 = await fetch(getUrl, { credentials: 'include' });
      if (!res2.ok) throw new Error('HTTP ' + res2.status);
      var text = await res2.text();
      try {
        var json2 = JSON.parse(text);
        console.log('✅ [GET] 尺寸数据获取成功');
        return json2;
      } catch (e) {
        return { _raw: text, _note: '返回非 JSON，可能是 HTML 页面' };
      }
    } catch (err) {
      console.warn('⚠️ [GET] 尺寸数据获取失败: ' + err.message);
      return null;
    }
  }

  // ═══════════════════ 4. 解析尺寸数据 ═══════════════════
  function parseDimensions(rawData) {
    if (!rawData) return [];

    var items = [];

    // 尝试多种数据结构
    // 结构1: { properties: [...], rows: [...] }
    if (rawData.rows && Array.isArray(rawData.rows)) {
      var props = (rawData.properties || []).map(function(p) { return p.name || p.label || ''; });
      items = rawData.rows.map(function(row) {
        var item = { name: row.name || row.label || '' };
        if (row.cells && Array.isArray(row.cells)) {
          for (var i = 0; i < props.length && i < row.cells.length; i++) {
            item[props[i]] = row.cells[i];
          }
        }
        return item;
      });
    }

    // 结构2: { data: [...], columns: [...] }
    if (items.length === 0 && rawData.data && Array.isArray(rawData.data)) {
      items = rawData.data;
    }

    // 结构3: 直接是数组
    if (items.length === 0 && Array.isArray(rawData)) {
      items = rawData;
    }

    // 提取标准化的尺寸字段
    return items.map(function(item) {
      return {
        name: item.name || item.part || item.Part || item.label || '',
        outerLength: item.A || item.outerLength || item.a || item.length || null,
        outerWidth: item.B || item.outerWidth || item.b || item.width || null,
        outerHeight: item.C || item.outerHeight || item.c || item.height || null,
        lengthMin: item['A min'] || item.lengthMin || item.aMin || null,
        widthMin: item['B min'] || item.widthMin || item.bMin || null,
        heightMin: item['C min'] || item.heightMin || item.cMin || null,
        material: item.Material || item.material || item['Material'] || null,
        mass: item.Mass || item.mass || null,
        process: item.Process || item.process || null,
        source: item.Source || item.source || null,
        _raw: item
      };
    });
  }

  // ═══════════════════ 5. 主流程 ═══════════════════
  try {
    var productId = extractProductId();
    var nodeId = extractNodeId();
    var vehicleName = extractVehicleName();

    console.log('📋 productId: ' + (productId || '(未找到)'));
    console.log('📋 nodeId: ' + (nodeId || '(未找到)'));
    console.log('📋 车型名: ' + (vehicleName || '(未找到)'));

    // 并行获取文件和尺寸
    var files = await fetchFiles(productId, nodeId);
    var dimensionsRaw = await fetchDimensions(productId, nodeId);
    var dimensions = parseDimensions(dimensionsRaw);

    console.log('\n%c══════════════════════════════════════', 'color:#3b82f6');
    console.log('%c📊 提取结果汇总', 'font-size:16px;font-weight:bold;color:#22c55e');
    console.log('%c══════════════════════════════════════', 'color:#3b82f6');
    console.log('  车型: ' + (vehicleName || '未知'));
    console.log('  文件数: ' + files.length + ' (' + files.filter(function(f) { return f.isDownloadable !== false; }).length + ' 个可下载)');
    console.log('  尺寸条目: ' + dimensions.length);

    if (dimensions.length > 0) {
      console.log('\n%c📏 尺寸数据:', 'font-size:14px;font-weight:bold');
      console.table(dimensions.slice(0, 20).map(function(d) {
        return {
          name: d.name,
          A: d.outerLength, 'A_min': d.lengthMin,
          B: d.outerWidth, 'B_min': d.widthMin,
          C: d.outerHeight, 'C_min': d.heightMin,
          material: d.material
        };
      }));
    }

    // 生成下载链接
    var downloadable = files.filter(function(f) { return f.isDownloadable !== false; });
    var downloadLinks = downloadable.map(function(f) {
      return {
        id: f.id,
        name: f.name,
        partTypeId: f.partTypeId,
        partId: f.partId,
        versionIds: f.versionIds || [],
        isTransparent: f.isTransparent || false,
        token: f.token,
        downloadUrl: BASE + '/files/downloads/files?token=' + encodeURIComponent(f.token || '') + '&filename=' + encodeURIComponent(f.name || 'file') + '.zip&api-version=1.1'
      };
    });

    // ── 组装完整数据 ──
    window.__CNSL_DATA__ = {
      exportedAt: new Date().toISOString(),
      sourceUrl: location.href,
      vehicle: {
        name: vehicleName || '',
        productId: productId || '',
        nodeId: nodeId || '',
        hierarchyId: HIERARCHY_ID
      },
      dimensions: dimensions,
      files: {
        total: files.length,
        downloadable: downloadable.length,
        items: downloadLinks
      }
    };

    // ── 便捷命令 ──
    console.log('\n%c🛠️ 命令:', 'font-size:14px;font-weight:bold');

    window.__CNSL_exportJSON = function () {
      var blob = new Blob([JSON.stringify(window.__CNSL_DATA__, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var name = (vehicleName || productId || 'export').replace(/[^a-zA-Z0-9一-鿿_-]/g, '_');
      a.download = 'a2mac1-' + name + '-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      console.log('✅ JSON 文件已下载！');
      console.log('💡 下一步：打开本地 CNSL 分析平台 → 数据库 → 导入此 JSON 文件');
    };

    window.__CNSL_copyLinks = function () {
      var text = downloadLinks.map(function(f) { return f.downloadUrl; }).join('\n');
      navigator.clipboard.writeText(text).then(function() {
        console.log('✅ 已复制 ' + downloadLinks.length + ' 个下载链接');
      });
    };

    window.__CNSL_downloadAll = function (delayMs) {
      delayMs = delayMs || 800;
      if (downloadLinks.length === 0) { console.log('⚠️ 没有可下载的文件'); return; }
      if (!confirm('即将下载 ' + downloadLinks.length + ' 个文件，继续？')) return;
      var i = 0;
      var interval = setInterval(function() {
        if (i >= downloadLinks.length) {
          clearInterval(interval);
          console.log('✅ 全部触发完成');
          return;
        }
        window.open(downloadLinks[i].downloadUrl, '_blank');
        i++;
      }, delayMs);
      console.log('🔄 开始下载，间隔 ' + delayMs + 'ms...');
    };

    console.log('  %c__CNSL_exportJSON()%c  → 下载完整 JSON（车型+尺寸+文件链接）',
      'color:#f59e0b;font-weight:bold', 'color:#94a3b8');
    console.log('  %c__CNSL_copyLinks()%c  → 复制所有下载链接',
      'color:#f59e0b;font-weight:bold', 'color:#94a3b8');
    console.log('  %c__CNSL_downloadAll()%c → 批量下载所有文件',
      'color:#f59e0b;font-weight:bold', 'color:#94a3b8');
    console.log('  %c__CNSL_DATA__%c        → 查看完整数据',
      'color:#f59e0b;font-weight:bold', 'color:#94a3b8');

    console.log('\n%c✅ 提取完成！运行 __CNSL_exportJSON() 下载 JSON，然后导入本地工具。',
      'color:#22c55e;font-size:14px;font-weight:bold');

  } catch (err) {
    console.error('❌ 提取失败: ' + err.message);
    console.error('请确认:');
    console.error('  1. 已在 A2MAC1 登录');
    console.error('  2. 已进入 3D Data v3 页面');
    console.error('  3. 页面已完全加载');
  }
})();