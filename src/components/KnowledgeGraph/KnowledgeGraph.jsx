/**
 * 知识图谱组件 — 简洁版
 * Canvas 力导向图，展示实体关系
 */

import React, { useRef, useEffect, useState } from 'react'
import storageService from '../../services/storageService'
import { ENTITY_COLORS } from '../../utils/constants'
import logger from '../../services/logger'
import './KnowledgeGraph.css'

const REPULSION = 600
const ATTRACTION = 0.004
const DAMPING = 0.85
const MIN_DIST = 50
const GRAVITY = 0.01
const ITERATIONS = 150

function buildGraph(docs) {
  const nodes = new Map()
  const edges = new Map()
  for (const doc of docs) {
    const ids = []
    for (const type of ['people', 'organizations', 'locations', 'dates']) {
      for (const name of (doc.entities[type] || [])) {
        if (!name || typeof name !== 'string') continue
        const key = `${type}:${name.trim()}`
        if (!nodes.has(key)) nodes.set(key, { id: key, name: name.trim(), type, docs: [], weight: 0 })
        const n = nodes.get(key)
        n.docs.push(doc.id)
        n.weight++
        ids.push(key)
      }
    }
    // 关键词作为补充节点（让更多文档能出现在图谱中）
    for (const kw of (doc.keywords || [])) {
      if (!kw || typeof kw !== 'string') continue
      const name = kw.trim()
      if (!name || name.length > 20) continue  // 跳过过长的关键词
      const key = `topic:${name}`
      if (!nodes.has(key)) nodes.set(key, { id: key, name, type: 'topic', docs: [], weight: 0 })
      const n = nodes.get(key)
      n.docs.push(doc.id)
      n.weight++
      ids.push(key)
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = [ids[i], ids[j]].sort().join('|')
        if (!edges.has(k)) edges.set(k, { s: ids[i], t: ids[j], w: 0 })
        edges.get(k).w++
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

function layout(nodes, edges, w, h) {
  const pos = new Map()
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length
    const r = Math.min(w, h) * 0.3
    pos.set(n.id, { x: w / 2 + r * Math.cos(a), y: h / 2 + r * Math.sin(a), vx: 0, vy: 0 })
  })
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id), b = pos.get(nodes[j].id)
        let dx = a.x - b.x, dy = a.y - b.y
        let d = Math.sqrt(dx * dx + dy * dy) || 1
        if (d < MIN_DIST) d = MIN_DIST
        const f = REPULSION / (d * d)
        a.vx += (dx / d) * f; a.vy += (dy / d) * f
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
      }
    }
    for (const e of edges) {
      const a = pos.get(e.s), b = pos.get(e.t)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = d * ATTRACTION * e.w
      a.vx += (dx / d) * f; a.vy += (dy / d) * f
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
    }
    for (const n of nodes) {
      const p = pos.get(n.id)
      p.vx += (w / 2 - p.x) * GRAVITY
      p.vy += (h / 2 - p.y) * GRAVITY
      p.vx *= DAMPING; p.vy *= DAMPING
      p.x += p.vx; p.y += p.vy
      p.x = Math.max(30, Math.min(w - 30, p.x))
      p.y = Math.max(30, Math.min(h - 30, p.y))
    }
  }
  return pos
}

function hitTest(x, y, nodes, pos) {
  for (const n of nodes) {
    const p = pos.get(n.id)
    if (!p) continue
    const r = Math.min(4 + Math.sqrt(n.weight) * 3, 18)
    if ((x - p.x) ** 2 + (y - p.y) ** 2 <= (r + 4) ** 2) return n
  }
  return null
}

function drawCanvas(ctx, nodes, edges, pos, w, h, hovered) {
  ctx.clearRect(0, 0, w, h)
  // edges
  for (const e of edges) {
    const a = pos.get(e.s), b = pos.get(e.t)
    if (!a || !b) continue
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = hovered
      ? (e.s === hovered || e.t === hovered ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.03)')
      : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = Math.min(e.w, 3); ctx.stroke()
  }
  // nodes
  for (const n of nodes) {
    const p = pos.get(n.id); if (!p) continue
    const c = ENTITY_COLORS[n.type]?.color || '#6b7280'
    const r = Math.min(4 + Math.sqrt(n.weight) * 3, 18)
    const isH = n.id === hovered
    const dim = hovered && !isH && !edges.some(e =>
      (e.s === hovered && e.t === n.id) || (e.t === hovered && e.s === n.id))
    if (isH) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2)
      ctx.fillStyle = c + '33'; ctx.fill()
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = dim ? c + '33' : c; ctx.fill()
    if (isH || r > 8) {
      ctx.font = `${isH ? 'bold ' : ''}${isH ? 13 : 11}px system-ui,sans-serif`
      ctx.fillStyle = dim ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)'
      ctx.textAlign = 'center'; ctx.fillText(n.name, p.x, p.y - r - 6)
    }
  }
}

