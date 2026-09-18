import { jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import type { PlacedImage } from '@/components/arrange-editor'

type PdfImage = { src: string; w: number; h: number }
import { compressImage } from '@/lib/image-utils'
import {
  DOC_CONFIGS,
  getDocConfig,
  isDocComplete,
  type DocData,
  type DocId,
  type DocStore,
  type ExportSize,
} from '@/lib/types'
import { EXPORT_SIZE_OPTIONS } from '@/lib/types'

function maxKBFor(size: ExportSize): number | null {
  return EXPORT_SIZE_OPTIONS.find((o) => o.value === size)?.maxKB ?? null
}

function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}

// A4 in mm
const A4_W = 210

// Layout constants (mm)
const TOP_MARGIN = 50 // 5 cm gap from the top edge of the page
const CARD_GAP = 10 // 1 cm gap between the two cards (front/back)

// Real-world card sizes (mm). We do NOT force a fixed W x H — instead we pick
// the correct LONG edge from the image's own aspect ratio and derive the short
// edge from that same ratio, so the card keeps its exact proportions and is
// never stretched or cropped.
const STD_LONG = 85.6 // Aadhaar / PAN / new voter: 85.6 x 54  (ratio ~1.585)
const OLD_LONG = 90 // old voter / ration: 90 x 70            (ratio ~1.286)
// Midpoint between the two ratios; above this we treat it as a standard card.
const RATIO_THRESHOLD = 1.43


// Portrait = held vertically (taller than wide). Square counts as portrait.
function isPortrait(img: PdfImage): boolean {
  return img.h >= img.w
}

// Draw size (mm) close to the real card, keeping the image's exact aspect.
function realSizeMM(img: PdfImage): { w: number; h: number } {
  const longPx = Math.max(img.w, img.h)
  const shortPx = Math.max(1, Math.min(img.w, img.h))
  const ratio = longPx / shortPx // always >= 1
  const longMM = ratio >= RATIO_THRESHOLD ? STD_LONG : OLD_LONG
  const shortMM = longMM / ratio
  // Orient the mm box to match the image orientation.
  return isPortrait(img)
    ? { w: shortMM, h: longMM }
    : { w: longMM, h: shortMM }
}

/**
 * Place all sides of a single document on ONE A4 page at ~real card size.
 * - 5 cm gap from the top, cards centered horizontally, 1 cm between them.
 * - Portrait cards sit SIDE BY SIDE; landscape cards sit TOP TO BOTTOM.
 * - Plenty of empty space is left on both sides and at the bottom.
 */
function layoutSinglePage(doc: jsPDF, images: PdfImage[]) {
  if (images.length === 1) {
    const img = images[0]
    const s = realSizeMM(img)
    const x = (A4_W - s.w) / 2
    const y = TOP_MARGIN
    doc.addImage(img.src, 'JPEG', x, y, s.w, s.h, undefined, 'FAST')
    return
  }

  const [a, b] = images
  const sA = realSizeMM(a)
  const sB = realSizeMM(b)

  if (isPortrait(a)) {
    // Side by side, pair centered horizontally, tops aligned 5 cm from the top.
    const totalW = sA.w + CARD_GAP + sB.w
    const startX = (A4_W - totalW) / 2
    const y = TOP_MARGIN
    doc.addImage(a.src, 'JPEG', startX, y, sA.w, sA.h, undefined, 'FAST')
    doc.addImage(b.src, 'JPEG', startX + sA.w + CARD_GAP, y, sB.w, sB.h, undefined, 'FAST')
  } else {
    // Top to bottom, each card centered horizontally, 1 cm between them.
    const xA = (A4_W - sA.w) / 2
    const xB = (A4_W - sB.w) / 2
    const yA = TOP_MARGIN
    const yB = TOP_MARGIN + sA.h + CARD_GAP
    doc.addImage(a.src, 'JPEG', xA, yA, sA.w, sA.h, undefined, 'FAST')
    doc.addImage(b.src, 'JPEG', xB, yB, sB.w, sB.h, undefined, 'FAST')
  }
}

/**
 * Build a single document's PDF as a Blob.
 * Front and Back are placed together on ONE A4 page (side-by-side or
 * top-bottom depending on the image sizes).
 */
