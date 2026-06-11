/**
 * 编号规则 Tab
 */
import React, { useState } from 'react'

export default function NumberingTab({ numberingRules, updateNumberingRules }) {
  const [numberForm, setNumberForm] = useState({
    prefix: numberingRules.prefix || 'DOC',
    dateFormat: numberingRules.dateFormat || 'YYYYMMDD',
    separator: numberingRules.separator || '-',
    digitCount: numberingRules.digitCount || 4,
    counter: numberingRules.counter || {},
    enabled: numberingRules.enabled !== false
  })

  return (
    <div className="settings-section">
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          文档编号规则
        </h3>
        <p className="settings-description">
          AI 分析完成后自动生成智能编号，格式为「智能标题-日期」。
          例如：<code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>深度学习模型部署方案-0531</code>
        </p>

        <div className="settings-form">
          <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ margin: 0 }}>启用智能编号</label>
            <button
              className={`btn btn-sm ${numberForm.enabled !== false ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setNumberForm({ ...numberForm, enabled: numberForm.enabled === false })}
            >
              {numberForm.enabled !== false ? '已启用' : '已禁用'}
            </button>
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <p style={{ margin: '0 0 8px' }}><strong>编号格式：</strong>{'{智能标题}-{MMDD}'}</p>
            <p style={{ margin: '0 0 8px' }}>AI 分析文档后，用生成的智能标题 + 上传日期自动编号。</p>
            <p style={{ margin: 0 }}>旧格式（DOC-YYYYMMDD-NNNN）的文档不受影响。</p>
          </div>

          <button className="btn btn-primary" onClick={() => updateNumberingRules({ ...numberForm, enabled: numberForm.enabled !== false })}>
            💾 保存编号规则
          </button>
        </div>
      </div>
    </div>
  )
}
