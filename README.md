# A2MAC1 CNSL 尺寸爬取与分析平台

从 A2MAC1 平台提取汽车 Console（中控台）尺寸数据和 3D 点云文件，支持多车型对标分析和部件适配判定。

## 项目结构

```
a2mac1-cnsl-scraper/
├── index.html              # 主页面（车型搜索、数据库浏览、工具）
├── css/
│   └── style.css           # 全局样式
├── js/
│   ├── db.js               # 浏览器端数据库层（localStorage）
│   ├── a2mac1-api.js       # A2MAC1 API 客户端（含 POST 尺寸 API）
│   ├── app.js              # 主应用逻辑
│   └── viewer3d.js         # 3D 点云查看器（Three.js, v0.4.0）
├── scripts/
│   ├── a2mac1-extractor.user.js  # Tampermonkey 脚本
│   └── a2mac1-console.js         # 浏览器 Console 脚本（v0.3.0）
├── data/
│   └── vop-nodes.json      # VOP 层级树节点 ID 参考（来自 opencli-plugin-a2mac1）
└── README.md
```

## 快速开始

### 方式一：打开主页面

直接在浏览器中打开 `index.html` 即可使用。

### 方式二：在 A2MAC1 页面提取数据

1. 打开 A2MAC1 网站并登录
2. 进入目标车型的 **3D Data v3** 页面
3. 按 **F12** 打开开发者工具 → **Console** 标签
4. 复制 `scripts/a2mac1-console.js` 的全部内容，粘贴到 Console 中运行
5. 运行 `__CNSL_copyLinks()` 复制所有下载链接
6. 或运行 `__CNSL_downloadAll()` 批量下载

### 方式三：安装 Tampermonkey 脚本

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 打开 `scripts/a2mac1-extractor.user.js`，复制全部内容
3. 在 Tampermonkey 中创建新脚本，粘贴并保存
4. 访问 A2MAC1 时右下角会自动出现提取面板

## 已确认的 API 链路

| 步骤 | API | 说明 |
|:---:|------|------|
| 1 | `GET /api/visual/products` | 搜索车型，获取 productId |
| 2 | `GET /api/visual/files/hierarchy/{hId}/hierarchy-node/{nId}/get-files` | 获取 3D 文件列表及 token |
| 3 | `GET /files/downloads/files?token=...&filename=...` | 下载 .zip 文件 |

**固定参数：**
- `hierarchyId` = `00000005ZT4GEU01`（Vehicle Occupant Packaging）
- `itemId` = `000000AUWL3CEU02`（3D Data 功能入口）
- 更多 VOP 节点 ID 见 `data/vop-nodes.json`

## 参考来源

- **opencli-plugin-a2mac1** — Node.js CLI 插件，确认了 VOP 层级树节点 ID、POST 尺寸数据 API (`/api/products/{id}/hierarchies/{hid}/nodes/{nid}/data`) 等关键信息

## 开发路线图

- [x] Phase 1: 项目框架搭建（搜索、数据库、基础 UI）
- [x] Phase 2: A2MAC1 浏览器提取脚本
- [x] Phase 3: 3D 点云查看器（Three.js + PLYLoader + STLLoader）
- [ ] Phase 4: 测量工具 + 切断面功能
- [ ] Phase 5: 桥洞轮廓自动生成 + 参数计算
- [ ] Phase 6: 对标报告（ECharts）
- [ ] Phase 7: AI 适配判定
- [ ] Phase 8: 部署 + 优化

## 技术栈

- 纯前端 HTML/CSS/JS（无需构建工具）
- localStorage 数据持久化
- A2MAC1 内部 API（浏览器端调用，利用已登录 Session）
- Three.js（3D 点云渲染：PLY/STL 加载、高度着色、测量）

## 3D 查看器

点击导航栏 **🔮 3D 查看器** 进入。支持：

- **文件格式**：.ply / .stl / .obj / .zip（自动解压）
- **上传方式**：拖放或点击选择文件
- **显示模式**：点云 / 线框 / 实体
- **着色方案**：高度渐变（蓝→绿→黄→红）/ 单色 / 法向
- **背景**：深色 / 浅色切换
- **测量**：点击两点自动计算距离