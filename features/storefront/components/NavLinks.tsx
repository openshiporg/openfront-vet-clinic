'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Caret } from './art'

type Item = { href: string; label: string }

export function NavLinks({ services, signedIn, boarding, wellnessPlans }: { services: { id: string; name: string }[]; signedIn: boolean; boarding: boolean; wellnessPlans: boolean }) {
  const path = usePathname() ?? ''
  const current = (href: string) => (path === href || path.startsWith(`${href}/`) ? 'page' : undefined)
  const items: Item[] = [
    ...(wellnessPlans ? [{ href: '/wellness-plans', label: 'Wellness plans' }] : []),
    ...(boarding ? [{ href: '/boarding', label: 'Boarding' }] : []),
    { href: '/team', label: 'Our team' },
    signedIn ? { href: '/account', label: 'My account' } : { href: '/sign-in', label: 'Client sign in' },
  ]
  return (
    <nav className="sf-nav" aria-label="Main">
      <div className="sf-menu">
        <Link href="/services" aria-current={current('/services')}>
          Services <Caret />
        </Link>
        {services.length ? (
          <div className="sf-menu-list">
            {services.map(s => (
              <Link key={s.id} href={`/services#visit-${s.id}`}>{s.name}</Link>
            ))}
          </div>
        ) : null}
      </div>
      {items.map(item => (
        <Link key={item.href} href={item.href} aria-current={current(item.href)}>{item.label}</Link>
      ))}
    </nav>
  )
}
