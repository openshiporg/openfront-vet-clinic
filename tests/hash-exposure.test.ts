import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { getContext } from '@keystone-6/core/context'
import * as PrismaModule from '@prisma/client'
import config from '../features/keystone'
import { canonicalJson, keyedPayloadHash } from '../features/keystone/lib/canonical'

/*
 * Review r3b "hash over secret fields": a plain hash over a small or guessable value (a phone number,
 * tool arguments, a prompt, an imported file) is an oracle for that value. Those hashes are not readable,
 * filterable or sortable through the API; the agent's argument hash is keyed with a server secret.
 */
const context: any = getContext(config as never, PrismaModule)
const lists: Record<string, any> = context.__internal.lists

const HIDDEN: [string, string][] = [
  ['ContactPoint', 'valueHash'],
  ['AgentAction', 'argsHash'],
  ['AgentRun', 'promptHash'],
  ['ImportBatch', 'fileHash'],
  ['PortalSession', 'tokenHash'],
  ['PortalSession', 'otpHash'],
  ['PortalSession', 'ipHash'],
  ['MachineCredential', 'secretHash'],
  ['CommandReceipt', 'requestHash'],
  ['OAuthApp', 'clientSecret'],
  ['ApprovalRequest', 'payloadHash'],
]

describe('hashes over secret or guessable values are not exposed', () => {
  for (const [listKey, fieldKey] of HIDDEN) {
    it(`${listKey}.${fieldKey} cannot be read, filtered or sorted through the API`, () => {
      const list = lists[listKey]
      const field = list.fields[fieldKey]
      const listHidden = !list.graphql.isEnabled.query
      const fieldHidden = !field.graphql.isEnabled.read || field.access?.read?.toString().includes('false')
      expect(listHidden || fieldHidden, `${listKey}.${fieldKey} must be hidden`).toBe(true)
      expect(listHidden || field.graphql.isEnabled.filter === false, `${listKey}.${fieldKey} must not be filterable`).toBe(true)
      expect(listHidden || field.graphql.isEnabled.orderBy === false, `${listKey}.${fieldKey} must not be orderable`).toBe(true)
    })
  }

  it('the generated schema has no readable field for the hidden hashes', () => {
    const sdl = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'schema.graphql'), 'utf8') as string
    for (const [listKey, fieldKey] of HIDDEN) {
      const type = new RegExp(`^type ${listKey} \\{([\\s\\S]*?)^\\}`, 'm').exec(sdl)?.[1] ?? ''
      expect(type, `${listKey}.${fieldKey}`).not.toMatch(new RegExp(`^\\s+${fieldKey}:`, 'm'))
      const where = new RegExp(`^input ${listKey}WhereInput \\{([\\s\\S]*?)^\\}`, 'm').exec(sdl)?.[1] ?? ''
      expect(where, `${listKey}WhereInput.${fieldKey}`).not.toMatch(new RegExp(`^\\s+${fieldKey}:`, 'm'))
    }
  })

  it('the agent argument hash is keyed: the plain sha256 of the arguments does not match it', () => {
    const args = { phone: '+19165550123' }
    const keyed = keyedPayloadHash(args, 'agent-action-args')
    expect(keyed).toMatch(/^[0-9a-f]{64}$/)
    expect(keyed).not.toBe(createHash('sha256').update(canonicalJson(args)).digest('hex'))
    expect(keyedPayloadHash(args, 'agent-action-args')).toBe(keyed)
    expect(keyedPayloadHash(args, 'another-purpose')).not.toBe(keyed)
  })

  it('every other readable hash covers content its readers can already read (listed, so a new one is a decision)', () => {
    const readable: string[] = []
    for (const [listKey, list] of Object.entries(lists)) {
      if (!list.graphql.isEnabled.query) continue
      for (const [fieldKey, field] of Object.entries<any>(list.fields)) {
        if (!/hash|sha256|secret|digest/i.test(fieldKey)) continue
        if (!field.graphql.isEnabled.read) continue
        if (HIDDEN.some(([l, f]) => l === listKey && f === fieldKey)) continue
        readable.push(`${listKey}.${fieldKey}`)
      }
    }
    // secretRef is the name of a SecretBox entry, not a secret. Each hash covers content shown on the same record to the same readers (the payload, the rules, the
    // signed note, the file, the audit row), or the chain links of tamper-evident logs.
    expect(readable.sort()).toEqual([
      'Addendum.hash', 'AuditEvent.hash', 'AuditEvent.prevHash', 'ClinicalDocument.sha256',
      'ClinicalDocument.sourceHash', 'CsLogEntry.hash', 'IntegrationConnection.secretRef', 'CsLogEntry.prevHash', 'Document.sha256', 'DoseCalculation.hash',
      'Encounter.contentHash', 'PolicyVersion.rulesHash', 'Proposal.payloadHash', 'ProviderObservation.contentHash',
      'ReminderProtocolVersion.contentHash', 'SoapSectionRevision.contentHash', 'TriageProtocolVersion.contentHash',
    ].sort())
  })
})
