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
import * as portability from './portability'
import * as treatment from './treatment'
import * as vaccines from './vaccines'
import * as imports from './imports'
import * as clocks from './clocks'
import * as pharmacy from './pharmacy'
import * as inventory from './inventory'
import * as register from './register'
import * as fees from './fees'
import * as estimates from './estimates'
import * as billing from './billing'
import * as insurance from './insurance'
import * as wellness from './wellness'
import * as diagnostics from './diagnostics'
import * as production from './production'
import * as agentsWider from './agentsWider'
import * as recordsRelease from './recordsRelease'
import * as boarding from './boarding'
import * as endOfLife from './endOfLife'
import '../lib/practiceControls'
import { limitNestedLists } from '../security/breadthLimit'
import { limitSignIn } from '../security/signInLimit'

const graphql = String.raw

// Every domain resolver checks permission itself and runs as one idempotent command: the state
// change and audit events commit in one transaction (features/keystone/lib).
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
        savePlanVersion(code: String!, name: String!, summary: String, label: String!, monthlyPriceMinor: String!, termMonths: Int!, speciesCodes: [String!], minAgeWeeks: Int, maxAgeMonths: Int, entitlements: JSON!, otherServicesDiscountBps: Int, trueUpNote: String, idempotencyKey: String!): JSON
        enrolPatient(patientId: ID!, planVersionId: ID!, signerId: ID!, method: String!, affirmed: Boolean!, paymentMethodId: String, idempotencyKey: String!): JSON
        runPlanBilling(periodKey: String, locationId: ID, idempotencyKey: String!): JSON
        retryPlanCharge(attemptId: ID!, idempotencyKey: String!): JSON
        checkPlanCharge(attemptId: ID!, idempotencyKey: String!): JSON
        replacePlanCard(enrollmentId: ID!, signerId: ID!, affirmed: Boolean!, paymentMethodId: String, idempotencyKey: String!): JSON
        cancelEnrollment(enrollmentId: ID!, reason: String!, waiveTrueUp: Boolean, expectedVersion: Int!, idempotencyKey: String!): JSON
        useEntitlement(enrollmentId: ID!, code: String!, qty: Int, memo: String, idempotencyKey: String!): JSON
        returnEntitlement(entryId: ID!, reason: String!, idempotencyKey: String!): JSON
        saveRunType(runTypeId: ID, code: String!, name: String!, locationId: ID!, speciesCodes: [String!], maxWeightKg: Float, nightlyRateMinor: String!, depositMinor: String, runs: Int!, idempotencyKey: String!): JSON
        setRunStatus(runId: ID!, status: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        reserveBoarding(patientId: ID!, runTypeId: ID!, checkInOn: String!, checkOutOn: String!, notes: String, vaccineOverrideReason: String, idempotencyKey: String!): JSON
        confirmBoarding(reservationId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelBoarding(reservationId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        checkInBoarding(reservationId: ID!, runId: ID, feeding: String, handling: String, medications: String, emergencyContactName: String!, emergencyContactPhone: String!, medicalLimitMinor: String, belongings: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        moveBoardingRun(stayId: ID!, runId: ID!, idempotencyKey: String!): JSON
        logBoardingCare(stayId: ID!, kind: String!, note: String, idempotencyKey: String!): JSON
        returnBelonging(itemId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        checkOutBoarding(stayId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        bookGroom(patientId: ID!, groomerId: ID!, startsAt: String!, service: String!, idempotencyKey: String!): JSON
        advanceGroom(groomId: ID!, to: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        saveGroomNote(patientId: ID!, blade: String, style: String, behaviour: String, notes: String, photoUrl: String, groomId: ID, idempotencyKey: String!): JSON
        signEuthanasiaConsent(patientId: ID!, signerId: ID, authority: String!, authorityNote: String, biteAttestation: String!, aftercare: String!, clientPresent: Boolean!, method: String!, signatureText: String!, witnessId: ID, idempotencyKey: String!): JSON
        revokeEuthanasiaConsent(consentId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordEuthanasia(patientId: ID!, consentId: ID!, diedAt: String, causeNote: String, tagNumber: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        advanceAftercare(orderId: ID!, step: String!, place: String, crematory: String, manifestRef: String, crematoryRef: String, receivedBy: String, tagNumber: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addMemorialItem(orderId: ID!, kind: String!, description: String, idempotencyKey: String!): JSON
        orderLab(patientId: ID!, labId: ID!, testIds: [ID!]!, encounterId: ID, locationId: ID, idempotencyKey: String!): JSON
        collectSpecimen(labOrderId: ID!, kind: String!, containerId: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        sendLabOrder(labOrderId: ID!, accessionId: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelLabOrder(labOrderId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        enterLabResult(labId: ID!, accessionId: String!, status: String!, lines: JSON!, idempotencyKey: String!): JSON
        importLabFile(labId: ID!, fileText: String!, idempotencyKey: String!): JSON
        reviewLabResult(resultId: ID!, interpretation: String!, idempotencyKey: String!): JSON
        communicateLabResult(resultId: ID!, via: String!, idempotencyKey: String!): JSON
        notifyResultsReady(labOrderId: ID!, idempotencyKey: String!): JSON
        orderImaging(patientId: ID!, modality: String!, region: String, reason: String, encounterId: ID, locationId: ID, idempotencyKey: String!): JSON
        recordImagingStudy(imagingOrderId: ID!, studyInstanceUid: String!, images: Int, expectedVersion: Int!, idempotencyKey: String!): JSON
        addImagingReport(imagingOrderId: ID!, author: String!, authorName: String, text: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        communicateImaging(imagingOrderId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        startRecordsVerification(requestId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        verifyRecordsRequest(requestId: ID!, note: String!, authorisationDocumentId: ID, expectedVersion: Int!, idempotencyKey: String!): JSON
        decideRecordsRequest(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        withdrawRecordsRequest(requestId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        releaseRecords(requestId: ID!, documentIds: [ID!]!, recipient: String!, channel: String!, contactPointId: ID, approvalRequestId: ID, expectedVersion: Int!, idempotencyKey: String!): JSON
        draftRuleVersion(label: String!, effectiveFrom: String!, rules: JSON!, commissionRules: JSON, idempotencyKey: String!): JSON
        requestRulePublication(ruleVersionId: ID!, idempotencyKey: String!): JSON
        requestProductionAdjustment(creditId: ID!, amountMinor: String!, reason: String!, idempotencyKey: String!): JSON
        openPayPeriod(startsOn: String!, endsOn: String!, idempotencyKey: String!): JSON
        calculatePayPeriod(periodId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        reopenPayPeriod(periodId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        requestPayPeriodApproval(periodId: ID!, idempotencyKey: String!): JSON
        exportPayPeriod(periodId: ID!, idempotencyKey: String!): JSON
        exportData(kind: String!, idempotencyKey: String!): JSON
        planCampaign(name: String!, purpose: String!, templateId: ID, locationId: ID, idempotencyKey: String!): JSON
        approveCampaign(campaignId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelCampaign(campaignId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        lockPayPeriod(periodId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        verifyReleasePacket(releaseId: ID!): JSON
        suggestCharges(locationId: ID, idempotencyKey: String!): JSON
        clinicInsights: JSON
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
        refreshClinicalClocks(idempotencyKey: String!): JSON
        suppressReminder(reminderId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        addManualReminder(patientId: ID!, typeId: ID!, dueOn: String!, idempotencyKey: String!): JSON
        previewImport(system: String!, entity: String!, locationId: ID!, fileName: String, csv: String, mapping: JSON, source: String, idempotencyKey: String!): JSON
        applyImport(batchId: ID!, idempotencyKey: String!): JSON
        writePrescription(patientId: ID!, locationId: ID!, lines: JSON!, idempotencyKey: String!): JSON
        decideRefill(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        dispenseFill(lineId: ID!, quantity: String!, lotId: ID, csContainerId: ID, refillRequestId: ID, idempotencyKey: String!): JSON
        receiveStockLot(drugId: ID, vaccineId: ID, locationId: ID!, lotNumber: String!, expiresOn: String!, idempotencyKey: String!): JSON
        setLotQuarantine(lotId: ID!, quarantine: Boolean!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        receiveControlled(productId: ID!, locationId: ID!, lotNumber: String!, lotExpiresOn: String!, labelQty: String!, labelUnit: String!, orderFormReference: String, idempotencyKey: String!): JSON
        openControlled(containerId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        wasteControlled(containerId: ID!, qty: String!, reason: String!, witnessId: ID!, idempotencyKey: String!): JSON
        countControlled(locationId: ID!, kind: String!, witnessId: ID!, counts: JSON!, idempotencyKey: String!): JSON
        reportCsLoss(containerId: ID!, kind: String!, qty: String!, description: String!, witnessId: ID!, idempotencyKey: String!): JSON
        advanceDiscrepancy(caseId: ID!, step: String!, reference: String, resolution: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        destroyControlled(containerId: ID!, qty: String, method: String!, form41Reference: String, witnessAId: ID!, witnessBId: ID!, idempotencyKey: String!): JSON
        submitPdmp(reportId: ID!, confirmation: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addStockLocation(locationId: ID!, name: String!, kind: String!, minTempC: String, maxTempC: String, idempotencyKey: String!): JSON
        startFeeDraft(label: String!, idempotencyKey: String!): JSON
        saveFeeItem(versionId: ID!, itemId: ID, code: String!, name: String!, category: String!, priceMinor: String!, taxCategory: String!, unit: String, minimumChargeMinor: String, drugId: ID, vaccineId: ID, orderKind: String, idempotencyKey: String!): JSON
        requestFeePublish(versionId: ID!, effectiveFrom: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        discardFeeDraft(versionId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        startEstimate(patientId: ID!, locationId: ID!, encounterId: ID, title: String!, elective: Boolean, options: JSON!, idempotencyKey: String!): JSON
        presentEstimate(versionId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        reviseEstimate(estimateId: ID!, idempotencyKey: String!): JSON
        declineEstimate(versionId: ID!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        refreshEstimates(idempotencyKey: String!): JSON
        acceptEstimate(versionId: ID!, optionId: ID!, signerId: ID!, method: String!, signatureText: String, witnessId: ID, quoteHash: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordOverageApproval(planId: ID!, newHighMinor: String!, method: String!, approverId: ID, witnessId: ID, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        closePlan(planId: ID!, expectedVersion: Int!, cancel: Boolean, reason: String, idempotencyKey: String!): JSON
        captureVisitCharges(encounterId: ID!, idempotencyKey: String!): JSON
        addFeeCharge(patientId: ID!, encounterId: ID, feeItemId: ID!, qty: String!, idempotencyKey: String!): JSON
        addManualCharge(patientId: ID!, encounterId: ID, description: String!, amountMinor: String!, taxCategory: String!, reason: String!, idempotencyKey: String!): JSON
        reverseCharge(chargeId: ID!, reason: String!, idempotencyKey: String!): JSON
        draftInvoice(clientId: ID!, encounterId: ID, idempotencyKey: String!): JSON
        discountInvoice(invoiceId: ID!, percent: Float!, reason: String!, idempotencyKey: String!): JSON
        postInvoice(invoiceId: ID!, postedOn: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordPayment(clientId: ID!, invoiceId: ID, depositId: ID, method: String!, amountMinor: String!, reference: String, note: String, postedOn: String, allowOverpay: Boolean, payerAuthorizationId: ID, idempotencyKey: String!): JSON
        takeCardPayment(clientId: ID!, invoiceId: ID, depositId: ID, amountMinor: String!, paymentMethodId: String, idempotencyKey: String!): JSON
        checkPaymentStatus(paymentId: ID!, idempotencyKey: String): JSON
        applyDeposit(depositId: ID!, invoiceId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        issueCreditNote(invoiceId: ID!, amountMinor: String!, reason: String!, idempotencyKey: String!): JSON
        requestRefund(paymentId: ID!, invoiceId: ID, amountMinor: String!, reason: String!, idempotencyKey: String!): JSON
        issueApprovedRefund(refundId: ID!, idempotencyKey: String!): JSON
        checkRefundStatus(refundId: ID!, idempotencyKey: String!): JSON
        requestWriteOff(invoiceId: ID!, reason: String!, idempotencyKey: String!): JSON
        closeArPeriod(periodId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        reopenArPeriod(periodId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addInsurancePolicy(patientId: ID!, insurerId: ID!, policyNumber: String!, plan: String, deductibleMinor: String, reimbursementRate: String, effectiveFrom: String, effectiveTo: String, directPayEligible: Boolean, idempotencyKey: String!): JSON
        requestAuthorization(invoiceId: ID!, policyId: ID!, requestedMinor: String!, idempotencyKey: String!): JSON
        recordAuthorizationDecision(authorizationId: ID!, decision: String!, authorisedMinor: String, externalRef: String, validUntil: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        buildClaimPacket(invoiceId: ID!, policyId: ID!, recordsReleaseId: ID, submitter: String!, formFields: JSON, idempotencyKey: String!): JSON
        advanceClaim(claimId: ID!, to: String!, note: String, approvedMinor: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        receiveStock(drugId: ID, vaccineId: ID, stockLocationId: ID!, lotNumber: String!, expiresOn: String!, quantity: String!, unit: String, idempotencyKey: String!): JSON
        adjustStock(itemId: ID!, lotId: ID, stockLocationId: ID!, kind: String!, quantity: String!, reason: String!, idempotencyKey: String!): JSON
        addSupplier(name: String!, accountNumber: String, phone: String, email: String, deaNumber: String, idempotencyKey: String!): JSON
        draftPurchaseOrder(supplierId: ID!, locationId: ID!, lines: JSON!, note: String, idempotencyKey: String!): JSON
        submitPurchaseOrder(orderId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelPurchaseOrder(orderId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        receivePurchaseOrder(orderId: ID!, stockLocationId: ID!, packingSlip: String, lines: JSON!, idempotencyKey: String!): JSON
        setReorderRule(itemId: ID!, locationId: ID!, minQty: String!, targetQty: String!, idempotencyKey: String!): JSON
        countStock(stockLocationId: ID!, counts: JSON!, idempotencyKey: String!): JSON
        openRecall(itemId: ID!, lotNumber: String!, title: String!, source: String, idempotencyKey: String!): JSON
        markRecallExposure(exposureId: ID!, status: String!, note: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        closeRecall(recallId: ID!, resolution: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        logTemperature(stockLocationId: ID!, readingC: String!, idempotencyKey: String!): JSON
        resolveExcursion(excursionId: ID!, resolution: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        issueOrderForm(supplierId: ID!, locationId: ID!, formNumber: String!, kind: String!, issuedOn: String!, lines: JSON!, idempotencyKey: String!): JSON
        receiveOnOrderForm(lineId: ID!, lotNumber: String!, lotExpiresOn: String!, labelQty: String!, labelUnit: String!, idempotencyKey: String!): JSON
        transferControlled(containerId: ID!, qty: String!, toRegistrationId: ID!, witnessId: ID!, idempotencyKey: String!): JSON
        confirmTransfer(transferId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        logCabinetAccess(locationId: ID!, kind: String!, note: String, idempotencyKey: String!): JSON
        generatePdmpFile(locationId: ID!, idempotencyKey: String!): JSON
        printDispenseLabel(dispenseId: ID!, idempotencyKey: String!): JSON
        requestExternalFill(prescriptionId: ID!, pharmacyName: String!, orderReference: String, idempotencyKey: String!): JSON
        decideExternalFill(externalId: ID!, status: String!, note: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        exportWrittenRx(prescriptionId: ID!, idempotencyKey: String!): JSON
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
        refreshClinicalClocks: op(clocks.refreshClinicalClocks),
        suppressReminder: op(vaccines.suppressReminder),
        addManualReminder: op(vaccines.addManualReminder),
        previewImport: op(imports.previewImport),
        applyImport: op(imports.applyImport),
        writePrescription: op(pharmacy.writePrescription),
        decideRefill: op(pharmacy.decideRefill),
        dispenseFill: op(pharmacy.dispenseFill),
        receiveStockLot: op(pharmacy.receiveStockLot),
        setLotQuarantine: op(pharmacy.setLotQuarantine),
        receiveControlled: op(pharmacy.receiveControlled),
        openControlled: op(pharmacy.openControlled),
        wasteControlled: op(pharmacy.wasteControlled),
        countControlled: op(pharmacy.countControlled),
        reportCsLoss: op(pharmacy.reportCsLoss),
        advanceDiscrepancy: op(pharmacy.advanceDiscrepancy),
        destroyControlled: op(pharmacy.destroyControlled),
        submitPdmp: op(pharmacy.submitPdmp),
        addStockLocation: op(inventory.addStockLocation),
        startFeeDraft: op(fees.startFeeDraft),
        saveFeeItem: op(fees.saveFeeItem),
        requestFeePublish: op(fees.requestFeePublish),
        discardFeeDraft: op(fees.discardFeeDraft),
        startEstimate: op(estimates.createEstimate),
        presentEstimate: op(estimates.presentEstimate),
        reviseEstimate: op(estimates.reviseEstimate),
        declineEstimate: op(estimates.declineEstimate),
        refreshEstimates: op(estimates.refreshEstimates),
        acceptEstimate: op(estimates.acceptEstimate),
        recordOverageApproval: op(estimates.recordOverageApproval),
        closePlan: op(estimates.closePlan),
        captureVisitCharges: op(billing.captureVisitCharges),
        addFeeCharge: op(billing.addFeeCharge),
        addManualCharge: op(billing.addManualCharge),
        reverseCharge: op(billing.reverseCharge),
        draftInvoice: op(billing.draftInvoice),
        discountInvoice: op(billing.discountInvoice),
        postInvoice: op(billing.postInvoice),
        recordPayment: op(billing.recordPayment),
        takeCardPayment: op(billing.takeCardPayment),
        checkPaymentStatus: op(billing.checkPaymentStatus),
        applyDeposit: op(billing.applyDeposit),
        issueCreditNote: op(billing.issueCreditNote),
        requestRefund: op(billing.requestRefund),
        issueApprovedRefund: op(billing.issueApprovedRefund),
        checkRefundStatus: op(billing.checkRefundStatus),
        requestWriteOff: op(billing.requestWriteOff),
        closeArPeriod: op(billing.closeArPeriod),
        reopenArPeriod: op(billing.reopenArPeriod),
        addInsurancePolicy: op(insurance.addInsurancePolicy),
        requestAuthorization: op(insurance.requestAuthorization),
        recordAuthorizationDecision: op(insurance.recordAuthorizationDecision),
        buildClaimPacket: op(insurance.buildClaimPacket),
        advanceClaim: op(insurance.advanceClaim),
        receiveStock: op(inventory.receiveStock),
        adjustStock: op(inventory.adjustStock),
        addSupplier: op(inventory.addSupplier),
        draftPurchaseOrder: op(inventory.draftPurchaseOrder),
        submitPurchaseOrder: op(inventory.submitPurchaseOrder),
        cancelPurchaseOrder: op(inventory.cancelPurchaseOrder),
        receivePurchaseOrder: op(inventory.receivePurchaseOrder),
        setReorderRule: op(inventory.setReorderRule),
        countStock: op(inventory.countStock),
        openRecall: op(inventory.openRecall),
        markRecallExposure: op(inventory.markRecallExposure),
        closeRecall: op(inventory.closeRecall),
        logTemperature: op(inventory.logTemperature),
        resolveExcursion: op(inventory.resolveExcursion),
        issueOrderForm: op(register.issueOrderForm),
        receiveOnOrderForm: op(register.receiveOnOrderForm),
        transferControlled: op(register.transferControlled),
        confirmTransfer: op(register.confirmTransfer),
        logCabinetAccess: op(register.logCabinetAccess),
        generatePdmpFile: op(register.generatePdmpFile),
        printDispenseLabel: op(register.printDispenseLabel),
        requestExternalFill: op(register.requestExternalFill),
        decideExternalFill: op(register.decideExternalFill),
        exportWrittenRx: op(register.exportWrittenRx),
        savePlanVersion: op(wellness.savePlanVersion),
        enrolPatient: op(wellness.enrolPatient),
        runPlanBilling: op(wellness.runPlanBilling),
        retryPlanCharge: op(wellness.retryPlanCharge),
        checkPlanCharge: op(wellness.checkPlanCharge),
        replacePlanCard: op(wellness.replacePlanCard),
        cancelEnrollment: op(wellness.cancelEnrollment),
        useEntitlement: op(wellness.useEntitlement),
        returnEntitlement: op(wellness.returnEntitlement),
        saveRunType: op(boarding.saveRunType),
        setRunStatus: op(boarding.setRunStatus),
        reserveBoarding: op(boarding.reserveBoarding),
        confirmBoarding: op(boarding.confirmBoarding),
        cancelBoarding: op(boarding.cancelBoarding),
        checkInBoarding: op(boarding.checkInBoarding),
        moveBoardingRun: op(boarding.moveBoardingRun),
        logBoardingCare: op(boarding.logBoardingCare),
        returnBelonging: op(boarding.returnBelonging),
        checkOutBoarding: op(boarding.checkOutBoarding),
        bookGroom: op(boarding.bookGroom),
        advanceGroom: op(boarding.advanceGroom),
        saveGroomNote: op(boarding.saveGroomNote),
        signEuthanasiaConsent: op(endOfLife.signEuthanasiaConsent),
        revokeEuthanasiaConsent: op(endOfLife.revokeEuthanasiaConsent),
        recordEuthanasia: op(endOfLife.recordEuthanasia),
        advanceAftercare: op(endOfLife.advanceAftercare),
        addMemorialItem: op(endOfLife.addMemorialItem),
        orderLab: op(diagnostics.orderLab),
        collectSpecimen: op(diagnostics.collectSpecimen),
        sendLabOrder: op(diagnostics.sendLabOrder),
        cancelLabOrder: op(diagnostics.cancelLabOrder),
        enterLabResult: op(diagnostics.enterLabResult),
        importLabFile: op(diagnostics.importLabFile),
        reviewLabResult: op(diagnostics.reviewLabResult),
        communicateLabResult: op(diagnostics.communicateLabResult),
        notifyResultsReady: op(diagnostics.notifyResultsReady),
        orderImaging: op(diagnostics.orderImaging),
        recordImagingStudy: op(diagnostics.recordImagingStudy),
        addImagingReport: op(diagnostics.addImagingReport),
        communicateImaging: op(diagnostics.communicateImaging),
        startRecordsVerification: op(recordsRelease.startRecordsVerification),
        verifyRecordsRequest: op(recordsRelease.verifyRecordsRequest),
        decideRecordsRequest: op(recordsRelease.decideRecordsRequest),
        withdrawRecordsRequest: op(recordsRelease.withdrawRecordsRequest),
        releaseRecords: op(recordsRelease.releaseRecords),
        draftRuleVersion: op(production.draftRuleVersion),
        requestRulePublication: op(production.requestRulePublication),
        requestProductionAdjustment: op(production.requestProductionAdjustment),
        openPayPeriod: op(production.openPayPeriod),
        calculatePayPeriod: op(production.calculatePayPeriod),
        reopenPayPeriod: op(production.reopenPayPeriod),
        requestPayPeriodApproval: op(production.requestPayPeriodApproval),
        exportPayPeriod: op(production.exportPayPeriod),
        exportData: op(portability.exportData),
        planCampaign: op(portability.planCampaign),
        approveCampaign: op(portability.approveCampaign),
        cancelCampaign: op(portability.cancelCampaign),
        lockPayPeriod: op(production.lockPayPeriod),
        suggestCharges: op(agentsWider.suggestCharges),
        clinicInsights: (root: unknown, args: any, context: any) => agentsWider.clinicInsights(root, args, context),
        verifyReleasePacket: (root: unknown, args: any, context: any) => recordsRelease.verifyReleasePacket(root, args, context),
      },
    },
  })))
}
