import {
  Activity, BedDouble, BookOpenCheck, Bot, CalendarDays, ClipboardCheck, ClipboardList, Eye, FileLock2, HeartPulse, IdCard, Inbox, LucideIcon, MessageSquare,
  PawPrint, Phone, Pill, Receipt, Scale, Settings, ShieldCheck, Stethoscope, Syringe, Upload, Users, Warehouse,
} from 'lucide-react'

export interface PlatformNavItem {
  title: string
  href: string
  color: string
  description: string
  icon: LucideIcon
  group?: string
}

export interface PlatformNavGroup {
  id: string
  title: string
  icon: LucideIcon
  items: PlatformNavItem[]
}

/**
 * Dashboard screens (BUILD-PLAN §2). Each route is a thin wrapper in app/dashboard/(admin)/platform
 * over a feature slice in features/platform/<slice>. A screen appears in the menu when its phase ships.
 */
export const platformNavItems: PlatformNavItem[] = [
  { title: 'Today', href: '/platform/today', color: 'blue', description: 'Appointments by status, whiteboard, calls and clocks.', icon: HeartPulse, group: 'standalone' },
  { title: 'Approvals', href: '/platform/approvals', color: 'amber', description: 'Maker-checker requests waiting for a second person.', icon: ClipboardCheck, group: 'standalone' },

  { title: 'Schedule', href: '/platform/schedule', color: 'blue', description: 'Day sheet by provider and room.', icon: CalendarDays, group: 'front' },
  { title: 'Whiteboard', href: '/platform/whiteboard', color: 'emerald', description: 'Live patient flow.', icon: Activity, group: 'front' },
  { title: 'Waitlist', href: '/platform/waitlist', color: 'amber', description: 'Waitlist entries and offers.', icon: ClipboardList, group: 'front' },

  { title: 'Clients', href: '/platform/clients', color: 'blue', description: 'Households, people, consents, pets.', icon: Users, group: 'clients' },
  { title: 'Patients', href: '/platform/patients', color: 'emerald', description: 'Patients with alerts, weights and VCPR.', icon: PawPrint, group: 'clients' },

  { title: 'Encounters', href: '/platform/encounters', color: 'blue', description: 'SOAP records and signing.', icon: Stethoscope, group: 'medical' },
  { title: 'Hospital', href: '/platform/hospital', color: 'emerald', description: 'Wards, cages and the treatment sheet.', icon: BedDouble, group: 'medical' },
  { title: 'Vaccines', href: '/platform/vaccines', color: 'amber', description: 'Vaccines, rabies certificates and reminders.', icon: Syringe, group: 'medical' },
  { title: 'Prescriptions', href: '/platform/prescriptions', color: 'violet', description: 'Prescriptions and the refill queue.', icon: Pill, group: 'medical' },
  { title: 'Controlled substances', href: '/platform/controlled', color: 'rose', description: 'Register, counts, discrepancies, PDMP.', icon: FileLock2, group: 'medical' },
  { title: 'Inventory', href: '/platform/inventory', color: 'cyan', description: 'Items, lots, orders and counts.', icon: Warehouse, group: 'medical' },

  { title: 'Billing', href: '/platform/billing', color: 'emerald', description: 'Estimates, invoices, payments, insurance.', icon: Receipt, group: 'clients' },

  { title: 'Calls', href: '/platform/calls', color: 'violet', description: 'Inbound calls: AI receptionist and staff.', icon: Phone, group: 'comms' },
  { title: 'Messages', href: '/platform/messages', color: 'blue', description: 'Client threads, SMS and email.', icon: MessageSquare, group: 'comms' },
  { title: 'Records requests', href: '/platform/records-requests', color: 'slate', description: 'Requests and releases.', icon: Inbox, group: 'comms' },
  { title: 'Agents', href: '/platform/agents', color: 'violet', description: 'AI agents, grants, kill switch, actions.', icon: Bot, group: 'comms' },

  { title: 'Team & licences', href: '/platform/team', color: 'slate', description: 'Staff, licences and DEA registrations with expiry.', icon: IdCard, group: 'admin' },
  { title: 'Policy packs', href: '/platform/policies', color: 'slate', description: 'Federal and state rules in force, with sources.', icon: Scale, group: 'admin' },
  { title: 'Compliance', href: '/platform/compliance', color: 'rose', description: 'Clocks, tasks and incidents.', icon: ShieldCheck, group: 'admin' },
  { title: 'Read audit', href: '/platform/read-audit', color: 'slate', description: 'Who read which client or patient record.', icon: Eye, group: 'admin' },
  { title: 'Audit log', href: '/platform/audit', color: 'slate', description: 'Hash-chained audit events and chain verification.', icon: BookOpenCheck, group: 'admin' },
  { title: 'Import', href: '/platform/imports', color: 'slate', description: 'Bring records over from Avimark or ezyVet.', icon: Upload, group: 'admin' },
  { title: 'Practice settings', href: '/platform/settings', color: 'slate', description: 'Practice, locations, calendars and controls.', icon: Settings, group: 'admin' },
]

/** Routes that exist in this build. Others stay out of the menu until their phase ships. */
export const SHIPPED_ROUTES = new Set<string>([
  '/platform/today', '/platform/approvals', '/platform/schedule', '/platform/whiteboard', '/platform/waitlist', '/platform/clients',
  '/platform/patients', '/platform/calls', '/platform/messages', '/platform/records-requests', '/platform/agents', '/platform/team', '/platform/policies', '/platform/compliance', '/platform/read-audit', '/platform/audit', '/platform/settings',
  '/platform/encounters', '/platform/hospital', '/platform/vaccines', '/platform/imports',
  '/platform/prescriptions', '/platform/controlled', '/platform/inventory', '/platform/billing',
])

const shipped = platformNavItems.filter(item => SHIPPED_ROUTES.has(item.href))

export const platformStandaloneItems = shipped.filter(item => item.group === 'standalone')

export const platformNavGroups: PlatformNavGroup[] = [
  { id: 'front', title: 'Front desk', icon: CalendarDays, items: shipped.filter(i => i.group === 'front') },
  { id: 'clients', title: 'Clients & patients', icon: PawPrint, items: shipped.filter(i => i.group === 'clients') },
  { id: 'medical', title: 'Medical', icon: Stethoscope, items: shipped.filter(i => i.group === 'medical') },
  { id: 'comms', title: 'Communications', icon: MessageSquare, items: shipped.filter(i => i.group === 'comms') },
  { id: 'admin', title: 'Practice', icon: Settings, items: shipped.filter(i => i.group === 'admin') },
]

export function getPlatformNavItemsWithBasePath(basePath: string) {
  return shipped.map(item => ({ ...item, href: `${basePath}${item.href}` }))
}
