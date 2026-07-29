/* ============================================================
   A2MAC1 CNSL — API 客户端模块
   封装已确认的 A2MAC1 API 端点。
   注意：这些 API 只能在已登录 A2MAC1 的浏览器中调用，
   因为需要有效的 Session Cookie。
   ============================================================ */

const A2MAC1 = (() => {
  const BASE = 'https://ibp.a2mac1.com';

  // ── 通用 fetch ──
  async function _fetch(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'include',  // 带上 Cookie
      headers: {
        'Accept': 'application/json',
        ...opts.headers,
      },
      ...opts,
    });
    if (!res.ok) {
      throw new Error(`A2MAC1 API error: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.json();
  }

  // ═══════════════════ 1. 搜索车型 ═══════════════════
  /**
   * 搜索车型列表
   * @returns {Promise<Array>} [{productId, productName, productTrim, ...}]
   */
  async function searchProducts(keyword = '') {
    const url = `${BASE}/api/visual/products?hideMappedProductTypesProperties=false`;
    const data = await _fetch(url);
    const products = data.products || data || [];
    if (!keyword) return products;
    const kw = keyword.toLowerCase();
    return products.filter(p =>
      (p.productName && p.productName.toLowerCase().includes(kw)) ||
      (p.productTrim && p.productTrim.toLowerCase().includes(kw))
    );
  }

  // ═══════════════════ 2. 获取可用选项 ═══════════════════
  /**
   * 获取产品的可用数据选项
   * @param {string} productId
   * @param {string} nodeId - 默认 000000AUWL3CEU02 (3D Data)
   */
  async function getAvailableOptions(productId, nodeId = '000000AUWL3CEU02') {
    return _fetch(
      `${BASE}/api/products/${productId}/available-options?hierarchyNodeId=${nodeId}&includeMappingOneToOne=true`
    );
  }

  // ═══════════════════ 3. 获取可用数据 ═══════════════════
  async function getAvailableData(productId, hierarchyId = '00000005ZT4GEU01', nodeId = '000000AUWL3CEU02') {
    return _fetch(
      `${BASE}/api/products/${productId}/available-data?hierarchyNodeId=${nodeId}&hierarchyId=${hierarchyId}&checkSimilarity=false`
    );
  }

  // ═══════════════════ 4. 获取 3D 文件列表 ═══════════════════
  /**
   * 获取指定车型/节点的 3D 文件列表
   * @param {string} hierarchyId - 固定 00000005ZT4GEU01
   * @param {string} nodeId - 每个车型不同
   * @returns {Promise<Array>} [{id, name, token, partTypeId, versionIds, isDownloadable, ...}]
   */
  async function getFiles(hierarchyId = '00000005ZT4GEU01', nodeId) {
    if (!nodeId) throw new Error('nodeId is required');
    return _fetch(
      `${BASE}/api/visual/files/hierarchy/${hierarchyId}/hierarchy-node/${nodeId}/get-files?api-version=2.0`
    );
  }

  // ═══════════════════ 5. 获取文件包 ═══════════════════
  async function getFilePackages(productId) {
    return _fetch(`${BASE}/api/visual/files/packages?productIds=${productId}`);
  }

  // ═══════════════════ 6. 获取映射数据（尺寸） ═══════════════════
  async function getMappedData(productId, hierarchyId = '00000005ZT4GEU01', nodeId) {
    return _fetch(
      `${BASE}/api/products/${productId}/hierarchy/${hierarchyId}/node/${nodeId}/mapped-data?allowDynamicColumns=false&hideMappedProperties=false`
    );
  }

  // ═══════════════════ 7. 获取节点数据（完整尺寸表格） ═══════════════════
  /**
   * 来源: opencli-plugin-a2mac1 逆向分析
   * POST /api/products/{productId}/hierarchies/{hierarchyId}/nodes/{nodeId}/data
   * 返回 SAE J1100 标准尺寸：Length, Height, Width, Angle, Seats 等
   */
  async function getNodeData(productId, hierarchyId = '00000005ZT4GEU01', nodeId) {
    return _fetch(
      `${BASE}/api/products/${productId}/hierarchies/${hierarchyId}/nodes/${nodeId}/data?hideMappedProperties=false&hideMappedProductTypesProperties=true&hierarchyId=${hierarchyId}`
    );
  }

  /**
   * POST 版本的节点数据获取（opencli-plugin-a2mac1 使用的格式）
   * 有些节点可能只响应 POST
   */
  async function fetchNodeDataPost(productId, hierarchyId = '00000005ZT4GEU01', nodeId) {
    const res = await fetch(
      `${BASE}/api/products/${productId}/hierarchies/${hierarchyId}/nodes/${nodeId}/data`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: '{}',
      }
    );
    if (!res.ok) {
      throw new Error(`A2MAC1 API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // ═══════════════════ 7b. 获取层级子节点 ═══════════════════
  /**
   * 来源: opencli-plugin-a2mac1
   * POST /api/hierarchies/{hierarchyId}
   * 返回指定层级下的所有子节点（用于浏览 VOP 树）
   */
  async function getHierarchyNodes(hierarchyId = '00000005ZT4GEU01') {
    const res = await fetch(`${BASE}/api/hierarchies/${hierarchyId}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      throw new Error(`A2MAC1 API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // ═══════════════════ 8. 检查 3D 数据访问权限 ═══════════════════
  async function check3DAccess(productId, itemId = '000000AUWL3CEU02') {
    return _fetch(`${BASE}/api/security/data-access/type/3?productId=${productId}&itemId=${itemId}`);
  }

  // ═══════════════════ 9. 构建下载 URL ═══════════════════
  /**
   * 根据 token 和文件名构建下载链接
   */
  function buildDownloadUrl(token, filename) {
    return `${BASE}/files/downloads/files?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(filename)}&api-version=1.1`;
  }

  return {
    searchProducts,
    getAvailableOptions,
    getAvailableData,
    getFiles,
    getFilePackages,
    getMappedData,
    getNodeData,
    fetchNodeDataPost,
    getHierarchyNodes,
    check3DAccess,
    buildDownloadUrl,
    BASE,
  };
})();