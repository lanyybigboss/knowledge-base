/**
 * 知识图谱组件
 * 基于实体（人物/机构/地点/日期）的力导向关系图
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import storageService from '../../services/storageService'
import { ENTITY_COLORS } from '../../utils/constants'
import logger from '../../services/logger'
import './KnowledgeGraph.css'

// 力导向参数
const REPULSION = 800
const ATTRACTION = 0.005
const DAMPING = 0.85
const MIN_DISTANCE = 40
const CENTER_GRAVITY = 0.01
const MAX_ITERATIONS = 200

/**
 * 从文档实体数据构建图谱节点和边
 */
function buildGraph(documentsWithEntities) {
  const nodeMap = new Map()
  const edgeMap = new Map()

  for (const doc of documentsWithEntities) {
    const docEntities = []

    for (const type of ['people', 'organizations', 'locations', 'dates']) {
      const entities = doc.entities[type] || []
      for (const name of entities) {
        if (!name || typeof name !== 'string') continue
        const key = `${type}:${name.trim()}`
        if (!nodeMap.has(key)) {
          nodeMap.set(key, {
            id: key,
            name: name.trim(),
            type,
            docs: new Set(),
            weight: 0
          })
        }
        const node = nodeMap.get(key)
        node.docs.add(doc.id)
        node.weight++
        docEntities.push(key)
      }
    }

    // 同一文档中的实体互连
    for (let i = 0; i < docEntities.length; i++) {
      for (let j = i + 1; j < docEntities.length; j++) {
        const edgeKey = [docEntities[i], docEntities[j]].sort().join('|')
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, { source: docEntities[i], target: docEntities[j], weight: 0 })
        }
        edgeMap.get(edgeKey).weight++
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values())
  }
}

/**
 * 简单力导向布局
 */
function layoutGraph(nodes, edges, width, height) {
  const positions = new Map()
  const velocities = new Map()

  // 初始化位置（圆形分布）
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length
    const radius = Math.min(width, height) * 0.3
    positions.set(node.id, {
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle)
    })
    velocities.set(node.id, { vx: 0, vy: 0 })
  })

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const forces = new Map()
    nodes.forEach(n => forces.set(n.id, { fx: 0, fy: 0 }))

    // 排斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)
        const b = positions.get(nodes[j].id)
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.sqrt(dx * dx + dy * dy) || 1
        if (dist < MIN_DISTANCE) dist = MIN_DISTANCE
        const force = REPULSION / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        forces.get(nodes[i].id).fx += fx
        forces.get(nodes[i].id).fy += fy
        forces.get(nodes[j].id).fx -= fx
        forces.get(nodes[j].id).fy -= fy
      }
    }

    // 吸引力（沿边）
    for (const edge of edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = dist * ATTRACTION * edge.weight
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      forces.get(edge.source).fx += fx
      forces.get(edge.source).fy += fy
      forces.get(edge.target).fx -= fx
      forces.get(edge.target).fy -= fy
    }

    // 中心引力
    for (const node of nodes) {
      const pos = positions.get(node.id)
      forces.get(node.id).fx += (width / 2 - pos.x) * CENTER_GRAVITY
      forces.get(node.id).fy += (height / 2 - pos.y) * CENTER_GRAVITY
    }

    // 应用力 + 阻尼
    for (const node of nodes) {
      const vel = velocities.get(node.id)
      const force = forces.get(node.id)
      vel.vx = (vel.vx + force.fx) * DAMPING
      vel.vy = (vel.vy + force.fy) * DAMPING
      const pos = positions.get(node.id)
      pos.x += vel.vx
      pos.y += vel.vy
      // 边界约束
      const margin = 30
      pos.x = Math.max(margin, Math.min(width - margin, pos.x))
      pos.y = Math.max(margin, Math.min(height - margin, pos.y))
    }
  }

  return positions
}

