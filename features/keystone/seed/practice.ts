import type { Permission } from '../access'

/**
 * Cedar Creek Animal Hospital (BUILD-PLAN §5). Every person, licence and DEA number is fictional:
 * licence numbers are format-shaped, DEA numbers pass the check-digit rule but belong to no one,
 * phones are 916-555-01xx; staff emails use the practice's own domain (cedarcreekvet.com) and nothing is ever sent from the seed. Ids are deterministic (`seed_…`), so loading
 * twice changes nothing.
 */

export const PRACTICE = {
  legalName: 'Cedar Creek Animal Hospital, Inc.',
  displayName: 'Cedar Creek Animal Hospital',
  homeTimeZone: 'America/Los_Angeles',
  currencyCode: 'USD',
  electiveDepositPct: '0.5',
  estimateValidityDays: 30,
  noShowGraceMinutes: 15,
}

export type LocationSeed = {
  id: string; code: string; name: string; kind: string; addressLine1: string; city: string; postalCode: string; stateCode: string
  lat: string; lng: string; timeZone: string; phone: string; email: string; regularOpen: string; regularClose: string; closures: string[]
  openHours: Record<string, [string, string] | null>; emergencyCoverage: string
}

const WEEKDAYS = (open: string, close: string, sat: [string, string] | null) => ({ mon: [open, close] as [string, string], tue: [open, close] as [string, string], wed: [open, close] as [string, string], thu: [open, close] as [string, string], fri: [open, close] as [string, string], sat, sun: null })

export const LOCATIONS: LocationSeed[] = [
  {
    id: 'seed_loc_main', code: 'CCAH-MAIN', name: 'Cedar Creek Animal Hospital', kind: 'general_practice',
    addressLine1: '4120 Cedar Creek Road', city: 'Sacramento', postalCode: '95823', stateCode: 'US-CA', lat: '38.481200', lng: '-121.441500',
    timeZone: 'America/Los_Angeles', phone: '+19165550100', email: 'frontdesk@cedarcreekvet.com', regularOpen: '07:30', regularClose: '18:00',
    closures: ['2026-12-24', '2027-12-24'], openHours: WEEKDAYS('07:30', '18:00', ['08:00', '14:00']), emergencyCoverage: 'referral',
  },
  {
    id: 'seed_loc_elkgrove', code: 'CCAH-EG', name: 'Elk Grove Wellness Clinic', kind: 'wellness',
    addressLine1: '9175 Laguna Springs Way', city: 'Elk Grove', postalCode: '95758', stateCode: 'US-CA', lat: '38.423900', lng: '-121.412700',
    timeZone: 'America/Los_Angeles', phone: '+19165550101', email: 'elkgrove@cedarcreekvet.com', regularOpen: '09:00', regularClose: '17:00',
    closures: ['2026-12-24', '2026-12-31', '2027-12-24'], openHours: WEEKDAYS('09:00', '17:00', null), emergencyCoverage: 'referral',
  },
]

type RoleSeed = { id: string; name: string; description: string; permissions: Permission[] }

const DASH: Permission[] = ['canAccessDashboard', 'canSeeOtherPeople']
const FRONT: Permission[] = ['canManageClients', 'canManagePatients', 'canReadClientPII', 'canBook', 'canCheckIn', 'canMessageClients', 'canTakePayments']
const CLINICAL_READ: Permission[] = ['canReadClinical', 'canReadClientPII']

