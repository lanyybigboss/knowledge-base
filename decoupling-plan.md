# 知识库管理系统（Electron+React）深度解耦重构方案

本方案旨在解决系统在批量分析文件时出现的界面卡死、OCR 路径失效、大模型请求超时等架构设计问题，将项目重构成“高内聚、低耦合”的商业级桌面应用。

---

## 🏗️ 整体解耦架构图

重构后的系统将彻底阻断渲染进程与高能耗任务的直接联系，划分为明确的三层：



1. **UI 渲染层 (React/Vite)**：只负责界面展示，通过 IPC 触发任务，不运行任何 Node.js API。
2. **控制与路由层 (Electron Main)**：负责生命周期、窗口管理、IPC 消息分发、调度进程。
3. **高能耗执行层 (Node.js Child Process / Worker)**：常驻或动态启动的子进程，专门负责文件扫描、PDF 文本解析、Tesseract OCR、Ollama 交互。

---

## 🛠️ 具体重构实施建议

### 1. 核心解耦：建立独立后台分析子进程 (Background Workhorse)
将 `BackgroundAnalysis` 彻底从主线程中抽离。

* **实施方法**：在 `electron/` 目录下新建一个 `analyzer.js`（或 `.ts`）脚本。在主进程中利用 `child_process.fork` 启动它。
* **重构后主进程代码示例**：
  ```javascript
  // electron/main.js
  const { fork } = require('child_process');
  const path = require('path');

  let analyzerProcess = null;

  function initAnalyzer() {
    // 启动独立的后台分析子进程
    analyzerProcess = fork(path.join(__dirname, 'analyzer.js'));

    // 监听子进程传回的分析进度和结果
    analyzerProcess.on('message', (message) => {
      const { type, data } = message;
      if (type === 'PROGRESS') {
        // 通知前端刷新进度条
        mainWindow.webContents.send('analysis-progress', data);
      } else if (type === 'RESULT') {
        // 存入数据库或通知前端
        mainWindow.webContents.send('analysis-success', data);
      }
    });
  }
  ```
* **效益**：Worker 线程和 OCR 脚本在独立进程中加载，不仅完美解决了 `importScripts` 无法加载 `file:///` 的路径安全问题，还能保证后台算力吃满时，前台 React 依旧保持 60 帧丝滑不卡顿。

---

### 2. 模型解耦：构建服务适配器 (Adapter Pattern)
彻底剥离业务逻辑（如文件保存、卡片生成）里硬编码的 `fetch('Ollama')` 逻辑。

* **实施方法**：构建一个 `LLMProvider` 统一接口，实现 `OllamaAdapter` 和 `DeepSeekAdapter`。
* **重构后代码结构**：
  ```javascript
  // src/services/ai/base.js
  class BaseAIAdapter {
    async generateSummary(text) { throw new Error("Not implemented"); }
  }

  // src/services/ai/ollama.js
  class OllamaAdapter extends BaseAIAdapter {
    async generateSummary(text) {
      // 1. 强制开启 format: "json"
      // 2. 配置 180 秒超长超时
      // 3. 返回清洗后的标准 JSON
    }
  }

  // src/services/ai/manager.js
  class AIManager {
    constructor() {
      this.provider = new OllamaAdapter(); // 默认本地模型
    }
    
    async getSummary(text) {
      try {
        return await this.provider.generateSummary(text);
      } catch (err) {
        // 在这里统一判断是否有外网 Key，无 Key 则不走降级，优雅拦截
        if (!hasCloudKey()) {
          throw new Error("LOCAL_MODEL_TIMEOUT_NO_FALLBACK");
        }
        // 有 Key 才切换到云端驱动
        return await this.cloudProvider.generateSummary(text);
      }
    }
  }
  ```

---

## 🎯 针对 Claude-lab 项目的重构推进步骤

当你本地保存好此文件，并进入 `release-build` 干净环境后，建议让 Claude 按以下顺序**逐步、分批**进行重构，切忌一口气全改导致无法 Debug：

1. **第一步（解耦 AI 驱动）**：让 Claude 把大模型请求封装进统一的 `LLMService`。优先解决 **JSON 强制格式化** 和 **超时参数调优**，确保 Ollama 跑得稳。
2. **第二步（解耦后台任务）**：让 Claude 创建 `analyzer.js` 子进程，把原项目里的批量文件扫描、PDFjs、Tesseract 逻辑平移进去，并建立 `process.send()` 通信机制。
3. **第三步（打通 IPC 管道）**：在 Electron 主进程中桥接 React 前端与后台子进程，清除前端一切对 Node 核心库的直接依赖。