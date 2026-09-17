'use client'

import { useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider, useSession } from '@/lib/session-store'
import type { DocId } from '@/lib/types'
import { HomeScreen } from '@/components/home-screen'
import { DashboardScreen } from '@/components/dashboard-screen'
import { SettingsScreen } from '@/components/settings-screen'
import { Scanner } from '@/components/scanner'

type View =
  | { name: 'dashboard' }
  | { name: 'settings' }
  | { name: 'scan'; docId: DocId }

function Shell() {
  const { hasSession, hydrated } = useSession()
  const [view, setView] = useState<View>({ name: 'dashboard' })

  // Avoid flashing the home screen before the saved session loads.
  if (!hydrated) {
    return <main className="min-h-[100dvh] bg-background" aria-hidden="true" />
  }

  if (!hasSession) {
    return <HomeScreen />
  }

  if (view.name === 'settings') {
    return <SettingsScreen onBack={() => setView({ name: 'dashboard' })} />
  }

  if (view.name === 'scan') {
    return (
      <Scanner
        docId={view.docId}
        onExit={() => setView({ name: 'dashboard' })}
        onScanDoc={(docId) => setView({ name: 'scan', docId })}
      />
    )
  }

  return (
    <DashboardScreen
      onScan={(docId) => setView({ name: 'scan', docId })}
      onOpenSettings={() => setView({ name: 'settings' })}
    />
  )
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
      <Toaster position="top-center" richColors />
    </SessionProvider>
  )
}
