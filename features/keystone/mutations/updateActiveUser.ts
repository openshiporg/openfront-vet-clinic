import { isSignedIn } from '../access'

/** Self-service profile edits. Role, kind and access-person flags are never self-editable. */
async function updateActiveUser(_root: unknown, { data }: { data: Record<string, unknown> }, context: any) {
  const session = context.session
  if (!isSignedIn({ session })) throw new Error('Not authenticated')
  const allowed = new Set(['email', 'name', 'password', 'onboardingStatus'])
  if (Object.keys(data || {}).some(key => !allowed.has(key))) throw new Error('Unsupported profile field')
  return context.db.User.updateOne({ where: { id: session.itemId }, data })
}

export default updateActiveUser
