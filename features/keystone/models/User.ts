import { list } from '@keystone-6/core'
import { allOperations, denyAll } from '@keystone-6/core/access'
import { calendarDay, checkbox, password, relationship, select, text, timestamp } from '@keystone-6/core/fields'
import { trackingFields } from './trackingFields'

import { isSignedIn, permissions, rules } from '../access'

export const User = list({
  access: {
    operation: {
      ...allOperations(isSignedIn),
      create: (args) => {
        // Allow public sign-ups if environment variable is set to true
        if (process.env.PUBLIC_SIGNUPS_ALLOWED === 'true') {
          return true;
        }
        // Otherwise, require canManagePeople permission
        return permissions.canManagePeople(args);
      },
      delete: permissions.canManagePeople,
    },
    filter: {
      query: rules.canReadPeople,
      update: rules.canUpdatePeople,
    },
  },
  ui: {
    hideCreate: args => !permissions.canManagePeople(args),
    hideDelete: args => !permissions.canManagePeople(args),
    listView: {
      initialColumns: ['name', 'email', 'title', 'role', 'kind'],
    },
    itemView: {
      defaultFieldMode: ({ session, item }) => {
        // canEditOtherPeople can edit other people
        if (session?.data.role?.canEditOtherPeople) return 'edit'

        // edit themselves
        if (session?.itemId === item?.id) return 'edit'

        // else, default all fields to read mode
        return 'read'
      },
    },
  },
  fields: {
    name: text({
      validation: {
        isRequired: true,
      },
    }),
    email: text({
      isFilterable: false,
      isOrderable: false,
      isIndexed: 'unique',
      validation: {
        isRequired: true,
      },
    }),
    password: password({
      access: {
        read: denyAll,
        update: ({ session, item }) =>
          permissions.canManagePeople({ session }) || session?.itemId === item.id,
      },
      validation: { isRequired: true },
    }),
    role: relationship({
      ref: 'Role.assignedTo',
      access: {
        create: permissions.canManagePeople,
        update: permissions.canManagePeople,
      },
      ui: {
        itemView: {
          fieldMode: args => (permissions.canManagePeople(args) ? 'edit' : 'read'),
        },
      },
    }),
    kind: select({
      type: 'enum',
      options: ['staff', 'relief', 'auditor', 'administrator'].map(value => ({ label: value, value })),
      defaultValue: 'staff',
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople },
    }),
    title: text(),
    staffMember: relationship({ ref: 'StaffMember.user', ui: { description: 'The clinical staff record (licences, schedules, DEA).' } }),
    mfaEnrolled: checkbox({ defaultValue: false, access: { create: () => false, update: () => false } }),
    accessExpiresAt: timestamp({
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople },
      ui: { description: 'Time-boxed access for relief vets, auditors and temporary administrators.' },
    }),
    onboardingStatus: select({
      options: ['not_started', 'in_progress', 'completed', 'dismissed'].map(value => ({ label: value.replaceAll('_', ' '), value })),
      defaultValue: 'not_started',
    }),
    ...trackingFields,
  },
});