import { isSignedIn, permissionNames, type Permission, type Session } from '../access'
import { DomainError, Codes } from './errors'

/**
 * Who is acting. A user acts with their role's permissions. An agent acts only within its active
 * tool grants and can never approve anything (maker-checker, D§8).
 */
export type Actor =
  | { kind: 'user'; userId: string; name?: string; permissions: ReadonlySet<Permission> }
  | { kind: 'agent'; agentId: string; ownerUserId: string | null; name?: string; scopes: ReadonlySet<string> }
  | { kind: 'system'; name: string }

export function actorFromSession(session: Session | null | undefined): Actor {
  if (!session || !isSignedIn({ session })) throw new DomainError(Codes.NOT_AUTHORIZED, 'Sign in to continue.')
  const role = session.data.role
  const granted = new Set<Permission>(role ? permissionNames.filter(name => role[name] === true) : [])
  return { kind: 'user', userId: session.itemId, name: session.data.name, permissions: granted }
}

export const systemActor = (name: string): Actor => ({ kind: 'system', name })

export function can(actor: Actor, permission: Permission) {
  return actor.kind === 'user' && actor.permissions.has(permission)
}

export function requirePermission(actor: Actor, ...anyOf: Permission[]) {
  if (actor.kind === 'system') return
  if (actor.kind === 'agent') throw new DomainError(Codes.NOT_AUTHORIZED, 'Agents act only through their tool grants.')
  if (!anyOf.some(permission => actor.permissions.has(permission))) {
    throw new DomainError(Codes.NOT_AUTHORIZED, `This needs the ${anyOf.join(' or ')} permission.`)
  }
}

export function requireScope(actor: Actor, scope: string) {
  if (actor.kind !== 'agent') return
  if (!actor.scopes.has(scope)) throw new DomainError(Codes.NOT_AUTHORIZED, `The agent has no active ${scope} grant.`)
}

/** Stable identity for idempotency receipts: one key can't be replayed by another principal. */
export const principalKey = (actor: Actor) =>
  actor.kind === 'user' ? `user:${actor.userId}` : actor.kind === 'agent' ? `agent:${actor.agentId}` : `system:${actor.name}`

export const actorUserId = (actor: Actor) => (actor.kind === 'user' ? actor.userId : null)
export const actorAgentId = (actor: Actor) => (actor.kind === 'agent' ? actor.agentId : null)
