'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  Camera,
  RotateCcw,
  Check,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Download,
  Image as ImageIcon,
  Zap,
  RotateCw,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CropEditor } from '@/components/crop-editor'
import { ArrangeEditor, type PlacedImage } from '@/components/arrange-editor'
import { useSession } from '@/lib/session-store'
import {
  warpPerspective,
  detectDocumentQuad,
  rotateImage90,
  enhanceImage,
  type Quad,
} from '@/lib/image-utils'
import { buildOthersPdf, downloadSingleDoc, othersPdfFileName } from '@/lib/pdf-utils'
import { DOC_CONFIGS, getDocConfig, type DocId } from '@/lib/types'

type Phase = 'camera' | 'crop' | 'preview' | 'arrange' | 'done'

interface Props {
  docId: DocId
  onExit: () => void
  onScanDoc: (docId: DocId) => void
}

export function Scanner({ docId, onExit, onScanDoc }: Props) {
  const config = getDocConfig(docId)
  const { customerName, setDocSide, setOtherImages, docs, exportSize } = useSession()

  const [sideIndex, setSideIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('camera')
  const [capturedSrc, setCapturedSrc] = useState<string | null>(null)
  const [enhancedSrc, setEnhancedSrc] = useState<string | null>(null)
  const [enhanced, setEnhanced] = useState(false)
  const [cropQuad, setCropQuad] = useState<Quad | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [flashOn, setFlashOn] = useState(false)
  const [arrangedImages, setArrangedImages] = useState<PlacedImage[]>([])
  const [arrangeMode, setArrangeMode] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveQuadRef = useRef<Quad | null>(null)

  const currentSide = config.sides[sideIndex]
  // Image currently shown in the crop editor (enhanced version when toggled on).
  const displaySrc = enhanced && enhancedSrc ? enhancedSrc : capturedSrc

  // Reset everything when the document changes (Scan Next Document).
  useEffect(() => {
    setSideIndex(0)
    setPhase('camera')
    setCapturedSrc(null)
    setEnhancedSrc(null)
    setEnhanced(false)
    setCropQuad(null)
    setPreviewSrc(null)
    setArrangedImages(docId === 'others' ? (docs.others.images ?? []) : [])
    setArrangeMode(docId === 'others')
  }, [docId])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const toggleFlash = useCallback(async () => {
    const stream = streamRef.current
    if (!stream) return
    try {
      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        const capabilities = (videoTrack.getCapabilities && videoTrack.getCapabilities()) as any
        if (capabilities?.torch) {
          await videoTrack.applyConstraints({ advanced: [{ torch: !flashOn }] } as any)
          setFlashOn(!flashOn)
        }
      }
    } catch (e) {
      console.error('Flashlight toggle failed:', e)
    }
  }, [flashOn])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    stopCamera()
    setFlashOn(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
    } catch {
      setCameraError(
        'Cannot access the camera. Please allow camera permission, or use a device with a camera.',
      )
    }
  }, [stopCamera])

  // Manage camera lifecycle based on phase.
  useEffect(() => {
    if (phase === 'camera') {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [phase, startCamera, stopCamera])

  const capture = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    setProcessing(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      const src = canvas.toDataURL('image/jpeg', 0.95)
      setCapturedSrc(src)
      const detected = await detectDocumentQuad(src)
      setCropQuad(detected)
      liveQuadRef.current = detected
      setPhase('crop')
    } catch {
      toast.error('Capture failed, please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const retake = () => {
    setCapturedSrc(null)
    setEnhancedSrc(null)
    setEnhanced(false)
    setCropQuad(null)
    setPreviewSrc(null)
    setPhase('camera')
  }

  // Rotate the working image 90° clockwise and re-detect the crop box.
  const rotate = async () => {
    if (!capturedSrc) return
    setProcessing(true)
    try {
      const rotated = await rotateImage90(capturedSrc)
      setCapturedSrc(rotated)
      // Rotation changes dimensions, so drop any cached enhanced copy.
      setEnhancedSrc(null)
      setEnhanced(false)
      const detected = await detectDocumentQuad(rotated)
      setCropQuad(detected)
      liveQuadRef.current = detected
    } catch {
      toast.error('Could not rotate the image.')
    } finally {
      setProcessing(false)
    }
  }

  // Toggle auto-enhance: first tap enhances, second tap reverts to original.
  const toggleEnhance = async () => {
    if (!capturedSrc) return
    if (enhanced) {
      setEnhanced(false)
      return
    }
    setProcessing(true)
    try {
      const src = enhancedSrc ?? (await enhanceImage(capturedSrc))
      setEnhancedSrc(src)
      setEnhanced(true)
    } catch {
      toast.error('Could not enhance the image.')
    } finally {
      setProcessing(false)
    }
  }

  const handleGallerySelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    setProcessing(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const src = e.target?.result as string
        setCapturedSrc(src)
        const detected = await detectDocumentQuad(src)
        setCropQuad(detected)
        liveQuadRef.current = detected
        setPhase('crop')
        setProcessing(false)
      }
      reader.readAsDataURL(file)
    } catch {
      toast.error('Could not load the image.')
      setProcessing(false)
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Straighten (perspective correct) the selected quad and show a preview.
  const processCrop = async () => {
    if (!displaySrc || !liveQuadRef.current) return
    setProcessing(true)
    try {
      const straightened = await warpPerspective(displaySrc, liveQuadRef.current)
      setPreviewSrc(straightened)
      setPhase('preview')
    } catch {
      toast.error('Could not crop the image.')
    } finally {
      setProcessing(false)
    }
  }

  // Back to the crop step to re-adjust the corners.
  const editCrop = () => {
    setPreviewSrc(null)
    setPhase('crop')
  }

  // Accept the straightened preview and move on.
  const acceptPreview = () => {
    if (!previewSrc) return
    if (docId === 'others') {
      const image = new Image()
      image.onload = () => {
        const width = 260
        setArrangedImages((items) => {
          const next = [...items, { id: crypto.randomUUID(), src: previewSrc, x: 32, y: 32, w: width, h: width * image.height / image.width }]
          setOtherImages(next)
          return next
        })
        setPhase('arrange')
      }
      image.src = previewSrc
      return
    }
    setDocSide(docId, currentSide, previewSrc)
    const isLastSide = sideIndex >= config.sides.length - 1
    if (isLastSide) {
      setPhase('done')
    } else {
      setSideIndex((i) => i + 1)
      setCapturedSrc(null)
      setEnhancedSrc(null)
      setEnhanced(false)
      setCropQuad(null)
      setPreviewSrc(null)
      setPhase('camera')
    }
  }

  const handleSavePdf = async () => {
    setProcessing(true)
    try {
      if (docId === 'others') {
        const blob = await buildOthersPdf(arrangedImages, exportSize)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = othersPdfFileName(customerName)
        anchor.click()
        URL.revokeObjectURL(url)
      } else {
        await downloadSingleDoc(customerName, docId, docs[docId], exportSize)
      }
      toast.success(`${config.name} PDF saved.`)
    } catch {
      toast.error('Could not generate the PDF.')
    } finally {
      setProcessing(false)
    }
  }

  // Determine the next document for "Scan Next Document".
  const currentDocOrder = DOC_CONFIGS.findIndex((d) => d.id === docId)
  const nextDoc = DOC_CONFIGS[currentDocOrder + 1]

  const sideLabel = currentSide === 'front' ? 'Front' : 'Back'
  const stepText =
    config.sides.length > 1
      ? `${sideLabel} side (${sideIndex + 1}/${config.sides.length})`
      : 'Single side'

  return (
    <main className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            stopCamera()
            onExit()
          }}
          className="text-white hover:bg-white/10 hover:text-white"
          aria-label="Close scanner"
        >
          <X className="h-6 w-6" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{config.name}</p>
          {phase !== 'done' && (
            <p className="text-xs text-white/70">{stepText}</p>
          )}
        </div>
        <div className="w-10" />
      </header>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden">
        {phase === 'camera' && (
          <>
            {cameraError ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                <AlertTriangle className="h-10 w-10 text-white/70" />
                <p className="text-pretty text-sm leading-relaxed text-white/80">
                  {cameraError}
                </p>
                <Button onClick={startCamera} variant="secondary">
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                />
                {/* framing guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="aspect-[1.586/1] w-full max-w-md rounded-xl border-2 border-dashed border-white/60" />
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
                  <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white">
                    Align the {sideLabel.toLowerCase()} of the card in the frame
                  </span>
                </div>
                {/* Flash button */}
                <button
                  onClick={toggleFlash}
                  className="absolute right-4 top-20 flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
                  aria-label="Toggle flashlight"
                >
                  <Zap className={`h-6 w-6 ${flashOn ? 'fill-yellow-300 text-yellow-300' : ''}`} />
                </button>
              </>
            )}
          </>
        )}

        {phase === 'crop' && displaySrc && cropQuad && (
          <>
            <CropEditor
              src={displaySrc}
              initialQuad={cropQuad}
              onChange={(q) => {
                liveQuadRef.current = q
              }}
            />
            {/* Small rotate + auto-enhance toolbar */}
            <div className="absolute right-3 top-3 flex flex-col gap-2">
              <button
                onClick={rotate}
                disabled={processing}
                aria-label="Rotate 90 degrees"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/70 disabled:opacity-50"
              >
                <RotateCw className="h-5 w-5" />
              </button>
              <button
                onClick={toggleEnhance}
                disabled={processing}
                aria-label="Auto enhance"
                aria-pressed={enhanced}
                className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur transition-colors disabled:opacity-50 ${
                  enhanced
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-black/55 text-white hover:bg-black/70'
                }`}
              >
                <Sparkles className="h-5 w-5" />
              </button>
            </div>
          </>
        )}

        {phase === 'arrange' && (
          <ArrangeEditor
            images={arrangedImages}
            onChange={(next) => {
              setArrangedImages(next)
              setOtherImages(next)
            }}
            onAddPhoto={() => { setCapturedSrc(null); setPreviewSrc(null); setPhase('camera') }}
            onConvert={() => setPhase('done')}
          />
        )}

        {phase === 'preview' && previewSrc && (
          <div className="flex h-full w-full items-center justify-center bg-black p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc || '/placeholder.svg'}
              alt="Straightened document preview"
              className="max-h-full max-w-full rounded-md object-contain shadow-lg"
            />
          </div>
        )}

        {phase === 'done' && (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/20">
              <CheckCircle2 className="h-12 w-12 text-accent" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {config.name} captured
              </h2>
              <p className="mt-1 text-sm text-white/70">
                {customerName}_{config.name.split(' ')[0]}.pdf is ready.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <footer className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {phase === 'camera' && !cameraError && (
          <div className="flex items-center justify-center gap-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleGallerySelect}
              className="hidden"
              aria-label="Select image from gallery"
              disabled={processing}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              aria-label="Select from gallery"
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/40 bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
            >
              <ImageIcon className="h-7 w-7" />
            </button>
            <button
              onClick={capture}
              disabled={processing}
              aria-label="Capture"
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 p-1 disabled:opacity-50"
            >
              <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-primary">
                {processing ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : (
                  <Camera className="h-7 w-7" />
                )}
              </span>
            </button>
          </div>
        )}

        {phase === 'crop' && (
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            <p className="text-center text-xs text-white/70">
              Drag each of the 4 corners to the edges of the card. It will be
              straightened automatically.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={retake}
                disabled={processing}
                className="h-12 flex-1"
              >
                <RotateCcw className="h-5 w-5" />
                Retake
              </Button>
              <Button
                onClick={processCrop}
                disabled={processing}
                className="h-12 flex-1"
              >
                {processing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Check className="h-5 w-5" />
                )}
                Straighten
              </Button>
            </div>
          </div>
        )}

        {phase === 'preview' && (
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            <p className="text-center text-xs text-white/70">
              Straightened preview. Looks good?
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={editCrop}
                disabled={processing}
                className="h-12 flex-1"
              >
                <RotateCcw className="h-5 w-5" />
                Adjust
              </Button>
              <Button
                onClick={acceptPreview}
                disabled={processing}
                className="h-12 flex-1"
              >
                <Check className="h-5 w-5" />
                {sideIndex >= config.sides.length - 1 ? 'Done' : 'Next side'}
              </Button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            <Button
              variant="secondary"
              onClick={handleSavePdf}
              disabled={processing}
              className="h-12 w-full"
            >
              {processing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              Save this PDF now
            </Button>
            {nextDoc ? (
              <Button
                onClick={() => onScanDoc(nextDoc.id)}
                className="h-12 w-full text-base font-semibold"
              >
                Scan Next: {nextDoc.name}
                <ArrowRight className="h-5 w-5" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                stopCamera()
                onExit()
              }}
              className="h-12 w-full text-white hover:bg-white/10 hover:text-white"
            >
              Back to Dashboard
            </Button>
          </div>
        )}
      </footer>
    </main>
  )
}
