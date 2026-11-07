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
