/**
 * 通知组件 - 支持堆叠和退出动画
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../services/AppContext'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ICON_MAP = {
  success: <CheckCircle size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />
}

/** 单条通知项 */
function NotificationItem({ notification, onRemove }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const duration = notification.duration || 3000
    const exitTimer = setTimeout(() => {
      setExiting(true)
      // 等待退出动画完成后再移除
      setTimeout(() => onRemove(notification.id), 300)
    }, duration)

    return () => clearTimeout(exitTimer)
  }, [notification.id, notification.duration, onRemove])

  const handleClose = useCallback(() => {
    setExiting(true)
    setTimeout(() => onRemove(notification.id), 300)
  }, [notification.id, onRemove])

  return (
    <div
      className={`notification notification-${notification.type} ${exiting ? 'notification-exit' : 'notification-enter'}`}
    >
      <span className="notification-icon">{ICON_MAP[notification.type] || <Info size={18} />}</span>
      <span className="notification-message">{notification.message}</span>
      <button className="notification-close" onClick={handleClose}><X size={14} /></button>
    </div>
  )
}

/** 通知容器 - 支持多条堆叠 */
export default function Notification() {
  const { notification, removeNotification } = useApp()

  // 用数组保存活跃通知（最多 5 条）
  const [notifications, setNotifications] = useState([])

  // 新通知入队
  useEffect(() => {
    if (notification && notification.id) {
      setNotifications(prev => {
        // 去重
        if (prev.some(n => n.id === notification.id)) return prev
        const next = [...prev, notification]
        // 最多保留 5 条
        return next.slice(-5)
      })
    }
  }, [notification])

  const handleRemove = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
    if (removeNotification) removeNotification(id)
  }, [removeNotification])

  if (notifications.length === 0) return null

  return (
    <div className="notification-stack">
      {notifications.map(n => (
        <NotificationItem key={n.id} notification={n} onRemove={handleRemove} />
      ))}
    </div>
  )
}
