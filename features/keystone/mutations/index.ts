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
import '../lib/practiceControls'

const graphql = String.raw

// Every domain resolver checks permission itself and runs as one idempotent command: the state
// change, audit events and outbox messages commit in one transaction (features/keystone/lib).
export function extendGraphqlSchema(baseSchema: GraphQLSchema) {
  return mergeSchemas({
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
      },
    },
  })
}
