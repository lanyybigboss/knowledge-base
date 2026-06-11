---
title: Agent 长期记忆
category: 记忆
tags: [长期记忆, agent]
created: 2026-06-11
---

# Agent 长期记忆

## 当前项目
**知识库管理系统** (KnowledgeBase)
- 路径: `e:\O1\`
- 版本: v1.7.0
- 技术栈: React 18 + Vite + Electron + Dexie.js + Ollama/DeepSeek

## Agent 使用约定

### 1. 日志系统
- **必须使用** `logger` 单例 (`import logger from './logger'`)
- **禁止** `console.log/error/warn/debug`
- 豁免: `logger.js` 自身和 `electron/` 目录

### 2. AI 分析规则
- `analyzeDocument()` 永不返回 null
- 失败返回 `{ _fallback: true, category: 'other', ... }`
- 降级链: Ollama → DeepSeek → fallback

### 3. 服务模式
- 所有服务导出单例，提供 `start()/stop()` 生命周期

### 4. 编码规范
- ESLint: 0 errors, 0 warnings
- React Hooks: 完整依赖数组
- React 17+: 无需手动 `React`

## 目录结构
```
e:\O1\
├── src/                    # React 源码
│   ├── components/         # UI 组件
│   └── services/           # 服务层
├── electron/               # Electron 主进程
├── data/                   # 用户数据 (206 MB)
└── obsidian-vault/         # Obsidian 笔记库
    └── Obsidian-SecondBrain/  # 第二大脑笔记
```

## 关键文件
- [AGENTS.md](e:\O1\AGENTS.md) - AI 行为规则
- [CLAUDE.md](e:\O1\CLAUDE.md) - 项目约定
- [知识库管理系统-开发文档.md](e:\O1\知识库管理系统-开发文档.md) - 开发记录

## 快捷键
| 快捷键 | 功能 |
|--------|------|
| Ctrl+Shift+K | 快速搜索 |
| Ctrl+Shift+D | AI 调试面板 |
| Ctrl+Shift+L | 日志调试器 |
| F12 | 开发者工具 |
