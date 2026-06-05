/**
 * 知识库管理系统 - 主布局组件
 */

import React, { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import Sidebar from './Sidebar'
import Header from './Header'
import Notification from '../Common/Notification'
import './Layout.css'

export default function MainLayout({ children }) {
  const { sidebarOpen, toggleSidebar } = useApp()
  const location = useLocation()
  const contentRef = useRef(null)

  // 页面切换动效
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.classList.remove('page-enter')
      // 强制回流
      void contentRef.current.offsetWidth
      contentRef.current.classList.add('page-enter')
    }
  }, [location.pathname])

  // 卡片光晕跟随鼠标
  useEffect(() => {
    const handleMouseMove = (e) => {
      const cards = document.querySelectorAll('.card')
      cards.forEach(card => {
        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        card.style.setProperty('--card-glow-x', `${x}px`)
        card.style.setProperty('--card-glow-y', `${y}px`)
      })
    }
    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // 按钮涟漪效果
  useEffect(() => {
    const handleBtnClick = (e) => {
      const btn = e.target.closest('.btn')
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      btn.style.setProperty('--ripple-x', `${x}%`)
      btn.style.setProperty('--ripple-y', `${y}%`)
    }
    document.addEventListener('mousedown', handleBtnClick, { passive: true })
    return () => document.removeEventListener('mousedown', handleBtnClick)
  }, [])

  return (
    <div className="layout">
      <Sidebar />
      <div className={`layout-main ${sidebarOpen ? '' : 'layout-main--expanded'}`}>
        <Header onToggleSidebar={toggleSidebar} />
        <main className="layout-content" ref={contentRef}>
          {children}
        </main>
      </div>
      <Notification />
    </div>
  )
}
