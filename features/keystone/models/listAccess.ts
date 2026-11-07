import { anyOf, isSignedIn, permissions, sys, type Permission } from '../access'

type Rule = (args: any) => boolean

const rule = (permission: Permission | Permission[] | 'signedIn'): Rule =>
  permission === 'signedIn' ? isSignedIn : Array.isArray(permission) ? anyOf(...permission) : permissions[permission]

/**
 * Governed list: readable with `read`, never created, updated or deleted through the generated
 * API. Every write goes through a custom mutation (command) that runs as sudo inside a transaction.
 */
export const governed = (read: Permission | Permission[] | 'signedIn') => ({
  operation: { query: rule(read), create: sys, update: sys, delete: sys },
})

/** Reference data edited directly by holders of `write` (never deleted: rows are referenced by history). */
export const managed = (read: Permission | Permission[] | 'signedIn', write: Permission | Permission[]) => ({
  operation: { query: rule(read), create: rule(write), update: rule(write), delete: sys },
})

/** Immutable rows (SCHEMA G8): readable with `read`, written only by server code. */
export const immutable = governed

/** Server-only bookkeeping. Hidden from the API altogether. */
export const serverOnly = {
  operation: { query: sys, create: sys, update: sys, delete: sys },
}
