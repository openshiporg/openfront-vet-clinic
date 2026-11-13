/**
 * ReadAudit (SCHEMA §17, I-R3): every GraphQL operation that returns clinical or client records
 * writes one row per resource returned: who, which record, which fields (names only, never values),
 * the purpose, and the request id. Adapted from the hospital vertical's PHI read audit; here the
 * walker follows the selection set alongside the result, so the audit names the records actually
 * returned rather than the ones asked for.
 *
 * Writing the audit is not optional: if it fails, the response is replaced by an error (fail closed),
 * because an unaudited clinical read is not allowed to leave the server.
 *
 * Plain module: no @/ imports.
 */
import { GraphQLError, Kind, type DocumentNode, type FieldNode, type FragmentDefinitionNode, type OperationDefinitionNode, type SelectionSetNode } from 'graphql'

/**
 * GraphQL types whose rows are clinical or client data. Later phases add their lists here; the
 * contract test in tests/read-audit.test.ts fails if a clinical list in the schema is missing.
 */
export const AUDITED_TYPES = new Set<string>([
  // Phase 1: clients, people, contact points, consent, comms, records requests
  'Client', 'ClientPerson', 'ContactPoint', 'ConsentRecord', 'CommsThread', 'CommsMessage', 'CallRecord', 'RecordsRequest', 'RecordsRelease',
  // Patients and the clinical record
  'Patient', 'BoardingReservation', 'BoardingStay', 'PatientWeight', 'PatientAlert', 'PatientAllergy', 'PatientProblem', 'Encounter', 'EncounterSection', 'Addendum', 'VitalsSet',
  'Prescription', 'PrescriptionLine', 'Dispense', 'RefillRequest', 'VaccinationRecord', 'RabiesCertificate', 'LabOrder', 'LabResult',
  'AnaesthesiaRecord', 'SurgeryRecord', 'EuthanasiaConsent', 'TreatmentSheet', 'Treatment', 'Estimate', 'Invoice', 'Payment',
  'Appointment', 'Boarding', 'Hospitalization', 'ClinicalDocument', 'ScribeDraft', 'Referral',
  // Phase 1 lists that carry PHI-grade detail: ownership, weights, chips, VCPR, insurance, schedule, triage, board
  'PatientOwnership', 'WeightMeasurement', 'AlertAcknowledgement', 'Microchip', 'VcprRecord', 'PetInsurancePolicy',
  'AppointmentPatient', 'AppointmentSegment', 'WaitlistEntry', 'TriageAssessment', 'WhiteboardEntry', 'Suppression',
  'CsContainer', 'CsLogEntry', 'CsCount', 'CsCountLine', 'CsDiscrepancyCase', 'CsDestructionRecord', 'PdmpReport', 'DispenseLabel', 'ExternalDispense', 'WrittenRxExport', 'RecallExposure', 'CsWitness', 'CsOrderForm', 'CsOrderFormLine', 'CsTransfer', 'PdmpSubmission', 'CabinetAccessEvent',
  // Phase 4: estimates, plans, money. Reading what a client owes or paid is recorded like reading their chart.
  'EstimateVersion', 'EstimateOption', 'EstimateLine', 'EstimateAcceptance', 'TreatmentPlan', 'TreatmentPlanItem', 'PaymentAttempt', 'PaymentAllocation',
  'PaymentWebhookEvent', 'ClientLedgerEntry', 'ChargeLine', 'CreditNote', 'Refund', 'Deposit', 'PayerAuthorization', 'InsuranceClaimPacket', 'OverageApproval',
  // Phase 2: the medical record, orders and treatment, preventive care
  'SoapSection', 'SoapSectionRevision', 'VitalsObservation', 'PhysicalExamFinding', 'Problem', 'Diagnosis', 'ClinicalAttachment', 'ScribeSession',
  'ClinicalOrder', 'DoseCalculation', 'Administration', 'HospitalStay', 'CageAssignment', 'TreatmentSheetOrder', 'TreatmentTask', 'MonitoringReading',
  'SurgeryReport', 'DentalChart', 'DischargeInstruction', 'VaccineAdministration', 'PatientReminder', 'ReminderSatisfaction', 'AdverseEventReport',
  // Phase 6: diagnostics and pay
  'Specimen', 'LabResultValue', 'ResultReview', 'ImagingOrder', 'ImagingStudy', 'ImagingReport', 'ProductionCredit', 'Commission', 'PayPeriod', 'PayrollExportBatch', 'ExportJob',
])

type Ref = { resourceType: string; resourceId: string | null; fields: Set<string> }

function opOf(document: DocumentNode, operationName?: string | null): OperationDefinitionNode | undefined {
  const ops = document.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
  return operationName ? ops.find(o => o.name?.value === operationName) : ops.length === 1 ? ops[0] : undefined
}

function fieldsIn(set: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, typename: string | null, seen = new Set<string>()): FieldNode[] {
  const out: FieldNode[] = []
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) out.push(s)
    else if (s.kind === Kind.INLINE_FRAGMENT) {
      if (!s.typeCondition || !typename || s.typeCondition.name.value === typename) out.push(...fieldsIn(s.selectionSet, fragments, typename, seen))
    } else if (s.kind === Kind.FRAGMENT_SPREAD && !seen.has(s.name.value)) {
      seen.add(s.name.value)
      const f = fragments.get(s.name.value)
      if (f && (!typename || f.typeCondition.name.value === typename)) out.push(...fieldsIn(f.selectionSet, fragments, typename, seen))
    }
  }
  return out
}

