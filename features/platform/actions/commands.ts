'use server';

import { revalidatePath } from 'next/cache';
import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

/**
 * The only custom operations the dashboard screens can call. Each takes an idempotency key that the
 * client makes once per intent and reuses on retry, so a lost response never acts twice.
 */
const OPS: Record<string, Record<string, string>> = {
  decideApprovalRequest: { requestId: 'ID!', decision: 'String!', reason: 'String', expectedVersion: 'Int!' },
  cancelApprovalRequest: { requestId: 'ID!', expectedVersion: 'Int!', reason: 'String' },
  requestPracticeControls: { changes: 'JSON!', reason: 'String!' },
  setAgentKillSwitch: { agentId: 'ID!', killSwitch: 'Boolean!', reason: 'String', expectedVersion: 'Int!' },
  confirmRegistration: { clientId: 'ID!', expectedVersion: 'Int!' },
  confirmAppointment: { appointmentId: 'ID!', expectedVersion: 'Int' },
  checkInAppointment: { appointmentId: 'ID!', acknowledgedAlertIds: '[ID!]', expectedVersion: 'Int!' },
  markNoShow: { appointmentId: 'ID!', expectedVersion: 'Int!' },
  cancelAppointment: { appointmentId: 'ID!', reason: 'String!', expectedVersion: 'Int!' },
  acceptAppointmentRequest: { appointmentId: 'ID!', expectedVersion: 'Int!' },
  moveWhiteboardEntry: { entryId: 'ID!', to: 'String!', expectedVersion: 'Int!' },
  bookAppointment: { input: 'JSON!' },
  registerClient: { input: 'JSON!' },
  recordWeight: { patientId: 'ID!', value: 'String!', unit: 'String!', method: 'String', bodyConditionScore: 'Int' },
  addPatientAlert: { patientId: 'ID!', kind: 'String!', severity: 'String!', text: 'String!' },
  // Phase 2: the medical record, orders, the treatment sheet, anaesthesia, vaccines, imports.
  openEncounter: { patientId: 'ID!', locationId: 'ID!', kind: 'String!', appointmentId: 'ID', reason: 'String', attendingDvmId: 'ID' },
  saveSoapSection: { encounterId: 'ID!', kind: 'String!', ordinal: 'Int', body: 'String!', structured: 'JSON', templateId: 'ID', expectedVersion: 'Int' },
  recordVitals: { encounterId: 'ID!', temperature: 'String', temperatureUnit: 'String', heartRate: 'Int', respRate: 'Int', mucousMembranes: 'String', crtSeconds: 'String', painScore: 'Int', bodyConditionScore: 'Int', mentation: 'String', hydrationPct: 'String' },
  setExamFinding: { encounterId: 'ID!', system: 'String!', status: 'String!', text: 'String' },
  addDiagnosis: { encounterId: 'ID!', term: 'String', codeId: 'ID', certainty: 'String!', addToProblems: 'Boolean', chronic: 'Boolean' },
  resolveProblem: { problemId: 'ID!', expectedVersion: 'Int!' },
  submitEncounter: { encounterId: 'ID!', expectedVersion: 'Int!' },
  returnEncounter: { encounterId: 'ID!', expectedVersion: 'Int!', reason: 'String!' },
  signEncounter: { encounterId: 'ID!', expectedVersion: 'Int!' },
  addAddendum: { encounterId: 'ID!', sectionKind: 'String!', reason: 'String!', body: 'String!' },
  requestVoidEncounter: { encounterId: 'ID!', reason: 'String!' },
  startScribeSession: { encounterId: 'ID!', clientConsent: 'Boolean!', consentMethod: 'String', staffAcknowledged: 'Boolean!' },
  draftScribeSession: { sessionId: 'ID!', pastedTranscript: 'String' },
  acceptScribeDraft: { draftId: 'ID!', blocks: 'JSON!' },
  rejectScribeDraft: { draftId: 'ID!', reason: 'String!' },
  placeOrder: { encounterId: 'ID!', kind: 'String!', description: 'String', drugId: 'ID', route: 'String', frequency: 'String', quantity: 'String', quantityUnit: 'String', dose: 'JSON', extralabel: 'Boolean', sheet: 'JSON' },
  cancelOrder: { orderId: 'ID!', expectedVersion: 'Int!', reason: 'String!' },
  reverseAdministration: { administrationId: 'ID!', reason: 'String!', witnessId: 'ID' },
  completeOrder: { orderId: 'ID!', expectedVersion: 'Int!' },
  recordAdministration: { orderId: 'ID!', qty: 'String', route: 'String', site: 'String', lotId: 'ID', csContainerId: 'ID', wasteQty: 'String', witnessId: 'ID', supervisingDvmId: 'ID', treatmentTaskId: 'ID' },
  admitPatient: { encounterId: 'ID!', cageId: 'ID!', codeStatus: 'String!', reason: 'String' },
  moveCage: { stayId: 'ID!', cageId: 'ID!' },
  dischargePatient: { stayId: 'ID!', expectedVersion: 'Int!', instructions: 'String!', recheckOn: 'String' },
  completeTreatmentTask: { taskId: 'ID!', expectedVersion: 'Int!', observation: 'String', qty: 'String', lotId: 'ID', csContainerId: 'ID', witnessId: 'ID', wasteQty: 'String', earlyReason: 'String' },
  skipTreatmentTask: { taskId: 'ID!', expectedVersion: 'Int!', reason: 'String!' },
  rescheduleTreatmentTask: { taskId: 'ID!', expectedVersion: 'Int!', dueAt: 'String!' },
  openAnaesthesia: { encounterId: 'ID!', procedure: 'String!', asaStatus: 'String!', fastingConfirmed: 'Boolean!', consentConfirmed: 'Boolean!', ivCatheter: 'JSON', protocol: 'JSON', anaesthetistId: 'ID' },
  anaesthesiaEvent: { recordId: 'ID!', event: 'String!', expectedVersion: 'Int!' },
  recordMonitoring: { recordId: 'ID!', hr: 'Int', rr: 'Int', spo2: 'Int', etco2: 'Int', sbp: 'Int', dbp: 'Int', map: 'Int', tempC: 'String', agentPct: 'String', o2FlowLpm: 'String', fluidsRateMlHr: 'String', notes: 'String' },
  closeAnaesthesia: { recordId: 'ID!', expectedVersion: 'Int!', complications: 'String' },
  saveSurgeryReport: { encounterId: 'ID!', procedure: 'String!', technique: 'String', findings: 'String', closure: 'String', sutures: 'String', specimens: 'String', assistantId: 'ID' },
  saveDentalChart: { encounterId: 'ID!', teeth: 'JSON!' },
  administerVaccine: { encounterId: 'ID!', productId: 'ID!', lotId: 'ID!', route: 'String', site: 'String!', supervisingDvmId: 'ID', tagNumber: 'String', repeatReason: 'String' },
  reverseVaccineAdministration: { vaccineAdministrationId: 'ID!', reason: 'String!' },
  recordOutsideVaccine: { patientId: 'ID!', productId: 'ID!', administeredOn: 'String!', lotNumber: 'String', evidenceNote: 'String!' },
  suppressReminder: { reminderId: 'ID!', expectedVersion: 'Int!', reason: 'String!' },
  addManualReminder: { patientId: 'ID!', typeId: 'ID!', dueOn: 'String!' },
  previewImport: { system: 'String!', entity: 'String!', locationId: 'ID!', fileName: 'String', csv: 'String', mapping: 'JSON', source: 'String' },
  applyImport: { batchId: 'ID!' },
};

const KEY = /^[A-Za-z0-9._:-]{8,200}$/;

export async function runCommand(op: string, variables: Record<string, unknown>, idempotencyKey: string, paths: string[] = []) {
  const spec = OPS[op];
  if (!spec) return { ok: false as const, error: 'Unknown action' };
  if (!KEY.test(idempotencyKey)) return { ok: false as const, error: 'Missing request key. Reload the page and try again.' };
  const keys = Object.keys(variables).filter((k) => k in spec && variables[k] !== undefined && variables[k] !== '');
  const decl = [...keys.map((k) => `$${k}: ${spec[k]}`), '$idempotencyKey: String!'];
  const args = [...keys.map((k) => `${k}: $${k}`), 'idempotencyKey: $idempotencyKey'];
  const vars: Record<string, unknown> = { ...Object.fromEntries(keys.map((k) => [k, variables[k]])), idempotencyKey };
  const res = await keystoneClient(`mutation Run(${decl.join(', ')}) { ${op}(${args.join(', ')}) }`, vars);
  if (!res.success) return { ok: false as const, error: res.error || 'Action failed' };
  for (const p of paths) revalidatePath(p);
  return { ok: true as const, data: (res.data as Record<string, unknown>)?.[op] };
}
