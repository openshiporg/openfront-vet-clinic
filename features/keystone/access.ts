// Role permissions (SCHEMA §1.5). Operate and approve permissions come in pairs so one person never
// needs both halves of a control; the separation-of-duties check still blocks self-approval when a
// user happens to hold both. [L] marks permissions that also need an active licence at the location
// (domain/licensure.ts): holding the permission is never enough on its own.
export const permissionNames = [
  // Starter and fleet-mandatory
  'canSeeOtherPeople', 'canEditOtherPeople', 'canManagePeople', 'canManageRoles', 'canAccessDashboard',
  'canManageOnboarding', 'canManagePayments', 'canIssueRefunds', 'canReadAudit',
  // Practice
  'canManagePractice', 'canManageIntegrations', 'canManagePolicies', 'canManageFees', 'canApprovePolicies', 'canApproveFees',
  // Clients and patients
  'canManageClients', 'canManagePatients', 'canMergeRecords', 'canApproveMerges', 'canReadClinical', 'canReadClientPII',
  // Schedule
  'canBook', 'canOverbook', 'canCheckIn', 'canManageSchedules',
  // Clinical ([L] signRecord, prescribe, performSurgery, authoriseEuthanasia)
  'canWriteRecord', 'canSignRecord', 'canOrder', 'canAdminister', 'canPrescribe', 'canPerformSurgery', 'canAuthoriseEuthanasia',
  // Pharmacy
  'canDispense', 'canFulfilRefill', 'canManageRefills',
  // Controlled substances (never reachable by agents: I-G4)
  'canAdministerControlled', 'canWitnessControlled', 'canCountControlled', 'canReceiveControlled', 'canManageControlled', 'canViewControlled',
  // Inventory
  'canManageInventory', 'canReceiveStock', 'canOrderStock', 'canApprovePurchase', 'canReleaseQuarantine',
  // Money
  'canTakePayments', 'canPostInvoices', 'canAddManualCharge', 'canDiscount', 'canApproveDiscount', 'canApproveWriteOff', 'canViewFinance',
  // Records
  'canProcessRecordsRequests', 'canApproveRecordsRelease',
  // Boarding and grooming
  'canManageBoarding', 'canGroom',
  // Communications
  'canMessageClients', 'canManageTemplates',
  // Agents
  'canManageAgents', 'canApproveAgentScopes',
  // Raw override of a clinical read restriction. Never seeded on a default role; every use is audited.
  'canBreakGlass',
] as const

export type Permission = typeof permissionNames[number]

/** Permissions that let a user decide someone else's request. Assigning a role holding one of these is maker-checker. */
export const approvalPermissions = permissionNames.filter(
  name => name.startsWith('canApprove') || name === 'canBreakGlass' || name === 'canManageControlled' || name === 'canIssueRefunds',
) as Permission[]

/** Permissions an agent identity can never exercise, whatever its grants (I-G4). Checked by the MCP registry test. */
export const NEVER_FOR_AGENTS: readonly Permission[] = [
  'canSignRecord', 'canPrescribe', 'canPerformSurgery', 'canAuthoriseEuthanasia', 'canManageRefills',
  'canAdministerControlled', 'canWitnessControlled', 'canCountControlled', 'canReceiveControlled', 'canManageControlled', 'canViewControlled',
  'canDiscount', 'canApproveDiscount', 'canApproveWriteOff', 'canIssueRefunds', 'canMergeRecords', 'canApproveMerges',
  'canManageFees', 'canApproveFees', 'canManagePolicies', 'canApprovePolicies', 'canBreakGlass',
]

export type Session = {
  itemId: string
  listKey: string
  data: {
    name: string
    email?: string
    kind?: string | null
    accessExpiresAt?: string | null
    role: ({ id: string; name: string } & Record<Permission, boolean>) | null
  }
}

type AccessArgs = { session?: Session | null }

/** Signed in, and not past a time-boxed access window (relief vets, auditors). */
export const isSignedIn = ({ session }: AccessArgs) => {
  if (!session) return false
  const expires = session.data?.accessExpiresAt
  return !expires || Date.parse(expires) > Date.now()
}

export const hasPermission = (session: Session | null | undefined, permission: Permission) =>
  isSignedIn({ session }) && session?.data.role?.[permission] === true

export const permissions = Object.fromEntries(
  permissionNames.map(name => [name, ({ session }: AccessArgs) => hasPermission(session, name)])
) as Record<Permission, (args: AccessArgs) => boolean>

/** Any of the given permissions. */
export const anyOf = (...names: Permission[]) => ({ session }: AccessArgs) => names.some(name => hasPermission(session, name))

/** Only server code (through context.sudo()) may perform the operation. */
export const sys = () => false

export const rules = {
  canReadPeople: ({ session }: AccessArgs) =>
    !isSignedIn({ session }) ? false : session!.data.role?.canSeeOtherPeople || session!.data.role?.canManagePeople ? true : { id: { equals: session!.itemId } },
  canUpdatePeople: ({ session }: AccessArgs) =>
    !isSignedIn({ session }) ? false : session!.data.role?.canEditOtherPeople || session!.data.role?.canManagePeople ? true : { id: { equals: session!.itemId } },
}
