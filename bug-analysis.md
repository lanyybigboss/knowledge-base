# 知识库管理系统后台分析与 OCR 故障分析报告

本报告针对后台日志中暴露出的文件解析、OCR 提取及本地 AI 模型（Ollama）调用中出现的 4 处核心 Bug 进行原因总结，并给出了具体的代码修改方案。

---

## 🛑 问题一：Web Worker 跨域安全限制导致 PDF/OCR 彻底崩溃

### 1. 原因总结
* **日志表现**：`Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'file:///E:/tesseract-worker.min.js' failed to load.`
* **底层原理**：在 Electron 架构中，PDF 解析和 Tesseract.js 通常会启用 Web Worker（网页多线程）来避免卡死主界面。然而，受浏览器原生的安全策略（CSP）限制，Worker 内部的 `importScripts()` **无法通过 `file:///` 协议加载本地盘符下的绝对路径脚本**，导致执行到此处的 PDF 和图片全部解析中断。

### 2. 解决方法（推荐方案 A）
* **方案 A（修改 Worker 路径配置）**：
  在初始化 Tesseract Worker 或 PDF.js Worker 时，不要传递本地绝对路径，应将其作为静态资源打包进 `dist` 目录，并使用**相对路径**或 Electron 的**自定义协议路径**（如 `app://`）。
  ```javascript
  // 示例：修改 Tesseract 初始化的配置
  const worker = await createWorker({
    workerPath: './node_modules/tesseract.js/dist/worker.min.js', // 确保指向打包内的相对路径
    corePath: './node_modules/tesseract.js-core/tesseract-core.wasm.js',
  });
  ```
* **方案 B（临时放开 Electron 安全限制，用于快速测试）**：
  在主进程创建窗口（`BrowserWindow`）的 `webPreferences` 中，暂时关闭 `webSecurity` 限制。
  ```javascript
  const mainWindow = new BrowserWindow({
    webPreferences: {
      webSecurity: false, // 允许跨域加载本地 file 协议脚本
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  ```

---

## 🛑 问题二：Ollama 返回的非标准 JSON 导致解析异常与字段校验失败

### 1. 原因总结
* **日志表现**：
  * `JSON 语法错误... Bad control character in string literal in JSON`
  * `字段校验未通过 (缺少有效摘要 summary/detailedSummary 为空或缺失)`
* **底层原理**：代码要求 Ollama 返回一个严格的 JSON 结构（包含 `summary` 等字段）。但本地大模型在生成长文本时，经常会在字符串中夹带**未转义的换行符（`\n`）**、制表符，或者在 JSON 数组/对象的末尾**多输出一个逗号**。这会导致前端的 `JSON.parse()` 崩掉，进而导致系统认为“摘要为空”。

### 2. 解决方法
* **步骤 1：向 Ollama 开启严格 JSON 模式**
  在调用 Ollama API 的请求体中，显式加入 `"format": "json"` 属性，强迫本地大模型底层只输出标准 JSON。
  ```json
  {
    "model": "your-model",
    "prompt": "...",
    "format": "json" // 核心：强制开启 Ollama 的 JSON Mode
  }
  ```
* **步骤 2：前端解析加入容错清洗逻辑**
  在 `JSON.parse(rawText)` 之前，先用正则剔除掉控制字符，或者使用 `try-catch` 捕获异常并进行重试/修复。
  ```javascript
  function safeParseJSON(rawText) {
    try {
      // 移除可能导致 JSON 报错的控制字符（如未转义的换行）
      const cleaned = rawText.replace(/[\u0000-\u001F]+/g, "");
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn("JSON 格式不规范，尝试清洗后重试", e);
      return null;
    }
  }
  ```

---

## 🛑 问题三：本地推理耗时过长，触发前端 AbortController 超时掐断

### 1. 原因总结
* **日志表现**：`[Ollama] 请求失败... Data: signal is aborted without reason`
* **底层原理**：当前端通过 `fetch` 或 `axios` 请求本地 Ollama 时，配置了 `AbortController`（信号中止控制器）来做超时处理（比如设为了 30 秒或 60 秒）。当系统批量分析大体积文档时，由于本地设备显存或算力限制，Ollama 推理时间超过了这一阈值，前端便在后台“自动拔线”，强制中断了请求。

### 2. 解决方法
针对本地 Ollama 请求，**单独延长超时时间或直接取消超时限制**。
```javascript
// 示例：修改 fetch 请求的 signal 配置
const controller = new AbortController();

// 针对本地 Ollama 请求，可以把超时时间延长到 180 秒（3分钟）或者直接不设超时
const timeoutId = setTimeout(() => controller.abort(), 180000); 

try {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    signal: controller.signal, // 绑定调大后的信号
    body: JSON.stringify(payload)
  });
  clearTimeout(timeoutId);
  // ... 后续处理
} catch (error) {
  if (error.name === 'AbortError') {
    console.error("本地 Ollama 响应超时，请检查显存占用或调大超时阈值");
  }
}
```

---

## 🛑 问题四：降级逻辑在未配置 API Key 时引发二次锁死

### 1. 原因总结
* **日志表现**：`[Ollama] 请求失败，正在切换 DeepSeek -> [AI] 调用完全失败 (no-api-key) 放弃解析内容`
* **底层原理**：代码中设计了很棒的容错 fallback 机制（本地 Ollama 挂掉后自动向云端 DeepSeek 发起请求）。但由于测试环境**特意没有配置云端 DeepSeek 的 API Key**，导致触发降级时，代码直接因为缺少 Key 发生了未捕获的二次报错，直接卡死。

### 2. 解决方法
修改降级逻辑的入口，**前置检查 API Key 是否存在**。如果不存在，则优雅地终止并提示“本地模型繁忙”，绝不强行发起空的网络请求。
```javascript
async function analyzeFileWithFallback(fileData) {
  try {
    // 1. 尝试使用本地 Ollama 
    return await analyzeWithOllama(fileData);
  } catch (ollamaError) {
    console.warn("[Ollama] 失败或超时，检查是否满足降级条件");

    // 2. 拦截检查：如果没配 Key，直接优雅退出，不浪费流量也不引发二次崩溃
    if (!process.env.DEEPSEEK_API_KEY && !global.config?.deepseekKey) {
      console.warn("[AI] 未检测到云端 API Key，跳过降级逻辑。文件将标记为：本地解析超时");
      throw new Error("LOCAL_MODEL_BUSY_NO_FALLBACK");
    }

    // 3. 有 Key 的情况下才走降级
    try {
      return await analyzeWithDeepSeek(fileData);
    } catch (deepseekError) {
      console.error("[AI] 云端降级渠道也失败了", deepseekError);
      throw deepseekError;
    }
  }
}
```