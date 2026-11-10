import { createHash, randomUUID } from 'node:crypto'
import type { GraphQLSchema } from 'graphql'
import { verifiedInternalIdentity } from './internalIdentity'
import { normalizeAddress } from '../lib/internal-origin'

/*
 * Password guessing (review r7 #2, r8 #1-#4). One sign-in per request is enforced by the breadth limit
 * (API_ROOT_FIELD_CAPS); this limits attempts across requests. Counts live in RateLimitBucket (the
 * database), so they survive restarts and are shared by every instance. No timer: a window restarts on
 * the first attempt after it has run out, and expired rows are swept a few at a time on each attempt.
 *
 * The rule (AGENTS.md):
 * - Per address: at most 20 attempts in 15 minutes, whatever the email (caps spraying). IPv6 counts
 *   per /64, so one host cannot rotate addresses.
 * - Per account and address: at most 5 failed attempts in 15 minutes. Only that address is refused,
 *   so a stranger cannot lock the owner out from somewhere else.
 * - Per account, counting only addresses that have never signed in to it: after 10 attempts in 15
 *   minutes each further new address gets 1 attempt per 15 minutes. This only slows guessing (to 10
 *   plus one per attacking address per window); it never refuses an address's first attempt, so the
 *   right password works from anywhere at once, and after a typo within 15 minutes.
 * - An address that has signed in to the account in the last 90 days, or redeemed a password reset for
 *   it, skips the address limit and the account count (the 5 per account and address still apply).
 *   A device still signed in to the account is never refused. A success or a redeemed reset clears
 *   the account's counts.
 * - An email that is not an account gets the same 5 per address, so the answers never tell whether an
 *   account exists. Its row is only written inside the address's 20 attempts, so one address adds at
 *   most 20 such rows per window and a locked address adds none: the table grows with addresses, not
 *   with the emails tried. A request with no address (never public on Railway) shares one bucket.
 *
 * Attempts are counted before the password is checked, each in one atomic upsert, so concurrent
 * guesses cannot slip past a limit.
 */
export const SIGN_IN_WINDOW_MINUTES = 15
/** Attempts per client address in one window: higher, because a whole practice shares one address. */
export const SIGN_IN_MAX_PER_ADDRESS = 20
/** Failed attempts per account from one address in one window. */
export const SIGN_IN_MAX_PER_EMAIL = 5
/** Attempts on one account from new addresses after which each new address gets one attempt per window. */
export const SIGN_IN_ACCOUNT_SLOW_AFTER = 10
/** How long a successful sign-in makes an address known to the account. */
export const SIGN_IN_KNOWN_DAYS = 90
/** Expired rows deleted per attempt. */
export const SIGN_IN_SWEEP_PER_ATTEMPT = 50
export const SIGN_IN_LOCKED_MESSAGE = 'Too many sign-in attempts. Try again later.'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const normalEmail = (email: string) => email.trim().toLowerCase()
/** A request with no known address (never a public request on Railway) shares one bucket: it fails closed. */
export const UNKNOWN_ADDRESS = 'unknown-address'
const where = (address: string) => hash(address)
export const addressBucketKey = (address: string) => `signin:addr:${hash(address)}`
export const accountBucketKey = (userId: string) => `signin:acct:${hash(userId)}`
export const pairBucketKey = (userId: string, address: string) => `signin:pair:${hash(userId)}:${where(address)}`
export const knownAddressKey = (userId: string, address: string) => `signin:known:${hash(userId)}:${where(address)}`
export const unknownEmailBucketKey = (email: string, address: string) => `signin:void:${hash(normalEmail(email))}:${where(address)}`

type Req = { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string | null } } | undefined

/**
 * The client address of a request, as one identity for every sign-in path: the signed loopback
 * identity from a server render (the dashboard form) is already sha256 of the visitor's x-real-ip, and
 * Railway's x-real-ip on the API and OAuth paths is hashed the same way, so all three share one bucket.
 */
export function clientAddress(req: Req): string {
  const headers = req?.headers ?? {}
  const socket = req?.socket?.remoteAddress ?? null
  const forwarded = verifiedInternalIdentity(headers, socket, String(process.env.SESSION_SECRET || ''), Date.now())
  if (forwarded) return forwarded.replace(/^forwarded:/, '')
  const first = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0]?.trim()
  const header = first(headers['x-real-ip']) || first(headers['x-forwarded-for'])
  if (header) return hash(normalizeAddress(header))
  // An unsigned loopback call (this server itself) or no address at all: one shared bucket, so it fails closed.
  return socket && !/^(?:127\.|::1$|::ffff:127\.)/.test(socket) ? hash(normalizeAddress(socket)) : UNKNOWN_ADDRESS
}

type Prisma = { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>; $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> }

