import { APPROVAL_POLICIES, DEA_REGISTRATIONS, LOCATIONS, PRACTICE, ROLES, STAFF } from '@/features/keystone/seed/practice'
import { POLICY_PACKS } from '@/features/keystone/seed/policies'

/**
 * What "Load Cedar Creek" creates, section by section. Each section is one idempotent server
 * command; later phases add clients and patients, the formulary, fee schedule and boarding here.
 */
export const SETUP_SECTIONS = [
  {
    id: 'practice',
    title: 'Practice, people and policy packs',
    mutation: 'mutation LoadPractice($idempotencyKey: String!) { loadPracticeSetup(idempotencyKey: $idempotencyKey) }',
    field: 'loadPracticeSetup',
    items: [
      PRACTICE.displayName,
      ...LOCATIONS.map(loc => `${loc.name} · ${loc.city}, CA`),
      `${ROLES.length} roles with separated duties`,
      ...STAFF.map(person => `${person.name} · ${person.title}`),
      `${DEA_REGISTRATIONS.length} DEA registrations (one per location and registrant)`,
      `${POLICY_PACKS.length} policy packs: federal DEA/FDA/FCC + California`,
      'US federal business-day calendar 2026-2028 and location hours',
      `${APPROVAL_POLICIES.length} maker-checker approval policies`,
    ],
  },
] as const
