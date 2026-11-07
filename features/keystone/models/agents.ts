import { list } from '@keystone-6/core'
import { json, relationship, timestamp } from '@keystone-6/core/fields'
import { fixedChoice, lifecycle, readOnly, systemText, versionField } from './domainFields'
import { governed } from './listAccess'
import { trackingFields } from './trackingFields'

/* Agents (SCHEMA §18). Every write goes through a server command; the lists are read-only here.
   Scopes map to the MCP tool groups (INTEGRATIONS §10). There is deliberately no scope that reaches
   VCPR, prescribing, record signing, the controlled-substance register, euthanasia, discounts,
   refunds, write-offs, publishing, merges or card data (I-G4). */

export const AGENT_SCOPES = [
  'reception.read', 'reception.book', 'reception.register', 'triage.run', 'pharmacy.intake', 'records.request', 'records.send',
  'results.notify', 'boarding.reserve', 'plan.enroll', 'payment.link', 'scribe.draft', 'charges.suggest', 'insights.read', 'tasks.create',
] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]

export const PROPOSAL_KINDS = [
  'client.register', 'patient.register', 'appointment.request', 'refill.request', 'records.release', 'charge.add', 'note.draft', 'plan.enroll', 'boarding.reserve', 'reminder.send',
] as const

export const AgentToolGrant = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'scope', listView: { initialColumns: ['agent', 'scope', 'status', 'createdAt'] } },
  fields: {
    agent: relationship({ ref: 'AgentIdentity.grants', ...readOnly }),
    scope: fixedChoice(AGENT_SCOPES),
    constraints: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Limits, e.g. {"locations":["…"],"maxBookingsPerCall":3}.' } }),
    status: lifecycle(['requested', 'active', 'revoked']),
    approval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    revokedAt: timestamp({ ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const AgentRun = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'promptHash', listView: { initialColumns: ['agent', 'status', 'startedAt', 'endedAt'] } },
  fields: {
    agent: relationship({ ref: 'AgentIdentity.runs', ...readOnly }),
    startedAt: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
    endedAt: timestamp({ ...readOnly }),
    status: lifecycle(['started', 'completed', 'failed', 'aborted']),
    promptHash: systemText(),
    toolCalls: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Tool names and argument hashes, never raw arguments.' } }),
    costMeta: json({ ...readOnly }),
    callRecordId: systemText({ indexed: true }),
    proposals: relationship({ ref: 'Proposal.agentRun', many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields,
  },
})

export const Proposal = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'kind', listView: { initialColumns: ['kind', 'status', 'proposedByAgent', 'proposedByUser', 'createdAt'] } },
  fields: {
    kind: fixedChoice(PROPOSAL_KINDS),
    payload: json({ ...readOnly }),
    payloadHash: systemText({ required: true }),
    status: lifecycle(['proposed', 'validated', 'approved', 'rejected', 'expired', 'applied']),
    agentRun: relationship({ ref: 'AgentRun.proposals', ...readOnly }),
    proposedByAgent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    proposedByUser: relationship({ ref: 'User', ...readOnly }),
    targetList: systemText(),
    targetId: systemText({ indexed: true }),
    approval: relationship({ ref: 'ApprovalRequest', ...readOnly }),
    validation: json({ ...readOnly, ui: { ...readOnly.ui, description: 'Check results recorded when the proposal was validated.' } }),
    version: versionField(),
    ...trackingFields,
  },
})

/** One row per tool call (allowed or refused), linked to its run (SCHEMA §18; I-G4 evidence). */
export const AgentAction = list({
  access: governed('canAccessDashboard'),
  ui: { labelField: 'tool', listView: { initialColumns: ['tool', 'outcome', 'agent', 'at'] } },
  fields: {
    agent: relationship({ ref: 'AgentIdentity', ...readOnly }),
    run: relationship({ ref: 'AgentRun', ...readOnly }),
    tool: systemText({ indexed: true, required: true }),
    argsHash: systemText(),
    outcome: fixedChoice(['ok', 'scope_denied', 'never_allowed', 'guard_failed', 'error', 'killed']),
    errorCode: systemText(),
    auditEventId: systemText(),
    at: timestamp({ defaultValue: { kind: 'now' }, ...readOnly }),
  },
})
