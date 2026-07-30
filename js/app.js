/* ============================================================
   A2MAC1 CNSL — 主应用逻辑 v0.7.1
   ============================================================ */

const App = (() => {
  let currentVehicleId = null;
  let currentPage = 'search';

  // ═══════════════════ 初始化 ═══════════════════
  function init() {
    updateDbStatus();
    bindNavigation();
    bindSearch();
    bindDatabase();
    bindTools();
    bindImportButtons();
    const hash = location.hash.replace('#', '') || 'search';
    navigateTo(hash);
  }

  // ═══════════════════ 数据库状态 ═══════════════════
  function updateDbStatus() {
    const s = DB.stats();
    const el = document.getElementById('db-status');
    if (s.vehicles > 0) {
      el.textContent = `${s.vehicles} 车型 · ${s.consoles} Console · ${s.files} 文件`;
      el.className = 'badge badge-success';
    } else {
      el.textContent = '空数据库';
      el.className = 'badge badge-warning';
    }
  }

  // ═══════════════════ 页面导航 ═══════════════════
  function bindNavigation() {
    document.querySelectorAll('.navbar-nav a').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(a.dataset.page);
      });
    });
  }

  function navigateTo(page) {
    currentPage = page;
    location.hash = page;
    document.querySelectorAll('.navbar-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });
    if (page === 'database') renderDatabase();
    if (page === 'tools') renderTools();
    if (page === 'viewer3d') {
      // 立即显示加载提示（不依赖 Three.js 模块）
      var hint = document.getElementById('viewer3d-hint');
      if (hint) {
        hint.innerHTML = '<div class="icon">⏳</div><p>正在加载 3D 引擎...</p><p style="font-size:12px;color:var(--text-secondary)">请稍候...</p>';
        hint.style.display = '';
      }

      // 轮询等待 Viewer3D 模块就绪
      var attempts = 0;
      var maxAttempts = 50; // 10 秒
      var poll = setInterval(function() {
        attempts++;
        if (window.Viewer3D && window.Viewer3D.init) {
          clearInterval(poll);
          window.Viewer3D.init();
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          console.error('[App] Viewer3D 模块加载超时');
          if (hint) {
            hint.innerHTML = '<div class="icon">❌</div><p>3D 引擎加载失败</p><p style="font-size:12px;color:var(--text-secondary)">请检查网络连接后刷新页面</p>';
            hint.style.display = '';
          }
        }
      }, 200);
    }
    if (page === 'search') {
      const vehicles = DB.vehicles.all();
      if (vehicles.length > 0) renderSearchResults(vehicles);
      else document.getElementById('search-empty').style.display = 'block';
    }
  }

  // ═══════════════════ Toast ═══════════════════
  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ═══════════════════ 模态框 ═══════════════════
  function showModal(title, contentHtml) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = `
      <div class="modal-header">
        <span>${title}</span>
        <button class="modal-close" onclick="document.getElementById('modal-overlay').classList.remove('open')">&times;</button>
      </div>
      ${contentHtml}
    `;
    overlay.classList.add('open');
    overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove('open'); };
  }

  // ═══════════════════ 搜索 ═══════════════════
  function bindSearch() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    btn.addEventListener('click', () => doSearch(input.value.trim()));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch(input.value.trim());
    });
    const vehicles = DB.vehicles.all();
    if (vehicles.length > 0) renderSearchResults(vehicles);
  }

  function doSearch(query) {
    const resultsDiv = document.getElementById('search-results');
    const emptyDiv = document.getElementById('search-empty');
    const detailDiv = document.getElementById('vehicle-detail');

    if (!query) {
      const all = DB.vehicles.all();
      if (all.length === 0) {
        resultsDiv.style.display = 'none';
        emptyDiv.style.display = 'block';
        detailDiv.style.display = 'none';
      } else {
        emptyDiv.style.display = 'none';
        renderSearchResults(all);
      }
      return;
    }

    const results = DB.vehicles.search(query);
    if (results.length === 0) {
      resultsDiv.style.display = 'none';
      emptyDiv.style.display = 'block';
      detailDiv.style.display = 'none';
    } else {
      emptyDiv.style.display = 'none';
      renderSearchResults(results);
    }
  }

  function renderSearchResults(vehicles) {
    const resultsDiv = document.getElementById('search-results');
    const emptyDiv = document.getElementById('search-empty');
    resultsDiv.style.display = 'grid';
    emptyDiv.style.display = 'none';

    resultsDiv.innerHTML = vehicles.map(v => `
      <div class="vehicle-card" data-id="${v.id}">
        <div class="brand">${v.brand || '未知品牌'}</div>
        <div class="model">${v.model || '未知车型'}</div>
        <div class="meta">
          ${v.year || ''} ${v.platform || ''} ${v.segment || ''}
          ${v.productId ? ' · ID: ' + v.productId : ''}
        </div>
      </div>
    `).join('');

    resultsDiv.querySelectorAll('.vehicle-card').forEach(card => {
      card.addEventListener('click', () => showVehicleDetail(card.dataset.id));
    });
  }

  // ═══════════════════ 车型详情 ═══════════════════
  function showVehicleDetail(vehicleId) {
    currentVehicleId = vehicleId;
    const vehicle = DB.vehicles.get(vehicleId);
    if (!vehicle) return;

    const detailDiv = document.getElementById('vehicle-detail');
    detailDiv.style.display = 'block';

    document.getElementById('detail-title').textContent =
      `${vehicle.brand || ''} ${vehicle.model || '未知车型'} 详情`;

    document.getElementById('detail-info').innerHTML = `
      <div class="detail-item"><div class="label">品牌</div><div class="value">${vehicle.brand || '-'}</div></div>
      <div class="detail-item"><div class="label">车型</div><div class="value">${vehicle.model || '-'}</div></div>
      <div class="detail-item"><div class="label">年份</div><div class="value">${vehicle.year || '-'}</div></div>
      <div class="detail-item"><div class="label">平台</div><div class="value">${vehicle.platform || '-'}</div></div>
      <div class="detail-item"><div class="label">Product ID</div><div class="value" style="font-size:12px;word-break:break-all">${vehicle.productId || '-'}</div></div>
      <div class="detail-item"><div class="label">Node ID</div><div class="value" style="font-size:12px;word-break:break-all">${vehicle.nodeId || '-'}</div></div>
      <div class="detail-item"><div class="label">A2MAC1 链接</div><div class="value" style="font-size:12px"><a href="${vehicle.a2mac1Url || '#'}" target="_blank">打开</a></div></div>
      <div class="detail-item"><div class="label">添加时间</div><div class="value" style="font-size:12px">${vehicle.createdAt ? new Date(vehicle.createdAt).toLocaleDateString('zh-CN') : '-'}</div></div>
    `;

    renderConsoleTable(vehicleId);
    renderFileList(vehicleId);
    renderBridgeTable(vehicleId);

    document.getElementById('btn-refresh-data').onclick = () => {
      toast('请在 A2MAC1 页面使用提取脚本刷新数据', 'info');
    };
    document.getElementById('btn-delete-vehicle').onclick = () => {
      if (confirm(`确定删除 ${vehicle.model || '此车型'} 及其所有数据吗？`)) {
        DB.vehicles.delete(vehicleId);
        currentVehicleId = null;
        document.getElementById('vehicle-detail').style.display = 'none';
        updateDbStatus();
        doSearch('');
        toast('已删除', 'success');
      }
    };
    document.getElementById('btn-add-console').onclick = () => showAddConsoleModal(vehicleId);
    document.getElementById('btn-add-bridge').onclick = () => showAddBridgeModal(vehicleId);
    document.getElementById('btn-select-all').onclick = () => {
      const checkboxes = document.querySelectorAll('#file-list input[type="checkbox"]');
      const allChecked = [...checkboxes].every(c => c.checked);
      checkboxes.forEach(c => { c.checked = !allChecked; });
    };
    document.getElementById('btn-download-selected').onclick = () => downloadSelectedFiles(vehicleId);

    document.getElementById('vehicle-detail').scrollIntoView({ behavior: 'smooth' });
  }

  // ── Console 表格 ──
  function renderConsoleTable(vehicleId) {
    const consoles = DB.consoles.byVehicle(vehicleId);
    const tbody = document.querySelector('#console-table tbody');
    const empty = document.getElementById('console-empty');

    if (consoles.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      document.querySelector('#console-table').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.querySelector('#console-table').style.display = '';
      tbody.innerHTML = consoles.map(c => `
        <tr>
          <td>${c.name || '-'}</td>
          <td>${c.outerLength != null ? c.outerLength + ' mm' : '-'}</td>
          <td>${c.outerWidth != null ? c.outerWidth + ' mm' : '-'}</td>
          <td>${c.outerHeight != null ? c.outerHeight + ' mm' : '-'}</td>
          <td>${c.lengthMin != null ? c.lengthMin + ' mm' : '-'}</td>
          <td>${c.widthMin != null ? c.widthMin + ' mm' : '-'}</td>
          <td>${c.heightMin != null ? c.heightMin + ' mm' : '-'}</td>
          <td>${c.material || '-'}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="App._deleteConsole('${c.id}')">删除</button>
          </td>
        </tr>
      `).join('');
    }
  }

  function _deleteConsole(id) {
    if (confirm('确定删除此 Console 数据吗？')) {
      DB.consoles.delete(id);
      renderConsoleTable(currentVehicleId);
      updateDbStatus();
      toast('已删除', 'success');
    }
  }

  function showAddConsoleModal(vehicleId) {
    showModal('添加 Console 数据', `
      <form id="add-console-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label style="font-size:12px;color:var(--text-secondary)">名称</label>
          <input class="input" id="ac-name" value="Instrument Panel" required></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">材质</label>
          <input class="input" id="ac-material" placeholder="如 PP+GF20"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">A / 长 (mm)</label>
          <input class="input" id="ac-a" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">A min (mm)</label>
          <input class="input" id="ac-amin" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">B / 宽 (mm)</label>
          <input class="input" id="ac-b" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">B min (mm)</label>
          <input class="input" id="ac-bmin" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">C / 高 (mm)</label>
          <input class="input" id="ac-c" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">C min (mm)</label>
          <input class="input" id="ac-cmin" type="number" step="0.1"></div>
        <div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-secondary)">备注</label>
          <input class="input" id="ac-notes"></div>
        <div style="grid-column:1/-1">
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);
    document.getElementById('add-console-form').addEventListener('submit', e => {
      e.preventDefault();
      DB.consoles.upsert({
        vehicleId,
        name: document.getElementById('ac-name').value,
        material: document.getElementById('ac-material').value,
        outerLength: parseFloatOrNull('ac-a'),
        lengthMin: parseFloatOrNull('ac-amin'),
        outerWidth: parseFloatOrNull('ac-b'),
        widthMin: parseFloatOrNull('ac-bmin'),
        outerHeight: parseFloatOrNull('ac-c'),
        heightMin: parseFloatOrNull('ac-cmin'),
        notes: document.getElementById('ac-notes').value,
      });
      document.getElementById('modal-overlay').classList.remove('open');
      renderConsoleTable(vehicleId);
      updateDbStatus();
      toast('Console 数据已保存', 'success');
    });
  }

  function parseFloatOrNull(id) {
    const v = document.getElementById(id).value;
    return v ? parseFloat(v) : null;
  }

  // ── 文件列表 ──
  function renderFileList(vehicleId) {
    const files = DB.files.byVehicle(vehicleId);
    const listDiv = document.getElementById('file-list');
    const emptyDiv = document.getElementById('file-empty');
    const countSpan = document.getElementById('file-count');

    countSpan.textContent = `共 ${files.length} 个文件`;

    if (files.length === 0) {
      listDiv.innerHTML = '';
      emptyDiv.style.display = 'block';
      listDiv.style.display = 'none';
    } else {
      emptyDiv.style.display = 'none';
      listDiv.style.display = '';
      listDiv.innerHTML = files.map(f => `
        <div class="file-item" data-id="${f.id}">
          <input type="checkbox" class="file-checkbox" data-id="${f.id}">
          <span class="file-name">${f.name}</span>
          <span class="badge badge-primary">${(f.versionIds || []).join(', ') || 'HD'}</span>
          ${f.isTransparent ? '<span class="badge badge-warning">透明</span>' : ''}
          <span class="file-meta">ID: ${f.partId || '-'}</span>
          <button class="btn btn-sm btn-primary" onclick="App._downloadSingle('${f.id}')">下载</button>
          <button class="btn btn-sm" onclick="App._copyDownloadUrl('${f.id}')">📋</button>
        </div>
      `).join('');
    }
  }

  function _downloadSingle(fileId) {
    const file = DB.files.all().find(f => f.id === fileId);
    if (!file || !file.downloadUrl) { toast('找不到下载链接', 'error'); return; }
    window.open(file.downloadUrl, '_blank');
    toast(`开始下载: ${file.name}.zip`, 'info');
  }

  function _copyDownloadUrl(fileId) {
    const file = DB.files.all().find(f => f.id === fileId);
    if (!file || !file.downloadUrl) { toast('找不到下载链接', 'error'); return; }
    navigator.clipboard.writeText(file.downloadUrl).then(() => toast('下载链接已复制', 'success'));
  }

  function downloadSelectedFiles(vehicleId) {
    const checkboxes = document.querySelectorAll('#file-list input[type="checkbox"]:checked');
    if (checkboxes.length === 0) { toast('请先选择文件', 'warning'); return; }
    const files = DB.files.byVehicle(vehicleId);
    const selectedIds = [...checkboxes].map(c => c.dataset.id);
    const selected = files.filter(f => selectedIds.includes(f.id));

    showModal('批量下载', `
      <p style="margin-bottom:12px">即将下载 ${selected.length} 个文件：</p>
      <div class="file-list" style="max-height:300px">
        ${selected.map(f => `
          <div class="file-item">
            <span class="file-name">${f.name}</span>
            <span class="badge badge-primary">${(f.versionIds || []).join(', ') || 'HD'}</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-primary" id="btn-start-download">开始下载</button>
        <button class="btn" onclick="document.getElementById('modal-overlay').classList.remove('open')">取消</button>
      </div>
    `);

    document.getElementById('btn-start-download').addEventListener('click', () => {
      document.getElementById('modal-overlay').classList.remove('open');
      let i = 0;
      const interval = setInterval(() => {
        if (i >= selected.length) { clearInterval(interval); toast(`全部 ${selected.length} 个文件下载任务已触发`, 'success'); return; }
        window.open(selected[i].downloadUrl, '_blank');
        i++;
      }, 800);
      toast(`开始批量下载 ${selected.length} 个文件...`, 'info');
    });
  }

  // ── 桥洞表格 ──
  function renderBridgeTable(vehicleId) {
    const bridges = DB.bridgeHoles.byVehicle(vehicleId);
    const tbody = document.querySelector('#bridge-table tbody');
    const empty = document.getElementById('bridge-empty');

    if (bridges.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      document.querySelector('#bridge-table').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.querySelector('#bridge-table').style.display = '';
      tbody.innerHTML = bridges.map(b => `
        <tr>
          <td>${b.name || '-'}</td>
          <td>${b.bottomWidth != null ? b.bottomWidth + ' mm' : '-'}</td>
          <td>${b.topWidth != null ? b.topWidth + ' mm' : '-'}</td>
          <td>${b.depth != null ? b.depth + ' mm' : '-'}</td>
          <td>${b.crossSectionArea != null ? b.crossSectionArea.toFixed(1) + ' mm²' : '-'}</td>
          <td>${b.volume != null ? (b.volume / 1000).toFixed(1) + ' cm³' : '-'}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="App._deleteBridge('${b.id}')">删除</button>
          </td>
        </tr>
      `).join('');
    }
  }

  function _deleteBridge(id) {
    if (confirm('确定删除此桥洞数据吗？')) {
      DB.bridgeHoles.delete(id);
      renderBridgeTable(currentVehicleId);
      updateDbStatus();
      toast('已删除', 'success');
    }
  }

  function showAddBridgeModal(vehicleId) {
    showModal('添加桥洞参数', `
      <form id="add-bridge-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label style="font-size:12px;color:var(--text-secondary)">名称</label>
          <input class="input" id="abh-name" required></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">底宽 (mm)</label>
          <input class="input" id="abh-bw" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">顶宽 (mm)</label>
          <input class="input" id="abh-tw" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">深度 (mm)</label>
          <input class="input" id="abh-d" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">截面积 (mm²)</label>
          <input class="input" id="abh-area" type="number" step="0.1"></div>
        <div><label style="font-size:12px;color:var(--text-secondary)">容积 (mm³)</label>
          <input class="input" id="abh-vol" type="number" step="0.1"></div>
        <div style="grid-column:1/-1">
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);
    document.getElementById('add-bridge-form').addEventListener('submit', e => {
      e.preventDefault();
      DB.bridgeHoles.upsert({
        vehicleId,
        name: document.getElementById('abh-name').value,
        bottomWidth: parseFloatOrNull('abh-bw'),
        topWidth: parseFloatOrNull('abh-tw'),
        depth: parseFloatOrNull('abh-d'),
        crossSectionArea: parseFloatOrNull('abh-area'),
        volume: parseFloatOrNull('abh-vol'),
      });
      document.getElementById('modal-overlay').classList.remove('open');
      renderBridgeTable(vehicleId);
      updateDbStatus();
      toast('桥洞数据已保存', 'success');
    });
  }

  // ═══════════════════ 数据库页面 ═══════════════════
  function renderDatabase() {
    const stats = DB.stats();
    const vehicles = DB.vehicles.all();

    document.getElementById('db-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${stats.vehicles}</div><div class="stat-label">车型</div></div>
      <div class="stat-card"><div class="stat-value">${stats.consoles}</div><div class="stat-label">Console 数据</div></div>
      <div class="stat-card"><div class="stat-value">${stats.files}</div><div class="stat-label">3D 文件</div></div>
      <div class="stat-card"><div class="stat-value">${stats.bridgeHoles}</div><div class="stat-label">桥洞参数</div></div>
    `;

    const tbody = document.querySelector('#db-vehicle-table tbody');
    const empty = document.getElementById('db-empty');

    if (vehicles.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      document.querySelector('#db-vehicle-table').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.querySelector('#db-vehicle-table').style.display = '';
      tbody.innerHTML = vehicles.map(v => `
        <tr>
          <td>${v.brand || '-'}</td>
          <td><a href="#" onclick="App._navigateToVehicle('${v.id}')">${v.model || '-'}</a></td>
          <td>${v.year || '-'}</td>
          <td>${DB.consoles.byVehicleCount(v.id)}</td>
          <td>${DB.files.byVehicleCount(v.id)}</td>
          <td>${v.createdAt ? new Date(v.createdAt).toLocaleDateString('zh-CN') : '-'}</td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="App._deleteVehicleFromDb('${v.id}')">删除</button>
          </td>
        </tr>
      `).join('');
    }

    document.getElementById('btn-export-db').onclick = exportDatabase;
    document.getElementById('btn-import-db').onclick = () => {
      document.getElementById('import-file-input').click();
    };
    document.getElementById('btn-clear-db').onclick = () => {
      if (confirm('确定清空所有数据吗？此操作不可恢复！')) {
        DB.clearAll();
        updateDbStatus();
        renderDatabase();
        toast('数据库已清空', 'success');
      }
    };
  }

  function bindDatabase() {
    // 数据库页面的按钮事件在 renderDatabase() 中动态绑定
    // 导入文件输入和空状态按钮在 bindImportButtons() 中绑定
  }

  function _navigateToVehicle(id) {
    navigateTo('search');
    showVehicleDetail(id);
  }

  function _deleteVehicleFromDb(id) {
    const v = DB.vehicles.get(id);
    if (confirm(`确定删除 ${v ? v.model : '此车型'} 及其所有数据吗？`)) {
      DB.vehicles.delete(id);
      if (currentVehicleId === id) {
        currentVehicleId = null;
        document.getElementById('vehicle-detail').style.display = 'none';
      }
      updateDbStatus();
      renderDatabase();
      toast('已删除', 'success');
    }
  }

  function exportDatabase() {
    const data = DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `a2mac1-cnsl-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('数据库导出成功', 'success');
  }

  // ═══════════════════ A2MAC1 JSON 导入 ═══════════════════
  function importA2mac1Json(jsonData) {
    // 支持两种格式:
    // 格式A: Console 脚本导出的 { vehicle, dimensions, files }
    // 格式B: 旧版数据库导出的 { vehicles, consoles, files, bridgeHoles }

    // 格式A: 从 Console 脚本导入
    if (jsonData.vehicle && jsonData.files) {
      const v = jsonData.vehicle;
      const name = v.name || '';

      // 尝试从名称中拆分品牌和车型
      let brand = '', model = name;
      if (name && name.includes(' ')) {
        const parts = name.split(' ');
        brand = parts[0];
        model = parts.slice(1).join(' ');
      }

      // 创建车型
      const vehicle = DB.vehicles.upsert({
        brand: brand,
        model: model || '未知车型',
        productId: v.productId || '',
        nodeId: v.nodeId || '',
        hierarchyId: v.hierarchyId || '',
        a2mac1Url: jsonData.sourceUrl || '',
      });

      const vehicleId = vehicle.id;

      // 导入尺寸数据
      if (jsonData.dimensions && Array.isArray(jsonData.dimensions)) {
        let imported = 0;
        jsonData.dimensions.forEach(d => {
          if (d.name || d.outerLength != null || d.outerWidth != null || d.outerHeight != null) {
            DB.consoles.upsert({
              vehicleId: vehicleId,
              name: d.name || 'Console',
              outerLength: d.outerLength != null ? parseFloat(d.outerLength) : null,
              outerWidth: d.outerWidth != null ? parseFloat(d.outerWidth) : null,
              outerHeight: d.outerHeight != null ? parseFloat(d.outerHeight) : null,
              lengthMin: d.lengthMin != null ? parseFloat(d.lengthMin) : null,
              widthMin: d.widthMin != null ? parseFloat(d.widthMin) : null,
              heightMin: d.heightMin != null ? parseFloat(d.heightMin) : null,
              material: d.material || null,
              mass: d.mass != null ? parseFloat(d.mass) : null,
              process: d.process || null,
            });
            imported++;
          }
        });
        if (imported > 0) console.log(`✅ 导入 ${imported} 条 Console 尺寸数据`);
      }

      // 导入文件列表
      if (jsonData.files.items && Array.isArray(jsonData.files.items)) {
        let importedFiles = 0;
        jsonData.files.items.forEach(f => {
          if (f.id && f.name) {
            DB.files.upsert({
              vehicleId: vehicleId,
              id: f.id,
              name: f.name,
              partTypeId: f.partTypeId || '',
              partId: f.partId || '',
              versionIds: f.versionIds || [],
              isTransparent: f.isTransparent || false,
              isDownloadable: true,
              token: f.token || '',
              downloadUrl: f.downloadUrl || '',
            });
            importedFiles++;
          }
        });
        if (importedFiles > 0) console.log(`✅ 导入 ${importedFiles} 个文件`);
      }

      updateDbStatus();
      return { vehicleId, vehicle };
    }

    // 格式B: 旧版数据库导出
    if (jsonData.vehicles || jsonData.consoles || jsonData.files) {
      if (DB.importAll(jsonData)) {
        updateDbStatus();
        return { vehicleId: null, vehicle: null };
      }
    }

    return null;
  }

  // ═══════════════════ 导入按钮绑定 ═══════════════════
  function bindImportButtons() {
    const fileInput = document.getElementById('import-file-input');

    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const result = importA2mac1Json(data);
          if (result) {
            if (result.vehicleId) {
              toast(`导入成功！${result.vehicle.model} · ${DB.consoles.byVehicleCount(result.vehicleId)} 条尺寸 · ${DB.files.byVehicleCount(result.vehicleId)} 个文件`, 'success');
              navigateTo('search');
              showVehicleDetail(result.vehicleId);
            } else {
              toast('导入成功', 'success');
              navigateTo('database');
              renderDatabase();
            }
          } else {
            toast('导入失败：数据格式不正确', 'error');
          }
        } catch (err) {
          toast('导入失败：JSON 解析错误', 'error');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    // 空状态导入按钮
    const btnImportEmpty = document.getElementById('btn-import-from-empty');
    if (btnImportEmpty) {
      btnImportEmpty.addEventListener('click', () => fileInput.click());
    }
    const btnCopyEmpty = document.getElementById('btn-copy-console-from-empty');
    if (btnCopyEmpty) {
      btnCopyEmpty.addEventListener('click', copyConsoleScript);
    }
    const btnImportDbEmpty = document.getElementById('btn-import-from-db-empty');
    if (btnImportDbEmpty) {
      btnImportDbEmpty.addEventListener('click', () => fileInput.click());
    }
  }

  // ═══════════════════ 工具页面 ═══════════════════
  function bindTools() {
    document.getElementById('btn-copy-console').addEventListener('click', copyConsoleScript);
    document.getElementById('btn-copy-bookmarklet').addEventListener('click', copyBookmarklet);
    document.getElementById('btn-fit-check').addEventListener('click', doFitCheck);
  }

  function renderTools() {
    const select = document.getElementById('fit-vehicle');
    const vehicles = DB.vehicles.all();
    select.innerHTML = '<option value="">-- 选择目标车型 --</option>' +
      vehicles.map(v => `<option value="${v.id}">${v.brand || ''} ${v.model || ''}</option>`).join('');
  }

  function copyConsoleScript() {
    const embedded = document.getElementById('console-script-src');
    if (embedded && embedded.textContent.trim()) {
      navigator.clipboard.writeText(embedded.textContent.trim()).then(() => {
        toast('✅ 脚本已复制！在 A2MAC1 页面 F12 → Console → 粘贴运行 → 然后运行 __CNSL_exportJSON()', 'success');
      });
      return;
    }
    fetch('scripts/a2mac1-console.js')
      .then(r => r.text())
      .then(script => {
        navigator.clipboard.writeText(script).then(() => {
          toast('✅ 脚本已复制！在 A2MAC1 页面 F12 → Console → 粘贴运行 → 然后运行 __CNSL_exportJSON()', 'success');
        });
      })
      .catch(() => toast('脚本加载失败，请手动打开 scripts/a2mac1-console.js', 'error'));
  }

  function copyBookmarklet() {
    if (location.protocol === 'file:') {
      toast('书签小工具需要部署到 HTTP 服务器。请直接用"复制 Console 脚本"按钮。', 'warning');
      return;
    }
    const code = `(function(){var s=document.createElement('script');s.src='${location.origin}/scripts/a2mac1-console.js';document.body.appendChild(s);})();`;
    navigator.clipboard.writeText(`javascript:${encodeURIComponent(code)}`).then(() => {
      toast('书签小工具已复制！创建新书签，将 URL 粘贴为书签地址即可', 'success');
    });
  }

  function doFitCheck() {
    const l = parseFloat(document.getElementById('fit-l').value);
    const w = parseFloat(document.getElementById('fit-w').value);
    const h = parseFloat(document.getElementById('fit-h').value);
    const vehicleId = document.getElementById('fit-vehicle').value;
    const resultDiv = document.getElementById('fit-result');

    if (!l || !w || !h) { toast('请输入部件尺寸', 'warning'); return; }
    if (!vehicleId) { toast('请选择目标车型', 'warning'); return; }

    const bridges = DB.bridgeHoles.byVehicle(vehicleId);
    const consoles = DB.consoles.byVehicle(vehicleId);
    const vehicle = DB.vehicles.get(vehicleId);

    if (bridges.length === 0 && consoles.length === 0) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div class="card" style="background:var(--warning-light);border-color:var(--warning)">
          ⚠️ 该车型暂无 Console 或桥洞数据，无法判定。请先导入数据。
        </div>`;
      return;
    }

    let html = `<h4 style="margin-bottom:12px">${vehicle?.brand || ''} ${vehicle?.model || ''} 适配判定</h4>`;
    html += `<p style="margin-bottom:12px;color:var(--text-secondary)">部件尺寸: ${l} × ${w} × ${h} mm</p>`;

    bridges.forEach(b => {
      const depthOk = l <= (b.depth || 0);
      const widthOk = w <= (b.bottomWidth || 0);
      const heightOk = h <= (b.topWidth || 0);
      const allOk = depthOk && widthOk && heightOk;

      const volumeMargin = b.volume ? (b.volume - l * w * h) : null;
      const widthMargin = b.bottomWidth ? (b.bottomWidth - w) : null;

      let status, badgeClass;
      if (allOk) { status = '✅ 可以放入'; badgeClass = 'badge-success'; }
      else if (widthMargin != null && widthMargin >= -3) { status = '⚠️ 勉强可放入'; badgeClass = 'badge-warning'; }
      else { status = '❌ 无法放入'; badgeClass = 'badge-danger'; }

      html += `
        <div class="card" style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong>${b.name}</strong>
            <span class="badge ${badgeClass}">${status}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:13px">
            <div>深度: ${b.depth || '-'} mm ${depthOk ? '✅' : '❌'} (部件: ${l} mm)</div>
            <div>底宽: ${b.bottomWidth || '-'} mm ${widthOk ? '✅' : '❌'} (部件: ${w} mm)</div>
            <div>高度: ${b.topWidth || '-'} mm ${heightOk ? '✅' : '❌'} (部件: ${h} mm)</div>
          </div>
          ${volumeMargin != null ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">
            体积余量: ${(volumeMargin / 1000).toFixed(1)} cm³ | 宽度余量: ${widthMargin?.toFixed(1) || '-'} mm
          </div>` : ''}
        </div>`;
    });

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = html;
  }

  // ═══════════════════ 公开 API ═══════════════════
  return {
    init,
    _deleteConsole,
    _deleteBridge,
    _downloadSingle,
    _copyDownloadUrl,
    _navigateToVehicle,
    _deleteVehicleFromDb,
    navigateTo,
    showVehicleDetail,
    toast,
    updateDbStatus,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());