export default function KnowledgeGraph({ onNavigate }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ nodes: 0, edges: 0, docs: 0 })
  const [hoveredNode, setHoveredNode] = useState(null)
  const [legend, setLegend] = useState([])
  const graphDataRef = useRef({ nodes: [], edges: [], positions: new Map() })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { nodes, edges, positions } = graphDataRef.current
    const dpr = window.devicePixelRatio || 1

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    const w = canvas.width / dpr
    const h = canvas.height / dpr

    // 画边
    for (const edge of edges) {
      const sPos = positions.get(edge.source)
      const tPos = positions.get(edge.target)
      if (!sPos || !tPos) continue
      ctx.beginPath()
      ctx.moveTo(sPos.x, sPos.y)
      ctx.lineTo(tPos.x, tPos.y)
      ctx.strokeStyle = hoveredNode
        ? (edge.source === hoveredNode || edge.target === hoveredNode
          ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.03)')
        : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = Math.min(edge.weight, 3)
      ctx.stroke()
    }

    // 画节点
    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      const color = ENTITY_COLORS[node.type]?.color || '#6b7280'
      const radius = Math.min(4 + Math.sqrt(node.weight) * 3, 18)
      const isHovered = node.id === hoveredNode
      const dimmed = hoveredNode && !isHovered &&
        !edges.some(e => (e.source === hoveredNode && e.target === node.id) ||
          (e.target === hoveredNode && e.source === node.id))

      // 光晕
      if (isHovered) {
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2)
        ctx.fillStyle = color + '33'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = dimmed ? color + '33' : color
      ctx.fill()

      // 标签
      if (isHovered || radius > 8) {
        ctx.font = `${isHovered ? 'bold ' : ''}${isHovered ? 13 : 11}px system-ui, sans-serif`
        ctx.fillStyle = dimmed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)'
        ctx.textAlign = 'center'
        ctx.fillText(node.name, pos.x, pos.y - radius - 6)
      }
    }

    ctx.restore()
  }, [hoveredNode])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const docs = await storageService.getDocumentEntities()
        if (!mounted) return

        if (docs.length === 0) {
          setLoading(false)
          return
        }

        const { nodes, edges } = buildGraph(docs)

        if (nodes.length === 0) {
          setLoading(false)
          return
        }

        // 限制节点数（避免过于密集）
        const sorted = [...nodes].sort((a, b) => b.weight - a.weight)
        const topNodes = sorted.slice(0, 60)
        const topIds = new Set(topNodes.map(n => n.id))
        const filteredEdges = edges.filter(e => topIds.has(e.source) && topIds.has(e.target))

        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const dpr = window.devicePixelRatio || 1
        const rect = container.getBoundingClientRect()
        const w = rect.width
        const h = 360

        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'

        const positions = layoutGraph(topNodes, filteredEdges, w, h)
        graphDataRef.current = { nodes: topNodes, edges: filteredEdges, positions }

        // 统计
        const docIds = new Set()
        docs.forEach(d => docIds.add(d.id))
        setStats({ nodes: topNodes.length, edges: filteredEdges.length, docs: docIds.size })

        // 图例
        const typeCounts = {}
        topNodes.forEach(n => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1 })
        setLegend(Object.entries(typeCounts).map(([type, count]) => ({
          type,
          count,
          ...ENTITY_COLORS[type]
        })))

        setLoading(false)
        draw()
      } catch (err) {
        logger.error('[KnowledgeGraph] 加载失败:', err)
        setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [draw])

  // 鼠标交互
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const { nodes, positions } = graphDataRef.current

    let found = null
    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      const radius = Math.min(4 + Math.sqrt(node.weight) * 3, 18)
      const dx = x - pos.x
      const dy = y - pos.y
      if (dx * dx + dy * dy <= (radius + 4) * (radius + 4)) {
        found = node.id
        break
      }
    }
    if (found !== hoveredNode) {
      setHoveredNode(found)
      canvas.style.cursor = found ? 'pointer' : 'default'
    }
  }, [hoveredNode])

  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const { nodes, positions } = graphDataRef.current

    for (const node of nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      const radius = Math.min(4 + Math.sqrt(node.weight) * 3, 18)
      const dx = x - pos.x
      const dy = y - pos.y
      if (dx * dx + dy * dy <= (radius + 4) * (radius + 4)) {
        // 点击节点 → 跳转到第一个关联文档
        if (node.docs.size > 0 && onNavigate) {
          const docId = node.docs.values().next().value
          onNavigate(`/documents/${docId}`)
        }
        return
      }
    }
  }, [onNavigate])

  // hoveredNode 变化时重绘
  useEffect(() => { draw() }, [hoveredNode, draw])

  // 窗口 resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const dpr = window.devicePixelRatio || 1
      const rect = container.getBoundingClientRect()
      const w = rect.width
      const h = 360
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      const { nodes, edges } = graphDataRef.current
      if (nodes.length > 0) {
        const positions = layoutGraph(nodes, edges, w, h)
        graphDataRef.current = { nodes, edges, positions }
        draw()
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [draw])

  const hoveredData = hoveredNode ? graphDataRef.current.nodes.find(n => n.id === hoveredNode) : null

  return (
    <div className="card kg-card">
      <div className="card-header">
        <h3 className="card-title">🧠 知识图谱</h3>
        {stats.nodes > 0 && (
          <span className="kg-stats">{stats.nodes} 实体 · {stats.edges} 关联 · {stats.docs} 文档</span>
        )}
      </div>

      {loading ? (
        <div className="kg-loading">
          <div className="kg-spinner" />
          <span>构建知识图谱...</span>
        </div>
      ) : stats.nodes === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-state-icon">🧠</div>
          <div className="empty-state-title">暂无实体数据</div>
          <div className="empty-state-description">上传文档并完成 AI 分析后，知识图谱将自动构建</div>
        </div>
      ) : (
        <>
          <div className="kg-canvas-wrapper" ref={containerRef}>
            <canvas
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={handleClick}
            />
            {hoveredData && (
              <div className="kg-tooltip">
                <span className="kg-tooltip-type" style={{ color: ENTITY_COLORS[hoveredData.type]?.color }}>
                  {ENTITY_COLORS[hoveredData.type]?.icon} {ENTITY_COLORS[hoveredData.type]?.label}
                </span>
                <span className="kg-tooltip-name">{hoveredData.name}</span>
                <span className="kg-tooltip-meta">出现 {hoveredData.weight} 次 · {hoveredData.docs.size} 篇文档</span>
              </div>
            )}
          </div>
          <div className="kg-legend">
            {legend.map(item => (
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
