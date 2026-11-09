import { keyedPayloadHash } from '../lib/canonical'
import { actorAgentId, requirePermission, type Actor } from '../lib/actor'
import { DomainError, Codes, isDomainError } from '../lib/errors'
import type { Permission } from '../access'
import { actorFor } from './actorFor'

/**
 * The one entry point for Phase 1 commands that people and agents share. A person needs one of the
 * permissions; an agent needs the scope (an active AgentToolGrant), its kill switch off, the aiVoice
 * flag on for voice receptionist tools, and every call (allowed or refused) writes an AgentAction
 * (SCHEMA §18, I-G4 evidence). Arguments are logged as a hash, never in the clear.
 */

type Ctx = { session: unknown; prisma: any }

export type Gate = { permissions: Permission[]; scope?: string; tool: string; agentOnly?: boolean; humanOnly?: boolean }

const argsHash = (args: unknown) => keyedPayloadHash(args ?? {}, 'agent-action-args')

async function logAgentAction(prisma: any, actor: Actor, tool: string, args: unknown, outcome: string, errorCode: string | null) {
  const agentId = actorAgentId(actor)
  if (!agentId) return
  await prisma.agentAction.create({ data: { agentId, tool, argsHash: argsHash(args), outcome, errorCode: errorCode ?? '' } })
}

const outcomeOf = (error: unknown) => {
  const code = isDomainError(error) ? error.code : 'ERROR'
  if (code === Codes.SCOPE_DENIED) return 'scope_denied'
  if (code === Codes.NEVER_ALLOWED_FOR_AGENTS) return 'never_allowed'
  if (code === Codes.FEATURE_DISABLED && (error as DomainError).details?.reason === 'kill_switch') return 'killed'
  if (isDomainError(error)) return 'guard_failed'
  return 'error'
}

/** Resolve the actor, check the gate, run, and log the agent action. */
export async function gated<T>(context: Ctx, gate: Gate, args: unknown, run: (actor: Actor) => Promise<T>): Promise<T> {
  const actor = await actorFor(context as never)
  try {
    if (actor.kind === 'agent') {
      if (gate.humanOnly) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${gate.tool} is a human action.`)
      const agent = await context.prisma.agentIdentity.findUnique({ where: { id: actor.agentId }, select: { killSwitch: true, status: true, kind: true } })
      if (!agent || agent.status !== 'active') throw new DomainError(Codes.NOT_AUTHORIZED, 'The agent is not active.')
      if (agent.killSwitch) throw new DomainError(Codes.FEATURE_DISABLED, 'The agent has been switched off.', { reason: 'kill_switch' })
      if (!gate.scope || !actor.scopes.has(gate.scope)) throw new DomainError(Codes.SCOPE_DENIED, `The agent has no active ${gate.scope ?? gate.tool} grant.`)
      if (agent.kind === 'voice_receptionist') {
        const practice = await context.prisma.practiceSettings.findUnique({ where: { id: 1 }, select: { features: true } })
        if (!(practice?.features as Record<string, boolean> | null)?.aiVoice) throw new DomainError(Codes.FEATURE_DISABLED, 'The AI receptionist is turned off for this practice.')
      }
    } else {
      if (gate.agentOnly) throw new DomainError(Codes.NOT_AUTHORIZED, `${gate.tool} is for the AI receptionist.`)
      requirePermission(actor, ...gate.permissions)
    }
    const value = await run(actor)
    await logAgentAction(context.prisma, actor, gate.tool, args, 'ok', null).catch(() => undefined)
    return value
  } catch (error) {
    await logAgentAction(context.prisma, actor, gate.tool, args, outcomeOf(error), isDomainError(error) ? error.code : 'ERROR').catch(() => undefined)
    throw error
  }
}
