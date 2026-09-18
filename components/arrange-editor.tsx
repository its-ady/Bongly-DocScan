'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Trash2, WandSparkles, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PlacedImage {
  id: string
  src: string
  x: number
  y: number
  w: number
  h: number
}

const PAGE_W = 595
const PAGE_H = 842

export function ArrangeEditor({
  images,
  onChange,
  onAddPhoto,
  onConvert,
}: {
  images: PlacedImage[]
  onChange: (images: PlacedImage[]) => void
  onAddPhoto: () => void
  onConvert: () => void
}) {
  const pageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; item: PlacedImage } | null>(null)
  const [selected, setSelected] = useState<string | null>(images.at(-1)?.id ?? null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const measure = () => {
      const page = pageRef.current
      if (page) setScale(page.clientWidth / PAGE_W)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const updateDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.sx) / scale
    const dy = (event.clientY - drag.sy) / scale
    const next = images.map((item) => {
      if (item.id !== drag.id) return item
      if (drag.mode === 'move') {
        return { ...item, x: Math.max(0, Math.min(PAGE_W - item.w, drag.item.x + dx)), y: Math.max(0, Math.min(PAGE_H - item.h, drag.item.y + dy)) }
      }
      const ratio = drag.item.w / drag.item.h
      const w = Math.max(48, Math.min(PAGE_W - drag.item.x, drag.item.w + dx))
      const h = Math.min(PAGE_H - drag.item.y, w / ratio)
      return { ...item, w, h }
    })
    onChange(next)
  }

  const autoGrid = () => {
    const columns = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3
    const padding = 28
    const gap = 14
    const cellW = (PAGE_W - padding * 2 - gap * (columns - 1)) / columns
    const rows = Math.ceil(images.length / columns)
    const cellH = (PAGE_H - padding * 2 - gap * (rows - 1)) / rows
    onChange(images.map((item, index) => {
      const ratio = item.w / item.h
      let w = cellW
      let h = w / ratio
      if (h > cellH) { h = cellH; w = h * ratio }
      return { ...item, w, h, x: padding + (index % columns) * (cellW + gap) + (cellW - w) / 2, y: padding + Math.floor(index / columns) * (cellH + gap) + (cellH - h) / 2 }
    }))
  }

  const removeSelected = () => {
    if (!selected) return
    onChange(images.filter((item) => item.id !== selected))
    setSelected(null)
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-muted/40 text-foreground">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div><p className="text-sm font-semibold">Arrange on A4</p><p className="text-xs text-muted-foreground">{images.length} photo{images.length === 1 ? '' : 's'} · drag or resize</p></div>
        <Button variant="ghost" size="icon" onClick={onAddPhoto} aria-label="Add Photo"><Plus /></Button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 border-b bg-background px-3 py-2">
        <Button size="sm" variant="outline" onClick={onAddPhoto}><Plus data-icon="inline-start" />Add Photo</Button>
        <Button size="sm" variant="outline" onClick={autoGrid}><WandSparkles data-icon="inline-start" />Auto Grid</Button>
        {selected && <Button size="sm" variant="outline" onClick={removeSelected}><Trash2 data-icon="inline-start" />Delete</Button>}
        <Button size="sm" variant="ghost" onClick={() => { onChange([]); setSelected(null) }}><X data-icon="inline-start" />Clear All</Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <div ref={pageRef} className="relative aspect-[595/842] w-full max-w-[595px] bg-white shadow-xl" onPointerMove={updateDrag} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
          {images.map((item) => (
            <div key={item.id} className={`absolute touch-none select-none ${selected === item.id ? 'ring-2 ring-primary ring-offset-2' : 'ring-1 ring-black/10'}`} style={{ left: item.x * scale, top: item.y * scale, width: item.w * scale, height: item.h * scale }} onPointerDown={(event) => { event.stopPropagation(); setSelected(item.id); dragRef.current = { id: item.id, mode: 'move', sx: event.clientX, sy: event.clientY, item } }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.src} alt="Placed document" className="h-full w-full object-fill" draggable={false} />
              {selected === item.id && <button aria-label="Resize image" className="absolute -bottom-3 -right-3 size-6 rounded-full border-2 border-primary bg-background shadow" onPointerDown={(event) => { event.stopPropagation(); dragRef.current = { id: item.id, mode: 'resize', sx: event.clientX, sy: event.clientY, item } }} />}
            </div>
          ))}
          {images.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">Add a photo to begin</p>}
        </div>
      </div>
      <div className="border-t bg-background p-3"><Button className="h-12 w-full" disabled={images.length === 0} onClick={onConvert}><Check data-icon="inline-start" />Convert to PDF</Button></div>
    </main>
  )
}

export { PAGE_W, PAGE_H }
