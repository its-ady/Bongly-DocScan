// Client-side image utilities: cropping and compression to a target file size.

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Crop an image (data URL) to the given rectangle expressed in NATURAL pixel
 * coordinates of the source image. Returns a JPEG data URL.
 */
export async function cropImage(src: string, rect: CropRect, options?: { width?: number; height?: number; mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'; quality?: number }): Promise<string> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  const sourceW = Math.max(1, Math.round(rect.width))
  const sourceH = Math.max(1, Math.round(rect.height))
  const w = options?.width ?? sourceW
  const h = options?.height ?? sourceH
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    Math.round(rect.x),
    Math.round(rect.y),
    sourceW,
    sourceH,
    0,
    0,
    w,
    h,
  )
  return canvas.toDataURL(options?.mimeType ?? 'image/jpeg', options?.quality ?? 1.0)
}

/**
 * A simple automatic edge detection that returns a suggested crop rectangle.
 * It scans for the document boundary by detecting where pixel brightness
 * differs from the (usually darker) background border. Falls back to an inset
 * rectangle when no clear edges are found.
 */
export async function detectDocumentRect(src: string): Promise<CropRect> {
  const img = await loadImage(src)
  const W = img.naturalWidth
  const H = img.naturalHeight

  // Downscale for fast analysis
  const scale = Math.min(1, 480 / Math.max(W, H))
  const sw = Math.max(1, Math.round(W * scale))
  const sh = Math.max(1, Math.round(H * scale))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, sw, sh)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, sw, sh).data
  } catch {
    return insetRect(W, H)
  }

  const lum = (x: number, y: number) => {
    const i = (y * sw + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  // Estimate background brightness from the outer 4px border.
  let bgSum = 0
  let bgCount = 0
  const b = 3
  for (let x = 0; x < sw; x++) {
    for (let y = 0; y < b; y++) {
      bgSum += lum(x, y)
      bgSum += lum(x, sh - 1 - y)
      bgCount += 2
    }
  }
  const bg = bgSum / Math.max(1, bgCount)

  // A pixel belongs to the document if it differs enough from background.
  const threshold = 30
  const isDoc = (x: number, y: number) => Math.abs(lum(x, y) - bg) > threshold

  let minX = sw
  let minY = sh
  let maxX = 0
  let maxY = 0
  let found = false
  // Sample on a grid for speed
  const step = 2
  for (let y = 0; y < sh; y += step) {
    for (let x = 0; x < sw; x += step) {
      if (isDoc(x, y)) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        found = true
      }
    }
  }

  if (!found || maxX - minX < sw * 0.3 || maxY - minY < sh * 0.3) {
    return insetRect(W, H)
  }

  // small padding, convert back to natural coordinates
  const pad = 4
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(sw, maxX + pad)
  maxY = Math.min(sh, maxY + pad)

  return {
    x: minX / scale,
    y: minY / scale,
    width: (maxX - minX) / scale,
    height: (maxY - minY) / scale,
  }
}

function insetRect(W: number, H: number): CropRect {
  const m = 0.06
  return {
    x: W * m,
    y: H * m,
    width: W * (1 - 2 * m),
    height: H * (1 - 2 * m),
  }
}

/**
 * Rotate an image 90 degrees clockwise. Width/height are swapped, so the
 * caller should re-detect the crop area afterwards.
 */
export async function rotateImage90(src: string): Promise<string> {
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = h
  canvas.height = w
  const ctx = canvas.getContext('2d')!
  ctx.translate(h, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/jpeg', 1.0)
}

/**
 * Auto-enhance a dull / blurry photo: boosts contrast, brightness and
 * saturation for a crisper, clearer look. Dimensions are unchanged, so an
 * existing crop stays valid.
 */
export async function enhanceImage(src: string): Promise<string> {
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // CSS-style filters give a good, cheap clean-up effect for ID photos.
  ctx.filter = 'contrast(1.25) brightness(1.08) saturate(1.15)'
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/jpeg', 1.0)
}

// ---------------------------------------------------------------------------
// 4-corner (quadrilateral) crop + perspective straightening
// ---------------------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

// Corners in NATURAL image pixels, clockwise from top-left.
export interface Quad {
  tl: Point
  tr: Point
  br: Point
  bl: Point
}

export function rectToQuad(r: CropRect): Quad {
  return {
    tl: { x: r.x, y: r.y },
    tr: { x: r.x + r.width, y: r.y },
    br: { x: r.x + r.width, y: r.y + r.height },
    bl: { x: r.x, y: r.y + r.height },
  }
}

/**
 * Suggest a 4-corner crop. Reuses the rectangle edge detection and returns its
 * four corners, so the user starts from a sensible box and can then pull each
 * corner independently to match a slightly skewed card.
 */
export async function detectDocumentQuad(src: string): Promise<Quad> {
  const rect = await detectDocumentRect(src)
  return rectToQuad(rect)
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Solve the 8-DOF perspective transform mapping `from[4]` -> `to[4]`.
// Returns a 9-element homography matrix (row-major, h8 = 1).
function solvePerspective(from: Point[], to: Point[]): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: X, y: Y } = to[i]
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    b.push(Y)
  }
  // Gaussian elimination with partial pivoting on the 8x8 system.
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    }
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    const div = A[col][col] || 1e-9
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = A[r][col] / div
      for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c]
      b[r] -= factor * b[col]
    }
  }
  const h = new Array(9)
  for (let i = 0; i < n; i++) h[i] = b[i] / (A[i][i] || 1e-9)
  h[8] = 1
  return h
}

