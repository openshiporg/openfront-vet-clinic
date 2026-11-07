import { actorFromSession, type Actor } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { mcpSessionMarker } from '../mcp-oauth/session'

/**
 * Who a GraphQL call acts as. A cookie or a person's own MCP token acts as that person. An MCP token
 * issued to an OAuth app bound to an AgentIdentity acts as the agent, with only its active tool
 * grants (INTEGRATIONS §6): agents never carry their owner's permissions and can never approve.
 */
export async function actorFor(context: { session: unknown; prisma: any }): Promise<Actor> {
  const person = actorFromSession(context.session as never)
  const marker = mcpSessionMarker(context.session)
  if (!marker) return person
  const agent = await context.prisma.agentIdentity.findFirst({
    where: { oauthApp: { clientId: { equals: marker.clientId } } },
    select: { id: true, name: true, status: true, ownerId: true, grants: { where: { status: 'active' }, select: { scope: true } } },
  })
  if (!agent) return person
  if (agent.status !== 'active') throw new DomainError(Codes.NOT_AUTHORIZED, `The agent ${agent.name} is ${agent.status}.`)
  return { kind: 'agent', agentId: agent.id, ownerUserId: agent.ownerId, name: agent.name, scopes: new Set(agent.grants.map((g: { scope: string }) => g.scope)) }
}
