import { keystoneClient } from '@/features/dashboard/lib/keystoneClient'

/** Staff reads go through the signed-in session, so list access rules still apply. */
export async function q<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await keystoneClient<T>(query, variables)
  if (!r.success) throw new Error(r.error)
  return r.data as T
}

/** The practice's home time zone (PracticeSettings.homeTimeZone), Los Angeles by default. */
export async function practiceTimeZone(): Promise<string> {
  try {
    const d: any = await q(`{ practiceSettings { homeTimeZone } }`)
    return d.practiceSettings?.homeTimeZone || 'America/Los_Angeles'
  } catch {
    return 'America/Los_Angeles'
  }
}

type Loc = { id: string; kind?: string | null }

/**
 * The location a screen opens on when none is chosen: the signed-in staff member's home location,
 * else the first general practice, else the first active location.
 */
export async function defaultLocation<T extends Loc>(locations: T[], chosen?: string | null): Promise<T | undefined> {
  const picked = locations.find(l => l.id === chosen)
  if (picked) return picked
  let home: string | null = null
  try {
    const r = await keystoneClient<{ authenticatedItem: { staffMember?: { homeLocation: { id: string } | null } | null } | null }>(`{ authenticatedItem { ... on User { staffMember { homeLocation { id } } } } }`)
    home = r.success ? r.data.authenticatedItem?.staffMember?.homeLocation?.id ?? null : null
  } catch { home = null }
  return locations.find(l => l.id === home) ?? locations.find(l => l.kind === 'general_practice') ?? locations[0]
}

/**
 * Wording corrections for append-only rows: a Note with `supersedesField` set replaces the stored text
 * of that field on screen (latest note wins). The row itself, and its audit entry, keep the original.
 * Returns a lookup `(subjectType, subjectId, field, original) => text to show`.
 */
export async function corrections(subjects: { type: string; ids: string[] }[]) {
  const wanted = subjects.filter(s => s.ids.length);
  const map = new Map<string, string>();
  if (wanted.length) {
    try {
      const d = await q<{ notes: { subjectType: string; subjectId: string; supersedesField: string; body: string }[] }>(
        `query C($where: NoteWhereInput!) { notes(where: $where, orderBy: { createdAt: asc }, take: 500) { subjectType subjectId supersedesField body } }`,
        { where: { AND: [{ supersedesField: { not: { equals: '' } } }, { OR: wanted.map(s => ({ subjectType: { equals: s.type }, subjectId: { in: s.ids } })) }] } },
      );
      for (const n of d.notes) map.set(`${n.subjectType}:${n.subjectId}:${n.supersedesField}`, n.body);
    } catch { /* corrections are display-only; fall back to the stored text */ }
  }
  return (type: string, id: string, field: string, original: string) => map.get(`${type}:${id}:${field}`) ?? original;
}
