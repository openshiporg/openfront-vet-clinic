import { createHash } from 'node:crypto'
import { dec, toScale } from '../lib/decimal'

/*
 * Lab results (STATE-MACHINES §9). Pure functions, no database: the age class a patient falls in, the species-specific
 * reference range to use, unit conversion from the lab's unit to ours, and the abnormal flag. Ranges are copied onto
 * each value at the time, so editing a range later never changes what a past result said.
 */

export type AgeClass = 'juvenile' | 'adult' | 'senior'
export type Flag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high' | 'abnormal'

/** Weeks old → class. Juvenile under 1 year; senior from 7 years (dogs and cats; other species use their own ranges tagged "any"). */
export function ageClassOf(age: { weeks: number; months: number } | null): AgeClass | null {
  if (!age) return null
  if (age.months < 12) return 'juvenile'
  if (age.months >= 7 * 12) return 'senior'
  return 'adult'
}

export type Range = { speciesId: string; ageClass: string; labId: string | null; low: string | null; high: string | null; criticalLow: string | null; criticalHigh: string | null; unit: string }

/**
 * The most specific range wins: same lab beats any lab, exact age class beats "any". A range for another
 * species is never used. Returns null when no range exists (the value is then shown without a flag).
 */
export function pickRange(ranges: Range[], speciesId: string, ageClass: AgeClass | null, labId: string | null): Range | null {
  const usable = ranges.filter(r => r.speciesId === speciesId && (r.ageClass === 'any' || r.ageClass === ageClass) && (r.labId === null || r.labId === labId))
  usable.sort((a, b) => score(b, ageClass, labId) - score(a, ageClass, labId))
  return usable[0] ?? null
}
const score = (r: Range, ageClass: AgeClass | null, labId: string | null) => (r.ageClass === ageClass ? 2 : 0) + (r.labId && r.labId === labId ? 1 : 0)

export type Conversion = { factor?: string; offset?: string } | null | undefined

/** external value × factor + offset. No conversion means the lab already uses the canonical unit. */
export function convertValue(value: string, conversion: Conversion): string {
  const v = dec(value)
  if (!conversion) return toScale(v, 'qty')
  const out = v.times(conversion.factor ? dec(conversion.factor) : 1).plus(conversion.offset ? dec(conversion.offset) : 0)
  return toScale(out, 'qty')
}

/** Flag one numeric value against a range. Nothing to compare with → normal (the screen shows "no range"). */
export function flagFor(value: string | null, range: Pick<Range, 'low' | 'high' | 'criticalLow' | 'criticalHigh'> | null): Flag {
  if (value === null || !range) return 'normal'
  const v = dec(value)
  if (range.criticalLow !== null && v.lt(dec(range.criticalLow))) return 'critical_low'
  if (range.criticalHigh !== null && v.gt(dec(range.criticalHigh))) return 'critical_high'
  if (range.low !== null && v.lt(dec(range.low))) return 'low'
  if (range.high !== null && v.gt(dec(range.high))) return 'high'
  return 'normal'
}

const SEVERITY: Record<Flag, number> = { normal: 0, low: 1, high: 1, abnormal: 1, critical_low: 2, critical_high: 2 }
export const worstFlag = (flags: Flag[]): Flag => flags.reduce<Flag>((w, f) => (SEVERITY[f] > SEVERITY[w] ? f : w), 'normal')
export const isAbnormal = (flag: Flag) => flag !== 'normal'

/** Hours the ordering DVM has to review: abnormal 4, normal 24 (seed values; a practice can override in its settings). */
export const reviewSlaHours = (flag: Flag, sla: { abnormalHours?: number; normalHours?: number } = {}) => (isAbnormal(flag) ? sla.abnormalHours ?? 4 : sla.normalHours ?? 24)

/** The report as it is stored: the same lines in the same order hash the same, so a resent file is recognised. */
export function resultHash(accession: string, status: string, lines: { code: string; value: string; unit: string }[]) {
  const body = [...lines].sort((a, b) => a.code.localeCompare(b.code)).map(l => `${l.code}|${l.value}|${l.unit}`).join('\n')
  return createHash('sha256').update(`${accession}\n${status}\n${body}`).digest('hex')
}

/* ── The file the lab drops: CSV with accession, code, value, unit, status. HL7 ORU^R01 OBX segments are read the same way. ── */

export type ParsedLine = { accession: string; code: string; value: string; text: string; unit: string }
export type ParsedReport = { accession: string; status: 'partial' | 'final' | 'corrected'; lines: ParsedLine[] }

const STATUS: Record<string, ParsedReport['status']> = { p: 'partial', partial: 'partial', i: 'partial', f: 'final', final: 'final', c: 'corrected', corrected: 'corrected', r: 'final' }
const NUMERIC = /^[<>]?\s*-?\d+(\.\d+)?$/

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c.trim())) rows.push(row)
  return rows
}

/** Read a lab file (CSV or HL7 v2 text) into reports, one per accession. Throws a plain message on a file we cannot read. */
export function parseLabFile(input: string): ParsedReport[] {
  const text = input.replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('The file is empty.')
  const reports = new Map<string, ParsedReport>()
  const add = (accession: string, status: ParsedReport['status'], line: Omit<ParsedLine, 'accession'>) => {
    const r = reports.get(accession) ?? { accession, status, lines: [] }
    // The strongest status in a file wins for the report: corrected over final over partial.
    if (status === 'corrected' || (status === 'final' && r.status === 'partial')) r.status = status
    r.lines.push({ accession, ...line })
    reports.set(accession, r)
  }
  if (text.startsWith('MSH|')) {
    let accession = ''
    for (const seg of text.split(/\r\n|\r|\n/)) {
      const f = seg.split('|')
      if (f[0] === 'OBR') accession = (f[3] || f[2] || '').split('^')[0].trim()
      if (f[0] === 'OBX') {
        if (!accession) throw new Error('A result line came before any accession number.')
        const code = (f[3] ?? '').split('^')[0].trim()
        const value = (f[5] ?? '').trim()
        if (!code || !value) continue
        const status = STATUS[(f[11] ?? 'F').trim().toLowerCase()] ?? 'final'
        const numeric = NUMERIC.test(value)
        add(accession, status, { code, value: numeric ? value.replace(/[<>\s]/g, '') : '', text: numeric ? '' : value, unit: (f[6] ?? '').split('^')[0].trim() })
      }
    }
  } else {
    const rows = csvRows(text)
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''))
    const col = (...names: string[]) => head.findIndex(h => names.includes(h))
    const a = col('accession', 'accessionid', 'accessionnumber', 'specimenid')
    const c = col('code', 'testcode', 'analyte', 'analytecode')
    const v = col('value', 'result', 'resultvalue')
    const u = col('unit', 'units')
    const s = col('status', 'resultstatus')
    if (a < 0 || c < 0 || v < 0) throw new Error('The file needs accession, code and value columns.')
    for (const r of rows.slice(1)) {
      const accession = (r[a] ?? '').trim()
      const code = (r[c] ?? '').trim()
      const value = (r[v] ?? '').trim()
      if (!accession || !code || !value) continue
      const status = STATUS[(s >= 0 ? r[s] ?? 'final' : 'final').trim().toLowerCase()] ?? 'final'
      const numeric = NUMERIC.test(value)
      add(accession, status, { code, value: numeric ? value.replace(/[<>\s]/g, '') : '', text: numeric ? '' : value, unit: u >= 0 ? (r[u] ?? '').trim() : '' })
    }
  }
  if (!reports.size) throw new Error('No results were found in the file.')
  return [...reports.values()]
}
