# MyDockFinder 对标分析与优化计划

> 目标应用：Windows 平台 [MyDockFinder](https://www.mydockfinder.com)（Steam 版，C++ 原生实现）
> 本文件记录：当前实现能力盘点 → 与原版的功能差距矩阵 → 分阶段优化路线图。
> 原则：**先完成与原版的功能对标，再进入自定义升级优化。**

---

## 一、项目现状速览

### 技术栈与架构

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳层 | Electron 43 | 透明无边框 Dock 窗口（80px 高）+ 独立设置窗口 |
| 渲染 | React 19 + TS + Vite 8 + Zustand | 单页应用，`?page=settings` 复用设置窗口 |
| 原生桥 | IPC + contextBridge | `electronAPI` 全量暴露于 `src/types/index.ts` |
| 原生能力 | koffi（user32/kernel32 直调）+ PowerShell | 窗口枚举走 koffi；图标/角标/天气/进度大量走 PowerShell |
| 动画 | framer-motion 12 | 悬停放大、进出场、角标弹簧 |

### 已实现功能（渲染进程 → 主进程）

- **Dock 栏**：固定区 + 运行区（可见窗口应用，进程退出才消失）、分隔线、搜索框、下载/回收站系统图标
- **悬停放大**：逐图标 wave scale（macOS 弹簧），tooltip、运行指示点
- **应用启动**：开始菜单 `.lnk` 扫描、已运行窗口聚焦复用、`shell:` 路径处理
- **Launchpad**：全屏应用网格 + 搜索（App 名称过滤）
- **文件夹浏览**：悬停/点击弹出网格，支持二级目录、图片缩略图
- **窗口预览**：悬停延迟后 `desktopCapturer` 截图匹配
- **系统托盘区**：时钟/日期、天气（wttr.in 实时温度）、电量、快捷菜单
- **消息角标**：微信/QQ/TIM/钉钉等 9 个白名单，标题括号解析 + UIA 兜底
- **任务进度**：可见窗口标题 `N%` 解析，映射到运行图标进度条
- **最小化动画**：窗口最小化时图标从窗口位置飞入 Dock（1 种）
- **拖放**：资源管理器文件/文件夹拖入 Dock 即固定
- **设置**：dockPosition（含 top）、iconSize、magnification、autoHide、previewDelay、previewSize、showWeather、autoStart、minimizeAnimation、theme、showWindowPreview、showRecentFiles
- **系统图标库**：回收站/下载/文档/图片/音乐/视频/此电脑/天气，右键 Dock 空白区添加
- **系统托盘菜单**：显示/隐藏、设置、关于、退出；单实例锁；多显示器跟随鼠标

### 已知技术债 / 半成品（对标前应清理）

| 问题 | 位置 | 影响 |
|---|---|---|
| `psExec` 同步 spawnSync 阻塞主进程 | `get-system-info`/`get-weather`/`get-battery-info`/`get-processes` | 卡 UI、卡其他 IPC |
| 图标提取两套实现 | `iconCache`（异步）+ `_iconCache2`（Promise） | 冗余，缓存不共享 |
| 渲染层大量轮询（3s/5s/10s/30s/600s） | Dock.tsx / SystemTray.tsx | 空转、IPC 高频、应改主进程推送 |
| 死代码 | `getRecentFiles`、`getActiveWindows`、`searchApps`、`WindowPreview.tsx`、`showRecentFiles` 设置项 | 混淆维护 |
| 放大时 Dock 容器高度固定（76px） | App.css `--dock-height` | 图标放大溢出容器，无 macOS 容器增高效果 |
| 窗口预览用全屏 `desktopCapturer` | main.ts `get-window-thumbnails` | 开销大、非实时、UWP 支持差 |

---

## 二、对标矩阵：原版功能 × 当前实现 × 差距

依据官网功能列表逐项核对：

| # | 原版 MyDockFinder 功能 | 当前实现 | 差距评估 | 优先级 |
|---|---|---|---|---|
| 1 | **WinUI/Mica 模糊**：Win11 云母效果、模糊强度可调 | CSS `rgba` 半透明 + `backdrop-filter`（透明 Electron 窗口上对桌面内容**无效**） | **高**：视觉核心，且强度不可调 | **P0** |
| 2 | **图标拖拽排序**（Dock 内拖动重排，持久化） | 无（仅支持从外部拖入固定） | **高**：macOS Dock 核心交互 | **P0** |
| 3 | **窗口预览**：悬停实时缩略图，支持 UWP，预览大小/延迟可调 | `desktopCapturer` 截图（240×180），按窗口名匹配 | 中：有雏形，性能/实时性/UWP 支持差；`previewSize` 字段已存在但无 UI | **P1** |
| 4 | **消息计数与提示动画**：QQ/微信(UWP)/TIM/钉钉/Discord/旺旺/YY | 标题解析 + UIA，白名单 9 个，**无提示动画** | 中：算法已有雏形，覆盖与反馈效果不足 | **P1** |
| 5 | **天气**：图标实时天气，预览窗口未来天气（多日预报） | 仅 wttr.in 实时温度 + emoji，无预报 | 中 | **P1** |
| 6 | **任务进度**：读系统任务栏进度（复制/浏览器下载/foobar/potplayer） | 窗口标题 `N%` 正则解析 | 中：不可靠，应改 ITaskbarList3 | **P1** |
| 7 | **最小化到 Dock 动画**：3 种效果可选，D3D11 硬件加速 | 1 种（图标飞入），无选择项 | 中 | **P1** |
| 8 | **UWP 应用支持**：启动/图标/预览 | 仅 `.lnk`/`.exe` | 中 | **P1** |
| 9 | **完整文件夹内容**：缩略图、排序方式、二级目录、文件拖出（移动/复制） | 二级目录 ✓；缩略图仅图片；**无排序**、**无文件拖出** | 中低 | **P2** |
| 10 | **文件/文件夹批量拖入 Dock** | 已支持（逐个处理拖入项） | 低：基本对齐，可补批量动画 | **P2** |
| 11 | **右键菜单丰富度**（文件夹：缩略图/排序设置） | 打开/打开位置/固定或移除 | 低 | **P2** |
| 12 | **设置分区**：预览（大小/延迟）、最小化（动画选择）、模糊强度 | 扁平设置项，缺模糊强度、预览大小滑块、最小化动画选择 | 中低 | **P2** |

### 对标结论

- 当前项目已覆盖原版 **约 6/12** 项核心能力的"可用雏形"，但大多停留在"功能存在"而非"体验对齐"。
- 与原版差距最大、且决定"像不像 MyDockFinder"的：
  1. **Dock 视觉（模糊/通透/云母）**——P0，不改则观感差距明显；
  2. **图标拖拽排序**——P0，是 Dock 类工具的基本盘；
  3. **窗口预览的真实性与实时性**——P1，是原版最有辨识度的特性之一。
- 其余差距集中在"数据源可靠性"（任务进度、消息计数）与"设置可调性"（预览、模糊、最小化动画）。

---

## 三、分阶段优化计划

> 每阶段完成需通过验收项；阶段之间可穿插执行，但顺序总体按 P0 → P1 → P2。

### 阶段 0 — 工程基线（清理 + 性能地基）

目标：让后续对标工作建立在干净、不卡顿的代码上。

- [ ] 跑通 `pnpm build` / `pnpm dev` / `pnpm lint`，确认基线无错误
- [ ] 删除死代码：`getRecentFiles`、`getActiveWindows`、`searchApps`、`WindowPreview.tsx`、`showRecentFiles`
- [ ] 合并两套图标缓存实现（`iconCache` + `_iconCache2` → 单一异步缓存）
- [ ] 主进程同步 `psExec`（get-system-info / get-weather / get-battery-info / get-processes）全部改异步 `runPsAsync`
- [ ] 渲染层轮询改主进程推送：running / badges / progress 由主进程定时检测后 `webContents.send`，渲染层仅订阅
- **验收**：主进程无同步阻塞调用；Dock 冷启动首帧到图标完整 < 2s；3s/5s 轮询消失

### 阶段 1 — 对标补齐（原版核心功能对齐）

#### P0-1 Dock 视觉：WinUI 模糊 / Mica / 亚克力
- 调研方案：① koffi 调 `SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)`（Win10 亚克力，整窗生效，成本最低）；② Win11 Mica（DWM）；③ 屏幕捕获 + 模糊重绘（性能差，仅作兜底）
- 设置项新增"模糊强度"滑块（acrylic 的 tint-opacity 参数）
- **验收**：Dock 背景能模糊桌面内容；强度可调；Win10/Win11 双验证

#### P0-2 图标拖拽排序
- Dock 内图标拖拽重排（framer-motion `Reorder` 或自研），排序持久化到 `settings.json`
- 支持固定区内部排序；运行区不参与排序（跟随原版习惯）
- **验收**：拖拽平滑、松手后动画归位、重启后顺序保持

#### P1-1 窗口预览升级（DWM 实时缩略图）
- 调研 `DwmRegisterThumbnail`（koffi）替代 `desktopCapturer`：实时、性能好、支持 UWP
- 设置 UI 补上"预览大小"滑块（`previewSize` 字段已存在）
- **验收**：悬停预览为实时画面（窗口移动/变化时同步）；延迟与大小可调

#### P1-2 消息计数增强
- 白名单扩展：Discord、阿里旺旺、YY 等（对齐原版列表）
- 角标提示动画：新消息时 Dock 图标抖动/红点弹跳（原版"提示效果"）
- **验收**：覆盖应用名单与官网一致；新消息出现动画反馈

#### P1-3 天气升级
- 图标 = 实时天气（wttr.in 已有）；新增悬停预览 = 未来 3 天预报卡片
- **验收**：实时温度与预报两处数据正确展示

#### P1-4 任务进度升级
- 改用 `ITaskbarList3`/`SetProgressValue` 读取真实任务栏进度（koffi），替代标题正则
- 保留标题解析作兜底
- **验收**：浏览器下载、文件复制时 Dock 图标进度条与任务栏同步

#### P1-5 最小化动画扩展
- 新增 2 种动画（如：缩放吸入、Genie 式收尾），设置项"最小化"分区选择
- **验收**：3 种动画可选并生效

#### P1-6 UWP 应用支持
- 开始菜单 UWP 快捷方式（`shell:AppsFolder` 协议）识别、图标提取、启动
- **验收**：UWP 应用出现在 Launchpad/Dock 且可正常启动

### 阶段 2 — 体验精细化（对标细节）

- [ ] 放大联动：hover 放大时 Dock 容器高度随之增长（macOS 经典效果），当前固定 76px 溢出
- [ ] 运行指示器 hover 圆点 → 横线（CSS 已有 `running-indicator-hovered` 未启用）
- [ ] 文件夹增强：缩略图模式（`SHGetFileInfo`/Shell thumbnail）、排序方式、文件拖出到资源管理器
- [ ] 设置界面分区重组：外观 / 预览 / 最小化 / 行为 / 系统（对齐原版设置结构）
- [ ] 浅色主题全面走查（托盘、Launchpad、FolderView 等固定白字场景）
- **验收**：逐项交互与 macOS Dock/原版观感一致

### 阶段 3 — 工程化收尾（可提前穿插）

- [ ] electron-builder 打包配置（NSIS 安装包、应用图标、开机自启注册）
- [ ] 日志与错误上报（`electron-err.txt` 之类的临时文件清理）
- [ ] README 更新：对标进度标注

### 阶段 4 — 自定义升级（用户后续定义，先占位）

> 对标完成后启动。候选方向（待用户确认）：Dock 小部件、快捷指令/剪贴板、主题商店、多屏配置同步等。

---

## 四、执行建议

1. 阶段 0 是**必须先行**的：它同时消除卡顿（同步 psExec）、去噪（死代码），让阶段 1 的改动可测。
2. 阶段 1 建议按 P0-1（视觉）→ P0-2（排序）→ P1 各项顺序推进，每项独立提交、独立验收。
3. 每个 P1 项都含"技术方案调研 → 最小实现 → 验收"三步，不提前做完美主义。