export const ROLES: RoleSeed[] = [
  {
    id: 'seed_role_owner', name: 'Owner / Medical Director', description: 'Everything clinical and operational, incl. policies, fees, integrations, CS registrant duties and approvals. Break-glass is never seeded.',
    permissions: [
      ...DASH, ...FRONT, ...CLINICAL_READ, 'canEditOtherPeople', 'canManagePeople', 'canManageRoles', 'canManageOnboarding', 'canManagePayments', 'canIssueRefunds', 'canReadAudit',
      'canManagePractice', 'canManageIntegrations', 'canManagePolicies', 'canManageFees', 'canApprovePolicies', 'canApproveFees', 'canMergeRecords', 'canApproveMerges',
      'canOverbook', 'canManageSchedules', 'canWriteRecord', 'canSignRecord', 'canOrder', 'canAdminister', 'canPrescribe', 'canPerformSurgery', 'canAuthoriseEuthanasia',
      'canDispense', 'canFulfilRefill', 'canManageRefills', 'canAdministerControlled', 'canWitnessControlled', 'canCountControlled', 'canReceiveControlled', 'canManageControlled', 'canViewControlled',
      'canManageInventory', 'canApprovePurchase', 'canReleaseQuarantine', 'canPostInvoices', 'canAddManualCharge', 'canDiscount', 'canApproveDiscount', 'canApproveWriteOff', 'canViewFinance',
      'canProcessRecordsRequests', 'canApproveRecordsRelease', 'canManageBoarding', 'canManageTemplates', 'canManageAgents', 'canApproveAgentScopes',
    ],
  },
  {
    id: 'seed_role_manager', name: 'Practice Manager', description: 'Schedules, staff, inventory, reports, approvals (discounts, refunds, write-offs) within thresholds; no clinical signing.',
    permissions: [
      ...DASH, ...FRONT, 'canEditOtherPeople', 'canManagePeople', 'canManageOnboarding', 'canManagePayments', 'canIssueRefunds', 'canReadAudit', 'canManagePractice', 'canManageIntegrations',
      'canManageFees', 'canMergeRecords', 'canOverbook', 'canManageSchedules', 'canManageInventory', 'canApprovePurchase', 'canPostInvoices', 'canAddManualCharge', 'canDiscount',
      'canApproveDiscount', 'canApproveWriteOff', 'canViewFinance', 'canProcessRecordsRequests', 'canManageBoarding', 'canManageTemplates', 'canManageAgents', 'canApprovePolicies',
    ],
  },
  {
    id: 'seed_role_dvm', name: 'Veterinarian (DVM)', description: 'Examine, sign records, order, prescribe, approve refills, authorise euthanasia; CS administration and witness. Licensed acts also need an active CA licence.',
    permissions: [
      ...DASH, ...FRONT, ...CLINICAL_READ, 'canOverbook', 'canWriteRecord', 'canSignRecord', 'canOrder', 'canAdminister', 'canPrescribe', 'canPerformSurgery', 'canAuthoriseEuthanasia',
      'canDispense', 'canFulfilRefill', 'canManageRefills', 'canAdministerControlled', 'canWitnessControlled', 'canCountControlled', 'canViewControlled', 'canDiscount', 'canProcessRecordsRequests',
    ],
  },
  {
    id: 'seed_role_relief_dvm', name: 'Relief DVM', description: 'As DVM, time-boxed by the user access expiry and limited to assigned locations.',
    permissions: [
      ...DASH, ...FRONT, ...CLINICAL_READ, 'canWriteRecord', 'canSignRecord', 'canOrder', 'canAdminister', 'canPrescribe', 'canPerformSurgery', 'canAuthoriseEuthanasia',
      'canDispense', 'canFulfilRefill', 'canManageRefills', 'canAdministerControlled', 'canWitnessControlled', 'canViewControlled',
    ],
  },
  {
    id: 'seed_role_rvt', name: 'Credentialed Technician (RVT)', description: 'History, vitals, treatments, anaesthesia records, supervised vaccines; CS administration under an order, witness and counts.',
    permissions: [...DASH, ...FRONT, ...CLINICAL_READ, 'canWriteRecord', 'canOrder', 'canAdminister', 'canDispense', 'canFulfilRefill', 'canAdministerControlled', 'canWitnessControlled', 'canCountControlled', 'canReceiveControlled', 'canViewControlled', 'canManageBoarding'],
  },
  {
    id: 'seed_role_assistant', name: 'Assistant / Kennel', description: 'Tasks, run cards, daily care logs and feeding; no controlled substances.',
    permissions: [...DASH, 'canReadClinical', 'canCheckIn', 'canAdminister', 'canManageBoarding'],
  },
  {
    id: 'seed_role_csr', name: 'Client Service Representative', description: 'Clients and patients, booking, check-in/out, payments, estimate presentation, records and refill intake.',
    permissions: [...DASH, ...FRONT, 'canProcessRecordsRequests', 'canPostInvoices'],
  },
  { id: 'seed_role_groomer', name: 'Groomer', description: 'Groom schedule and notes.', permissions: [...DASH, 'canGroom', 'canCheckIn'] },
  {
    id: 'seed_role_inventory', name: 'Inventory Lead', description: 'Items, purchase orders, receiving (CII receipts need a registrant co-sign), counts, quarantine.',
    permissions: [...DASH, 'canManageInventory', 'canReceiveStock', 'canOrderStock', 'canReceiveControlled', 'canCountControlled', 'canViewControlled'],
  },
  { id: 'seed_role_bookkeeper', name: 'Bookkeeper', description: 'Invoices, payments, statements, exports, period close.', permissions: [...DASH, 'canTakePayments', 'canPostInvoices', 'canViewFinance', 'canManagePayments'] },
  { id: 'seed_role_agent_owner', name: 'Agent Owner', description: 'Owns AI agent identities and requests their grants; a second person approves.', permissions: [...DASH, 'canManageAgents'] },
  { id: 'seed_role_ai_agent', name: 'AI Agent', description: 'Least privilege for AI agents. Holds no permission: an agent acts only through its tool grants and never inherits the person who connected it.', permissions: [] },
]

