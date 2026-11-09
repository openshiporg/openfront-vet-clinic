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
  // A session that carries an agent marker is that agent or it is nothing: never the approving person.
  // An app that is bound to an agent is the agent even if the marker is missing (defence in depth;
  // session.ts already refuses a person's token on a bound app).
  const agent = await context.prisma.agentIdentity.findFirst({
    where: { ...(marker.agentId ? { id: marker.agentId } : {}), oauthApp: { clientId: { equals: marker.clientId } } },
    select: { id: true, name: true, status: true, killSwitch: true, ownerId: true, grants: { where: { status: 'active' }, select: { scope: true } } },
  })
  if (!agent) {
    if (marker.agentId) throw new DomainError(Codes.NOT_AUTHORIZED, 'This connection is no longer linked to an agent. Reconnect the app.')
    return person
  }
  if (agent.status !== 'active') throw new DomainError(Codes.NOT_AUTHORIZED, `The agent ${agent.name} is ${agent.status}.`)
  return { kind: 'agent', agentId: agent.id, ownerUserId: agent.ownerId, name: agent.name, scopes: new Set(agent.grants.map((g: { scope: string }) => g.scope)) }
}
