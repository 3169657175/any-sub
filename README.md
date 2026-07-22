# AGY Hub 桌面管家 (any-sub)

![Electron](https://img.shields.io/badge/Electron-31.0.0-47A248?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Release](https://img.shields.io/badge/Release-v1.0.0-cyan.svg)

**AGY Hub 桌面管家** 是一款专为 Google Antigravity 客户端打造的极客增强桌面端工具，提供**一键极速汉化补丁注入**、**免 TUN 局部模型通信代理**、**Token 消费与缓存监控大屏**、**多账号热瞬切**、**自定义壁纸皮肤**以及 **GitHub Release 自动在线更新** 等全套桌面级增强支持。

---

## ✨ 核心特性

- 🌐 **一键汉化补丁注入**：安全平滑注入最新版 Antigravity 客户端，内置智能化动态日志与 UI 智能拦截引擎，告别白屏与格式失效。
- 🚀 **免 TUN 局部加速代理**：只接管大模型 API 通信，无需全局 TUN 分流，实现高频 AI 对话的极速响应。
- 📊 **Token 消费与缓存监控大屏**：实时可视化统计输入/输出 Token 消耗、缓存命中率，支持基于“本时、本日、本周、本月”的精准过滤与分页复盘。
- 👥 **多账号管理与零延迟热瞬切**：支持多 Google / AGY 账号安全保存，利用 Language Client 守护重连实现 100ms 级别静默热瞬切。
- 🎨 **主题皮肤工坊**：内置哆啦A梦、蜡笔小新、线条小狗等多款极客美学壁纸，支持自由上传自定义壁纸与渐变色调。
- 🔄 **应用内在线自动更新**：集成 `electron-updater`，直接对接 GitHub Release，发现新版本一键后台静默下载并覆盖安装。

---

## 🛠️ 项目结构

```
agy-hub/
├── main.js                  # Electron 主进程 (窗口控制、代理启动、自动更新与 IPC 逻辑)
├── preload.js               # 上下文隔离桥梁 (安全暴露 API)
├── renderer.js              # 前端交互与看板渲染引擎
├── index.html               # 桌面管家主界面 HTML 结构
├── proxy.js                 # 本地大模型代理与流量统计引擎
├── brainMonitor.js          # 本地日志转录监听器
├── assets/                  # 静态资源与汉化源包 (app.asar)
├── patch-workbench/         # 补丁开发与验收安全工作台
└── package.json             # 项目配置与 electron-builder 构建参数
```

---

## 💻 快速开发与构建

### 1. 安装依赖
```bash
npm install
```

### 2. 本地启动
```bash
npm start
```

### 3. 构建 Windows 安装包
```bash
npm run dist:sync
```
执行后会在 `dist/` 目录下生成 `AGY Hub 桌面管家 Setup 1.0.0.exe` 以及自动更新所需的 `latest.yml` 文件。

---

## 🔄 自动更新配置

项目在 `package.json` 中已配置 GitHub 官方 Release 自动更新源：

```json
"publish": [
  {
    "provider": "github",
    "owner": "3169657175",
    "repo": "any-sub"
  }
]
```

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。
