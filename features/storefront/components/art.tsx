import { Bird, Cat, Dog, Fish, PawPrint, Rabbit, Turtle } from 'lucide-react'

/** The practice mark: two cedars over a creek, with a paw. */
export function Logo() {
  return (
    <svg viewBox="0 0 132 92" role="img" aria-hidden="true">
      <g fill="#0e5b51">
        <path d="M33 10l13 19h-7l12 17h-8l12 17H11l12-17h-8l12-17h-7z" />
        <path d="M62 2l11 16h-6l10 15h-7l10 14H45l9-14h-7l10-15h-6z" />
        <rect x="30" y="60" width="6" height="12" rx="1" />
        <rect x="59" y="44" width="5" height="12" rx="1" />
      </g>
      <path d="M2 78c22-14 44-12 62-6s38 4 62-10c-18 20-40 24-62 17s-40-9-62-1z" fill="#0c4a43" />
      <path d="M44 66c16-9 34-8 50-9 10-1 20-4 30-10-8 12-20 17-34 18-16 1-30-2-46 1z" fill="#8fb9ad" />
      <g fill="#ffc93f">
        <ellipse cx="92" cy="33" rx="9" ry="7.5" />
        <ellipse cx="78" cy="23" rx="4" ry="5.2" transform="rotate(-24 78 23)" />
        <ellipse cx="87" cy="15" rx="4" ry="5.4" transform="rotate(-8 87 15)" />
        <ellipse cx="98" cy="15" rx="4" ry="5.4" transform="rotate(10 98 15)" />
        <ellipse cx="107" cy="23" rx="4" ry="5.2" transform="rotate(26 107 23)" />
      </g>
    </svg>
  )
}

/** Three short yellow strokes, as in the headline and the stethoscope. */
export function Spark({ className = 'sf-spark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 56 56" fill="none" stroke="#ffc93f" strokeWidth="6" strokeLinecap="round" aria-hidden="true">
      <path d="M40 8l5 14" />
      <path d="M17 22l13 10" />
      <path d="M8 49l15 1" />
    </svg>
  )
}

/** The hand-drawn yellow underline on the phone headline. */
export function Swoosh() {
  return (
    <svg className="sf-swoosh" viewBox="0 0 200 12" preserveAspectRatio="none" fill="none" stroke="#f4b41f" strokeWidth="5" strokeLinecap="round" aria-hidden="true">
      <path d="M3 7c40-5 120-5 194 1" />
    </svg>
  )
}

const SPECIES_ICON: Record<string, typeof Dog> = { canine: Dog, dog: Dog, feline: Cat, cat: Cat, avian: Bird, bird: Bird, rabbit: Rabbit, lagomorph: Rabbit, fish: Fish, reptile: Turtle, turtle: Turtle }

/** A round portrait for a pet. Patient records carry no photo on this site, so the portrait is drawn from the species. */
export function PetAvatar({ speciesCode, speciesName }: { speciesCode: string; speciesName?: string }) {
  const key = speciesCode.toLowerCase()
  const Icon = SPECIES_ICON[key] ?? SPECIES_ICON[(speciesName ?? '').toLowerCase()] ?? PawPrint
  return (
    <span className={`sf-avatar${Icon === Cat ? ' sf-avatar-cat' : ''}`} aria-hidden="true">
      <Icon />
    </span>
  )
}
