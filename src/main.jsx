import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import logger from './services/logger'
import { installStorageBridge } from './services/storageBridge'
import './styles/global.css'

// 注册 Storage IPC bridge（v1.7.0 解耦）：
// 让主进程通过标准 IPC 调用渲染进程的 storage 服务
// 替代之前的 executeJavaScript('window.storageService?...') 字符串注入
if (typeof window !== 'undefined' && window.electronAPI) {
  installStorageBridge()
}

// 创建 React 错误边界
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    logger.fatal('React 渲染崩溃', {
      message: error?.message,
      stack: error?.stack?.split('\n').slice(0, 10).join('\n'),
      componentStack: errorInfo?.componentStack?.split('\n').slice(0, 10).join('\n')
    })
    this.setState({ errorInfo })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          maxWidth: 700,
          margin: '40px auto'
        }}>
          <h1 style={{ color: '#F44336', fontSize: 28, marginBottom: 8 }}>⚠️ 应用崩溃</h1>
          <p style={{ color: '#666', marginBottom: 24 }}>发生了严重错误，请尝试重新加载</p>
          <div style={{
            background: '#1a1d23',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            textAlign: 'left',
            color: '#ff6b6b',
            fontFamily: 'monospace',
            fontSize: 13,
            maxHeight: 300,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack?.split('\n').slice(0, 8).join('\n')}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button onClick={() => { localStorage.clear(); window.location.reload() }}
              style={btnStyle('#d32f2f')}>
              清空数据并重载
            </button>
            <button onClick={() => window.location.reload()}
              style={btnStyle('#1976D2')}>
              重新加载
            </button>
          </div>
          <p style={{ color: '#999', marginTop: 24, fontSize: 13 }}>
            如果问题持续，请按 Ctrl+Shift+L 查看日志，或打开开发者工具查看控制台
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

function btnStyle(bg) {
  return {
    padding: '12px 24px',
    fontSize: 15,
    cursor: 'pointer',
    background: bg,
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontWeight: 500
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