/** Count one attempt against a bucket and return the count in the current window. */
async function countAttempt(prisma: Prisma, key: string): Promise<number> {
  const rows = (await prisma.$queryRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES (${randomUUID()}, ${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) THEN 1 ELSE COALESCE("RateLimitBucket"."count", 0) + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`) as { count: number }[]
  return Number(rows[0]?.count ?? 0)
}

/** Delete a few expired sign-in rows (windows past 15 minutes, known addresses past 90 days). */
export async function sweepExpired(prisma: Prisma, limit = SIGN_IN_SWEEP_PER_ATTEMPT): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "RateLimitBucket" WHERE "id" IN (
      SELECT "id" FROM "RateLimitBucket"
      WHERE "windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) AND "key" LIKE 'signin:%'
        AND ("key" NOT LIKE 'signin:known:%' OR "windowStart" < now() - make_interval(days => ${SIGN_IN_KNOWN_DAYS}::int))
      LIMIT ${limit}::int FOR UPDATE SKIP LOCKED)`
}

/** The account an email signs in to, matched the way people type it; null when there is none. */
async function accountId(prisma: Prisma, email: string): Promise<string | null> {
  const value = email.trim()
  if (!value) return null
  const rows = (await prisma.$queryRaw`SELECT "id" FROM "User" WHERE lower("email") = lower(${value}) ORDER BY ("email" = ${value}) DESC LIMIT 1`) as { id: string }[]
  return rows[0]?.id ?? null
}

async function isKnownAddress(prisma: Prisma, userId: string, address: string): Promise<boolean> {
  if (address === UNKNOWN_ADDRESS) return false
  const rows = (await prisma.$queryRaw`SELECT 1 AS "ok" FROM "RateLimitBucket" WHERE "key" = ${knownAddressKey(userId, address)} AND "windowStart" > now() - make_interval(days => ${SIGN_IN_KNOWN_DAYS}::int)`) as unknown[]
  return rows.length > 0
}

/** Before checking a password: count the attempt and say whether it is refused. */
export async function signInAttempt(prisma: Prisma, email: string, address: string, sessionUserId: string | null = null): Promise<{ locked: boolean; userId: string | null }> {
  await sweepExpired(prisma)
  const userId = await accountId(prisma, email)
  // A device already signed in to this account gains nothing by guessing: its password is always checked.
  if (userId && sessionUserId === userId) return { locked: false, userId }
  const known = userId ? await isKnownAddress(prisma, userId, address) : false
  // Over the address limit nothing else is counted, so a locked address adds no rows.
  if (!known && (await countAttempt(prisma, addressBucketKey(address))) > SIGN_IN_MAX_PER_ADDRESS) return { locked: true, userId }
  if (!userId) return { locked: (await countAttempt(prisma, unknownEmailBucketKey(email, address))) > SIGN_IN_MAX_PER_EMAIL, userId: null }
  const pair = await countAttempt(prisma, pairBucketKey(userId, address))
  if (pair > SIGN_IN_MAX_PER_EMAIL) return { locked: true, userId }
  if (known) return { locked: false, userId }
  const account = await countAttempt(prisma, accountBucketKey(userId))
  return { locked: account > SIGN_IN_ACCOUNT_SLOW_AFTER && pair > 1, userId }
}

/** Kept for callers of the r7 API: true when the attempt is refused. */
export async function signInLocked(prisma: Prisma, email: string, address: string): Promise<boolean> {
  return (await signInAttempt(prisma, email, address)).locked
}

async function rememberAddress(prisma: Prisma, userId: string, address: string) {
  if (address === UNKNOWN_ADDRESS) return
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES (${randomUUID()}, ${knownAddressKey(userId, address)}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = now(), "count" = 1`
}

/** After a correct password: the account starts over, this address is known and gets its attempt back. */
export async function signInSucceeded(prisma: Prisma, userId: string, address: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${accountBucketKey(userId)}, ${pairBucketKey(userId, address)})`
  await rememberAddress(prisma, userId, address)
  await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "count" = GREATEST(COALESCE("count", 0) - 1, 0) WHERE "key" = ${addressBucketKey(address)}`
}

/** After a redeemed password reset: every count on the account is cleared and this address is known. */
export async function passwordResetRedeemed(prisma: Prisma, userId: string, address: string): Promise<void> {
  const prefix = `signin:pair:${hash(userId)}:%`
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${accountBucketKey(userId)} OR "key" LIKE ${prefix}`
  await rememberAddress(prisma, userId, address)
}

type Field = { resolve?: (...args: any[]) => unknown } | undefined

/** Wrap the auth package's sign-in and reset mutations with the limit. Mutates and returns the schema. */
export function limitSignIn<S extends GraphQLSchema>(schema: S, field = 'authenticateUserWithPassword', identityArg = 'email', resetField = 'redeemUserPasswordResetToken'): S {
  const fields = schema.getMutationType()?.getFields() ?? {}
  const def = fields[field] as Field
  if (def?.resolve) {
    const resolve = def.resolve
    def.resolve = async (root: unknown, args: Record<string, unknown>, context: any, info: unknown) => {
      const email = String(args[identityArg] ?? '')
      const address = clientAddress(context?.req)
      const prisma = context.sudo().prisma as Prisma
      const sessionUserId = typeof context?.session?.itemId === 'string' ? context.session.itemId : null
      const attempt = await signInAttempt(prisma, email, address, sessionUserId)
      if (attempt.locked) return { code: 'FAILURE', message: SIGN_IN_LOCKED_MESSAGE }
      const result = (await resolve(root, args, context, info)) as any
      if (result && typeof result === 'object' && 'sessionToken' in result) {
        const userId = String(result.item?.id ?? attempt.userId ?? '')
        if (userId) await signInSucceeded(prisma, userId, address)
      }
      return result
    }
  }
  const reset = fields[resetField] as Field
  if (reset?.resolve) {
    const resolve = reset.resolve
    reset.resolve = async (root: unknown, args: Record<string, unknown>, context: any, info: unknown) => {
      const result = await resolve(root, args, context, info)
      if (result == null) {
        const prisma = context.sudo().prisma as Prisma
        const userId = await accountId(prisma, String(args[identityArg] ?? ''))
        if (userId) await passwordResetRedeemed(prisma, userId, clientAddress(context?.req))
      }
      return result
    }
  }
  return schema
}
