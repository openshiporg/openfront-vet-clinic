/**
 * MCP OAuth on the Keystone side: an `mcp_at_` bearer token becomes the session
 * of the user who approved it, exactly like that user's cookie.
 *
 * The wrapped strategy returns `{ itemId, listKey, mcp }`; createAuth's own
 * wrapper then loads `session.data` from `sessionData` the same way it does for
 * a cookie, so roles, filters and field access are unchanged. `mcp` only lets
 * the GraphQL guard narrow what the token may do.
 *
 * Plain module: safe to import from keystone.ts (no @/ imports).
 */
import { agentUserId } from './agentSession'
import { bearerToken, digestToken, isMcpAccessToken, storedScopes, type McpScope } from './core'

export type McpSessionMarker = {
  clientId: string
  scopes: McpScope[]
  tokenId: string
  /** Set when the app is bound to an AI agent: the session is the agent's, not the approver's. */
  agentId?: string
}

type Strategy = { get: (args: { context: any }) => Promise<any> }

/** The session for a valid MCP access token, or undefined (never a fallback). */
export async function resolveMcpAccessToken(context: any, token: string, listKey = 'User') {
  try {
    const sudo = context.sudo()
    const record = await sudo.db.OAuthToken.findOne({ where: { token: digestToken(token) } })
    if (
      !record ||
      record.tokenType !== 'access_token' ||
      record.isRevoked !== 'false' ||
      !record.userId ||
      !record.expiresAt ||
      new Date(record.expiresAt).getTime() <= Date.now()
    ) {
      return undefined
    }
    const app = await sudo.db.OAuthApp.findOne({ where: { clientId: record.clientId } })
    if (!app || app.status !== 'active') return undefined

    const mcp: McpSessionMarker = {
      clientId: record.clientId,
      scopes: storedScopes(record.scopes),
      tokenId: String(record.id),
    }
    // Who may this token act as?
    //  - issued to an agent (record.agentId): only as that agent, and only while that agent is still bound
    //    to this app and active. Unbinding, rebinding to another agent, pausing or a kill switch end it.
    //    It never falls back to the person who approved the connection.
    //  - issued to a person's own connection: as that person, unless the app has since been bound to an
    //    agent (then it is refused; binding also revokes the tokens that existed).
    const bound = await sudo.db.AgentIdentity.findMany({ where: { oauthApp: { id: { equals: app.id } } }, take: 1 })
    const agent = bound[0]
    const issuedTo = String(record.agentId ?? '')
    if (issuedTo || agent) {
      if (!agent || !issuedTo || String(agent.id) !== issuedTo) return undefined
      if (agent.status !== 'active' || agent.killSwitch) return undefined
      mcp.agentId = String(agent.id)
      return { itemId: agentUserId(String(agent.id)), listKey, mcp, agent: { id: String(agent.id) } }
    }
    return { itemId: String(record.userId), listKey, mcp }
  } catch {
    return undefined
  }
}

/**
 * Wrap a repo's existing session strategy. MCP tokens are recognised by prefix
 * and resolved here; every other request (cookies, Openship OAuth, API keys,
 * customer tokens) goes to the wrapped strategy unchanged.
 */
export function withMcpBearerSessions<S extends Strategy>(strategy: S, listKey = 'User'): S {
  return {
    ...strategy,
    async get({ context }: { context: any }) {
      const token = bearerToken(context?.req?.headers?.authorization)
      if (isMcpAccessToken(token)) return resolveMcpAccessToken(context, token, listKey)
      return strategy.get({ context })
    },
  }
}

export function mcpSessionMarker(session: unknown): McpSessionMarker | null {
  const marker = (session as { mcp?: McpSessionMarker } | null | undefined)?.mcp
  return marker && typeof marker.clientId === 'string' && Array.isArray(marker.scopes) ? marker : null
}
