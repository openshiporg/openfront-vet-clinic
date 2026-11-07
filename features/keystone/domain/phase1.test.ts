import { describe, expect, it } from 'vitest'
import { TRIAGE_PROTOCOL } from '../seed/clinicData'
import { assertNotDowngrade, outcomeAllowed, parseProtocol, protocolHash, scoreTriage } from './triage'
import { buildSegments, findSlots, signSlot, subtract, verifySlot, workingIntervals } from './scheduling'
import { contactHash, effectiveConsent, inQuietHours, normaliseEmail, normalisePhone, sendDecision, smsKeyword } from './contact'
import { parseInboundSms, twilioSignature, verifyTwilioSignature } from '../../integrations/telephony'
import { disclosureScript, voiceAgentAdapter } from '../../integrations/voice'

const protocol = parseProtocol(TRIAGE_PROTOCOL)
const allNo = Object.fromEntries(protocol.questions.map(q => [q.id, false]))

describe('phone triage (the urgency screen comes first)', () => {
  it('rat poison is an emergency from the words alone, even with every question answered no', () => {
    const r = scoreTriage(protocol, { complaint: 'My dog ate rat poison about an hour ago', answers: allNo })
    expect(r.level).toBe('emergency_now')
    expect(r.redFlagsHit).toContain('rf_toxin')
    expect(r.script).toMatch(/emergency/i)
  })
  it('an unasked red-flag question counts as yes: the screen cannot be skipped', () => {
    const r = scoreTriage(protocol, { complaint: 'wants a nail trim', answers: {} })
    expect(r.level).toBe('emergency_now')
    expect(r.unanswered.length).toBeGreaterThan(0)
  })
  it('routine with the screen done, urgent for repeated vomiting, soon for limping', () => {
    expect(scoreTriage(protocol, { complaint: 'annual vaccines', answers: allNo }).level).toBe('routine')
    expect(scoreTriage(protocol, { complaint: 'throwing up', answers: { ...allNo, vomiting_repeated: true } }).level).toBe('urgent_today')
    expect(scoreTriage(protocol, { complaint: 'she is limping on her back leg', answers: allNo }).level).toBe('soon')
  })
  it('emergencies are never booked, and a level is never lowered', () => {
    expect(outcomeAllowed('emergency_now', 'booked')).toBe(false)
    expect(outcomeAllowed('emergency_now', 'transferred')).toBe(true)
    expect(() => assertNotDowngrade('urgent_today', 'routine')).toThrow()
    expect(() => assertNotDowngrade('soon', 'urgent_today')).not.toThrow()
  })
  it('the protocol hash is stable and changes with content', () => {
    expect(protocolHash(protocol)).toBe(protocolHash(parseProtocol(TRIAGE_PROTOCOL)))
    expect(protocolHash(parseProtocol({ ...TRIAGE_PROTOCOL, scripts: { ...TRIAGE_PROTOCOL.scripts, routine: 'Let us find a time for you.' } }))).not.toBe(protocolHash(protocol))
  })
})

describe('availability', () => {
  const tz = 'America/Los_Angeles'
  it('subtracts busy time and time off', () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }])
    const blocks = [
      { kind: 'recurring' as const, weekday: 1, localDate: null, startTime: '08:00', endTime: '17:00' },
      { kind: 'time_off' as const, weekday: null, localDate: '2026-11-09', startTime: '12:00', endTime: '13:00' },
    ]
    const work = workingIntervals(blocks, '2026-11-09', tz)
    expect(work).toHaveLength(2)
    expect(new Date(work[0].start).toISOString()).toBe('2026-11-09T16:00:00.000Z')
    expect(workingIntervals(blocks, '2026-11-10', tz)).toEqual([])
  })
  it('is DST-safe: 08:00 local is 15:00Z in summer and 16:00Z in winter', () => {
    const block = [{ kind: 'recurring' as const, weekday: 1, localDate: null, startTime: '08:00', endTime: '09:00' }]
    expect(new Date(workingIntervals(block, '2026-07-06', tz)[0].start).toISOString()).toBe('2026-07-06T15:00:00.000Z')
    expect(new Date(workingIntervals(block, '2026-11-02', tz)[0].start).toISOString()).toBe('2026-11-02T16:00:00.000Z')
  })
  it('a slot needs both a free provider and a free room', () => {
    const H = 3_600_000
    const slots = findSlots({ minutes: 30, stepMinutes: 15, notBefore: 0, limit: 10, providers: [{ id: 'dvm', working: [{ start: 0, end: 2 * H }], busy: [{ start: 0, end: H }] }], resources: [{ id: 'room', busy: [{ start: H, end: H + 30 * 60_000 }] }] })
    expect(slots[0]).toMatchObject({ providerId: 'dvm', resourceId: 'room', start: H + 30 * 60_000 })
  })
  it('segments follow the type template', () => {
    const segs = buildSegments([{ kind: 'drop_off', offset: 0, minutes: 30 }, { kind: 'procedure', offset: 60, minutes: 90 }], 0, 540)
    expect(segs.map(s => [s.kind, s.startsAt.getTime() / 60_000, s.endsAt.getTime() / 60_000])).toEqual([['drop_off', 0, 30], ['procedure', 60, 150]])
  })
  it('slot tokens are signed and expire after five minutes', () => {
    const claims = { providerId: 'p', resourceId: 'r', appointmentTypeId: 't', locationId: 'l', start: 1, end: 2 }
    const token = signSlot(claims, 1_000)
    expect(verifySlot(token, 2_000)).toMatchObject(claims)
    expect(() => verifySlot(token, 1_000 + 5 * 60_000)).toThrow(/expired/)
    const [body] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims, providerId: 'other', exp: 9e15 })).toString('base64url')
    expect(() => verifySlot(`${forged}.${token.split('.')[1]}`, 2_000)).toThrow(/not valid/)
    expect(body.length).toBeGreaterThan(10)
  })
})

