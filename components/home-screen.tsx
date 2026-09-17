'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/lib/session-store'

export function HomeScreen() {
  const { startSession } = useSession()
  const [name, setName] = useState('')

  const canStart = name.trim().length > 0

  const submit = () => {
    if (canStart) startSession(name)
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-sm flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <Image
              src="/logo.png"
              alt="Bongly DocScan scanner logo"
              width={144}
              height={144}
              priority
              className="h-32 w-32 rounded-2xl shadow-lg"
            />
            <div className="flex flex-col gap-2">
              <h1 className="text-balance text-2xl font-bold tracking-tight">
                Bongly DocScan
              </h1>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                Scan Aadhaar, Voter, PAN and Ration cards and export clean A4
                PDFs in under a minute.
              </p>
            </div>
          </div>

          <form
            className="flex w-full flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-name">Customer name</Label>
              <Input
                id="customer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rahul Das"
                autoComplete="off"
                autoFocus
                className="h-12 text-base"
              />
              <p className="text-xs text-muted-foreground">
                Used for the whole session and in every file name.
              </p>
            </div>

            <Button
              type="submit"
              disabled={!canStart}
              className="h-12 w-full text-base font-semibold"
            >
              Start Session
              <ArrowRight className="ml-1 h-5 w-5" aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>

      <footer className="px-6 pb-6 text-center">
        <p className="text-xs text-muted-foreground">
          100% on-device. No login, no upload, works offline.
        </p>
      </footer>
    </main>
  )
}