export default function KnowledgeGraph({ onNavigate }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [state, setState] = useState({ loading: true, nodes: [], edges: [], pos: new Map(), stats: null, legend: [] })
  const hoveredRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // 初始化 — 仅一次
  useEffect(() => {
    let alive = true
    // 安全超时：5 秒后强制结束 loading
    const safetyTimer = setTimeout(() => {
      if (alive) setState(s => s.loading ? { ...s, loading: false } : s)
    }, 5000)

    ;(async () => {
      try {
        const docs = await storageService.getDocumentEntities()
        if (!alive) return
        if (!docs.length) { setState({ loading: false, nodes: [], edges: [], pos: new Map(), stats: null, legend: [] }); return }

        const { nodes, edges } = buildGraph(docs)
        if (!nodes.length) { setState({ loading: false, nodes: [], edges: [], pos: new Map(), stats: null, legend: [] }); return }

        const sorted = [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 80)
        const ids = new Set(sorted.map(n => n.id))
        const fe = edges.filter(e => ids.has(e.s) && ids.has(e.t))

        const wrap = wrapRef.current
        const canvas = canvasRef.current
        if (!wrap || !canvas) return
        const dpr = window.devicePixelRatio || 1
        const w = wrap.clientWidth || 600
        const h = 360
        canvas.width = w * dpr; canvas.height = h * dpr
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px'

        const pos = layout(sorted, fe, w, h)

        const docIds = new Set(docs.map(d => d.id))
        const tc = {}
        sorted.forEach(n => { tc[n.type] = (tc[n.type] || 0) + 1 })
        const legend = Object.entries(tc).map(([t, c]) => ({ type: t, count: c, ...ENTITY_COLORS[t] }))

        const s = { loading: false, nodes: sorted, edges: fe, pos, stats: { nodes: sorted.length, edges: fe.length, docs: docIds.size }, legend }
        setState(s)

        const ctx = canvas.getContext('2d')
        ctx.save(); ctx.scale(dpr, dpr)
        drawCanvas(ctx, sorted, fe, pos, w, h, null)
        ctx.restore()
      } catch (err) {
        logger.error('[KnowledgeGraph] 加载失败:', err)
        if (alive) setState({ loading: false, nodes: [], edges: [], pos: new Map(), stats: null, legend: [] })
      }
    })()

    return () => { alive = false; clearTimeout(safetyTimer) }
  }, [])

  // hover 重绘
  const redraw = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const { nodes, edges, pos } = stateRef.current
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    ctx.save(); ctx.scale(dpr, dpr)
    drawCanvas(ctx, nodes, edges, pos, canvas.width / dpr, canvas.height / dpr, hoveredRef.current)
    ctx.restore()
  }

  const onMouseMove = (e) => {
    const canvas = canvasRef.current; if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const hit = hitTest(e.clientX - r.left, e.clientY - r.top, stateRef.current.nodes, stateRef.current.pos)
    const id = hit?.id || null
    if (id !== hoveredRef.current) { hoveredRef.current = id; canvas.style.cursor = id ? 'pointer' : 'default'; redraw() }
  }

  const onMouseLeave = () => { if (hoveredRef.current) { hoveredRef.current = null; redraw() } }

  const onClick = (e) => {
    const canvas = canvasRef.current; if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const hit = hitTest(e.clientX - r.left, e.clientY - r.top, stateRef.current.nodes, stateRef.current.pos)
    if (hit?.docs?.length && onNavigate) onNavigate(`/documents/${hit.docs[0]}`)
  }

  // resize
  useEffect(() => {
    const onResize = () => {
      const wrap = wrapRef.current, canvas = canvasRef.current
      if (!wrap || !canvas) return
      const { nodes, edges } = stateRef.current
      if (!nodes.length) return
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth, h = 360
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      const newPos = layout(nodes, edges, w, h)
      stateRef.current = { ...stateRef.current, pos: newPos }
      const ctx = canvas.getContext('2d')
      ctx.save(); ctx.scale(dpr, dpr)
      drawCanvas(ctx, nodes, edges, newPos, w, h, hoveredRef.current)
      ctx.restore()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const hoveredData = hoveredRef.current ? state.nodes.find(n => n.id === hoveredRef.current) : null

  return (
    <div className="card kg-card">
      <div className="card-header">
        <h3 className="card-title">🧠 知识图谱</h3>
        {state.stats && <span className="kg-stats">{state.stats.nodes} 实体 · {state.stats.edges} 关联 · {state.stats.docs} 文档</span>}
      </div>
      {state.loading ? (
        <div className="kg-loading"><div className="kg-spinner" /><span>构建知识图谱...</span></div>
      ) : !state.stats ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-state-icon">🧠</div>
          <div className="empty-state-title">暂无实体数据</div>
          <div className="empty-state-description">上传文档并完成 AI 分析后，知识图谱将自动构建</div>
        </div>
      ) : (
        <>
          <div className="kg-canvas-wrapper" ref={wrapRef}>
            <canvas ref={canvasRef} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onClick={onClick} />
            {hoveredData && (
              <div className="kg-tooltip">
                <span className="kg-tooltip-type" style={{ color: ENTITY_COLORS[hoveredData.type]?.color }}>
                  {ENTITY_COLORS[hoveredData.type]?.icon} {ENTITY_COLORS[hoveredData.type]?.label}
                </span>
                <span className="kg-tooltip-name">{hoveredData.name}</span>
                <span className="kg-tooltip-meta">出现 {hoveredData.weight} 次 · {hoveredData.docs.length} 篇文档</span>
              </div>
            )}
          </div>
          <div className="kg-legend">
            {state.legend.map(item => (
              <div key={item.type} className="kg-legend-item">
                <span className="kg-legend-dot" style={{ background: item.color }} />
                <span>{item.icon} {item.label}</span>
                <span className="kg-legend-count">{item.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
