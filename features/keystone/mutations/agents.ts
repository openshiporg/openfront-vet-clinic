import { command } from '../lib/command'
import { DomainError, Codes } from '../lib/errors'
import { actorUserId } from '../lib/actor'
import { gated } from './agentGuard'

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
