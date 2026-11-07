import { actorFromSession, requirePermission } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { POLICY_KIND_NAMES, loadPolicySnapshot, resolveFromSnapshot, resolvePolicy, type PolicyKind } from '../domain/policy'
import { localDate } from '../lib/calendar'

/**
 * Read-side domain queries for the practice spine. They run as the server's own Prisma client (the
 * lists are governed) after an explicit permission check.
 */

/** The policy in force for a kind at a location (today in the location's zone unless a date is given). */
export async function policyInForce(_root: unknown, args: { kind: string; locationId: string; on?: string | null }, context: any) {
  const actor = actorFromSession(context.session)
  requirePermission(actor, 'canAccessDashboard')
  if (!POLICY_KIND_NAMES.includes(args.kind as PolicyKind)) throw new DomainError(Codes.INVALID_INPUT, `Unknown policy kind ${args.kind}.`, { field: 'kind' })
  const location = await context.prisma.location.findUnique({ where: { id: args.locationId }, select: { timeZone: true } })
  if (!location) throw new DomainError(Codes.NOT_FOUND, 'Location not found.')
  const on = args.on || localDate({ timeZone: location.timeZone }, new Date())
  return resolvePolicy(context.prisma, args.kind as PolicyKind, { locationId: args.locationId, on })
}

/** One row per kind and location: resolves or why not (the Settings → Policies screen). */
export async function policyMatrix(_root: unknown, _args: unknown, context: any) {
  const actor = actorFromSession(context.session)
  requirePermission(actor, 'canAccessDashboard')
  const locations = await context.prisma.location.findMany({ where: { active: true }, select: { id: true, code: true, name: true, timeZone: true }, orderBy: { code: 'asc' } })
  const snapshot = await loadPolicySnapshot(context.prisma, POLICY_KIND_NAMES)
  const rows = []
  for (const loc of locations) {
    const on = localDate({ timeZone: loc.timeZone }, new Date())
    for (const kind of POLICY_KIND_NAMES) {
      try {
        const p = resolveFromSnapshot(snapshot, kind, { locationId: loc.id, on })
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: true, verified: p.verified, versions: p.versions, unverifiedRules: p.unverifiedRules })
      } catch (error) {
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: false, code: (error as DomainError).code ?? 'ERROR', message: (error as Error).message })
      }
    }
  }
  return rows
}
