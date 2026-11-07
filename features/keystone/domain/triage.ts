import { z } from 'zod'
import { payloadHash } from '../lib/canonical'
import { DomainError, Codes } from '../lib/errors'

/**
 * Triage scoring (STATE-MACHINES §4). A protocol version is data: questions, red flags, level rules
 * and the scripts the receptionist reads. Scoring is pure and conservative:
 *   - any red flag forces emergency_now, whatever else was answered;
 *   - otherwise the highest level any rule reaches wins (never the lowest);
 *   - an unanswered required question counts as "yes" for red flags and rules (the safe reading).
 * The agent never downgrades a level and never diagnoses; it reads the script for the level.
 */

export const TRIAGE_LEVELS = ['routine', 'soon', 'urgent_today', 'emergency_now'] as const
export type TriageLevel = (typeof TRIAGE_LEVELS)[number]
const rank = (level: TriageLevel) => TRIAGE_LEVELS.indexOf(level)

const id = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/)
const Question = z.object({ id, text: z.string().min(3), required: z.boolean().default(true) })
const RedFlag = z.object({
  id,
  label: z.string().min(3),
  /** Answer ids whose "yes" is this red flag. */
  whenYes: z.array(id).default([]),
  /** Complaint keywords (lower case) that are this red flag on their own: "rat poison", "can't breathe". */
  keywords: z.array(z.string().min(2)).default([]),
})
const LevelRule = z.object({ level: z.enum(TRIAGE_LEVELS), whenYes: z.array(id).default([]), keywords: z.array(z.string().min(2)).default([]) })
const Scripts = z.object({ emergency_now: z.string().min(10), urgent_today: z.string().min(10), soon: z.string().min(10), routine: z.string().min(10) })

export const TriageProtocolSchema = z.object({
  questions: z.array(Question).min(1),
  redFlags: z.array(RedFlag).min(1),
  levelRules: z.array(LevelRule),
  scripts: Scripts,
})
export type TriageProtocol = z.infer<typeof TriageProtocolSchema>

export function parseProtocol(input: unknown): TriageProtocol {
  const parsed = TriageProtocolSchema.safeParse(input)
  if (!parsed.success) throw new DomainError(Codes.INVALID_INPUT, `The triage protocol is not valid: ${parsed.error.issues.slice(0, 4).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const ids = new Set(parsed.data.questions.map(q => q.id))
  for (const ref of [...parsed.data.redFlags.flatMap(f => f.whenYes), ...parsed.data.levelRules.flatMap(r => r.whenYes)]) {
    if (!ids.has(ref)) throw new DomainError(Codes.INVALID_INPUT, `The triage protocol refers to an unknown question ${ref}.`)
  }
  return parsed.data
}

export const protocolHash = (p: TriageProtocol) => payloadHash(p)

export type TriageAnswers = Record<string, boolean | null | undefined>
export type TriageResult = { level: TriageLevel; redFlagsHit: string[]; reasons: string[]; script: string; unanswered: string[] }

/** Lower-case, collapse whitespace, strip punctuation that could split a keyword. */
const normalise = (text: string) => ` ${String(text ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
const mentions = (complaint: string, keyword: string) => complaint.includes(normalise(keyword))

export function scoreTriage(protocol: TriageProtocol, input: { complaint: string; answers: TriageAnswers }): TriageResult {
  const complaint = normalise(input.complaint)
  const unanswered = protocol.questions.filter(q => q.required && typeof input.answers[q.id] !== 'boolean').map(q => q.id)
  // Unanswered counts as yes: the receptionist can't rule an emergency out by not asking.
  const yes = (qid: string) => input.answers[qid] === true || unanswered.includes(qid)
  const redFlagsHit = protocol.redFlags.filter(f => f.whenYes.some(yes) || f.keywords.some(k => mentions(complaint, k))).map(f => f.id)
  if (redFlagsHit.length) {
    return { level: 'emergency_now', redFlagsHit, reasons: redFlagsHit.map(fid => protocol.redFlags.find(f => f.id === fid)!.label), script: protocol.scripts.emergency_now, unanswered }
  }
  let level: TriageLevel = 'routine'
  const reasons: string[] = []
  for (const rule of protocol.levelRules) {
    const hit = rule.whenYes.some(yes) || rule.keywords.some(k => mentions(complaint, k))
    if (hit && rank(rule.level) >= rank(level)) {
      if (rank(rule.level) > rank(level)) reasons.length = 0
      level = rule.level
      reasons.push(rule.whenYes.filter(yes).concat(rule.keywords.filter(k => mentions(complaint, k))).join(', '))
    }
  }
  return { level, redFlagsHit: [], reasons, script: protocol.scripts[level], unanswered }
}

/** A later assessment may raise a level, never lower it (agents never downgrade). */
export function assertNotDowngrade(previous: TriageLevel | null | undefined, next: TriageLevel) {
  if (previous && rank(next) < rank(previous)) throw new DomainError(Codes.GUARD_FAILED, `Triage can't be lowered from ${previous} to ${next}.`)
}

export const outcomeAllowed = (level: TriageLevel, outcome: string) =>
  level === 'emergency_now' ? outcome === 'transferred' || outcome === 'er_referred' : true
