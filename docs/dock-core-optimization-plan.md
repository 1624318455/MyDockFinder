# MyDockFinder Dock 核心 —— 对标分析与优化执行计划（阶段版）

> 对标目标：Windows 平台 [MyDockFinder](https://www.mydockfinder.com) 原版（Steam: app/1787090，C++/WinUI 原生实现）
> 本期范围：**仅深耕 Dock 核心**（不含 MyFinder 系统控制面板，不含创意工坊/皮肤等）
> 交付优先级（用户确认）：**稳定性/修复优先 + 视觉/动画/UI 精细度优先**
> 推进方式（用户确认）：**先落成计划文档，确认后再分批改码**

---

## 〇、基线结论（已完成调研）

### 对标盘点：原版 Dock 能力 × 当前实现

| # | 原版能力 | 当前实现 | 状态 | 差距点 |
|---|---|---|---|---|
| 1 | WinUI/Mica 动态模糊、强度可调 | koffi `SetWindowCompositionAttribute` 亚克力 + Mica 模式、强度/底色/材质可调 | ✅ 已达标 | 强度上限/透明度映射待微调 |
| 2 | 图标拖拽排序（持久化） | framer-motion `Reorder` + `reorderPinnedApps` | ✅ 已实现 | 到手后验证多显示器/排序动画 |
| 3 | 窗口预览（实时缩略图，支持UWP） | `PrintWindow`+GDI 截取，800ms 近似实时 | ✅ 已实现 | 实时性非真「实时」，见下 |
| 4 | 消息计数+提示动画（17应用） | UIA/标题双通道，角标弹跳动画 | ✅ 已实现 | 编排/覆盖待走查 |
| 5 | 天气：图标实时 + 预览未来3天 | wttr.in j1 JSON，图标实时温度 + 悬浮预报卡片 | ✅ 已实现 | — |
| 6 | 任务进度（复制/下载/播放器） | koffi 双通道（标题正则 + `msctls_progress32`）+ 进度条控件 | ✅ 已实现 | **进度与 Dock 同步需加固** |
| 7 | 最小化到 Dock，3种动画（D3D11加速） | fly / genie / scale + 关；时长/缓动可调，独立动画浮窗 | ✅ 已实现 | — |
| 8 | UWP 应用启动/图标 | `Get-StartApps` AUMID + `Get-AppxPackage` 找 44px logo | ✅ 已实现 | 个别系统组件无 logo 用占位 |
| 9 | 文件夹浮窗（缩略图/排序/二级/拖出） | 独立圆角浮窗 + 排序 + Shell thumbnail + `startDrag` 拖出 | ✅ 已实现 | — |
| 10 | 多显示器跟随 | `screen.getDisplayNearestPoint` 跟随鼠标所在屏 | ✅ 已实现 | **边界/吸附/抖动需稳定** |
| 11 | 深/浅主题 | `:root[data-theme]` 变量体系 | ✅ 已实现 | **浅色走查**（托盘/Launchpad/浮窗固定白字） |

**构建/lint 基线**：`pnpm build`（tsc + vite + tsc-electron）通过；`npx oxlint src electron` 0 错误 0 警告。源码为合法 UTF-8（此前终端显示乱码为解码假象，非 bug）。

对照原版**明确的缺失或待打磨**主要落在视觉细节与稳定性，而非功能有无。

---

## 一、本轮优化目标（用户选定重点）

按「稳定性 → 视觉/动画/UI」两级排序落地。本轮分批推进，每批独立提交、独立验收：

- **批次 A：任务进度同步加固** —— 让 Dock 图标进度条与系统任务栏进度实时同步，消除标题正则的不可靠与 koffi 双通道的覆盖盲区。
- **批次 B：放大高度联动** —— hover 放大时 Dock 容器高度随图标增高（macOS 经典效果），当前固定 `--dock-height:76px` 导致放大图标溢出容器、遮挡/截断。这是最直观的观感差距。
- **批次 C：边界 / 多显示器稳定性** —— 屏幕边缘吸附、DPI 缩放、hover 扩容防抖。git 中曾有 revert 掉的 hover 加固（见附录），需以更稳的方式复位并避免抖动循环。
- **批次 D：浅色主题走查** —— 逐屏（Dock、托盘、Launchpad、FolderView、天气/预览浮窗、设置浮层）确认无固定白字在浅色下不可读。

> 说明：以上按照「稳定 → 视觉」都有对应，B/D 偏视觉精细度，A/C 偏稳定性，与用户「两者优先」一致。
> 首批四批之外，仍会有后续（自定义升级、其他打磨），将在批次 D 后规划，本文件先聚焦四批。

---

## 二、批次任务拆分与验收

### 批次 A — 任务进度同步加固

**目标**：Dock 图标进度条与系统任务栏/窗口进度一致且实时。

**现状**：`electron/progress.ts` 每满一圈 `EnumWindows`+`EnumChildWindows` 扫描 `msctls_progress32`，标题正则兜底，5s tick 合并推送。已知痛点：
- 进度条控件一旦消失（如复制完成）返回 0，进度条「闪烁清零」。
- 部分应用（个别播放器/浏览器下载）进度控件非 `msctls_progress32`，回退标题 `N%` 不可靠、易误报。

**任务**：
- [ ] 收集端：读 `PBM_SETPOS/TBM_SETPOSRANGE` 改为稳定采样，增加「迟滞」——进度跳变过大时暂不上报，降低闪烁。
- [ ] 推送端：把 progress 纳入 `lastPushSig` 已做；补「进度归零不立即 push」，待 tick 间隙平滑。
- [ ] Dock 图标端：进度动画入场/退场过渡，避免 0%↔激活闪烁。
- [ ] 回归验证复制文件 / 浏览器下载 / 播放器三场景。

**验收**：连续拖拽进度更新平滑；完成/取消时进度条平滑消失而非闪清零；三场景实测同步 ≤ ~1s。

---

### 批次 B — 悬停放大高度联动

**目标**：hover 放大时容器高度随最大放大图标增长（macOS 经典），放大不再溢出容器、底边被裁。

**现状**：
- `dock-container{ height: var(--dock-height/76px) }`，`--dock-icon-size` 独立。
- 主进程 `dock-content-size/height` 上报当前内容尺寸，窗口收窄为内容宽高；hover 扩容由 `set-dock-hover` 控制 `PREVIEW_SPACE`。

**任务**：
- [ ] 尺寸/高度：`dock-height` 放大后按「最大放大图标尺寸 + padding」动态调整（运行时 clamp，不写死 76px）。
- [ ] 底部/顶部吸附：bottom/top 放大 pull-方向（向上凸出）需 `dock-container` 占位随之增高，让放大图标完整可见。
- [ ] 中部兼容：left/right 纵向 dock 同理增高/handler，避免左右 icon 放大时顶部/底部截断。
- [ ] 缓冲过渡：高度变化用 spring/transition 平滑，避免跳变。

**验收**：设置 max（如 iconSize=96、magnification 最高）后 hover 任意图标，放大完整可见、无溢出、无截断，容器跟随平滑增高。

---

### 批次 C — 边界 / 多显示器稳定性

**目标**：屏幕边缘吸附、DPI、hover 扩容稳定不抖动。

**现状**：
- git `a4c1446` 曾加 hover 扩容吸附边缘 + 双层防抖护栏，后被 `06d8284` revert（疑似引入新问题）。当前 `set-dock-hover` 用 `getDisplayNearestPoint().workArea` 收到边界但不含稳定护栏。
- 多屏：`screen.getDisplayNearestPoint` 跟随鼠标屏；缩放/DPI 变化时 getBounds 计算可能偏移。

**任务**：
- [ ] 重新实现 hover 扩容的边缘吸附（吸收 a4c1446 的价值但更稳），四个方向都用 workArea 对齐，避免扩容后底部/侧边被系统截断。
- [ ] 渲染层双层防抖护栏（enter ignore 重复扩容 / leave debounce 220ms 已在，需补进入态去重）。
- [ ] DPI/display-metrics-changed 后重建 bounds + region + 亚克力。
- [ ] 多屏验证：拖动下垂，左右跨屏，缩放切换。

**验收**：hover 任意边缘/跨屏不抖动、不截断、不上下弹；多屏切换后 Dock 正确吸附与跟随。

---

### 批次 D — 浅色主题走查

**目标**：浅色主题下所有固定白色元素可读。

**现状**：已建立 `:root[data-theme="light"]` 变量，Dock/托盘部分已跟随。但 `DockItem`/`SystemTrayTooltip`/`FolderViewItem`/`window-preview-title`/`dock-tooltip`、`Launchpad` 底部 close、设置 input/border 等仍可能硬编码 `#fff`/`rgba(255,…)`。

**任务**：
- [ ] 全盘 grep `rgba(255` / `#fff` / `color:"#fff"`，逐一改为变量或主题条件。
- [ ] DockItem tooltip 阴影/边框、weather/预览浮层底色浅色调整。
- [ ] 托盘在浅色下的文字对比度校验。
- [ ] 用手动切浅色全状态走查，输出对比度截图清单。

**验收**：切浅色主题后 Dock/所有浮层文字可读、对比度达标、无灰白不可见元素。

---

## 三、执行与提交约定

- 每批独立提交，commit message 遵循既有风格：`fix: …` / `feat: …` / `docs(release)`。
- 每批改码前先复跑 `pnpm build` + `npx oxlint`；提交前再次确认基线绿。
- 涉及主进程（native）改动，用 `pnpm dev` 手动点验三屏 + 浅/深主题。

## 四、遗留 / 后续（批次 D 后规划，本期不排入）

- LaunchpadPath 真实图标、Library…（原版有完整应用网格图标）——当前 Launchpad 用 CSS 渐变色块兜底，非真实图标。
- 设置面板功能补齐（预览大小已可由 slider 控制；模糊强度已可调）。
- 自定义升级：小部件/快捷指令/主题商店等（用户后续定义）。

---

## 附：对标资料来源
- 官网中文/英文：https://www.mydockfinder.com（正文与交互数）
- Steam：https://store.steampowered.com/app/1787090/（官方功能列表；**注意 appid 1418420 是另一款游戏，非本 app**）
- 原版技术基盘：需 DirectX 11、.NET 4.8、VC++2019；Win10 1809+/Win11。