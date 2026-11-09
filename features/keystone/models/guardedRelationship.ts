import { relationship as keystoneRelationship } from '@keystone-6/core/fields'

/*
 * F1/F2 (review r3b): Keystone checks a relation filter (`deaRegistrations: { some: { … } }`) against
 * the *source* list only, so a role that cannot read DeaRegistration could still count its rows and
 * probe their values through Location. Every relationship in this app is declared through this
 * wrapper: the field is filterable and orderable only when the session may read the *whole* target
 * list (its operation access allows the query and its filter access, if any, does not narrow it).
 * Anything else (hidden list, list narrowed to the caller's own rows, unknown target) is refused.
 * The sudo context (server code) is unaffected: Keystone makes every field filterable there.
 */

type AccessArgs = { session?: unknown; context: unknown; listKey: string; fieldKey?: string }
type ListAccess = unknown
type ListLike = { access?: ListAccess }

const registry = new Map<string, ListAccess>()

/** Called once with every list config (models/index.ts) so the rule can find each target's access. */
export function registerListAccess(lists: Record<string, ListLike>) {
  for (const [key, list] of Object.entries(lists)) registry.set(key, list.access)
}

const call = async (fn: unknown, args: Record<string, unknown>) => (typeof fn === 'function' ? await fn(args) : fn)

/** True only when the session may read every row of `listKey` through the normal API. */
export async function canReadWholeList(listKey: string, args: Omit<AccessArgs, 'listKey'>): Promise<boolean> {
  if (!registry.has(listKey)) return false
  const access = registry.get(listKey) as any
  const base = { session: args.session, context: args.context, listKey, operation: 'query' }
  try {
    if (typeof access === 'function') return (await access(base)) === true
    const operation = access?.operation
    const query = typeof operation === 'function' ? operation : operation?.query
    if (query === undefined) return false
    if ((await call(query, base)) !== true) return false
    const filter = access?.filter?.query
    if (filter === undefined) return true
    return (await call(filter, base)) === true
  } catch {
    return false
  }
}

export const relationFilterRule = (target: string) => (args: AccessArgs) => canReadWholeList(target, args)

export const relationship: typeof keystoneRelationship = config => {
  const target = String(config.ref).split('.')[0]
  const rule = relationFilterRule(target)
  return keystoneRelationship({
    ...config,
    isFilterable: config.isFilterable === false ? false : rule,
    isOrderable: config.isOrderable === false ? false : rule,
  } as typeof config)
}
