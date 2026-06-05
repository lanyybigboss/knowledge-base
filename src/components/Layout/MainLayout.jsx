/**
 * 知识库管理系统 - 主布局组件
 */

import React from 'react'
import { useApp } from '../../services/AppContext'
import Sidebar from './Sidebar'
import Header from './Header'
import Notification from '../Common/Notification'
import './Layout.css'

export default function MainLayout({ children }) {
  const { sidebarOpen, toggleSidebar } = useApp()

  return (
    <div className="layout">
      <Sidebar />
      <div className={`layout-main ${sidebarOpen ? '' : 'layout-main--expanded'}`}>
        <Header onToggleSidebar={toggleSidebar} />
        <main className="layout-content">
          {children}
        </main>
      </div>
      <Notification />
    </div>
  )
}
