# MyDockFinder Dock 核心 —— 验证任务清单

> 对应《dock-core-optimization-plan.md》四个批次（A 任务进度 / B 放大高度联动 / C 边界多屏 / D 浅色主题）。
> 每项改动都配了两层验证：**① 自动化层**（命令可复跑、可 CI）；**② GUI 点验层**（需运行 `pnpm dev` 人工验收）。
> 一键跑全部自动化验证：`pnpm verify`

---

## 批次 A — 任务进度同步加固

### 改动内容
- `electron/main.ts`：新增 `filterProgress` 迟滞滤波（归零需连续 2 tick 确认、非零小幅跳变 ≤2% 抑制、进程消失 2 tick 清理）；`runStateTick` 改用其输出推送。
- `src/components/DockItem.tsx`：进度条用 `AnimatePresence` 包裹，归零时平滑淡出而非硬卸载。

### ① 自动化验证
```bash
node scripts/verify-progress-B.mjs   # 或并入 pnpm verify
```
预期：**18 passed, 0 failed**，覆盖 6 场景——
- 正常上升逐 tick 推送；首次 0 不推
- 偏差 ≤2% 采样抖动抑制；>2 正常推送
- 归零第 1 次保留最近非零值（等平滑淡出）、第 2 次确认归零不再推
- 进程消失连续 2 tick 清理
- 多进程独立互不干扰
- clamp（150→100；负值→0 且无历史不推）

### ② GUI 点验（`pnpm dev`）
| 场景 | 操作 | 预期 |
|---|---|---|
| 文件复制 | 复制大文件（如 1GB），观察图标 | 进度稳步上涨，与系统复制进度同步 ≤1s |
| 浏览器下载 | Chrome/Edge 下载大文件 | Dock 图标进度条跟随下载进度 |
| 播放器 | 播放本地视频/音乐 | 进度条随播放推进 |
| 完成/取消 | 任一下载/复制完成或取消 | 进度条平滑淡出，**不闪清零** |

---

## 批次 B — 悬停放大高度联动

### 改动
- `src/App.css`：`.dock-container` 高度改为 `calc(var(--dock-height) + var(--dock-mag-extra, 0px))` + `height 0.18s` 过渡；新增 bottom 贴底 / top 贴顶对齐规则。
- `src/components/Dock.tsx`：hover 时按 `56×(magnification−1)` 注入 `--dock-mag-extra`，leave 220ms 后归零。

### ① 自动化验证
```bash
node scripts/verify-magnify-B.mjs
```
预期：**17项通过**，覆盖——增高量计算（mag 1.0→2.0）、最高档容器高 132px ≤ hover 扩容区 274px、CSS calc 公式/方向对齐/Dock.tsx 注入静态断言。

### ② GUI 点验
| 操作 | 预期 |
|---|---|
| iconSize 设为最大、magnification 拉高，悬停任一图标 | 放大图标完整可见、不溢出容器 |
| 悬停不同图标快速横移 | 容器高度平滑增高/回落、无跳变 |
| 顶部/底部两种位置 | 图标分别向下/向上凸出完整可见 |

---

## 批次 C — 边界 / 多显示器稳定性

### 改动
- `electron/main.ts`：`set-dock-hover` 四方向改用鼠标所在屏 `workArea(wa.x/wa.y)` 吸附并对齐边缘，width/height clamp 到 wa。
- `src/components/Dock.tsx`：加 `dockHoveredRef` 双层去重护栏（enter 已 hover 不再重复上报、leave debounce 220ms 才清态）。

### ① 自动化验证
```bash
node scripts/verify-boundary-C.mjs
```
预期：**18项通过**，覆盖：单屏 bottom 贴底/居中、top 贴顶、副屏(wa.x=1920,wa.y≠0) 左右吸附用 wa 坐标、窄工作区高度/宽度 clamp、Dock.tsx 护栏静态断言。

### ② GUI 点验
| 操作 | 预期 |
|---|---|
| 底部/顶部 dock，hover 放大 | 窗口不越出屏幕工作区 | 不抖动/被系统截断 |
| 拖动 Dock 到屏幕边缘 | 吸附正确、不变形 |
| 多显示器拖动选中 | 跟随鼠标所在屏、副屏坐标不错位 |
| 系统缩放(DPl)切换 | Dock 重新吸附、region/亚克力不残留 |