describe('contact rules', () => {
  it('normalises and hashes', () => {
    expect(normalisePhone('(916) 555-0142')).toBe('+19165550142')
    expect(normaliseEmail(' Olivia.Alvarez@Gmail.COM ')).toBe('olivia.alvarez@gmail.com')
    expect(contactHash('+19165550142')).toMatch(/^[0-9a-f]{64}$/)
    expect(() => normalisePhone('555')).toThrow()
  })
  it('keywords: STOP family first, C confirms', () => {
    expect(smsKeyword(' stop ')).toBe('stop')
    expect(smsKeyword('Unsubscribe')).toBe('stop')
    expect(smsKeyword('c')).toBe('confirm')
    expect(smsKeyword('Can I come at 3?')).toBeNull()
  })
  it('consent: the latest row wins; implied purposes need no row; marketing needs express written', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m))
    expect(effectiveConsent([], 'transactional', 'implied').allowed).toBe(true)
    expect(effectiveConsent([], 'marketing', 'express_written').allowed).toBe(false)
    expect(effectiveConsent([{ purpose: 'care', action: 'grant', at: at(1) }, { purpose: 'care', action: 'revoke', at: at(2) }], 'care', 'implied').allowed).toBe(false)
  })
  it('the send guard: deceased blocks before anything, quiet hours wrap midnight and defer', () => {
    const base = { purpose: 'care' as const, contactStatus: 'active', consentRows: [], requirement: 'implied' as const, suppressed: false, localTime: '12:00', quietHours: { start: '21:00', end: '08:00' } }
    expect(sendDecision({ ...base, patientStatus: 'deceased', suppressed: true })).toEqual({ action: 'block', reason: 'patient_deceased' })
    expect(sendDecision({ ...base, suppressed: true })).toEqual({ action: 'block', reason: 'suppressed' })
    expect(sendDecision({ ...base, localTime: '22:30' })).toEqual({ action: 'defer', reason: 'quiet_hours' })
    expect(sendDecision({ ...base, localTime: '07:59' }).action).toBe('defer')
    expect(sendDecision(base)).toEqual({ action: 'send' })
    expect(inQuietHours('08:00', { start: '21:00', end: '08:00' })).toBe(false)
  })
})

describe('telephony and voice adapters', () => {
  it('verifies the Twilio signature (and rejects a tampered body)', () => {
    const params = { From: '+19165550142', To: '+19165550100', Body: 'C', MessageSid: 'SM0123456789abcdef' }
    const url = 'https://vet-clinic.openship.org/api/webhooks/sms'
    const sig = twilioSignature('token', url, params)
    expect(verifyTwilioSignature('token', url, params, sig)).toBe(true)
    expect(verifyTwilioSignature('token', url, { ...params, Body: 'STOP' }, sig)).toBe(false)
    expect(verifyTwilioSignature('token', url, params, null)).toBe(false)
    expect(parseInboundSms(params)).toMatchObject({ from: '+19165550142', body: 'C', providerId: 'SM0123456789abcdef' })
    expect(() => parseInboundSms({ ...params, MessageSid: '../x' })).toThrow()
  })
  it('the disclosure names the AI and the recording, and asks about emergencies first', () => {
    const text = disclosureScript('Cedar Creek Animal Hospital', true)
    expect(text).toMatch(/AI|automated/i)
    expect(text).toMatch(/record/i)
    expect(text).toMatch(/emergency/i)
  })
  it('the self-hosted media-streams voice runtime is not built into this server', () => {
    expect(() => voiceAgentAdapter('twilio-media-streams' as never, {} as never)).toThrow()
    expect(voiceAgentAdapter('manual', {} as never).key).toBe('manual')
  })
})
