import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'
import '@/features/storefront/storefront.css'
import { Footer } from '@/features/storefront/components/Footer'
import { Header } from '@/features/storefront/components/Header'
import { getSite } from '@/features/storefront/server/site'

// The whole weight range (300 to 900) loads as one variable font, so the headline can sit between the named weights.
const figtree = Figtree({ variable: '--font-sf', subsets: ['latin'], display: 'swap' })

// Every page reads the practice's live data and the signed-in client, so nothing here is built ahead of time.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite()
  const city = site.main?.city ? `, ${site.main.city}` : ''
  return { title: { default: `${site.name}${city}`, template: `%s · ${site.name}` }, description: `Book a visit or refill a prescription at ${site.name}${city}.` }
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sf ${figtree.variable}`}>
      <Header />
      <main className="sf-main">{children}</main>
      <Footer />
    </div>
  )
}
