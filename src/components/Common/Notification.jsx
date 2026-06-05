/**
 * 通知组件
 */

import React from 'react'
import { useApp } from '../../services/AppContext'

const ICONS = {
  success: '✅',
  error: '❌',
  info: 'ℹ️'
}

export default function Notification() {
  const { notification } = useApp()

  if (!notification) return null

  return (
    <div className={`notification notification-${notification.type}`}>
      <span>{ICONS[notification.type] || 'ℹ️'}</span>
      <span>{notification.message}</span>
    </div>
  )
}
