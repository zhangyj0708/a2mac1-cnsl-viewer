/* ============================================================
   A2MAC1 CNSL — 浏览器端数据库层
   基于 localStorage 的轻量数据库，存储：
   - vehicles: 车型信息
   - consoles: Console 尺寸数据
   - bridge_holes: 桥洞参数
   - files: 3D 文件元数据
   ============================================================ */

const DB = (() => {
  const PREFIX = 'a2mac1_cnsl_';

  // ── 内部存储读写 ──
  function _read(table) {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + table) || '[]');
    } catch { return []; }
  }
  function _write(table, data) {
    localStorage.setItem(PREFIX + table, JSON.stringify(data));
  }

  // ── 生成 ID ──
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ═══════════════════ Vehicles ═══════════════════
  const vehicles = {
    all() { return _read('vehicles'); },

    get(id) {
      return _read('vehicles').find(v => v.id === id) || null;
    },

    findByProductId(productId) {
      return _read('vehicles').find(v => v.productId === productId) || null;
    },

    search(query) {
      const q = query.toLowerCase();
      return _read('vehicles').filter(v =>
        (v.brand && v.brand.toLowerCase().includes(q)) ||
        (v.model && v.model.toLowerCase().includes(q)) ||
        (v.productId && v.productId.toLowerCase().includes(q))
      );
    },

    upsert(vehicle) {
      const list = _read('vehicles');
      const idx = list.findIndex(v => v.id === vehicle.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...vehicle, updatedAt: new Date().toISOString() };
      } else {
        list.push({
          id: vehicle.id || uid(),
          productId: vehicle.productId || '',
          brand: vehicle.brand || '',
          model: vehicle.model || '',
          year: vehicle.year || '',
          platform: vehicle.platform || '',
          segment: vehicle.segment || '',
          a2mac1Url: vehicle.a2mac1Url || '',
          hierarchyId: vehicle.hierarchyId || '00000005ZT4GEU01',
          nodeId: vehicle.nodeId || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      _write('vehicles', list);
      return list[idx >= 0 ? idx : list.length - 1];
    },

    delete(id) {
      const list = _read('vehicles').filter(v => v.id !== id);
      _write('vehicles', list);
      // 级联删除
      _write('consoles', _read('consoles').filter(c => c.vehicleId !== id));
      _write('bridge_holes', _read('bridge_holes').filter(b => b.vehicleId !== id));
      _write('files', _read('files').filter(f => f.vehicleId !== id));
    },

    count() { return _read('vehicles').length; },
  };

  // ═══════════════════ Consoles ═══════════════════
  const consoles = {
    all() { return _read('consoles'); },

    get(id) { return _read('consoles').find(c => c.id === id) || null; },

    byVehicle(vehicleId) {
      return _read('consoles').filter(c => c.vehicleId === vehicleId);
    },

    upsert(con) {
      const list = _read('consoles');
      const idx = list.findIndex(c => c.id === con.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...con, updatedAt: new Date().toISOString() };
      } else {
        list.push({
          id: con.id || uid(),
          vehicleId: con.vehicleId || '',
          name: con.name || '',
          outerLength: con.outerLength || null,   // A
          outerWidth: con.outerWidth || null,      // B
          outerHeight: con.outerHeight || null,    // C
          lengthMin: con.lengthMin || null,        // A min
          widthMin: con.widthMin || null,          // B min
          heightMin: con.heightMin || null,        // C min
          material: con.material || '',
          process: con.process || '',
          mass: con.mass || null,
          position: con.position || '',
          notes: con.notes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      _write('consoles', list);
      return list[idx >= 0 ? idx : list.length - 1];
    },

    delete(id) {
      _write('consoles', _read('consoles').filter(c => c.id !== id));
      _write('bridge_holes', _read('bridge_holes').filter(b => b.consoleId !== id));
    },

    count() { return _read('consoles').length; },
    byVehicleCount(vehicleId) {
      return _read('consoles').filter(c => c.vehicleId === vehicleId).length;
    },
  };

  // ═══════════════════ Bridge Holes ═══════════════════
  const bridgeHoles = {
    all() { return _read('bridge_holes'); },

    byVehicle(vehicleId) {
      return _read('bridge_holes').filter(b => b.vehicleId === vehicleId);
    },

    byConsole(consoleId) {
      return _read('bridge_holes').filter(b => b.consoleId === consoleId);
    },

    upsert(bh) {
      const list = _read('bridge_holes');
      const idx = list.findIndex(b => b.id === bh.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...bh, updatedAt: new Date().toISOString() };
      } else {
        list.push({
          id: bh.id || uid(),
          consoleId: bh.consoleId || '',
          vehicleId: bh.vehicleId || '',
          name: bh.name || '',
          bottomWidth: bh.bottomWidth || null,
          topWidth: bh.topWidth || null,
          depth: bh.depth || null,
          crossSectionArea: bh.crossSectionArea || null,
          volume: bh.volume || null,
          contourPoints: bh.contourPoints || null,  // JSON array of {x,y,z}
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      _write('bridge_holes', list);
      return list[idx >= 0 ? idx : list.length - 1];
    },

    delete(id) {
      _write('bridge_holes', _read('bridge_holes').filter(b => b.id !== id));
    },

    count() { return _read('bridge_holes').length; },
  };

  // ═══════════════════ Files (3D 点云文件元数据) ═══════════════════
  const files = {
    all() { return _read('files'); },

    byVehicle(vehicleId) {
      return _read('files').filter(f => f.vehicleId === vehicleId);
    },

    upsertBatch(vehicleId, fileList) {
      // fileList: [{id, name, token, partTypeId, partId, versionIds, isDownloadable, ...}]
      const existing = _read('files');
      // 移除该车型的旧记录
      const filtered = existing.filter(f => f.vehicleId !== vehicleId);
      const now = new Date().toISOString();
      const newFiles = fileList.map(f => ({
        id: f.id,
        vehicleId,
        name: f.name || '',
        token: f.token || '',
        partTypeId: f.partTypeId || '',
        partId: f.partId || '',
        versionIds: f.versionIds || [],
        isDownloadable: f.isDownloadable !== false,
        isTransparent: f.isTransparent || false,
        downloadUrl: f.token
          ? `https://ibp.a2mac1.com/files/downloads/files?token=${encodeURIComponent(f.token)}&filename=${encodeURIComponent(f.name)}.zip&api-version=1.1`
          : '',
        createdAt: now,
      }));
      _write('files', [...filtered, ...newFiles]);
      return newFiles;
    },

    deleteByVehicle(vehicleId) {
      _write('files', _read('files').filter(f => f.vehicleId !== vehicleId));
    },

    count() { return _read('files').length; },
    byVehicleCount(vehicleId) {
      return _read('files').filter(f => f.vehicleId === vehicleId).length;
    },
  };

  // ═══════════════════ 导入/导出 ═══════════════════
  function exportAll() {
    return {
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      vehicles: _read('vehicles'),
      consoles: _read('consoles'),
      bridge_holes: _read('bridge_holes'),
      files: _read('files'),
    };
  }

  function importAll(data) {
    if (!data || !data.vehicles) return false;
    _write('vehicles', data.vehicles || []);
    _write('consoles', data.consoles || []);
    _write('bridge_holes', data.bridge_holes || []);
    _write('files', data.files || []);
    return true;
  }

  function clearAll() {
    _write('vehicles', []);
    _write('consoles', []);
    _write('bridge_holes', []);
    _write('files', []);
  }

  function stats() {
    return {
      vehicles: vehicles.count(),
      consoles: consoles.count(),
      bridgeHoles: bridgeHoles.count(),
      files: files.count(),
    };
  }

  return { vehicles, consoles, bridgeHoles, files, exportAll, importAll, clearAll, stats, uid };
})();