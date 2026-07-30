# MyDockFinder - macOS Dock 增强工具

基于 Electron + React + TypeScript + Vite 构建的 macOS Dock 增强工具，灵感来源于 Windows 平台上的 [MyDockFinder](https://www.mydockfinder.com)。

## 功能

- **精美 Dock 栏** — 仿 macOS 风格的悬浮 Dock，支持图标悬停放大、运行指示器
- **应用启动器** — 自动检测 /Applications 目录中的应用，点击启动
- **Launchpad** — 全屏应用网格，快速浏览和搜索所有应用
- **文件夹浏览** — 悬停文件夹图标显示内容网格，支持深入浏览子目录
- **系统托盘** — 时钟、日期、天气显示、快速菜单
- **偏好设置** — 外观、行为、系统设置面板
- **系统托盘图标** — 菜单栏图标，支持右键菜单（显示/隐藏、偏好设置、退出）

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳层 | Electron 43 |
| UI 框架 | React 19 + TypeScript 6 |
| 构建工具 | Vite 8 |
| 状态管理 | Zustand 5 |
| 原生桥接 | Electron IPC + contextBridge |

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式（Vite热更新 + Electron）
pnpm dev

# 生产构建
pnpm build

# 直接启动 Electron（开发）
pnpm electron:dev
```

## 项目结构

```
MyDockFinder/
├── electron/           # Electron 主进程
│   ├── main.ts         # 主进程入口（窗口、系统托盘、IPC）
│   ├── preload.ts      # 预加载脚本（暴露安全 API）
│   └── tsconfig.json
├── src/                # 渲染进程（React）
│   ├── components/     # UI 组件
│   │   ├── Dock.tsx        # Dock 主容器
│   │   ├── DockItem.tsx    # Dock 图标项
│   │   ├── SystemTray.tsx  # 系统托盘（时钟、天气）
│   │   ├── FolderView.tsx  # 文件夹内容浏览器
│   │   ├── Launchpad.tsx   # 应用启动网格
│   │   └── Settings.tsx    # 偏好设置面板
│   ├── store/          # 状态管理
│   ├── types/          # TypeScript 类型定义
│   ├── App.tsx         # 根组件
│   └── main.tsx        # 入口文件
├── public/             # 静态资源
├── index.html
├── vite.config.ts
└── package.json
```

## 架构

```
┌─────────────────────────────────────────────┐
│                Electron Main                 │
│  (Window Mgmt / Tray / IPC Handlers)        │
├─────────────────────────────────────────────┤
│                Preload Script                │
│  (contextBridge: getRunningApps, openApp...) │
├─────────────────────────────────────────────┤
│                Renderer (Vite+React)         │
│  (Dock UI / Launchpad / FolderView / Tray)  │
└─────────────────────────────────────────────┘
```
