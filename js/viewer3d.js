/* ============================================================
   A2MAC1 CNSL — 3D 点云查看器 v0.7.1
   Three.js 渲染引擎，负责加载和显示 3D 模型

   v0.6.9 修复:
   - 方案 C：边缘线阈值 30°→50°，透明度 0.6→0.25（消除曲面锯齿）
   - 方案 D：侧边栏新增"显示边缘线"开关
   v0.6.8 修复:
   - 方案 A：mergeVertices 合并重复顶点 → computeVertexNormals 正确平滑法线
   v0.6.7 修复 (5 项视觉优化):
   - 模型颜色从浅灰改为蓝灰，增强对比度（#d0d0d8 → #8899b0）
   - 边缘线框透明度从 0.3 提高到 0.6，颜色更深
   - 色调映射从 ACESFilmic 改为 Linear，曝光提高到 1.5
   - 包围盒颜色更亮、透明度从 0.35 提高到 0.7
   - 移除无用的地面参考面
   v0.6.6 修复:
   - 模型初始摆放角度：正面变顶面（绕 X 轴旋转 -90°）
   v0.6.5 修复:
   - 模型初始摆放角度再绕 270° 顺时针（总计 360° = 回到原始朝向）
   v0.6.4 修复:
   - 模型初始摆放角度顺时针旋转 90°（以原点为中心绕 Y 轴旋转）
   v0.6.2 修复:
   - 包围盒线框 & 地面参考面：修复 group 坐标偏移 bug（线框比模型偏移了 center 距离）
   v0.6.0 重大修复:
   - 移除模型缩放滑块（之前缩放的是模型不是网格，导致坐标系混乱）
   - 相机缩放步长改为基于相机距离（之前 36mm 步长对 11000mm 距离毫无意义）
   - 新增边缘线框叠加层（EdgesGeometry），模型始终可见
   - 新增自动旋转开关
   - 相机距离改用 diagonal * 2.5（之前 4.0 太远，模型占画面仅 17%）
   - 背景改为浅色默认
   - 新增半球光，确保无死角
   - 材质改为 MeshStandardMaterial + metalness + roughness
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const Viewer3D = (() => {
  // ── 状态 ──
  let scene, camera, renderer, controls;
  let models = [];
  let edgeLines = [];            // ★ 边缘线框叠加层
  let boundingBoxGroup = null;
  let displayMode = 'solid';
  let colorMode = 'solidColor';
  // 背景固定为浅色
  let isMeasuring = false;
  let measurePoints = [];
  let measureMarkers = [];
  let raycaster = new THREE.Raycaster();
  let mouse = new THREE.Vector2();
  let animationId = null;
  let container = null;
  let canvas = null;
  let initialized = false;
  let threeJsReady = false;
  let autoRotate = false;        // ★ 自动旋转

  // ★ Feature 6-9: 部件高亮/隐藏、颜色区分、截屏、双击重置
  let highlightedModel = null;      // 当前高亮的部件索引
  let colorPartsEnabled = false;    // 颜色区分开关
  const PART_COLORS = [
    0xe07060, // coral red
    0x60b870, // green
    0xe0a840, // gold
    0x6088d0, // blue
    0xc060c0, // purple
    0x50b0b0, // teal
    0xd08050, // orange
    0x80a050, // olive
    0xb06080, // rose
    0x50a0d0, // sky blue
    0xa0a060, // khaki
    0xd06090, // pink
  ];

  // ── 初始化 Three.js 引擎 ──
  function init() {
    if (initialized) return;

    container = document.getElementById('viewer3d-container');
    canvas = document.getElementById('viewer3d-canvas');
    if (!container || !canvas) {
      setTimeout(init, 100);
      return;
    }

    console.log('[3D查看器] 开始初始化 Three.js...');

    var hint = document.getElementById('viewer3d-hint');
    if (hint) {
      hint.innerHTML = '<div class="icon">⏳</div><p>正在加载 3D 引擎...</p>';
      hint.style.display = '';
    }

    try {
      // ── 场景 ──
      scene = new THREE.Scene();
      setBackground();

      // ── 相机 ──
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
      camera.position.set(5, 3, 5);
      camera.lookAt(0, 0, 0);

      // ── 渲染器 ──
      renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: false, preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.LinearToneMapping;
      renderer.toneMappingExposure = 1.5;

      // ── 控制器 ──
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.15;
      controls.rotateSpeed = 0.5;
      controls.panSpeed = 0.5;
      controls.zoomSpeed = 1.0;
      controls.minDistance = 10;
      controls.maxDistance = 100000;
      controls.target.set(0, 0, 0);
      controls.autoRotate = false;
      controls.autoRotateSpeed = 0.5;

      // ── ★ 光照：确保模型在任何角度都亮 ──
      // 半球光（天空 + 地面），提供基础照明
      var hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
      scene.add(hemiLight);

      // 环境光
      var ambient = new THREE.AmbientLight(0xffffff, 0.5);
      scene.add(ambient);

      // 主方向光
      var keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(1, 1, 1);
      scene.add(keyLight);

      // 补光
      var fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
      fillLight.position.set(-1, 0.3, -0.5);
      scene.add(fillLight);

      // 底部补光
      var bottomLight = new THREE.DirectionalLight(0xffffff, 0.5);
      bottomLight.position.set(0, -1, 0);
      scene.add(bottomLight);

      // 背面补光
      var backLight = new THREE.DirectionalLight(0xffffff, 0.6);
      backLight.position.set(0, 0, -1);
      scene.add(backLight);

      // ── 初始网格 ──
      var gridHelper = new THREE.GridHelper(10, 20, 0x999999, 0xcccccc);
      gridHelper.name = 'grid';
      scene.add(gridHelper);
      var axesHelper = new THREE.AxesHelper(3);
      axesHelper.name = 'axes';
      scene.add(axesHelper);

      bindUIButtons();
      bindFloatBar();
      setupKeyboardShortcuts();

      resizeWithRetry(0);

      window.addEventListener('resize', resize);
      canvas.addEventListener('click', onCanvasClick);
      canvas.addEventListener('mousemove', onCanvasMouseMove);

      animate();
      threeJsReady = true;
      initialized = true;
      console.log('[3D查看器] Three.js 初始化完成');

      if (hint) hint.style.display = 'none';

      // 处理待处理文件
      if (window.__viewer3d_pending && window.__viewer3d_pending.length > 0) {
        console.log('[3D查看器] 处理 ' + window.__viewer3d_pending.length + ' 个待处理文件');
        handleFiles(window.__viewer3d_pending);
        window.__viewer3d_pending = [];
      }
    } catch (err) {
      console.error('[3D查看器] Three.js 初始化失败:', err);
      initialized = false;
      if (hint) {
        hint.innerHTML = '<div class="icon">❌</div><p>3D 引擎加载失败: ' + err.message + '</p>';
        hint.style.display = '';
      }
      toast('3D 引擎加载失败: ' + err.message, 'error');
    }
  }

  function resizeWithRetry(attempt) {
    if (!container || !renderer) return;
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) {
      if (attempt < 10) {
        setTimeout(function() { resizeWithRetry(attempt + 1); }, 100);
      } else {
        renderer.setSize(800, 600);
        camera.aspect = 800 / 600;
        camera.updateProjectionMatrix();
      }
      return;
    }
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function setBackground() {
    if (!scene) return;
    // 固定浅色背景
    scene.background = new THREE.Color(0xe8e8ec);
    scene.fog = null;
  }

  function resize() {
    if (!container || !renderer) return;
    var w = container.clientWidth;
    var h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ── UI 按钮绑定 ──
  function bindUIButtons() {
    // 显示模式
    document.querySelectorAll('#viewer3d-mode-group .viewer3d-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#viewer3d-mode-group .viewer3d-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        displayMode = btn.dataset.mode;
        applyDisplayMode();
      });
    });

    // 着色模式
    document.querySelectorAll('#viewer3d-color-group .viewer3d-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#viewer3d-color-group .viewer3d-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        colorMode = btn.dataset.color;
        applyColorMode();
      });
    });

    // 缩放按钮
    var zoomInBtn = document.getElementById('viewer3d-zoom-in');
    var zoomOutBtn = document.getElementById('viewer3d-zoom-out');
    var zoomFitBtn = document.getElementById('viewer3d-zoom-fit');
    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    if (zoomFitBtn) zoomFitBtn.addEventListener('click', zoomFit);

    // ★ 自动旋转
    var autoRotateBtn = document.getElementById('viewer3d-auto-rotate');
    if (autoRotateBtn) {
      autoRotateBtn.addEventListener('click', toggleAutoRotate);
    }

    // 预设视角
    document.querySelectorAll('.viewer3d-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', function() {
        setPresetView(this.dataset.view);
      });
    });

    // 测量
    var measureBtn = document.getElementById('viewer3d-measure-btn');
    if (measureBtn) measureBtn.addEventListener('click', toggleMeasure);

    // 边缘线开关
    var edgesBtns = document.querySelectorAll('#viewer3d-edges-group .viewer3d-btn');
    edgesBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        toggleEdgeLines(this.dataset.edges === 'on');
      });
    });

    // ★ Feature 6-9: 截图、颜色区分
    var screenshotBtn = document.getElementById('viewer3d-screenshot');
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeScreenshot);

    var colorPartsBtn = document.getElementById('viewer3d-color-parts');
    if (colorPartsBtn) colorPartsBtn.addEventListener('click', toggleColorParts);

    // 重置视角
    var resetBtn = document.getElementById('viewer3d-reset-camera');
    if (resetBtn) resetBtn.addEventListener('click', resetCamera);
  }

  // ── 浮动控制栏 ──
  function bindFloatBar() {
    var bar = document.getElementById('viewer3d-floatbar');
    if (!bar) return;

    var bindings = {
      'v3d-fbtn-fit': zoomFit,
      'v3d-fbtn-zoomin': zoomIn,
      'v3d-fbtn-zoomout': zoomOut,
      'v3d-fbtn-reset': zoomFit,
      'v3d-fbtn-front': function() { setPresetView('front'); },
      'v3d-fbtn-top': function() { setPresetView('top'); },
      'v3d-fbtn-left': function() { setPresetView('left'); },
      'v3d-fbtn-iso': function() { setPresetView('iso'); },
      'v3d-fbtn-screenshot': takeScreenshot,
    };
    Object.keys(bindings).forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', bindings[id]);
    });

    }

  function showFloatBar() {
    var bar = document.getElementById('viewer3d-floatbar');
    var hint = document.getElementById('viewer3d-mouse-hint');
    if (bar) bar.style.display = 'flex';
    if (hint) hint.style.display = 'block';
  }

  function hideFloatBar() {
    var bar = document.getElementById('viewer3d-floatbar');
    var hint = document.getElementById('viewer3d-mouse-hint');
    if (bar) bar.style.display = 'none';
    if (hint) hint.style.display = 'none';
  }

  // ── ★ 缩放控制：基于相机距离，而非模型尺寸 ──
  function zoomIn() {
    if (!camera) return;
    var dist = camera.position.distanceTo(controls.target);
    var step = Math.max(dist * 0.15, 10);  // ★ 每次缩 15% 的相机距离
    var dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, -step);
    controls.update();
    updateDebugInfo();
  }

  function zoomOut() {
    if (!camera) return;
    var dist = camera.position.distanceTo(controls.target);
    var step = Math.max(dist * 0.15, 10);  // ★ 每次缩 15% 的相机距离
    var dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, step);
    controls.update();
    updateDebugInfo();
  }

  function zoomFit() {
    if (!boundingBoxGroup || models.length === 0) {
      resetCamera();
      return;
    }
    try { fitCameraToGroup(); } catch (e) { console.error('[3D查看器] fitCameraToGroup 失败:', e); }
    updateDebugInfo();
  }

  // ── ★ 自动旋转 ──
  function toggleAutoRotate() {
    autoRotate = !autoRotate;
    controls.autoRotate = autoRotate;
    var btn = document.getElementById('viewer3d-auto-rotate');
    if (btn) {
      btn.textContent = autoRotate ? '⏸️ 停止旋转' : '🔄 自动旋转';
      if (autoRotate) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    toast(autoRotate ? '自动旋转：开' : '自动旋转：关', 'info');
  }

  // ── ★ 边缘线开关 ──
  function toggleEdgeLines(show) {
    var edgesOnBtn = document.querySelector('#viewer3d-edges-group [data-edges="on"]');
    var edgesOffBtn = document.querySelector('#viewer3d-edges-group [data-edges="off"]');
    if (show) {
      edgesOnBtn.classList.add('active');
      edgesOffBtn.classList.remove('active');
    } else {
      edgesOnBtn.classList.remove('active');
      edgesOffBtn.classList.add('active');
    }
    for (var j = 0; j < edgeLines.length; j++) {
      edgeLines[j].visible = show;
    }
    toast(show ? '边缘线：显示' : '边缘线：隐藏', 'info');
  }

  // ── ★ Feature 6: 部件高亮 ──
  function highlightPart(index) {
    if (highlightedModel === index) {
      // 取消高亮
      resetPartHighlight();
      return;
    }
    resetPartHighlight();
    highlightedModel = index;
    var model = models[index];
    if (!model) return;
    // 保存原始材质属性
    model.userData._origEmissive = model.material.emissive ? model.material.emissive.getHex() : 0;
    model.userData._origEmissiveIntensity = model.material.emissiveIntensity || 0;
    model.material.emissive = new THREE.Color(0xffaa00);
    model.material.emissiveIntensity = 0.6;
    model.material.needsUpdate = true;
    updatePartsList();
  }

  function resetPartHighlight() {
    if (highlightedModel !== null && models[highlightedModel]) {
      var m = models[highlightedModel];
      if (m.userData._origEmissive !== undefined) {
        m.material.emissive = new THREE.Color(m.userData._origEmissive);
        m.material.emissiveIntensity = m.userData._origEmissiveIntensity;
      } else {
        m.material.emissive = new THREE.Color(0x000000);
        m.material.emissiveIntensity = 0;
      }
      m.material.needsUpdate = true;
    }
    highlightedModel = null;
    updatePartsList();
  }

  // ── ★ Feature 6: 部件可见性切换 ──
  function togglePartVisibility(index) {
    var model = models[index];
    if (!model) return;
    model.visible = !model.visible;
    // 同步边缘线可见性
    if (edgeLines[index]) {
      edgeLines[index].visible = model.visible;
    }
    updatePartsList();
  }

  // ── ★ Feature 7: 颜色区分 ──
  function toggleColorParts() {
    colorPartsEnabled = !colorPartsEnabled;
    if (colorPartsEnabled) {
      applyPartColors();
    } else {
      resetPartColors();
    }
    updatePartsList();
    var btn = document.getElementById('viewer3d-color-parts');
    if (btn) {
      if (colorPartsEnabled) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    toast(colorPartsEnabled ? '颜色区分：开' : '颜色区分：关（纯色）', 'info');
  }

  function applyPartColors() {
    for (var i = 0; i < models.length; i++) {
      var color = PART_COLORS[i % PART_COLORS.length];
      models[i].material.color.set(color);
      models[i].material.needsUpdate = true;
    }
  }

  function resetPartColors() {
    for (var i = 0; i < models.length; i++) {
      models[i].material.color.set(0x8899b0);
      models[i].material.needsUpdate = true;
    }
  }

  // ── ★ Feature 8: 截屏 ──
  function takeScreenshot() {
    if (!renderer) return;
    try {
      renderer.render(scene, camera);
      var dataURL = renderer.domElement.toDataURL('image/png');
      var link = document.createElement('a');
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = 'a2mac1-3d-view-' + ts + '.png';
      link.href = dataURL;
      link.click();
      toast('截屏已保存: ' + link.download, 'success');
    } catch (e) {
      console.error('[3D查看器] 截屏失败:', e);
      toast('截屏失败: ' + e.message, 'error');
    }
  }

  // ── ★ Feature 6-7: 部件列表面板 ──
  function updatePartsList() {
    var listEl = document.getElementById('viewer3d-parts-list');
    if (!listEl) return;
    if (models.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);padding:4px 0">未加载模型</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < models.length; i++) {
      var name = models[i].userData.originalName || models[i].name || 'Part ' + (i + 1);
      if (name.length > 20) name = name.slice(0, 18) + '..';
      var isVisible = models[i].visible !== false;
      var isHighlighted = highlightedModel === i;
      var colorHex = colorPartsEnabled
        ? '#' + PART_COLORS[i % PART_COLORS.length].toString(16).padStart(6, '0')
        : '#8899b0';
      html += '<div class="v3d-part-item' + (isHighlighted ? ' highlighted' : '') + '"'
        + ' data-index="' + i + '"'
        + ' style="' + (isHighlighted ? 'background:rgba(255,170,0,0.15);' : '') + '">'
        + '<span class="v3d-part-color" style="background:' + colorHex + '"></span>'
        + '<span class="v3d-part-name" style="' + (isVisible ? '' : 'opacity:0.35;text-decoration:line-through') + '">'
        + name + '</span>'
        + '<span class="v3d-part-eye" style="cursor:pointer" data-action="toggle" data-index="' + i + '">'
        + (isVisible ? '👁️' : '🚫') + '</span>'
        + '</div>';
    }
    listEl.innerHTML = html;

    // 绑定点击事件
    var items = listEl.querySelectorAll('.v3d-part-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function(e) {
        var idx = parseInt(this.dataset.index);
        var target = e.target;
        if (target.dataset.action === 'toggle') {
          e.stopPropagation();
          togglePartVisibility(idx);
        } else {
          highlightPart(idx);
        }
      });
    }
  }

  // ── ★ Feature 9: 键盘快捷键 ──
  function setupKeyboardShortcuts() {
    if (!canvas) return;
    canvas.setAttribute('tabindex', '0'); // 使 canvas 可聚焦
    canvas.addEventListener('keydown', function(e) {
      // 如果焦点在输入框内，不处理
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'r': resetCamera(); toast('快捷键: 重置视角', 'info'); break;
        case 'f': zoomFit(); toast('快捷键: 适配窗口', 'info'); break;
        case 's': takeScreenshot(); break;
        case 'a': toggleAutoRotate(); break;
        case 'e': toggleEdgeLines(edgeLines.length > 0 ? !edgeLines[0].visible : true); break;
        case 'c': toggleColorParts(); break;
        case '1': setPresetView('front'); break;
        case '2': setPresetView('back'); break;
        case '3': setPresetView('left'); break;
        case '4': setPresetView('right'); break;
        case '5': setPresetView('top'); break;
        case '6': setPresetView('bottom'); break;
        case '7': setPresetView('iso'); break;
        case 'escape': resetPartHighlight(); break;
        default: return; // 不阻止其他按键
      }
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // ── 预设视角 ──
  function setPresetView(view) {
    if (!camera || !boundingBoxGroup) return;
    var center = new THREE.Vector3();
    boundingBoxGroup.getCenter(center);
    var size = new THREE.Vector3();
    boundingBoxGroup.getSize(size);
    var diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    var dist = diagonal * 0.9;

    var pos;
    switch (view) {
      case 'front':  pos = new THREE.Vector3(0, 0, dist); break;
      case 'back':   pos = new THREE.Vector3(0, 0, -dist); break;
      case 'left':   pos = new THREE.Vector3(-dist, 0, 0); break;
      case 'right':  pos = new THREE.Vector3(dist, 0, 0); break;
      case 'top':    pos = new THREE.Vector3(0, dist, 0); break;
      case 'bottom': pos = new THREE.Vector3(0, -dist, 0); break;
      case 'iso':    pos = new THREE.Vector3(dist * 0.7, dist * 0.5, dist * 0.7); break;
      default:       pos = new THREE.Vector3(dist * 0.7, dist * 0.5, dist * 0.7); break;
    }
    animateCamera(pos, center);
  }

  function animateCamera(targetPos, targetLookAt) {
    var startPos = camera.position.clone();
    var startTarget = controls.target.clone();
    var startTime = performance.now();
    var duration = 600;

    function step(now) {
      var elapsed = now - startTime;
      var t = Math.min(elapsed / duration, 1.0);
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(startPos, targetPos, t);
      controls.target.lerpVectors(startTarget, targetLookAt, t);
      controls.update();
      if (t < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  // ── 文件处理 ──
  async function handleFiles(fileList) {
    var files = Array.from(fileList);
    console.log('[3D查看器] handleFiles: ' + files.length + ' 个文件');

    clearAllModels();

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var ext = file.name.split('.').pop().toLowerCase();
      console.log('[3D查看器] 处理: ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)');

      try {
        if (ext === 'ply') {
          var text = await file.text();
          loadPLY(text, file.name);
        } else if (ext === 'stl') {
          var buffer = await file.arrayBuffer();
          loadSTL(buffer, file.name);
        } else if (ext === 'zip') {
          await loadZip(file);
        } else {
          toast('不支持的文件格式: .' + ext, 'warning');
        }
      } catch (err) {
        console.error('[3D查看器] 加载失败: ' + file.name, err);
        toast('加载失败: ' + (err.message || err), 'error');
      }
    }

    if (models.length > 0) {
      finalizeModelGroup();
    } else {
      console.warn('[3D查看器] 没有成功加载任何模型');
      toast('没有成功加载任何模型', 'warning');
    }
  }

  // ── 清除所有模型 ──
  function clearAllModels() {
    for (var i = 0; i < models.length; i++) {
      scene.remove(models[i]);
      if (models[i].geometry) models[i].geometry.dispose();
      if (models[i].material) {
        if (Array.isArray(models[i].material)) {
          models[i].material.forEach(function(m) { m.dispose(); });
        } else {
          models[i].material.dispose();
        }
      }
    }
    models = [];
    highlightedModel = null;
    colorPartsEnabled = false;

    // ★ 清除边缘线框
    for (var j = 0; j < edgeLines.length; j++) {
      scene.remove(edgeLines[j]);
      if (edgeLines[j].geometry) edgeLines[j].geometry.dispose();
      if (edgeLines[j].material) edgeLines[j].material.dispose();
    }
    edgeLines = [];

    boundingBoxGroup = null;
    clearMeasurements();
    hideFloatBar();

    // 移除旧的 model-group（现在包裹在 model-rotation-group 内）
    var oldGroup = scene.getObjectByName('model-group');
    if (oldGroup) {
      while (oldGroup.children.length > 0) {
        scene.add(oldGroup.children[0]);
      }
      if (oldGroup.parent) {
        oldGroup.parent.remove(oldGroup);
      } else {
        scene.remove(oldGroup);
      }
    }
    // 移除父级旋转组
    var oldParent = scene.getObjectByName('model-rotation-group');
    if (oldParent) {
      while (oldParent.children.length > 0) {
        scene.add(oldParent.children[0]);
      }
      scene.remove(oldParent);
    }

    // 移除旧的包围盒线框
    var oldBBox = scene.getObjectByName('bbox-wireframe');
    if (oldBBox) {
      scene.remove(oldBBox);
      if (oldBBox.geometry) oldBBox.geometry.dispose();
      if (oldBBox.material) oldBBox.material.dispose();
    }

    // 重置信息面板
    var infoPanel = document.getElementById('viewer3d-info');
    if (infoPanel) infoPanel.innerHTML = '未加载模型';

    var debugEl = document.getElementById('viewer3d-debug');
    if (debugEl) debugEl.innerHTML = '';
  }

  // ── PLY 加载 ──
  function loadPLY(data, filename) {
    var loader = new PLYLoader();
    var geometry = loader.parse(data);
    if (!geometry || !geometry.attributes.position) {
      toast('PLY 解析失败', 'error');
      return;
    }
    createModel(geometry, filename);
  }

  // ── STL 加载 ──
  function loadSTL(buffer, filename) {
    console.log('[3D查看器] loadSTL: ' + filename + ', ' + buffer.byteLength + ' bytes');
    var loader = new STLLoader();
    var geometry;
    try {
      geometry = loader.parse(buffer);
    } catch (err) {
      console.error('[3D查看器] STL 解析异常:', err);
      toast('STL 解析失败: ' + (err.message || err), 'error');
      return;
    }
    if (!geometry) {
      toast('STL 解析失败', 'error');
      return;
    }
    console.log('[3D查看器] STL 解析成功: ' + filename + ', 顶点=' +
      (geometry.attributes.position ? geometry.attributes.position.count : 0));
    createModel(geometry, filename);
  }

  // ── ZIP 解压 ──
  async function loadZip(file) {
    console.log('[3D查看器] loadZip: ' + file.name);
    if (typeof JSZip === 'undefined') {
      toast('JSZip 未加载', 'error');
      return;
    }
    var zip = await JSZip.loadAsync(file);
    var entries = Object.entries(zip.files);
    console.log('[3D查看器] ZIP 包含 ' + entries.length + ' 个条目');

    var loaded = 0;
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i][0];
      var entry = entries[i][1];
      if (entry.dir) continue;
      var ext = name.split('.').pop().toLowerCase();

      if (ext === 'ply') {
        var text = await entry.async('text');
        loadPLY(text, name);
        loaded++;
      } else if (ext === 'stl') {
        var buffer = await entry.async('arraybuffer');
        loadSTL(buffer, name);
        loaded++;
      }
    }

    if (loaded === 0) {
      toast('ZIP 中没有 .ply 或 .stl 文件', 'warning');
    } else {
      console.log('[3D查看器] ZIP 解压完成，加载了 ' + loaded + ' 个模型');
    }
  }

  // ── ★ 创建单个模型 ──
  function createModel(geometry, name) {
    if (!threeJsReady) {
      toast('3D 引擎未就绪', 'warning');
      return;
    }

    geometry.computeBoundingBox();

    // ★ 方案 A：合并重复顶点，使 computeVertexNormals 能正确平均相邻面法线
    // STL 格式每个三角形独立存储顶点，不共享 → 无平滑着色 → 锯齿
    // mergeVertices 合并位置相同的顶点 → 创建共享索引 → 法线平滑
    var beforeVerts = geometry.attributes.position.count;
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();
    var afterVerts = geometry.attributes.position.count;
    console.log('[3D查看器] 顶点合并: ' + beforeVerts.toLocaleString() +
      ' → ' + afterVerts.toLocaleString() +
      ' (减少 ' + ((1 - afterVerts / beforeVerts) * 100).toFixed(1) + '%)');

    var material;
    if (displayMode === 'points') {
      material = new THREE.PointsMaterial({
        size: 0.01,
        color: 0x8888ff,
        sizeAttenuation: true,
      });
    } else if (displayMode === 'wireframe') {
      material = new THREE.MeshBasicMaterial({
        color: 0x3388ff,
        wireframe: true,
      });
    } else {
      // ★ 实体模式：MeshStandardMaterial，亮色，金属感
      material = new THREE.MeshStandardMaterial({
        color: 0x8899b0,
        roughness: 0.55,
        metalness: 0.05,
        side: THREE.DoubleSide,
        flatShading: false,
        vertexColors: false,
      });
    }

    if (colorMode !== 'solidColor' && displayMode === 'solid') {
      applyVertexColors(geometry, colorMode);
      material.vertexColors = true;
    }

    var model;
    if (displayMode === 'points') {
      model = new THREE.Points(geometry, material);
    } else {
      model = new THREE.Mesh(geometry, material);
    }
    model.name = name;
    model.userData = { originalName: name };

    scene.add(model);
    models.push(model);

    console.log('[3D查看器] 模型已添加: ' + name + ', 顶点=' +
      (geometry.attributes.position ? geometry.attributes.position.count : '?'));
  }

  // ── ★ 所有模型加载完成后 ──
  function finalizeModelGroup() {
    console.log('[3D查看器] finalizeModelGroup 开始, models.length=' + models.length);
    if (models.length === 0) {
      console.warn('[3D查看器] finalizeModelGroup: models 为空，跳过');
      return;
    }

    // 计算组合包围盒
    var groupBox = new THREE.Box3();
    for (var i = 0; i < models.length; i++) {
      groupBox.expandByObject(models[i]);
    }
    boundingBoxGroup = groupBox;

    var center = new THREE.Vector3();
    groupBox.getCenter(center);
    var size = new THREE.Vector3();
    groupBox.getSize(size);
    var diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);

    console.log('[3D查看器] 包围盒: 中心=(' + center.x.toFixed(1) + ',' + center.y.toFixed(1) + ',' + center.z.toFixed(1) + ')');
    console.log('[3D查看器] 包围盒: 尺寸=(' + size.x.toFixed(1) + ',' + size.y.toFixed(1) + ',' + size.z.toFixed(1) + ')');
    console.log('[3D查看器] 包围盒: 对角线=' + diagonal.toFixed(1));

    // 创建 group 包裹所有模型，居中到原点
    var group = new THREE.Group();
    group.name = 'model-group';
    for (var j = models.length - 1; j >= 0; j--) {
      scene.remove(models[j]);
      group.add(models[j]);
    }
    group.position.set(-center.x, -center.y, -center.z);

    // 创建父级旋转组（原点为中心），包裹 model-group，实现初始旋转
    var oldParent = scene.getObjectByName('model-rotation-group');
    if (oldParent) {
      while (oldParent.children.length > 0) {
        scene.add(oldParent.children[0]);
      }
      scene.remove(oldParent);
    }
    var parentGroup = new THREE.Group();
    parentGroup.name = 'model-rotation-group';
    parentGroup.add(group);
    // ★ 正面变顶面：绕 X 轴旋转 -90°，使模型 Z+ 面（正面）朝向 Y+（顶面）
    parentGroup.rotation.x = -Math.PI / 2;
    scene.add(parentGroup);

    // ★ 重新计算世界空间包围盒（旋转后），供相机适配使用
    boundingBoxGroup = new THREE.Box3();
    boundingBoxGroup.expandByObject(parentGroup);
    var worldSize = new THREE.Vector3();
    boundingBoxGroup.getSize(worldSize);
    console.log('[3D查看器] 旋转后包围盒: 尺寸=(' + worldSize.x.toFixed(1) + ',' + worldSize.y.toFixed(1) + ',' + worldSize.z.toFixed(1) + ')');

    // ★ 添加边缘线框叠加层
    try { addEdgeLines(group); } catch (e) { console.error('[3D查看器] addEdgeLines 失败:', e); }

    // 添加包围盒线框
    try { addBoundingBoxWireframe(groupBox); } catch (e) { console.error('[3D查看器] addBoundingBoxWireframe 失败:', e); }

    // 更新网格
    try { updateGrid(boundingBoxGroup); } catch (e) { console.error('[3D查看器] updateGrid 失败:', e); }

    // 适配相机
    try { fitCameraToGroup(); } catch (e) { console.error('[3D查看器] fitCameraToGroup 失败:', e); }

    // 更新信息面板
    try { updateInfoPanel(size); console.log('[3D查看器] updateInfoPanel 已调用'); } catch (e) { console.error('[3D查看器] updateInfoPanel 失败:', e); }

    // ★ 更新部件列表
    try { updatePartsList(); } catch (e) { console.error('[3D查看器] updatePartsList 失败:', e); }

    console.log('[3D查看器] 模型组已居中，共 ' + models.length + ' 个部件');
    showFloatBar();
    toast('加载完成: ' + models.length + ' 个部件', 'success');
  }

  // ── ★ 边缘线框叠加层：模型始终可见 ──
  function addEdgeLines(group) {
    // 清除旧的
    for (var i = 0; i < edgeLines.length; i++) {
      scene.remove(edgeLines[i]);
      if (edgeLines[i].geometry) edgeLines[i].geometry.dispose();
      if (edgeLines[i].material) edgeLines[i].material.dispose();
    }
    edgeLines = [];

    for (var j = 0; j < models.length; j++) {
      var edgesGeo = new THREE.EdgesGeometry(models[j].geometry, 50);
      var edgesMat = new THREE.LineBasicMaterial({
        color: 0x222222,
        transparent: true,
        opacity: 0.25,
        linewidth: 1,
      });
      var edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
      edgesLine.name = 'edge-line-' + j;
      // 边缘线框需要和模型在同一个坐标系内
      // 模型已在 group 内，所以边缘线框也加到 group 内
      edgesLine.position.copy(models[j].position);
      edgesLine.rotation.copy(models[j].rotation);
      edgesLine.scale.copy(models[j].scale);
      group.add(edgesLine);
      edgeLines.push(edgesLine);
    }
    console.log('[3D查看器] 边缘线框已添加: ' + edgeLines.length + ' 个');
  }

  // ── 包围盒线框 ──
  // 关键：model-group 的 world position = (-center)，用于将模型居中到原点。
  // 包围盒 BoxGeometry 在本地原点 (0,0,0)，若直接加入 group，
  // 其 world position = (0,0,0) + group(-center) = (-center)，与模型错位。
  // 因此必须在 group 本地空间内将线框平移到 (+center)，抵消 group 的偏移：
  //   wireframe_world = center + group(-center) = (0,0,0) ✓
  function addBoundingBoxWireframe(box) {
    var oldBBox = scene.getObjectByName('bbox-wireframe');
    if (oldBBox) {
      scene.remove(oldBBox);
      if (oldBBox.geometry) oldBBox.geometry.dispose();
      if (oldBBox.material) oldBBox.material.dispose();
    }

    var boxSize = new THREE.Vector3();
    box.getSize(boxSize);
    var boxCenter = new THREE.Vector3();
    box.getCenter(boxCenter);

    var geo = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
    var mat = new THREE.MeshBasicMaterial({
      color: 0x00ff44,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
    });
    var wireframe = new THREE.Mesh(geo, mat);
    wireframe.name = 'bbox-wireframe';

    var group = scene.getObjectByName('model-group');
    if (group) {
      // ★ 修复：在 group 本地空间内平移到 boxCenter，抵消 group 的 -center 偏移
      wireframe.position.copy(boxCenter);
      group.add(wireframe);
    } else {
      wireframe.position.copy(boxCenter);
      scene.add(wireframe);
    }
  }

  // ── ★ 适配相机 ──
  function fitCameraToGroup() {
    if (!boundingBoxGroup) return;
    var size = new THREE.Vector3();
    boundingBoxGroup.getSize(size);
    var diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    // ★ 包围盒已在旋转后重新计算，相机距离 = 对角线 × 0.9（模型占画面约 85%）
    var dist = diagonal * 0.9;

    var minSafeDist = diagonal * 0.15;
    controls.minDistance = minSafeDist;
    controls.maxDistance = diagonal * 50;

    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    controls.target.set(0, 0, 0);
    controls.update();

    console.log('[3D查看器] 相机适配: diagonal=' + diagonal.toFixed(1) +
      ', dist=' + dist.toFixed(1) +
      ', camera=(' + camera.position.x.toFixed(1) +
      ',' + camera.position.y.toFixed(1) +
      ',' + camera.position.z.toFixed(1) + ')');
  }

  function updateGrid(worldBox) {
    // ★ 使用世界空间包围盒（旋转后）计算网格尺寸
    var worldSize = new THREE.Vector3();
    worldBox.getSize(worldSize);
    var worldCenter = new THREE.Vector3();
    worldBox.getCenter(worldCenter);

    var gridSize = Math.ceil(Math.max(worldSize.x, worldSize.z) * 3.0);
    var divisions = 20; // 固定分割数，避免过密变成实心灰色平面

    var oldGrid = scene.getObjectByName('grid');
    if (oldGrid) scene.remove(oldGrid);

    var newGrid = new THREE.GridHelper(gridSize, divisions, 0xaaaaaa, 0xdddddd);
    newGrid.name = 'grid';
    // ★ 网格放到模型底部（世界空间包围盒的底部），不切穿模型
    newGrid.position.y = worldBox.min.y;
    scene.add(newGrid);

    // 网格线半透明
    newGrid.material.transparent = true;
    newGrid.material.opacity = 0.35;

    var oldAxes = scene.getObjectByName('axes');
    if (oldAxes) scene.remove(oldAxes);
    var axisLen = gridSize * 0.5;
    var newAxes = new THREE.AxesHelper(axisLen);
    newAxes.name = 'axes';
    newAxes.position.y = worldBox.min.y;
    scene.add(newAxes);
  }

  function updateInfoPanel(size) {
    console.log('[3D查看器] updateInfoPanel 被调用, size=' + JSON.stringify({x: size.x, y: size.y, z: size.z}) + ', models.length=' + models.length);
    var infoEl = document.getElementById('viewer3d-info');
    if (!infoEl) { console.error('[3D查看器] updateInfoPanel: 找不到 #viewer3d-info 元素!'); return; }
    var html = '';
    html += '<div>📦 部件: ' + models.length + '</div>';
    if (models.length <= 10) {
      for (var i = 0; i < models.length; i++) {
        var n = (models[i].userData.originalName || models[i].name || '?');
        // 缩短显示名称
        if (n.length > 35) n = '...' + n.slice(-32);
        html += '<div style="font-size:11px;padding-left:8px">• ' + n + '</div>';
      }
    }
    html += '<div style="margin-top:4px">📐 X: ' + size.x.toFixed(1) + ' mm</div>';
    html += '<div>📐 Y: ' + size.y.toFixed(1) + ' mm</div>';
    html += '<div>📐 Z: ' + size.z.toFixed(1) + ' mm</div>';
    html += '<div>📦 体积: ' + (size.x * size.y * size.z / 1000).toFixed(1) + ' cm³</div>';

    var totalVerts = 0;
    for (var j = 0; j < models.length; j++) {
      if (models[j].geometry && models[j].geometry.attributes.position) {
        totalVerts += models[j].geometry.attributes.position.count;
      }
    }
    html += '<div>🔢 总顶点: ' + totalVerts.toLocaleString() + '</div>';
    infoEl.innerHTML = html;
  }

  // ── ★ 调试信息 ──
  function updateDebugInfo() {
    if (!camera) return;
    var dist = camera.position.distanceTo(controls.target);
    var el = document.getElementById('viewer3d-debug');
    if (!el) {
      // 创建调试信息元素
      el = document.createElement('div');
      el.id = 'viewer3d-debug';
      el.style.cssText = 'position:absolute;bottom:50px;right:10px;font-size:11px;' +
        'color:#666;background:rgba(255,255,255,0.8);padding:4px 8px;border-radius:4px;' +
        'pointer-events:none;z-index:10';
      var wrap = document.getElementById('viewer3d-container');
      if (wrap) wrap.appendChild(el);
    }
    if (el) {
      el.textContent = '📷 距离: ' + dist.toFixed(0) + ' mm | ' +
        (boundingBoxGroup ? '模型: ' +
          Math.sqrt(boundingBoxGroup.getSize(new THREE.Vector3()).x *
            boundingBoxGroup.getSize(new THREE.Vector3()).x +
            boundingBoxGroup.getSize(new THREE.Vector3()).y *
            boundingBoxGroup.getSize(new THREE.Vector3()).y +
            boundingBoxGroup.getSize(new THREE.Vector3()).z *
            boundingBoxGroup.getSize(new THREE.Vector3()).z).toFixed(0) + 'mm' : '');
    }
  }

  // ── 顶点着色 ──
  function applyVertexColors(geometry, mode) {
    var positions = geometry.attributes.position;
    var count = positions.count;

    if (!geometry.attributes.color) {
      var colors = new Float32Array(count * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    var colorsArr = geometry.attributes.color.array;

    if (mode === 'height') {
      var zMin = Infinity, zMax = -Infinity;
      for (var j = 0; j < count; j++) {
        var z = positions.getZ(j);
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
      var zRange = zMax - zMin || 1;
      for (var k = 0; k < count; k++) {
        var t = (positions.getZ(k) - zMin) / zRange;
        var color = heightColor(t);
        colorsArr[k * 3] = color.r;
        colorsArr[k * 3 + 1] = color.g;
        colorsArr[k * 3 + 2] = color.b;
      }
    } else if (mode === 'normal') {
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }
      var normals = geometry.attributes.normal;
      for (var n = 0; n < count; n++) {
        colorsArr[n * 3] = (normals.getX(n) + 1) * 0.5;
        colorsArr[n * 3 + 1] = (normals.getY(n) + 1) * 0.5;
        colorsArr[n * 3 + 2] = (normals.getZ(n) + 1) * 0.5;
      }
    }

    geometry.attributes.color.needsUpdate = true;
  }

  function heightColor(t) {
    if (t < 0.25) {
      var s = t / 0.25;
      return { r: 0.1, g: 0.2 + s * 0.6, b: 0.6 + s * 0.4 };
    } else if (t < 0.5) {
      var s2 = (t - 0.25) / 0.25;
      return { r: 0.1 + s2 * 0.1, g: 0.8 - s2 * 0.2, b: 1.0 - s2 * 0.5 };
    } else if (t < 0.75) {
      var s3 = (t - 0.5) / 0.25;
      return { r: 0.2 + s3 * 0.8, g: 0.6 + s3 * 0.4, b: 0.5 - s3 * 0.4 };
    } else {
      var s4 = (t - 0.75) / 0.25;
      return { r: 1.0, g: 1.0 - s4 * 0.8, b: 0.1 - s4 * 0.1 };
    }
  }

  // ── 显示模式切换 ──
  function applyDisplayMode() {
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var oldMaterial = model.material;

      if (displayMode === 'points') {
        model.material = new THREE.PointsMaterial({
          size: 0.01, color: 0x8888ff, sizeAttenuation: true,
        });
      } else if (displayMode === 'wireframe') {
        model.material = new THREE.MeshBasicMaterial({
          color: 0x3388ff, wireframe: true,
        });
      } else {
        var baseColor = colorPartsEnabled ? PART_COLORS[i % PART_COLORS.length] : 0x8899b0;
        model.material = new THREE.MeshStandardMaterial({
          color: baseColor, roughness: 0.55, metalness: 0.05,
          side: THREE.DoubleSide, flatShading: false,
          vertexColors: colorMode !== 'solidColor',
        });
        if (colorMode !== 'solidColor') {
          applyVertexColors(model.geometry, colorMode);
        }
      }

      if (oldMaterial) {
        if (Array.isArray(oldMaterial)) {
          oldMaterial.forEach(function(m) { m.dispose(); });
        } else {
          oldMaterial.dispose();
        }
      }
    }

    // ★ 更新边缘线框可见性
    var showEdges = (displayMode === 'solid');
    for (var j = 0; j < edgeLines.length; j++) {
      edgeLines[j].visible = showEdges;
    }
  }

  function applyColorMode() {
    // 切换到高度/法向着色时，自动关闭颜色区分
    if (colorMode !== 'solidColor' && colorPartsEnabled) {
      colorPartsEnabled = false;
      var btn = document.getElementById('viewer3d-color-parts');
      if (btn) btn.classList.remove('active');
    }
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      if (colorMode === 'solidColor') {
        model.material.vertexColors = false;
        if (colorPartsEnabled) {
          model.material.color.set(PART_COLORS[i % PART_COLORS.length]);
        } else {
          model.material.color.set(0x8899b0);
        }
      } else {
        applyVertexColors(model.geometry, colorMode);
        model.material.vertexColors = true;
      }
      model.material.needsUpdate = true;
    }
  }

  // ── 测量 ──
  function toggleMeasure() {
    isMeasuring = !isMeasuring;
    var btn = document.getElementById('viewer3d-measure-btn');
    if (isMeasuring) {
      btn.textContent = '🔴 测量中...';
      btn.style.background = 'var(--danger)';
      btn.style.color = '#fff';
      clearMeasurements();
    } else {
      btn.textContent = '📏 点击两点测距';
      btn.style.background = '';
      btn.style.color = '';
    }
  }

  function clearMeasurements() {
    measurePoints = [];
    measureMarkers.forEach(function(m) { scene.remove(m); });
    measureMarkers = [];
    var resultEl = document.getElementById('viewer3d-measure-result');
    if (resultEl) resultEl.textContent = '';
  }

  function addMeasureMarker(position, color) {
    var sphereGeo = new THREE.SphereGeometry(0.02, 16, 16);
    var sphereMat = new THREE.MeshBasicMaterial({ color: color });
    var sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.copy(position);
    scene.add(sphere);
    measureMarkers.push(sphere);
    return sphere;
  }

  function onCanvasClick(event) {
    if (!isMeasuring || models.length === 0) return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObjects(models, false);
    if (intersects.length > 0) {
      var point = intersects[0].point.clone();
      measurePoints.push(point);
      if (measurePoints.length === 1) {
        addMeasureMarker(point, 0x00ff00);
        document.getElementById('viewer3d-measure-result').textContent =
          '第1点: (' + point.x.toFixed(1) + ', ' + point.y.toFixed(1) + ', ' + point.z.toFixed(1) + ')';
      } else if (measurePoints.length === 2) {
        addMeasureMarker(point, 0xff0000);
        var dist = measurePoints[0].distanceTo(measurePoints[1]);
        document.getElementById('viewer3d-measure-result').textContent = '距离: ' + dist.toFixed(2) + ' mm';
        var lineGeo = new THREE.BufferGeometry().setFromPoints(measurePoints);
        var lineMat = new THREE.LineBasicMaterial({ color: 0xffff00 });
        var line = new THREE.Line(lineGeo, lineMat);
        scene.add(line);
        measureMarkers.push(line);
        setTimeout(function() { toggleMeasure(); }, 1500);
      }
    }
  }

  function onCanvasMouseMove() {
    canvas.style.cursor = isMeasuring ? 'crosshair' : '';
  }

  // ── 重置视角 ──
  function resetCamera() {
    if (boundingBoxGroup) {
      fitCameraToGroup();
    } else {
      camera.position.set(5, 3, 5);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }

  // ── Toast ──
  function toast(msg, type) {
    console.log('[3D查看器] ' + (type || 'info') + ': ' + msg);
    if (window.App && window.App.toast) {
      window.App.toast(msg, type);
    }
  }

  // ── 公开 API ──
  return {
    init: init,
    handleFiles: handleFiles,
    isReady: function() { return threeJsReady; },
    loadPLY: function(data, name) { if (!initialized) init(); loadPLY(data, name); },
    loadSTL: function(buffer, name) { if (!initialized) init(); loadSTL(buffer, name); },
    resetCamera: resetCamera,
    zoomFit: zoomFit,
    getModels: function() { return models; },
    getBoundingBox: function() { return boundingBoxGroup; },
  };
})();

// ── 页面导航到 3D 查看器时自动初始化 ──
var origNavigateTo = window.App && window.App.navigateTo;
if (origNavigateTo) {
  window.App.navigateTo = function(page) {
    origNavigateTo.call(window.App, page);
    if (page === 'viewer3d') {
      setTimeout(function() { Viewer3D.init(); }, 150);
    }
  };
}

window.Viewer3D = Viewer3D;

window.addEventListener('hashchange', function() {
  if (location.hash === '#viewer3d') {
    setTimeout(function() { Viewer3D.init(); }, 150);
  }
});

if (location.hash === '#viewer3d') {
  setTimeout(function() { Viewer3D.init(); }, 200);
}