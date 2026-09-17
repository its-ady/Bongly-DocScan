'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point, Quad } from '@/lib/image-utils'

interface Props {
  src: string
  // initial quad in natural image pixels
  initialQuad: Quad
  onChange: (quad: Quad) => void
}

type Corner = 'tl' | 'tr' | 'br' | 'bl'
type Edge = 'top' | 'right' | 'bottom' | 'left'
type Handle = Corner | Edge | 'move'

// Which two corners each edge connects.
const EDGE_CORNERS: Record<Edge, [Corner, Corner]> = {
  top: ['tl', 'tr'],
  right: ['tr', 'br'],
  bottom: ['br', 'bl'],
  left: ['bl', 'tl'],
}

const HANDLE_HIT = 30 // px touch target

export function CropEditor({ src, initialQuad, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // layout describes how the natural image maps onto the displayed element
  const [layout, setLayout] = useState({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    natW: 1,
    natH: 1,
  })
  const [quad, setQuad] = useState<Quad>(initialQuad)
  const drag = useRef<{
    handle: Handle
    startX: number
    startY: number
    startQuad: Quad
  } | null>(null)

  const measure = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    const natW = img.naturalWidth || 1
    const natH = img.naturalHeight || 1
    const cw = container.clientWidth
    const ch = container.clientHeight
    const scale = Math.min(cw / natW, ch / natH)
    const dispW = natW * scale
    const dispH = natH * scale
    setLayout({
      scale,
      offsetX: (cw - dispW) / 2,
      offsetY: (ch - dispH) / 2,
      natW,
      natH,
    })
  }, [])

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (img.complete) measure()
    else img.onload = measure
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, src])

  useEffect(() => {
    setQuad(initialQuad)
  }, [initialQuad])

  // convert a natural-pixel point to displayed pixels
  const toDisplay = (p: Point) => ({
    x: layout.offsetX + p.x * layout.scale,
    y: layout.offsetY + p.y * layout.scale,
  })

  const clampPoint = (p: Point): Point => ({
    x: Math.min(Math.max(0, p.x), layout.natW),
    y: Math.min(Math.max(0, p.y), layout.natH),
  })

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startQuad: quad,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dxNat = (e.clientX - d.startX) / layout.scale
    const dyNat = (e.clientY - d.startY) / layout.scale
    const s = d.startQuad
    let next: Quad

    if (d.handle === 'move') {
      next = {
        tl: clampPoint({ x: s.tl.x + dxNat, y: s.tl.y + dyNat }),
        tr: clampPoint({ x: s.tr.x + dxNat, y: s.tr.y + dyNat }),
        br: clampPoint({ x: s.br.x + dxNat, y: s.br.y + dyNat }),
        bl: clampPoint({ x: s.bl.x + dxNat, y: s.bl.y + dyNat }),
      }
    } else if (d.handle in EDGE_CORNERS) {
      // Dragging the middle of an edge moves the whole line (both its corners).
      const [c1, c2] = EDGE_CORNERS[d.handle as Edge]
      next = {
        ...s,
        [c1]: clampPoint({ x: s[c1].x + dxNat, y: s[c1].y + dyNat }),
        [c2]: clampPoint({ x: s[c2].x + dxNat, y: s[c2].y + dyNat }),
      } as Quad
    } else {
      const corner = d.handle as Corner
      const moved = clampPoint({
        x: s[corner].x + dxNat,
        y: s[corner].y + dyNat,
      })
      next = { ...s, [corner]: moved }
    }

    setQuad(next)
    onChange(next)
  }

  const onPointerUp = () => {
    drag.current = null
  }

  const corners: Corner[] = ['tl', 'tr', 'br', 'bl']
  const dPts = {
    tl: toDisplay(quad.tl),
    tr: toDisplay(quad.tr),
    br: toDisplay(quad.br),
    bl: toDisplay(quad.bl),
  }
  const polyPoints = `${dPts.tl.x},${dPts.tl.y} ${dPts.tr.x},${dPts.tr.y} ${dPts.br.x},${dPts.br.y} ${dPts.bl.x},${dPts.bl.y}`

  const handleStyle =
    'absolute rounded-full border-2 border-primary-foreground bg-primary shadow-md touch-none'

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-black"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src || '/placeholder.svg'}
        alt="Captured document"
        className="pointer-events-none absolute left-0 top-0 h-full w-full object-contain"
        crossOrigin="anonymous"
      />

      {/* dark overlay outside the quad + connecting edges */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="quad-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <polygon points={polyPoints} fill="black" />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#quad-mask)"
        />
        <polygon
          points={polyPoints}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2}
        />
      </svg>

      {/* draggable interior to move the whole quad */}
      <svg
        className="absolute inset-0 h-full w-full"
        onPointerDown={onPointerDown('move')}
        style={{ touchAction: 'none' }}
      >
        <polygon points={polyPoints} fill="transparent" />
      </svg>

      {/* edge handles (drag the middle of a line to move the whole edge) */}
      {(Object.keys(EDGE_CORNERS) as Edge[]).map((edge) => {
        const [c1, c2] = EDGE_CORNERS[edge]
        const mid = {
          x: (dPts[c1].x + dPts[c2].x) / 2,
          y: (dPts[c1].y + dPts[c2].y) / 2,
        }
        const horizontal = edge === 'top' || edge === 'bottom'
        return (
          <div
            key={edge}
            className="absolute flex touch-none items-center justify-center"
            style={{
              left: mid.x - HANDLE_HIT / 2,
              top: mid.y - HANDLE_HIT / 2,
              height: HANDLE_HIT,
              width: HANDLE_HIT,
              cursor: horizontal ? 'ns-resize' : 'ew-resize',
            }}
            onPointerDown={onPointerDown(edge)}
          >
            <span
              className="rounded-full bg-primary shadow-md"
              style={{
                width: horizontal ? 22 : 4,
                height: horizontal ? 4 : 22,
              }}
            />
          </div>
        )
      })}

      {/* corner handles */}
      {corners.map((c) => (
        <div
          key={c}
          className={handleStyle}
          style={{
            left: dPts[c].x - HANDLE_HIT / 2,
            top: dPts[c].y - HANDLE_HIT / 2,
            height: HANDLE_HIT,
            width: HANDLE_HIT,
          }}
          onPointerDown={onPointerDown(c)}
        />
      ))}
    </div>
  )
}
