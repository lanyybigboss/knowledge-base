# E:\O1 - 知识库管理系统 项目约定

## 技术栈
- **前端框架**: React 18 + Vite
- **路由**: React Router v6
- **本地存储**: Dexie.js (IndexedDB: KnowledgeBaseDB)
- **桌面端**: Electron (主进程 `electron/main.js`, 预加载 `electron/preload.js`)
- **AI 服务**: Ollama (qwen2.5:3b) + DeepSeek API 双通道
- **组件库**: 原生 CSS（无第三方 UI 框架）
- **OCR**: tesseract.js v7, PDF 解析: pdfjs-dist, DOCX: mammoth

## 编码约定

### 1. 日志系统
**禁止使用 console.log/error/warn/debug**，必须使用 `logger` 单例：
```js
import logger from './logger'  // or '../services/logger'
logger.info('消息', optionalData)
logger.error('错误', optionalData)
logger.warn('警告', optionalData)
```
> 例外：`logger.js` 自身内部的 `_log()` 方法保留 `console.*` 调用（作为日志输出机制）。

### 2. AI 分析降级策略 (_fallback 标志)
`analyzeDocument()` **永不返回 null**。成功返回分析结果对象，失败返回 `{ _fallback: true, category: 'other', ... }`。

**调用方模式**：
```js
const result = await analyzeDocument(content, title, fileName)
if (result._fallback) {
  // 降级：不覆盖已有分析数据，只标记 aiAnalyzed: true
  await updateDocument(doc.id, { aiAnalyzed: true })
} else {
  // 正常：使用完整分析结果更新
  await updateDocument(doc.id, { ...result, aiAnalyzed: true })
}
```

### 3. Ollama 双通道策略
- 优先尝试 Ollama (qwen2.5:3b)，直接调 REST API（不依赖 OpenAI SDK）
- Ollama 不可用时降级到 DeepSeek API
- DeepSeek 也不可用时返回 `_fallback: true` 降级结果
- 健康检查 30 秒 TTL，并发请求去重

### 4. 服务层模式
所有服务导出单例，提供 `start()/stop()` 生命周期管理：
- `backgroundAnalysisService.start()` / `.stop()` — 后台 AI 分析
- `syncService.start()` / `.stop()` — 跨模式数据同步
- `taskQueueService` — 任务队列（注册处理器+入队）

### 5. 存储层
- **数据库**: IndexedDB `KnowledgeBaseDB`，3 张表：`documents`, `categories`, `kvStore`
- **storageService.init()** — 首次启动从 localStorage 迁移到 IndexedDB
- **批量替换**: `replaceAllDocuments(docs)` / `replaceAllCategories(cats)` 用于同步操作

### 6. 后台分析参数
| 参数 | 值 |
|------|-----|
| 扫描间隔 | 30 秒 |
| 首次触发延迟 | 5 秒 |
| 跳过阈值 | < 20 字符 |
| 分析超时 | 120 秒 |
| 每轮最多处理 | 3 个文档 |

### 7. 跨模式同步
- 脏标志 + 2 秒节流推送
- 5 秒轮询拉取
- 时间戳比较决定推送/拉取方向
- Vite 模式: HTTP `/api/sync/*`
- Electron 模式: IPC `sync-write/read/timestamp`

## 目录结构
```
src/
├── components/
│   ├── DocumentDetail/    # 文档详情页
│   ├── Upload/            # 上传页（拖拽+AI分析）
│   └── Common/            # 通用组件（Modal 等）
├── services/
│   ├── storageService.js           # Dexie.js CRUD
│   ├── aiService.js                # Ollama + DeepSeek 双通道
│   ├── backgroundAnalysisService.js # 后台 AI 调度
│   ├── syncService.js              # 跨模式数据同步
│   ├── logger.js                   # 日志系统（单例）
│   ├── AppContext.jsx              # 全局状态管理
│   ├── apiService.js               # 统一 API（HTTP/IPC 双模式）
│   └── folderWatcherService.js     # 文件夹监控
├── utils/
│   ├── constants.js
│   └── helpers.js
└── electron/
    ├── main.js            # Electron 主进程
    └── preload.js         # 预加载脚本
```
