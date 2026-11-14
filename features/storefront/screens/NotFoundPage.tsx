import Link from 'next/link'
import { CalendarIcon } from '../components/art'

export default function NotFoundPage() {
  return (
    <div className="sf-wrap">
      <div className="sf-pagehead">
        <h1 className="sf-h1">We can’t find that page.</h1>
        <p className="sf-lede">It may have moved, or the link may be old.</p>
      </div>
      <p className="sf-row" style={{ padding: '0 calc(18 * var(--u))' }}>
        <Link href="/" className="sf-btn sf-btn-teal">Go to the home page</Link>
        <Link href="/book" className="sf-btn sf-btn-yellow"><CalendarIcon /> Book a visit</Link>
      </p>
    </div>
  )
}
