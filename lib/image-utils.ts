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

export async function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  const image = await loadImage(src)
  return { width: image.naturalWidth, height: image.naturalHeight }
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
      // Clamp edge samples to the source image instead of painting out-of-bounds
      // pixels white. The old boundary check created a visible white strip when
      // the selected quad reached the right or bottom edge of the photo.
      const safeFx = Math.min(sw - 1, Math.max(0, fx))
      const safeFy = Math.min(sh - 1, Math.max(0, fy))
      const x0 = Math.floor(safeFx)
      const y0 = Math.floor(safeFy)
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const dx = safeFx - x0
      const dy = safeFy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
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
  const padding = (base64.match(/=+$/) || [''])[0].length
  return Math.floor((base64.length * 3) / 4) - padding
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',')
  const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(encoded ?? ''), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

/**
 * Encode an image and enforce the selected limit on the final encoded bytes.
 * The limit is a hard ceiling: the returned data URL is always measured after
 * encoding, not estimated from the source image or canvas dimensions.
 */
export async function compressImage(
  src: string,
  maxKB: number | null,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
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
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL(mimeType, mimeType === 'image/png' ? undefined : quality)
  }

  if (maxKB === null) return render(1, 1)

  const maxBytes = Math.floor(maxKB * 1024)
  let smallest: string | null = null
  let smallestBytes = Number.POSITIVE_INFINITY
  const remember = (candidate: string) => {
    const size = dataUrlBytes(candidate)
    if (size < smallestBytes) {
      smallest = candidate
      smallestBytes = size
    }
    return size
  }

  // Find the largest scale that can fit. PNG has no useful quality parameter,
  // so resolution is the only reliable way to enforce its final byte limit.
  let lowScale = 0.01
  let highScale = 1
  let accepted: string | null = null
  for (let attempt = 0; attempt < 14; attempt++) {
    const scale = (lowScale + highScale) / 2
    if (mimeType === 'image/png') {
      const candidate = render(scale, 1)
      if (remember(candidate) <= maxBytes) {
        accepted = candidate
        lowScale = scale
      } else {
        highScale = scale
      }
      continue
    }

    // At each scale, maximize JPEG quality while keeping the encoded bytes in
    // the limit. If even the lowest quality is too large, reduce the scale.
    let lowQuality = 0.05
    let highQuality = 1
    let qualityAccepted: string | null = null
    for (let qualityAttempt = 0; qualityAttempt < 10; qualityAttempt++) {
      const quality = (lowQuality + highQuality) / 2
      const candidate = render(scale, quality)
      if (remember(candidate) <= maxBytes) {
        qualityAccepted = candidate
        lowQuality = quality
      } else {
        highQuality = quality
      }
    }

    if (qualityAccepted) {
      accepted = qualityAccepted
      lowScale = scale
    } else {
      highScale = scale
    }
  }

  if (accepted && dataUrlBytes(accepted) <= maxBytes) return accepted
  throw new Error(
    `Unable to compress image below ${maxKB} KB (smallest result was ${(smallestBytes / 1024).toFixed(1)} KB).`,
  )
}
