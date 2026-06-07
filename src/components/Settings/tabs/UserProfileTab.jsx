/**
 * 个人配置 Tab — 用户身份 + Webhook 推送
 */
import React, { useState, useEffect } from 'react'

export default function UserProfileTab({ userProfile, updateUserProfile, settings, updateSettings }) {
  const [form, setForm] = useState({
    name: '',
    role: '',
    department: '',
    keywordsText: '',
    webhookUrl: ''
  })

  useEffect(() => {
    setForm({
      name: userProfile?.name || '',
      role: userProfile?.role || '',
      department: userProfile?.department || '',
      keywordsText: (userProfile?.keywords || []).join(', '),
      webhookUrl: settings?.webhookUrl || ''
    })
  }, [userProfile, settings])

  const handleSaveProfile = () => {
    const keywords = form.keywordsText
      .split(/[,，、]/)
      .map(k => k.trim())
      .filter(Boolean)
    updateUserProfile({
      name: form.name.trim(),
      role: form.role.trim(),
      department: form.department.trim(),
      keywords
    })
  }

  const handleSaveWebhook = () => {
    updateSettings({ webhookUrl: form.webhookUrl.trim() })
  }

  return (
    <div className="settings-section">
      {/* 用户身份 */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          👤 个人身份
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 'normal', marginLeft: '8px' }}>
            用于文档待办的角色匹配
          </span>
        </h3>
        <div className="settings-form">
          <div className="input-group">
            <label>姓名</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              onBlur={handleSaveProfile}
              placeholder="如：张三"
            />
          </div>
          <div className="input-group">
            <label>角色/职务</label>
            <input
              type="text"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              onBlur={handleSaveProfile}
              placeholder="如：化学教师"
            />
          </div>
          <div className="input-group">
            <label>部门</label>
            <input
              type="text"
              value={form.department}
              onChange={e => setForm({ ...form, department: e.target.value })}
              onBlur={handleSaveProfile}
              placeholder="如：高中部理科组"
            />
          </div>
          <div className="input-group">
            <label>
              匹配关键词
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                逗号分隔，文档中出现则触发待办
              </span>
            </label>
            <input
              type="text"
              value={form.keywordsText}
              onChange={e => setForm({ ...form, keywordsText: e.target.value })}
              onBlur={handleSaveProfile}
              placeholder="如：化学, 高三, bc301"
            />
          </div>
        </div>
      </div>

      {/* Webhook 推送 */}
      <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          📲 群机器人推送
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 'normal', marginLeft: '8px' }}>
            匹配到的待办自动推送到群
          </span>
        </h3>
        <div className="settings-form">
          <div className="input-group">
            <label>Webhook URL</label>
            <input
              type="text"
              value={form.webhookUrl}
              onChange={e => setForm({ ...form, webhookUrl: e.target.value })}
              onBlur={handleSaveWebhook}
              placeholder="企业微信/钉钉/飞书群机器人 Webhook 地址"
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              支持企业微信、钉钉、飞书群机器人。留空则不推送。
            </p>
          </div>
          {form.webhookUrl && (
            <button
              className="btn btn-secondary"
              onClick={async () => {
                if (!window.electronAPI?.pushWebhook) {
                  alert('Electron API 不可用')
                  return
                }
                const result = await window.electronAPI.pushWebhook({
                  url: form.webhookUrl,
                  payload: { msgtype: 'text', text: { content: '🔔 O1 知识库推送测试 — 连接成功！' } }
                })
                alert(result.success ? '✅ 推送测试成功！请检查群消息。' : `❌ 推送失败: ${result.error}`)
              }}
              style={{ marginTop: '8px' }}
            >
              🔔 测试推送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
