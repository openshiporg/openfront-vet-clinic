import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import '@/features/storefront/storefront.css'
import { Footer } from '@/features/storefront/components/Footer'
import { Header } from '@/features/storefront/components/Header'
import { getSite } from '@/features/storefront/server/site'

const outfit = Outfit({ variable: '--font-sf', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] })

// Every page reads the practice's live data and the signed-in client, so nothing here is built ahead of time.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite()
  const city = site.main?.city ? `, ${site.main.city}` : ''
  return { title: { default: `${site.name}${city}`, template: `%s · ${site.name}` }, description: `Book a visit or refill a prescription at ${site.name}${city}.` }
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sf ${outfit.variable}`}>
      <Header />
      <main className="sf-main">{children}</main>
      <Footer />
    </div>
  )
}