---

## 批次 D — 浅色主题走查

### 改动批次D落实于 `src/App.css`：新增 `:root[data-theme=light]` 下设置面板控件底（`--dock-input-bg`/`--dock-line`）、关闭按钮 hover（`--dock-hover-bg`/`-strong`）、副标题（`--text-secondary`）覆盖，修复浅色面板上控件/文字不可见。

### ① 自动化验证
```bash
node scripts/verify-theme-D.mjs
```
预期：**16项通过**：批次D新增覆盖规则存在、所用 6 个变量均在 `:root[data-theme=light]` 定义、深色下不受影响（深色元素仍硬编码）、App.tsx 激活 data-theme 机制。

### ② GUI 点验
| 操作 | 预期 |
|---|---|
| 切浅色主题，打开设置 | select/range 控件底清晰可辨、关闭按钮 hover 有反馈、副标题可读 |
| 深色主题 | 无回归（控件仍深色可读） |
| 对比度 | 文本（浅色下黑字）在浅色面板对比度达标 |

---

## 自动化验证命令索引

| 命令 | 范围 | 断言数 |
|---|---|---|
| `pnpm verify` | 全部批次（聚合） | 69 |
| `node scripts/verify-progress-B.mjs` | 批次A 任务进度滤波 | 18 |
| `node scripts/verify-magnify-B.mjs` | 批次B 高度联动 | 17 |
| `node scripts/verify-boundary-C.mjs` | 批次C 边界多屏 | 18 |
| `node scripts/verify-theme-D.mjs` | 批次D 浅色 | 16 |

> 说明：各验证脚本基于生产逻辑的**独立复刻**（因 `main.ts`/组件依赖 Electron/React 无法直接 import），语义与生产一致；GUI 层为最终人工验收依据。

---

---

## 用户实测问题回归（第 2 轮）

> 用户不以验证清单操作，直接使用反馈的 4 个问题；均已修复并纳入验证。

### 1. dock 周围白色背景、hover 时扩大
- **根因**：主进程 region 把 dock 条固定裁为 `DOCK_BAR=80px`，但渲染容器实际占 `76px 容器 + 8px positioner margin = 84px`；批次 B 的 hover 增高(56×(mag−1))使容器更高 → 容器顶露出 region 外白底，hover 越明显。
- **修复**：`electron/main.ts` 新增 `dockStripHeight()`（base 84，hover 时 + 56×(mag−1)），`regionOpts`/`buildHoverRegion` 的 top/bottom dock 条高度改用该值，随 hover 同步。
- **验证**：`scripts/verify-boundary-C.mjs` 第 8 节（region 条高 = 84 / 92.4 / 140 随 mag），见批次 C。

### 2. QQ 等应用窗口预览无内容
- **根因**：`printWindowCapture` 只用 2 种 flag(2,0)，全黑阈值 `<0.02` 把真实深色界面(QQ 暗色/DirectUI)误判为黑帧丢弃。
- **修复**：`electron/preview.ts` 循环尝试 `[2,0,1]`(含 PW_CLIENTONLY) 逐 flag 全黑检测取第一个有效帧；黑帧阈值放宽到 `<0.008`、采样密集(32)。全部黑才回退屏幕 gdi 截图。
- **验证**：需 GUI 打开 QQ/暗色窗口 hover 预览。

### 3. hover 应用名称被截断显示不全
- **根因**：`.dock-tooltip` 为 `white-space:nowrap` 无换行/宽度限制，长名称在窗口边缘被裁。
- **修复**：`src/App.css` 改 `white-space:normal; word-break:break-word; max-width:220px; text-align:center`，长名称自动换行完整显示。
- **验证**：GUI hover 长名称应用(如"Visual Studio Code")观察 tooltip。

### 4. 回收站图标看不到、但 hover 有占位
- **根因**：回收站/此电脑图标为自绘 SVG，用 `--text-secondary` + `opacity 0.55/0.35` 过于透明几近隐形。
- **修复**：`src/components/DockItem.tsx` 改用 `--text-primary`，opacity 提到 0.92/0.85/0.6。
- **验证**：GUI B dock 深/浅主题下回收站/此电脑图标清晰可见。