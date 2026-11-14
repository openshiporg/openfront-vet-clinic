import { Bird, Fish, Rabbit, Turtle } from 'lucide-react'

/* The site's own drawings: the practice mark, the small icons the picked design uses, and the pet portraits. */

/** The practice mark as the wide header shows it: two cedars over a creek, with a yellow paw. */
export function LogoWide({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 155 104" aria-hidden="true">
      <defs>
        <linearGradient id="sf-tree" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f7a63" />
          <stop offset="1" stopColor="#0d5a4b" />
        </linearGradient>
        <linearGradient id="sf-hill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0f5c4c" />
          <stop offset="1" stopColor="#3f9b7e" />
        </linearGradient>
        <linearGradient id="sf-creek" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f8790" />
          <stop offset="1" stopColor="#176a63" />
        </linearGradient>
      </defs>
      <g fill="url(#sf-tree)">
        <path d="M68 1l10 17h-5l10 16h-6l11 22H48l11-22h-6l10-16h-5z" />
        <rect x="64.5" y="54" width="7" height="16" rx="1" />
        <path d="M30 13l14 22h-7l14 20h-9l18 23H0l18-23H9l14-20h-7z" />
        <rect x="26" y="76" width="8" height="12" rx="1" />
      </g>
      <path d="M58 74c22-13 68-16 97 6-30-12-70-10-93 0z" fill="url(#sf-hill)" />
      <path d="M86 77c19-1 42 1 46 9 2 9-52 6-97 17 35-15 75-11 77-17 0-4-14-6-26-9z" fill="url(#sf-creek)" />
      <g fill="#fdc02f">
        <path d="M130.5 32c7 0 15.5 6.5 15.5 14 0 5.5-4.5 8.5-8.5 7-2.5-1-4.5-1.5-7-1.5s-4.5.5-7 1.5c-4 1.5-8.5-1.5-8.5-7 0-7.5 8.5-14 15.5-14z" />
        <ellipse cx="116.5" cy="26.5" rx="5.5" ry="7.2" transform="rotate(-22 116.5 26.5)" />
        <ellipse cx="133" cy="17.5" rx="6" ry="7.8" transform="rotate(4 133 17.5)" />
        <ellipse cx="148.5" cy="29" rx="5.5" ry="7.2" transform="rotate(26 148.5 29)" />
      </g>
    </svg>
  )
}

/** The mark as the phone header shows it: three cedars on a hill with a yellow sweep, and the paw below. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 159 149" aria-hidden="true">
      <g fill="#04453f">
        <path d="M74 3l12 21h-6l14 22h-7l16 24H45l16-24h-7l14-22h-6z" />
        <path d="M40 39l9 16h-4l10 17h-5l10 20H20l10-20h-5l10-17h-4z" />
        <path d="M115 29l10 17h-4l11 18h-5l13 22H90l13-22h-5l11-18h-4z" />
        <path d="M14 114l10-26 36-22h40l38 18 8 8c-26-10-52-7-78 4-20 8-37 14-54 18z" />
        <path d="M117 121c8.5 0 17.5 7.5 17.5 16 0 6.5-5.5 10-10 8-3-1.2-5-1.8-7.5-1.8s-4.5.6-7.5 1.8c-4.5 2-10-1.5-10-8 0-8.5 9-16 17.5-16z" />
        <ellipse cx="98.5" cy="120.5" rx="5.6" ry="7.4" transform="rotate(-26 98.5 120.5)" />
        <ellipse cx="111" cy="108" rx="5.8" ry="7.8" transform="rotate(-8 111 108)" />
        <ellipse cx="127.5" cy="108" rx="5.8" ry="7.8" transform="rotate(8 127.5 108)" />
        <ellipse cx="139" cy="121.5" rx="5.6" ry="7.4" transform="rotate(26 139 121.5)" />
      </g>
      <path d="M3 122c27-5 51-18 77-29 24-9 54-5 77 9-23-7-49-8-71 0-26 10-54 24-83 20z" fill="#fbbe1f" />
    </svg>
  )
}

/** Three short yellow strokes, as beside the headline and the stethoscope. */
export function Spark({ className = 'sf-spark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 56 61" fill="none" stroke="#fec73a" strokeWidth="8" strokeLinecap="round" aria-hidden="true">
      <path d="M45 5l7 16" />
      <path d="M14.5 25l17 9.5" />
      <path d="M6 55l22 1" />
    </svg>
  )
}

