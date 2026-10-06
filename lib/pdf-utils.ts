import { jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import type { OtherImage } from '@/lib/types'

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
  maxKBForExportSize,
  exportByteLimit,
} from '@/lib/types'

function maxKBFor(size: ExportSize): number | null {
  return maxKBForExportSize(size)
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
  const numSides = config.sides.filter((side) => data[side]).length
  const build = async (perImageKB: number | null): Promise<Blob> => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    const images: PdfImage[] = []

    for (const side of config.sides) {
      const raw = data[side]
      if (!raw) continue
      const processed = await compressImage(raw, perImageKB)
      const { w, h } = await imageDims(processed)
      images.push({ src: processed, w, h })
    }

    if (images.length > 0) layoutSinglePage(doc, images)
    return doc.output('blob')
  }

  if (maxKB === null || numSides === 0) return build(null)

  const maxBytes = exportByteLimit(exportSize)!
  // Reserve space for the PDF container, then verify the complete PDF because
  // jsPDF overhead varies with image dimensions and document metadata.
  let perImageKB = Math.max(2, Math.floor(Math.max(2, maxKB - 16) / numSides))
  let blob = await build(perImageKB)

  for (let attempt = 0; attempt < 8 && blob.size > maxBytes; attempt++) {
    const ratio = Math.sqrt(maxBytes / blob.size) * 0.96
    const nextBudget = Math.max(2, Math.floor(perImageKB * ratio))
    if (nextBudget >= perImageKB) break
    perImageKB = nextBudget
    blob = await build(perImageKB)
  }

  if (blob.size > maxBytes) {
    throw new Error(`Unable to create ${getDocConfig(id).name} PDF below ${Math.max(1, maxKB - 2)} KB.`)
  }
  return blob
}

export async function buildOthersPdf(images: OtherImage[], exportSize: ExportSize): Promise<Blob> {
  const maxKB = maxKBFor(exportSize)

  // Unlike jsPDF, pdf-lib adds image and object-stream overhead after the JPEGs
  // have been encoded. Build the complete PDF and measure it, rather than
  // assuming that the per-image JPEG budget is the final PDF size.
  const build = async (perImageKB: number | null): Promise<Uint8Array> => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595, 842])

    for (const image of images) {
      const compressed = await compressImage(image.src, perImageKB)
      const base64 = compressed.split(',')[1]
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const embedded = await pdf.embedJpg(bytes)
      page.drawImage(embedded, {
        x: image.x,
        y: 842 - image.y - image.h,
        width: image.w,
        height: image.h,
      })
    }

    return pdf.save({ useObjectStreams: true })
  }

  if (maxKB === null || images.length === 0) {
    const bytes = await build(null)
    return new Blob([bytes], { type: 'application/pdf' })
  }

  const maxBytes = exportByteLimit(exportSize)!
  // Leave room for the PDF catalog, page, fonts/metadata, and image objects.
  let perImageKB = Math.max(5, Math.floor((maxKB - 12) / images.length))
  let bytes = await build(perImageKB)

  // Rebuild against the measured PDF size. This matters most for Others Docs,
  // where several images share one PDF page and pdf-lib overhead is variable.
  for (let attempt = 0; attempt < 6 && bytes.byteLength > maxBytes; attempt++) {
    const ratio = Math.sqrt(maxBytes / bytes.byteLength) * 0.96
    const nextBudget = Math.max(2, Math.floor(perImageKB * ratio))
    if (nextBudget >= perImageKB) break
    perImageKB = nextBudget
    bytes = await build(perImageKB)
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(`Unable to create Others Docs PDF below ${Math.max(1, maxKB - 2)} KB.`)
  }
  return new Blob([bytes], { type: 'application/pdf' })
}

export function pdfFileName(customerName: string, id: DocId): string {
  const safeName = (customerName || 'Customer').replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'Customer'
  if (id === 'others') return `${safeName}_Others Docs.pdf`
  const label = getDocConfig(id).name.split(' ')[0]
  return `${safeName}_${label}.pdf`
}

function imageFileName(customerName: string, src: string): string {
  const safeName = (customerName || 'Customer').replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'Customer'
  const extension = src.startsWith('data:image/png') ? 'png' : 'jpg'
  return `${safeName}_Image.${extension}`
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
  failures: string[]
  notices: string[]
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
  const maxKB = maxKBFor(exportSize)

  // Build all files first so PDFs and Image Tools output are exported together.
  const built: { name: string; blob: Blob }[] = []
  const failures: string[] = []
  const notices: string[] = []
  for (const config of completed) {
    try {
    if (config.id === 'image-tools') {
      // Older sessions may have stored the single image under `back`; accept
      // both keys so the dashboard and export stay in sync after navigation.
      const src = docs['image-tools'].front ?? docs['image-tools'].back
      if (!src) continue
      const mimeType = src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
      let output: string
      let usedJpegFallback = false
      try {
        output = await compressImage(src, maxKB, mimeType)
      } catch (error) {
        if (mimeType !== 'image/png') throw error
        output = await compressImage(src, maxKB, 'image/jpeg')
        usedJpegFallback = true
        notices.push('PNG এই সাইজে হয় না, JPG সেভ হয়েছে')
      }
      const blob = await (await fetch(output)).blob()
      const limit = exportByteLimit(exportSize)
      if (limit !== null && blob.size > limit) {
        throw new Error(`Image Tools export must be below ${Math.max(1, maxKB! - 2)} KB.`)
      }
      built.push({ name: imageFileName(customerName, output), blob })
      continue
    }

    const blob = config.id === 'others'
      ? await buildOthersPdf(docs.others.images ?? [], exportSize)
      : await buildDocPdf(config.id, docs[config.id], exportSize)
    built.push({
      name: pdfFileName(customerName, config.id),
      blob,
    })
    } catch (error) {
      const name = config.name
      const message = error instanceof Error ? error.message : 'Unknown export error.'
      failures.push(`${name}: ${message}`)
    }
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
      return { count: built.length, method: 'folder', failures, notices }
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
  return { count: built.length, method: 'downloads', failures, notices }
}