/**
 * Warp the quadrilateral region of `src` into a straight, upright rectangle
 * (perspective correction). The output keeps the quad's own proportions, so a
 * slightly tilted card comes out square without stretching or cropping content.
 */
export async function warpPerspective(
  src: string,
  quad: Quad,
  maxLongEdge = 1800,
): Promise<string> {
  const img = await loadImage(src)
  const sw = img.naturalWidth
  const sh = img.naturalHeight

  const sc = document.createElement('canvas')
  sc.width = sw
  sc.height = sh
  const sctx = sc.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(img, 0, 0)
  const sdata = sctx.getImageData(0, 0, sw, sh).data

  // Output dimensions from the quad's edge lengths.
  const wTop = dist(quad.tl, quad.tr)
  const wBottom = dist(quad.bl, quad.br)
  const hLeft = dist(quad.tl, quad.bl)
  const hRight = dist(quad.tr, quad.br)
  let outW = Math.round(Math.max(wTop, wBottom))
  let outH = Math.round(Math.max(hLeft, hRight))
  const long = Math.max(outW, outH)
  if (long > maxLongEdge) {
    const s = maxLongEdge / long
    outW = Math.round(outW * s)
    outH = Math.round(outH * s)
  }
  outW = Math.max(1, outW)
  outH = Math.max(1, outH)

  // Map every output (dst) pixel back to a source coordinate.
  const dstCorners: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]
  const srcCorners: Point[] = [quad.tl, quad.tr, quad.br, quad.bl]
  const H = solvePerspective(dstCorners, srcCorners)

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')!
  const odata = octx.createImageData(outW, outH)
  const op = odata.data

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const denom = H[6] * u + H[7] * v + H[8]
      const fx = (H[0] * u + H[1] * v + H[2]) / denom
      const fy = (H[3] * u + H[4] * v + H[5]) / denom
      const oi = (v * outW + u) * 4
      if (fx < 0 || fy < 0 || fx >= sw - 1 || fy >= sh - 1) {
        op[oi] = 255
        op[oi + 1] = 255
        op[oi + 2] = 255
        op[oi + 3] = 255
        continue
      }
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const dx = fx - x0
      const dy = fy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      for (let c = 0; c < 3; c++) {
        const top = sdata[i00 + c] * (1 - dx) + sdata[i10 + c] * dx
        const bot = sdata[i01 + c] * (1 - dx) + sdata[i11 + c] * dx
        op[oi + c] = top * (1 - dy) + bot * dy
      }
      op[oi + 3] = 255
    }
  }

  octx.putImageData(odata, 0, 0)
  return out.toDataURL('image/jpeg', 0.95)
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || ''
  // base64 length to bytes
  const padding = (base64.match(/=+$/) || [''])[0].length
  return Math.floor((base64.length * 3) / 4) - padding
}

/**
 * Compress an image (data URL) so its size is at or below maxKB.
 * Reduces JPEG quality first, then scales dimensions down if needed.
 * Returns a JPEG data URL. If maxKB is null, re-encodes at high quality.
 */
export async function compressImage(
  src: string,
  maxKB: number | null,
): Promise<string> {
  const img = await loadImage(src)

  const render = (scale: number, quality: number): string => {
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  }

  if (maxKB === null) {
    return render(1, 1.0)
  }

  const maxBytes = maxKB * 1024
  let bestResult = render(0.3, 0.05) // Extreme fallback
  let bestSize = dataUrlBytes(bestResult)

  // Phase 1: Try quality reduction at full scale (finest granularity at full resolution)
  for (const q of [
    0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2,
    0.15, 0.1, 0.08, 0.06, 0.05,
  ]) {
    const out = render(1, q)
    const size = dataUrlBytes(out)
    if (size <= maxBytes) {
      console.log(`[v0] Compressed to ${(size / 1024).toFixed(2)}KB at scale=1.0 quality=${q}`)
      return out
    }
    if (size < bestSize) {
      bestResult = out
      bestSize = size
    }
  }

  // Phase 2: Scale down aggressively, testing each scale with multiple qualities
  let scale = 0.9
  while (scale > 0.1) {
    for (const q of [0.75, 0.6, 0.45, 0.3, 0.15, 0.08]) {
      const out = render(scale, q)
      const size = dataUrlBytes(out)
      if (size <= maxBytes) {
        console.log(
          `[v0] Compressed to ${(size / 1024).toFixed(2)}KB at scale=${scale.toFixed(2)} quality=${q}`,
        )
        return out
      }
      if (size < bestSize) {
        bestResult = out
        bestSize = size
      }
    }
    scale *= 0.8
  }

  // Phase 3: Final extreme scaling
  for (let scale = 0.1; scale >= 0.05; scale -= 0.01) {
    const out = render(scale, 0.1)
    const size = dataUrlBytes(out)
    if (size <= maxBytes) {
      console.log(`[v0] Compressed to ${(size / 1024).toFixed(2)}KB at scale=${scale.toFixed(2)} quality=0.1`)
      return out
    }
    if (size < bestSize) {
      bestResult = out
      bestSize = size
    }
  }

  // Final fallback: return the smallest we could produce
  console.log(`[v0] Fallback: ${(bestSize / 1024).toFixed(2)}KB (target was ${maxKB}KB)`)
  return bestResult
}