export type StaffSeed = {
  id: string; userId: string; name: string; email: string; title: string; roleId: string; kind: string; credentials: string
  employment: 'employee' | 'relief' | 'contractor'; homeLocationId: string; locationIds: string[]; userKind: 'staff' | 'relief'; accessDays?: number
  licence?: { kind: string; number: string; issuedOn: string; expiresOn: string }
}

const BOTH = ['seed_loc_main', 'seed_loc_elkgrove']
const MAIN = ['seed_loc_main']

export const STAFF: StaffSeed[] = [
  { id: 'seed_staff_marsh', userId: 'seed_user_marsh', name: 'Dr. Elena Marsh', email: 'elena.marsh@cedarcreekvet.com', title: 'Owner & Medical Director', roleId: 'seed_role_owner', kind: 'dvm', credentials: 'DVM', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: BOTH, userKind: 'staff', licence: { kind: 'veterinarian', number: 'VET 14862', issuedOn: '2009-07-01', expiresOn: '2027-06-30' } },
  { id: 'seed_staff_okafor', userId: 'seed_user_okafor', name: 'Dr. Samuel Okafor', email: 'samuel.okafor@cedarcreekvet.com', title: 'Associate Veterinarian', roleId: 'seed_role_dvm', kind: 'dvm', credentials: 'DVM', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'veterinarian', number: 'VET 19214', issuedOn: '2015-08-01', expiresOn: '2027-01-31' } },
  { id: 'seed_staff_desai', userId: 'seed_user_desai', name: 'Dr. Priya Desai', email: 'priya.desai@cedarcreekvet.com', title: 'Associate Veterinarian', roleId: 'seed_role_dvm', kind: 'dvm', credentials: 'DVM, DABVP', employment: 'employee', homeLocationId: 'seed_loc_elkgrove', locationIds: BOTH, userKind: 'staff', licence: { kind: 'veterinarian', number: 'VET 21577', issuedOn: '2018-06-15', expiresOn: '2028-05-31' } },
  { id: 'seed_staff_bennett', userId: 'seed_user_bennett', name: 'Dr. Lucas Bennett', email: 'lucas.bennett@cedarcreekvet.com', title: 'Associate Veterinarian', roleId: 'seed_role_dvm', kind: 'dvm', credentials: 'DVM', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'veterinarian', number: 'VET 23940', issuedOn: '2021-07-01', expiresOn: '2026-10-31' } },
  { id: 'seed_staff_cole', userId: 'seed_user_cole', name: 'Dr. Hannah Cole', email: 'hannah.cole@cedarcreekvet.com', title: 'Relief Veterinarian', roleId: 'seed_role_relief_dvm', kind: 'dvm', credentials: 'DVM', employment: 'relief', homeLocationId: 'seed_loc_main', locationIds: BOTH, userKind: 'relief', accessDays: 90, licence: { kind: 'veterinarian', number: 'VET 20488', issuedOn: '2017-01-10', expiresOn: '2027-12-31' } },
  { id: 'seed_staff_lopez', userId: 'seed_user_lopez', name: 'Maria Lopez', email: 'maria.lopez@cedarcreekvet.com', title: 'Lead RVT (controlled substances)', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: BOTH, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 11873', issuedOn: '2012-03-01', expiresOn: '2027-02-28' } },
  { id: 'seed_staff_price', userId: 'seed_user_price', name: 'Jordan Price', email: 'jordan.price@cedarcreekvet.com', title: 'RVT', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 15302', issuedOn: '2016-09-01', expiresOn: '2027-08-31' } },
  { id: 'seed_staff_rahman', userId: 'seed_user_rahman', name: 'Aisha Rahman', email: 'aisha.rahman@cedarcreekvet.com', title: 'RVT', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_elkgrove', locationIds: BOTH, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 16944', issuedOn: '2018-02-01', expiresOn: '2028-01-31' } },
  { id: 'seed_staff_tran', userId: 'seed_user_tran', name: 'Kevin Tran', email: 'kevin.tran@cedarcreekvet.com', title: 'RVT', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 17411', issuedOn: '2019-05-01', expiresOn: '2027-04-30' } },
  { id: 'seed_staff_nguyen', userId: 'seed_user_nguyen', name: 'Beth Nguyen', email: 'beth.nguyen@cedarcreekvet.com', title: 'RVT', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 18066', issuedOn: '2020-06-01', expiresOn: '2028-05-31' } },
  { id: 'seed_staff_vega', userId: 'seed_user_vega', name: 'Carlos Vega', email: 'carlos.vega@cedarcreekvet.com', title: 'RVT', roleId: 'seed_role_rvt', kind: 'rvt', credentials: 'RVT', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff', licence: { kind: 'registered_veterinary_technician', number: 'RVT 18523', issuedOn: '2021-01-15', expiresOn: '2027-01-14' } },
  { id: 'seed_staff_ellis', userId: 'seed_user_ellis', name: 'Noah Ellis', email: 'noah.ellis@cedarcreekvet.com', title: 'Veterinary Assistant', roleId: 'seed_role_assistant', kind: 'assistant', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_ito', userId: 'seed_user_ito', name: 'Mika Ito', email: 'mika.ito@cedarcreekvet.com', title: 'Veterinary Assistant', roleId: 'seed_role_assistant', kind: 'assistant', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_brooks', userId: 'seed_user_brooks', name: 'Dana Brooks', email: 'dana.brooks@cedarcreekvet.com', title: 'Kennel Attendant', roleId: 'seed_role_assistant', kind: 'kennel', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_ochoa', userId: 'seed_user_ochoa', name: 'Luis Ochoa', email: 'luis.ochoa@cedarcreekvet.com', title: 'Veterinary Assistant', roleId: 'seed_role_assistant', kind: 'assistant', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_elkgrove', locationIds: ['seed_loc_elkgrove'], userKind: 'staff' },
  { id: 'seed_staff_reed', userId: 'seed_user_reed', name: 'Grace Reed', email: 'grace.reed@cedarcreekvet.com', title: 'Client Service Representative', roleId: 'seed_role_csr', kind: 'csr', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_patel', userId: 'seed_user_patel', name: 'Ravi Patel', email: 'ravi.patel@cedarcreekvet.com', title: 'Client Service Representative', roleId: 'seed_role_csr', kind: 'csr', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_kim', userId: 'seed_user_kim', name: 'Sun Kim', email: 'sun.kim@cedarcreekvet.com', title: 'Client Service Representative', roleId: 'seed_role_csr', kind: 'csr', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_elkgrove', locationIds: ['seed_loc_elkgrove'], userKind: 'staff' },
  { id: 'seed_staff_fox', userId: 'seed_user_fox', name: 'Amelia Fox', email: 'amelia.fox@cedarcreekvet.com', title: 'Client Service Representative', roleId: 'seed_role_csr', kind: 'csr', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_morgan', userId: 'seed_user_morgan', name: 'Tess Morgan', email: 'tess.morgan@cedarcreekvet.com', title: 'Groomer', roleId: 'seed_role_groomer', kind: 'groomer', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: MAIN, userKind: 'staff' },
  { id: 'seed_staff_park', userId: 'seed_user_park', name: 'Linda Park', email: 'linda.park@cedarcreekvet.com', title: 'Practice Manager', roleId: 'seed_role_manager', kind: 'manager', credentials: 'CVPM', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: BOTH, userKind: 'staff' },
  { id: 'seed_staff_shah', userId: 'seed_user_shah', name: 'Omar Shah', email: 'omar.shah@cedarcreekvet.com', title: 'Inventory Lead', roleId: 'seed_role_inventory', kind: 'inventory', credentials: '', employment: 'employee', homeLocationId: 'seed_loc_main', locationIds: BOTH, userKind: 'staff' },
]

/**
 * DEA registrations (fictional; check digits valid). 21 CFR 1301.12: one per location. The
 * practice holds an institutional registration at each location (stock ordering, receipts, the
 * register); the DVMs who prescribe controlled substances hold their own practitioner registrations.
 */
export const DEA_REGISTRATIONS = [
  { id: 'seed_dea_main', registrationNumber: 'BB7418521', registrantName: 'Cedar Creek Animal Hospital, Inc.', registrantKind: 'practitioner_institution', staffMemberId: null, locationId: 'seed_loc_main', schedules: ['2', '2N', '3', '3N', '4', '5'], issuedOn: '2025-02-01', expiresOn: '2028-01-31' },
  { id: 'seed_dea_elkgrove', registrationNumber: 'BB7418533', registrantName: 'Cedar Creek Animal Hospital, Inc. (Elk Grove Wellness Clinic)', registrantKind: 'practitioner_institution', staffMemberId: null, locationId: 'seed_loc_elkgrove', schedules: ['3', '3N', '4', '5'], issuedOn: '2025-05-01', expiresOn: '2028-04-30' },
  { id: 'seed_dea_marsh_main', registrationNumber: 'AM4826131', registrantName: 'Elena Marsh, DVM', registrantKind: 'practitioner_individual', staffMemberId: 'seed_staff_marsh', locationId: 'seed_loc_main', schedules: ['2', '2N', '3', '3N', '4', '5'], issuedOn: '2024-07-01', expiresOn: '2027-06-30' },
  { id: 'seed_dea_marsh_eg', registrationNumber: 'AM4826143', registrantName: 'Elena Marsh, DVM', registrantKind: 'practitioner_individual', staffMemberId: 'seed_staff_marsh', locationId: 'seed_loc_elkgrove', schedules: ['3', '3N', '4', '5'], issuedOn: '2025-05-01', expiresOn: '2028-04-30' },
  { id: 'seed_dea_okafor', registrationNumber: 'BO5172907', registrantName: 'Samuel Okafor, DVM', registrantKind: 'practitioner_individual', staffMemberId: 'seed_staff_okafor', locationId: 'seed_loc_main', schedules: ['2', '2N', '3', '3N', '4', '5'], issuedOn: '2024-02-01', expiresOn: '2027-01-31' },
  { id: 'seed_dea_desai', registrationNumber: 'FD6304187', registrantName: 'Priya Desai, DVM', registrantKind: 'practitioner_individual', staffMemberId: 'seed_staff_desai', locationId: 'seed_loc_elkgrove', schedules: ['3', '3N', '4', '5'], issuedOn: '2025-06-01', expiresOn: '2028-05-31' },
  // Expired on purpose: the Phase 0 exit gate shows a CS guard refusing it.
  { id: 'seed_dea_cole', registrationNumber: 'FC2965070', registrantName: 'Hannah Cole, DVM', registrantKind: 'practitioner_individual', staffMemberId: 'seed_staff_cole', locationId: 'seed_loc_main', schedules: ['2', '2N', '3', '3N', '4', '5'], issuedOn: '2023-09-01', expiresOn: '2026-08-31' },
]

export type ApprovalPolicySeed = { action: string; description: string; requiredPermission: Permission; expiresAfterMinutes: number; thresholdMinor?: bigint }

export const APPROVAL_POLICIES: ApprovalPolicySeed[] = [
  { action: 'practice.controls', description: 'Change practice-wide controls (thresholds, deposit rule, feature flags incl. the AI receptionist).', requiredPermission: 'canApprovePolicies', expiresAfterMinutes: 1440 },
  { action: 'policy.publish', description: 'Publish a policy pack version.', requiredPermission: 'canApprovePolicies', expiresAfterMinutes: 3 * 1440 },
  { action: 'fee_schedule.publish', description: 'Publish a fee schedule version.', requiredPermission: 'canApproveFees', expiresAfterMinutes: 3 * 1440 },
  { action: 'record.merge', description: 'Merge duplicate client or patient records.', requiredPermission: 'canApproveMerges', expiresAfterMinutes: 1440 },
  { action: 'discount.apply', description: 'Apply a discount over the practice threshold.', requiredPermission: 'canApproveDiscount', expiresAfterMinutes: 240 },
  { action: 'refund.issue', description: 'Refund a payment over the practice threshold.', requiredPermission: 'canIssueRefunds', expiresAfterMinutes: 1440, thresholdMinor: 25_000n },
  { action: 'write_off.post', description: 'Write off a client balance.', requiredPermission: 'canApproveWriteOff', expiresAfterMinutes: 1440 },
  { action: 'records.release_third_party', description: 'Release records to a third party (court, subpoena, insurer).', requiredPermission: 'canApproveRecordsRelease', expiresAfterMinutes: 3 * 1440 },
  { action: 'purchase_order.approve', description: 'Approve a purchase order over threshold.', requiredPermission: 'canApprovePurchase', expiresAfterMinutes: 3 * 1440 },
  { action: 'agent_scope.grant', description: 'Grant an AI agent a tool scope.', requiredPermission: 'canApproveAgentScopes', expiresAfterMinutes: 1440 },
  { action: 'role.assign_approval', description: 'Give a person a role that can approve.', requiredPermission: 'canManageRoles', expiresAfterMinutes: 1440 },
  { action: 'encounter.void', description: 'Void an unsigned visit record opened in error (nothing given, ordered or charged).', requiredPermission: 'canSignRecord', expiresAfterMinutes: 1440 },
  { action: 'cs.discrepancy_close', description: 'Close a controlled-substance discrepancy case.', requiredPermission: 'canManageControlled', expiresAfterMinutes: 3 * 1440 },
]