/** The hand-drawn yellow underline on the phone headline. */
export function Swoosh() {
  return (
    <svg className="sf-swoosh" viewBox="0 0 258 20" preserveAspectRatio="none" fill="none" stroke="#fbbe1f" strokeWidth="9" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12c50-7 170-9 246 1" />
    </svg>
  )
}

/** The yellow paw beside a pet's name. */
export function Paw({ className = 'sf-paw' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 39 36" fill="currentColor" aria-hidden="true">
      <path d="M19.5 15.5c6 0 11.5 5.5 11.5 11.5 0 5-4 7.5-7 6.2-1.8-.8-3-1.2-4.5-1.2s-2.7.4-4.5 1.2c-3 1.3-7-1.2-7-6.2 0-6 5.5-11.5 11.5-11.5z" />
      <ellipse cx="5.8" cy="15.8" rx="4" ry="5.3" transform="rotate(-26 5.8 15.8)" />
      <ellipse cx="14.3" cy="6.8" rx="4.2" ry="5.7" transform="rotate(-8 14.3 6.8)" />
      <ellipse cx="24.7" cy="6.8" rx="4.2" ry="5.7" transform="rotate(8 24.7 6.8)" />
      <ellipse cx="33.2" cy="15.8" rx="4" ry="5.3" transform="rotate(26 33.2 15.8)" />
    </svg>
  )
}

const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** A plain calendar, as on the Book a visit button. */
export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 35 38" {...line} strokeWidth="2.8" aria-hidden="true">
      <rect x="1.5" y="5.5" width="32" height="31" rx="5.5" />
      <path d="M1.5 15h32M10.5 1.5v8M24.5 1.5v8" />
    </svg>
  )
}

/** A medicine bottle with a plus, as on the Refill a prescription button. */
export function BottleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 31 40" {...line} strokeWidth="2.7" aria-hidden="true">
      <rect x="6.5" y="1.5" width="18" height="6.5" rx="2" />
      <path d="M9 8v2.4c0 1.2-.6 2-1.6 2.6C4.6 14.7 2 17.2 2 21.2v12.3c0 2.8 2.2 5 5 5h17c2.8 0 5-2.2 5-5V21.2c0-4-2.6-6.5-5.4-8.2-1-.6-1.6-1.4-1.6-2.6V8" />
      <path d="M15.5 21v10.5M10.3 26.2h10.4" strokeWidth="3" />
    </svg>
  )
}

/** The arrow after a link on the wide page. */
export function Arrow({ className = 'sf-arrow' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 20" {...line} strokeWidth="3" aria-hidden="true">
      <path d="M2 10h23M16.5 2l8.5 8-8.5 8" />
    </svg>
  )
}

/** The chevron after a link or a time on the phone page. */
export function Chevron({ className = 'sf-chev' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 21" {...line} strokeWidth="3.2" aria-hidden="true">
      <path d="M2 2l8 8.5-8 8.5" />
    </svg>
  )
}

/** The small down caret beside Services. */
export function Caret({ className = 'sf-caret' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 17 10" {...line} strokeWidth="2.6" aria-hidden="true">
      <path d="M1.5 1.5l7 7 7-7" />
    </svg>
  )
}

