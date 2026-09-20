'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { DocData, DocId, DocStore, ExportSize } from '@/lib/types'
import { idbGet, idbSet } from '@/lib/idb'

const SETTINGS_KEY = 'qds:exportSize'
const SESSION_KEY = 'session'

interface PersistedSession {
  customerName: string
  hasSession: boolean
  docs: DocStore
}

interface SessionContextValue {
  hydrated: boolean
  customerName: string
  startSession: (name: string) => void
  endSession: () => void
  hasSession: boolean
  docs: DocStore
  setDocSide: (id: DocId, side: 'front' | 'back', dataUrl: string) => void
  setOtherImages: (images: DocData['images']) => void
  clearDoc: (id: DocId) => void
  clearDocSide: (id: DocId, side: 'front' | 'back') => void
  exportSize: ExportSize
  setExportSize: (size: ExportSize) => void
}

const emptyDocs: DocStore = {
  aadhaar: {},
  voter: {},
  pan: {},
  ration: {},
  others: {},
  'image-tools': {},
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [customerName, setCustomerName] = useState('')
  const [hasSession, setHasSession] = useState(false)
  const [docs, setDocs] = useState<DocStore>(emptyDocs)
  const [exportSize, setExportSizeState] = useState<ExportSize>('original')
  const [hydrated, setHydrated] = useState(false)

  // Load the saved session (if any) once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const saved = localStorage.getItem(SETTINGS_KEY) as ExportSize | null
        if (saved && !cancelled) setExportSizeState(saved)
      } catch {
        // ignore
      }
      const session = await idbGet<PersistedSession>(SESSION_KEY)
      if (!cancelled && session && session.hasSession) {
        setCustomerName(session.customerName || '')
        setDocs({ ...emptyDocs, ...session.docs })
        setHasSession(true)
      }
      if (!cancelled) setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the session whenever it changes (after initial hydration).
  useEffect(() => {
    if (!hydrated) return
    void idbSet<PersistedSession>(SESSION_KEY, { customerName, hasSession, docs })
  }, [hydrated, customerName, hasSession, docs])

  const setExportSize = useCallback((size: ExportSize) => {
    setExportSizeState(size)
    try {
      localStorage.setItem(SETTINGS_KEY, size)
    } catch {
      // ignore
    }
  }, [])

  const startSession = useCallback((name: string) => {
    setCustomerName(name.trim())
    setDocs(emptyDocs)
    setHasSession(true)
  }, [])

  const endSession = useCallback(() => {
    setCustomerName('')
    setDocs(emptyDocs)
    setHasSession(false)
  }, [])

  const setDocSide = useCallback(
    (id: DocId, side: 'front' | 'back', dataUrl: string) => {
      setDocs((prev) => ({
        ...prev,
        [id]: { ...prev[id], [side]: dataUrl } as DocData,
      }))
    },
    [],
  )

  const setOtherImages = useCallback((images: DocData['images']) => {
    setDocs((prev) => ({
      ...prev,
      others: { ...prev.others, images: images ?? [] },
    }))
  }, [])

  const clearDoc = useCallback((id: DocId) => {
    setDocs((prev) => ({ ...prev, [id]: {} }))
  }, [])

  const clearDocSide = useCallback((id: DocId, side: 'front' | 'back') => {
    setDocs((prev) => {
      const next = { ...prev[id] } as DocData
      delete next[side]
      return { ...prev, [id]: next }
    })
  }, [])

  const value = useMemo(
    () => ({
      hydrated,
      customerName,
      startSession,
      endSession,
      hasSession,
      docs,
      setDocSide,
      setOtherImages,
      clearDoc,
      clearDocSide,
      exportSize,
      setExportSize,
    }),
    [
      hydrated,
      customerName,
      startSession,
      endSession,
      hasSession,
      docs,
      setDocSide,
      setOtherImages,
      clearDoc,
      clearDocSide,
      exportSize,
      setExportSize,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