export async function buildDocPdf(
  id: DocId,
  data: DocData,
  exportSize: ExportSize,
): Promise<Blob> {
  const config = getDocConfig(id)
  const maxKB = maxKBFor(exportSize)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })

  // Estimate PDF overhead (header, metadata, etc.) - roughly 5-10 KB for A4 page
  const pdfOverheadKB = 8
  const numSides = config.sides.filter((side) => data[side]).length
  
  // Divide remaining budget equally among images
  // E.g., if maxKB is 200 and we have 2 images, each gets ~96 KB max
  let perImageKB: number | null = null
  if (maxKB && numSides > 0) {
    const availableKB = Math.max(5, maxKB - pdfOverheadKB)
    perImageKB = Math.floor(availableKB / numSides)
  }

  const images: PdfImage[] = []
  for (const side of config.sides) {
    const raw = data[side]
    if (!raw) continue
    const processed = await compressImage(raw, perImageKB)
    const { w, h } = await imageDims(processed)
    images.push({ src: processed, w, h })
  }

  if (images.length > 0) {
    layoutSinglePage(doc, images)
  }

  return doc.output('blob')
}

export async function buildOthersPdf(images: PlacedImage[], exportSize: ExportSize): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  for (const image of images) {
    const base64 = image.src.split(',')[1]
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const embedded = image.src.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    page.drawImage(embedded, { x: image.x, y: 842 - image.y - image.h, width: image.w, height: image.h })
  }
  const bytes = await pdf.save({ useObjectStreams: true })
  return new Blob([bytes], { type: 'application/pdf' })
}

export function othersPdfFileName(customerName: string): string {
  const safeName = (customerName || 'Customer').replace(/[^\\p{L}\\p{N}_ -]/gu, '').trim() || 'Customer'
  return `${safeName}_Others Docs.pdf`
}

export function pdfFileName(customerName: string, id: DocId): string {
  const safeName = (customerName || 'Customer').replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'Customer'
  const label = getDocConfig(id).name.split(' ')[0]
  return `${safeName}_${label}.pdf`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadSingleDoc(
  customerName: string,
  id: DocId,
  data: DocData,
  exportSize: ExportSize,
): Promise<void> {
  const blob = await buildDocPdf(id, data, exportSize)
  triggerDownload(blob, pdfFileName(customerName, id))
}

interface ExportResult {
  count: number
  method: 'folder' | 'downloads'
}

/**
 * Export all completed documents. Tries the File System Access API to write
 * the PDFs into a folder named after the customer; falls back to individual
 * downloads when not supported.
 */
export async function exportAllDocs(
  customerName: string,
  docs: DocStore,
  exportSize: ExportSize,
): Promise<ExportResult> {
  const completed = DOC_CONFIGS.filter((c) => isDocComplete(c, docs[c.id]))

  // Build all blobs first.
  const built: { name: string; blob: Blob }[] = []
  for (const config of completed) {
    const blob = await buildDocPdf(config.id, docs[config.id], exportSize)
    built.push({ name: pdfFileName(customerName, config.id), blob })
  }

  // Attempt folder export via File System Access API.
  const picker = (window as unknown as {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker

  if (typeof picker === 'function') {
    try {
      const dirHandle = await picker.call(window)
      const safeFolder =
        (customerName || 'Customer').replace(/[^\p{L}\p{N}_ -]/gu, '').trim() ||
        'Customer'
      let target: FileSystemDirectoryHandle = dirHandle
      try {
        target = await dirHandle.getDirectoryHandle(safeFolder, { create: true })
      } catch {
        target = dirHandle
      }
      for (const item of built) {
        const fileHandle = await target.getFileHandle(item.name, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(item.blob)
        await writable.close()
      }
      return { count: built.length, method: 'folder' }
    } catch (err) {
      // User cancelled or write failed -> fall through to downloads.
      if ((err as DOMException)?.name === 'AbortError') {
        throw err
      }
    }
  }

  // Fallback: trigger sequential downloads.
  for (let i = 0; i < built.length; i++) {
    const item = built[i]
    await new Promise((r) => setTimeout(r, i === 0 ? 0 : 400))
    triggerDownload(item.blob, item.name)
  }
  return { count: built.length, method: 'downloads' }
}
