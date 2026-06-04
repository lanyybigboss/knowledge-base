/**
 * 文档详情页面 - 显示 AI 深度分析结果
 * 支持打开文件、定位文件位置
 */

import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { formatFileSize, formatDate, getFileTypeInfo } from '../../utils/helpers'
import { PRESET_CATEGORIES } from '../../utils/constants'
import logger from '../../services/logger'
import { analyzeDocument, hasApiKey, isOllamaAvailable } from '../../services/aiService'
import apiService from '../../services/apiService'
import storageService from '../../services/storageService'
import Modal from '../Common/Modal'
import './DocumentDetail.css'

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { documents, updateDocument, deleteDocument, toggleStar, showNotification, loadData } = useApp()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  /**
   * 从 PDF 提取文本（用于现有文档重新AI分析）
   */
  async function extractPdfTextFromFile(filePath) {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      
      // 通过 fetch 获取本地 PDF 文件
      const response = await fetch(filePath)
      const arrayBuffer = await response.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      let fullText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map(item => item.str).join(' ')
        fullText += pageText + '\n'
      }
      return fullText.trim()
    } catch (e) {
      logger.warn('PDF 文本提取失败:', e)
      return ''
    }
  }

  /**
   * AI 重新分析文档
   */
  const handleReAnalyze = async () => {
    const ollamaReady = await isOllamaAvailable()
    if (!ollamaReady && !hasApiKey()) {
      showNotification('error', '请先启动 Ollama 或在设置页面配置 DeepSeek API Key')
      return
    }

    setAnalyzing(true)
    setAnalyzeError('')

    try {
      let content = doc.content || ''
      const ext = (doc.fileName || doc.title || '').split('.').pop()?.toLowerCase()

      // 如果内容为空或是占位符（旧 PDF 上传时保存的提示文字），尝试从本地文件提取
      const isPlaceholder = content.startsWith('[') && content.includes('打开查看')
      if ((!content || isPlaceholder) && doc.localFilePath && ext === 'pdf') {
        showNotification('info', '正在提取 PDF 文本...')
        content = await extractPdfTextFromFile(doc.localFilePath)
      }

      // 仍然没有有效内容
      if (!content || content.trim().length < 10) {
        setAnalyzeError('该文档无可分析的文本内容（可能是扫描件PDF或二进制文件）')
        showNotification('error', '无法分析：文档无文本内容')
        setAnalyzing(false)
        return
      }

      showNotification('info', '正在调用 AI 分析...')
      const baseName = (doc.fileName || doc.title || '').replace(/\.[^/.]+$/, '')
      const result = await analyzeDocument(content, baseName, doc.fileName || doc.title)

      if (result._fallback) {
        // AI 分析降级：标记已尝试但不覆盖已有结果
        const retryCount = (doc._aiRetryCount || 0) + 1
        await updateDocument(doc.id, { _aiRetryCount: retryCount })
        showNotification('warning', `AI 分析失败（第 ${retryCount} 次），已有分析结果已保留`)
        setAnalyzing(false)
        return
      }

      // 写入前最终安全校验：确认摘要/关键词有实质内容
      const hasValidSummary = (result.summary || '').replace(/[\s\u3000]/g, '').length >= 3
      const hasValidKeywords = (result.keywords || []).length >= 1
      if (!hasValidSummary && !hasValidKeywords) {
        const retryCount = (doc._aiRetryCount || 0) + 1
        await updateDocument(doc.id, { _aiRetryCount: retryCount })
        showNotification('warning', `AI 返回结果无效（第 ${retryCount} 次），已有分析结果已保留`)
        setAnalyzing(false)
        return
      }

      // AI成功 → JSON合法 → 字段校验 → 写入summary/tags → 最后 aiAnalyzed=true
      await updateDocument(doc.id, {
        summary: result.summary,
        detailedSummary: result.detailedSummary,
        keywords: result.keywords,
        tags: result.tags,
        entities: result.entities,
        category: result.category,
        aiAnalyzed: true  // ← 最后才设 aiAnalyzed
      })

      showNotification('success', 'AI 重新分析完成！')
      await loadData() // 重新加载数据以刷新 UI（保留搜索/筛选/队列状态，不再暴力刷新页面）
    } catch (error) {
      logger.error('AI 重新分析失败:', error)
      setAnalyzeError(error.message)
      showNotification('error', `AI 分析失败: ${error.message}`)
    } finally {
      setAnalyzing(false)
    }
  }

  /**
   * 重试 AI 分析（重置状态，让后台服务重新分析）
   */
  const handleRetryAiAnalysis = async () => {
    if (!window.confirm('确定要重置此文档的 AI 分析状态吗？\n\n重置后，文档将在下次扫描时重新尝试 AI 分析。')) {
      return
    }

    try {
      showNotification('info', '正在重置 AI 分析状态...')
      await storageService.resetAiAnalysis(doc.id)
      showNotification('success', '✅ AI 分析状态已重置，将在下次扫描时重新分析')
      await loadData() // 重新加载数据以刷新 UI
    } catch (err) {
      logger.error('[DocumentDetail] 重置 AI 分析状态失败:', err)
      showNotification('error', `重置失败: ${err.message || '未知错误'}`)
    }
  }

  const doc = documents.find(d => d.id === id)

  if (!doc) {
    return (
      <div className="empty-state" style={{ padding: '80px 0' }}>
        <div className="empty-state-icon">🔍</div>
        <div className="empty-state-title">文档未找到</div>
        <div className="empty-state-description">该文档可能已被删除或不存在</div>
        <button
          className="btn btn-primary"
          style={{ marginTop: '16px' }}
          onClick={() => navigate('/documents')}
        >
          返回文档列表
        </button>
      </div>
    )
  }

  const typeInfo = getFileTypeInfo(doc.fileName || doc.title)
  const getCategoryName = (catId) => {
    const preset = PRESET_CATEGORIES.find(c => c.id === catId)
    return preset ? preset.name : catId
  }
  const getCategoryColor = (catId) => {
    const preset = PRESET_CATEGORIES.find(c => c.id === catId)
    return preset ? preset.color : '#6b7280'
  }

  const handleDelete = () => {
    deleteDocument(doc.id)
    setShowDeleteModal(false)
    navigate('/documents')
  }

  const handleSave = () => {
    updateDocument(doc.id, editForm)
    setIsEditing(false)
  }

  const startEditing = () => {
    setEditForm({
      title: doc.title,
      summary: doc.summary,
      keywords: doc.keywords,
      tags: doc.tags
    })
    setIsEditing(true)
  }

  /**
   * 打开文件 - 使用系统默认程序打开本地文件
   * 支持 .strm 引用文件自动解析为原始文件路径
   */
  const handleOpenFile = async () => {
    const filePath = doc.localFilePath
    
    if (!filePath) {
      showNotification('error', '文件未保存到本地，请重新上传')
      return
    }
    
    try {
      // 如果是 .strm 引用文件，先解析原始路径
      let targetPath = filePath
      if (doc.isStrmRef || filePath.toLowerCase().endsWith('.strm')) {
        const strmData = await apiService.readStrmFile(filePath)
        if (strmData.success && strmData.originalPath) {
          targetPath = strmData.originalPath
          logger.info(`[Strm 解析] ${filePath} → ${targetPath}`)
        } else {
          showNotification('warning', '引用文件已失效，将尝试直接打开')
        }
      }
      
      const data = await apiService.openFile(targetPath)
      if (data.success) {
        showNotification('success', doc.isStrmRef
          ? `已用系统默认程序打开原始文件`
          : `已用系统默认程序打开文件`)
      } else {
        showNotification('error', `打开文件失败: ${data.error}`)
      }
    } catch (e) {
      showNotification('error', `打开文件失败: ${e.message}`)
    }
  }

  /**
   * 定位到文件位置 - 在文件管理器中显示
   * 如果是 .strm 引用文件，定位到原始文件位置
   */
  const handleLocateFile = async () => {
    const filePath = doc.localFilePath
    
    if (!filePath) {
      showNotification('error', '文件未保存到本地，请重新上传')
      return
    }
    
    try {
      // 如果是 .strm 引用文件，解析原始路径
      let targetPath = filePath
      if (doc.isStrmRef || filePath.toLowerCase().endsWith('.strm')) {
        const strmData = await apiService.readStrmFile(filePath)
        if (strmData.success && strmData.originalPath) {
          targetPath = strmData.originalPath
        }
      }
      
      const data = await apiService.locateFile(targetPath)
      if (data.success) {
        showNotification('success', `已定位到文件位置`)
      } else {
        showNotification('error', `定位文件失败: ${data.error}`)
      }
    } catch (e) {
      showNotification('error', `定位文件失败: ${e.message}`)
    }
  }

  // 获取实体信息
  const entities = doc.entities || { people: [], organizations: [], locations: [], dates: [] }

  return (
    <div className="document-detail">
      <div className="document-detail-header">
        <button className="btn btn-ghost" onClick={() => navigate('/documents')}>
          ← 返回列表
        </button>
      </div>

      <div className="document-detail-content">
        {/* 左侧主内容 */}
        <div className="document-detail-main">
          <div className="card">
            <div className="document-detail-top">
              <span className="document-detail-type-icon">{typeInfo.icon}</span>
              <div className="document-detail-title-section">
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                    className="document-detail-title-input"
                  />
                ) : (
                  <h1 className="document-detail-title">{doc.title}</h1>
                )}
                <div className="document-detail-meta">
                  {doc.docNumber && (
                    <span className="badge badge-primary">{doc.docNumber}</span>
                  )}
                  <span
                    className="document-detail-category"
                    style={{ color: getCategoryColor(doc.category) }}
                  >
                    {getCategoryName(doc.category)}
                  </span>
                  <span>{typeInfo.label}</span>
                  <span>{formatFileSize(doc.fileSize)}</span>
                  {doc.aiAnalyzed && <span className="badge badge-primary">AI 分析</span>}
                </div>
              </div>
            </div>

            <div className="document-detail-actions">
              <button
                className={`btn btn-ghost btn-sm ${doc.starred ? 'starred' : ''}`}
                onClick={() => toggleStar(doc.id)}
              >
                {doc.starred ? '⭐ 已星标' : '☆ 标记星标'}
              </button>
              {isEditing ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={handleSave}>
                    💾 保存
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={startEditing}>
                  ✏️ 编辑
                </button>
              )}
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setShowDeleteModal(true)}
              >
                🗑️ 删除
              </button>

              {/* AI 分析失败时的重试按钮 */}
              {!doc.aiAnalyzed && (doc._aiRetryCount >= 3 || doc._aiRetryCount === 99) && (
                <button
                  className="btn btn-warning btn-sm"
                  onClick={handleRetryAiAnalysis}
                  disabled={analyzing}
                >
                  {analyzing ? '⏳ 重试中...' : '🔄 重试 AI 分析'}
                </button>
              )}
            </div>
          </div>

          {/* 文件操作栏 */}
          <div className="card">
            <div className="document-detail-file-actions">
              <button className="btn btn-primary" onClick={handleOpenFile}>
                📂 打开文件
              </button>
              <button className="btn btn-secondary" onClick={handleLocateFile}>
                📁 定位文件位置
              </button>
              <span className="document-detail-file-path">
                {doc.fileName || `${doc.title}.${doc.fileType || 'txt'}`}
                {doc.isStrmRef && (
                  <span className="badge badge-warning" style={{ marginLeft: '8px', fontSize: '0.7rem' }}>
                    🔗 引用
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* 详细摘要（论文摘要格式） */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                📝 内容摘要
              </h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleReAnalyze}
                disabled={analyzing}
                title="调用 AI 重新分析文档内容"
              >
                {analyzing ? '⏳ 分析中...' : '🤖 AI 重新分析'}
              </button>
            </div>
            {analyzeError && (
              <div className="document-detail-error" style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '8px' }}>
                ⚠️ {analyzeError}
              </div>
            )}
            {doc.detailedSummary ? (
              <div className="document-detail-detailed-summary" style={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}>
                {doc.detailedSummary}
              </div>
            ) : doc.summary ? (
              <p className="document-detail-summary">{doc.summary}</p>
            ) : (
              <div>
                <p className="document-detail-empty-text">暂无摘要</p>
                {!analyzing && !analyzeError && (
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: '8px' }}>
                    点击上方「AI 重新分析」按钮，为本文档生成 AI 摘要
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 提取的实体信息 */}
          {(entities.people.length > 0 || entities.organizations.length > 0 || entities.locations.length > 0) && (
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>
                🎯 提取的信息
              </h3>
              <div className="document-detail-entities">
                {entities.people.length > 0 && (
                  <div className="document-detail-entity-group">
                    <span className="document-detail-entity-label">👤 人物</span>
                    <div className="document-detail-entity-tags">
                      {entities.people.map((person) => (
                        <span key={person} className="tag tag-entity">{person}</span>
                      ))}
                    </div>
                  </div>
                )}
                {entities.organizations.length > 0 && (
                  <div className="document-detail-entity-group">
                    <span className="document-detail-entity-label">🏢 组织</span>
                    <div className="document-detail-entity-tags">
                      {entities.organizations.map((org) => (
                        <span key={org} className="tag tag-entity">{org}</span>
                      ))}
                    </div>
                  </div>
                )}
                {entities.locations.length > 0 && (
                  <div className="document-detail-entity-group">
                    <span className="document-detail-entity-label">📍 地点</span>
                    <div className="document-detail-entity-tags">
                      {entities.locations.map((loc) => (
                        <span key={loc} className="tag tag-entity">{loc}</span>
                      ))}
                    </div>
                  </div>
                )}
                {entities.dates.length > 0 && (
                  <div className="document-detail-entity-group">
                    <span className="document-detail-entity-label">📅 日期</span>
                    <div className="document-detail-entity-tags">
                      {entities.dates.map((date) => (
                        <span key={date} className="tag tag-entity">{date}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 原文预览 */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>
              📄 原文预览
            </h3>
            <div className="document-detail-content-preview">
              {doc.content ? (
                doc.content.startsWith('[') && (doc.content.includes('暂不支持') || doc.content.includes('无法以文本形式')) ? (
                  <div className="document-detail-unsupported">
                    <div className="document-detail-unsupported-icon">
                      {doc.fileType === 'pdf' ? '📕' : 
                       ['doc', 'docx'].includes(doc.fileType) ? '📘' :
                       ['xls', 'xlsx'].includes(doc.fileType) ? '📗' : '📁'}
                    </div>
                    <p className="document-detail-unsupported-text">{doc.content}</p>
                    <p className="document-detail-unsupported-hint">
                      提示：上传 .txt 或 .md 格式的文本文件可以查看完整原文预览
                    </p>
                  </div>
                ) : (
                  <pre className="document-detail-content-text">{doc.content}</pre>
                )
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">📄</div>
                  <div className="empty-state-title">暂无原文内容</div>
                  <div className="empty-state-description">
                    该文档暂无可预览的文本内容。上传 .txt 或 .md 文件可查看完整原文。
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧信息栏 */}
        <div className="document-detail-sidebar">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>
              ℹ️ 详细信息
            </h3>
            <div className="document-detail-info-list">
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">文件名</span>
                <span className="document-detail-info-value">{doc.fileName || '-'}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">文件类型</span>
                <span className="document-detail-info-value">{typeInfo.label}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">文件大小</span>
                <span className="document-detail-info-value">{formatFileSize(doc.fileSize)}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">文档编号</span>
                <span className="document-detail-info-value">{doc.docNumber || '-'}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">分类</span>
                <span className="document-detail-info-value">{getCategoryName(doc.category)}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">创建时间</span>
                <span className="document-detail-info-value">{formatDate(doc.createdAt)}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">更新时间</span>
                <span className="document-detail-info-value">{formatDate(doc.updatedAt)}</span>
              </div>
              <div className="document-detail-info-item">
                <span className="document-detail-info-label">浏览次数</span>
                <span className="document-detail-info-value">{doc.viewCount || 0}</span>
              </div>
            </div>
          </div>

          {/* 关键词 */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>
              🏷️ 关键词
            </h3>
            {isEditing ? (
              <input
                type="text"
                value={editForm.keywords?.join(', ') || ''}
                onChange={e => setEditForm({
                  ...editForm,
                  keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean)
                })}
                placeholder="输入关键词，用逗号分隔"
                className="document-detail-input"
              />
            ) : (
              <div className="document-detail-tags">
                {doc.keywords && doc.keywords.length > 0 ? (
                  doc.keywords.map((kw, i) => (
                    <span key={`${kw}-${i}`} className="tag">{kw}</span>
                  ))
                ) : (
                  <span className="document-detail-empty-tag">暂无关键词</span>
                )}
              </div>
            )}
          </div>

          {/* 标签 */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>
              📌 标签
            </h3>
            {isEditing ? (
              <input
                type="text"
                value={editForm.tags?.join(', ') || ''}
                onChange={e => setEditForm({
                  ...editForm,
                  tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                })}
                placeholder="输入标签，用逗号分隔"
                className="document-detail-input"
              />
            ) : (
              <div className="document-detail-tags">
                {doc.tags && doc.tags.length > 0 ? (
                  doc.tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="tag">{tag}</span>
                  ))
                ) : (
                  <span className="document-detail-empty-tag">暂无标签</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>
              确认删除
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          确定要删除文档 &quot;{doc.title}&quot; 吗？此操作不可撤销。
        </p>
      </Modal>
    </div>
  )
}
