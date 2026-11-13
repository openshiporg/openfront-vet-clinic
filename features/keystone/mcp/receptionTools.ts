import { registerDomainTools, type DomainTool } from './registry'

/**
 * The AI receptionist's tools (INTEGRATIONS §7, §10). Each maps to one GraphQL operation that runs
 * the same command a CSR runs; the server checks the agent's scope grant, kill switch and the
 * practice's aiVoice flag on every call, and writes an AgentAction row. The call flow is enforced by
 * the commands, not by the prompt: no booking before the disclosure, no account detail before the
 * caller is verified, no booking for a sick pet without an urgency screen, and an emergency is never
 * booked.
 */

const idempotencyKey = { type: 'string', minLength: 8, maxLength: 200, pattern: '^[A-Za-z0-9._:-]+$', description: 'Unique per intent. Reusing it returns the first result instead of acting twice.' }
const id = (description: string) => ({ type: 'string', minLength: 1, maxLength: 64, description })
const obj = (description: string) => ({ type: 'object', description })
const str = (description: string, maxLength = 500) => ({ type: 'string', maxLength, description })

const shape = (properties: Record<string, object>, required: string[]) => ({ type: 'object' as const, properties, required, additionalProperties: false })

export const RECEPTION_TOOLS: DomainTool[] = [
  {
    name: 'call_start',
    description: 'Open a call record when the AI answers an inbound call. Returns the call id used by every other reception tool. Outbound AI calls are refused.',
    inputSchema: shape({ input: obj('{ direction: "inbound", from, to, locationId, answeredBy: "ai", providerCallId?, adapterKey? }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation CallStart($input: JSON!, $idempotencyKey: String!) { startCall(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'startCall', writes: true,
  },
  {
    name: 'call_disclosure_played',
    description: 'Record that the AI disclosure ("you are speaking with an automated assistant; this call may be recorded") was played and the caller\'s answer to recording. Must be the first thing on every AI call.',
    inputSchema: shape({ callRecordId: id('Call id'), recordingConsent: { type: 'string', enum: ['accepted', 'declined'] }, idempotencyKey }, ['callRecordId', 'recordingConsent', 'idempotencyKey']),
    document: 'mutation CallDisclosure($callRecordId: ID!, $recordingConsent: String!, $idempotencyKey: String!) { recordCallDisclosure(callRecordId: $callRecordId, recordingConsent: $recordingConsent, idempotencyKey: $idempotencyKey) }',
    field: 'recordCallDisclosure', writes: true,
  },
  {
    name: 'triage_questions',
    description: 'The published urgency-screen questions. Ask them, word for word, before anything else when a pet is unwell.',
    inputSchema: shape({}, []),
    document: 'query TriageQuestions { triageQuestions }',
    field: 'triageQuestions', writes: false,
  },
  {
    name: 'triage_run',
    description: 'Score the urgency screen. Returns the level and the exact script to read. emergency_now means transfer the call to staff now (or read the ER referral); it can never be booked.',
    inputSchema: shape({ input: obj('{ complaint, answers: { [questionId]: boolean }, locationId, callRecordId, patientId?, clientId? }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation TriageRun($input: JSON!, $idempotencyKey: String!) { runTriage(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'runTriage', writes: true,
  },
  {
    name: 'caller_verify',
    description: 'Verify an existing client by a pet\'s name and date of birth. Until this returns verified=true, give general information only.',
    inputSchema: shape({ callRecordId: id('Call id'), method: { type: 'string', enum: ['pet_name_dob'] }, petName: str('Pet name', 80), petDateOfBirth: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, idempotencyKey }, ['callRecordId', 'method', 'petName', 'petDateOfBirth', 'idempotencyKey']),
    document: 'mutation CallerVerify($callRecordId: ID!, $method: String!, $petName: String!, $petDateOfBirth: String!, $idempotencyKey: String!) { verifyCaller(callRecordId: $callRecordId, method: $method, petName: $petName, petDateOfBirth: $petDateOfBirth, idempotencyKey: $idempotencyKey) }',
    field: 'verifyCaller', writes: true,
  },
  {
    name: 'reception_context',
    description: 'The verified caller\'s pets and upcoming appointments (no clinical detail).',
    inputSchema: shape({ callRecordId: id('Call id') }, ['callRecordId']),
    document: 'query ReceptionContext($callRecordId: ID) { receptionContext(callRecordId: $callRecordId) }',
    field: 'receptionContext', writes: false, readsClinical: true,
  },
  {
    name: 'reception_find_slots',
    description: 'Open slots for an appointment type at a location. Each slot has a slotToken valid for five minutes; offer two or three and book the one the caller picks.',
    inputSchema: shape({ locationId: id('Location id'), appointmentTypeId: id('Appointment type id'), from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, days: { type: 'integer' }, limit: { type: 'integer' } }, ['locationId', 'appointmentTypeId']),
    document: 'query FindSlots($locationId: ID!, $appointmentTypeId: ID!, $from: String, $days: Int, $limit: Int) { searchAvailability(locationId: $locationId, appointmentTypeId: $appointmentTypeId, from: $from, days: $days, limit: $limit) }',
    field: 'searchAvailability', writes: false,
  },
  {
    name: 'reception_book',
    description: 'Book the slot the caller chose. Needs the disclosure played, a verified caller for an existing client, and a triage id for a sick visit. Surgery and dental become requests for staff to accept.',
    inputSchema: shape({ input: obj('{ slotToken, clientId, patientIds: [id], reason, callRecordId, triageId? }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation ReceptionBook($input: JSON!, $idempotencyKey: String!) { bookAppointment(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'bookAppointment', writes: true,
  },
  {
    name: 'reception_reschedule',
    description: 'Move a verified caller\'s appointment to a new slot token (same appointment type).',
    inputSchema: shape({ appointmentId: id('Appointment id'), slotToken: str('Slot token', 2000), expectedVersion: { type: 'integer' }, callRecordId: id('Call id'), idempotencyKey }, ['appointmentId', 'slotToken', 'expectedVersion', 'callRecordId', 'idempotencyKey']),
    document: 'mutation ReceptionReschedule($appointmentId: ID!, $slotToken: String!, $expectedVersion: Int!, $callRecordId: ID, $idempotencyKey: String!) { rescheduleAppointment(appointmentId: $appointmentId, slotToken: $slotToken, expectedVersion: $expectedVersion, callRecordId: $callRecordId, idempotencyKey: $idempotencyKey) }',
    field: 'rescheduleAppointment', writes: true,
  },
  {
    name: 'reception_cancel',
    description: 'Cancel a verified caller\'s appointment with their reason.',
    inputSchema: shape({ appointmentId: id('Appointment id'), reason: str('Reason', 300), expectedVersion: { type: 'integer' }, callRecordId: id('Call id'), idempotencyKey }, ['appointmentId', 'reason', 'expectedVersion', 'callRecordId', 'idempotencyKey']),
    document: 'mutation ReceptionCancel($appointmentId: ID!, $reason: String!, $expectedVersion: Int!, $callRecordId: ID, $idempotencyKey: String!) { cancelAppointment(appointmentId: $appointmentId, reason: $reason, expectedVersion: $expectedVersion, callRecordId: $callRecordId, idempotencyKey: $idempotencyKey) }',
    field: 'cancelAppointment', writes: true,
  },
  {
    name: 'reception_register_client',
    description: 'Register a new caller and their pet as pending. Staff confirm it; duplicates are flagged, never merged by the agent.',
    inputSchema: shape({ input: obj('{ firstName, lastName, phone, email?, locationId, pet: { name, speciesCode, breedName?, sex?, dateOfBirth? } }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation ReceptionRegister($input: JSON!, $idempotencyKey: String!) { registerPendingClient(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'registerPendingClient', writes: true,
  },
  {
    name: 'pharmacy_refill_intake',
    description: 'Take a refill request from a verified caller for the DVM to review. Never say it is approved; say the team will review it.',
    inputSchema: shape({ input: obj('{ patientId, productText, pharmacyNote?, callRecordId }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation RefillIntake($input: JSON!, $idempotencyKey: String!) { requestRefill(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'requestRefill', writes: true,
  },
  {
    name: 'records_request',
    description: 'Take a records request from the verified client of record. Requests from anyone else go to staff.',
    inputSchema: shape({ input: obj('{ patientId, requesterKind: "client_person", basis: "client_of_record", scope?, locationId, callRecordId }'), idempotencyKey }, ['input', 'idempotencyKey']),
    document: 'mutation RecordsRequest($input: JSON!, $idempotencyKey: String!) { requestRecords(input: $input, idempotencyKey: $idempotencyKey) }',
    field: 'requestRecords', writes: true,
  },
  {
    name: 'knowledge_lookup',
    description: 'Answer general questions (hours, directions, payment options, what to bring) from the clinic\'s public knowledge base.',
    inputSchema: shape({ question: str('The caller\'s question'), locationId: id('Location id') }, ['question']),
    document: 'query Knowledge($question: String!, $locationId: ID) { lookupKnowledge(question: $question, locationId: $locationId) }',
    field: 'lookupKnowledge', writes: false,
  },
  {
    name: 'call_transcript_append',
    description: 'Append transcript turns to the call record (stored as received).',
    inputSchema: shape({ callRecordId: id('Call id'), turns: { type: 'object', description: '[{ speaker: caller|agent, text }]' } as object, idempotencyKey }, ['callRecordId', 'turns', 'idempotencyKey']),
    document: 'mutation Transcript($callRecordId: ID!, $turns: JSON!, $idempotencyKey: String!) { appendCallTranscript(callRecordId: $callRecordId, turns: $turns, idempotencyKey: $idempotencyKey) }',
    field: 'appendCallTranscript', writes: true,
  },
  {
    name: 'call_end',
    description: 'End the call with a disposition and a short summary for staff. Use callback_task when a person needs to call back.',
    inputSchema: shape({ callRecordId: id('Call id'), disposition: { type: 'string', enum: ['booked', 'rescheduled', 'cancelled', 'refill_request', 'records_request', 'info', 'transferred', 'urgent_transfer', 'er_referred', 'abandoned', 'callback_task'] }, summary: str('Summary for staff', 2000), transferTo: str('Transfer target', 40), idempotencyKey }, ['callRecordId', 'disposition', 'idempotencyKey']),
    document: 'mutation CallEnd($callRecordId: ID!, $disposition: String!, $summary: String, $transferTo: String, $idempotencyKey: String!) { endCall(callRecordId: $callRecordId, disposition: $disposition, summary: $summary, transferTo: $transferTo, idempotencyKey: $idempotencyKey) }',
    field: 'endCall', writes: true,
  },
]

registerDomainTools(RECEPTION_TOOLS)

/**
 * Wider agent set (Phase 6). Each runs the same command a person would, under a scope grant. None of them signs, sends a result,
 * prescribes or moves money: the lab notifier leaves a call-back task, the records tool sends only to the client of record at a verified
 * contact (anything else becomes a proposal), charge suggestions are proposals, and insights are counts.
 */
export const WIDER_TOOLS: DomainTool[] = [
  {
    name: 'results_notify_ready',
    description: 'Tell staff a lab order has results waiting so a call-back task is left for the client ("results are ready, the doctor will call"). It never sees or carries a result value.',
    inputSchema: shape({ labOrderId: id('Lab order id'), idempotencyKey }, ['labOrderId', 'idempotencyKey']),
    document: 'mutation ResultsNotify($labOrderId: ID!, $idempotencyKey: String!) { notifyResultsReady(labOrderId: $labOrderId, idempotencyKey: $idempotencyKey) }',
    field: 'notifyResultsReady', writes: true,
  },
  {
    name: 'records_send',
    description: 'Send an approved records request to the client of record at a contact the clinic has verified. Any other recipient becomes a proposal for staff.',
    inputSchema: shape({ requestId: id('Records request id'), documentIds: { type: 'array', items: { type: 'string', maxLength: 64 }, minItems: 1, maxItems: 200 } as object, recipient: str('Recipient name', 200), channel: { type: 'string', enum: ['email', 'portal', 'fax', 'mail', 'in_person'] }, contactPointId: id('Verified contact point id'), expectedVersion: { type: 'integer', minimum: 0 } as object, idempotencyKey }, ['requestId', 'documentIds', 'recipient', 'channel', 'expectedVersion', 'idempotencyKey']),
    document: 'mutation RecordsSend($requestId: ID!, $documentIds: [ID!]!, $recipient: String!, $channel: String!, $contactPointId: ID, $expectedVersion: Int!, $idempotencyKey: String!) { releaseRecords(requestId: $requestId, documentIds: $documentIds, recipient: $recipient, channel: $channel, contactPointId: $contactPointId, expectedVersion: $expectedVersion, idempotencyKey: $idempotencyKey) }',
    field: 'releaseRecords', writes: true,
  },
  {
    name: 'charges_suggest',
    description: 'Look for closed visits with no charges and leave a proposal for each. It adds no charge.',
    inputSchema: shape({ locationId: id('Location id'), idempotencyKey }, ['idempotencyKey']),
    document: 'mutation ChargesSuggest($locationId: ID, $idempotencyKey: String!) { suggestCharges(locationId: $locationId, idempotencyKey: $idempotencyKey) }',
    field: 'suggestCharges', writes: true,
  },
  {
    name: 'scribe_draft',
    description: 'Turn the transcript of a visit whose client consent a person has already recorded into a draft for the doctor. It writes nothing to the record: the doctor accepts or rejects each block, and signing is theirs.',
    inputSchema: shape({ sessionId: id('Scribe session id'), pastedTranscript: str('Transcript text', 100000), idempotencyKey }, ['sessionId', 'idempotencyKey']),
    document: 'mutation ScribeDraft($sessionId: ID!, $pastedTranscript: String, $idempotencyKey: String!) { draftScribeSession(sessionId: $sessionId, pastedTranscript: $pastedTranscript, idempotencyKey: $idempotencyKey) }',
    field: 'draftScribeSession', writes: true,
  },
  {
    name: 'insights_read',
    description: 'Counts of what is late right now: result reviews, records requests, unsigned records. No names or values.',
    inputSchema: shape({}, []),
    document: 'mutation InsightsRead { clinicInsights }',
    field: 'clinicInsights', writes: false,
  },
]

registerDomainTools(WIDER_TOOLS)
