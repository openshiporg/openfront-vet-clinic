import { mergeSchemas } from '@graphql-tools/schema'
import type { GraphQLSchema } from 'graphql'
import redirectToInit from './redirectToInit'
import updateActiveUser from './updateActiveUser'
import { op } from './op'
import * as setup from './setup'
import * as audit from './audit'
import * as approvals from './approvals'
import * as practice from './practice'
import * as clients from './clients'
import * as schedule from './schedule'
import * as reception from './reception'
import * as agents from './agents'
import * as record from './record'
import * as scribe from './scribe'
import * as treatment from './treatment'
import * as vaccines from './vaccines'
import * as imports from './imports'
import '../lib/practiceControls'
import { limitNestedLists } from '../security/breadthLimit'
import { limitSignIn } from '../security/signInLimit'

const graphql = String.raw

// Every domain resolver checks permission itself and runs as one idempotent command: the state
// change, audit events and outbox messages commit in one transaction (features/keystone/lib).
export function extendGraphqlSchema(baseSchema: GraphQLSchema) {
  return limitSignIn(limitNestedLists(mergeSchemas({
    schemas: [baseSchema],
    typeDefs: graphql`
      scalar JSON
      type Query {
        redirectToInit: Boolean
        verifyAuditChain: JSON
        policyInForce(kind: String!, locationId: ID!, on: String): JSON
        policyMatrix: JSON
        searchAvailability(locationId: ID!, appointmentTypeId: ID!, from: String, days: Int, providerId: ID, limit: Int): JSON
        triageQuestions: JSON
        lookupKnowledge(question: String!, locationId: ID): JSON
        receptionContext(callRecordId: ID, clientId: ID): JSON
        previewDose(patientId: ID!, drugId: ID!, doseAmount: String!, doseUnit: String!, dosePer: String!, weightId: ID, context: String, manualOverrideQty: String, overrideReason: String): JSON
      }
      input UserUpdateProfileInput { name: String, email: String, password: String, onboardingStatus: String }
      type Mutation {
        updateActiveUser(data: UserUpdateProfileInput!): User
        loadPracticeSetup(idempotencyKey: String!): JSON
        loadClinicSetup(idempotencyKey: String!): JSON
        decideApprovalRequest(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelApprovalRequest(requestId: ID!, expectedVersion: Int!, reason: String, idempotencyKey: String!): JSON
        requestPracticeControls(changes: JSON!, reason: String!, idempotencyKey: String!): JSON
        registerClient(input: JSON!, idempotencyKey: String!): JSON
        registerPendingClient(input: JSON!, idempotencyKey: String!): JSON
        confirmRegistration(clientId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addPatient(clientId: ID!, input: JSON!, idempotencyKey: String!): JSON
        recordWeight(patientId: ID!, value: String!, unit: String!, method: String, bodyConditionScore: Int, appointmentId: ID, idempotencyKey: String!): JSON
        addPatientAlert(patientId: ID!, kind: String!, severity: String!, text: String!, idempotencyKey: String!): JSON
        recordConsent(contactPointId: ID!, purpose: String!, action: String!, method: String!, callRecordId: ID, keyword: String, idempotencyKey: String!): JSON
        recordPatientDeath(patientId: ID!, diedAt: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        bookAppointment(input: JSON!, idempotencyKey: String!): JSON
        cancelAppointment(appointmentId: ID!, reason: String!, expectedVersion: Int!, callRecordId: ID, idempotencyKey: String!): JSON
        rescheduleAppointment(appointmentId: ID!, slotToken: String!, expectedVersion: Int!, callRecordId: ID, idempotencyKey: String!): JSON
        confirmAppointment(appointmentId: ID!, expectedVersion: Int, idempotencyKey: String!): JSON
        acceptAppointmentRequest(appointmentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        checkInAppointment(appointmentId: ID!, acknowledgedAlertIds: [ID!], expectedVersion: Int!, idempotencyKey: String!): JSON
        markNoShow(appointmentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        moveWhiteboardEntry(entryId: ID!, to: String!, roomId: ID, assignedDvmId: ID, assignedTechId: ID, expectedVersion: Int!, idempotencyKey: String!): JSON
        addToWaitlist(input: JSON!, idempotencyKey: String!): JSON
        startCall(input: JSON!, idempotencyKey: String!): JSON
        recordCallDisclosure(callRecordId: ID!, recordingConsent: String!, idempotencyKey: String!): JSON
        verifyCaller(callRecordId: ID!, method: String!, petName: String!, petDateOfBirth: String!, idempotencyKey: String!): JSON
        appendCallTranscript(callRecordId: ID!, turns: JSON!, idempotencyKey: String!): JSON
        endCall(callRecordId: ID!, disposition: String!, summary: String, transferTo: String, idempotencyKey: String!): JSON
        runTriage(input: JSON!, idempotencyKey: String!): JSON
        referToEmergency(triageId: ID!, referralHospitalId: ID!, idempotencyKey: String!): JSON
        requestRefill(input: JSON!, idempotencyKey: String!): JSON
        requestRecords(input: JSON!, idempotencyKey: String!): JSON
        setAgentKillSwitch(agentId: ID!, killSwitch: Boolean!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        bindAgentApp(agentId: ID!, oauthAppId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        unbindAgentApp(agentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        openEncounter(patientId: ID!, locationId: ID!, kind: String!, appointmentId: ID, reason: String, attendingDvmId: ID, idempotencyKey: String!): JSON
        saveSoapSection(encounterId: ID!, kind: String!, ordinal: Int, body: String!, structured: JSON, templateId: ID, expectedVersion: Int, idempotencyKey: String!): JSON
        recordVitals(encounterId: ID!, temperature: String, temperatureUnit: String, heartRate: Int, respRate: Int, mucousMembranes: String, crtSeconds: String, painScore: Int, bodyConditionScore: Int, mentation: String, hydrationPct: String, idempotencyKey: String!): JSON
        setExamFinding(encounterId: ID!, system: String!, status: String!, text: String, idempotencyKey: String!): JSON
        addDiagnosis(encounterId: ID!, term: String, codeId: ID, certainty: String!, addToProblems: Boolean, chronic: Boolean, idempotencyKey: String!): JSON
        resolveProblem(problemId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        submitEncounter(encounterId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        returnEncounter(encounterId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        signEncounter(encounterId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addAddendum(encounterId: ID!, sectionKind: String!, reason: String!, body: String!, idempotencyKey: String!): JSON
        requestVoidEncounter(encounterId: ID!, reason: String!, idempotencyKey: String!): JSON
        startScribeSession(encounterId: ID!, clientConsent: Boolean!, consentMethod: String, staffAcknowledged: Boolean!, idempotencyKey: String!): JSON
        draftScribeSession(sessionId: ID!, pastedTranscript: String, idempotencyKey: String!): JSON
        acceptScribeDraft(draftId: ID!, blocks: JSON!, idempotencyKey: String!): JSON
        rejectScribeDraft(draftId: ID!, reason: String!, idempotencyKey: String!): JSON
        placeOrder(encounterId: ID!, kind: String!, description: String, drugId: ID, route: String, frequency: String, quantity: String, quantityUnit: String, dose: JSON, extralabel: Boolean, sheet: JSON, idempotencyKey: String!): JSON
        cancelOrder(orderId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        reverseAdministration(administrationId: ID!, reason: String!, witnessId: ID, idempotencyKey: String!): JSON
        completeOrder(orderId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordAdministration(orderId: ID!, qty: String, route: String, site: String, lotId: ID, csContainerId: ID, wasteQty: String, witnessId: ID, supervisingDvmId: ID, treatmentTaskId: ID, qtyOverrideReason: String, idempotencyKey: String!): JSON
        admitPatient(encounterId: ID!, cageId: ID!, codeStatus: String!, reason: String, idempotencyKey: String!): JSON
        moveCage(stayId: ID!, cageId: ID!, idempotencyKey: String!): JSON
        dischargePatient(stayId: ID!, expectedVersion: Int!, instructions: String!, recheckOn: String, idempotencyKey: String!): JSON
        completeTreatmentTask(taskId: ID!, expectedVersion: Int!, observation: String, qty: String, lotId: ID, csContainerId: ID, witnessId: ID, wasteQty: String, earlyReason: String, qtyOverrideReason: String, idempotencyKey: String!): JSON
        skipTreatmentTask(taskId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        rescheduleTreatmentTask(taskId: ID!, expectedVersion: Int!, dueAt: String!, idempotencyKey: String!): JSON
        openAnaesthesia(encounterId: ID!, procedure: String!, asaStatus: String!, fastingConfirmed: Boolean!, consentConfirmed: Boolean!, ivCatheter: JSON, protocol: JSON, anaesthetistId: ID, idempotencyKey: String!): JSON
        anaesthesiaEvent(recordId: ID!, event: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordMonitoring(recordId: ID!, hr: Int, rr: Int, spo2: Int, etco2: Int, sbp: Int, dbp: Int, map: Int, tempC: String, agentPct: String, o2FlowLpm: String, fluidsRateMlHr: String, notes: String, idempotencyKey: String!): JSON
        closeAnaesthesia(recordId: ID!, expectedVersion: Int!, complications: String, idempotencyKey: String!): JSON
        saveSurgeryReport(encounterId: ID!, procedure: String!, technique: String, findings: String, closure: String, sutures: String, specimens: String, assistantId: ID, idempotencyKey: String!): JSON
        saveDentalChart(encounterId: ID!, teeth: JSON!, idempotencyKey: String!): JSON
        administerVaccine(encounterId: ID!, productId: ID!, lotId: ID!, route: String, site: String!, supervisingDvmId: ID, tagNumber: String, repeatReason: String, idempotencyKey: String!): JSON
        reverseVaccineAdministration(vaccineAdministrationId: ID!, reason: String!, idempotencyKey: String!): JSON
        recordOutsideVaccine(patientId: ID!, productId: ID!, administeredOn: String!, lotNumber: String, evidenceNote: String!, idempotencyKey: String!): JSON
        suppressReminder(reminderId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        addManualReminder(patientId: ID!, typeId: ID!, dueOn: String!, idempotencyKey: String!): JSON
        previewImport(system: String!, entity: String!, locationId: ID!, fileName: String, csv: String, mapping: JSON, source: String, idempotencyKey: String!): JSON
        applyImport(batchId: ID!, idempotencyKey: String!): JSON
      }
    `,
    resolvers: {
      Query: {
        redirectToInit,
        verifyAuditChain: op(audit.verifyAuditChain),
        policyInForce: op(practice.policyInForce),
        policyMatrix: op(practice.policyMatrix),
        searchAvailability: op(schedule.searchAvailability),
        triageQuestions: op(reception.triageQuestions),
        lookupKnowledge: op(reception.lookupKnowledge),
        receptionContext: op(reception.receptionContext),
        previewDose: op(treatment.previewDose),
      },
      Mutation: {
        updateActiveUser,
        loadPracticeSetup: op(setup.loadPracticeSetup),
        loadClinicSetup: op(setup.loadClinicSetup),
        decideApprovalRequest: op(approvals.decideApprovalRequest),
        cancelApprovalRequest: op(approvals.cancelApprovalRequest),
        requestPracticeControls: op(approvals.requestPracticeControls),
        registerClient: op(clients.registerClient),
        registerPendingClient: op(clients.registerPendingClient),
        confirmRegistration: op(clients.confirmRegistration),
        addPatient: op(clients.addPatient),
        recordWeight: op(clients.recordWeight),
        addPatientAlert: op(clients.addPatientAlert),
        recordConsent: op(clients.recordConsent),
        recordPatientDeath: op(clients.recordPatientDeath),
        bookAppointment: op(schedule.bookAppointment),
        cancelAppointment: op(schedule.cancelAppointment),
        rescheduleAppointment: op(schedule.rescheduleAppointment),
        confirmAppointment: op(schedule.confirmAppointment),
        acceptAppointmentRequest: op(schedule.acceptAppointmentRequest),
        checkInAppointment: op(schedule.checkInAppointment),
        markNoShow: op(schedule.markNoShow),
        moveWhiteboardEntry: op(schedule.moveWhiteboardEntry),
        addToWaitlist: op(schedule.addToWaitlist),
        startCall: op(reception.startCall),
        recordCallDisclosure: op(reception.recordCallDisclosure),
        verifyCaller: op(reception.verifyCaller),
        appendCallTranscript: op(reception.appendCallTranscript),
        endCall: op(reception.endCall),
        runTriage: op(reception.runTriage),
        referToEmergency: op(reception.referToEmergency),
        requestRefill: op(reception.requestRefill),
        requestRecords: op(reception.requestRecords),
        setAgentKillSwitch: op(agents.setAgentKillSwitch),
        bindAgentApp: op(agents.bindAgentApp),
        unbindAgentApp: op(agents.unbindAgentApp),
        openEncounter: op(record.openEncounter),
        saveSoapSection: op(record.saveSoapSection),
        recordVitals: op(record.recordVitals),
        setExamFinding: op(record.setExamFinding),
        addDiagnosis: op(record.addDiagnosis),
        resolveProblem: op(record.resolveProblem),
        submitEncounter: op(record.submitEncounter),
        returnEncounter: op(record.returnEncounter),
        signEncounter: op(record.signEncounter),
        addAddendum: op(record.addAddendum),
        requestVoidEncounter: op(record.requestVoidEncounter),
        startScribeSession: op(scribe.startScribeSession),
        draftScribeSession: op(scribe.draftScribeSession),
        acceptScribeDraft: op(scribe.acceptScribeDraft),
        rejectScribeDraft: op(scribe.rejectScribeDraft),
        placeOrder: op(treatment.placeOrder),
        cancelOrder: op(treatment.cancelOrder),
        reverseAdministration: op(treatment.reverseAdministration),
        completeOrder: op(treatment.completeOrder),
        recordAdministration: op(treatment.recordAdministration),
        admitPatient: op(treatment.admitPatient),
        moveCage: op(treatment.moveCage),
        dischargePatient: op(treatment.dischargePatient),
        completeTreatmentTask: op(treatment.completeTreatmentTask),
        skipTreatmentTask: op(treatment.skipTreatmentTask),
        rescheduleTreatmentTask: op(treatment.rescheduleTreatmentTask),
        openAnaesthesia: op(treatment.openAnaesthesia),
        anaesthesiaEvent: op(treatment.anaesthesiaEvent),
        recordMonitoring: op(treatment.recordMonitoring),
        closeAnaesthesia: op(treatment.closeAnaesthesia),
        saveSurgeryReport: op(treatment.saveSurgeryReport),
        saveDentalChart: op(treatment.saveDentalChart),
        administerVaccine: op(vaccines.administerVaccine),
        reverseVaccineAdministration: op(vaccines.reverseVaccineAdministration),
        recordOutsideVaccine: op(vaccines.recordOutsideVaccine),
        suppressReminder: op(vaccines.suppressReminder),
        addManualReminder: op(vaccines.addManualReminder),
        previewImport: op(imports.previewImport),
        applyImport: op(imports.applyImport),
      },
    },
  })))
}
