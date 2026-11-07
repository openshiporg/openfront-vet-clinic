import { actorFromSession, requirePermission } from '../lib/actor'
import { verifyAuditChain as verify } from '../lib/audit'

/** Recompute the whole audit hash chain. */
export async function verifyAuditChain(_root: unknown, _args: unknown, context: any) {
  const actor = actorFromSession(context.session)
  requirePermission(actor, 'canReadAudit')
  return verify(context.prisma)
}
