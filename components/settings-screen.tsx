'use client'

import { ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session-store'
import { EXPORT_SIZE_OPTIONS } from '@/lib/types'
import { cn } from '@/lib/utils'

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { exportSize, setExportSize } = useSession()

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        <h2 className="mb-1 text-sm font-medium">Default export size</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Applied to every PDF export. Smaller sizes compress images more
          aggressively to fit the limit.
        </p>

        <div className="flex flex-col gap-2">
          {EXPORT_SIZE_OPTIONS.map((option) => {
            const active = option.value === exportSize
            return (
              <button
                key={option.value}
                onClick={() => setExportSize(option.value)}
                className={cn(
                  'flex items-center justify-between rounded-xl border p-4 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <span
                  className={cn(
                    'font-medium',
                    active ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {option.label}
                </span>
                {active && <Check className="h-5 w-5 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