function DogFace() {
  return (
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <path d="M54 58C32 54 22 84 30 116c2 8 12 9 18 2 8-10 14-26 16-42z" fill="#0d5c55" />
      <path d="M126 58c22-4 32 26 24 58-2 8-12 9-18 2-8-10-14-26-16-42z" fill="#0d5c55" />
      <path d="M90 44c26 0 44 18 44 44 0 30-18 52-44 52S46 118 46 88c0-26 18-44 44-44z" fill="#fff8e7" />
      <ellipse cx="90" cy="114" rx="25" ry="21" fill="#fff" />
      <path d="M82 122h16v9a8 8 0 0 1-16 0z" fill="#f29a94" />
      <path d="M90 108v10M90 118c-4 7-14 7-17 0M90 118c4 7 14 7 17 0" fill="none" stroke="#083b38" strokeWidth="3" strokeLinecap="round" />
      <path d="M80 101c0-4 4.5-6 10-6s10 2 10 6-5 8-10 8-10-4-10-8z" fill="#083b38" />
      <circle cx="71" cy="86" r="5.5" fill="#083b38" />
      <circle cx="109" cy="86" r="5.5" fill="#083b38" />
    </svg>
  )
}

function CatFace() {
  return (
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <path d="M44 86l5-52 38 27z" fill="#0d5c55" />
      <path d="M136 86l-5-52-38 27z" fill="#0d5c55" />
      <path d="M55 70l2-23 18 13z" fill="#f6c9c0" />
      <path d="M125 70l-2-23-18 13z" fill="#f6c9c0" />
      <path d="M90 50c28 0 50 18 50 46 0 26-22 44-50 44s-50-18-50-44c0-28 22-46 50-46z" fill="#f1f5f3" />
      <path d="M90 54v14M77 56l3 12M103 56l-3 12" fill="none" stroke="#0d5c55" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="70" cy="94" rx="8.5" ry="9" fill="#fbbe1f" />
      <ellipse cx="110" cy="94" rx="8.5" ry="9" fill="#fbbe1f" />
      <ellipse cx="70" cy="94" rx="3" ry="7.5" fill="#083b38" />
      <ellipse cx="110" cy="94" rx="3" ry="7.5" fill="#083b38" />
      <path d="M84 108h12l-6 7z" fill="#f29a94" />
      <path d="M90 115v4M90 119c-3 5-10 5-12 0M90 119c3 5 10 5 12 0" fill="none" stroke="#083b38" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M62 112l-26-6M62 118l-26 4M118 112l26-6M118 118l26 4" fill="none" stroke="#083b38" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const DOG = new Set(['canine', 'dog'])
const CAT = new Set(['feline', 'cat'])
const SPECIES_ICON: Record<string, typeof Bird> = { avian: Bird, bird: Bird, rabbit: Rabbit, lagomorph: Rabbit, fish: Fish, reptile: Turtle, turtle: Turtle }

/**
 * A round portrait for a pet: the photo on the pet's record when the practice has shared one with the client,
 * otherwise a drawing for the species.
 */
export function PetAvatar({ speciesCode, speciesName, photoUrl, name, small }: { speciesCode: string; speciesName?: string; photoUrl?: string | null; name?: string; small?: boolean }) {
  const size = small ? ' sf-avatar-small' : ''
  if (photoUrl) {
    return (
      <span className={`sf-avatar sf-avatar-photo${size}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={name ?? ''} loading="lazy" decoding="async" />
      </span>
    )
  }
  const keys = [speciesCode.toLowerCase(), (speciesName ?? '').toLowerCase()]
  if (keys.some(k => DOG.has(k))) return <span className={`sf-avatar sf-avatar-dog${size}`} aria-hidden="true"><DogFace /></span>
  if (keys.some(k => CAT.has(k))) return <span className={`sf-avatar sf-avatar-cat${size}`} aria-hidden="true"><CatFace /></span>
  const Icon = SPECIES_ICON[keys[0]] ?? SPECIES_ICON[keys[1]]
  return <span className={`sf-avatar sf-avatar-plain${size}`} aria-hidden="true">{Icon ? <Icon /> : <Paw className="sf-avatar-paw" />}</span>
}
