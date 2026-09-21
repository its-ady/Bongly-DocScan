'use client'

import { useMemo, useState } from 'react'
import {
  Settings,
  CheckCircle2,
  Circle,
  Download,
  LogOut,
  CreditCard,
  Vote,
  IdCard,
  Wheat,
  Files,
  Image,
  ChevronRight,
  Loader2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session-store'
import { DOC_CONFIGS, isDocComplete, type DocId } from '@/lib/types'
import { exportAllDocs } from '@/lib/pdf-utils'
import { cn } from '@/lib/utils'

const DOC_ICONS: Record<DocId, typeof CreditCard> = {
  aadhaar: CreditCard,
  voter: Vote,
  pan: IdCard,
  ration: Wheat,
  others: Files,
  'image-tools': Image,
}

export function DashboardScreen({
  onScan,
  onOpenSettings,
}: {
  onScan: (docId: DocId) => void
  onOpenSettings: () => void
}) {
  const { customerName, docs, endSession, exportSize, clearDoc } = useSession()
  const [exporting, setExporting] = useState(false)

  const completedCount = useMemo(
    () => DOC_CONFIGS.filter((c) => isDocComplete(c, docs[c.id])).length,
    [docs],
  )

  const handleExportAll = async () => {
    if (completedCount === 0) {
      toast.error('Scan at least one document first.')
      return
    }
    setExporting(true)
    try {
      const result = await exportAllDocs(customerName, docs, exportSize)
      if (result.method === 'folder') {
        toast.success(`Saved ${result.count} file(s) to the chosen folder.`, {
          duration: 2000,
        })
      } else {
        toast.success(`Downloading ${result.count} PDF(s).`, {
          duration: 2000,
        })
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        toast.message('Export cancelled.')
      } else {
        toast.error('Export failed. Please try again.')
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Customer</p>
            <h1 className="truncate text-lg font-semibold leading-tight">
              {customerName}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={endSession}
              aria-label="End session"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Documents
          </h2>
          <span className="text-sm font-medium text-muted-foreground">
            {completedCount}/{DOC_CONFIGS.length} done
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {DOC_CONFIGS.map((config) => {
            const Icon = DOC_ICONS[config.id]
            const complete = isDocComplete(config, docs[config.id])
            const data = docs[config.id]
            const started =
              !complete && !!data && config.sides.some((s) => !!data[s])
            const otherImageCount = data?.images?.length ?? 0
            const anyCaptured =
              config.id === 'others'
                ? otherImageCount > 0
                : !!data && config.sides.some((s) => !!data[s])
            return (
              <div
                key={config.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors',
                  complete
                    ? 'border-accent/40'
                    : started
                      ? 'border-warning/40'
                      : 'border-border',
                )}
              >
                <button
                  onClick={() => onScan(config.id)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left active:scale-[0.99]"
                  aria-label={`Scan ${config.name}`}
                >
                  <div
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
                      complete
                        ? 'bg-accent/10 text-accent'
                        : started
                          ? 'bg-warning/10 text-warning'
                          : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{config.name}</p>
                    {/* Per-side upload status */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {config.id === 'others' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {otherImageCount} {otherImageCount === 1 ? 'document' : 'documents'} added
                        </span>
                      ) : (
                        config.sides.map((side) => {
                          const done = !!data?.[side]
                          const label = side === 'front' ? 'Front' : 'Back'
                          return (
                            <span
                              key={side}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                done
                                  ? 'bg-accent/10 text-accent'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {done ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <Circle className="h-3.5 w-3.5" />
                              )}
                              {label}
                            </span>
                          )
                        })
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
                {anyCaptured && (
                  <button
                    onClick={() => {
                      clearDoc(config.id)
                      toast.message(`${config.name} cleared.`)
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                    aria-label={`Clear ${config.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-card/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <Button
            onClick={handleExportAll}
            disabled={exporting || completedCount === 0}
            className="h-12 w-full text-base font-semibold"
          >
            {exporting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Download className="h-5 w-5" />
            )}
            Export All Documents
          </Button>
        </div>
      </footer>
    </main>
  )
}
