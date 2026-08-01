# MyDockFinder

macOS Dock 增强工具（Windows）。对标 MyDockFinder 原版应用，提供任务栏增强、应用管理、系统监控与 Dock 美学体验。

## 功能特性

- **Dock 应用栏**：运行中应用实时显示 + 固定应用，图标 hover 弹簧放大（可调强度），支持拖拽排序持久化
- **真实亚克力模糊背景**：Win32 `SetWindowCompositionAttribute` 直接合成（非 CSS 模拟），tint 跟随深浅主题，强度可调，GDI 圆角裁切
- **窗口预览**：hover 图标显示实时窗口缩略图（进程精确匹配 + GDI 截取）
- **消息计数**：微信/QQ/企业微信/飞书/Teams/WhatsApp/Outlook 等 17 个应用未读角标，新消息弹跳提示
- **任务进度**：文件复制/下载/播放器真实进度（koffi 双通道：标题正则 + 进度条控件 `PBM_GETPOS`）
- **天气**：实时天气图标 + 未来 3 天预报（wttr.in）
- **最小化动画**：3 种可选（飞入 Dock / Genie 吸入 / 缩放吸入）
- **UWP 应用支持**：商店应用识别、图标提取、启动（`Get-StartApps` + Appx 资源）
- **文件夹浏览**：Dock 文件夹面板（缩略图、排序、文件拖出到桌面）
- **系统托盘**：时钟、电量、天气、快捷菜单
- **多显示器**：Dock 跟随鼠标所在显示器
- **深浅主题**：跟随系统或手动指定

## 技术栈

Electron 43 · React 19 · TypeScript · Vite 8 · Zustand · framer-motion · koffi（Win32 直调）

架构要点：

- 主进程模块化：`main.ts`（入口/窗口/IPC）、`acrylic.ts`（亚克力）、`preview.ts`（窗口预览）、`progress.ts`（任务进度）、`icons.ts`（图标缓存）、`uwp.ts`（商店应用）、`ps.ts`（PowerShell 异步封装）、`log.ts`（日志）
- 全部主进程阻塞调用异步化（无 `execSync`/`spawnSync`），PowerShell 通过 `runPsAsync`（UTF-16 编码命令）执行
- 运行状态由主进程统一推送（5s tick，diff 后 `dock-state` 事件），渲染层零轮询
- koffi 类型注册采用幂等模式（`try type → catch define`），避免多模块重复注册

## 开发

```bash
pnpm install
pnpm dev        # 开发模式（vite HMR + electron）
pnpm build      # 类型检查 + 渲染构建 + 主进程编译
pnpm lint       # oxlint
```

## 打包

```bash
pnpm dist       # NSIS 安装包 + Portable 便携版（release/）
pnpm dist:dir   # 仅解包目录（快速验证）
```

打包产物：`MyDockFinder-<version>-win32-x64.exe`（安装器）与 `...-portable.exe`（便携版）。
应用图标由 `scripts/gen-icon.mjs` 生成（macOS Dock 风格）。

## 数据与日志

- 设置与固定应用：`%APPDATA%\mydockfinder\settings.json`
- 运行日志：`%APPDATA%\mydockfinder\logs\main.log`（2MB 自动轮转）

## 常见问题

- **亚克力背景不生效**：仅 Windows 10 1809+ / 11 支持；失败时自动降级为 CSS 半透明背景（见日志）
- **UWP 应用图标缺失**：部分系统组件（如 Game Bar）Assets 无 44px logo，显示占位图标
- **开发模式白屏**：确认 `pnpm dev` 的 vite 先于 electron 就绪（`wait-on` 已处理）
