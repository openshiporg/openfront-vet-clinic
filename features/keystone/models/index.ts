import { User } from './User'
import { Role } from './Role'
import { OAuthApp } from './OAuthApp'
import { OAuthToken } from './OAuthToken'
import * as platform from './platform'
import * as practice from './practice'
import * as compliance from './compliance'
import * as clients from './clients'
import * as schedule from './schedule'
import * as comms from './comms'
import * as pharmacy from './pharmacy'
import { INVENTORY_LISTS } from './inventory'
import { BILLING_LISTS } from './billing'
import { WELLNESS_LISTS } from './wellness'
import { BOARDING_LISTS } from './boarding'
import { END_OF_LIFE_LISTS } from './endOfLife'
import * as record from './record'
import * as treatment from './treatment'
import * as preventive from './preventive'
import * as imports from './imports'
import { AgentToolGrant, AgentRun, AgentAction, Proposal } from './agents'
import { registerListAccess } from './guardedRelationship'

export const models = {
  User,
  Role,
  OAuthApp,
  OAuthToken,
  ...platform,
  ...practice,
  ...compliance,
  ...clients,
  ...schedule,
  ...comms,
  DrugProduct: pharmacy.DrugProduct,
  Prescription: pharmacy.Prescription,
  PrescriptionLine: pharmacy.PrescriptionLine,
  CsContainer: pharmacy.CsContainer,
  CsLogEntry: pharmacy.CsLogEntry,
  Dispense: pharmacy.Dispense,
  CsCount: pharmacy.CsCount,
  CsCountLine: pharmacy.CsCountLine,
  CsDiscrepancyCase: pharmacy.CsDiscrepancyCase,
  CsDestructionRecord: pharmacy.CsDestructionRecord,
  PdmpReport: pharmacy.PdmpReport,
  CsWitness: pharmacy.CsWitness,
  CsOrderForm: pharmacy.CsOrderForm,
  CsOrderFormLine: pharmacy.CsOrderFormLine,
  CsTransfer: pharmacy.CsTransfer,
  PdmpSubmission: pharmacy.PdmpSubmission,
  CabinetAccessEvent: pharmacy.CabinetAccessEvent,
  DispenseLabel: pharmacy.DispenseLabel,
  ExternalDispense: pharmacy.ExternalDispense,
  WrittenRxExport: pharmacy.WrittenRxExport,
  ...INVENTORY_LISTS,
  // Phase 4: estimates, fee schedules, invoices, payments, insurance
  ...BILLING_LISTS,
  // Phase 5: wellness plans, boarding, grooming and end of life
  ...WELLNESS_LISTS,
  ...BOARDING_LISTS,
  ...END_OF_LIFE_LISTS,
  // Phase 2: the medical record, orders and treatment, preventive care, incumbent import
  Encounter: record.Encounter,
  SoapSection: record.SoapSection,
  SoapSectionRevision: record.SoapSectionRevision,
  Addendum: record.Addendum,
  VitalsObservation: record.VitalsObservation,
  PhysicalExamFinding: record.PhysicalExamFinding,
  DiagnosisCode: record.DiagnosisCode,
  Problem: record.Problem,
  Diagnosis: record.Diagnosis,
  ClinicalAttachment: record.ClinicalAttachment,
  ClinicalDocument: record.ClinicalDocument,
  RecordTemplate: record.RecordTemplate,
  Glossary: record.Glossary,
  ScribeSession: record.ScribeSession,
  ScribeDraft: record.ScribeDraft,
  Referral: record.Referral,
  ClinicalOrder: treatment.ClinicalOrder,
  DoseCalculation: treatment.DoseCalculation,
  InventoryLot: treatment.InventoryLot,
  Administration: treatment.Administration,
  Ward: treatment.Ward,
  Cage: treatment.Cage,
  HospitalStay: treatment.HospitalStay,
  CageAssignment: treatment.CageAssignment,
  TreatmentSheetOrder: treatment.TreatmentSheetOrder,
  TreatmentTask: treatment.TreatmentTask,
  AnaesthesiaRecord: treatment.AnaesthesiaRecord,
  MonitoringReading: treatment.MonitoringReading,
  SurgeryReport: treatment.SurgeryReport,
  DentalChart: treatment.DentalChart,
  DischargeInstruction: treatment.DischargeInstruction,
  VaccineProduct: preventive.VaccineProduct,
  VaccineAdministration: preventive.VaccineAdministration,
  RabiesCertificate: preventive.RabiesCertificate,
  ReminderType: preventive.ReminderType,
  ReminderProtocol: preventive.ReminderProtocol,
  ReminderProtocolVersion: preventive.ReminderProtocolVersion,
  ReminderRule: preventive.ReminderRule,
  PatientReminder: preventive.PatientReminder,
  ReminderSatisfaction: preventive.ReminderSatisfaction,
  AdverseEventReport: preventive.AdverseEventReport,
  ImportBatch: imports.ImportBatch,
  ImportRow: imports.ImportRow,
  AgentToolGrant,
  AgentRun,
  AgentAction,
  Proposal,
}

/**
 * F3 (review r3b): no list query returns more than API_MAX_TAKE rows in one call (take:100000
 * returned 10k rows). The busiest screens ask for 400–500 (pickers, the notes overlay); everything
 * else pages. MCP reads are capped lower again (mcp/safeQuery.ts MAX_TAKE).
 */
export const API_MAX_TAKE = 500
for (const list of Object.values(models) as { graphql?: Record<string, unknown> }[]) {
  list.graphql = { ...(list.graphql ?? {}), maxTake: API_MAX_TAKE }
}

// Relationship filter/order access follows each target list's read access (guardedRelationship.ts).
registerListAccess(models as never)

export default models
