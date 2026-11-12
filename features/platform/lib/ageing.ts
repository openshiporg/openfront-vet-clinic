/** How long a balance has been owing, in the words the screens and exports show. Balances are due on the day they are posted. */
export const AGE_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

export const AGE_LABEL: Record<AgeBucket, string> = {
  current: 'Not yet due', d1_30: '1 to 30 days', d31_60: '31 to 60 days', d61_90: '61 to 90 days', d90_plus: 'Over 90 days',
}

export function ageBucket(postedOn: string, asOf: string): AgeBucket {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${postedOn}T00:00:00Z`)) / 86_400_000)
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}
