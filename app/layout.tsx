import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/service-worker-register'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Bongly DocScan - Fast Document Scanner for Indian IDs',
  description:
    'Bongly DocScan is a fast client-side document scanner for Aadhaar, Voter, PAN and Ration cards. Export clean A4 PDFs in under a minute. 100% on-device, no login required.',
  keywords: 'document scanner, Aadhaar scanner, voter ID scanner, PAN card scanner, ration card scanner, PDF exporter, CSC operator tools, offline scanner',
  generator: 'Next.js',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Bongly DocScan - Fast Document Scanner for Indian IDs',
    description: 'Scan and export Aadhaar, Voter, PAN and Ration cards to PDF. 100% on-device processing.',
    type: 'website',
    url: 'https://docscan.bongly.app',
    siteName: 'Bongly DocScan',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bongly DocScan - Fast Document Scanner',
    description: 'Scan Indian government IDs and export to PDF instantly',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Bongly DocScan',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#091DBD',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Bongly DocScan',
    applicationCategory: 'UtilityApplication',
    operatingSystem: 'Web, Android, iOS',
    description:
      'Fast client-side document scanner for Aadhaar, Voter, PAN and Ration cards. Export clean A4 PDFs with 100% on-device processing.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
    },
  }

  return (
    <html lang="en" className={`${geistSans.variable} bg-background light`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