/**
 * Walk the result with the selection set. Objects carry `__typename` when the operation asked for
 * it; otherwise the type is taken from the schema field via `typeOf`.
 */
export function collectReads(input: {
  document: DocumentNode
  operationName?: string | null
  data: unknown
  typeOf: (parentType: string, field: string) => string | null
  rootType?: string
}): Ref[] {
  const op = opOf(input.document, input.operationName)
  if (!op || !input.data || typeof input.data !== 'object') return []
  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const d of input.document.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d)
  const refs = new Map<string, Ref>()

  const visit = (value: unknown, typeName: string | null, set: SelectionSetNode | undefined) => {
    if (value == null || !set) return
    if (Array.isArray(value)) { for (const v of value) visit(v, typeName, set); return }
    if (typeof value !== 'object') return
    const obj = value as Record<string, unknown>
    const actualType = typeof obj.__typename === 'string' ? obj.__typename : typeName
    const fields = fieldsIn(set, fragments, actualType)
    if (actualType && AUDITED_TYPES.has(actualType)) {
      const id = typeof obj.id === 'string' ? obj.id : null
      const key = `${actualType}:${id ?? '?'}`
      const ref = refs.get(key) ?? { resourceType: actualType, resourceId: id, fields: new Set<string>() }
      for (const f of fields) if (!f.selectionSet && f.name.value !== '__typename') ref.fields.add(f.name.value)
      refs.set(key, ref)
    }
    for (const f of fields) {
      if (!f.selectionSet) continue
      const responseKey = f.alias?.value ?? f.name.value
      const childType = actualType ? input.typeOf(actualType, f.name.value) : null
      visit(obj[responseKey], childType, f.selectionSet)
    }
  }

  const root = input.rootType ?? (op.operation === 'mutation' ? 'Mutation' : 'Query')
  visit(input.data, root, op.selectionSet)
  return [...refs.values()]
}

export type ReadAuditActor = { actorKind: 'user' | 'agent' | 'system' | 'portal'; actorId: string; actorLabel?: string | null }

export function actorFromSession(session: any): ReadAuditActor | null {
  if (!session?.itemId) return null
  if (session.mcp) return { actorKind: 'agent', actorId: `oauth:${session.mcp.clientId}:${session.itemId}`, actorLabel: session.data?.name ?? null }
  if (session.data?.kind === 'agent') return { actorKind: 'agent', actorId: String(session.itemId), actorLabel: session.data?.name ?? null }
  return { actorKind: 'user', actorId: String(session.itemId), actorLabel: session.data?.name ?? null }
}

/** Patient or client the row belongs to, when the resource is one of those. */
const subjectOf = (ref: Ref) => ({
  patientId: ref.resourceType === 'Patient' ? ref.resourceId ?? '' : '',
  clientId: ref.resourceType === 'Client' ? ref.resourceId ?? '' : '',
})

export async function writeReadAudit(prisma: any, actor: ReadAuditActor, refs: Ref[], purpose: string, requestId: string | null) {
  if (!refs.length) return 0
  await prisma.readAudit.createMany({
    data: refs.slice(0, 5_000).map(ref => ({
      actorKind: actor.actorKind, actorId: actor.actorId, actorLabel: actor.actorLabel ?? '', resourceType: ref.resourceType, resourceId: ref.resourceId ?? '',
      ...subjectOf(ref), purpose, fields: [...ref.fields].sort(), requestId: requestId ?? '',
    })),
  })
  return refs.length
}

const PURPOSES = new Set(['treatment', 'operations', 'records_request', 'agent_tool', 'audit', 'break_glass'])

/**
 * Yoga plugin. Runs after execution; the request may name its purpose in the `x-access-purpose`
 * header (default: treatment for people, agent_tool for agents).
 */
export function readAuditPlugin(getPrisma: () => any) {
  return {
    onExecute({ args }: any) {
      return {
        async onExecuteDone({ result, setResult }: any) {
          if (!result || typeof result[Symbol.asyncIterator] === 'function') return
          const actor = actorFromSession(args?.contextValue?.session)
          if (!actor || !result.data) return
          try {
            const schema = args.schema
            const typeOf = (parent: string, field: string) => {
              const t: any = schema?.getType(parent)
              const f = t?.getFields?.()[field]
              if (!f) return null
              let ft = f.type
              while (ft?.ofType) ft = ft.ofType
              return ft?.name ?? null
            }
            const refs = collectReads({ document: args.document, operationName: args.operationName, data: result.data, typeOf })
            if (!refs.length) return
            const req = args?.contextValue?.req
            const asked = String(req?.headers?.['x-access-purpose'] ?? '')
            const purpose = PURPOSES.has(asked) ? asked : actor.actorKind === 'agent' ? 'agent_tool' : 'treatment'
            const requestId = (req?.headers?.['x-request-id'] as string | undefined) ?? null
            await writeReadAudit(getPrisma(), actor, refs, purpose, requestId)
          } catch {
            setResult({ data: null, errors: [new GraphQLError('This read could not be audited, so it was not returned.', { extensions: { code: 'READ_AUDIT_FAILED' } })] })
          }
        },
      }
    },
  }
}
