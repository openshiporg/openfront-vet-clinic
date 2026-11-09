import { command } from '../lib/command'
import { DomainError, Codes } from '../lib/errors'
import { actorUserId } from '../lib/actor'
import { gated } from './agentGuard'
import { auditCreate } from '../lib/cas'
import { AGENT_ROLE_ID, agentUserId } from '../mcp-oauth/agentSession'

type Ctx = { session: unknown; prisma: any }

/**
 * The kill switch (I-G4). Switching an agent off is immediate and needs no second person: stopping
 * an agent must never wait. Switching it back on needs a reason and is audited with who did it.
 * Agents can't reach this (human-only); it's also on the NEVER_FOR_AGENTS list via canManageAgents.
 */
export async function setAgentKillSwitch(_root: unknown, args: { agentId: string; killSwitch: boolean; reason?: string | null; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageAgents'], tool: 'agent.kill_switch', humanOnly: true }, args, async actor => {
    const reason = String(args.reason ?? '').trim()
    if (!args.killSwitch && reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, 'Say why the agent can be switched back on.', { field: 'reason' })
    const result = await command(context.prisma, { name: 'agent.kill_switch', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const agent = await uow.tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, killSwitch: true, version: true, name: true } })
      if (!agent) throw new DomainError(Codes.NOT_FOUND, 'Agent not found.')
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.', { currentVersion: agent.version })
      if (agent.killSwitch === args.killSwitch) return { id: agent.id, killSwitch: agent.killSwitch, status: args.killSwitch ? 'killed' : 'active' }
      const updated = await uow.tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { killSwitch: args.killSwitch, version: { increment: 1 } } })
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.')
      uow.audit({
        eventType: args.killSwitch ? 'agent.killed' : 'agent.revived', entityType: 'AgentIdentity', entityId: agent.id, actorUserId: actorUserId(actor),
        actorAgentId: null, approverId: null, before: { killSwitch: agent.killSwitch }, after: { killSwitch: args.killSwitch }, reason: reason || null, metadata: {},
      })
      return { id: agent.id, killSwitch: args.killSwitch, status: args.killSwitch ? 'killed' : 'active' }
    })
    return result.value
  })
}

// A bcrypt hash of 32 discarded random bytes: an agent's service user can never sign in with a password.
const UNUSABLE_PASSWORD_HASH = '$2a$10$3dITCbIvf5zFA.1U8KZDhOHC3EEexi3KYy5ysZK1cRF6LHMm0H.ya'

/** Revoke every live token (access, refresh, unused code) of an OAuth app. */
async function revokeAppTokens(tx: any, appId: string): Promise<number> {
  const app = await tx.oAuthApp.findUnique({ where: { id: appId }, select: { clientId: true } })
  if (!app) return 0
  const result = await tx.oAuthToken.updateMany({ where: { clientId: app.clientId, isRevoked: 'false' }, data: { isRevoked: 'true' } })
  return result.count
}

/** The agent's own service user, on the no-permission "AI Agent" role. Its tokens act as this user, never the approver. */
export async function ensureAgentUser(tx: any, agent: { id: string; name: string }) {
  const id = agentUserId(agent.id)
  const existing = await tx.user.findUnique({ where: { id }, select: { id: true } })
  if (existing) await tx.user.update({ where: { id }, data: { roleId: AGENT_ROLE_ID } })
  else await tx.user.create({ data: { id, name: `${agent.name} (agent)`, email: `agent-${agent.id}@agents.invalid`, password: UNUSABLE_PASSWORD_HASH, kind: 'staff', roleId: AGENT_ROLE_ID, title: 'AI agent', onboardingStatus: 'dismissed' } })
  return id
}

/**
 * Bind an agent to an OAuth app (INTEGRATIONS §6). Tokens issued to the app from now on act as the agent:
 * its own no-permission role plus its approved tool grants. Every token the app held is revoked, because
 * those were issued to someone else (or to nobody).
 */
export async function bindAgentApp(_root: unknown, args: { agentId: string; oauthAppId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageAgents'], tool: 'agent.bind_app', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'agent.bind_app', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const { tx } = uow
      const agent = await tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, name: true, version: true, oauthAppId: true } })
      if (!agent) throw new DomainError(Codes.NOT_FOUND, 'Agent not found.')
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.', { currentVersion: agent.version })
      const app = await tx.oAuthApp.findUnique({ where: { id: args.oauthAppId }, select: { id: true, name: true } })
      if (!app) throw new DomainError(Codes.NOT_FOUND, 'App not found.')
      const taken = await tx.agentIdentity.findFirst({ where: { oauthAppId: app.id, id: { not: agent.id } }, select: { name: true } })
      if (taken) throw new DomainError(Codes.GUARD_FAILED, `${app.name} is already connected to ${taken.name}.`, { reason: 'app_already_bound' })
      await ensureAgentUser(tx, agent)
      const updated = await tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { oauthAppId: app.id, version: { increment: 1 } } })
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.')
      let revoked = await revokeAppTokens(tx, app.id)
      if (agent.oauthAppId && agent.oauthAppId !== app.id) revoked += await revokeAppTokens(tx, agent.oauthAppId)
      auditCreate(uow, actor, 'AgentIdentity', agent.id, 'agent.app_bound', { revokedTokens: revoked, oauthAppId: app.id, previousAppId: agent.oauthAppId, role: AGENT_ROLE_ID, boundBy: actorUserId(actor) })
      return { agentId: agent.id, oauthAppId: app.id, revokedTokens: revoked, version: agent.version + 1 }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Disconnect an agent from its app. Every token the app holds is revoked in the same transaction. */
export async function unbindAgentApp(_root: unknown, args: { agentId: string; expectedVersion: number; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canManageAgents'], tool: 'agent.unbind_app', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'agent.unbind_app', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const { tx } = uow
      const agent = await tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, version: true, oauthAppId: true } })
      if (!agent) throw new DomainError(Codes.NOT_FOUND, 'Agent not found.')
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.', { currentVersion: agent.version })
      const updated = await tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { oauthAppId: null, version: { increment: 1 } } })
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, 'The agent changed since you loaded it. Reload and try again.')
      const revoked = agent.oauthAppId ? await revokeAppTokens(tx, agent.oauthAppId) : 0
      auditCreate(uow, actor, 'AgentIdentity', agent.id, 'agent.app_unbound', { revokedTokens: revoked, previousAppId: agent.oauthAppId })
      return { agentId: agent.id, revokedTokens: revoked, version: agent.version + 1 }
    })
    return { replay: result.replay, ...result.value }
  })
}
