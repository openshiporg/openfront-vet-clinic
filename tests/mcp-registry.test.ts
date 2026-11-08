import { describe, expect, it } from 'vitest'
import { parse } from 'graphql'
import { assertToolAllowed, DOMAIN_TOOLS, NEVER_TOOL_PATTERNS, registerDomainTools } from '../features/keystone/mcp'
import { NEVER_FOR_AGENTS } from '../features/keystone/access'
import { collectReads } from '../features/keystone/security/readAudit'

/**
 * I-G4: agents (the AI receptionist, scribe, external MCP clients) never reach VCPR, prescribing,
 * refill decisions, record signing, the controlled-substance register, euthanasia, money against
 * the client, publishing, merges, card data, approvals, or generic CRUD.
 */
describe('MCP registry never-list', () => {
  const forbidden = [
    'establishVcpr', 'signPrescription', 'sign_rx', 'decideRefill', 'approveRefill', 'signEncounter', 'addAddendum',
    'csAdminister', 'recordControlledWaste', 'readCsLog', 'createCsCount', 'submitPdmp', 'euthanasiaConsent',
    'applyDiscount', 'issueRefund', 'postWriteOff', 'publishFeeSchedule', 'updatePolicy', 'mergeClients',
    'captureCardNumber', 'decideApprovalRequest', 'createPatient', 'updateClient', 'deleteAppointment',
  ]

  it.each(forbidden)('refuses %s', name => {
    expect(() => assertToolAllowed({ name, document: `mutation X { ${name} }` })).toThrow(/never allowed/)
    expect(() => registerDomainTools([{ name, description: 'x', inputSchema: { type: 'object', properties: {}, required: [] }, document: `mutation { ${name} }`, field: name, writes: true }])).toThrow(/never allowed/)
  })

  it('a harmless name cannot smuggle a forbidden operation in its document', () => {
    expect(() => assertToolAllowed({ name: 'helpful_tool', document: 'mutation { signPrescription(id: "1") }' })).toThrow(/never allowed/)
    expect(() => assertToolAllowed({ name: 'look_up', document: 'query { csLogEntries { id } }' })).toThrow(/never allowed/)
  })

  it('allows the receptionist-shaped tools', () => {
    for (const name of ['reception_find_slots', 'reception_book', 'reception_register_client', 'triage_run', 'pharmacy_refill_intake', 'records_request', 'payment_link_send']) {
      expect(() => assertToolAllowed({ name, document: `mutation { ${name.replace(/_(.)/g, (_, c) => c.toUpperCase())} }` }), name).not.toThrow()
    }
  })

  it('every registered tool passes the never-list and is valid GraphQL', () => {
    expect(DOMAIN_TOOLS.length).toBeGreaterThan(0)
    for (const tool of DOMAIN_TOOLS) {
      expect(() => assertToolAllowed(tool), tool.name).not.toThrow()
      expect(() => parse(tool.document), tool.name).not.toThrow()
    }
    expect(NEVER_TOOL_PATTERNS.length).toBeGreaterThanOrEqual(10)
  })

  it('agent roles can never hold the human-only permissions', () => {
    for (const p of ['canPrescribe', 'canSignRecord', 'canAuthoriseEuthanasia', 'canAdministerControlled', 'canWitnessControlled', 'canManageControlled', 'canIssueRefunds', 'canApprovePolicies', 'canBreakGlass']) {
      expect(NEVER_FOR_AGENTS, p).toContain(p)
    }
  })
})

describe('Phase 2 clinical commands stay off MCP', () => {
  // Charting, orders, administration, anaesthesia, vaccines and imports are clinical acts by a
  // person (humanOnly in the resolver too); no tool may reach them, whatever its name.
  const CLINICAL = ['openEncounter', 'saveSoapSection', 'recordVitals', 'setExamFinding', 'addDiagnosis', 'submitEncounter', 'signEncounter', 'addAddendum', 'requestVoidEncounter', 'startScribeSession', 'draftScribeSession', 'acceptScribeDraft', 'placeOrder', 'recordAdministration', 'completeTreatmentTask', 'admitPatient', 'dischargePatient', 'openAnaesthesia', 'recordMonitoring', 'closeAnaesthesia', 'saveSurgeryReport', 'administerVaccine', 'recordOutsideVaccine', 'applyImport', 'previewDose']
  it('no registered tool document calls a clinical command', () => {
    for (const tool of DOMAIN_TOOLS) for (const op of CLINICAL) expect(tool.document, `${tool.name} → ${op}`).not.toMatch(new RegExp(`\\b${op}\\(`))
  })
  it('the record-signing and controlled paths are on the never-list', () => {
    for (const name of ['signEncounter', 'addAddendum', 'sign_record', 'recordControlledAdministration', 'cs_waste']) {
      expect(() => assertToolAllowed({ name, document: 'query { x }' }), name).toThrow()
    }
  })
})

describe('read audit walker', () => {
  const typeOf = (parent: string, field: string) => ({ Query: { patients: 'Patient', clients: 'Client' }, Patient: { owner: 'Client', weights: 'PatientWeight' }, Client: {} } as Record<string, Record<string, string>>)[parent]?.[field] ?? null

  it('names every clinical record returned and the fields read, never values', () => {
    const document = parse('query P { patients { id name species owner { id displayName } weights { id kg } } }')
    const data = { patients: [{ id: 'p1', name: 'Biscuit', species: 'dog', owner: { id: 'c1', displayName: 'Rivera' }, weights: [{ id: 'w1', kg: '12.4000' }] }, { id: 'p2', name: 'Miso', species: 'cat', owner: null, weights: [] }] }
    const refs = collectReads({ document, data, typeOf })
    expect(refs.map(r => `${r.resourceType}:${r.resourceId}`).sort()).toEqual(['Client:c1', 'Patient:p1', 'Patient:p2', 'PatientWeight:w1'])
    const p1 = refs.find(r => r.resourceId === 'p1')!
    expect([...p1.fields].sort()).toEqual(['id', 'name', 'species'])
    expect(JSON.stringify(refs.map(r => [...r.fields]))).not.toContain('Biscuit')
  })

  it('follows aliases and fragments, and ignores non-clinical types', () => {
    const document = parse('query { pets: patients { ...F } } fragment F on Patient { id name }')
    const refs = collectReads({ document, data: { pets: [{ id: 'p9', name: 'Pepper' }] }, typeOf })
    expect(refs).toHaveLength(1)
    expect(refs[0].resourceId).toBe('p9')
    expect(collectReads({ document: parse('query { verifyAuditChain }'), data: { verifyAuditChain: { ok: true } }, typeOf })).toEqual([])
  })
})
