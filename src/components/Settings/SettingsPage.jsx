/**
 * 系统设置页面
 */

import React, { useState } from 'react'
import { useApp } from '../../services/AppContext'
import Modal from '../Common/Modal'
import GeneralTab from './tabs/GeneralTab'
import AITab from './tabs/AITab'
import NumberingTab from './tabs/NumberingTab'
import FolderTab from './tabs/FolderTab'
import DataTab from './tabs/DataTab'
import UserProfileTab from './tabs/UserProfileTab'
import './SettingsPage.css'

export default function SettingsPage() {
  const {
    settings,
    numberingRules,
    userProfile,
    updateSettings,
    updateNumberingRules,
    updateUserProfile,
    exportData,
    importData,
    clearAllData,
    documents,
    categories
  } = useApp()

  const [activeTab, setActiveTab] = useState('general')
  const [showImportModal, setShowImportModal] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importError, setImportError] = useState('')

  // ===== 导入/清除 =====
  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (file) {
      setImportFile(file)
      setImportError('')
    }
  }

  const handleImport = () => {
    if (!importFile) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        importData(data)
        setShowImportModal(false)
        setImportFile(null)
      } catch (err) {
        setImportError('文件格式错误，请选择有效的 JSON 备份文件')
      }
    }
    reader.readAsText(importFile)
  }

  const handleClearAll = () => {
    clearAllData()
    setShowClearModal(false)
  }

  const tabs = [
    { id: 'general', label: '通用设置' },
    { id: 'ai', label: 'AI 设置' },
    { id: 'profile', label: '个人配置' },
    { id: 'numbering', label: '编号规则' },
    { id: 'folder', label: '文件夹监控' },
    { id: 'data', label: '数据管理' }
  ]

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h1 className="settings-page-title">系统设置</h1>
        <p className="settings-page-subtitle">管理知识库的配置和数据</p>
      </div>

      {/* 标签页 */}
      <div className="settings-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {activeTab === 'general' && (
          <GeneralTab
            settings={settings}
            updateSettings={updateSettings}
          />
        )}

        {activeTab === 'ai' && (
          <AITab />
        )}

        {activeTab === 'profile' && (
          <UserProfileTab
            userProfile={userProfile}
            updateUserProfile={updateUserProfile}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}

        {activeTab === 'numbering' && (
          <NumberingTab
            numberingRules={numberingRules}
            updateNumberingRules={updateNumberingRules}
          />
        )}

        {activeTab === 'folder' && (
          <FolderTab />
        )}

        {activeTab === 'data' && (
          <DataTab
            documents={documents}
            categories={categories}
            exportData={exportData}
            setShowImportModal={setShowImportModal}
            setShowClearModal={setShowClearModal}
          />
        )}
      </div>

      {/* 导入弹窗 */}
      <Modal
        isOpen={showImportModal}
        onClose={() => { setShowImportModal(false); setImportFile(null); setImportError('') }}
        title="导入数据"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => { setShowImportModal(false); setImportFile(null) }}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importFile}>
              导入
            </button>
          </>
        }
      >
        <div className="settings-import-form">
          <div className="input-group">
            <label>选择 JSON 备份文件</label>
            <input type="file" accept=".json" onChange={handleImportFile} />
          </div>
          {importError && (
            <p className="settings-import-error">{importError}</p>
          )}
          {importFile && (
            <p className="settings-import-file">已选择: {importFile.name}</p>
          )}
        </div>
      </Modal>

      {/* 清除确认弹窗 */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="确认清除所有数据"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowClearModal(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={handleClearAll}>
              确认清除
            </button>
          </>
        }
      >
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>此操作将永久删除以下所有数据：</p>
          <ul style={{ marginTop: '12px', paddingLeft: '20px', listStyle: 'disc' }}>
            <li>{documents.length} 个文档</li>
            <li>{categories.length} 个自定义分类</li>
            <li>所有系统设置和编号规则</li>
          </ul>
          <p style={{ marginTop: '12px', color: 'var(--error)' }}>
            此操作不可撤销！建议先导出备份。
          </p>
        </div>
      </Modal>
    </div>
  )
}
