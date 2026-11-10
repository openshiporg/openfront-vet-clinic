import { createHash, randomUUID } from 'node:crypto'
import type { GraphQLSchema } from 'graphql'
import { verifiedInternalIdentity } from './internalIdentity'

/*
 * Review r7 #2: password guessing. One sign-in per request is enforced by the breadth limit
 * (API_ROOT_FIELD_CAPS); this limits failed attempts across requests, per email and per client address.
 * The counts live in RateLimitBucket (the database), so they survive restarts and are shared by every
 * instance. No timer: a window simply restarts on the first attempt after it has run out.
 *
 * Every attempt is counted before the password is checked, in one atomic upsert, so concurrent guesses
 * cannot slip past the limit. A success clears the email's count and gives the address its attempt back.
 * A locked email or address gets the same answer whether or not the account exists.
 */
export const SIGN_IN_WINDOW_MINUTES = 15
/** Failed attempts per email in one window. */
export const SIGN_IN_MAX_PER_EMAIL = 5
/** Failed attempts per client address in one window: higher, because a whole practice shares one address. */
export const SIGN_IN_MAX_PER_ADDRESS = 20
export const SIGN_IN_LOCKED_MESSAGE = 'Too many sign-in attempts. Try again later.'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const emailBucketKey = (email: string) => `signin:email:${hash(email.trim().toLowerCase())}`
export const addressBucketKey = (address: string) => `signin:addr:${hash(address)}`

type Req = { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string | null } } | undefined

/** The client address of a request: the signed loopback identity from a server render, else Railway's x-real-ip. */
export function clientAddress(req: Req): string | null {
  const headers = req?.headers ?? {}
  const socket = req?.socket?.remoteAddress ?? null
  const forwarded = verifiedInternalIdentity(headers, socket, String(process.env.SESSION_SECRET || ''), Date.now())
  if (forwarded) return forwarded
  const first = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0]?.trim()
  const header = first(headers['x-real-ip']) || first(headers['x-forwarded-for'])
  if (header) return header
  // An unsigned loopback call is this server itself (every visitor would share it): no address bucket, the email one still applies.
  return socket && !/^(?:127\.|::1$|::ffff:127\.)/.test(socket) ? socket : null
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

/** Before checking a password: count the attempt; true when the email or the address is over its limit. */
export async function signInLocked(prisma: Prisma, email: string, address: string | null): Promise<boolean> {
  const byEmail = await countAttempt(prisma, emailBucketKey(email))
  const byAddress = address ? await countAttempt(prisma, addressBucketKey(address)) : 0
  return byEmail > SIGN_IN_MAX_PER_EMAIL || byAddress > SIGN_IN_MAX_PER_ADDRESS
}

/** After a correct password: the email starts over and the address gets this attempt back. */
export async function signInSucceeded(prisma: Prisma, email: string, address: string | null): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${emailBucketKey(email)}`
  if (address) await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "count" = GREATEST(COALESCE("count", 0) - 1, 0) WHERE "key" = ${addressBucketKey(address)}`
}

/** Wrap the auth package's authenticateUserWithPassword with the limit. Mutates and returns the schema. */
export function limitSignIn<S extends GraphQLSchema>(schema: S, field = 'authenticateUserWithPassword', identityArg = 'email'): S {
  const def = schema.getMutationType()?.getFields()[field]
  if (!def?.resolve) return schema
  const resolve = def.resolve
  def.resolve = async (root, args, context, info) => {
    const email = String((args as Record<string, unknown>)[identityArg] ?? '')
    const address = clientAddress(context?.req)
    const prisma = context.sudo().prisma as Prisma
    if (await signInLocked(prisma, email, address)) return { code: 'FAILURE', message: SIGN_IN_LOCKED_MESSAGE }
    const result = await resolve(root, args, context, info)
    if (result && typeof result === 'object' && 'sessionToken' in result) await signInSucceeded(prisma, email, address)
    return result
  }
  return schema
}
