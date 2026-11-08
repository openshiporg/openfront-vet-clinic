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
import * as record from './record'
import * as treatment from './treatment'
import * as preventive from './preventive'
import * as imports from './imports'
import { AgentToolGrant, AgentRun, AgentAction, Proposal } from './agents'

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

export default models
