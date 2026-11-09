/**
 * An MCP token issued to an OAuth app that is bound to an AI agent acts as that agent's own service
 * user (role "AI Agent": no permissions), never as the person who approved the connection. Plain
 * module: safe to import from session.ts.
 */
export const AGENT_ROLE_ID = 'seed_role_ai_agent'
export const agentUserId = (agentId: string) => `agent_user_${agentId}`
